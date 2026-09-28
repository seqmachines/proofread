"use client";
// components/Canvas.tsx — the hero. Nodes and edges come straight from fold(events);
// positions are already fixed, so no layout happens here. Fits the view as nodes appear.
import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type DefaultEdgeOptions,
  type FitViewOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MoleculeNode as MoleculeNodeType, TransitionEdge as TransitionEdgeType } from "@/lib/reducer";
import { cx } from "@/lib/cx";
import { SEGMENT_COLORS, SEGMENT_TYPES } from "@/lib/colors";
import { MoleculeNode } from "./MoleculeNode";
import { TransitionEdge } from "./TransitionEdge";

const nodeTypes = { molecule: MoleculeNode };
const edgeTypes = { transition: TransitionEdge };
const defaultEdgeOptions: DefaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
};
// Long workflows stack vertically; never shrink nodes below ~70% — the rest is reached by scrolling.
const fitViewOptions: FitViewOptions = { padding: 0.15, minZoom: 0.7, maxZoom: 1 };

// Refit whenever a node appears. The store's fitView() queues itself until the
// new node is measured, so no "nodes initialized" guard is needed here.
// Refit when a node appears, and again (debounced) after the last event of a burst,
// so an 8× replay always ends with the whole workflow in view. The store's fitView()
// queues itself until new nodes are measured.
function FitOnGrowth({ count, tick }: { count: number; tick: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (count > 0) void fitView({ ...fitViewOptions, duration: 350 });
  }, [count, fitView]);
  useEffect(() => {
    if (count === 0) return;
    const settle = setTimeout(() => void fitView({ ...fitViewOptions, duration: 250 }), 400);
    return () => clearTimeout(settle);
  }, [count, tick, fitView]);
  return null;
}

export interface CanvasProps {
  nodes: MoleculeNodeType[];
  edges: TransitionEdgeType[];
  selectedId?: string | null;
  mismatch?: Set<string> | null; // state ids the GT diff marks as extra
  tick?: number; // last applied event seq — drives the debounced refit
  onNodeClick?: (node: MoleculeNodeType) => void;
  onPaneClick?: () => void;
  className?: string;
}

function Legend() {
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-[4] flex flex-wrap gap-x-2.5 gap-y-0.5 rounded border border-line bg-panel/90 px-2 py-1 font-mono text-[9px] leading-3 text-muted"
      data-legend
    >
      {SEGMENT_TYPES.map((t) => (
        <span key={t} className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: SEGMENT_COLORS[t] }} />
          {t}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-0 w-3 border-t border-line" /> overhang
      </span>
    </div>
  );
}

// fold() rebuilds node objects every tick. React Flow keeps a node's measured size only
// while the object identity is unchanged (adoptUserNodes resets `measured` otherwise),
// and fitView ignores unmeasured nodes — so hand it the previous object when nothing changed.
function useStableNodes(nodes: MoleculeNodeType[]): MoleculeNodeType[] {
  const [cache] = useState(() => new Map<string, { key: string; node: MoleculeNodeType }>());
  return useMemo(() => {
    const seen = new Set<string>();
    const out = nodes.map((n) => {
      const key = JSON.stringify([n.position, n.selected ?? false, n.data]);
      seen.add(n.id);
      const hit = cache.get(n.id);
      if (hit && hit.key === key) return hit.node;
      cache.set(n.id, { key, node: n });
      return n;
    });
    for (const id of Array.from(cache.keys())) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [nodes, cache]);
}

export function Canvas({ nodes, edges, selectedId = null, mismatch = null, tick = 0, onNodeClick, onPaneClick, className }: CanvasProps) {
  // Selection and GT highlighting are view state, not workflow state: applied on top of the reducer's nodes.
  const withView = useMemo(
    () =>
      selectedId || (mismatch && mismatch.size > 0)
        ? nodes.map((n) => {
            const sel = n.id === selectedId;
            const mm = Boolean(mismatch?.has(n.id));
            return sel || mm ? { ...n, selected: sel, data: { ...n.data, gtMismatch: mm } } : n;
          })
        : nodes,
    [nodes, selectedId, mismatch],
  );
  const shown = useStableNodes(withView);
  return (
    <div className={cx("relative h-full w-full", className)}>
      <Legend />
      <ReactFlowProvider>
        <ReactFlow<MoleculeNodeType, TransitionEdgeType>
          nodes={shown}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={0.2}
          maxZoom={1.75}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode="Meta"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          colorMode="system"
          onNodeClick={(_, node) => onNodeClick?.(node)}
          onPaneClick={() => onPaneClick?.()}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          <FitOnGrowth count={nodes.length} tick={tick} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
