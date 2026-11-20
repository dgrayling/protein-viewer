"""Ancestor service: reconstruct ancestral proteins for a gene tree.

Run:  .venv/bin/uvicorn app.main:app --port 8000
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .jobs import store
from .tree import TreeIn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Protein lineage ancestor service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/reconstructions")
def create(payload: TreeIn, fold_all: bool = True) -> dict:
    """Run ASR for every internal node (instant) and queue structure folds."""
    try:
        return store.create(payload, fold_all=fold_all)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(500, str(e)) from e


@app.get("/reconstructions/{job_id}")
def get(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    return job


@app.post("/reconstructions/{job_id}/nodes/{node_id}/fold")
def prioritise(job_id: str, node_id: str) -> dict:
    """Move a node to the front of the fold queue (the user is looking at it)."""
    try:
        return store.request_fold(job_id, node_id)
    except KeyError as e:
        raise HTTPException(404, "unknown job or node") from e


@app.get("/reconstructions/{job_id}/nodes/{node_id}/structure.pdb")
def structure(job_id: str, node_id: str) -> Response:
    pdb = store.structure_pdb(job_id, node_id)
    if pdb is None:
        raise HTTPException(404, "structure not ready")
    return Response(pdb, media_type="chemical/x-pdb", headers={"Cache-Control": "public, max-age=86400"})
