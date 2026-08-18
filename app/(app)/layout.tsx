import Link from "next/link";
import { ReactNode } from "react";

/** The explorer shell: dark, dense, monospaced. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top">
        <div className="inner">
          <Link href="/" className="brand">
            <b>PATIENT ZERO</b>
            <span>allocation network</span>
          </Link>
          <nav className="links">
            <Link href="/network">network</Link>
            <Link href="/agent">your agent</Link>
          </nav>
        </div>
      </header>
      <div className="shell">{children}</div>
    </div>
  );
}
