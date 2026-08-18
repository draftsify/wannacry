import { prisma } from "@/lib/prisma";
import { sessionWallet } from "@/lib/auth";
import { currentEpoch } from "@/lib/epoch";
import { errorMessage, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The connected agent's state. Reads the frozen snapshot — never a live holder
 * balance — so what a user sees here cannot change because they moved tokens
 * after the epoch opened.
 */
export async function GET() {
  try {
    const wallet = sessionWallet();
    if (!wallet) return fail("Connect and sign in to view your agent.", 401);

    const epoch = await currentEpoch();
    if (!epoch) return json({ wallet, epoch: null, allocation: null, history: [] });

    const [allocation, snapshot, history] = await Promise.all([
      prisma.agentAllocation.findUnique({
        where: { epochId_wallet: { epochId: epoch.id, wallet } },
      }),
      prisma.holderSnapshot.findUnique({
        where: { epochId_wallet: { epochId: epoch.id, wallet } },
      }),
      prisma.propagationEvent.findMany({
        where: { agentWallet: wallet, status: { in: ["CONFIRMED", "SUBMITTED"] } },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          targetMint: true,
          lamportsAllocated: true,
          actualOutRaw: true,
          status: true,
          txSignature: true,
          confirmedAt: true,
          generation: true,
          epoch: { select: { index: true } },
          target: { select: { symbol: true, decimals: true } },
        },
      }),
    ]);

    return json({
      wallet,
      epoch: {
        index: epoch.index,
        status: epoch.status,
        closesAt: epoch.closesAt.toISOString(),
        snapshotSlot: epoch.snapshotSlot.toString(),
        merkleRoot: epoch.merkleRoot,
        anchorTxSig: epoch.anchorTxSig,
      },
      allocation: allocation
        ? {
            allocated: allocation.allocatedLamports.toString(),
            reserved: allocation.reservedLamports.toString(),
            spent: allocation.spentLamports.toString(),
            remaining: (
              allocation.allocatedLamports -
              allocation.reservedLamports -
              allocation.spentLamports
            ).toString(),
            snapshotBalance: snapshot?.rawBalance.toString() ?? null,
          }
        : null,
      history: history.map((h) => ({
        id: h.id,
        targetMint: h.targetMint,
        symbol: h.target.symbol,
        decimals: h.target.decimals,
        lamports: h.lamportsAllocated.toString(),
        received: h.actualOutRaw?.toString() ?? null,
        status: h.status,
        generation: h.generation,
        epoch: h.epoch.index,
        txSignature: h.txSignature,
        confirmedAt: h.confirmedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
