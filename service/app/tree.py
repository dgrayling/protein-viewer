"""Gene tree as sent by the frontend, plus Newick export and gap parsimony.

Node IDs are the frontend's path IDs ("r", "r.0", "r.0.1", ...). Leaves carry
their row of the Compara multiple alignment.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, Field


class NodeIn(BaseModel):
    id: str
    parentId: str | None
    branchLength: float = 0.0
    alignedSeq: str | None = None  # leaves only


class TreeIn(BaseModel):
    treeId: str
    nodes: list[NodeIn] = Field(min_length=3)


@dataclass
class Node:
    id: str
    parent: str | None
    branch_length: float
    children: list[str] = field(default_factory=list)
    seq: str | None = None

    @property
    def is_leaf(self) -> bool:
        return not self.children


class Tree:
    def __init__(self, payload: TreeIn):
        self.tree_id = payload.treeId
        self.nodes: dict[str, Node] = {}
        for n in payload.nodes:
            self.nodes[n.id] = Node(n.id, n.parentId, max(n.branchLength, 0.0), seq=n.alignedSeq)
        roots = [n for n in self.nodes.values() if n.parent is None]
        if len(roots) != 1:
            raise ValueError(f"expected exactly one root, got {len(roots)}")
        self.root = roots[0].id
        # Children in path-ID order so child index matches the frontend.
        for n in sorted(self.nodes.values(), key=lambda n: _path_key(n.id)):
            if n.parent is not None:
                if n.parent not in self.nodes:
                    raise ValueError(f"node {n.id} has unknown parent {n.parent}")
                self.nodes[n.parent].children.append(n.id)

        leaves = self.leaves()
        if len(leaves) < 3:
            raise ValueError("need at least 3 leaves")
        lengths = {len(self.nodes[l].seq or "") for l in leaves}
        if len(lengths) != 1 or 0 in lengths:
            raise ValueError("all leaves need aligned sequences of equal length")
        self.aln_len = lengths.pop()

    def leaves(self) -> list[str]:
        return [n.id for n in self.nodes.values() if n.is_leaf]

    def internal(self) -> list[str]:
        return [n.id for n in self.nodes.values() if not n.is_leaf]

    def postorder(self) -> list[str]:
        out: list[str] = []
        stack = [(self.root, False)]
        while stack:
            nid, done = stack.pop()
            if done:
                out.append(nid)
            else:
                stack.append((nid, True))
                stack.extend((c, False) for c in reversed(self.nodes[nid].children))
        return out

    def to_newick(self) -> str:
        """Newick with every node (internal too) labelled by its safe name."""

        def rec(nid: str) -> str:
            n = self.nodes[nid]
            label = safe_name(nid)
            inner = f"({','.join(rec(c) for c in n.children)})" if n.children else ""
            bl = f":{n.branch_length:.6g}" if n.parent is not None else ""
            return f"{inner}{label}{bl}"

        return rec(self.root) + ";"

    def to_fasta(self) -> str:
        return "".join(f">{safe_name(l)}\n{self.nodes[l].seq}\n" for l in self.leaves())

    def gap_states(self) -> dict[str, list[bool]]:
        """For every internal node, whether each alignment column holds a
        residue (True) or a gap (False), inferred by Fitch parsimony on the
        leaves' gap pattern. Ties resolve towards 'present' at the root and
        towards the parent's state below it.
        """
        L = self.aln_len
        # Fitch sets encoded as bitmasks per column: 1 = gap, 2 = residue.
        sets: dict[str, list[int]] = {}
        for nid in self.postorder():
            n = self.nodes[nid]
            if n.is_leaf:
                sets[nid] = [1 if ch == "-" else 2 for ch in n.seq]  # type: ignore[union-attr]
                continue
            kids = [sets[c] for c in n.children]
            col = []
            for i in range(L):
                inter = kids[0][i]
                union = kids[0][i]
                for k in kids[1:]:
                    inter &= k[i]
                    union |= k[i]
                col.append(inter or union)
            sets[nid] = col

        present: dict[str, list[bool]] = {}
        stack = [self.root]
        while stack:
            nid = stack.pop()
            n = self.nodes[nid]
            if n.is_leaf:
                continue
            s = sets[nid]
            if n.parent is None:
                present[nid] = [bool(v & 2) for v in s]
            else:
                p = present[n.parent]
                present[nid] = [
                    p[i] if (s[i] & (2 if p[i] else 1)) else bool(s[i] & 2) for i in range(L)
                ]
            stack.extend(n.children)
        return present


def safe_name(node_id: str) -> str:
    """IQ-TREE-safe label: path IDs use dots, which we swap for underscores."""
    return "n_" + node_id.replace(".", "_")


def from_safe_name(name: str) -> str:
    return name.removeprefix("n_").replace("_", ".")


def _path_key(node_id: str) -> tuple[int, ...]:
    parts = node_id.split(".")[1:]
    return tuple(int(p) for p in parts)
