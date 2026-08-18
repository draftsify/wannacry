"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { GraphEdge, GraphNode } from "@/lib/lineage";
import { displaySymbol, solFromLamports } from "@/lib/format";

/**
 * The propagation tree.
 *
 * Layout is deterministic: one column per generation, nodes ordered by capital
 * within the column. Deliberately not a force-directed simulation — a layout
 * that reshuffles on every load makes it impossible to tell whether the network
 * changed or the physics did, and the whole point of this view is to read change.
 *
 * Node radius encodes unique agents, not SOL. How many independent holders chose
 * an asset is the metric that is hard to fake; total capital is not.
 */

const COL_WIDTH = 210;
const ROW_HEIGHT = 62;
const PAD_X = 70;
const PAD_Y = 44;

export function NetworkGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const router = useRouter();

  const layout = useMemo(() => {
    const byGen = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const list = byGen.get(n.generation) ?? [];
      list.push(n);
      byGen.set(n.generation, list);
    }

    const generations = [...byGen.keys()].sort((a, b) => a - b);
    const positions = new Map<string, { x: number; y: number; r: number; node: GraphNode }>();
    const maxAgents = Math.max(1, ...nodes.map((n) => n.uniqueAgents));

    for (const gen of generations) {
      const column = (byGen.get(gen) ?? []).sort((a, b) =>
        Number(BigInt(b.totalLamports) - BigInt(a.totalLamports)),
      );
      column.forEach((node, i) => {
        positions.set(node.mint, {
          x: PAD_X + generations.indexOf(gen) * COL_WIDTH,
          y: PAD_Y + i * ROW_HEIGHT,
          // sqrt so a node with 100 agents is 10x the area of one with 1, not
          // 100x the radius — otherwise one hub swallows the canvas.
          r: 5 + 13 * Math.sqrt(node.uniqueAgents / maxAgents),
          node,
        });
      });
    }

    const rows = Math.max(1, ...generations.map((g) => (byGen.get(g) ?? []).length));
    return {
      positions,
      generations,
      width: PAD_X * 2 + Math.max(0, generations.length - 1) * COL_WIDTH + 120,
      height: PAD_Y * 2 + rows * ROW_HEIGHT,
    };
  }, [nodes]);

  if (nodes.length === 0) {
    return <div className="empty">No confirmed allocations yet. The graph fills as agents act.</div>;
  }

  return (
    <div className="graph-wrap">
      <svg width={layout.width} height={layout.height} role="img" aria-label="Propagation tree">
        {layout.generations.map((gen, i) => (
          <text key={gen} className="gen-label" x={PAD_X + i * COL_WIDTH} y={20} textAnchor="middle">
            gen {gen}
          </text>
        ))}

        {edges.map((e) => {
          const from = layout.positions.get(e.parent);
          const to = layout.positions.get(e.child);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={`${e.parent}-${e.child}`}
              d={`M ${from.x + from.r} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - to.r} ${to.y}`}
              fill="none"
              stroke="#2b3138"
              strokeWidth={e.agentTransitions > 1 ? 1.6 : 1}
            />
          );
        })}

        {[...layout.positions.values()].map(({ x, y, r, node }) => (
          <g
            key={node.mint}
            transform={`translate(${x},${y})`}
            style={{ cursor: "pointer" }}
            onClick={() => router.push(`/asset/${node.mint}`)}
          >
            <circle
              r={r}
              fill={node.isMain ? "#1c5c38" : "#131619"}
              stroke={node.isMain ? "#4ade80" : "#2b3138"}
              strokeWidth={1.2}
            />
            <text className="node-label" x={r + 7} y={-1}>
              {displaySymbol(node.symbol, node.mint)}
            </text>
            <text className="node-sub" x={r + 7} y={11}>
              {node.uniqueAgents} agents · {solFromLamports(node.totalLamports, 2)} SOL
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
