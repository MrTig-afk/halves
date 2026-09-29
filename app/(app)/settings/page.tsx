import { cookies } from "next/headers";
import Link from "next/link";
import { Appearance } from "@/components/Appearance";
import { SignOutButton } from "@/components/SignOutButton";
import { initial } from "@/lib/names";
import { people } from "@/lib/people";
import { photoSummary } from "@/lib/photos";
import { requirePerson } from "@/lib/session";
import { readTheme, THEME_COOKIE } from "@/lib/theme";

export const metadata = { title: "Settings - Halves" };

// Settings (F1). Admin-only rows appear with their screens.
export default async function Settings({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const me = await requirePerson();
  const done = (await searchParams).done;
  const admin = me.role === "admin";
  const [everyone, photos] = admin ? await Promise.all([people(), photoSummary(me.id)]) : [[], null];
  const count = everyone.length;
  const toExport = photos?.count ?? 0;
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <span className="ttl">Settings</span>
      </div>
      <div className="body">
        {done === "pin" && (
          <div className="banner ok" role="status">
            Your PIN is changed.
          </div>
        )}
        <div className="list">
          <div className="li">
            <span className="av" data-admin={me.role === "admin" ? "" : undefined}>
              {initial(me.name)}
            </span>
            <div className="grow">
              <b>{me.name}</b>
              {me.role === "admin" && <div className="xs dim">Admin</div>}
            </div>
          </div>
          <div className="li">
            <span className="grow">Appearance</span>
            <Appearance initial={readTheme((await cookies()).get(THEME_COOKIE)?.value)} />
          </div>
          <Link href="/settings/pin" className="li">
            <span className="grow">Change PIN</span>
            <span className="dim">›</span>
          </Link>
          {admin && (
            <Link href="/settings/people" className="li">
              <span className="grow">People</span>
              <span className="dim small">{count} ›</span>
            </Link>
          )}
          {admin && (
            <Link href="/settings/photos" className="li">
              <span className="grow">Photos</span>
              <span className="dim small">{toExport ? `${toExport} to export` : "Nothing to export"} ›</span>
            </Link>
          )}
          <div className="li">
            <SignOutButton />
          </div>
        </div>
      </div>
    </main>
  );
}
