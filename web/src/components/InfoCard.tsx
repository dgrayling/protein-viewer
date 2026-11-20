import type { GeneTree, GeneTreeNode } from '../model/geneTree';
import { relationship } from '../model/geneTree';
import type { UniProtEntry } from '../api/uniprot';
import type { AncestorInfo } from '../api/ancestors';

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
  /** Reconstruction for this node, if it is an ancestor. */
  ancestor?: AncestorInfo;
  /** Set when the ancestor service is unreachable or failed. */
  ancestorError?: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  speciation: 'Speciation: lineages split into separate species',
  duplication: 'Gene duplication: one gene copied into two within a genome',
  gene_split: 'Gene split',
  unknown: 'Unknown event',
};

function PinButton({ isPinned, anyPinned, onClick }: { isPinned: boolean; anyPinned: boolean; onClick: () => void }) {
  return (
    <button
      className={`pin ${isPinned ? 'pin--on' : ''}`}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      title={isPinned ? 'Unpin' : 'Pin as reference, then flick to compare others against it'}
    >
      {isPinned ? 'Pinned' : anyPinned ? 'Pin this instead' : 'Pin & compare'}
    </button>
  );
}

function AncestorStatus({ ancestor, error }: { ancestor?: AncestorInfo; error?: string | null }) {
  if (error) return <p className="muted small">Ancestor service unavailable: {error}</p>;
  if (!ancestor) return <p className="muted small">Reconstructing ancestral sequence…</p>;
  const s = ancestor.structure;
  return (
    <p className="small">
      {ancestor.sequence.length} aa · sequence confidence {(ancestor.meanPosterior * 100).toFixed(0)}%
      {s.status === 'done' && s.meanPlddt != null && <> · fold pLDDT {s.meanPlddt.toFixed(0)}</>}
      {(s.status === 'pending' || s.status === 'folding') && <span className="muted"> · predicting structure…</span>}
      {s.status === 'error' && <span className="muted"> · structure failed: {s.error}</span>}
      {ancestor.approximate && (
        <span className="muted" title="The substitution model is unrooted, so the root is taken from the branch below it">
          {' '}· root approximated
        </span>
      )}
    </p>
  );
}

export function InfoCard(props: Props) {
  const { tree, node, previousLeafId, uniprot, loading, pinnedId, onTogglePin, ancestor, ancestorError } = props;
  const isPinned = pinnedId === node.id;

  if (!node.leaf) {
    const leaves = countLeaves(tree, node.id);
    return (
      <div className="info-card info-card--ancestor">
        {ancestor && <PinButton isPinned={isPinned} anyPinned={!!pinnedId} onClick={onTogglePin} />}
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
        <AncestorStatus ancestor={ancestor} error={ancestorError} />
      </div>
    );
  }

  // Badge relative to the pinned protein if any, else the one we came from.
  const otherId = pinnedId ?? previousLeafId;
  const rel = otherId ? relationship(tree, otherId, node.id) : 'self';
  const prev = otherId ? tree.nodes.get(otherId) : undefined;
  return (
    <div className="info-card">
      <PinButton isPinned={isPinned} anyPinned={!!pinnedId} onClick={onTogglePin} />
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
      {prev && !prev.leaf && pinnedId === prev.id && isDescendant(tree, node.id, prev.id) && (
        <span className="badge badge--ancestor">descendant of pinned ancestor</span>
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

function isDescendant(tree: GeneTree, id: string, ancestorId: string): boolean {
  for (let cur = tree.nodes.get(id)?.parentId ?? null; cur; cur = tree.nodes.get(cur)?.parentId ?? null) {
    if (cur === ancestorId) return true;
  }
  return false;
}

function countLeaves(tree: GeneTree, id: string): number {
  const n = tree.nodes.get(id)!;
  return n.childIds.length === 0 ? 1 : n.childIds.reduce((s, c) => s + countLeaves(tree, c), 0);
}
