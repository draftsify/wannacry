import Link from "next/link";
import { NetworkGraph } from "@/components/NetworkGraph";
import { buildGraph } from "@/lib/lineage";
import { networkStats } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";
import { ago, bps, displaySymbol, short, solFromLamports } from "@/lib/format";
import { solscanTx } from "@/lib/solana";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  let stats, graph, recent;
  try {
    [stats, graph, recent] = await Promise.all([
      networkStats(),
      buildGraph(),
      prisma.propagationEvent.findMany({
        where: { status: "CONFIRMED" },
        orderBy: { confirmedAt: "desc" },
        take: 20,
        include: { target: { select: { symbol: true } }, epoch: { select: { index: true } } },
      }),
    ]);
  } catch (err) {
    return (
      <>
        <h1 className="section">The network</h1>
        <div className="danger">
          Cannot reach the database. Run <code>npm run db:push</code> and check DATABASE_URL.
          <br />
          <span className="mono-dim">{err instanceof Error ? err.message : "unknown error"}</span>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="section">The network</h1>

      <div className="stats">
        <Stat k="Treasury" v={`${solFromLamports(stats.treasuryLamports, 2)} SOL`} accent />
        <Stat
          k="Epoch"
          v={stats.epoch ? `#${stats.epoch.index}` : "—"}
          note={stats.epoch ? stats.epoch.status.toLowerCase() : "none open"}
        />
        <Stat k="Eligible hosts" v={stats.epoch ? stats.epoch.eligibleHolders.toLocaleString() : "—"} />
        <Stat k="Active agents" v={stats.activeAgents.toLocaleString()} note="≥1 confirmed allocation" />
        <Stat k="Assets reached" v={stats.assetsReached.toLocaleString()} />
        <Stat k="Allocations" v={stats.totalAllocations.toLocaleString()} note="confirmed on chain" />
        <Stat k="Deepest generation" v={String(stats.deepestGeneration)} note="tree depth, not epoch" />
        <Stat
          k="Allocated"
          v={`${solFromLamports(stats.allocatedLamports, 2)} SOL`}
          note={`${solFromLamports(stats.velocity24hLamports, 2)} in 24h`}
        />
      </div>

      {stats.epoch && (
        <div className="panel" style={{ marginTop: 16 }}>
          <dl className="kv">
            <dt>{stats.epoch.formula === "equal" ? "Allocation each" : "Allocation (median)"}</dt>
            <dd>
              {solFromLamports(stats.epoch.allocationLamports)} SOL{" "}
              <span className="mono-dim">· {stats.epoch.formula} formula</span>
            </dd>
            <dt>Snapshot slot</dt>
            <dd>{stats.epoch.snapshotSlot}</dd>
            <dt>Snapshot root</dt>
            <dd className="mono-dim">{stats.epoch.merkleRoot}</dd>
            <dt>Root on chain</dt>
            <dd>
              {stats.epoch.anchorTxSig ? (
                <a href={solscanTx(stats.epoch.anchorTxSig)} target="_blank" rel="noreferrer">
                  {short(stats.epoch.anchorTxSig, 8)}
                </a>
              ) : (
                <span className="mono-dim">not anchored</span>
              )}
            </dd>
            <dt>Buyback share</dt>
            <dd>{bps(stats.mainBuybackShareBps)} of allocated capital returned to the Main Token</dd>
          </dl>
        </div>
      )}

      <h2 className="sub">Propagation tree</h2>
      <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
      <p className="mono-dim" style={{ fontSize: 11, marginTop: 8 }}>
        An asset&apos;s parent is the previous asset its first agent had allocated to, or Patient Zero
        if that was their first allocation. Every edge comes from a confirmed transaction.
      </p>

      <h2 className="sub">Recent infections</h2>
      {recent.length === 0 ? (
        <div className="empty">Nothing yet.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>Target</th>
                <th className="num">SOL</th>
                <th className="num">Gen</th>
                <th className="num">Epoch</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td className="mono-dim">{ago(e.confirmedAt?.toISOString() ?? null)}</td>
                  <td className="mono-dim">{short(e.agentWallet)}</td>
                  <td>
                    <Link href={`/asset/${e.targetMint}`}>
                      {displaySymbol(e.target.symbol, e.targetMint)}
                    </Link>
                  </td>
                  <td className="num">{solFromLamports(e.lamportsAllocated.toString())}</td>
                  <td className="num">{e.generation ?? "—"}</td>
                  <td className="num">{e.epoch.index}</td>
                  <td>
                    {e.txSignature ? (
                      <a href={solscanTx(e.txSignature)} target="_blank" rel="noreferrer">
                        {short(e.txSignature, 4)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({ k, v, note, accent }: { k: string; v: string; note?: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={accent ? "v accent" : "v"}>{v}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
