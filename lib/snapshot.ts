import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection } from "@/lib/solana";

/**
 * Reads the complete Main Token holder set in one shot and reports the slot it
 * was actually read at.
 *
 * Determinism note: there is no RPC that answers "give me holders as of slot X"
 * for an arbitrary past slot. So rather than pretend, we take the reading, keep
 * the slot the RPC reports alongside it, and freeze the result. The epoch is
 * defined by that recorded slot, and nothing recomputes afterwards.
 */

export interface HolderReading {
  slot: bigint;
  holders: Map<string, bigint>;
}

/** Offsets into an SPL token account: mint(0..32) owner(32..64) amount(64..72). */
const OWNER_OFFSET = 32;
const SLICE_LENGTH = 40; // owner + amount

export async function readHolders(mint: PublicKey): Promise<HolderReading> {
  const holders = new Map<string, bigint>();
  let slot = 0n;

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await connection().getProgramAccounts(programId, {
      commitment: "finalized",
      withContext: true,
      // Only the owner and amount are needed; pulling full 165-byte accounts for
      // a token with thousands of holders is megabytes of wasted transfer.
      dataSlice: { offset: OWNER_OFFSET, length: SLICE_LENGTH },
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }],
    });

    if (res.context.slot > Number(slot)) slot = BigInt(res.context.slot);

    for (const { account } of res.value) {
      const data = account.data as Buffer;
      if (data.length < SLICE_LENGTH) continue;
      const owner = new PublicKey(data.subarray(0, 32)).toBase58();
      const amount = data.readBigUInt64LE(32);
      if (amount === 0n) continue;
      // A wallet can hold the same mint in several token accounts; the holder's
      // position is the sum, not whichever account the RPC returned last.
      holders.set(owner, (holders.get(owner) ?? 0n) + amount);
    }
  }

  if (slot === 0n) {
    throw new Error(
      "Holder read returned no context slot. The RPC likely does not support " +
        "getProgramAccounts — use Helius, Triton or another indexing provider.",
    );
  }

  return { slot, holders };
}
