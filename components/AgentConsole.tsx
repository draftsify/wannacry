"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import Link from "next/link";
import { ago, displaySymbol, short, solFromLamports, tokenAmount } from "@/lib/format";

/**
 * The agent console.
 *
 * The agent prepares, explains and executes. It never chooses. Every path to
 * spending capital runs through two explicit wallet approvals — one for the
 * authorization text, one for the transaction itself — and there is no code path
 * that spends without both.
 */

const MAIN_MINT = process.env.NEXT_PUBLIC_MAIN_MINT ?? "";
const MAIN_SYMBOL = process.env.NEXT_PUBLIC_MAIN_SYMBOL ?? "MAIN";

interface AgentState {
  wallet: string;
  epoch: { index: number; status: string; closesAt: string; snapshotSlot: string; merkleRoot: string } | null;
  allocation: { allocated: string; reserved: string; spent: string; remaining: string; snapshotBalance: string | null } | null;
  history: Array<{
    id: string;
    targetMint: string;
    symbol: string | null;
    decimals: number;
    lamports: string;
    received: string | null;
    status: string;
    generation: number | null;
    epoch: number;
    txSignature: string | null;
    confirmedAt: string | null;
  }>;
}

interface Review {
  quote: { outAmount: string; minOutRaw: string; priceImpactPct: string; slippageBps: number; route: string[] };
  token: { mint: string; symbol: string | null; name: string | null; decimals: number; verified: boolean };
  risk: { flags: string[]; warnings: string[]; blocking: string[]; executable: boolean };
  intent: Record<string, unknown>;
  intentMessage: string;
}

type Phase = "idle" | "reviewing" | "authorizing" | "preparing" | "signing" | "submitting" | "done";

export function AgentConsole() {
  const { publicKey, signMessage, signTransaction, connected } = useWallet();
  const [state, setState] = useState<AgentState | null>(null);
  const [authed, setAuthed] = useState(false);
  const [mint, setMint] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ signature: string; received: string | null; generation: number | null } | null>(null);

  const loadAgent = useCallback(async () => {
    const res = await fetch("/api/agent", { cache: "no-store" });
    if (res.status === 401) {
      setAuthed(false);
      setState(null);
      return;
    }
    const body = (await res.json()) as AgentState;
    setAuthed(true);
    setState(body);
    if (body.allocation && !amountSol) {
      setAmountSol(solFromLamports(body.allocation.remaining, 4));
    }
  }, [amountSol]);

  useEffect(() => {
    void loadAgent();
    // Session is a cookie, so this runs regardless of wallet connection state.
  }, [loadAgent]);

  // A different wallet in the extension must not keep the old session's view.
  useEffect(() => {
    if (state && publicKey && state.wallet !== publicKey.toBase58()) {
      setAuthed(false);
      setState(null);
    }
  }, [publicKey, state]);

  async function signIn() {
    setError(null);
    if (!publicKey || !signMessage) return setError("This wallet cannot sign messages.");
    try {
      setPhase("authorizing");
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const { nonce, message, error: e1 } = await nonceRes.json();
      if (e1) throw new Error(e1);

      const signature = await signMessage(new TextEncoder().encode(message));
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), nonce, signature: bs58.encode(signature) }),
      });
      const body = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(body.error ?? "Sign-in failed.");
      await loadAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setPhase("idle");
    }
  }

  async function requestReview(targetMint: string) {
    setError(null);
    setResult(null);
    setReview(null);
    try {
      setPhase("reviewing");
      const lamports = BigInt(Math.round(Number(amountSol || "0") * 1_000_000_000));
      const res = await fetch("/api/allocate/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMint, lamports: lamports.toString() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not quote this trade.");
      setReview(body as Review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not quote this trade.");
    } finally {
      setPhase("idle");
    }
  }

  async function execute() {
    if (!review || !publicKey || !signMessage || !signTransaction) return;
    setError(null);
    try {
      // 1. Authorize the intent. This is the statement of what the user agreed
      //    to, and its hash goes on chain with the transaction.
      setPhase("authorizing");
      const intentSig = await signMessage(new TextEncoder().encode(review.intentMessage));

      // 2. Server reserves the allocation and builds the transaction.
      setPhase("preparing");
      const prepRes = await fetch("/api/allocate/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: review.intent, signature: bs58.encode(intentSig) }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? "Could not prepare the transaction.");

      // 3. The user signs the transaction itself, as fee payer.
      setPhase("signing");
      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(prep.transaction), (c) => c.charCodeAt(0)),
      );
      const signed = await signTransaction(tx);

      setPhase("submitting");
      const subRes = await fetch("/api/allocate/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: prep.eventId,
          signedTransaction: btoa(String.fromCharCode(...signed.serialize())),
        }),
      });
      const sub = await subRes.json();
      if (!subRes.ok && subRes.status !== 202) throw new Error(sub.error ?? "Submission failed.");

      setResult({ signature: sub.signature, received: sub.received ?? null, generation: sub.generation ?? null });
      setReview(null);
      setPhase("done");
      await loadAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed.");
      setPhase("idle");
      await loadAgent();
    }
  }

  if (!connected) {
    return (
      <div className="panel">
        <h1 className="section">Your agent</h1>
        <p className="mono-dim">
          Connect the wallet that held the Main Token at the epoch snapshot. Connecting is read-only.
        </p>
        <WalletMultiButton />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="panel">
        <h1 className="section">Your agent</h1>
        <p className="mono-dim">
          Sign a message to prove you control {publicKey ? short(publicKey.toBase58()) : "this wallet"}. No
          fee, no transaction, no approval to move anything.
        </p>
        <button className="primary" onClick={signIn} disabled={phase === "authorizing"}>
          {phase === "authorizing" ? "waiting for wallet…" : "Authorize session"}
        </button>
        {error && <div className="danger">{error}</div>}
        <div style={{ marginTop: 12 }}>
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  const alloc = state?.allocation;

  return (
    <>
      <h1 className="section">Your agent</h1>

      <div className="stats">
        <StatBox k="Wallet" v={state ? short(state.wallet, 5) : "—"} />
        <StatBox k="Epoch" v={state?.epoch ? `#${state.epoch.index}` : "—"} />
        <StatBox k="Allocated" v={alloc ? `${solFromLamports(alloc.allocated)} SOL` : "—"} />
        <StatBox k="Used" v={alloc ? `${solFromLamports(alloc.spent)} SOL` : "—"} />
        <StatBox k="Reserved" v={alloc ? `${solFromLamports(alloc.reserved)} SOL` : "—"} note="in flight" />
        <StatBox k="Remaining" v={alloc ? `${solFromLamports(alloc.remaining)} SOL` : "—"} accent />
      </div>

      {!alloc && (
        <div className="info">
          {state?.epoch
            ? "This wallet was not in the snapshot for the current epoch, so it has no allocation."
            : "No epoch is open. Allocations appear when the next snapshot is taken."}
        </div>
      )}

      {alloc && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h2 className="sub" style={{ marginTop: 0 }}>Direct your allocation</h2>

          <label className="field">
            <span className="lbl">Amount (SOL)</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountSol}
              onChange={(e) => setAmountSol(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </label>

          <div className="row" style={{ marginBottom: 16 }}>
            <button className="primary" onClick={() => requestReview(MAIN_MINT)} disabled={phase !== "idle" || !MAIN_MINT}>
              Buy {MAIN_SYMBOL}
            </button>
            <span className="mono-dim" style={{ alignSelf: "center" }}>
              return capital to Patient Zero
            </span>
          </div>

          <label className="field">
            <span className="lbl">or another Solana mint address</span>
            <input
              type="text"
              placeholder="mint / contract address"
              value={mint}
              onChange={(e) => setMint(e.target.value.trim())}
              spellCheck={false}
            />
          </label>
          <button onClick={() => requestReview(mint)} disabled={phase !== "idle" || mint.length < 32}>
            {phase === "reviewing" ? "quoting…" : "Review"}
          </button>

          {error && <div className="danger">{error}</div>}
        </div>
      )}

      {review && (
        <div className="panel">
          <h2 className="sub" style={{ marginTop: 0 }}>Review</h2>
          <dl className="kv">
            <dt>Mint</dt>
            <dd>{review.token.mint}</dd>
            <dt>Symbol / name</dt>
            <dd>
              {review.token.symbol ?? "unknown"} {review.token.name ? `· ${review.token.name}` : ""}
              <span className={review.token.verified ? "tag main-tag" : "tag warn-tag"} style={{ marginLeft: 8 }}>
                {review.token.verified ? "on verified list" : "unverified metadata"}
              </span>
            </dd>
            <dt>You pay</dt>
            <dd>{amountSol} SOL of your allocation</dd>
            <dt>Estimated out</dt>
            <dd>{tokenAmount(review.quote.outAmount, review.token.decimals)}</dd>
            <dt>Minimum out</dt>
            <dd>{tokenAmount(review.quote.minOutRaw, review.token.decimals)} at {review.quote.slippageBps / 100}% slippage</dd>
            <dt>Price impact</dt>
            <dd>{review.quote.priceImpactPct}%</dd>
            <dt>Route</dt>
            <dd>{review.quote.route.join(" → ") || "direct"}</dd>
            <dt>Fees</dt>
            <dd>Treasury pays token-account rent. You pay the network fee as signer.</dd>
          </dl>

          {review.risk.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {review.risk.warnings.map((w, i) => (
                <div key={i} className={review.risk.blocking.includes(review.risk.flags[i]) ? "danger" : "warn"}>
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="info" style={{ marginTop: 12 }}>
            You will be asked to sign twice: once for the authorization text above, once for the
            transaction. Nothing moves until both are signed.
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={execute} disabled={!review.risk.executable || phase !== "idle"}>
              {phase === "idle" ? "Execute" : `${phase}…`}
            </button>
            <button onClick={() => setReview(null)} disabled={phase !== "idle"}>
              Cancel
            </button>
          </div>
          {!review.risk.executable && (
            <div className="danger">Blocked: {review.risk.blocking.join(", ")}. This trade will not be built.</div>
          )}
        </div>
      )}

      {result && (
        <div className="panel">
          <h2 className="sub" style={{ marginTop: 0 }}>Executed</h2>
          <dl className="kv">
            <dt>Signature</dt>
            <dd>{result.signature}</dd>
            <dt>Received</dt>
            <dd>{result.received ?? "confirming…"}</dd>
            <dt>Generation</dt>
            <dd>{result.generation ?? "—"}</dd>
          </dl>
        </div>
      )}

      <h2 className="sub">Your allocation history</h2>
      {!state || state.history.length === 0 ? (
        <div className="empty">No allocations yet.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Target</th>
                <th className="num">SOL</th>
                <th className="num">Received</th>
                <th>Status</th>
                <th className="num">Epoch</th>
              </tr>
            </thead>
            <tbody>
              {state.history.map((h) => (
                <tr key={h.id}>
                  <td className="mono-dim">{ago(h.confirmedAt)}</td>
                  <td>
                    <Link href={`/asset/${h.targetMint}`}>{displaySymbol(h.symbol, h.targetMint)}</Link>
                  </td>
                  <td className="num">{solFromLamports(h.lamports)}</td>
                  <td className="num">{tokenAmount(h.received, h.decimals)}</td>
                  <td className="mono-dim">{h.status.toLowerCase()}</td>
                  <td className="num">{h.epoch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StatBox({ k, v, note, accent }: { k: string; v: string; note?: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={accent ? "v accent" : "v"}>{v}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
