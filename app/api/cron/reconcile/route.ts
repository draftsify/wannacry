import { prisma } from "@/lib/prisma";
import { assertCronAuth, errorMessage, fail, json } from "@/lib/http";
import { confirmEvent, failEvent } from "@/lib/settle";
import { FailedOnChainError, NotLandedError } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A transaction that has not appeared this long after broadcast is not coming. */
const SUBMITTED_GRACE_MS = 5 * 60 * 1000;

/**
 * The safety net. Two jobs:
 *
 *   1. Release allocation held by prepares the user never signed.
 *   2. Settle or fail transactions that were broadcast but whose confirmation
 *      the request handler did not see — a lambda timing out mid-confirm must
 *      not strand capital or, worse, free a reservation for a swap that landed.
 *
 * Chain state decides. This route never trusts what the app previously recorded.
 */
export async function POST(req: Request) {
  try {
    assertCronAuth(req);

    const now = new Date();
    const results = { expired: 0, confirmed: 0, failed: 0, pending: 0 };

    // 1. Unsigned prepares past their window.
    const stale = await prisma.propagationEvent.findMany({
      where: { status: "PREPARED", expiresAt: { lt: now } },
      select: { id: true },
      take: 200,
    });
    for (const e of stale) {
      await failEvent(e.id, "Not signed before expiry.", "EXPIRED");
      results.expired++;
    }

    // 2. Broadcast transactions of unknown outcome.
    const inFlight = await prisma.propagationEvent.findMany({
      where: { status: "SUBMITTED", txSignature: { not: null } },
      select: { id: true, txSignature: true, createdAt: true },
      take: 200,
    });

    for (const e of inFlight) {
      try {
        await confirmEvent(e.id, e.txSignature as string);
        results.confirmed++;
      } catch (err) {
        if (err instanceof FailedOnChainError) {
          await failEvent(e.id, errorMessage(err));
          results.failed++;
        } else if (err instanceof NotLandedError) {
          if (now.getTime() - e.createdAt.getTime() > SUBMITTED_GRACE_MS) {
            // Past the grace window the blockhash has long expired, so the
            // transaction can never land and the reservation is safe to free.
            await failEvent(e.id, "Never landed on chain.");
            results.failed++;
          } else {
            results.pending++;
          }
        } else {
          // RPC trouble rather than a verdict. Leave it for the next run.
          results.pending++;
        }
      }
    }

    return json(results);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}

// Vercel Cron issues GET with the CRON_SECRET bearer header.
export const GET = POST;
