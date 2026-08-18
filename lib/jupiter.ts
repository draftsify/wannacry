import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { connection, treasuryKeypair } from "@/lib/solana";
import { envOptional } from "@/lib/env";
import { TREASURY_PUBKEY, WSOL_MINT } from "@/lib/config";
import { MEMO_PROGRAM_ID } from "@/lib/epoch";

const JUP_BASE = envOptional("JUPITER_API_BASE") ?? "https://lite-api.jup.ag/swap/v1";
const JUP_KEY = envOptional("JUPITER_API_KEY");

export interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{ swapInfo?: { label?: string } }>;
  [k: string]: unknown;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (JUP_KEY) h["x-api-key"] = JUP_KEY;
  return h;
}

export async function getQuote(params: {
  outputMint: string;
  lamports: bigint;
  slippageBps: number;
}): Promise<JupQuote> {
  const url = new URL(`${JUP_BASE}/quote`);
  url.searchParams.set("inputMint", WSOL_MINT.toBase58());
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.lamports.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps));
  url.searchParams.set("swapMode", "ExactIn");
  // Multi-hop routes through obscure intermediates are where sandwich and
  // honeypot routes hide. Restricting intermediates costs a little price and
  // removes a whole class of hostile route.
  url.searchParams.set("restrictIntermediateTokens", "true");

  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No route available (Jupiter ${res.status}: ${(await res.text()).slice(0, 200)})`);
  }
  return (await res.json()) as JupQuote;
}

export function routeLabels(quote: JupQuote): string[] {
  return quote.routePlan.map((r) => r.swapInfo?.label ?? "unknown");
}

interface JupIx {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}

function toInstruction(ix: JupIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

export interface BuiltAllocationTx {
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  destinationTokenAccount: string;
}

/**
 * Composes the allocation transaction.
 *
 * The shape is the point. Jupiter's own /swap endpoint returns a finished
 * transaction whose only required signer is the funding wallet — here, the
 * treasury. That would let the backend spend a user's allocation with no user
 * involvement at all. So we take raw instructions instead and compile the
 * message ourselves with the **user as fee payer**, which makes their signature
 * mandatory for the transaction to be valid, and prepend a memo committing to
 * the intent they signed. Two signatures, one of them theirs, and an on-chain
 * record of what they agreed to.
 */
export async function buildAllocationTransaction(params: {
  quote: JupQuote;
  agentWallet: PublicKey;
  targetMint: PublicKey;
  targetTokenProgram: PublicKey;
  memo: string;
}): Promise<BuiltAllocationTx> {
  const treasury = treasuryKeypair();

  // The user receives the tokens; the treasury only provides the SOL.
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    params.targetMint,
    params.agentWallet,
    false,
    params.targetTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const res = await fetch(`${JUP_BASE}/swap-instructions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: params.quote,
      userPublicKey: TREASURY_PUBKEY.toBase58(),
      destinationTokenAccount: destinationTokenAccount.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "medium" } },
    }),
  });
  if (!res.ok) {
    throw new Error(`Swap build failed (Jupiter ${res.status}: ${(await res.text()).slice(0, 200)})`);
  }

  const body = (await res.json()) as {
    computeBudgetInstructions?: JupIx[];
    setupInstructions?: JupIx[];
    swapInstruction: JupIx;
    cleanupInstruction?: JupIx | null;
    addressLookupTableAddresses?: string[];
    error?: string;
  };
  if (body.error) throw new Error(`Swap build failed: ${body.error}`);

  const memoIx = new TransactionInstruction({
    keys: [{ pubkey: params.agentWallet, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(params.memo, "utf8"),
  });

  // Jupiter will not create a destination account it does not own, so the
  // treasury pays that rent itself. Idempotent: harmless if the user already
  // holds the token.
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    TREASURY_PUBKEY,
    destinationTokenAccount,
    params.agentWallet,
    params.targetMint,
    params.targetTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const instructions: TransactionInstruction[] = [
    ...(body.computeBudgetInstructions ?? []).map(toInstruction),
    memoIx,
    createAtaIx,
    ...(body.setupInstructions ?? []).map(toInstruction),
    toInstruction(body.swapInstruction),
    ...(body.cleanupInstruction ? [toInstruction(body.cleanupInstruction)] : []),
  ];

  const lookupTables = await resolveLookupTables(body.addressLookupTableAddresses ?? []);
  const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: params.agentWallet,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  // Partially sign: the treasury authorizes the spend, the user's wallet adds
  // the fee-payer signature client-side and the transaction is only then valid.
  tx.sign([treasury]);

  return {
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    blockhash,
    lastValidBlockHeight,
    destinationTokenAccount: destinationTokenAccount.toBase58(),
  };
}

async function resolveLookupTables(addresses: string[]): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];
  const accounts = await Promise.all(
    addresses.map((a) => connection().getAddressLookupTable(new PublicKey(a))),
  );
  return accounts.map((a) => a.value).filter((a): a is AddressLookupTableAccount => a !== null);
}
