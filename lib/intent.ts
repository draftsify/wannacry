import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { SIGN_IN_DOMAIN, formatSol } from "@/lib/config";


/**
 * The allocation intent: the exact, human-readable statement a user signs before
 * any capital moves.
 *
 * Why this exists at all. In the MVP the treasury is the swap's source
 * authority, so the transaction would be valid with the treasury signature
 * alone. The intent closes that gap two ways: the user is the fee payer and
 * therefore a required signer of the transaction itself, and this signed
 * statement — committed on-chain as a memo hash — records precisely what they
 * agreed to. An operator cannot later claim a user approved a different mint or
 * a different amount, because the memo in the landed transaction is the hash of
 * this text and nothing else hashes to it.
 */

export const INTENT_VERSION = "pz-intent-1";
export const MEMO_PREFIX = "pz1:";

export interface AllocationIntent {
  version: string;
  domain: string;
  epochIndex: number;
  agentWallet: string;
  targetMint: string;
  lamports: string;
  minOutRaw: string;
  slippageBps: number;
  nonce: string;
  expiresAt: number; // unix seconds
}

/**
 * Canonical serialization. Field order is fixed and every value is stringified
 * explicitly — the bytes the user signs must never depend on JSON key ordering
 * or on how a runtime prints a number.
 */
export function canonicalIntent(intent: AllocationIntent): string {
  return [
    intent.version,
    `domain=${intent.domain}`,
    `epoch=${intent.epochIndex}`,
    `agent=${intent.agentWallet}`,
    `target=${intent.targetMint}`,
    `lamports=${intent.lamports}`,
    `min_out=${intent.minOutRaw}`,
    `slippage_bps=${intent.slippageBps}`,
    `nonce=${intent.nonce}`,
    `expires=${intent.expiresAt}`,
  ].join("\n");
}

/**
 * What the wallet actually shows the user. The canonical block is appended
 * verbatim so the readable summary and the signed bytes cannot drift apart.
 *
 * Note what is *not* in here: the token's symbol or name. Those are strings the
 * token's author controls, and they have no place in a signed authorization —
 * they can be changed between quote and signature, and a symbol is exactly the
 * field an impersonator crafts. The mint is the only identifier that means
 * anything, so the mint is what gets signed. The UI shows the symbol next to it,
 * clearly marked as unverified.
 */
export function intentDisplayMessage(intent: AllocationIntent): string {
  return [
    `${SIGN_IN_DOMAIN} — allocation authorization`,
    "",
    `Spend ${formatSol(BigInt(intent.lamports))} SOL of your epoch ${intent.epochIndex} allocation`,
    `to buy mint: ${intent.targetMint}`,
    `Minimum received: ${intent.minOutRaw} (raw units), slippage ${intent.slippageBps / 100}%`,
    "",
    "You are also asked to sign the transaction itself in the next step.",
    "This authorization expires in a few minutes and can be used once.",
    "",
    canonicalIntent(intent),
  ].join("\n");
}

export function intentHash(intent: AllocationIntent): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalIntent(intent))));
}

/** The on-chain commitment. Short enough to sit in a memo without bloating fees. */
export function intentMemo(intent: AllocationIntent): string {
  return `${MEMO_PREFIX}${intentHash(intent)}`;
}

export function verifyIntentSignature(intent: AllocationIntent, signatureB58: string): boolean {
  try {
    return ed25519.verify(
      bs58.decode(signatureB58),
      utf8ToBytes(intentDisplayMessage(intent)),
      bs58.decode(intent.agentWallet),
    );
  } catch {
    return false;
  }
}
