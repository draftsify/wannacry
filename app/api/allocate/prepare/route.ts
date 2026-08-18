import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { sessionWallet, SIGN_IN_DOMAIN } from "@/lib/auth";
import { currentEpoch } from "@/lib/epoch";
import { errorMessage, fail, json } from "@/lib/http";
import { isValidPubkey } from "@/lib/solana";
import { INTENT_VERSION, AllocationIntent, intentHash, intentMemo, verifyIntentSignature } from "@/lib/intent";
import { reserve, release } from "@/lib/allocation";
import { buildAllocationTransaction, getQuote, routeLabels } from "@/lib/jupiter";
import { blockingFlags, inspectMint, RiskFlag } from "@/lib/risk";
import { INTENT_TTL_SECONDS, MAIN_MINT } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Reserves the allocation and builds the transaction.
 *
 * Every field of the intent is re-checked here against server-side truth. The
 * client signed a statement; it does not get to decide whether that statement
 * was acceptable. In particular the amount is re-checked against the ledger, not
 * against whatever the quote step happened to see.
 */
export async function POST(req: Request) {
  try {
    const wallet = sessionWallet();
    if (!wallet) return fail("Connect and sign in first.", 401);

    const body = (await req.json()) as { intent?: AllocationIntent; signature?: string };
    const intent = body.intent;
    if (!intent || !body.signature) return fail("intent and signature are required.");

    if (intent.version !== INTENT_VERSION) return fail("Unsupported intent version.");
    if (intent.domain !== SIGN_IN_DOMAIN) return fail("Intent was issued for a different domain.");
    if (intent.agentWallet !== wallet) return fail("Intent belongs to a different wallet.", 403);
    if (!isValidPubkey(intent.targetMint)) return fail("Invalid target mint.");
    if (intent.expiresAt * 1000 < Date.now()) return fail("Authorization expired. Review again.", 410);
    if (intent.expiresAt * 1000 > Date.now() + (INTENT_TTL_SECONDS + 60) * 1000) {
      return fail("Authorization expiry is implausibly far in the future.");
    }
    if (!verifyIntentSignature(intent, body.signature)) {
      return fail("Authorization signature does not verify.", 403);
    }

    const epoch = await currentEpoch();
    if (!epoch) return fail("No epoch is open right now.", 409);
    if (epoch.index !== intent.epochIndex) return fail("Authorization was for a different epoch.", 409);

    let lamports: bigint;
    let approvedMinOut: bigint;
    try {
      lamports = BigInt(intent.lamports);
      approvedMinOut = BigInt(intent.minOutRaw);
    } catch {
      return fail("Malformed amounts in intent.");
    }
    if (lamports <= 0n) return fail("Amount must be positive.");

    const targetMint = new PublicKey(intent.targetMint);
    const mintInfo = await inspectMint(targetMint);
    const blocking = blockingFlags(mintInfo.flags as RiskFlag[]);
    if (blocking.length > 0) return fail(`Blocked by mint safety check: ${blocking.join(", ")}`, 422);

    // Re-quote. The quote shown at review is a snapshot of a moving market, and
    // the transaction must be built from a live one.
    const quote = await getQuote({
      outputMint: mintInfo.mint,
      lamports,
      slippageBps: intent.slippageBps,
    });
    const liveMinOut = BigInt(quote.otherAmountThreshold);
    if (liveMinOut < approvedMinOut) {
      // The user authorized a floor. The market moved below it, so this is a
      // refusal rather than a silently worse fill.
      return fail("Price moved past the minimum you approved. Review again.", 409);
    }

    const allocation = await prisma.agentAllocation.findUnique({
      where: { epochId_wallet: { epochId: epoch.id, wallet } },
    });
    if (!allocation) return fail("This wallet was not eligible in the current epoch.", 403);

    const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000);
    const hash = intentHash(intent);

    // Reserve and record in one transaction. The event row exists before any
    // transaction is built, so an abandoned prepare is a released reservation
    // rather than a leak, and a replayed nonce hits the unique index.
    const event = await prisma.$transaction(async (tx) => {
      const ok = await reserve(tx, allocation.id, lamports);
      if (!ok) throw new Error("Insufficient remaining allocation.");

      return tx.propagationEvent.create({
        data: {
          epochId: epoch.id,
          agentWallet: wallet,
          targetMint: mintInfo.mint,
          capitalSourceMint: MAIN_MINT.toBase58(),
          lamportsAllocated: lamports,
          minOutRaw: liveMinOut,
          expectedOutRaw: BigInt(quote.outAmount),
          slippageBps: intent.slippageBps,
          priceImpactPct: Number(quote.priceImpactPct ?? 0) * 100,
          routeLabels: routeLabels(quote),
          intentHash: hash,
          intentSignature: body.signature,
          intentNonce: intent.nonce,
          status: "PREPARED",
          expiresAt,
        },
      });
    });

    try {
      const built = await buildAllocationTransaction({
        quote,
        agentWallet: new PublicKey(wallet),
        targetMint,
        targetTokenProgram: mintInfo.tokenProgram,
        memo: intentMemo(intent),
      });

      await prisma.propagationEvent.update({
        where: { id: event.id },
        data: { preparedTx: built.transactionBase64 },
      });

      return json({
        eventId: event.id,
        transaction: built.transactionBase64,
        blockhash: built.blockhash,
        lastValidBlockHeight: built.lastValidBlockHeight,
        destinationTokenAccount: built.destinationTokenAccount,
        minOutRaw: liveMinOut.toString(),
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      // Building failed after the reservation was taken. Give the allocation
      // back immediately rather than waiting for the expiry sweep.
      await prisma.$transaction(async (tx) => {
        await release(tx, allocation.id, lamports);
        await tx.propagationEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", failureReason: errorMessage(err).slice(0, 300) },
        });
      });
      throw err;
    }
  } catch (err) {
    return fail(errorMessage(err));
  }
}
