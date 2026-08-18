# WannaCry — architecture

## 1. What the system is

One token (the **Main Token**, "Patient Zero") generates trading fees. Those fees
accumulate in a treasury. At each **epoch**, a share of the treasury is allocated
to holders who were in the snapshot. A holder connects a wallet, sees their
allocation, and directs it: back into the Main Token, or into any other Solana
mint they name. Each executed allocation is an **infection event**, and the
resulting graph is the product.

The word "infection" is product vocabulary for a user-authorized swap. Nothing in
this system propagates without a human clicking and signing, and the code uses
ordinary financial terms throughout.

## 2. The central design problem

Treasury SOL must be spendable *by a user's decision* but *only into a swap*, and
must never be spendable *by the user directly* — otherwise everyone claims the
SOL and the propagation loop never happens.

Three ways to solve it:

| Option | Custody | Signer | Verdict |
|---|---|---|---|
| A. Anchor program + Jupiter CPI | Treasury PDA | Program CPI, user authorizes by instruction | The correct end state. Needs Rust toolchain, Jupiter CPI, an audit. |
| B. Program releases SOL to the user | Treasury PDA | User | Simple, and pointless — users claim and never propagate. |
| C. Treasury hot key + mandatory user co-signature | Treasury keypair | Treasury (funds) **and** user (fee payer) | Shippable now. Trust assumption: the treasury key. |

**The MVP implements C.** Phase 4 replaces it with A behind the same interface.

### Why C is not just "trust the backend"

The naive version of C is: backend holds the key, backend signs a Jupiter
transaction, user clicks a button. That gives the operator unilateral spending
power and gives the user no provable record of what they agreed to.

Three things close that gap:

1. **The user is the fee payer.** The transaction is not built from Jupiter's
   `/swap` endpoint (whose output has exactly one required signer — the funder).
   It is composed here from `/swap-instructions`, compiled with the *user's*
   wallet as fee payer. The transaction is invalid without the user's signature.
2. **A signed intent, committed on chain.** Before preparing, the user signs a
   canonical text stating epoch, mint, lamports, minimum output, slippage, nonce
   and expiry. Its sha256 goes into a Memo instruction inside the same
   transaction. Anyone can later check that the memo in a landed transaction is
   the hash of the statement the user signed — an operator cannot claim a user
   approved a different mint or amount.
3. **The graph is chain-derived.** An event only becomes `CONFIRMED` after
   `lib/verify.ts` re-reads the transaction and confirms, from its own pre/post
   token balances, that the agent's balance of the target mint actually
   increased. The dashboard renders confirmed events only. The database is an
   index of chain facts, not a ledger of claims.

What C still does not protect against: a compromised treasury key drains the
treasury. That is the honest limit, and it is why the key should hold only one
epoch of capital until Phase 4.

## 3. Definitions

These are load-bearing. `lib/lineage.ts` is the single implementation.

| Term | Definition |
|---|---|
| **Agent** | A wallet with ≥1 `CONFIRMED` event. Unique agents = distinct wallets, never event counts. |
| **Allocation** | Lamports assigned to a wallet by an epoch snapshot. Spendable only into a swap. |
| **Infection event** | One confirmed on-chain swap of allocation into a mint. |
| **Capital source** | Always the treasury (Main Token fees). A constant, not lineage. |
| **Parent** | The previous asset that an asset's **index case** had infected — or Patient Zero if that agent was allocating for the first time. Frozen at first infection. |
| **Child** | Inverse of parent. |
| **Generation** | Depth in the parent tree. `gen(Main) = 0`, `gen(x) = gen(parent) + 1`. |
| **Epoch** | A distribution wave. **Not** a generation. Shown separately in the UI. |
| **Lineage** | The path from an asset up to Patient Zero. |
| **Mutation** | An agent whose target differs from their previous target. |
| **Network penetration** | An asset's unique agents ÷ all active agents. |

### Why parent is defined this way

If parent were always Patient Zero, every graph would be one level deep — a star.
Inventing edges to make it look like a tree would be fabrication.

The rule used is contact tracing: *the first agent who brought capital here had
last taken it there.* Every edge is backed by two confirmed transactions from one
wallet. It is a real behavioural relationship, and it terminates at Patient Zero
because a first-time agent's capital genuinely came from Main Token fees.

**Acyclicity is structural, not enforced.** An asset's parent is set at its first
infection, from an asset that already existed at that moment. So if `parent(A) =
B`, then B's first infection strictly precedes A's, and B's parent cannot be A.
The self-edge case (an agent repeating the same target) is guarded explicitly.

The full behavioural graph — every `prevMint → targetMint` transition with agent
counts — is also computed. The tree is the first-touch subgraph of it.

## 4. Epoch determinism

The requirement: allocations must not change because wallets move tokens after
the snapshot.

The mechanism:

1. `readHolders()` calls `getProgramAccounts` with `withContext: true` and keeps
   the slot the RPC reports. There is no RPC that answers "holders as of slot X"
   for an arbitrary past slot, so the system records the slot it *actually* read
   rather than pretending to choose one.
2. The formula runs once. Rows are written to `holder_snapshots` (immutable
   evidence) and `agent_allocations` (mutable ledger).
3. A sha256 merkle root over sorted `(wallet, allocation)` leaves is written on
   chain as a memo from the treasury **before** allocations are spendable.
4. Nothing recomputes. `/api/agent` reads the frozen row.

The root does not enable trustless claims today — with a hot-key treasury it
proves nothing about custody. It proves something narrower and still useful: the
operator cannot quietly rewrite eligibility after the fact.

## 5. On chain vs off chain

**On chain (today):** the swap itself, the treasury balance, the intent-hash
memo, the epoch root memo. All independently verifiable.

**Off chain:** allocation accounting, the graph, metrics, metadata, search.

**Moves on chain in Phase 4:** allocation accounting and double-spend prevention.

The graph should stay off chain permanently — it is derived data, it is cheap to
rebuild from confirmed transactions, and putting it on chain would buy nothing
that re-deriving it does not already give.

## 6. Data model

See `prisma/schema.prisma`. Seven tables:

- **`epochs`** — snapshot slot, merkle root, distributable, eligible count,
  per-holder allocation, anchor signature.
- **`holder_snapshots`** — immutable per-wallet standing at the snapshot slot.
- **`agent_allocations`** — mutable `allocated / reserved / spent`. A CHECK
  constraint enforces `reserved + spent <= allocated`.
- **`assets`** — one row per mint. Lineage fields frozen at first infection;
  aggregate fields are a rebuildable cache.
- **`propagation_events`** — the event log. A row exists from the moment
  allocation is reserved.
- **`auth_nonces`** — single-use sign-in challenges.

### Double-spend prevention

Not a TypeScript check. A single conditional UPDATE:

```sql
UPDATE agent_allocations
   SET reserved_lamports = reserved_lamports + $1
 WHERE id = $2
   AND reserved_lamports + spent_lamports + $1 <= allocated_lamports
```

One statement is atomic under any isolation level, so two concurrent prepares
cannot both succeed — the loser matches zero rows. The CHECK constraint exists to
catch a future bug in this query, not to do the work.

Event lifecycle: `PREPARED → SUBMITTED → CONFIRMED | FAILED | EXPIRED`. Every
transition is a conditional `updateMany` whose `where` includes the expected
prior status, which makes both settle and fail idempotent under retry.

## 7. The execution path

```
/api/allocate/quote     inspect mint → fetch metadata → Jupiter quote →
                        risk flags → upsert asset → return intent + display text
                        (nothing reserved, safe to repeat)

user signs the intent text

/api/allocate/prepare   re-validate every intent field server-side →
                        re-quote live → refuse if the live minimum is worse than
                        the approved floor → reserve → create PREPARED event →
                        build v0 tx (user = fee payer, treasury partial-signs) →
                        store the exact prepared bytes

user signs the transaction

/api/allocate/submit    compare submitted message bytes to prepared bytes →
                        broadcast → confirm → verify from chain → resolve lineage
                        → settle → refresh aggregates

/api/cron/reconcile     expire unsigned prepares; settle or fail anything left
                        SUBMITTED. Chain state decides, never prior app state.
```

The re-quote at prepare is a user protection: the intent's `minOutRaw` is a
floor the user approved, and if the market moved below it the request is refused
rather than filled worse.

## 8. Frontend

- `/` — network dashboard: treasury, epoch, agents, assets, generations, the
  propagation tree, recent infections.
- `/asset/[mint]` — per-asset stats, lineage parent, index case, risk flags,
  descendants, infection log.
- `/agent` — the agent console: allocation state, buy-Main / paste-a-mint,
  review, two-signature execution, history.

The tree is laid out deterministically (one column per generation, ordered by
capital) rather than force-directed, so that a change on screen means the network
changed and not the physics. Node radius encodes **unique agents**, because that
is the metric that is expensive to fake; capital is not.

## 9. Security

| Threat | Mitigation | Status |
|---|---|---|
| Double allocation spend | Conditional UPDATE + CHECK constraint + reservation lifecycle | Done |
| Sybil holder farming | `MIN_HOLDING_RAW` floor; equal split is *knowingly* farmable | **Weak — see below** |
| Wallet impersonation | Sign-In With Solana over a server nonce, single use | Done |
| Malicious mint | Mint authority / freeze / Token-2022 extension inspection; transfer hook and default-frozen **block** | Done |
| Prompt injection via metadata | Metadata is data. Control chars and bidi overrides stripped, length capped, never branched on, never sent to a model | Done (no LLM in MVP) |
| Symbol impersonation of Main | Homoglyph-folded comparison → `IMPERSONATES_MAIN`; symbols are excluded from the signed intent entirely | Done |
| Malicious swap route | `restrictIntermediateTokens=true`; slippage capped; price impact ceiling | Done |
| Compromised frontend | Submitted message bytes compared against prepared bytes | Done |
| Compromised backend | **Treasury key is hot — full drain possible** | Phase 4 |
| Compromised RPC | Confirmation reads pre/post balances rather than trusting a status | Partial — a lying RPC can still fabricate a response |
| Race between two trades | Reservation is taken before the transaction is built | Done |
| Epoch snapshot manipulation | Root anchored on chain before allocations are spendable | Partial — operator still chooses the reading |
| Cron abuse | Bearer `CRON_SECRET` | Done |

### The two honest weaknesses

**Equal allocation is Sybil bait.** A whale splitting a bag across N wallets
multiplies its take N-fold. `MIN_HOLDING_RAW` sets a price on the attack and
nothing more. Ship the equal split to prove the loop; raise the floor
meaningfully and move to **`proportionalFormula`** before capital is real.

On the choice of successor, since the intuitive answer is wrong: sqrt weighting
does **not** resist wallet-splitting. `sqrt(a) + sqrt(b) > sqrt(a+b)`, so
splitting *raises* your weight — the same superadditivity that forces quadratic
funding to depend on identity verification. Only linear/proportional weighting is
split-neutral: your share is linear in your balance and the denominator is
unchanged, so N wallets receive exactly what one wallet would. `npm test` asserts
all three behaviours so this cannot be quietly re-introduced:

| Formula | Effect of splitting a bag across N wallets |
|---|---|
| `equalFormula` (shipped) | take × N — worst case |
| `sqrtFormula` | mildly profitable |
| `proportionalFormula` | neutral — **the successor** |

Sqrt still has a legitimate use: flattening whales relative to proportional. It
just needs an independent Sybil defence next to it.

**The treasury key is hot.** Cap the balance at one epoch. Phase 4 is the fix.

## 10. Legal / economic note

The treasury allocation mechanism is a prototype. Distributing fee-derived value
to token holders is not legally trivial in any major jurisdiction, and this
document takes no position on it. Nothing in the product should describe
allocations as yield, income, dividends, or a return — the UI does not, and it
should stay that way. The allocation formula, the distribution share and the
epoch cadence are all single-file changes precisely so the economics can be
altered or switched off without touching the rest of the system.

## 11. Phases

**Phase 1 — MVP (implemented).** Snapshot → epoch → allocation → user-directed
swap with two signatures → chain-verified event → graph.

**Phase 2 — hardening.** Raise `MIN_HOLDING_RAW`. Switch to `proportionalFormula`. Rate
limit prepare per wallet. Move the treasury key to a KMS or Squads multisig.
Backfill events by scanning treasury transaction history so the index can be
rebuilt from chain alone.

**Phase 3 — the agent.** An LLM that explains allocation, lineage and risk
flags. Read-only, no tools that move funds. All token metadata fenced as
untrusted data. It must never be able to initiate a trade.

**Phase 4 — on chain.** Anchor program: treasury PDA, epoch PDA holding the
merkle root, per-wallet allocation PDA for double-spend prevention, and an
instruction that verifies a merkle proof and releases capital atomically into a
Jupiter CPI with a constrained destination mint and minimum out. Replaces
`lib/allocation.ts` behind the same interface; the frontend does not change.

**Phase 5 — depth.** Time-weighted eligibility, allocation velocity charts,
mutation-rate metrics, per-agent lineage pages.
