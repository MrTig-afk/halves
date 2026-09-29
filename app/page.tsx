import Link from "next/link";
import { Icon } from "@/components/Icon";

// M0 stand-in for Home: the real Home (the tab, open bills, Settle all) is T1.6.
export default function Home() {
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
      </div>
    </main>
  );
}
