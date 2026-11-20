import type { GeneTree, GeneTreeNode } from '../model/geneTree';
import { relationship } from '../model/geneTree';
import type { UniProtEntry } from '../api/uniprot';

interface Props {
  tree: GeneTree;
  node: GeneTreeNode;
  /** Previously viewed leaf, for the ortholog/paralog badge. */
  previousLeafId: string | null;
  uniprot?: UniProtEntry | null;
  loading: boolean;
  /** Pinned reference protein for compare mode. */
  pinnedId: string | null;
  onTogglePin: () => void;
}

const EVENT_LABEL: Record<string, string> = {
  speciation: 'Speciation: lineages split into separate species',
  duplication: 'Gene duplication: one gene copied into two within a genome',
  gene_split: 'Gene split',
  unknown: 'Unknown event',
};

export function InfoCard({ tree, node, previousLeafId, uniprot, loading, pinnedId, onTogglePin }: Props) {
  if (!node.leaf) {
    const leaves = countLeaves(tree, node.id);
    return (
      <div className="info-card info-card--ancestor">
        <div className="info-kicker">Common ancestor · inferred</div>
        <h2>
          <em>{node.taxon.scientificName}</em>
          {node.taxon.commonName && <span className="muted"> ({node.taxon.commonName})</span>}
        </h2>
        <p>
          {node.taxon.mya != null ? `~${node.taxon.mya} million years ago · ` : ''}
          {leaves} descendant proteins
        </p>
        <p className={`event event--${node.event}`}>{EVENT_LABEL[node.event ?? 'unknown']}</p>
        <p className="muted small">Reconstructed ancestral structure: coming in a later milestone.</p>
      </div>
    );
  }

  // Badge relative to the pinned protein if any, else the one we came from.
  const otherId = pinnedId ?? previousLeafId;
  const rel = otherId ? relationship(tree, otherId, node.id) : 'self';
  const prev = otherId ? tree.nodes.get(otherId) : undefined;
  const isPinned = pinnedId === node.id;
  return (
    <div className="info-card">
      <button
        className={`pin ${isPinned ? 'pin--on' : ''}`}
        onClick={onTogglePin}
        onPointerDown={(e) => e.stopPropagation()}
        title={isPinned ? 'Unpin' : 'Pin as reference, then flick to compare others against it'}
      >
        {isPinned ? 'Pinned' : pinnedId ? 'Pin this instead' : 'Pin & compare'}
      </button>
      <div className="info-kicker">
        {node.taxon.commonName ?? node.taxon.scientificName} · <em>{node.taxon.scientificName}</em>
      </div>
      <h2>
        {node.leaf.symbol ?? node.leaf.geneId}
        {uniprot?.proteinName && <span className="muted"> · {uniprot.proteinName}</span>}
      </h2>
      {(rel === 'ortholog' || rel === 'paralog') && prev?.leaf && (
        <span className={`badge badge--${rel}`} title={rel === 'ortholog' ? 'Split by speciation' : 'Split by gene duplication'}>
          {rel} of {prev.leaf.symbol} ({prev.taxon.commonName ?? prev.taxon.scientificName})
        </span>
      )}
      {uniprot?.function && <p className="small clamp">{uniprot.function}</p>}
      {!loading && !uniprot && <p className="muted small">No UniProt entry found for {node.leaf.proteinId}</p>}
      {uniprot && (
        <p className="muted small">
          <a href={`https://www.uniprot.org/uniprotkb/${uniprot.accession}`} target="_blank" rel="noreferrer">
            {uniprot.accession}
          </a>
          {' · '}
          {node.leaf.proteinId}
        </p>
      )}
    </div>
  );
}

function countLeaves(tree: GeneTree, id: string): number {
  const n = tree.nodes.get(id)!;
  return n.childIds.length === 0 ? 1 : n.childIds.reduce((s, c) => s + countLeaves(tree, c), 0);
}
