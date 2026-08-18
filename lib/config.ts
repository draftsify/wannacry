import { PublicKey } from "@solana/web3.js";
import { envInt, envOptional, envStr } from "@/lib/env";

/**
 * Protocol parameters. Anything an operator can tune lives here, so that
 * changing the economics never means editing a route handler.
 */

/** Patient Zero. The token whose trading fees fund the treasury. */
export const MAIN_MINT = new PublicKey(
  envStr("NEXT_PUBLIC_MAIN_MINT", "So11111111111111111111111111111111111111112"),
);

/** Wrapped SOL — the input mint for every swap, since allocations are in SOL. */
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export const TREASURY_PUBKEY = new PublicKey(
  envStr("NEXT_PUBLIC_TREASURY_PUBKEY", "11111111111111111111111111111111"),
);

/** How long an epoch stays OPEN for spending. */
export const EPOCH_DURATION_HOURS = envInt("EPOCH_DURATION_HOURS", 24);

/**
 * Share of the treasury made available in a single epoch, in basis points.
 * Deliberately well under 10000: the treasury must survive an epoch where every
 * agent spends everything.
 */
export const DISTRIBUTION_BPS = envInt("DISTRIBUTION_BPS", 2000);

/** Lamports the treasury always keeps back for rent and transaction fees. */
export const TREASURY_RESERVE_LAMPORTS = BigInt(
  envOptional("TREASURY_RESERVE_LAMPORTS") ?? "50000000",
);

/**
 * Minimum raw Main Token balance a wallet needs at the snapshot slot to be
 * eligible. The cheapest anti-Sybil measure there is: splitting a bag across
 * N wallets stops being free once each wallet must clear a floor.
 */
export const MIN_HOLDING_RAW = BigInt(envOptional("MIN_HOLDING_RAW") ?? "1");

/** Allocations below this are not worth a transaction fee, so they are skipped. */
export const MIN_ALLOCATION_LAMPORTS = BigInt(
  envOptional("MIN_ALLOCATION_LAMPORTS") ?? "1000000",
);

/** Default swap slippage. Users may raise it, up to MAX_SLIPPAGE_BPS. */
export const DEFAULT_SLIPPAGE_BPS = envInt("DEFAULT_SLIPPAGE_BPS", 100);
export const MAX_SLIPPAGE_BPS = envInt("MAX_SLIPPAGE_BPS", 1500);

/**
 * How long a prepared transaction holds its reservation. Must comfortably
 * exceed a Solana blockhash lifetime (~60s) so we never release a reservation
 * for a transaction that can still land.
 */
export const INTENT_TTL_SECONDS = envInt("INTENT_TTL_SECONDS", 180);

/** Price impact above this blocks execution outright rather than warning. */
export const MAX_PRICE_IMPACT_PCT = Number(envOptional("MAX_PRICE_IMPACT_PCT") ?? "15");

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function formatSol(lamports: bigint | number, dp = 4): string {
  return lamportsToSol(lamports).toFixed(dp);
}

/**
 * Domain shown in every signed message. Lives here rather than in lib/auth.ts so
 * that lib/intent.ts — the code that decides what bytes a user signs — has no
 * dependency on request context or the database, and can be exercised directly.
 */
export const SIGN_IN_DOMAIN = envOptional("NEXT_PUBLIC_APP_DOMAIN") ?? "patient-zero.local";
