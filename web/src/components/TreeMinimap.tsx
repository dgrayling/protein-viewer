import { useEffect, useMemo, useRef } from 'react';
import { cluster, hierarchy } from 'd3-hierarchy';
import type { GeneTree, GeneTreeNode } from '../model/geneTree';

interface Props {
  tree: GeneTree;
  currentId: string;
  pinnedId?: string | null;
  onSelect: (id: string) => void;
}

const ROW = 20;
const WIDTH = 340;
const LABEL_W = 130;
const PAD = 10;

/** Cladogram: root on the left, extant proteins on the right. */
export function TreeMinimap({ tree, currentId, pinnedId, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    const root = hierarchy<GeneTreeNode>(tree.nodes.get(tree.rootId)!, (n) =>
      n.childIds.map((c) => tree.nodes.get(c)!),
    );
    const height = Math.max(1, tree.leafOrder.length) * ROW;
    cluster<GeneTreeNode>().size([height - ROW, WIDTH - LABEL_W - PAD * 2])(root);
    return { root, height };
  }, [tree]);

  // Keep the current node visible.
  useEffect(() => {
    scrollRef.current
      ?.querySelector(`[data-id="${CSS.escape(currentId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  const pathToCurrent = useMemo(() => {
    const s = new Set<string>();
    for (let id: string | null = currentId; id; id = tree.nodes.get(id)?.parentId ?? null) s.add(id);
    return s;
  }, [tree, currentId]);

  const { root, height } = layout;
  const pos = (d: { x?: number; y?: number }) => ({ x: (d.y ?? 0) + PAD, y: (d.x ?? 0) + ROW / 2 });

  return (
    <div className="minimap" ref={scrollRef}>
      <svg width="100%" viewBox={`0 0 ${WIDTH} ${height}`} style={{ minHeight: height }} role="tree">
        {root.links().map((l) => {
          const s = pos(l.source);
          const t = pos(l.target);
          const onPath = pathToCurrent.has(l.target.data.id);
          return (
            <path
              key={l.target.data.id}
              d={`M${s.x},${s.y} V${t.y} H${t.x}`}
              className={onPath ? 'mm-link mm-link--path' : 'mm-link'}
            />
          );
        })}
        {root.descendants().map((d) => {
          const p = pos(d);
          const n = d.data;
          const current = n.id === currentId;
          const cls = `mm-node ${n.leaf ? 'mm-leaf' : `mm-${n.event}`} ${current ? 'mm-current' : ''} ${n.id === pinnedId ? 'mm-pinned' : ''}`;
          return (
            <g
              key={n.id}
              data-id={n.id}
              transform={`translate(${p.x},${p.y})`}
              className={cls}
              onClick={() => onSelect(n.id)}
              role="treeitem"
              aria-selected={current}
            >
              <rect x={-8} y={-ROW / 2} width={n.leaf ? LABEL_W + 8 : 16} height={ROW} className="mm-hit" />
              {n.event === 'duplication' ? <rect x={-4} y={-4} width={8} height={8} /> : <circle r={n.leaf ? 3 : 4} />}
              {n.leaf && (
                <text x={8} dy="0.32em">
                  {n.id === pinnedId ? '📌 ' : ''}
                  {n.leaf.symbol ?? n.leaf.geneId} · {n.taxon.commonName ?? n.taxon.scientificName}
                </text>
              )}
              <title>
                {n.leaf
                  ? `${n.leaf.symbol} (${n.taxon.scientificName})`
                  : `${n.taxon.scientificName}${n.taxon.mya != null ? `, ~${n.taxon.mya} Mya` : ''} · ${n.event}`}
              </title>
            </g>
          );
        })}
      </svg>
      <div className="mm-legend">
        <span><i className="dot dot--spec" /> speciation</span>
        <span><i className="dot dot--dup" /> duplication</span>
      </div>
    </div>
  );
}
