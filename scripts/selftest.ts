/**
 * Self-test for the pure logic — no database, no RPC, no network.
 *
 * These are the parts where a silent bug is expensive: what bytes a user signs,
 * whether the snapshot root is stable, and whether the allocation formula does
 * what its docstring claims. Run with `npm test`.
 */
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { merkleRoot } from "@/lib/merkle";
import { equalFormula, proportionalFormula, sqrtFormula } from "@/lib/allocation";
import {
  AllocationIntent,
  INTENT_VERSION,
  canonicalIntent,
  intentDisplayMessage,
  intentHash,
  intentMemo,
  verifyIntentSignature,
} from "@/lib/intent";
import { sanitizeText } from "@/lib/risk";
import { SIGN_IN_DOMAIN } from "@/lib/config";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nmerkle");
{
  const leaves = [
    { wallet: "AAA", allocationLamports: 1_000_000_000n },
    { wallet: "BBB", allocationLamports: 1_000_000_000n },
    { wallet: "CCC", allocationLamports: 500_000_000n },
  ];
  const root = merkleRoot(leaves);

  check("root is stable under input reordering", root === merkleRoot([...leaves].reverse()));
  check(
    "root changes when an allocation changes",
    root !==
      merkleRoot([{ ...leaves[0], allocationLamports: 1_000_000_001n }, leaves[1], leaves[2]]),
  );
  check(
    "root changes when a wallet is added",
    root !== merkleRoot([...leaves, { wallet: "DDD", allocationLamports: 1n }]),
  );
  check("odd leaf counts are handled", merkleRoot(leaves.slice(0, 1)).length === 64);
  check("empty snapshot has a defined root", merkleRoot([]).length === 64);
}

console.log("\nallocation formulas");
{
  const holders = [
    { wallet: "w1", rawBalance: 1_000_000n },
    { wallet: "w2", rawBalance: 4_000_000n },
    { wallet: "w3", rawBalance: 9_000_000n },
  ];
  const pot = 3_000_000_000n;

  const equal = equalFormula.compute(holders, pot);
  check("equal split gives every holder the same amount", new Set(equal.map((r) => r.allocationLamports.toString())).size === 1);
  check("equal split never over-allocates", equal.reduce((s, r) => s + r.allocationLamports, 0n) <= pot);

  const prop = proportionalFormula.compute(holders, pot);
  check("proportional never over-allocates", prop.reduce((s, r) => s + r.allocationLamports, 0n) <= pot);
  check("proportional favours the larger holder", prop[2].allocationLamports > prop[0].allocationLamports);

  // The property that makes proportional the right successor to equal split:
  // splitting a bag across wallets wins nothing.
  const whole = (f: typeof proportionalFormula) =>
    f.compute([{ wallet: "a", rawBalance: 4_000_000n }, { wallet: "z", rawBalance: 4_000_000n }], pot)[0]
      .allocationLamports;
  const split = (f: typeof proportionalFormula) => {
    const rows = f.compute(
      [
        { wallet: "a1", rawBalance: 2_000_000n },
        { wallet: "a2", rawBalance: 2_000_000n },
        { wallet: "z", rawBalance: 4_000_000n },
      ],
      pot,
    );
    return rows[0].allocationLamports + rows[1].allocationLamports;
  };

  const propWhole = whole(proportionalFormula);
  const propSplit = split(proportionalFormula);
  check(
    "proportional is neutral to wallet-splitting (within rounding)",
    propSplit <= propWhole && propWhole - propSplit <= 2n,
    `whole=${propWhole} split=${propSplit}`,
  );

  // Documenting the real behaviour rather than the intuitive one: sqrt is
  // superadditive, so splitting a bag under sqrt weighting pays. This assertion
  // exists so nobody adopts sqrt believing it is a Sybil defence.
  const sqrtWhole = whole(sqrtFormula);
  const sqrtSplit = split(sqrtFormula);
  check(
    "sqrt weighting REWARDS wallet-splitting — not a Sybil defence",
    sqrtSplit > sqrtWhole,
    `whole=${sqrtWhole} split=${sqrtSplit}`,
  );

  // Equal split is the worst case, and the MVP ships with it knowingly.
  const equalWhole = whole(equalFormula);
  const equalSplit = split(equalFormula);
  check(
    "equal split rewards wallet-splitting proportionally to wallet count",
    equalSplit > equalWhole,
    `whole=${equalWhole} split=${equalSplit}`,
  );
}

console.log("\nintent");
{
  const kp = Keypair.generate();
  const intent: AllocationIntent = {
    version: INTENT_VERSION,
    domain: SIGN_IN_DOMAIN,
    epochIndex: 7,
    agentWallet: kp.publicKey.toBase58(),
    targetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    lamports: "730000000",
    minOutRaw: "12345678",
    slippageBps: 100,
    nonce: "a".repeat(32),
    expiresAt: 1_800_000_000,
  };

  const message = intentDisplayMessage(intent);
  // Sign exactly as a wallet does: ed25519 over the raw message bytes.
  const signature = bs58.encode(
    ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32)),
  );

  check("a valid signature verifies", verifyIntentSignature(intent, signature));
  check(
    "changing the mint invalidates the signature",
    !verifyIntentSignature({ ...intent, targetMint: "So11111111111111111111111111111111111111112" }, signature),
  );
  check(
    "changing the amount invalidates the signature",
    !verifyIntentSignature({ ...intent, lamports: "730000001" }, signature),
  );
  check(
    "changing the minimum output invalidates the signature",
    !verifyIntentSignature({ ...intent, minOutRaw: "1" }, signature),
  );
  check(
    "a signature from another wallet is rejected",
    !verifyIntentSignature(
      { ...intent, agentWallet: Keypair.generate().publicKey.toBase58() },
      signature,
    ),
  );
  check("the display message contains the canonical block", message.includes(canonicalIntent(intent)));
  check("the mint appears in what the user reads", message.includes(intent.targetMint));
  check("the memo commits to the intent hash", intentMemo(intent).endsWith(intentHash(intent)));
  check("the memo fits comfortably in a transaction", intentMemo(intent).length < 100);
}

console.log("\nmetadata sanitisation");
{
  check("control characters are stripped", sanitizeText("BAD\u0007NAME") === "BADNAME");
  check("bidi overrides are stripped", sanitizeText("US\u202ETD") === "USTD");
  check("zero-width characters are stripped", sanitizeText("S\u200BOL") === "SOL");
  check("newlines cannot be injected", !(sanitizeText("a\nb") ?? "").includes("\n"));
  check("length is capped", (sanitizeText("x".repeat(500), 16) ?? "").length === 16);
  check("non-strings return null", sanitizeText({ evil: true }) === null);
  check("whitespace-only returns null", sanitizeText("   ") === null);
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
