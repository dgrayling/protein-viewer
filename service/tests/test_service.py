import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import jobs as jobs_mod
from app.asr import reconstruct
from app.fold import FoldResult, set_bfactors
from app.tree import NodeIn, Tree, TreeIn, from_safe_name, safe_name
from tests.compara import compara_to_payload

FIXTURE = Path(__file__).resolve().parents[2] / "web/src/__fixtures__/hbb-genetree.json"

#        r
#      /   \
#    r.0    r.1
#   /  \    /  \
# A     B  C    D        (A..D share a core; D has an insertion and a substitution)
SEQS = {
    "r.0.0": "MKV-LLAGHE",
    "r.0.1": "MKV-LLAGHE",
    "r.1.0": "MKV-LLSGHE",
    "r.1.1": "MKVWLLSGHQ",
}


def five_taxon() -> TreeIn:
    nodes = [NodeIn(id="r", parentId=None), NodeIn(id="r.0", parentId="r", branchLength=0.1), NodeIn(id="r.1", parentId="r", branchLength=0.1)]
    for nid, seq in SEQS.items():
        nodes.append(NodeIn(id=nid, parentId=nid.rsplit(".", 1)[0], branchLength=0.05, alignedSeq=seq))
    return TreeIn(treeId="TEST", nodes=nodes)


def test_safe_names_round_trip():
    assert from_safe_name(safe_name("r.0.12.3")) == "r.0.12.3"


def test_newick_labels_all_nodes():
    nwk = Tree(five_taxon()).to_newick()
    assert nwk.endswith("n_r;")
    for nid in ["r_0", "r_1", "r_0_0", "r_1_1"]:
        assert f"n_{nid}" in nwk


def test_gap_parsimony():
    gaps = Tree(five_taxon()).gap_states()
    # Column 3 is a gap in 3 of 4 leaves: the insertion is unique to D.
    assert gaps["r"][3] is False
    assert gaps["r.1"][3] is False
    assert all(gaps["r.0"][i] for i in range(10) if i != 3)


def test_reconstruct_recovers_obvious_ancestor(tmp_path):
    anc = reconstruct(Tree(five_taxon()), tmp_path)
    assert anc["r.0"].sequence == "MKVLLAGHE"
    assert anc["r.1"].sequence[:4] == "MKVL"  # insertion excluded
    assert anc["r"].approximate  # root borrowed from a child (unrooted model)
    assert all(0 <= p <= 1 for p in anc["r.0"].posteriors)


def test_reconstruct_real_compara_tree(tmp_path):
    t = Tree(compara_to_payload(json.loads(FIXTURE.read_text())))
    anc = reconstruct(t, tmp_path)
    assert set(anc) == set(t.internal())
    assert anc["r.0"].sequence.startswith("MVHLTPEEK")


def test_set_bfactors():
    pdb = "ATOM      1  CA  ALA A   1      11.104   6.134  -6.504  1.00 50.00           C\n"
    assert "  1.00 87.50" in set_bfactors(pdb, [87.5])


@pytest.fixture
def client(tmp_path, monkeypatch):
    store = jobs_mod.JobStore(tmp_path)
    monkeypatch.setattr(jobs_mod, "store", store)
    from app import main

    monkeypatch.setattr(main, "store", store)

    def fake_fold(seq: str) -> FoldResult:
        lines = [
            f"ATOM  {i + 1:5d}  CA  ALA A{i + 1:4d}      {i:6.3f}   0.000   0.000  1.00  0.00           C"
            for i in range(len(seq))
        ]
        return FoldResult(pdb="\n".join(lines) + "\nEND\n", plddt=[80.0] * len(seq), seconds=0.0)

    monkeypatch.setattr(jobs_mod.folder, "fold", fake_fold)
    return TestClient(main.app)


def wait_for(client, job_id, node_id, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        a = client.get(f"/reconstructions/{job_id}").json()["ancestors"][node_id]
        if a["structure"]["status"] == "done":
            return a
        time.sleep(0.05)
    raise AssertionError("fold did not finish")


def test_api_end_to_end(client):
    payload = five_taxon().model_dump()
    job = client.post("/reconstructions", json=payload).json()
    job_id = job["jobId"]
    assert set(job["ancestors"]) == {"r", "r.0", "r.1"}

    client.post(f"/reconstructions/{job_id}/nodes/r.0/fold")
    a = wait_for(client, job_id, "r.0")
    assert a["structure"]["meanPlddt"] == 80.0

    pdb = client.get(f"/reconstructions/{job_id}/nodes/r.0/structure.pdb").text
    # B-factor = pLDDT (80) x posterior (<= 1)
    b = float(pdb.splitlines()[0][60:66])
    assert 0 < b <= 80.0

    # Same tree again: same job, no recomputation.
    assert client.post("/reconstructions", json=payload).json()["jobId"] == job_id


def test_api_errors(client):
    bad = five_taxon().model_dump()
    bad["nodes"][-1]["alignedSeq"] = "MK"
    assert client.post("/reconstructions", json=bad).status_code == 422
    assert client.get("/reconstructions/nope").status_code == 404
    assert client.get("/reconstructions/nope/nodes/r/structure.pdb").status_code == 404
