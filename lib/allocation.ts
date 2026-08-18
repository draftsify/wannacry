import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MIN_ALLOCATION_LAMPORTS, MIN_HOLDING_RAW } from "@/lib/config";

/**
 * Allocation lives behind this seam on purpose. Two things will change later —
 * the formula (equal split is a placeholder) and the ledger (Postgres today, a
 * program-owned PDA in Phase 4) — and neither should reach the routes that call
 * reserve / settle / release.
 */

export interface HolderRow {
  wallet: string;
  rawBalance: bigint;
}

export interface AllocationRow extends HolderRow {
  weight: string; // decimal string, kept as text so no precision is lost
  allocationLamports: bigint;
}

export interface AllocationFormula {
  readonly name: string;
  compute(holders: HolderRow[], distributableLamports: bigint): AllocationRow[];
}

/**
 * MVP formula: every eligible wallet gets an identical share.
 *
 * This is knowingly the most Sybil-farmable option there is — a whale splitting
 * into N wallets multiplies its take by N. It ships first because it makes the
 * propagation loop observable with the fewest moving parts, and MIN_HOLDING_RAW
 * puts a floor on how cheap the attack is. Replace it before real capital flows;
 * candidates are sketched in docs/ARCHITECTURE.md.
 */
export const equalFormula: AllocationFormula = {
  name: "equal",
  compute(holders, distributableLamports) {
    const eligible = holders.filter((h) => h.rawBalance >= MIN_HOLDING_RAW);
    if (eligible.length === 0) return [];

    const per = distributableLamports / BigInt(eligible.length);
    if (per < MIN_ALLOCATION_LAMPORTS) return [];

    return eligible.map((h) => ({ ...h, weight: "1", allocationLamports: per }));
  },
};

/**
 * Holding-weighted, pro rata. **This is the intended successor to equalFormula.**
 *
 * It is the only one of the three that is neutral to wallet-splitting: a bag of
 * X split across N wallets receives the same total as it would in one wallet,
 * because each wallet's share is linear in its balance and the denominator is
 * unchanged. Splitting costs transaction fees and gains nothing.
 *
 * Not wired up — `formula` below still points at equalFormula for the MVP.
 */
export const proportionalFormula: AllocationFormula = {
  name: "proportional",
  compute(holders, distributableLamports) {
    const eligible = holders.filter((h) => h.rawBalance >= MIN_HOLDING_RAW);
    if (eligible.length === 0) return [];

    const total = eligible.reduce((sum, h) => sum + h.rawBalance, 0n);
    if (total <= 0n) return [];

    const rows: AllocationRow[] = [];
    for (const h of eligible) {
      // Integer maths throughout: floats lose precision on raw token balances,
      // which routinely exceed 2^53.
      const share = (distributableLamports * h.rawBalance) / total;
      if (share < MIN_ALLOCATION_LAMPORTS) continue;
      rows.push({ ...h, weight: h.rawBalance.toString(), allocationLamports: share });
    }
    return rows;
  },
};

/**
 * Square-root weighted. Included because it is the obvious thing to reach for,
 * and because it is worth being precise about what it does and does not do.
 *
 * It flattens whales relative to proportional weighting. It does NOT resist
 * wallet-splitting — the opposite. Since sqrt(a) + sqrt(b) > sqrt(a + b), a
 * holder who splits a bag raises their own numerator while the denominator moves
 * less, so splitting is mildly *profitable*. This is the same property that
 * forces quadratic funding to rely on identity verification. Use it only with an
 * independent Sybil defence in place.
 */
export const sqrtFormula: AllocationFormula = {
  name: "sqrt",
  compute(holders, distributableLamports) {
    const eligible = holders.filter((h) => h.rawBalance >= MIN_HOLDING_RAW);
    if (eligible.length === 0) return [];

    const weights = eligible.map((h) => Math.sqrt(Number(h.rawBalance)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return [];

    const rows: AllocationRow[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const share = BigInt(Math.floor((Number(distributableLamports) * weights[i]) / total));
      if (share < MIN_ALLOCATION_LAMPORTS) continue;
      rows.push({ ...eligible[i], weight: weights[i].toFixed(18), allocationLamports: share });
    }
    return rows;
  },
};

export const formula: AllocationFormula = equalFormula;

/* ------------------------------------------------------------------ */
/* Ledger operations                                                   */
/* ------------------------------------------------------------------ */

/**
 * Reserve lamports against a wallet's epoch budget.
 *
 * The guard lives in the WHERE clause, not in TypeScript. A single conditional
 * UPDATE is atomic under any isolation level, so two prepare requests racing on
 * the same allocation cannot both succeed — the second one matches zero rows.
 * This is the mechanism that makes double-spending impossible; the CHECK
 * constraint in constraints.sql is only there to catch a future bug here.
 */
export async function reserve(
  tx: Prisma.TransactionClient,
  allocationId: string,
  lamports: bigint,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE agent_allocations
       SET reserved_lamports = reserved_lamports + ${lamports},
           updated_at = NOW()
     WHERE id = ${allocationId}
       AND reserved_lamports + spent_lamports + ${lamports} <= allocated_lamports
  `;
  return updated === 1;
}

/** Reservation becomes spend. Called only after on-chain confirmation. */
export async function settle(
  tx: Prisma.TransactionClient,
  allocationId: string,
  lamports: bigint,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE agent_allocations
       SET reserved_lamports = reserved_lamports - ${lamports},
           spent_lamports = spent_lamports + ${lamports},
           updated_at = NOW()
     WHERE id = ${allocationId}
       AND reserved_lamports >= ${lamports}
  `;
  return updated === 1;
}

/** Reservation returns to the budget. Called on failure or expiry. */
export async function release(
  tx: Prisma.TransactionClient,
  allocationId: string,
  lamports: bigint,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE agent_allocations
       SET reserved_lamports = reserved_lamports - ${lamports},
           updated_at = NOW()
     WHERE id = ${allocationId}
       AND reserved_lamports >= ${lamports}
  `;
  return updated === 1;
}
