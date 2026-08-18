import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * A minimal sha256 merkle tree over the epoch snapshot.
 *
 * The point of publishing this root on-chain is not to enable trustless claims
 * today — the MVP treasury is a hot key, so a root proves nothing about custody.
 * It proves something narrower and still worth having: that the operator cannot
 * quietly rewrite who was eligible or for how much *after* the fact. The root is
 * committed before any allocation is spendable.
 */

const LEAF_PREFIX = "PZ-LEAF:";
const NODE_PREFIX = "PZ-NODE:";

export interface SnapshotLeaf {
  wallet: string;
  allocationLamports: bigint;
}

/** Domain-separated leaf hash. The prefix stops a leaf from being reinterpreted
 *  as an internal node, which is the classic merkle forgery. */
export function hashLeaf(leaf: SnapshotLeaf): string {
  return bytesToHex(
    sha256(utf8ToBytes(`${LEAF_PREFIX}${leaf.wallet}:${leaf.allocationLamports.toString()}`)),
  );
}

function hashNode(a: string, b: string): string {
  // Sort the pair so the tree is independent of sibling ordering.
  const [x, y] = a <= b ? [a, b] : [b, a];
  return bytesToHex(sha256(utf8ToBytes(`${NODE_PREFIX}${x}${y}`)));
}

/** Root over the leaf set. Leaves are sorted by wallet first, so the same
 *  snapshot always yields the same root regardless of RPC response ordering. */
export function merkleRoot(leaves: SnapshotLeaf[]): string {
  if (leaves.length === 0) return bytesToHex(sha256(utf8ToBytes(`${LEAF_PREFIX}empty`)));

  const sorted = [...leaves].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  let level = sorted.map(hashLeaf);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      // Odd tail promotes unchanged rather than pairing with itself, which
      // avoids the duplicate-leaf ambiguity that bit several airdrop contracts.
      next.push(i + 1 < level.length ? hashNode(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}
