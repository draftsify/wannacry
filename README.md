# Patient Zero

Main Token trading fees fund a treasury. Each epoch, a share is allocated to
holders from a frozen snapshot. Holders direct their own allocation — back into
the Main Token, or into any Solana mint they name — and the resulting propagation
graph is derived from confirmed on-chain transactions.

Design, definitions and threat model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The loop this proves

```
Main Token → treasury → epoch snapshot → holder connects → allocation appears
→ holder picks Main or another mint → user signs authorization + transaction
→ swap executes → event verified from chain → graph updates
```

## Setup

```bash
npm install
cp .env.example .env
npm run treasury:new        # generates the treasury key straight into .env
```

Fill in `.env`:

- `DATABASE_URL` / `DIRECT_URL` — any Postgres (Neon, Supabase).
- `SOLANA_RPC_URL` — **must support `getProgramAccounts`.** The public mainnet
  endpoint does not; the snapshot will fail against it. Helius or Triton work.
- `NEXT_PUBLIC_MAIN_MINT` — Patient Zero's mint.
- `SESSION_SECRET`, `CRON_SECRET` — `openssl rand -hex 32` each.

Then:

```bash
npm run db:push
psql "$DIRECT_URL" -f prisma/constraints.sql   # spend invariants — do not skip
npm run dev
```

Fund the treasury address printed by `treasury:new`, then open the first epoch:

```bash
npm run epoch:open
```

Visit `/` for the landing page, `/network` for the explorer, and `/agent` to
connect a wallet.

## Routes

| Route | Needs a database | What it is |
|---|---|---|
| `/` | no | Landing page. Static, so it stays up when the indexer is down. |
| `/network` | yes | The explorer: treasury, epoch, propagation tree, recent infections. |
| `/asset/[mint]` | yes | Per-asset lineage, metrics, infection log. |
| `/agent` | yes | Connect a wallet and direct your allocation. |

## Testing without real capital

Set `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` and point the RPC at devnet. Note that
Jupiter has no devnet deployment, so quotes will fail there — to exercise the
full swap path you need mainnet with a small treasury balance. Set
`DISTRIBUTION_BPS` low and `MIN_ALLOCATION_LAMPORTS` to something tiny while
testing.

## What is deliberately not built yet

- **The on-chain program.** The MVP treasury is a hot key that can spend epoch
  capital. Keep one epoch of SOL on it. Phase 4 replaces it with a program PDA.
- **A Sybil-resistant formula.** Equal split is farmable by wallet-splitting.
  `proportionalFormula` in `lib/allocation.ts` is the intended successor — and
  note that sqrt weighting is *not* a Sybil defence, it rewards splitting.
- **The LLM agent.** The console explains and executes deterministically. No
  model is in the loop, and none should ever be able to initiate a trade.

## Cron

Two jobs, both accepting POST (and GET, for Vercel) with an
`Authorization: Bearer $CRON_SECRET` header.

| Job | Cadence | Driven by |
|---|---|---|
| `/api/cron/epoch` | daily | Vercel cron (`vercel.json`) |
| `/api/cron/reconcile` | every 5 min | GitHub Actions (`.github/workflows/reconcile.yml`) |

Reconciliation runs from GitHub Actions because Vercel's Hobby plan caps cron
jobs at once per day, and once per day is far too slow for a job that releases
allocation held by unsigned prepares. On a Pro plan, move it back into
`vercel.json` at `*/2 * * * *` and delete the workflow.

The workflow needs two repository secrets: `APP_URL` (no trailing slash) and
`CRON_SECRET` (matching the Vercel environment variable).
