import { describe, expect, it } from 'vitest';
import { diffAligned, mapToModelResidues } from './compare';

describe('diffAligned', () => {
  it('classifies columns and skips all-gap columns', () => {
    //            ref: M K - L V -   (cols 2 and 5)
    //            cur: M R A L - -
    const d = diffAligned('MK-LV-', 'MRAL--');
    expect(d.columns.map((c) => c.kind)).toEqual(['same', 'sub', 'ins', 'same', 'del']);
    expect(d.substitutions).toBe(1);
    expect(d.insertions).toBe(1);
    expect(d.deletions).toBe(1);
    expect(d.changedIndices).toEqual([1, 2]);
    expect(d.identity).toBeCloseTo(2 / 3);
  });

  it('rejects unequal lengths', () => {
    expect(() => diffAligned('MK', 'M')).toThrow();
  });
});

describe('mapToModelResidues', () => {
  it('maps with offset when Ensembl seq is a substring', () => {
    expect(mapToModelResidues([0, 2], 'KLV', 'MKLVA')).toEqual([2, 4]);
  });
  it('maps identity for equal-length variants', () => {
    expect(mapToModelResidues([0], 'MKLV', 'MRLV')).toEqual([1]);
  });
  it('gives up when sequences are irreconcilable', () => {
    expect(mapToModelResidues([0], 'MKLV', 'MKLVAAAA')).toEqual([1]); // substring at 0
    expect(mapToModelResidues([0], 'XYZ', 'MKLVA')).toBeNull();
  });
});
