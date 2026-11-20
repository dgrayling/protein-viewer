# Protein lineage

A mobile-first protein viewer for exploring evolution through gene trees. Flick
between related proteins, swipe up to their common ancestor, and compare any
two nodes, including **reconstructed ancestral proteins** with predicted 3D
structures.

- **Extant proteins**: Ensembl Compara gene trees + alignments, UniProt
  annotations, AlphaFold DB structures (coloured by pLDDT).
- **Ancestors**: IQ-TREE ancestral sequence reconstruction on the Compara tree,
  folded with ESMFold, coloured by pLDDT × reconstruction posterior.
- **Compare**: pin any node, flick to another. TM-align superposition, changed
  residues highlighted in 3D, and a sequence strip with identity, substitutions,
  indels, and when/how the pair split (speciation vs gene duplication).

```
web/      Vite + React + TypeScript app (Mol* viewer, d3 tree, gestures)
service/  FastAPI ancestor service (IQ-TREE + ESMFold)
```

## Running locally

### Web app

```sh
cd web
npm install
npm run dev          # http://localhost:5173
npm test             # vitest
```

Point it at a non-default ancestor service with `VITE_ANCESTOR_API=http://host:8000`.
The app works without the service; ancestor nodes then show a notice instead of
a structure.

### Ancestor service

Needs IQ-TREE and ~9 GB for PyTorch + ESMFold weights (downloaded on first fold).

```sh
# IQ-TREE: macOS `brew install iqtree3`; Linux: conda install -c bioconda iqtree,
# or a release binary from https://iqtree.github.io (iqtree3/iqtree2 on PATH)
cd service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # on CUDA machines install the matching torch build first
.venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest -q
```

ESMFold runs on CUDA, Apple MPS, or CPU (picked automatically; ESM-2 runs in
fp16 on GPUs). On an M3 MacBook (16 GB) a ~150 aa globin takes 20–55 s per
fold. Allowed browser origins are set with `CORS_ORIGINS` (comma-separated).
Results are cached in `service/data/` (git-ignored).

## How it works

- Node IDs are path IDs (`r`, `r.0`, `r.0.1`, …) computed in the browser after
  species pruning (trees over 60 leaves are pruned to ~30 reference species).
  The app sends that tree to the service, so IDs match exactly.
- Ancestral gaps are inferred by Fitch parsimony on the leaves' gap pattern.
- The root is reported as *approximate*: IQ-TREE's reversible models are
  unrooted, so the root's state is taken from the node that absorbs it.
- Folds run in a priority queue: nodes near the user's cursor first, the rest
  in the background. Identical sequences are folded once.

## Status and next steps

Done: gene-tree navigation (swipe, keyboard, minimap), ortholog/paralog badges,
divergence dates, pin & compare, ancestral reconstruction and folding.

Next:
- Precompute showcase families (opening a gene in the app queues all its ancestors): MB, RHO, CYCS, LYZ, INS.
- Code-split Mol* (bundle is ~970 KB gzipped).
- Service logging: app log lines are swallowed by uvicorn's logging config.
- Deploy: static site for `web/`, GPU host for `service/`.
- Check the phone layout on a real device.

## Data sources

[Ensembl Compara](https://rest.ensembl.org), [UniProt](https://www.uniprot.org),
[AlphaFold DB](https://alphafold.ebi.ac.uk), [ESMFold](https://huggingface.co/facebook/esmfold_v1),
[IQ-TREE](https://iqtree.github.io), [Mol*](https://molstar.org).
