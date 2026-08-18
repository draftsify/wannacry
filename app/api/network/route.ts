import { buildGraph } from "@/lib/lineage";
import { networkStats } from "@/lib/metrics";
import { errorMessage, fail, json } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, graph, recent] = await Promise.all([
      networkStats(),
      buildGraph(),
      prisma.propagationEvent.findMany({
        where: { status: "CONFIRMED" },
        orderBy: { confirmedAt: "desc" },
        take: 25,
        select: {
          id: true,
          agentWallet: true,
          targetMint: true,
          lamportsAllocated: true,
          generation: true,
          txSignature: true,
          confirmedAt: true,
          target: { select: { symbol: true } },
        },
      }),
    ]);

    return json({
      stats,
      graph,
      recent: recent.map((e) => ({
        id: e.id,
        agentWallet: e.agentWallet,
        targetMint: e.targetMint,
        symbol: e.target.symbol,
        lamports: e.lamportsAllocated.toString(),
        generation: e.generation,
        txSignature: e.txSignature,
        confirmedAt: e.confirmedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
