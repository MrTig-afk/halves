// The admin's monthly photo export: what is kept, a zip of it, and deleting exactly what was zipped
// once the admin confirms it saved. Only photos of bills the admin is on: a bill's photo is visible
// to the people on its bill only (a bill the admin is not on keeps its photo).
//
// An export is named by a token from the admin's phone (the time Download was pressed). Only once
// the whole zip, directory included, has been read from the stream are its photos stamped with that
// token (exported_at), and "Yes, delete them here" deletes only photos carrying it - so a download
// the server did not finish sending deletes nothing, and a bill saved meanwhile keeps its photo. The
// server cannot see whether the bytes reached the laptop; the admin's "Did it save?" is that check.
import { query } from "./db";
import type { ZipEntry } from "./zip";

// Photos are kept only while the database is under 400 MB, so they can never fill the free 0.5 GB
// and stop bills from saving.
export const PHOTO_CAP_BYTES = 400 * 1024 * 1024;

export type PhotoSummary = { count: number; bytes: number; upto: number | null; db_bytes: number };

const MINE = "join bill b on b.id = p.bill_id where exists (select 1 from bill_person m where m.bill_id = b.id and m.person_id = $1)";

export async function photoSummary(me: number): Promise<PhotoSummary> {
  const [s] = await query<PhotoSummary>(
    `select count(*)::int as count, coalesce(sum(p.byte_size), 0)::float8 as bytes, max(p.id)::int as upto,
            pg_database_size(current_database())::float8 as db_bytes
     from receipt_photo p ${MINE}`,
    [me],
    me,
  );
  return s;
}

type Listed = { id: number; bill_id: number; bill_date: string; description: string; taken: string };

// The photos an export will contain, listed before any byte is sent (so a database error is an
// error, not a broken zip).
export const listPhotos = (me: number, upto: number) =>
  query<Listed>(
    `select p.id::int, p.bill_id::int, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date, b.description,
            to_char(p.created_at at time zone 'Australia/Sydney', 'YYYY-MM-DD"T"HH24:MI:SS') as taken
     from receipt_photo p ${MINE} and p.id <= $2 order by p.id`,
    [me, upto],
    me,
  );

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "bill";

// The listed photos, ten per database round trip, named <date>_<bill id>_<description>.jpg and
// dated on the roommates' clock. Each one handed over is added to `sent`.
export async function* exportPhotos(list: Listed[], sent: number[]): AsyncGenerator<ZipEntry> {
  for (let i = 0; i < list.length; i += 10) {
    const batch = list.slice(i, i + 10);
    const rows = await query<{ id: number; jpeg: Buffer }>("select id::int, jpeg from receipt_photo where id = any($1::bigint[])", [
      batch.map((p) => p.id),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r.jpeg]));
    for (const p of batch) {
      const jpeg = byId.get(p.id);
      if (!jpeg) continue; // archived by another export meanwhile
      sent.push(p.id);
      // The wall-clock time in Sydney, carried in the UTC fields the zip writer reads.
      yield { name: `${p.bill_date}_${p.bill_id}_${slug(p.description)}.jpg`, data: jpeg, date: new Date(`${p.taken}Z`) };
    }
  }
}

// After the whole zip has been sent: its photos carry the export's token. A later-started export
// wins, so an older download finishing last does not take its photos away from the newer one.
export const stampExport = (ids: number[], token: number) =>
  query(
    `update receipt_photo set exported_at = to_timestamp($2::float8 / 1000)
     where id = any($1::bigint[]) and (exported_at is null or exported_at < to_timestamp($2::float8 / 1000))`,
    [ids, token],
  );

// After the admin confirmed the zip saved: exactly the photos of that finished export are deleted,
// and their bills say "photo archived".
export async function archiveExport(me: number, upto: number, token: number): Promise<number> {
  const [r] = await query<{ deleted: number }>(
    `with ph as (
       select p.id, p.bill_id from receipt_photo p ${MINE}
         and p.id <= $2 and p.exported_at = to_timestamp($3::float8 / 1000)
     ),
     b as (update bill set photo_state = 'archived' where id in (select bill_id from ph) returning 1),
     d as (delete from receipt_photo where id in (select id from ph) returning 1)
     select (select count(*) from d)::int as deleted`,
    [me, upto, token],
    me,
  );
  return r.deleted;
}
