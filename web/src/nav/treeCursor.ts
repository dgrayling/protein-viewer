// Pure navigation over a GeneTree. The cursor is a node ID plus a trail of
// the children we climbed up from, so "down" returns along the same path.

import type { GeneTree } from '../model/geneTree';

export interface Cursor {
  nodeId: string;
  /** Stack of child IDs we came up from (top = most recent). */
  trail: string[];
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const cursorAt = (nodeId: string): Cursor => ({ nodeId, trail: [] });

export function move(tree: GeneTree, c: Cursor, dir: Direction): Cursor {
  const node = tree.nodes.get(c.nodeId);
  if (!node) return c;

  switch (dir) {
    case 'up': {
      if (!node.parentId) return c;
      return { nodeId: node.parentId, trail: [...c.trail, c.nodeId] };
    }
    case 'down': {
      if (node.childIds.length === 0) return c;
      const top = c.trail[c.trail.length - 1];
      if (top && node.childIds.includes(top)) {
        return { nodeId: top, trail: c.trail.slice(0, -1) };
      }
      return { nodeId: node.childIds[0], trail: [] };
    }
    case 'left':
    case 'right': {
      const step = dir === 'right' ? 1 : -1;
      // Leaves: walk through all extant proteins in tree order, so swiping
      // sideways never dead-ends.
      if (node.childIds.length === 0) {
        const i = tree.leafOrder.indexOf(c.nodeId);
        const j = i + step;
        if (j < 0 || j >= tree.leafOrder.length) return c;
        return cursorAt(tree.leafOrder[j]);
      }
      // Internal nodes: move between nodes at the same depth, in tree order.
      const sameDepth = internalAtDepth(tree, node.depth);
      const i = sameDepth.indexOf(c.nodeId);
      const j = i + step;
      if (j < 0 || j >= sameDepth.length) return c;
      return cursorAt(sameDepth[j]);
    }
  }
}

const depthCache = new WeakMap<GeneTree, Map<number, string[]>>();

/** Internal (ancestor) nodes at a given depth, left-to-right. */
function internalAtDepth(tree: GeneTree, depth: number): string[] {
  let byDepth = depthCache.get(tree);
  if (!byDepth) {
    byDepth = new Map();
    const walk = (id: string) => {
      const n = tree.nodes.get(id)!;
      if (n.childIds.length > 0) {
        const arr = byDepth!.get(n.depth) ?? [];
        arr.push(id);
        byDepth!.set(n.depth, arr);
        n.childIds.forEach(walk);
      }
    };
    walk(tree.rootId);
    depthCache.set(tree, byDepth);
  }
  return byDepth.get(depth) ?? [];
}

/** Nodes reachable in one move: what we should prefetch. */
export function neighbours(tree: GeneTree, c: Cursor): string[] {
  const dirs: Direction[] = ['left', 'right', 'up', 'down'];
  const ids = new Set(dirs.map((d) => move(tree, c, d).nodeId));
  ids.delete(c.nodeId);
  return [...ids];
}
