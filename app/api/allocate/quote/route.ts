import { PublicKey } from "@solana/web3.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { prisma } from "@/lib/prisma";
import { sessionWallet, SIGN_IN_DOMAIN } from "@/lib/auth";
import { currentEpoch } from "@/lib/epoch";
import { errorMessage, fail, json } from "@/lib/http";
import { isValidPubkey } from "@/lib/solana";
import {
  DEFAULT_SLIPPAGE_BPS,
  INTENT_TTL_SECONDS,
  MAX_SLIPPAGE_BPS,
  MIN_ALLOCATION_LAMPORTS,
} from "@/lib/config";
import { getQuote, routeLabels } from "@/lib/jupiter";
import {
  RISK_COPY,
  RiskFlag,
  blockingFlags,
  fetchMetadata,
  impersonationFlags,
  inspectMint,
  priceImpactFlags,
} from "@/lib/risk";
import { AllocationIntent, INTENT_VERSION, intentDisplayMessage, intentHash } from "@/lib/intent";
import { ensurePatientZero } from "@/lib/lineage";

export const dynamic = "force-dynamic";

/**
 * The review step. Quotes the swap, inspects the mint, and returns the exact
 * text the user will be asked to sign. Nothing is reserved and no capital moves
 * here — this route is safe to call repeatedly.
 */
export async function POST(req: Request) {
  try {
    const wallet = sessionWallet();
    if (!wallet) return fail("Connect and sign in first.", 401);

    const body = (await req.json()) as {
      targetMint?: string;
      lamports?: string;
      slippageBps?: number;
    };

    if (!body.targetMint || !isValidPubkey(body.targetMint)) {
      return fail("Enter a valid Solana mint address.");
    }
    const targetMint = new PublicKey(body.targetMint);

    let lamports: bigint;
    try {
      lamports = BigInt(body.lamports ?? "0");
    } catch {
      return fail("Amount is not a valid integer number of lamports.");
    }
    if (lamports < MIN_ALLOCATION_LAMPORTS) {
      return fail(`Minimum allocation is ${MIN_ALLOCATION_LAMPORTS} lamports.`);
    }

    const slippageBps = Math.min(
      Math.max(Math.round(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS), 1),
      MAX_SLIPPAGE_BPS,
    );

    const epoch = await currentEpoch();
    if (!epoch) return fail("No epoch is open right now.", 409);

    const allocation = await prisma.agentAllocation.findUnique({
      where: { epochId_wallet: { epochId: epoch.id, wallet } },
    });
    if (!allocation) return fail("This wallet was not eligible in the current epoch.", 403);

    const remaining =
      allocation.allocatedLamports - allocation.reservedLamports - allocation.spentLamports;
    if (lamports > remaining) {
      return fail(`Only ${remaining} lamports remain in your allocation this epoch.`);
    }

    // Chain first, third-party metadata second. Authorities and extensions are
    // facts; symbol and name are claims.
    const mintInfo = await inspectMint(targetMint);
    const metadata = await fetchMetadata(mintInfo.mint);

    const quote = await getQuote({
      outputMint: mintInfo.mint,
      lamports,
      slippageBps,
    });

    const priceImpactPct = Number(quote.priceImpactPct ?? 0) * 100;
    const flags: RiskFlag[] = [
      ...mintInfo.flags,
      ...priceImpactFlags(priceImpactPct),
      ...impersonationFlags(metadata, mintInfo.mint),
      ...(metadata.verified ? [] : (["UNVERIFIED_TOKEN"] as RiskFlag[])),
      ...(metadata.symbol || metadata.name ? [] : (["NO_METADATA"] as RiskFlag[])),
    ];

    await prisma.$transaction(async (tx) => {
      await ensurePatientZero(tx);
      await tx.asset.upsert({
        where: { mint: mintInfo.mint },
        create: {
          mint: mintInfo.mint,
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: mintInfo.decimals,
          riskFlags: flags,
          metadata: { verified: metadata.verified, tokenProgram: mintInfo.tokenProgram.toBase58() },
        },
        // Lineage fields are deliberately untouched: they are frozen at first
        // infection and a later quote must never disturb them.
        update: {
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: mintInfo.decimals,
          riskFlags: flags,
        },
      });
    });

    const blocking = blockingFlags(flags);
    const intent: AllocationIntent = {
      version: INTENT_VERSION,
      domain: SIGN_IN_DOMAIN,
      epochIndex: epoch.index,
      agentWallet: wallet,
      targetMint: mintInfo.mint,
      lamports: lamports.toString(),
      minOutRaw: quote.otherAmountThreshold,
      slippageBps,
      nonce: bytesToHex(randomBytes(16)),
      expiresAt: Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS,
    };

    return json({
      quote: {
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        minOutRaw: quote.otherAmountThreshold,
        priceImpactPct: priceImpactPct.toFixed(4),
        slippageBps,
        route: routeLabels(quote),
      },
      token: {
        mint: mintInfo.mint,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: mintInfo.decimals,
        verified: metadata.verified,
      },
      risk: {
        flags,
        warnings: flags.map((f) => RISK_COPY[f]),
        blocking,
        executable: blocking.length === 0,
      },
      intent,
      // Signed verbatim by the wallet. The client must not reconstruct it.
      intentMessage: intentDisplayMessage(intent),
      intentHash: intentHash(intent),
    });
  } catch (err) {
    return fail(errorMessage(err));
  }
}
