import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAIN_MINT } from "@/lib/config";

/**
 * Lineage.
 *
 * The definitions, stated once so nothing downstream has to guess:
 *
 *   Agent          a wallet with at least one CONFIRMED event.
 *   Infection      one confirmed on-chain swap of epoch allocation into a mint.
 *   Parent         the previous asset that an asset's *index case* had infected,
 *                  or Patient Zero if that agent was allocating for the first
 *                  time. Set once, at first infection, then never changed.
 *   Generation     depth in the parent tree. Patient Zero is 0.
 *   Epoch          the distribution wave. Deliberately NOT the same thing as a
 *                  generation, and shown separately in the UI.
 *
 * The tree is contact tracing, nothing more: "the first agent who brought
 * capital here had last taken it there." Every edge comes from a confirmed
 * transaction. No edge is ever invented to give the graph more depth — a
 * network where every agent buys directly from Patient Zero really is one level
 * deep, and the dashboard says so.
 */

export const PATIENT_ZERO = MAIN_MINT.toBase58();

/** Ensures Patient Zero exists as the tree root before anything references it. */
export async function ensurePatientZero(tx: Prisma.TransactionClient): Promise<void> {
  await tx.asset.upsert({
    where: { mint: PATIENT_ZERO },
    update: {},
    create: {
      mint: PATIENT_ZERO,
      isMain: true,
      generation: 0,
      lineageParentMint: null,
      symbol: process.env.NEXT_PUBLIC_MAIN_SYMBOL ?? null,
      decimals: 0,
    },
  });
}

export interface LineageResult {
  agentPrevMint: string | null;
  lineageParentMint: string;
  generation: number;
}

/**
 * Resolves lineage for an event that is confirming right now, and freezes the
 * target asset's position in the tree if this is its first infection.
 *
 * Must run inside the same transaction that flips the event to CONFIRMED, so
 * two events confirming concurrently cannot both believe they were first.
 */
export async function resolveLineage(
  tx: Prisma.TransactionClient,
  params: { eventId: string; agentWallet: string; targetMint: string; confirmedAt: Date },
): Promise<LineageResult> {
  await ensurePatientZero(tx);

  // The agent's previous confirmed target. Ordered by confirmation time, not
  // creation time: what matters is the sequence the chain actually accepted.
  const prev = await tx.propagationEvent.findFirst({
    where: {
      agentWallet: params.agentWallet,
      status: "CONFIRMED",
      id: { not: params.eventId },
      confirmedAt: { lte: params.confirmedAt },
    },
    orderBy: { confirmedAt: "desc" },
    select: { targetMint: true },
  });
  const agentPrevMint = prev?.targetMint ?? null;

  const target = await tx.asset.findUnique({
    where: { mint: params.targetMint },
    select: { firstInfectionAt: true, lineageParentMint: true, generation: true },
  });

  // Already infected: its place in the tree is settled and stays settled.
  if (target?.firstInfectionAt) {
    return {
      agentPrevMint,
      lineageParentMint: target.lineageParentMint ?? PATIENT_ZERO,
      generation: target.generation,
    };
  }

  // First infection. The parent is where this agent's capital last went; if they
  // have no history, it came straight from Patient Zero's fee treasury.
  let parentMint = agentPrevMint ?? PATIENT_ZERO;
  if (parentMint === params.targetMint) parentMint = PATIENT_ZERO; // self-edge guard

  const parent = await tx.asset.findUnique({
    where: { mint: parentMint },
    select: { generation: true },
  });
  const generation = (parent?.generation ?? 0) + 1;

  await tx.asset.update({
    where: { mint: params.targetMint },
    data: {
      lineageParentMint: parentMint,
      generation,
      indexCaseWallet: params.agentWallet,
      firstInfectionAt: params.confirmedAt,
    },
  });

  return { agentPrevMint, lineageParentMint: parentMint, generation };
}

/**
 * Rebuilds the denormalized per-asset aggregates from confirmed events.
 * Cheap enough to run on every confirmation, and always derived — if the cache
 * and the event log disagree, the event log wins.
 */
export async function refreshAssetAggregates(mint: string): Promise<void> {
  const [agg, uniqueAgents] = await Promise.all([
    prisma.propagationEvent.aggregate({
      where: { targetMint: mint, status: "CONFIRMED" },
      _sum: { lamportsAllocated: true },
      _count: { _all: true },
      _max: { confirmedAt: true },
    }),
    prisma.propagationEvent
      .findMany({
        where: { targetMint: mint, status: "CONFIRMED" },
        distinct: ["agentWallet"],
        select: { agentWallet: true },
      })
      .then((rows) => rows.length),
  ]);

  await prisma.asset.update({
    where: { mint },
    data: {
      uniqueAgents,
      eventCount: agg._count._all,
      totalLamports: agg._sum.lamportsAllocated ?? 0n,
      lastInfectionAt: agg._max.confirmedAt,
    },
  });
}

export interface GraphNode {
  mint: string;
  symbol: string | null;
  name: string | null;
  isMain: boolean;
  generation: number;
  uniqueAgents: number;
  totalLamports: string;
  eventCount: number;
  firstInfectionAt: string | null;
  riskFlags: string[];
}

export interface GraphEdge {
  parent: string;
  child: string;
  /** Number of distinct agents who went parent → child. 0 on a pure tree edge
   *  that no agent has repeated, which is normal and not an error. */
  agentTransitions: number;
}

/** Nodes plus lineage edges, both derived entirely from confirmed events. */
export async function buildGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const assets = await prisma.asset.findMany({
    where: { OR: [{ isMain: true }, { eventCount: { gt: 0 } }] },
    orderBy: [{ generation: "asc" }, { totalLamports: "desc" }],
    take: 500,
  });

  const transitions = await prisma.propagationEvent.groupBy({
    by: ["agentPrevMint", "targetMint"],
    where: { status: "CONFIRMED" },
    _count: { _all: true },
  });
  const transitionCount = new Map<string, number>();
  for (const t of transitions) {
    transitionCount.set(`${t.agentPrevMint ?? PATIENT_ZERO}>${t.targetMint}`, t._count._all);
  }

  const nodes: GraphNode[] = assets.map((a) => ({
    mint: a.mint,
    symbol: a.symbol,
    name: a.name,
    isMain: a.isMain,
    generation: a.generation,
    uniqueAgents: a.uniqueAgents,
    totalLamports: a.totalLamports.toString(),
    eventCount: a.eventCount,
    firstInfectionAt: a.firstInfectionAt?.toISOString() ?? null,
    riskFlags: a.riskFlags,
  }));

  const known = new Set(nodes.map((n) => n.mint));
  const edges: GraphEdge[] = assets
    .filter((a) => a.lineageParentMint && known.has(a.lineageParentMint))
    .map((a) => ({
      parent: a.lineageParentMint as string,
      child: a.mint,
      agentTransitions: transitionCount.get(`${a.lineageParentMint}>${a.mint}`) ?? 0,
    }));

  return { nodes, edges };
}
