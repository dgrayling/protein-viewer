import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/hbb-genetree.json';
import { lca, parseGeneTree, pruneIfLarge, relationship, ungapped, type RawGeneTreeResponse } from './geneTree';
import { cursorAt, move, neighbours } from '../nav/treeCursor';

const tree = parseGeneTree(fixture as RawGeneTreeResponse);
const leafBy = (sym: string, sp: string) =>
  [...tree.nodes.values()].find((n) => n.leaf?.symbol === sym && n.taxon.scientificName === sp)!.id;

describe('parseGeneTree', () => {
  it('assigns path IDs and parses leaves', () => {
    expect(tree.treeId).toBe('ENSGT00940000163476');
    expect(tree.nodes.get('r')!.parentId).toBeNull();
    const human = tree.nodes.get(leafBy('HBB', 'Homo sapiens'))!;
    expect(human.leaf!.proteinId).toBe('ENSP00000333994');
    expect(ungapped(human.leaf!.alignedSeq)).toMatch(/^MVHLTPEEK/);
    expect(tree.leafOrder.length).toBeGreaterThanOrEqual(4);
  });

  it('reads events and divergence times on internal nodes', () => {
    const hominines = tree.nodes.get(lca(tree, leafBy('HBB', 'Homo sapiens'), leafBy('HBB', 'Pan troglodytes')))!;
    expect(hominines.event).toBe('speciation');
    expect(hominines.taxon.mya).toBe(8.6);
  });

  it('classifies orthologs vs paralogs', () => {
    expect(relationship(tree, leafBy('HBB', 'Homo sapiens'), leafBy('HBB', 'Pan troglodytes'))).toBe('ortholog');
    expect(relationship(tree, leafBy('HBB', 'Homo sapiens'), leafBy('HBD', 'Homo sapiens'))).toBe('paralog');
  });
});

describe('pruneIfLarge', () => {
  const raw = fixture as RawGeneTreeResponse;
  it('keeps small trees whole', () => {
    expect(pruneIfLarge(raw, new Set(), 100)).toBe(raw);
  });
  it('prunes to preferred species and collapses unary nodes', () => {
    const pruned = parseGeneTree(pruneIfLarge(raw, new Set(['Homo sapiens']), 1));
    expect(pruned.leafOrder.length).toBe(2); // human HBB + HBD
    const root = pruned.nodes.get(pruned.rootId)!;
    expect(root.childIds.length).toBe(2);
    expect(root.event).toBe('duplication');
  });
});

describe('treeCursor', () => {
  const human = leafBy('HBB', 'Homo sapiens');

  it('up then down returns along the same path', () => {
    const up1 = move(tree, cursorAt(human), 'up');
    const up2 = move(tree, up1, 'up');
    expect(move(tree, move(tree, up2, 'down'), 'down').nodeId).toBe(human);
  });

  it('stays put at boundaries', () => {
    expect(move(tree, cursorAt('r'), 'up').nodeId).toBe('r');
    expect(move(tree, cursorAt(human), 'down').nodeId).toBe(human);
    expect(move(tree, cursorAt(tree.leafOrder[0]), 'left').nodeId).toBe(tree.leafOrder[0]);
  });

  it('walks leaves sideways in tree order', () => {
    let c = cursorAt(tree.leafOrder[0]);
    const seen = [c.nodeId];
    for (let i = 1; i < tree.leafOrder.length; i++) seen.push((c = move(tree, c, 'right')).nodeId);
    expect(seen).toEqual(tree.leafOrder);
  });

  it('down from a fresh internal node goes to first child', () => {
    expect(move(tree, cursorAt('r'), 'down').nodeId).toBe('r.0');
  });

  it('lists neighbours excluding self', () => {
    const n = neighbours(tree, cursorAt(human));
    expect(n).not.toContain(human);
    expect(n).toContain(tree.nodes.get(human)!.parentId);
  });
});
