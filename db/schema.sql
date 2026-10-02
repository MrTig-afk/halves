-- Halves database (Neon project "halves", database "halves"). Idempotent: safe to run on every deploy.
-- Source: docs/splitwise-prd.md section 9. Run with MIGRATION_DATABASE_URL (owner role);
-- the app connects as a least-privilege role that cannot run DDL.

CREATE TABLE IF NOT EXISTS person (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text        NOT NULL UNIQUE,
  role               text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  email              text,
  pin_hash           text,                       -- null = unclaimed tile
  failed_pin_count   int         NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  claimed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_session (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     bigint      NOT NULL REFERENCES person(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlement (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_low_id   bigint      NOT NULL REFERENCES person(id),   -- the pair, ordered by id
  person_high_id  bigint      NOT NULL REFERENCES person(id),
  amount_cents    int         NOT NULL CHECK (amount_cents > 0),
  from_person_id  bigint      NOT NULL REFERENCES person(id),   -- who owed
  to_person_id    bigint      NOT NULL REFERENCES person(id),
  settled_by      bigint      NOT NULL REFERENCES person(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (person_low_id < person_high_id)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id   bigint      NOT NULL REFERENCES person(id),
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- A subscription belongs to the phone's signed-in session: signing out, a PIN change or a PIN reset
-- deletes the session and with it that phone's notifications.
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES device_session(id) ON DELETE CASCADE;
ALTER TABLE push_subscription ALTER COLUMN session_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS bill (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payer_id              bigint      NOT NULL REFERENCES person(id),
  partner_id            bigint      NOT NULL REFERENCES person(id),
  description           text        NOT NULL,
  bill_date             date        NOT NULL,
  receipt_total_cents   int,                     -- null = not read
  total_cents           int         NOT NULL,
  partner_owes_cents    int         NOT NULL,
  ai_items              jsonb,                   -- the AI's original reading, never edited
  photo_state           text        NOT NULL DEFAULT 'none'
                        CHECK (photo_state IN ('none', 'kept', 'not_kept_full', 'archived')),
  settlement_id         bigint,                  -- null = open; set once, by Settle all
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (payer_id <> partner_id),
  FOREIGN KEY (settlement_id) REFERENCES settlement(id)
);

CREATE TABLE IF NOT EXISTS line_item (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id      bigint NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  position     int    NOT NULL,
  name         text   NOT NULL,
  price_cents  int    NOT NULL,                  -- negative for a discount
  kind         text   NOT NULL CHECK (kind IN ('item', 'discount', 'surcharge')),
  share        text   CHECK (share IN ('payer', 'split', 'partner')),  -- null for surcharges
  UNIQUE (bill_id, position)
);

CREATE TABLE IF NOT EXISTS scan_request (
  scan_id     uuid        PRIMARY KEY,           -- client-generated; dedups retried uploads
  person_id   bigint      NOT NULL REFERENCES person(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- The bill a scan id saved, so a retried save can answer with the stored bill.
ALTER TABLE scan_request ADD COLUMN IF NOT EXISTS bill_id bigint REFERENCES bill(id);
-- Added without a receipt (PRD 6.3, v2.3): one line, no photo, no AI reading. Stored, not inferred.
ALTER TABLE bill ADD COLUMN IF NOT EXISTS typed boolean NOT NULL DEFAULT false;

-- A bill has 2 to 5 people. Who entered it is kept apart from who paid; what each person owes,
-- and whether it is settled, lives on bill_person; who had each item on line_item_person.
ALTER TABLE bill ADD COLUMN IF NOT EXISTS added_by bigint REFERENCES person(id);
-- The date and the receipt total come from the receipt; an edited one says when it was edited
-- ("edited 29 Sep, 6:02 pm"). Null = not edited; set by the server to the save time.
ALTER TABLE bill ADD COLUMN IF NOT EXISTS date_edited_at timestamptz;
ALTER TABLE bill ADD COLUMN IF NOT EXISTS total_edited_at timestamptz;
-- The two-person columns stay until the contract step; code that does not write them must be able to.
ALTER TABLE bill ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE bill ALTER COLUMN partner_owes_cents DROP NOT NULL;

CREATE TABLE IF NOT EXISTS bill_person (
  bill_id        bigint NOT NULL REFERENCES bill(id),
  person_id      bigint NOT NULL REFERENCES person(id),
  owes_cents     int    NOT NULL CHECK (owes_cents >= 0),   -- 0 for the payer
  settlement_id  bigint REFERENCES settlement(id),           -- null = no round yet; set once, by Settle up
  PRIMARY KEY (bill_id, person_id)
);
-- When the share was settled (the round's moment, or the save for a $0.00 share). Kept on the share,
-- not read from the settlement, because only the pair may see a settlement (RLS) while everyone on
-- the bill sees its shares. Set once, with settlement_id; never changes.
ALTER TABLE bill_person ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE TABLE IF NOT EXISTS line_item_person (
  line_item_id  bigint NOT NULL REFERENCES line_item(id),
  person_id     bigint NOT NULL REFERENCES person(id),
  PRIMARY KEY (line_item_id, person_id)
);

-- Wrong PINs per phone. client = 'd:<device id>' (signed device cookie) or 'ip:<keyed hash>' (a
-- request without one); wrong = the moments of its wrong PINs in the last 15 minutes. No RLS:
-- written before anyone is signed in; holds no name, PIN or raw address.
-- Rows are never deleted (one small row per phone or address); add a sweep if the table ever matters.
CREATE TABLE IF NOT EXISTS pin_throttle (
  client  text          PRIMARY KEY,
  wrong   timestamptz[] NOT NULL
);

-- Bills saved before multi-person (partner_id set) become two bill_person rows, and each item
-- line's share becomes who had it. Re-runnable: rows already copied are skipped, and a settle the
-- old code made after the first copy is carried over. Skipped once the old columns are gone.
-- One EXECUTE per statement: the statements must not be parsed while the columns are absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bill' AND column_name = 'partner_id') THEN
    EXECUTE 'UPDATE bill SET added_by = payer_id WHERE added_by IS NULL';
    EXECUTE 'INSERT INTO bill_person (bill_id, person_id, owes_cents, settlement_id)
             SELECT id, payer_id, 0, NULL FROM bill WHERE partner_id IS NOT NULL
             ON CONFLICT DO NOTHING';
    EXECUTE 'INSERT INTO bill_person (bill_id, person_id, owes_cents, settlement_id)
             SELECT id, partner_id, partner_owes_cents, settlement_id FROM bill WHERE partner_id IS NOT NULL
             ON CONFLICT (bill_id, person_id) DO UPDATE SET settlement_id = EXCLUDED.settlement_id
             WHERE bill_person.settlement_id IS NULL AND EXCLUDED.settlement_id IS NOT NULL';
    EXECUTE 'INSERT INTO line_item_person (line_item_id, person_id)
             SELECT li.id, b.payer_id FROM line_item li JOIN bill b ON b.id = li.bill_id
             WHERE li.kind = ''item'' AND (li.share IN (''payer'', ''split'') OR li.share IS NULL) AND b.partner_id IS NOT NULL
             UNION ALL
             SELECT li.id, b.partner_id FROM line_item li JOIN bill b ON b.id = li.bill_id
             WHERE li.kind = ''item'' AND li.share IN (''partner'', ''split'') AND b.partner_id IS NOT NULL
             ON CONFLICT DO NOTHING';
  END IF;
END $$;

-- settled_at for shares settled before the column existed: a round's moment, or the bill's save
-- time for a $0.00 share. Re-runnable (only fills a null), and valid whether or not the old columns exist.
UPDATE bill_person bp SET settled_at = s.created_at FROM settlement s
  WHERE bp.settlement_id = s.id AND bp.settled_at IS NULL;
UPDATE bill_person bp SET settled_at = b.created_at FROM bill b
  WHERE b.id = bp.bill_id AND bp.person_id <> b.payer_id AND bp.owes_cents = 0
    AND bp.settlement_id IS NULL AND bp.settled_at IS NULL;

-- Receipt photos. Same database; kept only while the whole Neon project stays under
-- 400 MB (checked before each insert), so photos can never fill the 0.5 GB free cap
-- and block saving bills.
CREATE TABLE IF NOT EXISTS receipt_photo (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id      bigint      NOT NULL UNIQUE REFERENCES bill(id),
  jpeg         bytea       NOT NULL,
  byte_size    int         NOT NULL,
  exported_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Tile names are unique whatever the letter case, so "rahul" can never sit beside "Rahul".
CREATE UNIQUE INDEX IF NOT EXISTS person_name_lower ON person (lower(name));

-- Which PIN a session was signed in with. Every PIN change (claim, admin reset, Change PIN) gives
-- the person a new stamp, and a session counts only while it carries the current one - so a
-- sign-in that checked a PIN just before it changed writes a stale stamp and signs no one in.
ALTER TABLE person ADD COLUMN IF NOT EXISTS pin_stamp uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE device_session ADD COLUMN IF NOT EXISTS pin_stamp uuid;
UPDATE device_session s SET pin_stamp = p.pin_stamp FROM person p WHERE s.person_id = p.id AND s.pin_stamp IS NULL;
ALTER TABLE device_session ALTER COLUMN pin_stamp SET NOT NULL;

-- A bill is settled once and stays settled: settlement_id may go from null to a round, never
-- back to null and never to another round. The grants below allow updating the column at all;
-- this is what makes that update one-way.
CREATE OR REPLACE FUNCTION bill_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
    RAISE EXCEPTION 'bill % is already settled', OLD.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bill_settle_once ON bill;
CREATE TRIGGER bill_settle_once BEFORE UPDATE OF settlement_id ON bill
  FOR EACH ROW EXECUTE FUNCTION bill_settle_once();

-- A share is settled once and stays settled: null -> a round, never back, never another round; and
-- the moment it was settled, once set, never changes.
CREATE OR REPLACE FUNCTION bill_person_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id)
     OR (OLD.settled_at IS NOT NULL AND NEW.settled_at IS DISTINCT FROM OLD.settled_at) THEN
    RAISE EXCEPTION 'share of bill % is already settled', OLD.bill_id;
  END IF;
  -- A share that owes something gets its settle time together with its round, never on its own. (A
  -- $0.00 share is settled at save, with no round, so it may carry one: the backfill sets it.)
  IF NEW.settled_at IS DISTINCT FROM OLD.settled_at AND NEW.settlement_id IS NULL AND NEW.owes_cents > 0 THEN
    RAISE EXCEPTION 'share of bill % is not settled', OLD.bill_id;
  END IF;
  -- The app role stamps a settle time only together with the round (settlement_id null -> a value),
  -- never on its own: not on a payer's row, not on a $0.00 share (settled at save). Migrations
  -- (the owner role) may backfill.
  IF current_user = 'halves_app' AND NEW.settled_at IS DISTINCT FROM OLD.settled_at
     AND NOT (OLD.settlement_id IS NULL AND NEW.settlement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'share of bill % is stamped only with its round', OLD.bill_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bill_person_settle_once ON bill_person;
CREATE TRIGGER bill_person_settle_once BEFORE UPDATE OF settlement_id, settled_at ON bill_person
  FOR EACH ROW EXECUTE FUNCTION bill_person_settle_once();

-- Functions that act for the signed-in person. SECURITY DEFINER, owned by the migration role, with
-- a pinned search_path (halves_app cannot create objects in public, so nothing can shadow a name).
-- Who the app is acting for: set by lib/db.ts for one transaction (set_config('app.person_id', id, true)).
CREATE OR REPLACE FUNCTION app_person() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT nullif(current_setting('app.person_id', true), '')::bigint $$;

-- On the bill, or its adder (the adder is always on it, so this widens nothing; it lets a save see
-- its own bill before its bill_person rows exist). VOLATILE on purpose: it must see rows inserted
-- earlier in the same save statement.
CREATE OR REPLACE FUNCTION is_member(b bigint) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM bill_person WHERE bill_id = b AND person_id = app_person())
       OR EXISTS (SELECT 1 FROM bill WHERE id = b AND added_by = app_person()) $$;

CREATE OR REPLACE FUNCTION is_adder(b bigint) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM bill WHERE id = b AND added_by = app_person()) $$;

-- Whether a round is the one between this person and the bill's payer, made in this very transaction
-- (so an older round can never be attached to a share). A function (not a subquery in the policy)
-- because Settle up inserts the settlement and stamps the shares in one statement, and only a
-- VOLATILE function sees the row the same statement just inserted.
CREATE OR REPLACE FUNCTION round_fits(sid bigint, b bigint, p bigint) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM settlement s JOIN bill x ON x.id = b
                  WHERE s.id = sid AND s.person_low_id = least(p, x.payer_id) AND s.person_high_id = greatest(p, x.payer_id)
                    AND s.created_at = now()) $$;

CREATE OR REPLACE FUNCTION line_bill(li bigint) RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT bill_id FROM line_item WHERE id = li $$;

-- The admin adds a tile. Null when the caller is not the admin or the name is taken.
CREATE OR REPLACE FUNCTION admin_add_person(n text) RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ WITH ins AS (
     INSERT INTO person (name)
     SELECT n WHERE EXISTS (SELECT 1 FROM person WHERE id = app_person() AND role = 'admin')
     ON CONFLICT DO NOTHING RETURNING id)
   SELECT id FROM ins $$;

-- The admin resets a member's PIN: unclaimed tile, signed out everywhere. False when the caller is
-- not the admin, or the tile is the admin's or unknown.
CREATE OR REPLACE FUNCTION admin_reset_pin(p bigint) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ WITH u AS (
     UPDATE person SET pin_hash = null, pin_stamp = gen_random_uuid(), failed_pin_count = 0, locked_until = null, claimed_at = null
     WHERE id = p AND role = 'member'
       AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin')
     RETURNING id),
   s AS (DELETE FROM device_session WHERE person_id IN (SELECT id FROM u) RETURNING 1)
   SELECT EXISTS (SELECT 1 FROM u) $$;

-- Someone's phones that still sign them in (the pin_stamp rule in lib/session.ts).
CREATE OR REPLACE FUNCTION push_targets(p bigint) RETURNS TABLE (id bigint, endpoint text, p256dh text, auth text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
   FROM push_subscription ps
   JOIN device_session s ON s.id = ps.session_id
   JOIN person pe ON pe.id = s.person_id AND pe.pin_stamp = s.pin_stamp
   WHERE ps.person_id = p $$;

-- A dead endpoint (the push service says it is gone) is forgotten.
CREATE OR REPLACE FUNCTION drop_push(sub bigint) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ DELETE FROM push_subscription WHERE id = sub $$;

-- Saves this phone's subscription for the signed-in person. A phone whose endpoint is still held by
-- another person's stale session takes it over, which the person's own view could not do. False when
-- the session is not the caller's.
CREATE OR REPLACE FUNCTION save_push(sess uuid, ep text, k1 text, k2 text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ WITH ok AS (SELECT 1 FROM device_session WHERE id = sess AND person_id = app_person()),
   old AS (DELETE FROM push_subscription WHERE session_id = sess AND endpoint <> ep AND EXISTS (SELECT 1 FROM ok) RETURNING 1),
   ins AS (
     INSERT INTO push_subscription (person_id, session_id, endpoint, p256dh, auth)
     SELECT app_person(), sess, ep, k1, k2 WHERE EXISTS (SELECT 1 FROM ok)
     ON CONFLICT (endpoint) DO UPDATE
       SET person_id = excluded.person_id, session_id = excluded.session_id, p256dh = excluded.p256dh, auth = excluded.auth
     RETURNING 1)
   SELECT EXISTS (SELECT 1 FROM ins) $$;

-- The pinned search_path is safe only while nobody else can create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Nobody runs them by default, whether or not the app role exists yet; it is granted them below.
REVOKE EXECUTE ON FUNCTION app_person(), is_member(bigint), is_adder(bigint), round_fits(bigint, bigint, bigint), line_bill(bigint),
  admin_add_person(text), admin_reset_pin(bigint), push_targets(bigint), drop_push(bigint),
  save_push(uuid, text, text, text) FROM PUBLIC;

-- The app role (created once at setup, no DDL rights). EXPAND grants: everything the live v2.3 code
-- needs, plus the new tables, so this part is safe to run while v2.3 is still serving (and the new
-- code works on it too). Saved bills are immutable: bills only gain a settlement or an archived
-- photo; line items and settlements are insert-only. Everything is revoked first so the grants
-- are the whole truth; skipped when the role does not exist yet. The narrow set is phase C, below.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'halves_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM halves_app;
    REVOKE CREATE ON SCHEMA public FROM halves_app;
    GRANT USAGE ON SCHEMA public TO halves_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO halves_app;
    GRANT SELECT, INSERT, UPDATE         ON person            TO halves_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON device_session    TO halves_app;
    GRANT SELECT, INSERT, DELETE         ON push_subscription TO halves_app;
    GRANT UPDATE (person_id, session_id, p256dh, auth) ON push_subscription TO halves_app;
    GRANT SELECT, INSERT                 ON bill              TO halves_app;
    GRANT UPDATE (settlement_id, photo_state) ON bill         TO halves_app;
    GRANT SELECT, INSERT                 ON line_item         TO halves_app;
    GRANT SELECT, INSERT                 ON bill_person       TO halves_app;
    GRANT UPDATE (settlement_id, settled_at) ON bill_person   TO halves_app;
    GRANT SELECT, INSERT                 ON line_item_person  TO halves_app;
    GRANT SELECT, INSERT                 ON pin_throttle      TO halves_app;
    GRANT UPDATE (wrong)                 ON pin_throttle      TO halves_app;
    GRANT EXECUTE ON FUNCTION app_person(), is_member(bigint), is_adder(bigint), round_fits(bigint, bigint, bigint), line_bill(bigint),
      admin_add_person(text), admin_reset_pin(bigint), push_targets(bigint), drop_push(bigint),
      save_push(uuid, text, text, text) TO halves_app;
    GRANT SELECT, INSERT                 ON settlement        TO halves_app;
    GRANT SELECT, INSERT                 ON scan_request      TO halves_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_photo     TO halves_app;
  END IF;
END $$;

-- ==== PHASE C: runs only after the new code is live ====
-- Everything below breaks the v2.3 code (it never sets app.person_id, and writes columns the narrow
-- grants no longer allow), so `scripts/migrate.mjs --expand-only` stops above this line, and the full
-- file runs only once nothing but the new code is serving. Do not put anything v2.3 needs below here.

-- The narrow grants, replacing the expand ones above (revoked first, then the whole set).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'halves_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM halves_app;
    GRANT SELECT                         ON person            TO halves_app;  -- tiles are added through admin_add_person
    GRANT UPDATE (pin_hash, pin_stamp, failed_pin_count, locked_until, claimed_at) ON person TO halves_app;
    GRANT SELECT, DELETE                 ON device_session    TO halves_app;
    GRANT INSERT (person_id, pin_stamp)  ON device_session    TO halves_app;
    GRANT UPDATE (pin_stamp)             ON device_session    TO halves_app;
    GRANT SELECT, DELETE                 ON push_subscription TO halves_app;  -- save_push writes
    GRANT SELECT, INSERT                 ON bill              TO halves_app;
    GRANT UPDATE (photo_state)           ON bill              TO halves_app;
    GRANT SELECT, INSERT                 ON line_item         TO halves_app;
    GRANT SELECT, INSERT                 ON bill_person       TO halves_app;
    GRANT UPDATE (settlement_id, settled_at) ON bill_person   TO halves_app;
    GRANT SELECT, INSERT                 ON line_item_person  TO halves_app;
    GRANT SELECT, INSERT                 ON pin_throttle      TO halves_app;
    GRANT UPDATE (wrong)                 ON pin_throttle      TO halves_app;
    GRANT SELECT, INSERT                 ON settlement        TO halves_app;
    GRANT SELECT, INSERT                 ON scan_request      TO halves_app;
    GRANT SELECT, INSERT, DELETE         ON receipt_photo     TO halves_app;
    GRANT UPDATE (exported_at)           ON receipt_photo     TO halves_app;
  END IF;
END $$;

-- PRD 10.4: row-level security on every bill table. The app sets app.person_id for each query
-- (lib/db.ts); a query without it sees nothing. Policies back up the WHERE filters; parameterised
-- queries stay the defence against injection. The owner role (migrations) bypasses them.
ALTER TABLE bill              ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_person       ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item         ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_person  ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_photo     ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_request      ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bill_select ON bill;
CREATE POLICY bill_select ON bill FOR SELECT USING (added_by = app_person() OR is_member(id)); -- the adder is checked on the row itself: an INSERT ... RETURNING cannot see its own new row through is_member
DROP POLICY IF EXISTS bill_insert ON bill;
CREATE POLICY bill_insert ON bill FOR INSERT WITH CHECK (added_by = app_person());
-- The only update left is photo_state = 'archived' (the admin's photo export): the admin, on the bill.
DROP POLICY IF EXISTS bill_update ON bill;
CREATE POLICY bill_update ON bill FOR UPDATE
  USING (is_member(id) AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin'))
  WITH CHECK (is_member(id) AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin'));

DROP POLICY IF EXISTS bill_person_select ON bill_person;
CREATE POLICY bill_person_select ON bill_person FOR SELECT USING (is_member(bill_id));
DROP POLICY IF EXISTS bill_person_insert ON bill_person;
CREATE POLICY bill_person_insert ON bill_person FOR INSERT WITH CHECK (is_adder(bill_id));
DROP POLICY IF EXISTS bill_person_update ON bill_person;
CREATE POLICY bill_person_update ON bill_person FOR UPDATE
  USING (person_id = app_person() OR EXISTS (SELECT 1 FROM bill b WHERE b.id = bill_id AND b.payer_id = app_person()))
  -- A share may only be given a round between this share's person and the bill's payer.
  WITH CHECK ((person_id = app_person() OR EXISTS (SELECT 1 FROM bill b WHERE b.id = bill_id AND b.payer_id = app_person()))
    AND (settlement_id IS NULL OR round_fits(settlement_id, bill_id, person_id)));

DROP POLICY IF EXISTS line_item_select ON line_item;
CREATE POLICY line_item_select ON line_item FOR SELECT USING (is_member(bill_id));
DROP POLICY IF EXISTS line_item_insert ON line_item;
CREATE POLICY line_item_insert ON line_item FOR INSERT WITH CHECK (is_adder(bill_id));

DROP POLICY IF EXISTS line_item_person_select ON line_item_person;
CREATE POLICY line_item_person_select ON line_item_person FOR SELECT USING (is_member(line_bill(line_item_id)));
DROP POLICY IF EXISTS line_item_person_insert ON line_item_person;
CREATE POLICY line_item_person_insert ON line_item_person FOR INSERT WITH CHECK (is_adder(line_bill(line_item_id)));

DROP POLICY IF EXISTS receipt_photo_select ON receipt_photo;
CREATE POLICY receipt_photo_select ON receipt_photo FOR SELECT USING (is_member(bill_id));
DROP POLICY IF EXISTS receipt_photo_insert ON receipt_photo;
CREATE POLICY receipt_photo_insert ON receipt_photo FOR INSERT WITH CHECK (is_adder(bill_id));
-- Stamping and deleting a photo is the admin's export: the admin, on the bill.
DROP POLICY IF EXISTS receipt_photo_update ON receipt_photo;
CREATE POLICY receipt_photo_update ON receipt_photo FOR UPDATE
  USING (is_member(bill_id) AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin'))
  WITH CHECK (is_member(bill_id) AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin'));
DROP POLICY IF EXISTS receipt_photo_delete ON receipt_photo;
CREATE POLICY receipt_photo_delete ON receipt_photo FOR DELETE
  USING (is_member(bill_id) AND EXISTS (SELECT 1 FROM person a WHERE a.id = app_person() AND a.role = 'admin'));

DROP POLICY IF EXISTS settlement_select ON settlement;
CREATE POLICY settlement_select ON settlement FOR SELECT USING (app_person() IN (person_low_id, person_high_id));
DROP POLICY IF EXISTS settlement_insert ON settlement;
CREATE POLICY settlement_insert ON settlement FOR INSERT
  WITH CHECK (settled_by = app_person() AND app_person() IN (person_low_id, person_high_id));

DROP POLICY IF EXISTS scan_request_select ON scan_request;
CREATE POLICY scan_request_select ON scan_request FOR SELECT USING (person_id = app_person());
DROP POLICY IF EXISTS scan_request_insert ON scan_request;
CREATE POLICY scan_request_insert ON scan_request FOR INSERT WITH CHECK (person_id = app_person());

DROP POLICY IF EXISTS push_subscription_select ON push_subscription;
CREATE POLICY push_subscription_select ON push_subscription FOR SELECT USING (person_id = app_person());
-- No insert or update policy: save_push (a database function) writes subscriptions. The two drops
-- remove what an earlier run of this file created.
DROP POLICY IF EXISTS push_subscription_insert ON push_subscription;
DROP POLICY IF EXISTS push_subscription_update ON push_subscription;
DROP POLICY IF EXISTS push_subscription_delete ON push_subscription;
CREATE POLICY push_subscription_delete ON push_subscription FOR DELETE USING (person_id = app_person());
