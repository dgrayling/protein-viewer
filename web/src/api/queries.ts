import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { GeneTree, GeneTreeNode } from '../model/geneTree';
import { fetchGeneTree } from './ensembl';
import { lookupProtein } from './uniprot';
import { fetchAlphaFold } from './alphafold';

const DAY = 24 * 60 * 60 * 1000;

export const geneTreeQuery = (symbol: string) => ({
  queryKey: ['genetree', symbol.toUpperCase()],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchGeneTree(symbol, { signal }),
  staleTime: DAY,
});

export const useGeneTree = (symbol: string | null) =>
  useQuery({ ...geneTreeQuery(symbol ?? ''), enabled: !!symbol });

/** UniProt entry + AlphaFold structure for a leaf node. */
const proteinQuery = (node: GeneTreeNode | undefined) => ({
  queryKey: ['protein', node?.leaf?.proteinId],
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const leaf = node!.leaf!;
    const uniprot = await lookupProtein(
      { ensemblProteinId: leaf.proteinId, symbol: leaf.symbol, taxonId: node!.taxon.id },
      signal,
    );
    const structure = uniprot ? await fetchAlphaFold(uniprot.accession, signal) : null;
    return { uniprot, structure };
  },
  staleTime: DAY,
});

export const useProtein = (node: GeneTreeNode | undefined) =>
  useQuery({ ...proteinQuery(node), enabled: !!node?.leaf });

/** Warm the cache for nodes one flick away. */
export function prefetchNodes(qc: QueryClient, tree: GeneTree, ids: string[]) {
  for (const id of ids) {
    const node = tree.nodes.get(id);
    if (node?.leaf) void qc.prefetchQuery(proteinQuery(node));
  }
}
