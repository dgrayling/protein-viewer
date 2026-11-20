"""Structure prediction for ancestral sequences with ESMFold (Hugging Face port).

The model (~8 GB) is loaded lazily on first use and kept in memory. On Apple
Silicon it runs on the GPU via MPS, with the ESM-2 language model in fp16 to
fit in 16 GB of unified memory.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)

MODEL_ID = "facebook/esmfold_v1"
MAX_LEN = 700  # longer sequences are slow and memory-hungry on a laptop


@dataclass
class FoldResult:
    pdb: str
    plddt: list[float]  # per residue, 0-100
    seconds: float


class Folder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._tokenizer = None
        self.device: str | None = None

    def _load(self) -> None:
        import torch
        from transformers import AutoTokenizer, EsmForProteinFolding

        t0 = time.time()
        self.device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
        self._tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        model = EsmForProteinFolding.from_pretrained(MODEL_ID, low_cpu_mem_usage=True)
        if self.device != "cpu":
            model.esm = model.esm.half()
        # Chunk the folding trunk's attention to bound peak memory.
        model.trunk.set_chunk_size(64)
        self._model = model.to(self.device).eval()
        log.info("ESMFold loaded on %s in %.1fs", self.device, time.time() - t0)

    def fold(self, sequence: str) -> FoldResult:
        import torch

        if len(sequence) > MAX_LEN:
            raise ValueError(f"sequence too long to fold locally ({len(sequence)} > {MAX_LEN})")
        with self._lock:  # one fold at a time; the model isn't re-entrant
            if self._model is None:
                self._load()
            t0 = time.time()
            inputs = self._tokenizer([sequence], return_tensors="pt", add_special_tokens=False)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with torch.no_grad():
                out = self._model(**inputs)
            pdb = self._model.output_to_pdb(out)[0]
            # plddt: [batch, residues, atoms] in 0-1; CA is atom index 1.
            plddt = (out["plddt"][0, :, 1].float().cpu() * 100).tolist()
            if self.device == "mps":
                torch.mps.empty_cache()
            return FoldResult(pdb=pdb, plddt=plddt, seconds=time.time() - t0)


def set_bfactors(pdb: str, per_residue: list[float]) -> str:
    """Rewrite the B-factor column with one value per residue (1-based resSeq)."""
    lines = []
    for line in pdb.splitlines():
        if line.startswith(("ATOM", "HETATM")):
            idx = int(line[22:26]) - 1
            if 0 <= idx < len(per_residue):
                line = f"{line[:60]}{per_residue[idx]:6.2f}{line[66:]}"
        lines.append(line)
    return "\n".join(lines) + "\n"


folder = Folder()
