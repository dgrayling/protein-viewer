import { parseGeneTree, pruneIfLarge, type GeneTree, type RawGeneTreeResponse } from '../model/geneTree';

const BASE = 'https://rest.ensembl.org';

/**
 * Species kept when a tree is too large to browse comfortably. Spans
 * ~600 My: primates, other mammals, marsupial, monotreme, birds, reptile,
 * amphibian, fish, plus a few invertebrates for very old families.
 */
export const PREFERRED_SPECIES = new Set([
  'Homo sapiens', 'Pan troglodytes', 'Gorilla gorilla gorilla', 'Macaca mulatta', 'Callithrix jacchus',
  'Mus musculus', 'Rattus norvegicus', 'Oryctolagus cuniculus', 'Canis lupus familiaris', 'Felis catus',
  'Bos taurus', 'Sus scrofa', 'Equus caballus', 'Loxodonta africana', 'Tursiops truncatus',
  'Monodelphis domestica', 'Ornithorhynchus anatinus',
  'Gallus gallus', 'Taeniopygia guttata', 'Anolis carolinensis', 'Chrysemys picta bellii',
  'Xenopus tropicalis', 'Danio rerio', 'Oryzias latipes', 'Latimeria chalumnae', 'Petromyzon marinus',
  'Ciona intestinalis', 'Drosophila melanogaster', 'Caenorhabditis elegans', 'Saccharomyces cerevisiae',
]);

export const MAX_LEAVES = 60;

export async function fetchGeneTree(
  symbol: string,
  opts: { species?: string; signal?: AbortSignal } = {},
): Promise<GeneTree> {
  const species = opts.species ?? 'homo_sapiens';
  const params = new URLSearchParams({ aligned: '1', sequence: 'protein', 'content-type': 'application/json' });
  const url = `${BASE}/genetree/member/symbol/${species}/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetch(url, { signal: opts.signal });
  if (res.status === 400 || res.status === 404) {
    throw new Error(`No gene tree found for "${symbol}" in ${species.replace('_', ' ')}`);
  }
  if (res.status === 429) throw new Error('Ensembl rate limit hit, try again in a few seconds');
  if (!res.ok) throw new Error(`Ensembl error ${res.status}`);
  const raw = (await res.json()) as RawGeneTreeResponse;
  return parseGeneTree(pruneIfLarge(raw, PREFERRED_SPECIES, MAX_LEAVES));
}
