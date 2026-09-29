import Link from "next/link";
import { Icon } from "@/components/Icon";

// E7: the same screen (and a 404) whether the bill does not exist or is not shared with you.
export default function BillNotFound() {
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="logo">
          <span className="mark" />
          Halves
        </Link>
      </div>
      <div className="center">
        <div className="icon-art">
          <Icon name="search" size={34} />
        </div>
        <b>Bill not found</b>
        <span className="dim small">It may have been deleted, or it isn&apos;t shared with you.</span>
      </div>
      <div className="foot">
        <Link href="/" className="btn">
          Go to Home
        </Link>
      </div>
    </main>
  );
}
