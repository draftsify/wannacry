import Link from "next/link";
import type { Metadata, Viewport } from "next";
import "./landing.css";

export const metadata: Metadata = {
  title: "Patient Zero — capital that spreads by choice",
  description:
    "Main Token trading fees fund epoch allocations. Holders direct their own allocation, and every edge in the propagation graph comes from a confirmed on-chain transaction.",
};

// Matches the page ground so mobile browser chrome does not frame a dark page
// in a light bar.
export const viewport: Viewport = {
  themeColor: "#1f1e1d",
  colorScheme: "dark",
};

const REPO = "https://github.com/draftsify/patient-zero";

/**
 * Static by construction — no database, no RPC. The marketing page stays up when
 * the indexer is down, and it never shows a number it cannot source.
 */
export default function LandingPage() {
  return (
    <div className="landing">
      <div className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <span className="dot" aria-hidden="true" />
            Patient Zero
          </Link>
          <div className="nav-links">
            <Link href="/network">Network</Link>
            <Link href="/agent">Your agent</Link>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <Link href="/network" className="btn btn-primary">
              Open the explorer
            </Link>
          </div>
        </nav>
      </div>

      <div className="wrap">
        <header className="hero">
          <span className="eyebrow">Solana · epoch allocation protocol</span>
          <h1>
            Capital that spreads
            <br />
            by <em>choice</em>, not by code.
          </h1>
          <p className="lede">
            Trading fees from one token fund a treasury. Each epoch, that treasury is allocated to
            holders — and each holder decides, personally, where their share goes next. What emerges
            is a propagation graph nobody authored.
          </p>
          <div className="cta">
            <Link href="/agent" className="btn btn-primary">
              Connect your wallet
            </Link>
            <a href={REPO} className="btn btn-ghost" target="_blank" rel="noreferrer">
              Read the architecture
            </a>
          </div>
          <p className="hero-note">
            No autonomous spending. Every allocation needs two signatures from you.
          </p>
        </header>
      </div>

      <div className="wrap">
        <section>
          <div className="kicker">The mechanism</div>
          <h2>One token, then a network.</h2>
          <p>
            The Main Token is Patient Zero. Its fees accumulate in a treasury, and at each epoch a
            defined share becomes allocation capital for the holders in that epoch&apos;s snapshot.
            The allocation does not land in your wallet as free SOL — it lands in an agent that will
            only spend it into a swap you authorize.
          </p>
          <p>
            That single constraint is what makes the graph exist. Capital has to move somewhere to
            move at all, and where it goes is a decision, made by a person, recorded on chain.
          </p>

          <ol className="flow">
            <li>
              <span>
                Trading activity on the <b>Main Token</b> generates protocol fees.
              </span>
            </li>
            <li>
              <span>
                Fees accumulate in the <b>treasury</b>.
              </span>
            </li>
            <li>
              <span>
                An <b>epoch snapshot</b> freezes the holder set at a recorded slot. Allocations never
                recompute afterwards.
              </span>
            </li>
            <li>
              <span>
                A holder connects a wallet and their <b>allocation</b> appears.
              </span>
            </li>
            <li>
              <span>
                They choose: buy back the Main Token, or paste any Solana mint address.
              </span>
            </li>
            <li>
              <span>
                They review the route, the price impact and the mint&apos;s risk flags, then{" "}
                <b>sign twice</b> — once for the authorization, once for the transaction.
              </span>
            </li>
            <li>
              <span>
                The swap executes. The event is <b>verified from chain</b>, not from what the app
                believes happened.
              </span>
            </li>
            <li>
              <span>
                The <b>propagation graph</b> updates.
              </span>
            </li>
          </ol>
        </section>

        <section>
          <div className="kicker">Lineage</div>
          <h2>Every edge is two transactions from one wallet.</h2>
          <p>
            It would be easy to draw a beautiful tree. If every asset&apos;s parent were simply the
            Main Token, the graph would be one level deep — a star — and inventing depth to make it
            look organic would be fabrication.
          </p>
          <p>
            So the rule is contact tracing. An asset&apos;s parent is the previous asset that its{" "}
            <em>index case</em> — the first agent to bring capital there — had itself allocated to.
            If that agent was allocating for the first time, the parent is Patient Zero, because the
            capital genuinely came from Main Token fees.
          </p>

          <div className="figure">
            <PropagationDiagram />
            <p className="figcaption">
              Depth appears only when an agent who already moved capital somewhere moves it somewhere
              new. A shallow network is drawn shallow.
            </p>
          </div>

          <dl className="defs">
            <div className="def">
              <dt>Agent</dt>
              <dd>A wallet with at least one confirmed allocation. Counted once, never per event.</dd>
            </div>
            <div className="def">
              <dt>Infection</dt>
              <dd>One confirmed on-chain swap of epoch allocation into a mint.</dd>
            </div>
            <div className="def">
              <dt>Parent</dt>
              <dd>
                The previous asset an asset&apos;s index case had infected. Frozen at first
                infection, never revised.
              </dd>
            </div>
            <div className="def">
              <dt>Generation</dt>
              <dd>
                Depth in that tree. Patient Zero is zero. Deliberately <em>not</em> the same thing as
                an epoch, and shown separately.
              </dd>
            </div>
            <div className="def">
              <dt>Network penetration</dt>
              <dd>An asset&apos;s unique agents divided by all active agents.</dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="kicker">The agent</div>
          <h2>It prepares and explains. It never chooses.</h2>
          <p>
            Your agent inspects the mint, builds the transaction, surfaces what looks dangerous and
            shows you your history. What it cannot do is act.
          </p>

          <div className="cards">
            <div className="card">
              <div className="num">01</div>
              <h3>Two signatures, always</h3>
              <p>
                One for a plain-language authorization naming the mint, the amount and your minimum
                output. One for the transaction itself, where you are the fee payer — so it is
                invalid without you.
              </p>
            </div>
            <div className="card">
              <div className="num">02</div>
              <h3>Metadata is data</h3>
              <p>
                Token names and descriptions are attacker-controlled text. They are stripped of
                control characters, capped, never branched on, and never treated as instructions.
              </p>
            </div>
            <div className="card">
              <div className="num">03</div>
              <h3>Checks that block</h3>
              <p>
                Live mint authority, freeze authority, transfer fees, permanent delegates. A transfer
                hook or a default-frozen mint is refused outright, not warned about.
              </p>
            </div>
            <div className="card">
              <div className="num">04</div>
              <h3>Numbers from the chain</h3>
              <p>
                An allocation counts only after the transaction is re-read and its own pre/post
                balances confirm you received the token. The database indexes facts, not claims.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="kicker">Honest limits</div>
          <h2>What this is not.</h2>
          <p>
            This is a prototype mechanism, and the parts that are not finished are worth stating
            before you connect anything.
          </p>

          <div className="limits">
            <ul>
              <li>
                <b>Not yield, income, dividends, or a return.</b> Allocation is capital you direct
                into a swap you choose. Whatever you buy can go to zero, and usually does.
              </li>
              <li>
                <b>The treasury key is hot.</b> Allocation accounting is off-chain today. The
                on-chain program that removes that trust assumption is specified and not yet built.
              </li>
              <li>
                <b>Equal allocation is farmable.</b> Splitting a bag across wallets multiplies the
                take. A minimum holding sets a price on that attack; proportional weighting removes
                it, and is the documented next step.
              </li>
              <li>
                <b>No model is in the loop.</b> The console is deterministic. Nothing in this system
                spreads a message, promotes a token, or takes an action on its own.
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div className="wrap">
        <footer>
          <div className="row">
            <span>Patient Zero — an allocation network on Solana.</span>
            <span>
              <a href={REPO} target="_blank" rel="noreferrer">
                Source
              </a>{" "}
              ·{" "}
              <a href={`${REPO}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
                Architecture
              </a>{" "}
              · <Link href="/network">Explorer</Link>
            </span>
          </div>
          <p className="disclaimer">
            Nothing here is financial, legal or tax advice, and nothing here is an offer. Directing
            an allocation means buying a token on a public market with all of the risk that carries,
            including total loss. The economic mechanism is experimental and may change or be
            switched off. This project is not affiliated with, endorsed by, or connected to Anthropic
            or any other company whose design language may have inspired this page.
          </p>
        </footer>
      </div>
    </div>
  );
}

/**
 * The lineage rule, drawn. Hand-laid rather than generated: it illustrates the
 * definition and is not a live view of the network — that lives at /network,
 * where every node comes from a confirmed transaction.
 */
function PropagationDiagram() {
  const nodes = [
    { id: "pz", x: 70, y: 110, r: 26, label: "Patient Zero", main: true },
    { id: "a", x: 250, y: 52, r: 16, label: "Token A" },
    { id: "b", x: 250, y: 118, r: 19, label: "Token B" },
    { id: "c", x: 250, y: 182, r: 12, label: "Token C" },
    { id: "d", x: 430, y: 30, r: 11, label: "Token D" },
    { id: "e", x: 430, y: 96, r: 13, label: "Token E" },
    { id: "f", x: 610, y: 96, r: 9, label: "Token F" },
  ];
  const edges = [
    ["pz", "a"],
    ["pz", "b"],
    ["pz", "c"],
    ["a", "d"],
    ["b", "e"],
    ["e", "f"],
  ];
  const at = (id: string) => nodes.find((n) => n.id === id)!;

  return (
    <svg width="720" height="232" viewBox="0 0 720 232" role="img" aria-label="Propagation tree">
      {[
        { x: 70, t: "gen 0" },
        { x: 250, t: "gen 1" },
        { x: 430, t: "gen 2" },
        { x: 610, t: "gen 3" },
      ].map((g) => (
        <text key={g.t} className="dg-gen" x={g.x} y={222} textAnchor="middle">
          {g.t}
        </text>
      ))}

      {edges.map(([from, to]) => {
        const f = at(from);
        const t = at(to);
        const mid = (f.x + t.x) / 2;
        return (
          <path
            key={`${from}-${to}`}
            className="dg-edge"
            d={`M ${f.x + f.r} ${f.y} C ${mid} ${f.y}, ${mid} ${t.y}, ${t.x - t.r} ${t.y}`}
          />
        );
      })}

      {nodes.map((n) => (
        <g key={n.id}>
          <circle className={n.main ? "dg-node is-root" : "dg-node"} cx={n.x} cy={n.y} r={n.r} />
          <text
            className={n.main ? "dg-label is-root" : "dg-label"}
            x={n.x + n.r + 9}
            y={n.y + 4}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
