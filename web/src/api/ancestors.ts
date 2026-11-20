import { useMutation, useQuery } from '@tanstack/react-query';
import type { GeneTree } from '../model/geneTree';
import type { StructureSource } from './alphafold';

export const ANCESTOR_API: string = import.meta.env.VITE_ANCESTOR_API ?? 'http://127.0.0.1:8000';

export type FoldStatus = 'pending' | 'folding' | 'done' | 'error';

export interface AncestorInfo {
  sequence: string;
  posteriors: number[];
  /** Alignment column of each residue in `sequence`. */
  columns: number[];
  meanPosterior: number;
  /** Root node: borrowed from a child because the model is unrooted. */
  approximate: boolean;
  structure: { status: FoldStatus; meanPlddt?: number; error?: string };
}

export interface Reconstruction {
  jobId: string;
  treeId: string;
  ancestors: Record<string, AncestorInfo>;
}

function payload(tree: GeneTree) {
  return {
    treeId: tree.treeId,
    nodes: [...tree.nodes.values()].map((n) => ({
      id: n.id,
      parentId: n.parentId,
      branchLength: n.branchLength,
      alignedSeq: n.leaf?.alignedSeq ?? null,
    })),
  };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Ancestor service error ${res.status}`);
  }
  return res.json();
}

/**
 * Submit the tree once (ASR is instant), then poll while any structure is
 * still folding. Node IDs match the frontend tree exactly.
 */
export function useReconstruction(tree: GeneTree | undefined) {
  return useQuery({
    queryKey: ['reconstruction', tree?.treeId, tree?.leafOrder.length],
    enabled: !!tree,
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal, client, queryKey }) => {
      const prev = client.getQueryData<Reconstruction>(queryKey);
      if (prev) {
        return json<Reconstruction>(await fetch(`${ANCESTOR_API}/reconstructions/${prev.jobId}`, { signal }));
      }
      return json<Reconstruction>(
        await fetch(`${ANCESTOR_API}/reconstructions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(tree!)),
          signal,
        }),
      );
    },
    refetchInterval: (q) => {
      const anc = q.state.data?.ancestors;
      if (!anc) return false;
      const busy = Object.values(anc).some((a) => a.structure.status === 'pending' || a.structure.status === 'folding');
      return busy ? 3000 : false;
    },
  });
}

/** Ask the service to fold these nodes next (the user is at / near them). */
export function usePrioritise(jobId: string | undefined) {
  return useMutation({
    mutationFn: async (nodeId: string) => {
      if (!jobId) return;
      await fetch(`${ANCESTOR_API}/reconstructions/${jobId}/nodes/${encodeURIComponent(nodeId)}/fold`, { method: 'POST' });
    },
  });
}

export function ancestorStructure(jobId: string, nodeId: string): StructureSource {
  return {
    url: `${ANCESTOR_API}/reconstructions/${jobId}/nodes/${encodeURIComponent(nodeId)}/structure.pdb`,
    format: 'pdb',
    isBinary: false,
    provenance: 'ancestor',
  };
}

/** Rebuild an ancestor's row of the multiple alignment ('-' where absent). */
export function ancestorAligned(a: AncestorInfo, alnLength: number): string {
  const row = new Array<string>(alnLength).fill('-');
  a.columns.forEach((col, i) => (row[col] = a.sequence[i]));
  return row.join('');
}
