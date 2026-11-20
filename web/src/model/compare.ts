// Pairwise comparison of two proteins that share a Compara multiple
// alignment, so columns already correspond and no realignment is needed.

export interface AlignedColumn {
  /** Residue in the reference ('-' for gap). */
  ref: string;
  /** Residue in the current protein ('-' for gap). */
  cur: string;
  /** 0-based index into the ungapped current sequence, or null if gap. */
  curIndex: number | null;
  kind: 'same' | 'sub' | 'ins' | 'del';
}

export interface PairDiff {
  columns: AlignedColumn[];
  /** Fraction identical over columns where both have a residue. */
  identity: number;
  substitutions: number;
  /** Residues present in current but not reference. */
  insertions: number;
  /** Residues present in reference but not current. */
  deletions: number;
  /** 0-based ungapped indices in the current protein that differ (sub or ins). */
  changedIndices: number[];
}

export function diffAligned(refAligned: string, curAligned: string): PairDiff {
  if (refAligned.length !== curAligned.length) {
    throw new Error('Aligned sequences must have equal length');
  }
  const columns: AlignedColumn[] = [];
  const changedIndices: number[] = [];
  let curIdx = 0;
  let same = 0, subs = 0, ins = 0, del = 0;

  for (let i = 0; i < curAligned.length; i++) {
    const r = refAligned[i];
    const c = curAligned[i];
    const rGap = r === '-';
    const cGap = c === '-';
    if (rGap && cGap) continue; // column belongs to other family members
    let kind: AlignedColumn['kind'];
    if (rGap) kind = 'ins';
    else if (cGap) kind = 'del';
    else kind = r === c ? 'same' : 'sub';

    const index = cGap ? null : curIdx++;
    columns.push({ ref: r, cur: c, curIndex: index, kind });
    if (kind === 'same') same++;
    else if (kind === 'sub') subs++;
    else if (kind === 'ins') ins++;
    else del++;
    if ((kind === 'sub' || kind === 'ins') && index !== null) changedIndices.push(index);
  }

  const both = same + subs;
  return {
    columns,
    identity: both ? same / both : 0,
    substitutions: subs,
    insertions: ins,
    deletions: del,
    changedIndices,
  };
}

/**
 * Map 0-based indices in the Ensembl protein onto 1-based residue numbers
 * (label_seq_id) in the AlphaFold model, which follows the UniProt sequence.
 * Returns null if the two sequences can't be reconciled confidently.
 */
export function mapToModelResidues(indices: number[], ensemblSeq: string, modelSeq: string): number[] | null {
  let offset: number;
  const at = modelSeq.indexOf(ensemblSeq);
  if (at >= 0) offset = at;
  else if (modelSeq.length === ensemblSeq.length) offset = 0; // same isoform, point variants
  else return null;
  return indices.map((i) => i + offset + 1).filter((n) => n >= 1 && n <= modelSeq.length);
}
