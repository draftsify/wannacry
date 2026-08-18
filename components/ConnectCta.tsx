"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { short } from "@/lib/format";

/**
 * Wallet connection for the landing page.
 *
 * Connecting here is read-only and proves nothing on its own — the signature
 * that establishes control of the wallet happens in the agent console. This
 * button exists so someone can attach their wallet from the front door and
 * carry that connection through, not so the landing can act on their behalf.
 *
 * Rendered only after mount: the adapter reads browser extension state, and
 * server-rendering a "not connected" button that immediately swaps to a
 * connected one is a hydration mismatch.
 */
export function ConnectCta({ variant = "hero" }: { variant?: "hero" | "nav" }) {
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span className={variant === "nav" ? "connect-slot is-nav" : "connect-slot"} aria-hidden="true" />
    );
  }

  if (variant === "nav") {
    return (
      <span className="connect-slot is-nav">
        <WalletMultiButton />
      </span>
    );
  }

  return (
    <div className="connect-hero">
      <div className="cta">
        <WalletMultiButton />
        {connected && (
          <Link href="/agent" className="btn btn-primary">
            Open your agent
          </Link>
        )}
      </div>
      <p className="connect-status">
        {connected && publicKey
          ? `Connected as ${short(publicKey.toBase58(), 5)} — nothing has been authorized yet.`
          : "Connecting is read-only. Nothing moves until you sign, twice."}
      </p>
    </div>
  );
}
