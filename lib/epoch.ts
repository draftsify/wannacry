import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Epoch } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { connection, treasuryKeypair } from "@/lib/solana";
import { readHolders } from "@/lib/snapshot";
import { formula } from "@/lib/allocation";
import { merkleRoot } from "@/lib/merkle";
import {
  DISTRIBUTION_BPS,
  EPOCH_DURATION_HOURS,
  MAIN_MINT,
  TREASURY_PUBKEY,
  TREASURY_RESERVE_LAMPORTS,
} from "@/lib/config";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export async function currentEpoch(): Promise<Epoch | null> {
  return prisma.epoch.findFirst({ where: { status: "OPEN" }, orderBy: { index: "desc" } });
}

/**
 * Opens a new epoch: read holders, freeze allocations, commit the root on-chain.
 *
 * Ordering matters. The snapshot rows and the merkle root are written before the
 * epoch becomes spendable, so the answer to "what was I allocated" is fixed
 * before anyone can act on it. Wallets that move tokens afterwards change
 * nothing about this epoch — that is the entire reason the snapshot exists as a
 * table rather than as a live query.
 */
export async function openEpoch(opts: { anchor?: boolean } = {}): Promise<Epoch> {
  const existing = await currentEpoch();
  if (existing) throw new Error(`Epoch ${existing.index} is still OPEN. Close it first.`);

  const balance = BigInt(await connection().getBalance(TREASURY_PUBKEY, "finalized"));
  const spendable = balance > TREASURY_RESERVE_LAMPORTS ? balance - TREASURY_RESERVE_LAMPORTS : 0n;
  const distributable = (spendable * BigInt(DISTRIBUTION_BPS)) / 10000n;
  if (distributable <= 0n) throw new Error("Treasury has nothing distributable.");

  const { slot, holders } = await readHolders(MAIN_MINT);
  const holderRows = [...holders.entries()]
    .map(([wallet, rawBalance]) => ({ wallet, rawBalance }))
    // Excluded because it would allocate the treasury a share of itself.
    .filter((h) => h.wallet !== TREASURY_PUBKEY.toBase58());

  const rows = formula.compute(holderRows, distributable);
  if (rows.length === 0) throw new Error("Formula produced no eligible allocations.");

  const root = merkleRoot(
    rows.map((r) => ({ wallet: r.wallet, allocationLamports: r.allocationLamports })),
  );
  // Headline figure for the dashboard. Under a uniform formula every row is
  // identical, so this is literally "each". Under a weighted formula it is the
  // median and the UI says so — reporting one holder's number as everyone's
  // would be exactly the kind of pleasant-looking lie this project avoids.
  const sortedAllocations = rows.map((r) => r.allocationLamports).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const headlineAllocation = sortedAllocations[Math.floor(sortedAllocations.length / 2)];
  const snapshotTakenAt = new Date();
  const index = ((await prisma.epoch.aggregate({ _max: { index: true } }))._max.index ?? 0) + 1;

  const epoch = await prisma.$transaction(async (tx) => {
    const created = await tx.epoch.create({
      data: {
        index,
        status: "OPEN",
        snapshotSlot: slot,
        snapshotTakenAt,
        merkleRoot: root,
        distributableLamports: distributable,
        eligibleHolders: rows.length,
        allocationLamports: headlineAllocation,
        formula: formula.name,
        closesAt: new Date(Date.now() + EPOCH_DURATION_HOURS * 3600_000),
      },
    });

    await tx.holderSnapshot.createMany({
      data: rows.map((r) => ({
        epochId: created.id,
        wallet: r.wallet,
        rawBalance: r.rawBalance,
        weight: r.weight,
        allocationLamports: r.allocationLamports,
      })),
    });

    await tx.agentAllocation.createMany({
      data: rows.map((r) => ({
        epochId: created.id,
        wallet: r.wallet,
        allocatedLamports: r.allocationLamports,
      })),
    });

    return created;
  });

  if (opts.anchor !== false) {
    try {
      const sig = await anchorRoot(epoch.index, root);
      return prisma.epoch.update({ where: { id: epoch.id }, data: { anchorTxSig: sig } });
    } catch (err) {
      // A failed anchor weakens the tamper-evidence but must not strand an epoch
      // whose allocations are already written and correct.
      console.error("[epoch] anchor failed", err);
    }
  }
  return epoch;
}

/** Writes the snapshot root on-chain as a memo signed by the treasury. */
async function anchorRoot(index: number, root: string): Promise<string> {
  const payer = treasuryKeypair();
  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`patient-zero:epoch:${index}:root:${root}`, "utf8"),
    }),
  );
  return sendAndConfirmTransaction(connection(), tx, [payer], { commitment: "confirmed" });
}

/** Closes an epoch. Unspent allocation simply stops being spendable and stays
 *  in the treasury for the next snapshot to distribute. */
export async function closeEpoch(epochId: string): Promise<void> {
  await prisma.epoch.update({
    where: { id: epochId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
}
