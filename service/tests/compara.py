"""Convert a raw Compara gene-tree JSON into the payload the frontend sends
(same path-ID scheme as web/src/model/geneTree.ts)."""
from app.tree import NodeIn, TreeIn


def compara_to_payload(raw: dict) -> TreeIn:
    nodes: list[NodeIn] = []

    def visit(r: dict, nid: str, parent: str | None) -> None:
        kids = r.get("children") or []
        seq = None if kids else r.get("sequence", {}).get("mol_seq", {}).get("seq")
        nodes.append(NodeIn(id=nid, parentId=parent, branchLength=r.get("branch_length") or 0.0, alignedSeq=seq))
        for i, k in enumerate(kids):
            visit(k, f"{nid}.{i}", nid)

    visit(raw["tree"], "r", None)
    return TreeIn(treeId=raw["id"], nodes=nodes)
