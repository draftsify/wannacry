import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assetStats } from "@/lib/metrics";
import { isValidPubkey, solscanToken, solscanTx } from "@/lib/solana";
import { RISK_COPY, RiskFlag } from "@/lib/risk";
import { ago, bps, displaySymbol, short, solFromLamports } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: { mint: string } }) {
  if (!isValidPubkey(params.mint)) notFound();

  const asset = await prisma.asset.findUnique({
    where: { mint: params.mint },
    include: {
      parent: { select: { mint: true, symbol: true, isMain: true } },
      children: {
        where: { eventCount: { gt: 0 } },
        orderBy: { totalLamports: "desc" },
        take: 30,
      },
    },
  });
  if (!asset) notFound();

  const [stats, events] = await Promise.all([
    assetStats(asset.mint),
    prisma.propagationEvent.findMany({
      where: { targetMint: asset.mint, status: "CONFIRMED" },
      orderBy: { confirmedAt: "desc" },
      take: 40,
      include: { epoch: { select: { index: true } } },
    }),
  ]);

  return (
    <>
      <h1 className="section">
        {asset.isMain ? "Patient Zero" : "Asset"} · {displaySymbol(asset.symbol, asset.mint)}
      </h1>

      <div className="stats">
        <Stat k="Unique agents" v={stats.uniqueAgents.toLocaleString()} accent />
        <Stat k="Capital allocated" v={`${solFromLamports(stats.totalLamports, 3)} SOL`} />
        <Stat k="Allocations" v={stats.eventCount.toLocaleString()} />
        <Stat k="Network penetration" v={bps(stats.networkPenetrationBps)} note="of all active agents" />
        <Stat k="Generation" v={String(asset.generation)} note="tree depth" />
        <Stat k="Epochs active" v={String(stats.generationsSurvived)} />
        <Stat k="Repeat rate" v={bps(stats.repeatRateBps)} note="agents allocating again" />
        <Stat k="First infection" v={ago(stats.firstInfectionAt)} note={ago(stats.lastInfectionAt) + " latest"} />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <dl className="kv">
          <dt>Mint</dt>
          <dd>
            <a href={solscanToken(asset.mint)} target="_blank" rel="noreferrer">
              {asset.mint}
            </a>
          </dd>
          <dt>Name</dt>
          <dd>
            {asset.name ?? "unknown"}
            {!asset.isMain && (
              <span className="mono-dim"> · metadata is supplied by the token author, not verified here</span>
            )}
          </dd>
          <dt>Lineage parent</dt>
          <dd>
            {asset.parent ? (
              <Link href={`/asset/${asset.parent.mint}`}>
                {displaySymbol(asset.parent.symbol, asset.parent.mint)}
                {asset.parent.isMain ? " (Patient Zero)" : ""}
              </Link>
            ) : (
              "none — this is the root"
            )}
          </dd>
          <dt>Index case</dt>
          <dd className="mono-dim">
            {asset.indexCaseWallet ? short(asset.indexCaseWallet, 6) : "—"}
            {asset.indexCaseWallet && " — the first agent to bring capital here"}
          </dd>
        </dl>

        {asset.riskFlags.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {asset.riskFlags.map((f) => (
              <span key={f} className="tag warn-tag">
                {f}
              </span>
            ))}
            {asset.riskFlags.map((f) => (
              <div key={`c-${f}`} className="warn">
                {RISK_COPY[f as RiskFlag] ?? f}
              </div>
            ))}
          </div>
        )}
      </div>

      {asset.children.length > 0 && (
        <>
          <h2 className="sub">Descendants</h2>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Gen</th>
                  <th className="num">Agents</th>
                  <th className="num">SOL</th>
                </tr>
              </thead>
              <tbody>
                {asset.children.map((c) => (
                  <tr key={c.mint}>
                    <td>
                      <Link href={`/asset/${c.mint}`}>{displaySymbol(c.symbol, c.mint)}</Link>
                    </td>
                    <td className="num">{c.generation}</td>
                    <td className="num">{c.uniqueAgents}</td>
                    <td className="num">{solFromLamports(c.totalLamports.toString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="sub">Infection log</h2>
      {events.length === 0 ? (
        <div className="empty">No confirmed allocations to this asset.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>Came from</th>
                <th className="num">SOL</th>
                <th className="num">Epoch</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="mono-dim">{ago(e.confirmedAt?.toISOString() ?? null)}</td>
                  <td className="mono-dim">{short(e.agentWallet)}</td>
                  <td>
                    {e.agentPrevMint ? (
                      <Link href={`/asset/${e.agentPrevMint}`}>{short(e.agentPrevMint)}</Link>
                    ) : (
                      <span className="mono-dim">first allocation</span>
                    )}
                  </td>
                  <td className="num">{solFromLamports(e.lamportsAllocated.toString())}</td>
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
