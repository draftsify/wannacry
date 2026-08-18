import { prisma } from "@/lib/prisma";
import { assertCronAuth, errorMessage, fail, json } from "@/lib/http";
import { closeEpoch, currentEpoch, openEpoch } from "@/lib/epoch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Rolls the epoch. Closes the open one if its window has passed, then takes a
 * fresh snapshot and opens the next.
 *
 * Deliberately not idempotent-by-accident: openEpoch refuses outright while an
 * OPEN epoch exists, so a double-fired cron cannot produce two live snapshots.
 */
export async function POST(req: Request) {
  try {
    assertCronAuth(req);

    const open = await currentEpoch();
    let closed: number | null = null;

    if (open) {
      if (open.closesAt > new Date()) {
        return json({ action: "none", reason: `Epoch ${open.index} closes at ${open.closesAt.toISOString()}.` });
      }
      // Nothing can still be in flight against a closing epoch, or its unspent
      // balance would be miscounted when the next snapshot reads the treasury.
      const inFlight = await prisma.propagationEvent.count({
        where: { epochId: open.id, status: { in: ["PREPARED", "SUBMITTED"] } },
      });
      if (inFlight > 0) {
        return json({ action: "waiting", reason: `${inFlight} events still in flight.` });
      }
      await closeEpoch(open.id);
      closed = open.index;
    }

    const epoch = await openEpoch();
    return json({
      action: "opened",
      closed,
      epoch: {
        index: epoch.index,
        eligibleHolders: epoch.eligibleHolders,
        allocationLamports: epoch.allocationLamports.toString(),
        distributableLamports: epoch.distributableLamports.toString(),
        snapshotSlot: epoch.snapshotSlot.toString(),
        merkleRoot: epoch.merkleRoot,
        anchorTxSig: epoch.anchorTxSig,
      },
    });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}

// Vercel Cron issues GET with the CRON_SECRET bearer header.
export const GET = POST;
