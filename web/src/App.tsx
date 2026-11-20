import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchNodes, useGeneTree, useProtein } from './api/queries';
import { lca, ungapped, type GeneTree, type GeneTreeNode } from './model/geneTree';
import {
  ancestorAligned,
  ancestorStructure,
  usePrioritise,
  useReconstruction,
  type Reconstruction,
} from './api/ancestors';
import type { StructureSource } from './api/alphafold';
import { diffAligned, mapToModelResidues } from './model/compare';
import { cursorAt, move, neighbours, type Cursor, type Direction } from './nav/treeCursor';
import { MolstarView, type AlignmentInfo } from './viewer/MolstarView';
import { useTreeSwipe } from './gestures/useTreeSwipe';
import { SearchBar } from './components/SearchBar';
import { InfoCard } from './components/InfoCard';
import { TreeMinimap } from './components/TreeMinimap';
import { SequenceStrip } from './components/SequenceStrip';
import './App.css';

/** Start on the human copy of the searched gene, else the first leaf. */
function startNode(tree: GeneTree, symbol: string): string {
  const want = symbol.toUpperCase();
  for (const id of tree.leafOrder) {
    const n = tree.nodes.get(id)!;
    if (n.taxon.scientificName === 'Homo sapiens' && n.leaf?.symbol?.toUpperCase() === want) return id;
  }
  return tree.leafOrder.find((id) => tree.nodes.get(id)!.taxon.scientificName === 'Homo sapiens') ?? tree.leafOrder[0];
}

const KEY_DIR: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

export default function App() {
  const [symbol, setSymbol] = useState<string | null>('HBB');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [prevLeaf, setPrevLeaf] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [alignment, setAlignment] = useState<AlignmentInfo | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const qc = useQueryClient();

  const treeQ = useGeneTree(symbol);
  const tree = treeQ.data;

  // Reset navigation when a new tree arrives.
  useEffect(() => {
    if (tree && symbol) {
      setCursor(cursorAt(startNode(tree, symbol)));
      setPrevLeaf(null);
      setPinnedId(null);
    }
  }, [tree, symbol]);

  const node = tree && cursor ? tree.nodes.get(cursor.nodeId) : undefined;
  const pinned = tree && pinnedId ? tree.nodes.get(pinnedId) : undefined;
  const proteinQ = useProtein(node);
  const pinnedQ = useProtein(pinned);

  // Ancestral reconstruction for the whole tree (ASR instant, folds queued).
  const reconQ = useReconstruction(tree);
  const recon = reconQ.data;
  const prioritise = usePrioritise(recon?.jobId);
  const ancestorOf = (n: GeneTreeNode | undefined) => (n && !n.leaf ? recon?.ancestors[n.id] : undefined);
  const alnLength = tree ? (tree.nodes.get(tree.leafOrder[0])?.leaf?.alignedSeq.length ?? 0) : 0;

  const goTo = useCallback(
    (next: Cursor) => {
      if (!tree || !cursor || next.nodeId === cursor.nodeId) return;
      // Remember the last extant protein for the ortholog/paralog badge.
      if (tree.nodes.get(cursor.nodeId)?.leaf) setPrevLeaf(cursor.nodeId);
      setCursor(next);
    },
    [tree, cursor],
  );

  const nav = useCallback(
    (dir: Direction) => {
      if (tree && cursor) goTo(move(tree, cursor, dir));
    },
    [tree, cursor, goTo],
  );

  const cardSwipe = useTreeSwipe(nav);
  const edgeSwipe = useTreeSwipe(nav, { axis: 'x' });

  // Keyboard navigation (ignored while typing in the search box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const dir = KEY_DIR[e.key];
      if (dir) {
        e.preventDefault();
        nav(dir);
      } else if (e.key === 'p' && node && (node.leaf || ancestorOf(node))) {
        setPinnedId((p) => (p === node.id ? null : node.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Prefetch everything one flick away; fold nearby ancestors first.
  const jobId = recon?.jobId;
  useEffect(() => {
    if (!tree || !cursor) return;
    const near = [cursor.nodeId, ...neighbours(tree, cursor)];
    prefetchNodes(qc, tree, near);
    if (!jobId) return;
    for (const id of near) {
      const st = qc.getQueryData<Reconstruction>(['reconstruction', tree.treeId, tree.leafOrder.length])?.ancestors[id]
        ?.structure.status;
      if (st === 'pending' || st === 'error') prioritise.mutate(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on navigation, not on every poll
  }, [qc, tree, cursor, jobId]);

  /** Row of the shared alignment for any node: leaf or reconstructed ancestor. */
  const alignedOf = (n: GeneTreeNode | undefined): string | null => {
    if (!n) return null;
    if (n.leaf) return n.leaf.alignedSeq;
    const a = ancestorOf(n);
    return a ? ancestorAligned(a, alnLength) : null;
  };

  /** Structure to show for a node, with stable identity across polls. */
  const nodeStatus = (n: GeneTreeNode | undefined) => ancestorOf(n)?.structure.status;
  const currentDone = nodeStatus(node) === 'done';
  const pinnedDone = nodeStatus(pinned) === 'done';
  const currentAncestorSrc = useMemo(
    () => (jobId && node && !node.leaf && currentDone ? ancestorStructure(jobId, node.id) : null),
    [jobId, node, currentDone],
  );
  const pinnedAncestorSrc = useMemo(
    () => (jobId && pinned && !pinned.leaf && pinnedDone ? ancestorStructure(jobId, pinned.id) : null),
    [jobId, pinned, pinnedDone],
  );
  const structureOf = (n: GeneTreeNode | undefined, leafQ: typeof proteinQ, ancSrc: StructureSource | null) =>
    n?.leaf ? (leafQ.data?.structure ?? null) : ancSrc;

  // Compare mode: a pinned reference and a different node in view, both
  // with sequences (extant, or reconstructed ancestors).
  const curAligned = alignedOf(node);
  const pinAligned = alignedOf(pinned);
  const comparing = !!(tree && node && pinned && pinned.id !== node.id && curAligned && pinAligned);
  const compare = useMemo(() => {
    if (!comparing || !tree || !node || !pinned || !curAligned || !pinAligned) return null;
    const diff = diffAligned(pinAligned, curAligned);
    // Map changed positions onto the 3D model's residue numbering. Ancestor
    // models are numbered by their own sequence; AlphaFold by UniProt.
    const modelSeq = node.leaf ? proteinQ.data?.uniprot?.sequence : ungapped(curAligned);
    const highlight = modelSeq ? mapToModelResidues(diff.changedIndices, ungapped(curAligned), modelSeq) : null;
    const common = lca(tree, pinned.id, node.id);
    const split = tree.nodes.get(common)!;
    // One is the other's ancestor: a single lineage, not a split.
    const lineage = common === pinned.id || common === node.id;
    return { diff, highlight, split, lineage };
  }, [comparing, tree, node, pinned, curAligned, pinAligned, proteinQ.data]);

  const source = structureOf(node, proteinQ, currentAncestorSrc);
  const reference = comparing ? structureOf(pinned, pinnedQ, pinnedAncestorSrc) : null;

  const ancestorError = reconQ.error ? (reconQ.error as Error).message : null;
  const emptyMessage = !node
    ? 'Search for a gene to begin'
    : !node.leaf
      ? ancestorError
        ? 'Start the ancestor service to see reconstructed structures'
        : nodeStatus(node) === 'error'
          ? 'Structure prediction failed for this ancestor'
          : 'Predicting ancestral structure…'
      : proteinQ.isLoading
        ? 'Looking up structure…'
        : 'No AlphaFold model available for this protein';

  const can = (dir: Direction) => !!tree && !!cursor && move(tree, cursor, dir).nodeId !== cursor.nodeId;
  const label = (n: typeof node) =>
    n?.leaf
      ? `${n.leaf.symbol ?? n.leaf.geneId} ${n.taxon.commonName ?? n.taxon.scientificName}`
      : n
        ? `Anc. ${n.taxon.scientificName}`
        : '';
  const [ox, oy] = cardSwipe.offset;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Protein lineage</h1>
        <SearchBar onSearch={(s) => setSymbol(s.toUpperCase())} busy={treeQ.isFetching} />
      </header>

      <main className="stage">
        <MolstarView
          source={source}
          reference={reference}
          highlight={compare?.highlight}
          onAligned={setAlignment}
          emptyMessage={emptyMessage}
        />

        {/* Edge strips: horizontal flicks here don't fight 3D rotation. */}
        <div className="edge-swipe edge-swipe--left" {...edgeSwipe.bind()} />
        <div className="edge-swipe edge-swipe--right" {...edgeSwipe.bind()} />

        {treeQ.error && <div className="banner banner--error">{(treeQ.error as Error).message}</div>}

        {tree && node && (
          <div className="card-slot" key={node.id}>
            <div
              className="swipe-surface"
              {...cardSwipe.bind()}
              style={{
                transform: `translate(${ox}px, ${oy}px)`,
                opacity: 1 - Math.min(0.5, Math.hypot(ox, oy) / 300),
              }}
            >
              <InfoCard
                tree={tree}
                node={node}
                previousLeafId={prevLeaf}
                uniprot={proteinQ.data?.uniprot}
                loading={proteinQ.isLoading}
                pinnedId={pinnedId}
                onTogglePin={() => setPinnedId((p) => (p === node.id ? null : node.id))}
                ancestor={ancestorOf(node)}
                ancestorError={ancestorError}
              />
            </div>
          </div>
        )}

        {compare && pinned && node && (
          <div className="seqstrip-slot">
            <SequenceStrip
              diff={compare.diff}
              refLabel={label(pinned)}
              curLabel={label(node)}
              split={{
                taxon: compare.split.taxon.scientificName,
                mya: compare.split.taxon.mya,
                event: compare.split.event,
                lineage: compare.lineage,
              }}
              alignment={alignment}
              mapped={!!compare.highlight}
            />
          </div>
        )}

        <nav className="dpad" aria-label="Navigate gene tree">
          <button onClick={() => nav('up')} disabled={!can('up')} aria-label="Ancestor" className="dpad-up">▲<span>ancestor</span></button>
          <button onClick={() => nav('left')} disabled={!can('left')} aria-label="Previous" className="dpad-left">◀</button>
          <button onClick={() => nav('right')} disabled={!can('right')} aria-label="Next" className="dpad-right">▶</button>
          <button onClick={() => nav('down')} disabled={!can('down')} aria-label="Descendant" className="dpad-down">▼<span>descendant</span></button>
        </nav>
      </main>

      {tree && cursor && (
        <aside className={`tree-panel ${treeOpen ? 'open' : ''}`}>
          <button className="tree-toggle" onClick={() => setTreeOpen((o) => !o)}>
            Gene tree · {tree.leafOrder.length} proteins {treeOpen ? '▾' : '▴'}
          </button>
          {treeOpen && (
            <TreeMinimap tree={tree} currentId={cursor.nodeId} pinnedId={pinnedId} onSelect={(id) => goTo(cursorAt(id))} />
          )}
        </aside>
      )}
    </div>
  );
}
