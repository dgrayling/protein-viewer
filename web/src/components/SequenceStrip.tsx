import type { PairDiff } from '../model/compare';
import type { AlignmentInfo } from '../viewer/MolstarView';

interface Props {
  diff: PairDiff;
  refLabel: string;
  curLabel: string;
  /** Last common ancestor of the pair. */
  split: { taxon: string; mya?: number; event?: string; lineage?: boolean };
  alignment: AlignmentInfo | null;
  /** False if changed residues couldn't be mapped onto the 3D model. */
  mapped: boolean;
}

export function SequenceStrip({ diff, refLabel, curLabel, split, alignment, mapped }: Props) {
  const pct = (diff.identity * 100).toFixed(0);
  return (
    <div className="seqstrip">
      <div className="seqstrip-summary">
        <strong>{pct}% identical</strong>
        <span>{diff.substitutions} substitutions</span>
        {diff.insertions + diff.deletions > 0 && <span>{diff.insertions + diff.deletions} indels</span>}
        {alignment && <span title="TM-score > 0.5 means the same fold">TM {alignment.tmScore.toFixed(2)} · {alignment.rmsd.toFixed(1)} Å</span>}
      </div>
      <div className="seqstrip-split">
        {split.lineage ? (
          <>
            Same lineage: changes accumulated since the <em>{split.taxon}</em> ancestor
            {split.mya != null ? ` (~${split.mya} Mya)` : ''}
          </>
        ) : (
          <>
            Split {split.mya != null ? `~${split.mya} Mya ` : ''}in <em>{split.taxon}</em> by{' '}
            <span className={`event--${split.event}`}>{split.event === 'duplication' ? 'gene duplication' : split.event}</span>
          </>
        )}
        {!mapped && <span className="muted"> · changes not mapped to 3D (sequence mismatch)</span>}
      </div>
      <div className="seqstrip-scroll">
        <div className="seqstrip-rows">
          <div className="seqstrip-label">{refLabel}</div>
          <div className="seqstrip-row">
            {diff.columns.map((c, i) => (
              <span key={i} className={`aa aa--${c.kind}`}>{c.ref}</span>
            ))}
          </div>
          <div className="seqstrip-label">{curLabel}</div>
          <div className="seqstrip-row">
            {diff.columns.map((c, i) => (
              <span key={i} className={`aa aa--${c.kind}`}>{c.cur}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
