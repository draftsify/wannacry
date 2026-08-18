-- Run once after `npm run db:push`:
--   psql "$DIRECT_URL" -f prisma/constraints.sql
--
-- These are the invariants that must hold even if application code has a bug.
-- Postgres is the last line of defence against a wallet spending more than it
-- was allocated; lib/allocation.ts relies on the first constraint firing rather
-- than on its own arithmetic being correct under concurrency.

ALTER TABLE agent_allocations
  DROP CONSTRAINT IF EXISTS agent_allocations_within_budget;
ALTER TABLE agent_allocations
  ADD CONSTRAINT agent_allocations_within_budget
  CHECK (reserved_lamports >= 0
     AND spent_lamports >= 0
     AND reserved_lamports + spent_lamports <= allocated_lamports);

ALTER TABLE propagation_events
  DROP CONSTRAINT IF EXISTS propagation_events_positive_amount;
ALTER TABLE propagation_events
  ADD CONSTRAINT propagation_events_positive_amount
  CHECK (lamports_allocated > 0);

-- An asset can never be its own lineage parent. Deeper cycles are impossible by
-- construction (a parent always predates its child's first infection), so this
-- only has to catch the degenerate self-edge.
ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_no_self_parent;
ALTER TABLE assets
  ADD CONSTRAINT assets_no_self_parent
  CHECK (lineage_parent_mint IS NULL OR lineage_parent_mint <> mint);
