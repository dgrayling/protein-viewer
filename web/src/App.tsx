import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchNodes, useGeneTree, useProtein } from './api/queries';
import { lca, ungapped, type GeneTree } from './model/geneTree';
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
      } else if (e.key === 'p' && node?.leaf) {
        setPinnedId((p) => (p === node.id ? null : node.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, node]);

  // Prefetch everything one flick away.
  useEffect(() => {
    if (tree && cursor) prefetchNodes(qc, tree, neighbours(tree, cursor));
  }, [qc, tree, cursor]);

  // Compare mode: a pinned reference and a different extant protein in view.
  const comparing = !!(tree && node?.leaf && pinned?.leaf && pinned.id !== node.id);
  const compare = useMemo(() => {
    if (!comparing || !tree || !node?.leaf || !pinned?.leaf) return null;
    const diff = diffAligned(pinned.leaf.alignedSeq, node.leaf.alignedSeq);
    const modelSeq = proteinQ.data?.uniprot?.sequence;
    const highlight = modelSeq ? mapToModelResidues(diff.changedIndices, ungapped(node.leaf.alignedSeq), modelSeq) : null;
    const split = tree.nodes.get(lca(tree, pinned.id, node.id))!;
    return { diff, highlight, split };
  }, [comparing, tree, node, pinned, proteinQ.data]);

  const source = node?.leaf ? (proteinQ.data?.structure ?? null) : null;
  const reference = comparing ? (pinnedQ.data?.structure ?? null) : null;

  const emptyMessage = !node
    ? 'Search for a gene to begin'
    : !node.leaf
      ? 'Ancestral structure not yet reconstructed'
      : proteinQ.isLoading
        ? 'Looking up structure…'
        : 'No AlphaFold model available for this protein';

  const can = (dir: Direction) => !!tree && !!cursor && move(tree, cursor, dir).nodeId !== cursor.nodeId;
  const label = (n: typeof node) =>
    n?.leaf ? `${n.leaf.symbol ?? n.leaf.geneId} ${n.taxon.commonName ?? n.taxon.scientificName}` : '';
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
                onTogglePin={() => setPinnedId((p) => (p === node.id ? null : node.leaf ? node.id : p))}
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
              split={{ taxon: compare.split.taxon.scientificName, mya: compare.split.taxon.mya, event: compare.split.event }}
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
