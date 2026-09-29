import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoExport } from "@/components/PhotoExport";
import { localDate } from "@/lib/names";
import { PHOTO_CAP_BYTES, photoSummary } from "@/lib/photos";
import { requirePerson } from "@/lib/session";

export const metadata = { title: "Photos - Halves" };

// Photos export (F5), admin only.
export default async function Photos() {
  const me = await requirePerson();
  if (me.role !== "admin") notFound();
  const s = await photoSummary(me.id);
  const month = localDate(new Date().toISOString()).slice(0, 7);
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/settings" className="back">
          ‹ Settings
        </Link>
        <span className="ttl">Photos</span>
      </div>
      {s.count === 0 || s.upto === null ? (
        <div className="center">
          <b>Nothing left to export</b>
          <span className="dim small">New receipt photos will show up here.</span>
        </div>
      ) : (
        <PhotoExport
          count={s.count}
          megabytes={(s.bytes / 1048576).toFixed(1)}
          usedPercent={Math.min(100, Math.round((s.db_bytes / PHOTO_CAP_BYTES) * 100))}
          upto={s.upto}
          file={`halves-photos-${month}.zip`}
        />
      )}
    </main>
  );
}
