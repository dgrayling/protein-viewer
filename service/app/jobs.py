"""Reconstruction jobs: ASR runs synchronously (it takes well under a second),
then ancestral structures are folded one at a time by a background worker.

Everything is persisted under DATA_DIR so restarts and repeat visits are
instant:
  jobs/<job_id>/ancestors.json   ASR results + per-node structure status
  jobs/<job_id>/iqtree/          IQ-TREE working files
  folds/<sha256(seq)>.json       ESMFold output, shared across jobs
"""

from __future__ import annotations

import hashlib
import heapq
import itertools
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from .asr import reconstruct
from .fold import folder, set_bfactors
from .tree import Tree, TreeIn, safe_name

log = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("ANCESTOR_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

PRIORITY_REQUESTED = 0  # the user is looking at it (or one flick away)
PRIORITY_BACKGROUND = 10


def job_id_for(tree: Tree) -> str:
    h = hashlib.sha256()
    h.update(tree.tree_id.encode())
    h.update(tree.to_newick().encode())
    h.update(tree.to_fasta().encode())
    return h.hexdigest()[:16]


def seq_key(seq: str) -> str:
    return hashlib.sha256(seq.encode()).hexdigest()[:24]


class JobStore:
    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self.data_dir = data_dir
        (data_dir / "jobs").mkdir(parents=True, exist_ok=True)
        (data_dir / "folds").mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._queue: list[tuple[int, int, str, str]] = []
        self._queued: dict[tuple[str, str], int] = {}  # (job, node) -> best queued priority
        self._counter = itertools.count()
        self._wake = threading.Event()
        self._worker: threading.Thread | None = None

    # ---------- jobs ----------

    def _job_dir(self, job_id: str) -> Path:
        return self.data_dir / "jobs" / job_id

    def _save(self, job_id: str) -> None:
        path = self._job_dir(job_id) / "ancestors.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._jobs[job_id]))
        tmp.replace(path)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            if job_id not in self._jobs:
                path = self._job_dir(job_id) / "ancestors.json"
                if not path.exists():
                    return None
                job = json.loads(path.read_text())
                # Anything mid-fold when we last stopped needs redoing.
                for a in job["ancestors"].values():
                    if a["structure"]["status"] == "folding":
                        a["structure"] = {"status": "pending"}
                self._jobs[job_id] = job
            return self._jobs[job_id]

    def create(self, payload: TreeIn, fold_all: bool = True) -> dict[str, Any]:
        tree = Tree(payload)
        job_id = job_id_for(tree)
        with self._lock:
            job = self.get(job_id)
            if job is None:
                ancestors = reconstruct(tree, self._job_dir(job_id) / "iqtree")
                job = {
                    "jobId": job_id,
                    "treeId": tree.tree_id,
                    "ancestors": {
                        nid: {
                            "sequence": a.sequence,
                            "posteriors": [round(p, 4) for p in a.posteriors],
                            "columns": a.alignment_columns,
                            "meanPosterior": round(a.mean_posterior, 4),
                            "approximate": a.approximate,
                            "structure": {"status": "pending"},
                        }
                        for nid, a in ancestors.items()
                    },
                }
                self._jobs[job_id] = job
                self._save(job_id)
            # Reuse folds already computed for identical sequences.
            for nid, a in job["ancestors"].items():
                if a["structure"]["status"] == "pending" and (self.data_dir / "folds" / f"{seq_key(a['sequence'])}.json").exists():
                    self._finish(job_id, nid)
            if fold_all:
                for nid, a in job["ancestors"].items():
                    if a["structure"]["status"] == "pending":
                        self._enqueue(job_id, nid, PRIORITY_BACKGROUND)
            self._save(job_id)
            return job

    def request_fold(self, job_id: str, node_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.get(job_id)
            if job is None or node_id not in job["ancestors"]:
                raise KeyError(node_id)
            a = job["ancestors"][node_id]
            if a["structure"]["status"] in ("pending", "error"):
                a["structure"] = {"status": "pending"}
                self._enqueue(job_id, node_id, PRIORITY_REQUESTED)
            return a

    def structure_pdb(self, job_id: str, node_id: str) -> str | None:
        """PDB with B-factor = pLDDT x ASR posterior (0-100) per residue."""
        job = self.get(job_id)
        if job is None or node_id not in job["ancestors"]:
            return None
        a = job["ancestors"][node_id]
        if a["structure"]["status"] != "done":
            return None
        fold = json.loads((self.data_dir / "folds" / f"{seq_key(a['sequence'])}.json").read_text())
        combined = [pl * po for pl, po in zip(fold["plddt"], a["posteriors"])]
        return set_bfactors(fold["pdb"], combined)

    # ---------- folding worker ----------

    def _enqueue(self, job_id: str, node_id: str, priority: int) -> None:
        key = (job_id, node_id)
        if key in self._queued and self._queued[key] <= priority:
            return
        self._queued[key] = priority
        heapq.heappush(self._queue, (priority, next(self._counter), job_id, node_id))
        self._ensure_worker()
        self._wake.set()

    def _ensure_worker(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._run, name="fold-worker", daemon=True)
            self._worker.start()

    def _next(self) -> tuple[str, str] | None:
        with self._lock:
            while self._queue:
                priority, _, job_id, node_id = heapq.heappop(self._queue)
                if self._queued.get((job_id, node_id)) != priority:
                    continue  # superseded by a higher-priority entry
                del self._queued[(job_id, node_id)]
                a = self._jobs[job_id]["ancestors"][node_id]
                if a["structure"]["status"] != "pending":
                    continue
                if (self.data_dir / "folds" / f"{seq_key(a['sequence'])}.json").exists():
                    self._finish(job_id, node_id)
                    self._save(job_id)
                    continue
                a["structure"] = {"status": "folding"}
                self._save(job_id)
                return job_id, node_id
            self._wake.clear()
            return None

    def _run(self) -> None:
        while True:
            item = self._next()
            if item is None:
                self._wake.wait()
                continue
            job_id, node_id = item
            seq = self._jobs[job_id]["ancestors"][node_id]["sequence"]
            try:
                res = folder.fold(seq)
                path = self.data_dir / "folds" / f"{seq_key(seq)}.json"
                path.write_text(json.dumps({"pdb": res.pdb, "plddt": res.plddt, "seconds": res.seconds}))
                log.info("folded %s/%s (%d aa) in %.1fs", job_id, node_id, len(seq), res.seconds)
                with self._lock:
                    self._finish(job_id, node_id)
                    self._save(job_id)
            except Exception as e:  # keep the worker alive
                log.exception("fold failed for %s/%s", job_id, node_id)
                with self._lock:
                    self._jobs[job_id]["ancestors"][node_id]["structure"] = {"status": "error", "error": str(e)}
                    self._save(job_id)

    def _finish(self, job_id: str, node_id: str) -> None:
        a = self._jobs[job_id]["ancestors"][node_id]
        fold = json.loads((self.data_dir / "folds" / f"{seq_key(a['sequence'])}.json").read_text())
        mean_plddt = sum(fold["plddt"]) / len(fold["plddt"])
        a["structure"] = {"status": "done", "meanPlddt": round(mean_plddt, 1)}


store = JobStore()

__all__ = ["store", "JobStore", "safe_name"]
