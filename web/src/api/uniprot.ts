const BASE = 'https://rest.uniprot.org/uniprotkb/search';

export interface UniProtEntry {
  accession: string;
  reviewed: boolean;
  proteinName?: string;
  function?: string;
  /** Canonical sequence; AlphaFold models follow this numbering. */
  sequence?: string;
}

interface RawEntry {
  primaryAccession: string;
  entryType?: string;
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: { fullName?: { value?: string } }[];
  };
  comments?: { commentType?: string; texts?: { value?: string }[] }[];
  sequence?: { value?: string };
}

async function search(query: string, signal?: AbortSignal): Promise<UniProtEntry | null> {
  const params = new URLSearchParams({
    query,
    fields: 'accession,reviewed,protein_name,cc_function,sequence',
    format: 'json',
    size: '5',
  });
  const res = await fetch(`${BASE}?${params}`, { signal });
  if (!res.ok) throw new Error(`UniProt error ${res.status}`);
  const { results } = (await res.json()) as { results: RawEntry[] };
  if (!results?.length) return null;
  // Prefer Swiss-Prot (reviewed) entries.
  const e = results.find((r) => r.entryType?.includes('reviewed (Swiss-Prot)')) ?? results[0];
  const pd = e.proteinDescription;
  return {
    accession: e.primaryAccession,
    reviewed: !!e.entryType?.includes('Swiss-Prot'),
    proteinName: pd?.recommendedName?.fullName?.value ?? pd?.submissionNames?.[0]?.fullName?.value,
    function: e.comments?.find((c) => c.commentType === 'FUNCTION')?.texts?.[0]?.value,
    sequence: e.sequence?.value,
  };
}

/** Map an Ensembl protein to UniProt, falling back to gene symbol + taxon. */
export async function lookupProtein(
  args: { ensemblProteinId: string; symbol?: string; taxonId?: number },
  signal?: AbortSignal,
): Promise<UniProtEntry | null> {
  const byXref = await search(`xref:ensembl-${args.ensemblProteinId}`, signal);
  if (byXref) return byXref;
  if (args.symbol && args.taxonId) {
    return search(`gene_exact:${args.symbol} AND organism_id:${args.taxonId}`, signal);
  }
  return null;
}
