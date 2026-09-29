# Halves (AI bill splitter and running tab) - PRD

Status: APPROVED v2.2 - owner 2026-09-29 19:01: "I approve the artifact and the
PRD". Supersedes APPROVED v1.4 (2026-09-29 18:18).
Why v2: Splitwise's API requires a paid Splitwise Pro subscription to register
any application (owner's screenshot of secure.splitwise.com/apps, 2026-09-29),
which breaks the $0 rule (10.1). The owner chose to drop Splitwise and keep a
running tab in Halves: "when they decide to tally it up they can just hit
settle ... and everything gets cleared" (owner 2026-09-29).
Owner: Kaushik. Decisions are dated; "owner 2026-09-29" marks an explicit
owner answer.
Master Artifact: https://claude.ai/artifact/PTn73o41wuT3xSzacujfMv
(local source `design/userflow.artifact.html`).

## 1. Problem and context

Roommates who share groceries and meals rarely split each bill on the spot.
Receipts pile up, and sorting out who owes what later means re-reading every
receipt line by line.

Halves turns each receipt photo into a split as it happens - the payer chooses
each item's share by tap or by voice - and keeps a running tab between the two
people. Bills from either side net against each other ("Priya owes you
$42.10"). When they decide to tally up, one "Settle all" clears the tab to
zero for both. Halves keeps every bill with its photo. It costs nothing to run
(10.1).

## 2. Goals

- G1. Reading a receipt takes at most 5 seconds, from tapping Read items to
  the item list on screen (owner 2026-09-29).
- G2. Each item's share is set by tap (3-way slider), by an All shortcut, or
  by one spoken sentence.
- G3. Every voice change is visibly confirmed: affected sliders animate to
  their new position and the user keeps or undoes the change.
- G4. Both people always see the same running balance, updated the moment a
  bill is saved, and one "Settle all" clears it to $0.00 for both.
- G5. Nobody sees a bill they are not on.
- G6. Running cost is $0, permanently.

## 3. Non-goals

- Splitwise integration of any kind: its API requires Splitwise Pro
  (2026-09-29). (Superseded: v1.4's "send to Splitwise".)
- Partial payments, per-bill settling, payment integrations (PayPal, bank),
  reminders to pay. Settling is all-or-nothing (owner 2026-09-29).
- Any paid tier, trial or add-on on any service (10.1). Not v2 - never.
- Email, Google, Apple or password sign-in. Sign-in is PIN tiles (6.1).
- Groups and bills between 3+ people (v2).
- "Paid by" the other person: the uploader is always the payer.
- Exact-amount or percentage splits; multiple payers. Only the three shares
  (mine, half, partner's).
- Categories, search/filter, charts, CSV export; multi-currency.
- Offline bill entry (receipt reading needs the network).
- Commercial use (Vercel Hobby terms forbid it).
- Tailscale / private-network-only access (parked, 13).

## 4. Users

- Two people at launch (roommates): the owner and one partner. More can be
  added (6.1); each bill still has exactly two people (6.3), and each pair of
  people has its own tab.
- The owner is the admin (owner 2026-09-29): only the admin adds people and
  resets a PIN. The admin signs in with a PIN tile like everyone else; the
  owner's email is stored on the admin person as a contact only.
- Either person can scan a bill they paid, and either can press Settle all.
- A user sees only the bills and settlements they are on (6.2).

## 5. User flow

The master Artifact is the authority for what each screen shows.

1. Open the URL. A signed-in device goes straight to Home. Otherwise the
   Sign-in screen: one tile per person.
2. Tap your tile. Claimed: 4-digit PIN (3 wrong = 5-minute lock). Unclaimed:
   choose a PIN (twice).
3. Home:
   - Balance card: "Priya owes you $42.10" (green) / "You owe Priya $12.00"
     (orange) / "All settled up", with "Settle all" when not zero.
   - "Open bills": every unsettled bill you are on, newest first.
   - "Settled": past settlements ("Settled $86.20 · 12 Oct"), each opening
     the bills it cleared.
   - Scan a bill, the Settings gear (top right), "Signed in as <name>".
   - Day one: "No bills yet" + Scan a bill + an install card.
4. Scan -> 5. Crop -> 6. Reading (at most 5 s; errors: unreadable, AI limit)
   -> 7. Review (description, date, partner, 3-way sliders, All shortcuts,
   mic, live "<Partner> owes you $X") -> 8. Voice (transcript, animated
   sliders, Keep / Undo). Unchanged from v1.4.
9. Save: the bill is saved and added to the tab. Screen: "Saved", this bill's
   amount and the new balance ("Priya now owes you $42.10"), Scan another /
   Done. The partner gets a push: "Kaushik added a bill".
10. Bill: photo, items with shares, who owes what, "Open" or "Settled on
    <date>". Read-only for both people: no Edit, no Delete (owner 2026-09-29:
    "They only can settle it, that's all"). Mistakes are fixed on the review
    screen before Save.
11. Settle all: a confirm sheet - "Settle up with Priya? Priya pays you
    $42.10. This clears the balance to $0.00 for both of you." - Settle /
    Cancel. Then Home shows "All settled up"; the partner gets "Kaushik settled
    up - $42.10". The cleared bills move under Settled.
12. Admin (Settings): People (add a person, reset a PIN), Photos (monthly zip
    export, then delete). Everyone: Appearance (System / Light / Dark),
    Notifications, Change PIN, Sign out.
13. Install: an install card on phones; installed, the app opens standalone
    and can receive push (iPhone needs it installed).

## 6. Functional requirements

### 6.1 Sign-in and people

- No email, Google, Apple or password. One tile per person; tap yours.
- SECURITY REQUIREMENT: a tile tap alone is not a login. Each tile is gated by
  a per-person 4-digit PIN on first use per device; the device then stays
  signed in via a signed httpOnly session cookie until Sign out.
- PINs are stored hashed (a slow password hash), never plain, never logged.
- Lockout: 3 wrong attempts lock that tile for 5 minutes, counted server-side
  (owner 2026-09-29). ACCEPTED RISK: about 864 guesses a day.
- New person: the admin adds a name; an unclaimed tile appears; the first
  person to tap it sets its PIN (owner 2026-09-29). ACCEPTED RISK: anyone
  holding the URL while a tile is unclaimed can claim it.
- The admin can reset a tile to unclaimed. Removing a person is not in v1.
- The admin is seeded with a PIN from a one-time server environment value;
  the partner's tile is seeded unclaimed with a name from the environment.
- Change PIN from Settings requires the current PIN.

Acceptance: three wrong PINs return 423 and the tile shows the unlock time; a
correct PIN during lockout is refused; PIN hashes never appear in any response
or log; a non-admin calling an admin route gets 403.

### 6.2 Visibility and isolation

- A bill, its items and photo, and a settlement are visible only to its two
  people. Every read and write is scoped by the session's person id on the
  server. A record the person is not on returns 404.

Acceptance: an automated test with three people A, B, C proves C gets 404 on
every bill, item, photo and settlement route for an A-B record, and that C's
Home shows no A-B balance or bill.

### 6.3 Bills and the split rule

- The uploader is the payer. Each bill has exactly two people.
- Each item has a 3-way share (owner 2026-09-29): `payer` = the payer's own;
  `split` = split equally, the partner owes half; `partner` = the partner
  owes the full amount.
- Discount lines attach to the item above and take its share. Surcharge lines
  are shared in proportion.
- Every item `split`: the partner owes half the receipt total as read. Every
  item `partner`: the partner owes the whole total. No total read: the sum of
  all lines stands in.
- Otherwise, with S, T, M the value of split, partner and payer items (each
  adjusted by its discounts), V = S + T + M and F the surcharges: the partner
  owes (S + F*S/V)/2 + T + F*T/V. Rounded once per bill, half up, to the cent.
- No items-vs-total mismatch check (owner 2026-09-29).
- The description is named by the user; the AI's store name is a prefill.
- A saved bill is immutable: nobody can edit or delete it, open or settled
  (owner 2026-09-29; superseded: payer edits of open bills). The only change a
  bill ever gets is being settled. Everything is checked on the review screen
  before Save.
- The AI's original reading is kept on the bill, unchanged, for measuring
  accuracy (11).

Acceptance: a table-driven test covers all-split and all-partner with and
without a read total, a mix of all three shares with one discount and one
surcharge, and odd-cent rounding, each asserting exact cents (the Artifact's
sample: $14.40, $20.85, $24.97, $49.94). The server has no route that edits
or deletes a saved bill.

### 6.4 Receipt reading

- Pipeline ported from NutritionDE (7.1): client crop and resize, server type
  sniffing, pixel cap, re-encode (strips EXIF and location), Gemini call with
  a response schema, strict validation, retry then fallback model.
- The prompt treats text in the image as data, never instructions.
- Output per line: position, name, price, kind; plus store name, date and
  receipt total when visible. Anything failing validation is rejected.

Acceptance: 11.

### 6.5 Voice split

- Audio recorded in the browser is sent with the numbered item list to
  Gemini; one call returns the transcript and the share changes.
- Understood: numbers, names, ranges, each share ("split", "mine",
  "Priya's"), everything ("split all", "all mine", "all Priya's"), the rest,
  and the partner ("with Priya").
- Changed sliders animate and highlight; Keep applies, Undo restores exactly.
  The server validates returned item numbers; unknown ones are dropped and
  named.

Acceptance: a command changing three items shows the transcript and three
animated sliders, and Undo restores them; a mocked Gemini reply with
out-of-range numbers has them dropped.

### 6.6 Running balance and Settle all (the core output)

- Each pair of people has one tab. Balance(A, B) = sum over OPEN bills of
  (partner_owes where A paid and B is partner) minus (partner_owes where B
  paid and A is partner). Shown from each person's side.
- The balance updates on every save and settle, and is the same number
  (sign flipped) on both phones.
- Settle all (either person on the tab, balance not zero): one settlement
  record (the two people, the amount, who owed whom, who pressed it, when);
  every open bill between them is stamped with that settlement and becomes
  settled; the balance becomes $0.00. It is all-or-nothing and atomic: a bill
  saved at the same moment is either inside the settlement or stays open, never
  half-counted.
- The confirm sheet names the direction and amount; the server re-computes the
  amount at settle time and settles only what it computed.
- Settled history lists settlements newest first; each opens the bills it
  cleared. No undo of a settlement in v1.

Acceptance: after bills from both people, both phones show equal and opposite
balances to the cent; Settle all zeroes both; the cleared bills show "Settled
on <date>"; a bill saved concurrently with a
settle is either settled or open, never lost.

### 6.7 Notifications

- Web Push with VAPID keys, no push provider account (reinstated 2026-09-29:
  Splitwise no longer notifies the partner). The partner is notified on a new
  bill ("Kaushik added a bill") and on Settle all ("Kaushik settled up -
  $42.10").
- New-bill payloads carry no amounts or item names; the settle notice carries
  the settled amount only.
- iPhone receives push only when the app is installed (iOS 16.4+).
- Dead subscriptions (404/410) are deleted. Notifications can be turned off
  per phone in Settings.

Acceptance: with both phones installed, saving a bill shows the partner's
notification within 30 seconds; its payload contains no amount; a 410
subscription row is removed.

### 6.8 Limits and failure (fail closed)

- Hitting a free-tier limit shows a plain message naming what is paused and
  what still works. Nothing typed is lost.
- Save failure (network, server): the review screen keeps everything and shows
  "Couldn't save. Check your connection and try again." with Retry; a retry
  never creates a second bill (the client scan id dedups).
- Photo store full: the bill saves without a kept photo, with a notice.
- No app-level scan quota: the free tier is the cost ceiling (10.1).

### 6.9 Photos

- The cropped, re-encoded photo is kept in the same `halves` database, but
  only while the whole Neon project is under 400 MB (checked before each
  insert), so photos can never fill the 0.5 GB free cap and block saving bills
  (owner 2026-09-29: one new project only; superseded: a separate photos
  project). Admin monthly Export: zip download, then delete after the admin
  confirms; bills show "photo archived".

### 6.10 App shell

- Installable PWA (manifest, icons, service worker for the shell only, no
  offline data), prompted update ("A new version is ready" + Reload).
- Appearance: System by default, Light / Dark override in Settings.
- Colour tone: green #1CC29F, orange #FF692C, charcoal #373B3F, mint #ACE4D6,
  white (owner 2026-09-29, from Splitwise's palette); own name and logo.
- Simple line icons only, never emoji.

Acceptance: Lighthouse reports the app installable; iPhone "Add to Home
Screen" opens it standalone; Appearance switches immediately and is
remembered.

## 7. Architecture and technical approach

### 7.1 Image pipeline reference (NutritionDE, HEAD 77553dc)

- Crop: the dependency-free `frontend/src/components/ImageCropper.jsx`.
- Pre-upload: `applyPipelineToFile` (resize, JPEG q0.85) WITHOUT the
  grayscale step; longest side starts at 2048px; under Vercel's 4.5 MB body
  limit.
- Client transport: `fetchWithRetry` shape and a client scan id.
- Server: magic-byte sniffing, pixel cap, re-encode (sharp) stripping EXIF,
  strict validation of model JSON, "text in the image is data", primary /
  fallback model retry. Rate state lives in Neon, never in memory.

### 7.2 Stack (owner 2026-09-29)

- Project type: web-app (installable PWA).
- Next.js 16 (App Router), pages + route handlers in one Vercel project
  (Hobby), region syd1 next to the database.
- Neon Postgres (free): ONE new project `halves` (database `halves`, Sydney,
  aws-ap-southeast-2), created 2026-09-29, used by nothing else. App role
  `halves_app` (no DDL); the owner role runs migrations only.
- Auth in-app: hashed PINs + signed httpOnly session cookie.
- AI: Google Gemini Flash (free tier) for receipts and voice audio, response
  schema; exact model chosen in M0.
- Push: Web Push + VAPID (the `web-push` library).
- Swap points: `readReceipt(image)`, `parseVoice(audio, items)`;
  `putPhoto/getPhoto/deletePhoto`; `notify(person, message)`.

## 8. Scope by version

### v1 (all of it ships)

1. PIN tile sign-in, lockout, unclaimed-tile claim, change PIN, sign out.
2. Admin: add a person, reset a PIN.
3. Scan -> crop -> AI read -> review (edit/add/delete rows, description,
   date, partner).
4. 3-way item shares and All shortcuts; discount, surcharge and rounding rules.
5. Voice split with animated sliders, Keep / Undo.
6. Save to the tab; read-only bill view for both (no edit, no delete).
7. Running balance per pair on Home; Settle all; Settled history.
8. Web Push on new bill and on settle; per-phone toggle.
9. Photos kept (separate Neon project); admin monthly Export + delete.
10. Installable PWA; Appearance; line icons.
11. Tests: isolation (6.2), split math (6.3), balance and settle (6.6),
    accuracy fixtures (11).

### v2

Groups and 3+ person bills, partial payments, photos moved to the owner's
laptop.

## 9. Data model

Money is integer cents. Currency: AUD only (assumed, 13).

### 9.1 Entities (app database)

- person: id, name, role, email (admin only), pin_hash (null = unclaimed),
  failed_pin_count, locked_until, claimed_at, created_at.
- device_session: id, person_id, created_at, last_seen_at.
- push_subscription: id, person_id, endpoint (unique), p256dh, auth,
  created_at.
- bill: id, payer_id, partner_id, description, bill_date,
  receipt_total_cents (null = not read), total_cents, partner_owes_cents,
  ai_items (JSON), photo_state, settlement_id (null = open), created_at.
  Rows are never updated except to set settlement_id (Settle all) and
  photo_state (photo kept / archived, 6.9); the database role enforces this.
- line_item: id, bill_id, position, name, price_cents (negative for a
  discount), kind, share.
- settlement: id, person_low_id, person_high_id (the pair, ordered by id),
  amount_cents, from_person_id (who owed), to_person_id, settled_by,
  created_at.
- scan_request: scan_id (client-generated, unique), person_id, created_at.

### 9.2 Photos (same database, 400 MB project cap - 6.9)

- receipt_photo: id, bill_id, jpeg (bytes), byte_size, exported_at,
  created_at.

### 9.3 Enumerations (complete lists)

- person.role: `admin`, `member`.
- bill.photo_state: `none`, `kept`, `not_kept_full`, `archived`.
- line_item.kind: `item`, `discount`, `surcharge`.
- line_item.share: `payer`, `split`, `partner` (discounts take their item's
  share; surcharges have none).
- A bill is open when `settlement_id` is null and settled otherwise; there is
  no separate status field (reading and review happen before the bill row
  exists).

## 10. Security and privacy

### 10.1 Zero cost - HARD REQUIREMENT (owner 2026-09-29: "I WILL PAY NOTHING")

- Every service runs on a free tier that BLOCKS at its limit rather than
  BILLS past it. No payment method on any account; no paid tier, trial or
  add-on. A design that needs a paid tier is out of scope, not v2 - this is
  why Splitwise was dropped.
- Free tiers (researched 2026-09-29): Vercel Hobby (personal,
  non-commercial); Neon Free (0.5 GB per project, writes blocked when full,
  nothing billed); Gemini API free tier (image and audio; limits recorded in
  M0); Web Push (free, no provider).
- VERIFY BEFORE RELYING: any new third-party service or API is checked on its
  own signup or pricing page before it is written into this PRD as free. (Added
  2026-09-29 after the Splitwise API was wrongly recorded as free from a docs
  summary.)
- The reused Gemini key must be on a project with no billing attached (owner
  to confirm in AI Studio).

### 10.2 What leaves the app

- To Google Gemini: the cropped, EXIF-stripped receipt image; the voice clip
  and the bill's item names. Free-tier content may be used by Google -
  ACCEPTED by the owner 2026-09-29.
- To the browser push service (Apple / Google): "<name> added a bill", or
  "<name> settled up - $X". No items, no per-bill amounts.
- Nothing else leaves. PINs, session secrets, the Gemini key and the VAPID
  private key live only in server environment variables or as hashes; never
  in the client bundle, logs, commits or responses.

### 10.3 Trust boundaries and failure

- Every server route re-checks the session, the 6.2 scope and admin role;
  saved bills have no edit or delete route at all. The client is never
  trusted.
- Uploads: type by magic bytes, size and pixel caps before decode,
  re-encoded; originals never stored or forwarded.
- Model output is untrusted: schema-validated, item numbers checked.
- Fail closed: no valid session -> sign-in; validation failure -> error, not
  a guess.

## 11. Success metrics

- North Star: receipt accuracy. Of the owner's first 10 real scans, all 10
  need zero AI-caused corrections - owner 2026-09-29: "All 10 perfect".
  Measured by comparing each bill's `ai_items` with its saved lines; the scans
  become a gitignored local fixture test that must stay at 10/10.
- Read time at most 5 s (G1), p90 over the owner's scans, recorded in server
  logs only - never shown in the UI.
- Both phones show the same balance after every save and settle (6.6 test).
- Zero bills visible to a third person (6.2 test).

## 12. Milestones

- M0 - Prove the risky chain. Deployed Vercel URL: photo -> crop -> Gemini ->
  item list on screen, read time logged (public sample receipts). Neon
  connected. Gemini free-tier limits recorded.
- M1 - The tab, end to end. PIN tiles + lockout; the seeded people; review
  with 3-way shares, All shortcuts and voice; Save; running balance; Settle
  all; read-only bill view; photo kept; isolation,
  split-math and settle tests. The owner starts scanning real receipts here.
- M2 - Phone app and admin. PWA install, Web Push, Appearance, People (add,
  reset), photo export.
- M3 - Accuracy. The 10-scan fixture test, tuned to 10/10.

## 13. Open questions

1. Partner's real name for the seeded tile - set in `.env` by the owner
   (done 2026-09-29).
2. Currency: AUD assumed. Recommendation: AUD only.
3. Tailscale: parked.
4. G1 at 5 s is tight on a free model over a phone connection; M0 measures
   it. Recommendation: accuracy wins if they conflict.
5. A wrong bill cannot be removed once saved; it stays on the tab until the
   next Settle all (owner's rule). Recommendation: accept; revisit if it bites.
6. Undo a settlement: not in v1. Recommendation: add only if a wrong settle
   ever happens.

## 14. Appendix

- Glossary: payer, partner, tile, unclaimed, tab (the running balance
  between two people), settle all (clearing a tab).
- Superseded on 2026-09-29: Google sign-in; Supabase; Vercel Blob; the binary
  toggle; Splitwise sync (v1.0-v1.4, dropped in v2.0 because its API needs
  Pro); "no Halves notifications" (v1.4, reversed in v2.0).
- Reference: NutritionDE `ScanTab.jsx`, `ImageCropper.jsx`, `nutrition.js`,
  `api.js`, `backend/main.py`, `backend/tests/test_image_upload.py`.
