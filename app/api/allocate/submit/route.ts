import { VersionedTransaction } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { sessionWallet } from "@/lib/auth";
import { errorMessage, fail, json } from "@/lib/http";
import { connection } from "@/lib/solana";
import { confirmEvent, failEvent } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Broadcasts the user-signed transaction and settles the event.
 *
 * The client is not trusted to return the transaction it was given. The message
 * bytes are compared against the ones this server built and partially signed, so
 * a compromised or malicious frontend cannot get the treasury's signature onto a
 * different set of instructions than the ones the user approved.
 */
export async function POST(req: Request) {
  try {
    const wallet = sessionWallet();
    if (!wallet) return fail("Connect and sign in first.", 401);

    const { eventId, signedTransaction } = (await req.json()) as {
      eventId?: string;
      signedTransaction?: string;
    };
    if (!eventId || !signedTransaction) return fail("eventId and signedTransaction are required.");

    const event = await prisma.propagationEvent.findUnique({ where: { id: eventId } });
    if (!event) return fail("Unknown event.", 404);
    if (event.agentWallet !== wallet) return fail("This event belongs to another wallet.", 403);
    if (event.status !== "PREPARED") return fail(`Event is already ${event.status}.`, 409);
    if (event.expiresAt < new Date()) {
      await failEvent(eventId, "Expired before submission.", "EXPIRED");
      return fail("Authorization expired. Review again.", 410);
    }
    if (!event.preparedTx) return fail("No prepared transaction for this event.", 409);

    const submitted = VersionedTransaction.deserialize(Buffer.from(signedTransaction, "base64"));
    const prepared = VersionedTransaction.deserialize(Buffer.from(event.preparedTx, "base64"));

    if (!Buffer.from(submitted.message.serialize()).equals(Buffer.from(prepared.message.serialize()))) {
      await failEvent(eventId, "Submitted transaction did not match the prepared message.");
      return fail("Submitted transaction does not match the one you approved.", 400);
    }

    // Fee payer is the first signer, and we built the message with the agent as
    // fee payer — so index 0 is precisely the user's signature.
    const userSig = submitted.signatures[0];
    if (!userSig || userSig.every((b) => b === 0)) {
      return fail("Transaction is missing your signature.", 400);
    }

    const raw = Buffer.from(submitted.serialize());
    let signature: string;
    try {
      signature = await connection().sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      await failEvent(eventId, `Broadcast rejected: ${errorMessage(err)}`);
      return fail(`Broadcast rejected: ${errorMessage(err)}`, 502);
    }

    await prisma.propagationEvent.updateMany({
      where: { id: eventId, status: "PREPARED" },
      data: { status: "SUBMITTED", txSignature: signature },
    });

    try {
      const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash("confirmed");
      await connection().confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      await confirmEvent(eventId, signature);
      const settled = await prisma.propagationEvent.findUnique({ where: { id: eventId } });

      return json({
        status: settled?.status ?? "SUBMITTED",
        signature,
        received: settled?.actualOutRaw?.toString() ?? null,
        generation: settled?.generation ?? null,
        lineageParent: settled?.lineageParentMint ?? null,
      });
    } catch (err) {
      // The transaction may still land. Leave it SUBMITTED and let reconcile
      // decide — releasing the reservation now could double-spend the epoch.
      return json(
        {
          status: "SUBMITTED",
          signature,
          note: `Broadcast, but confirmation was inconclusive: ${errorMessage(err)}. Reconciliation will settle it.`,
        },
        { status: 202 },
      );
    }
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
