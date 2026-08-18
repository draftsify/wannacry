import { prisma } from "@/lib/prisma";
import { treasuryBalance } from "@/lib/solana";
import { TREASURY_PUBKEY } from "@/lib/config";
import { PATIENT_ZERO } from "@/lib/lineage";

/**
 * Every number here is derived from CONFIRMED events or from live chain state.
 * Nothing is estimated, projected or smoothed. If a metric cannot be computed
 * honestly it is omitted rather than filled in.
 */

export interface NetworkStats {
  treasuryLamports: string;
  epoch: {
    index: number;
    status: string;
    allocationLamports: string;
    formula: string;
    eligibleHolders: number;
    distributableLamports: string;
    snapshotSlot: string;
    merkleRoot: string;
    anchorTxSig: string | null;
    closesAt: string;
  } | null;
  activeAgents: number;
  assetsReached: number;
  totalAllocations: number;
  allocatedLamports: string;
  deepestGeneration: number;
  mainBuybackShareBps: number | null;
  velocity24hLamports: string;
}

export async function networkStats(): Promise<NetworkStats> {
  const [treasury, epoch, agents, assetsReached, confirmed, deepest, mainSum, velocity] =
    await Promise.all([
      treasuryBalance(TREASURY_PUBKEY).catch(() => 0n),
      prisma.epoch.findFirst({ orderBy: { index: "desc" } }),
      prisma.propagationEvent
        .findMany({ where: { status: "CONFIRMED" }, distinct: ["agentWallet"], select: { agentWallet: true } })
        .then((r) => r.length),
      prisma.asset.count({ where: { eventCount: { gt: 0 } } }),
      prisma.propagationEvent.aggregate({
        where: { status: "CONFIRMED" },
        _count: { _all: true },
        _sum: { lamportsAllocated: true },
      }),
      prisma.asset.aggregate({ where: { eventCount: { gt: 0 } }, _max: { generation: true } }),
      prisma.propagationEvent.aggregate({
        where: { status: "CONFIRMED", targetMint: PATIENT_ZERO },
        _sum: { lamportsAllocated: true },
      }),
      prisma.propagationEvent.aggregate({
        where: { status: "CONFIRMED", confirmedAt: { gte: new Date(Date.now() - 86_400_000) } },
        _sum: { lamportsAllocated: true },
      }),
    ]);

  const total = confirmed._sum.lamportsAllocated ?? 0n;
  const main = mainSum._sum.lamportsAllocated ?? 0n;

  return {
    treasuryLamports: treasury.toString(),
    epoch: epoch
      ? {
          index: epoch.index,
          status: epoch.status,
          allocationLamports: epoch.allocationLamports.toString(),
          formula: epoch.formula,
          eligibleHolders: epoch.eligibleHolders,
          distributableLamports: epoch.distributableLamports.toString(),
          snapshotSlot: epoch.snapshotSlot.toString(),
          merkleRoot: epoch.merkleRoot,
          anchorTxSig: epoch.anchorTxSig,
          closesAt: epoch.closesAt.toISOString(),
        }
      : null,
    activeAgents: agents,
    assetsReached,
    totalAllocations: confirmed._count._all,
    allocatedLamports: total.toString(),
    deepestGeneration: deepest._max.generation ?? 0,
    // Null rather than 0 when nothing has been allocated: "no data" and "zero
    // percent went to buybacks" are different claims.
    mainBuybackShareBps: total > 0n ? Number((main * 10000n) / total) : null,
    velocity24hLamports: (velocity._sum.lamportsAllocated ?? 0n).toString(),
  };
}

export interface AssetStats {
  uniqueAgents: number;
  totalLamports: string;
  eventCount: number;
  /** Share of all active agents that have ever allocated here, in basis points. */
  networkPenetrationBps: number | null;
  /** Distinct epochs in which this asset received at least one allocation. */
  generationsSurvived: number;
  /** Share of allocations here that came from an agent already holding it, bps. */
  repeatRateBps: number | null;
  firstInfectionAt: string | null;
  lastInfectionAt: string | null;
}

export async function assetStats(mint: string): Promise<AssetStats> {
  const [asset, activeAgents, epochs, repeats] = await Promise.all([
    prisma.asset.findUnique({ where: { mint } }),
    prisma.propagationEvent
      .findMany({ where: { status: "CONFIRMED" }, distinct: ["agentWallet"], select: { agentWallet: true } })
      .then((r) => r.length),
    prisma.propagationEvent
      .findMany({
        where: { targetMint: mint, status: "CONFIRMED" },
        distinct: ["epochId"],
        select: { epochId: true },
      })
      .then((r) => r.length),
    prisma.propagationEvent.count({
      where: { targetMint: mint, status: "CONFIRMED", agentPrevMint: mint },
    }),
  ]);

  if (!asset) throw new Error("Unknown asset.");

  return {
    uniqueAgents: asset.uniqueAgents,
    totalLamports: asset.totalLamports.toString(),
    eventCount: asset.eventCount,
    networkPenetrationBps:
      activeAgents > 0 ? Math.round((asset.uniqueAgents / activeAgents) * 10000) : null,
    generationsSurvived: epochs,
    repeatRateBps: asset.eventCount > 0 ? Math.round((repeats / asset.eventCount) * 10000) : null,
    firstInfectionAt: asset.firstInfectionAt?.toISOString() ?? null,
    lastInfectionAt: asset.lastInfectionAt?.toISOString() ?? null,
  };
}
