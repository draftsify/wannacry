import { prisma } from "@/lib/prisma";
import { release, settle } from "@/lib/allocation";
import { refreshAssetAggregates, resolveLineage } from "@/lib/lineage";
import { verifyLandedSwap } from "@/lib/verify";

/**
 * Terminal state transitions for a propagation event.
 *
 * Both directions are idempotent: reconcile re-runs them on a schedule, and a
 * user hammering the submit button must not be able to settle the same event
 * twice. Idempotency comes from the status guard being part of the same
 * conditional write as the state change, never from checking first and writing
 * after.
 */

export async function confirmEvent(eventId: string, signature: string): Promise<void> {
  const event = await prisma.propagationEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error("Unknown event.");
  if (event.status === "CONFIRMED") return;

  const landed = await verifyLandedSwap({
    signature,
    agentWallet: event.agentWallet,
    targetMint: event.targetMint,
  });

  const confirmedAt = landed.blockTime ?? new Date();

  await prisma.$transaction(async (tx) => {
    // Claim the event first. If another worker already moved it out of
    // PREPARED/SUBMITTED, this matches nothing and the whole transaction is a
    // no-op — which is exactly the desired behaviour under a double submit.
    const claimed = await tx.propagationEvent.updateMany({
      where: { id: eventId, status: { in: ["PREPARED", "SUBMITTED"] } },
      data: {
        status: "CONFIRMED",
        txSignature: signature,
        slot: landed.slot,
        blockTime: landed.blockTime,
        actualOutRaw: landed.actualOutRaw,
        confirmedAt,
      },
    });
    if (claimed.count !== 1) return;

    const lineage = await resolveLineage(tx, {
      eventId,
      agentWallet: event.agentWallet,
      targetMint: event.targetMint,
      confirmedAt,
    });

    await tx.propagationEvent.update({
      where: { id: eventId },
      data: {
        agentPrevMint: lineage.agentPrevMint,
        lineageParentMint: lineage.lineageParentMint,
        generation: lineage.generation,
      },
    });

    const allocation = await tx.agentAllocation.findUnique({
      where: { epochId_wallet: { epochId: event.epochId, wallet: event.agentWallet } },
    });
    if (allocation) await settle(tx, allocation.id, event.lamportsAllocated);
  });

  await refreshAssetAggregates(event.targetMint);
}

export async function failEvent(
  eventId: string,
  reason: string,
  status: "FAILED" | "EXPIRED" = "FAILED",
): Promise<void> {
  const event = await prisma.propagationEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.propagationEvent.updateMany({
      where: { id: eventId, status: { in: ["PREPARED", "SUBMITTED"] } },
      data: { status, failureReason: reason.slice(0, 300) },
    });
    if (claimed.count !== 1) return;

    const allocation = await tx.agentAllocation.findUnique({
      where: { epochId_wallet: { epochId: event.epochId, wallet: event.agentWallet } },
    });
    if (allocation) await release(tx, allocation.id, event.lamportsAllocated);
  });
}
