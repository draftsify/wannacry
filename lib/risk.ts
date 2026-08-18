import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getMint,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
} from "@solana/spl-token";
import { connection } from "@/lib/solana";
import { envOptional } from "@/lib/env";
import { MAIN_MINT, MAX_PRICE_IMPACT_PCT } from "@/lib/config";

/**
 * Everything the user is shown before they approve, plus the checks that block
 * outright.
 *
 * Fixed vocabulary, by design. Risk flags are enum-like strings produced by this
 * file — never text pulled off-chain. Anything a token author controls is data
 * to be displayed and escaped, never a value the system branches on and never,
 * under any circumstance, text that reaches a model as instructions.
 */

export type RiskFlag =
  | "MINT_AUTHORITY_ACTIVE"
  | "FREEZE_AUTHORITY_ACTIVE"
  | "TOKEN_2022"
  | "TRANSFER_HOOK"
  | "TRANSFER_FEE"
  | "PERMANENT_DELEGATE"
  | "DEFAULT_FROZEN"
  | "UNVERIFIED_TOKEN"
  | "HIGH_PRICE_IMPACT"
  | "IMPERSONATES_MAIN"
  | "NO_METADATA";

export const RISK_COPY: Record<RiskFlag, string> = {
  MINT_AUTHORITY_ACTIVE: "Mint authority is live — supply can still be inflated.",
  FREEZE_AUTHORITY_ACTIVE: "Freeze authority is live — your token account can be frozen.",
  TOKEN_2022: "Token-2022 mint. Check the extensions below before proceeding.",
  TRANSFER_HOOK: "Transfer hook: an arbitrary program runs on every transfer. You may be unable to sell.",
  TRANSFER_FEE: "Transfer fee extension — a cut is taken on every transfer.",
  PERMANENT_DELEGATE: "Permanent delegate: a third party can move your tokens without asking.",
  DEFAULT_FROZEN: "New accounts default to frozen — you may not be able to trade what you buy.",
  UNVERIFIED_TOKEN: "Not on a verified token list. Symbol and name are unvetted, attacker-supplied text.",
  HIGH_PRICE_IMPACT: "High price impact — liquidity is thin relative to this order.",
  IMPERSONATES_MAIN: "Symbol or name imitates the Main Token but this is a different mint.",
  NO_METADATA: "No resolvable metadata for this mint.",
};

/** Flags severe enough to refuse rather than warn. */
const BLOCKING: RiskFlag[] = ["TRANSFER_HOOK", "DEFAULT_FROZEN"];

export interface MintInfo {
  mint: string;
  decimals: number;
  tokenProgram: PublicKey;
  supply: string;
  flags: RiskFlag[];
}

export async function inspectMint(mint: PublicKey): Promise<MintInfo> {
  const account = await connection().getAccountInfo(mint, "confirmed");
  if (!account) throw new Error("Mint account does not exist.");

  const owner = account.owner;
  const isToken2022 = owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!isToken2022 && !owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("Address is not an SPL token mint.");
  }

  const info = await getMint(connection(), mint, "confirmed", owner);
  const flags: RiskFlag[] = [];

  if (info.mintAuthority) flags.push("MINT_AUTHORITY_ACTIVE");
  if (info.freezeAuthority) flags.push("FREEZE_AUTHORITY_ACTIVE");

  if (isToken2022) {
    flags.push("TOKEN_2022");
    // Each getter throws on a mint without that extension, so each is guarded
    // individually — one missing extension must not hide the others.
    try {
      const hook = getTransferHook(info);
      if (hook && !hook.programId.equals(PublicKey.default)) flags.push("TRANSFER_HOOK");
    } catch {}
    try {
      if (getTransferFeeConfig(info)) flags.push("TRANSFER_FEE");
    } catch {}
    try {
      if (getPermanentDelegate(info)) flags.push("PERMANENT_DELEGATE");
    } catch {}
    try {
      const state = getDefaultAccountState(info);
      if (state && state.state !== 1) flags.push("DEFAULT_FROZEN");
    } catch {}
  }

  return {
    mint: mint.toBase58(),
    decimals: info.decimals,
    tokenProgram: owner,
    supply: info.supply.toString(),
    flags,
  };
}

export function blockingFlags(flags: RiskFlag[]): RiskFlag[] {
  return flags.filter((f) => BLOCKING.includes(f));
}

export function priceImpactFlags(priceImpactPct: number): RiskFlag[] {
  return priceImpactPct >= MAX_PRICE_IMPACT_PCT ? ["HIGH_PRICE_IMPACT"] : [];
}

/* ------------------------------------------------------------------ */
/* Metadata — untrusted input from here down                           */
/* ------------------------------------------------------------------ */

export interface TokenMetadata {
  symbol: string | null;
  name: string | null;
  verified: boolean;
}

/**
 * Strips anything that could break out of a rendering or prompting context.
 * Control characters, bidi overrides (the trick that makes "TSU" render as
 * "UST"), and newlines all go. Length is capped so a megabyte name cannot be
 * used as a denial-of-service or to bury a suffix past a truncation point.
 */
export function sanitizeText(input: unknown, maxLength = 64): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

const MAIN_SYMBOL = envOptional("NEXT_PUBLIC_MAIN_SYMBOL");

/** Cheap homoglyph-insensitive comparison against the Main Token's symbol. */
export function impersonationFlags(meta: TokenMetadata, mint: string): RiskFlag[] {
  if (!MAIN_SYMBOL || mint === MAIN_MINT.toBase58()) return [];
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/0/g, "o").replace(/1/g, "l");
  const target = fold(MAIN_SYMBOL);
  const candidates = [meta.symbol, meta.name].filter((s): s is string => !!s).map(fold);
  return candidates.some((c) => c === target) ? ["IMPERSONATES_MAIN"] : [];
}

/** Best-effort metadata lookup. Failure is normal and never blocks a quote. */
export async function fetchMetadata(mint: string): Promise<TokenMetadata> {
  const base = envOptional("JUPITER_TOKEN_API_BASE") ?? "https://lite-api.jup.ag/tokens/v2";
  try {
    const res = await fetch(`${base}/search?query=${encodeURIComponent(mint)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { symbol: null, name: null, verified: false };

    const body = (await res.json()) as unknown;
    const list = Array.isArray(body) ? body : [];
    const hit = list.find(
      (t): t is Record<string, unknown> =>
        typeof t === "object" && t !== null && (t as Record<string, unknown>).id === mint,
    );
    if (!hit) return { symbol: null, name: null, verified: false };

    return {
      symbol: sanitizeText(hit.symbol, 16),
      name: sanitizeText(hit.name, 64),
      // Only an explicit true counts; a missing field is not a vote of confidence.
      verified: hit.isVerified === true,
    };
  } catch {
    return { symbol: null, name: null, verified: false };
  }
}
