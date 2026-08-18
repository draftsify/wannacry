import { prisma } from "@/lib/prisma";
import { assetStats } from "@/lib/metrics";
import { errorMessage, fail, json } from "@/lib/http";
import { isValidPubkey } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  try {
    if (!isValidPubkey(params.mint)) return fail("Not a valid mint address.");

    const asset = await prisma.asset.findUnique({
      where: { mint: params.mint },
      include: {
        parent: { select: { mint: true, symbol: true, isMain: true } },
        children: {
          where: { eventCount: { gt: 0 } },
          select: { mint: true, symbol: true, generation: true, uniqueAgents: true },
          orderBy: { totalLamports: "desc" },
          take: 50,
        },
      },
    });
    if (!asset) return fail("This mint has not been touched by the network.", 404);

    const [stats, events] = await Promise.all([
      assetStats(asset.mint),
      prisma.propagationEvent.findMany({
        where: { targetMint: asset.mint, status: "CONFIRMED" },
        orderBy: { confirmedAt: "desc" },
        take: 50,
        select: {
          id: true,
          agentWallet: true,
          lamportsAllocated: true,
          agentPrevMint: true,
          generation: true,
          txSignature: true,
          confirmedAt: true,
          epoch: { select: { index: true } },
        },
      }),
    ]);

    return json({
      asset: {
        mint: asset.mint,
        // Attacker-controlled strings. Already stripped of control characters on
        // ingest; the client renders them as text and never as markup.
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        isMain: asset.isMain,
        generation: asset.generation,
        lineageParent: asset.parent,
        indexCaseWallet: asset.indexCaseWallet,
        riskFlags: asset.riskFlags,
        children: asset.children,
      },
      stats,
      events: events.map((e) => ({
        id: e.id,
        agentWallet: e.agentWallet,
        lamports: e.lamportsAllocated.toString(),
        cameFrom: e.agentPrevMint,
        generation: e.generation,
        epoch: e.epoch.index,
        txSignature: e.txSignature,
        confirmedAt: e.confirmedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
