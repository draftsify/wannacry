import type { Metadata } from "next";
import { ReactNode } from "react";
import { Providers } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "WannaCry — allocation network",
  description:
    "Main Token trading fees fund epoch allocations. Holders direct their own allocation, and the resulting propagation graph is derived from confirmed on-chain transactions.",
};

/**
 * Root layout carries only what both surfaces need. The chrome lives in the two
 * route-group layouts because the marketing page and the explorer are opposite
 * visual systems — one light and quiet, one dark and dense — and sharing a shell
 * between them would mean fighting it in every rule.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
