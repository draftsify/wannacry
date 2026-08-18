import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { assertServer, envStr, envOptional } from "@/lib/env";

export const RPC_URL = envStr("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection(RPC_URL, { commitment: "confirmed" });
  return conn;
}

/**
 * The treasury signer. MVP trust assumption, stated plainly: this is a hot key
 * with spending authority over epoch capital. Keep only an epoch's worth of SOL
 * on it, and see docs/ARCHITECTURE.md for the program-owned PDA that replaces
 * it in Phase 4.
 */
export function treasuryKeypair(): Keypair {
  assertServer("lib/solana.ts treasuryKeypair()");
  const secret = envStr("TREASURY_SECRET_KEY");
  const bytes = secret.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(secret))
    : bs58.decode(secret.trim());
  return Keypair.fromSecretKey(bytes);
}

export function isValidPubkey(s: string): boolean {
  try {
    // A base58 string can decode to 32 bytes and still be nonsense, but
    // PublicKey rejects anything that is not 32 bytes, which is the real filter.
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export function shortAddress(s: string, n = 4): string {
  return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}...${s.slice(-n)}`;
}

export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}${solscanCluster()}`;
}

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}${solscanCluster()}`;
}

function solscanCluster(): string {
  const cluster = envOptional("NEXT_PUBLIC_SOLANA_CLUSTER");
  return cluster && cluster !== "mainnet-beta" ? `?cluster=${cluster}` : "";
}

/** Treasury lamports at the given commitment. */
export async function treasuryBalance(pubkey: PublicKey): Promise<bigint> {
  return BigInt(await connection().getBalance(pubkey, "confirmed"));
}
