import { PublicKey } from "@solana/web3.js";
import { connection } from "@/lib/solana";
import { TREASURY_PUBKEY } from "@/lib/config";

/**
 * Reads back what actually happened on chain.
 *
 * The application's belief about a swap is not evidence. A propagation event
 * only becomes CONFIRMED after this function re-derives the outcome from the
 * transaction's own pre/post balances: how many tokens the agent received, and
 * that the treasury really paid. Everything the dashboard draws sits downstream
 * of this check, which is what stops the graph from being a list of assertions.
 */

export interface LandedSwap {
  slot: bigint;
  blockTime: Date | null;
  actualOutRaw: bigint;
  treasurySpentLamports: bigint;
}

export class NotLandedError extends Error {}
export class FailedOnChainError extends Error {}

export async function verifyLandedSwap(params: {
  signature: string;
  agentWallet: string;
  targetMint: string;
}): Promise<LandedSwap> {
  const tx = await connection().getTransaction(params.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new NotLandedError("Transaction not found at confirmed commitment.");
  if (tx.meta?.err) {
    throw new FailedOnChainError(`Transaction failed on chain: ${JSON.stringify(tx.meta.err)}`);
  }

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const matches = (b: { owner?: string | null; mint: string }) =>
    b.owner === params.agentWallet && b.mint === params.targetMint;

  const before = pre.filter(matches).reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
  const after = post.filter(matches).reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
  const actualOutRaw = after - before;

  if (actualOutRaw <= 0n) {
    throw new FailedOnChainError(
      "Transaction landed but the agent's balance of the target mint did not increase.",
    );
  }

  const treasurySpentLamports = treasuryDelta(tx);

  return {
    slot: BigInt(tx.slot),
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    actualOutRaw,
    treasurySpentLamports,
  };
}

/**
 * Net lamports the treasury account lost in this transaction.
 *
 * Only static account keys are scanned. That is sufficient here because the
 * treasury signs, and signers can never live in an address lookup table — which
 * also avoids having to resolve lookups just to read one balance.
 */
function treasuryDelta(tx: {
  transaction: { message: { staticAccountKeys: PublicKey[] } };
  meta?: { preBalances: number[]; postBalances: number[] } | null;
}): bigint {
  const meta = tx.meta;
  if (!meta) return 0n;
  const keys = tx.transaction.message.staticAccountKeys;
  for (let i = 0; i < keys.length && i < meta.preBalances.length; i++) {
    if (keys[i].equals(TREASURY_PUBKEY)) {
      return BigInt(meta.preBalances[i]) - BigInt(meta.postBalances[i]);
    }
  }
  return 0n;
}
