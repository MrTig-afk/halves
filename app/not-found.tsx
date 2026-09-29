import Link from "next/link";

export const metadata = { title: "Page not found - Halves" };

export default function NotFound() {
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="logo">
          <span className="mark" />
          Halves
        </Link>
      </div>
      <div className="center">
        <b>Page not found</b>
        <span className="dim small">That link doesn&apos;t go anywhere in Halves.</span>
      </div>
      <div className="foot">
        <Link href="/" className="btn">
          Go to Home
        </Link>
      </div>
    </main>
  );
}
