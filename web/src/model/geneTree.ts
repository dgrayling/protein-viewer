// Normalized gene tree built from an Ensembl Compara /genetree JSON response.
//
// Internal nodes in Compara JSON carry no stable ID, so we assign a
// deterministic path ID ("r", "r.0", "r.0.1", ...) from child order.
// The ancestor-reconstruction service must use the same scheme so that
// node IDs line up between frontend and backend.

export type NodeEvent = 'speciation' | 'duplication' | 'gene_split' | 'unknown';

export interface Taxon {
  id?: number;
  scientificName: string;
  commonName?: string;
  /** Divergence time in millions of years (internal nodes only). */
  mya?: number;
}

export interface GeneTreeNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  branchLength: number;
  taxon: Taxon;
  /** Internal nodes only. */
  event?: NodeEvent;
  bootstrap?: number;
  /** Leaves only. */
  leaf?: {
    geneId: string;
    proteinId: string;
    transcriptName?: string;
    /** Gene symbol derived from transcript name, e.g. "HBB-201" -> "HBB". */
    symbol?: string;
    alignedSeq: string;
  };
}

export interface GeneTree {
  treeId: string;
  rootId: string;
  nodes: Map<string, GeneTreeNode>;
  /** Leaf IDs in left-to-right tree order. */
  leafOrder: string[];
}

/* ---- Raw Compara JSON shapes (only what we read) ---- */
interface RawNode {
  children?: RawNode[];
  branch_length?: number;
  confidence?: { bootstrap?: number };
  events?: { type?: string };
  taxonomy?: {
    id?: number;
    scientific_name?: string;
    common_name?: string;
    timetree_mya?: number;
  };
  id?: { accession?: string };
  sequence?: {
    name?: string;
    id?: { accession?: string }[];
    mol_seq?: { seq?: string };
  };
}
export interface RawGeneTreeResponse {
  id: string;
  tree: RawNode;
}

const KNOWN_EVENTS: NodeEvent[] = ['speciation', 'duplication', 'gene_split'];

const countRawLeaves = (r: RawNode): number =>
  r.children?.length ? r.children.reduce((s, c) => s + countRawLeaves(c), 0) : 1;

/**
 * Keep only leaves whose species passes `keep`, then collapse internal nodes
 * left with a single child (summing branch lengths). Returns null if nothing
 * survives. Runs before parsing, so path IDs refer to the pruned tree.
 */
export function pruneRaw(r: RawNode, keep: (scientificName: string) => boolean): RawNode | null {
  if (!r.children?.length) return keep(r.taxonomy?.scientific_name ?? '') ? r : null;
  const kids = r.children.map((c) => pruneRaw(c, keep)).filter((c): c is RawNode => c !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) {
    return { ...kids[0], branch_length: (kids[0].branch_length ?? 0) + (r.branch_length ?? 0) };
  }
  return { ...r, children: kids };
}

/** Prune big trees to a preferred species set; small trees are kept whole. */
export function pruneIfLarge(
  raw: RawGeneTreeResponse,
  preferred: Set<string>,
  maxLeaves: number,
): RawGeneTreeResponse {
  if (countRawLeaves(raw.tree) <= maxLeaves) return raw;
  const pruned = pruneRaw(raw.tree, (sp) => preferred.has(sp));
  return pruned ? { ...raw, tree: pruned } : raw;
}

export function parseGeneTree(raw: RawGeneTreeResponse): GeneTree {
  const nodes = new Map<string, GeneTreeNode>();
  const leafOrder: string[] = [];

  const visit = (r: RawNode, id: string, parentId: string | null, depth: number) => {
    const kids = r.children ?? [];
    const tx = r.taxonomy ?? {};
    const node: GeneTreeNode = {
      id,
      parentId,
      childIds: kids.map((_, i) => `${id}.${i}`),
      depth,
      branchLength: r.branch_length ?? 0,
      taxon: {
        id: tx.id,
        scientificName: tx.scientific_name ?? 'Unknown',
        commonName: tx.common_name,
        mya: tx.timetree_mya,
      },
    };
    if (kids.length > 0) {
      const t = r.events?.type as NodeEvent | undefined;
      node.event = t && KNOWN_EVENTS.includes(t) ? t : 'unknown';
      if (r.confidence?.bootstrap != null) node.bootstrap = r.confidence.bootstrap;
    } else {
      const name = r.sequence?.name;
      node.leaf = {
        geneId: r.id?.accession ?? id,
        proteinId: r.sequence?.id?.[0]?.accession ?? '',
        transcriptName: name,
        symbol: name ? name.replace(/-\d+$/, '') : undefined,
        alignedSeq: r.sequence?.mol_seq?.seq ?? '',
      };
      leafOrder.push(id);
    }
    nodes.set(id, node);
    kids.forEach((k, i) => visit(k, `${id}.${i}`, id, depth + 1));
  };

  visit(raw.tree, 'r', null, 0);
  return { treeId: raw.id, rootId: 'r', nodes, leafOrder };
}

export const isLeaf = (n: GeneTreeNode) => n.childIds.length === 0;

/** Lowest common ancestor of two nodes. */
export function lca(tree: GeneTree, a: string, b: string): string {
  const seen = new Set<string>();
  for (let cur: string | null = a; cur; cur = tree.nodes.get(cur)!.parentId) seen.add(cur);
  for (let cur: string | null = b; cur; cur = tree.nodes.get(cur)!.parentId) {
    if (seen.has(cur)) return cur;
  }
  return tree.rootId;
}

/**
 * Relationship between two extant genes: orthologs if their LCA is a
 * speciation event, paralogs if it is a duplication.
 */
export function relationship(tree: GeneTree, a: string, b: string): 'ortholog' | 'paralog' | 'self' | 'unknown' {
  if (a === b) return 'self';
  const ev = tree.nodes.get(lca(tree, a, b))!.event;
  if (ev === 'speciation') return 'ortholog';
  if (ev === 'duplication') return 'paralog';
  return 'unknown';
}

/** Ungapped protein sequence for a leaf. */
export const ungapped = (seq: string) => seq.replace(/-/g, '');

export function displayName(n: GeneTreeNode): string {
  const sp = n.taxon.commonName ?? n.taxon.scientificName;
  if (n.leaf) return `${n.leaf.symbol ?? n.leaf.geneId} · ${sp}`;
  return `Ancestor · ${n.taxon.scientificName}`;
}
