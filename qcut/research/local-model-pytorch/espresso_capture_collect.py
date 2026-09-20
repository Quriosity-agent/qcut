"""Collect the networks a capture host run handed to ByteNN into one deduplicated, byte-exact set.

Every `NNN-espresso.graph.txt` / `NNN-espresso.arena.bin` pair from `bytenn_model_capture.mm`
holds the graph text and the readable memory extent that starts at the arena pointer. The
arena length is not part of the call, so it is recovered from the runtime itself:

* graphs whose header carries a stamp end their arena with that stamp as a little-endian
  uint32; the runtime rejects an arena that does not end with it ("weight not match net"),
  so the trimmed arena is verified with a create and a shortened negative control;
* legacy graphs without a stamp are bisected with the probe's guard-page mode: the smallest
  length whose create + one inference does not fault is the exact number of bytes read.

Heap-scanned graphs (`*-heap-graph.txt`) whose arena is not adjacent to the text are only
listed; the mask arena carved beside its stamp is picked up when present in `nets/`.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
from pathlib import Path

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"
PROBE = PRIVATE / "bin/espresso-probe"
MAX_ARENA = 64 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def header_of(text):
    rows = [line.split() for line in text.splitlines() if line.strip()]
    letter = rows[0][0] if len(rows[0]) == 1 and rows[0][0].isalpha() else ""
    counts = rows[1] if letter else rows[0]
    stamp = int(counts[2]) if len(counts) == 3 else None
    layers = int(counts[1])
    return {"letter": letter or "plain", "layers": layers, "stamp": stamp, "legacy": len(counts) == 2 and not letter}


def probe(graph, arena_spec, names):
    env = dict(os.environ, DYLD_LIBRARY_PATH=str(LIBRARY.parent))
    run = subprocess.run([str(PROBE), str(LIBRARY), str(graph), str(arena_spec), *names],
                         capture_output=True, text=True, timeout=300, env=env)
    match = re.search(r"\{\"create\".*\}", run.stdout)
    return run.returncode, (json.loads(match.group(0)) if match else None)


def trim_by_stamp(text, extent, stamp, graph_path, names, out):
    needle = struct.pack("<I", stamp)
    position = extent.find(needle)
    if position < 0:
        raise ValueError("stamp not found in arena extent")
    arena = extent[:position + 4]
    (out / "arena.bin").write_bytes(arena)
    code, created = probe(graph_path, out / "arena.bin", names)
    short = out / "arena.short.bin"
    short.write_bytes(arena[:-8])
    code_short, created_short = probe(graph_path, short, names)
    short.unlink()
    if code != 0 or created is None or created["create"] != 0 or created_short is None or created_short["create"] == 0:
        raise ValueError("stamp-trimmed arena did not verify")
    return arena, created, "stamp"


def trim_by_guard(extent_path, graph_path, names, out):
    size = min(extent_path.stat().st_size, MAX_ARENA)

    def accepted(length):
        code, result = probe(graph_path, f"guard:{extent_path}:{length}", names)
        return code == 0 and result is not None and result["create"] == 0 and result["inference"] == 0

    low, high = 0, size
    if not accepted(high):
        raise ValueError("guard bisection: even the full extent fails")
    while high - low > 1:
        middle = (low + high) // 2
        if accepted(middle):
            high = middle
        else:
            low = middle
    if accepted(high - 1):
        raise ValueError("guard bisection: length is not minimal")
    arena = extent_path.read_bytes()[:high]
    (out / "arena.bin").write_bytes(arena)
    code, created = probe(graph_path, out / "arena.bin", names)
    if code != 0 or created is None or created["create"] != 0:
        raise ValueError("guard-trimmed arena did not verify")
    return arena, created, "guard-bisection"


def collect(*, capture_dirs, out):
    out.mkdir(parents=True, exist_ok=True)
    nets = {}
    for directory in capture_dirs:
        for meta_path in sorted(directory.glob("*-espresso.json")):
            meta = json.loads(meta_path.read_text())
            index = meta["index"]
            graph_path = directory / f"{index:03d}-espresso.graph.txt"
            extent_path = directory / f"{index:03d}-espresso.arena.bin"
            if not graph_path.exists() or not extent_path.exists():
                continue
            text = graph_path.read_text(errors="strict")
            graph_sha = sha256(text.encode())
            names = [n for n in re.search(r"outputs=([^ ]*)", meta["detail"]).group(1).split(";") if n]
            if "data" not in names:
                names = ["data", *names]
            source = f"{directory.name}/{index:03d}"
            if graph_sha in nets:
                nets[graph_sha]["sources"].append(source)
                continue
            header = header_of(text)
            net_dir = out / graph_sha[:16]
            net_dir.mkdir(exist_ok=True)
            (net_dir / "graph.txt").write_text(text)
            extent = extent_path.read_bytes()
            if header["stamp"] is not None:
                arena, created, method = trim_by_stamp(text, extent, header["stamp"], net_dir / "graph.txt", names, net_dir)
            else:
                arena, created, method = trim_by_guard(extent_path, net_dir / "graph.txt", names, net_dir)
            blobs = {item["name"]: {"dims_nhwc": item["dims"], "raw": item["raw"]} for item in created["names"]}
            nets[graph_sha] = {
                "id": graph_sha[:16], "graph_sha256": graph_sha, "graph_bytes": len(text), "arena_sha256": sha256(arena),
                "arena_bytes": len(arena), "trim": method, "header": header, "default_in": created["default_in"],
                "input": blobs.get("data"), "outputs": {k: v for k, v in blobs.items() if k != "data"},
                "requested_outputs": [n for n in names if n != "data"], "sources": [source],
            }
            print(f"{graph_sha[:16]} {header['letter']:5s} layers={header['layers']:3d} arena={len(arena):8d} ({method}) from {source}")
    manifest = {"library_sha256": sha256(LIBRARY.read_bytes()), "nets": sorted(nets.values(), key=lambda n: n["sources"][0])}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="append", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    manifest = collect(capture_dirs=args.capture, out=args.out)
    print(json.dumps({"nets": len(manifest["nets"])}))


if __name__ == "__main__":
    main()
