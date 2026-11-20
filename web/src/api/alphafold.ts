export interface StructureSource {
  url: string;
  format: 'mmcif' | 'pdb';
  isBinary: boolean;
  /** Where it came from, for the info card. */
  provenance: 'alphafold' | 'ancestor';
}

interface RawPrediction {
  bcifUrl?: string;
  cifUrl?: string;
  pdbUrl?: string;
}

/** AlphaFold DB model for a UniProt accession, or null if none exists. */
export async function fetchAlphaFold(accession: string, signal?: AbortSignal): Promise<StructureSource | null> {
  const res = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${accession}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`AlphaFold DB error ${res.status}`);
  const [p] = (await res.json()) as RawPrediction[];
  if (!p) return null;
  // BinaryCIF is much smaller, which matters on mobile.
  if (p.bcifUrl) return { url: p.bcifUrl, format: 'mmcif', isBinary: true, provenance: 'alphafold' };
  if (p.cifUrl) return { url: p.cifUrl, format: 'mmcif', isBinary: false, provenance: 'alphafold' };
  if (p.pdbUrl) return { url: p.pdbUrl, format: 'pdb', isBinary: false, provenance: 'alphafold' };
  return null;
}
