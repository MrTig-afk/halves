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

-- The app role (created once at setup, no DDL rights) gets exactly what the PRD allows.
-- Saved bills are immutable: bills only gain a settlement or an archived
-- photo; line items and settlements are insert-only. Everything is revoked first so
-- the grants below are the whole truth; skipped when the role does not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'halves_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM halves_app;
    GRANT USAGE ON SCHEMA public TO halves_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO halves_app;
    GRANT SELECT, INSERT, UPDATE         ON person            TO halves_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON device_session    TO halves_app;
    GRANT SELECT, INSERT, DELETE         ON push_subscription TO halves_app;
    GRANT SELECT, INSERT                 ON bill              TO halves_app;
    GRANT UPDATE (settlement_id, photo_state) ON bill         TO halves_app;
    GRANT SELECT, INSERT                 ON line_item         TO halves_app;
    GRANT SELECT, INSERT                 ON settlement        TO halves_app;
    GRANT SELECT, INSERT                 ON scan_request      TO halves_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_photo     TO halves_app;
  END IF;
END $$;
