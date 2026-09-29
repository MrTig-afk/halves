import Link from "next/link";
import { Icon } from "@/components/Icon";
import { currentPerson } from "@/lib/session";

// Stand-in Home until the real one (the tab, open bills, Settle all) is built.
export default async function Home() {
  const me = await currentPerson();
  return (
    <main className="screen">
      <div className="bar">
        <span className="logo">
          <span className="mark" />
          Halves
        </span>
      </div>
      <div className="center">
        <div className="icon-art">
          <span className="mark" style={{ width: 44, height: 44 }} />
        </div>
        <b>No bills yet</b>
        <span className="dim small">Scan a receipt, crop it to the items and see what Halves reads.</span>
      </div>
      <div className="foot">
        <Link href="/scan" className="btn o">
          <Icon name="camera" /> Scan a bill
        </Link>
        <div className="me">Signed in as {me?.name}</div>
      </div>
    </main>
  );
}
