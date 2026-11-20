# Ancestor service

Reconstructs ancestral proteins for a gene tree sent by the web app:

1. **Sequence**: IQ-TREE (`--ancestral`, LG+G4, fixed topology) gives
   per-site posteriors for every internal node. Gaps are inferred by Fitch
   parsimony on the leaves' gap pattern.
2. **Structure**: ESMFold (Hugging Face `facebook/esmfold_v1`) folds each
   ancestral sequence. Runs on Apple Silicon via MPS. Folds are cached by
   sequence hash, so identical ancestors are only folded once.
3. The served PDB's B-factor = pLDDT × ASR posterior per residue (0-100).

## Setup

```sh
brew install iqtree3
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

The first fold downloads/loads ESMFold (~8 GB). Results persist in `data/`.

## Notes

- Node IDs are the web app's path IDs ("r.0.1"), computed on the tree after
  the app's species pruning, so the app sends the tree rather than the
  service re-fetching it.
- The root is reported `approximate`: IQ-TREE's reversible models are
  unrooted, so the root's state is taken from the node that absorbs it.
- Opening a gene in the app queues every ancestor for folding, nearest the
  cursor first. Visiting a gene once precomputes it.

## Tests

```sh
.venv/bin/python -m pytest -q
```
