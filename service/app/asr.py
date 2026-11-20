"""Ancestral sequence reconstruction with IQ-TREE on a fixed topology."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .tree import Tree, from_safe_name

AA = "ARNDCQEGHILKMFPSTWYV"


@dataclass
class Ancestor:
    node_id: str
    sequence: str  # ungapped, most probable residue at each retained site
    posteriors: list[float]  # probability of the chosen residue, per residue in `sequence`
    alignment_columns: list[int]  # MSA column of each residue
    approximate: bool = False  # True if borrowed from a neighbouring node (see below)

    @property
    def mean_posterior(self) -> float:
        return sum(self.posteriors) / len(self.posteriors) if self.posteriors else 0.0


def iqtree_binary() -> str:
    for name in ("iqtree3", "iqtree2", "iqtree"):
        if path := shutil.which(name):
            return path
    raise RuntimeError("IQ-TREE not found on PATH (brew install iqtree3)")


def run_iqtree(tree: Tree, workdir: Path, model: str = "LG+G4") -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "aln.fasta").write_text(tree.to_fasta())
    (workdir / "tree.nwk").write_text(tree.to_newick())
    cmd = [
        iqtree_binary(),
        "-s", "aln.fasta",
        "-te", "tree.nwk",      # fixed topology; branch lengths re-optimised
        "-m", model,
        "--ancestral",
        "-keep-ident",          # keep identical sequences, so every node survives
        "--prefix", "asr",
        "-redo",
        "--quiet",
    ]
    proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True)
    state = workdir / "asr.state"
    if proc.returncode != 0 or not state.exists():
        log = (workdir / "asr.log").read_text() if (workdir / "asr.log").exists() else proc.stderr
        raise RuntimeError(f"IQ-TREE failed (exit {proc.returncode}):\n{log[-2000:]}")
    return state


def parse_state(path: Path) -> dict[str, list[tuple[str, list[float]]]]:
    """node name -> per-site (state, [p_A, p_R, ...]) in alignment column order."""
    out: dict[str, list[tuple[str, list[float]]]] = {}
    header: list[str] | None = None
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if header is None:
            header = parts
            continue
        node, _site, state, *probs = parts
        out.setdefault(node, []).append((state, [float(p) for p in probs]))
    if header is None or header[3:] != [f"p_{a}" for a in AA]:
        raise RuntimeError(f"unexpected .state header: {header}")
    return out


def reconstruct(tree: Tree, workdir: Path) -> dict[str, Ancestor]:
    states = parse_state(run_iqtree(tree, workdir))
    by_id = {from_safe_name(name): sites for name, sites in states.items()}
    gaps = tree.gap_states()

    ancestors: dict[str, Ancestor] = {}
    for nid in tree.internal():
        sites = by_id.get(nid)
        approximate = False
        if sites is None:
            # IQ-TREE models are reversible, so it unroots the tree and the
            # root's bifurcation disappears. Under a reversible model the
            # root sits on the branch between its two children; borrow the
            # internal child (that node now carries the merged branch).
            sites = next((by_id[c] for c in tree.nodes[nid].children if c in by_id), None)
            approximate = True
        if sites is None:
            continue
        seq, post, cols = [], [], []
        for col, (_state, probs) in enumerate(sites):
            if not gaps[nid][col]:
                continue
            best = max(range(20), key=probs.__getitem__)
            seq.append(AA[best])
            post.append(probs[best])
            cols.append(col)
        ancestors[nid] = Ancestor(nid, "".join(seq), post, cols, approximate)
    return ancestors
