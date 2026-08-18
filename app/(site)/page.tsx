import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { WannaCryMark } from "@/components/WannaCryMark";
import { ConnectCta } from "@/components/ConnectCta";
import { Reveal } from "@/components/Reveal";
import "./landing.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "WannaCry — capital that spreads by choice",
  description:
    "Main Token trading fees fund epoch allocations. Holders direct their own allocation, and every edge in the propagation graph comes from a confirmed on-chain transaction.",
};

export const viewport: Viewport = {
  themeColor: "#e9e8e6",
  colorScheme: "light",
};

const REPO = "https://github.com/draftsify/wannacry";

/**
 * Static by construction — no database, no RPC. The marketing page stays up when
 * the indexer is down, and it never shows a number it cannot source.
 */
export default function LandingPage() {
  return (
    <div className={`landing ${inter.variable}`}>
      <div className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <WannaCryMark size={30} />
            WannaCry
          </Link>
          <div className="nav-links nav-mid">
            <Link href="/network">Network</Link>
            <Link href="/agent">Your agent</Link>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <ConnectCta variant="nav" />
        </nav>
      </div>

      <div className="wrap">
        <header className="hero">
          <WannaCryMark size={76} className="hero-mark" />
          <h1 className="rise" style={{ animationDelay: "80ms" }}>
            Capital that spreads
            <br />
            <span className="dim">by choice, not by code</span>
          </h1>
          <p className="lede rise" style={{ animationDelay: "180ms" }}>
            Trading fees from one token fund a treasury. Each epoch, that treasury is allocated to
            holders — and each holder decides, personally, where their share goes next. What emerges
            is a propagation graph nobody authored.
          </p>
          <div className="rise" style={{ animationDelay: "280ms" }}>
            <ConnectCta />
          </div>

          <div className="orbit">
            <div className="glow" aria-hidden="true" />
            <OrbitFigure />
          </div>
        </header>
      </div>

      <div className="wrap">
        <Reveal>
          <div className="strip">
            <span>
              <i />
              Snapshot-frozen epochs
            </span>
            <span>
              <i />
              Two signatures per allocation
            </span>
            <span>
              <i />
              Graph derived from chain
            </span>
            <span>
              <i />
              Open source
            </span>
          </div>
        </Reveal>
      </div>

      <div className="wrap">
        <section>
          <Reveal>
            <h2>
              One token,
              <br />
              <span className="dim">then a network</span>
            </h2>
            <p>
              The Main Token is Patient Zero. Its fees accumulate in a treasury, and at each epoch a
              defined share becomes allocation capital for the holders in that epoch&apos;s snapshot.
              The allocation does not land in your wallet as free SOL — it lands in an agent that
              will only spend it into a swap you authorize. That single constraint is what makes the
              graph exist.
            </p>
          </Reveal>

          <div className="cards">
            <Reveal delay={0}>
              <article className="card">
                <BurstIcon />
                <h3>Fees become allocation</h3>
                <p>
                  Trading activity funds the treasury. Each epoch releases a defined share of it to
                  the holders in that epoch&apos;s snapshot.
                </p>
                <span className="note">Frozen at a recorded slot</span>
              </article>
            </Reveal>
            <Reveal delay={90}>
              <article className="card">
                <RingIcon />
                <h3>You direct it</h3>
                <p>
                  Buy back the Main Token, or paste any Solana mint. The agent quotes, inspects and
                  explains — it never chooses.
                </p>
                <span className="note">Two wallet approvals, always</span>
              </article>
            </Reveal>
            <Reveal delay={180}>
              <article className="card">
                <GridIcon />
                <h3>The network records it</h3>
                <p>
                  Each confirmed swap is an infection event, verified against the transaction&apos;s
                  own balances before it counts.
                </p>
                <span className="note">Chain-derived, not app-asserted</span>
              </article>
            </Reveal>
          </div>
        </section>

        <section>
          <Reveal>
            <h2>
              The loop, <span className="dim">end to end</span>
            </h2>
            <ol className="flow">
              <li>
                Trading activity on the <b>Main Token</b> generates protocol fees.
              </li>
              <li>
                Fees accumulate in the <b>treasury</b>.
              </li>
              <li>
                An <b>epoch snapshot</b> freezes the holder set at a recorded slot. Allocations never
                recompute afterwards.
              </li>
              <li>
                A holder connects a wallet and their <b>allocation</b> appears.
              </li>
              <li>They choose: buy back the Main Token, or paste any Solana mint address.</li>
              <li>
                They review the route, the price impact and the mint&apos;s risk flags, then{" "}
                <b>sign twice</b> — once for the authorization, once for the transaction.
              </li>
              <li>
                The swap executes. The event is <b>verified from chain</b>, not from what the app
                believes happened.
              </li>
              <li>
                The <b>propagation graph</b> updates.
              </li>
            </ol>
          </Reveal>
        </section>

        <section>
          <Reveal>
            <h2>
              Every edge is two transactions
              <br />
              <span className="dim">from one wallet</span>
            </h2>
            <p>
              It would be easy to draw a beautiful tree. If every asset&apos;s parent were simply the
              Main Token, the graph would be one level deep — a star — and inventing depth to make it
              look organic would be fabrication.
            </p>
            <p>
              So the rule is contact tracing. An asset&apos;s parent is the previous asset that its
              index case — the first agent to bring capital there — had itself allocated to. If that
              agent was allocating for the first time, the parent is Patient Zero, because the
              capital genuinely came from Main Token fees.
            </p>
          </Reveal>

          <Reveal>
            <div className="figure">
              <PropagationDiagram />
              <p className="figcaption">
                Depth appears only when an agent who already moved capital somewhere moves it
                somewhere new. A shallow network is drawn shallow.
              </p>
            </div>
          </Reveal>

          <Reveal>
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
                  Depth in that tree. Patient Zero is zero. Deliberately not the same thing as an
                  epoch, and shown separately.
                </dd>
              </div>
              <div className="def">
                <dt>Network penetration</dt>
                <dd>An asset&apos;s unique agents divided by all active agents.</dd>
              </div>
            </dl>
          </Reveal>
        </section>

        <section>
          <Reveal>
            <h2>
              What this <span className="dim">is not</span>
            </h2>
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
                  <b>No model is in the loop.</b> The console is deterministic. Nothing in this
                  system spreads a message, promotes a token, or takes an action on its own.
                </li>
              </ul>
            </div>
          </Reveal>
        </section>

        <Reveal>
          <div className="cta-block">
            <Traces />
            <h2>Direct your first allocation</h2>
            <p>
              Connect the wallet that held the Main Token at the epoch snapshot. Connecting is
              read-only, and nothing moves until you sign.
            </p>
            <ConnectCta />
          </div>
        </Reveal>
      </div>

      <div className="wrap">
        <footer>
          <div className="row">
            <span>WannaCry — an allocation network on Solana.</span>
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
            switched off. The name is a reference and nothing more: this project is independent,
            unaffiliated with any other product or entity, and distributes no software that runs on
            your machine.
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Artwork                                                             */
/* ------------------------------------------------------------------ */

/**
 * The hero figure: Patient Zero at the centre, generations as concentric rings.
 * It illustrates the model rather than reporting it — the live network lives at
 * /network, where every node comes from a confirmed transaction.
 *
 * Rings counter-rotate at different speeds. Positions are computed from fixed
 * inputs with no randomness, so server and client render identical markup.
 */
function OrbitFigure() {
  const cx = 450;
  const cy = 430;
  const rings = [
    { r: 130, nodes: 5, size: 5.5, seed: 0.4, cls: "ring-a" },
    { r: 210, nodes: 9, size: 4.5, seed: 1.1, cls: "ring-b" },
    { r: 292, nodes: 13, size: 3.8, seed: 0.2, cls: "ring-c" },
    { r: 376, nodes: 17, size: 3.2, seed: 1.7, cls: "ring-b" },
  ];

  return (
    <svg viewBox="0 0 900 700" role="img" aria-label="Propagation rings radiating from Patient Zero">
      <defs>
        <radialGradient id="wc-core" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffa877" />
          <stop offset="55%" stopColor="#ff5101" />
          <stop offset="100%" stopColor="#c73900" />
        </radialGradient>
      </defs>

      {rings.map((ring) => (
        <circle
          key={`o-${ring.r}`}
          cx={cx}
          cy={cy}
          r={ring.r}
          fill="none"
          stroke="#ff5101"
          strokeOpacity={0.2}
          strokeWidth="1"
        />
      ))}

      {rings.map((ring) => (
        <g key={`n-${ring.r}`} className={ring.cls}>
          {Array.from({ length: ring.nodes }, (_, i) => {
            const angle = (i / ring.nodes) * Math.PI * 2 + ring.seed;
            const x = cx + Math.cos(angle) * ring.r;
            const y = cy + Math.sin(angle) * ring.r;
            const opacity = 0.35 + 0.65 * ((Math.sin(angle * 3 + ring.seed) + 1) / 2);
            return (
              <circle key={i} cx={x} cy={y} r={ring.size} fill="#ff5101" fillOpacity={opacity} />
            );
          })}
        </g>
      ))}

      <g className="ring-a">
        {Array.from({ length: rings[0].nodes }, (_, i) => {
          const angle = (i / rings[0].nodes) * Math.PI * 2 + rings[0].seed;
          return (
            <line
              key={i}
              x1={cx + Math.cos(angle) * 26}
              y1={cy + Math.sin(angle) * 26}
              x2={cx + Math.cos(angle) * (rings[0].r - 8)}
              y2={cy + Math.sin(angle) * (rings[0].r - 8)}
              stroke="#ff5101"
              strokeOpacity="0.3"
              strokeWidth="1"
            />
          );
        })}
      </g>

      <circle className="core-halo" cx={cx} cy={cy} r="46" fill="#ff5101" fillOpacity="0.16" />
      <circle cx={cx} cy={cy} r="20" fill="url(#wc-core)" />
    </svg>
  );
}

/** Dot artwork for the cards. */
function BurstIcon() {
  const dots: Array<{ x: number; y: number; r: number }> = [];
  [
    { ring: 9, n: 6, r: 1.7 },
    { ring: 19, n: 12, r: 1.9 },
    { ring: 29, n: 18, r: 2.1 },
  ].forEach(({ ring, n, r }) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      dots.push({ x: 34 + Math.cos(a) * ring, y: 34 + Math.sin(a) * ring, r });
    }),
  );
  return (
    <svg className="icon" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
      <circle cx="34" cy="34" r="2.4" fill="currentColor" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="currentColor" />
      ))}
    </svg>
  );
}

function RingIcon() {
  const n = 26;
  return (
    <svg className="icon" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={34 + Math.cos(a) * 27}
            cy={34 + Math.sin(a) * 27}
            r="2.4"
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

function GridIcon() {
  const dots: Array<{ x: number; y: number }> = [];
  const step = 7;
  const span = 4;
  for (let row = -span; row <= span; row++) {
    for (let col = -span; col <= span; col++) {
      // Diamond mask: keep only the cells inside the rotated square.
      if (Math.abs(row) + Math.abs(col) <= span) {
        dots.push({ x: 34 + col * step, y: 34 + row * step });
      }
    }
  }
  return (
    <svg className="icon" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="2.2" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Decorative circuit traces for the orange call-to-action block. */
function Traces() {
  return (
    <svg className="traces" viewBox="0 0 1140 380" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 34 H150 L182 4 H330" />
      <path d="M0 62 H120 L166 108 H300" />
      <path d="M14 96 L64 96 L150 182 L150 250" />
      <path d="M1140 300 H1010 L964 254 H820" />
      <path d="M1140 272 H1046 L1010 236 H900" />
      <path d="M1126 216 L1066 216 L980 130 L980 62" />
    </svg>
  );
}

/**
 * The lineage rule, drawn. Hand-laid rather than generated: it illustrates the
 * definition and is not a live view of the network.
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

      {edges.map(([from, to], i) => {
        const f = at(from);
        const t = at(to);
        const mid = (f.x + t.x) / 2;
        return (
          <path
            key={`${from}-${to}`}
            className="dg-edge"
            style={{ animationDelay: `${i * 110}ms` }}
            d={`M ${f.x + f.r} ${f.y} C ${mid} ${f.y}, ${mid} ${t.y}, ${t.x - t.r} ${t.y}`}
          />
        );
      })}

      {nodes.map((n) => (
        <g key={n.id}>
          <circle className={n.main ? "dg-node is-root" : "dg-node"} cx={n.x} cy={n.y} r={n.r} />
          <text className={n.main ? "dg-label is-root" : "dg-label"} x={n.x + n.r + 9} y={n.y + 4}>
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
