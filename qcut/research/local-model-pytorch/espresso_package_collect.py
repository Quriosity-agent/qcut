"""Collect graph/arena pairs that the vendor package reader returned into verified network directories.

`smash_package_host.mm` writes one `<record>.config.bin` (graph text) and one
`<record>.weight.bin` (arena) per extracted record. This script pairs them, verifies each pair
with the pinned runtime probe (a create that succeeds and reports the declared blobs), and adds
it to a manifest in the same shape the other collectors produce. Records whose weight payload is
empty are parameter blobs, not networks, and are reported without being added.

Some graphs carry a compression marker line (`USTQ`, `F`) and a packed weight payload that is
smaller than the graph's own accounting. The runtime expands such an arena while creating the
network, so `--capture` points at a directory where `bytenn_model_capture.mm` dumped the stamp
windows of that create (QCUT_BYTENN_SCAN_AFTER_CREATE=1): the expanded arena is the window suffix
whose length matches the accounting, and it is kept only when the runtime accepts it with the
marker line removed.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from espresso_graph import analyze

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"
PROBE = PRIVATE / "bin/espresso-probe"


def probe(graph, arena, names):
    env = dict(os.environ, DYLD_LIBRARY_PATH=str(LIBRARY.parent))
    run = subprocess.run([str(PROBE), str(LIBRARY), str(graph), str(arena), *names], capture_output=True, text=True, timeout=300, env=env)
    match = re.search(r"\{\"create\".*\}", run.stdout)
    return run.returncode, (json.loads(match.group(0)) if match else None)


def expanded_arena(*, capture_dirs, need, stamp, graph_path, names):
    """The expanded arena ends with the graph stamp; take the matching suffix a stamp window offers."""
    for directory in capture_dirs:
        for meta in sorted(directory.glob("*heap-stamp.json")):
            try:
                detail = json.loads(meta.read_text())["detail"]
                if not isinstance(detail, str) or f"stamp={stamp} " not in detail:
                    continue
                window = meta.with_suffix(".bin").read_bytes()
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
                continue
            if len(window) < need:
                continue
            candidate = window[-need:]
            trial = graph_path.parent / "arena.trial.bin"
            trial.write_bytes(candidate)
            try:
                code, created = probe(graph_path, trial, names)
            finally:
                trial.unlink(missing_ok=True)
            if code == 0 and created and created["create"] == 0:
                return candidate, created
    return None, None


def collect(*, package_dirs, out, label, capture_dirs=()):
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"nets": []}
    # Older compressed entries hash the source marker, not the stored plain graph.
    known = set()
    for net in manifest["nets"]:
        graph_file = out / net["id"] / "graph.txt"
        digest = hashlib.sha256(graph_file.read_bytes()).hexdigest() if graph_file.exists() else net["graph_sha256"]
        known.add((digest, net["arena_sha256"]))
    for directory in package_dirs:
        for config in sorted(directory.glob("*.config.bin")):
            record = config.name[: -len(".config.bin")]
            weight = directory / f"{record}.weight.bin"
            if not weight.exists() or weight.stat().st_size == 0:
                print(f"{directory.name}/{record}: parameter record, no weights")
                continue
            text = config.read_text(errors="strict")
            first = text.split("\n", 1)[0]
            # A leading all-letter line marks the weight encoding (`B`, `D`, `E`, `F`, `USTQ`, ...).
            marker = first if first.isalpha() and 1 <= len(first) <= 8 else ""
            try:
                graph = analyze(text)
            except ValueError as error:
                print(f"{directory.name}/{record}: unsupported graph ({error})")
                continue
            arena = weight.read_bytes()
            source_digest = hashlib.sha256(text.encode()).hexdigest()
            source_name = graph["layers"][0]["name"]
            last = graph["layers"][-1]["outputs"][0]
            expanded = graph["arena_bytes"] != len(arena)
            # Stage beside out so even a concurrent parity glob cannot see a rejected candidate.
            with tempfile.TemporaryDirectory(prefix=".espresso-package-", dir=out.parent) as temporary:
                stage = Path(temporary) / "network"
                stage.mkdir()
                if expanded:
                    if not marker:
                        print(f"{directory.name}/{record}: accounting {graph['arena_bytes']} != arena {len(arena)}")
                        continue
                    text = text.split("\n", 1)[1]
                    (stage / "graph.txt").write_bytes(text.encode("utf-8"))
                    arena, created = expanded_arena(capture_dirs=capture_dirs, need=graph["arena_bytes"],
                                                    stamp=graph["stamp"], graph_path=stage / "graph.txt", names=[source_name, last])
                    if arena is None:
                        print(f"{directory.name}/{record}: {marker} arena is compressed and no capture window expanded it")
                        continue
                digest = hashlib.sha256(text.encode()).hexdigest()
                arena_digest = hashlib.sha256(arena).hexdigest()
                identity = (digest, arena_digest)
                if identity in known:
                    print(f"{directory.name}/{record}: already collected")
                    continue
                (stage / "graph.txt").write_bytes(text.encode("utf-8"))
                (stage / "arena.bin").write_bytes(arena)
                if not expanded:
                    code, created = probe(stage / "graph.txt", stage / "arena.bin", [source_name, last])
                    if code != 0 or created is None or created["create"] != 0:
                        print(f"{directory.name}/{record}: runtime rejected the pair")
                        continue
                net_dir = out / hashlib.sha256(f"{digest}:{arena_digest}".encode()).hexdigest()[:16]
                stage.rename(net_dir)
            layers = sum(1 for layer in graph["layers"] if layer["op"] != "Input")
            manifest["nets"].append({
                "id": net_dir.name, "label": f"{label}/{directory.name}.{record}", "graph_sha256": digest,
                "graph_bytes": len(text.encode()), "arena_sha256": arena_digest, "arena_bytes": len(arena),
                "source_graph_sha256": source_digest,
                "trim": f"package-reader+{marker}-expanded" if expanded else "package-reader",
                "header": {"letter": graph["letter"] or "plain", "layers": layers, "stamp": graph["stamp"], "legacy": graph["stamp"] is None},
                "default_in": created["default_in"],
                "input": {"dims_nhwc": created["names"][0]["dims"], "raw": created["names"][0]["raw"]},
                "outputs": {last: {"dims_nhwc": created["names"][1]["dims"], "raw": created["names"][1]["raw"]}},
                "requested_outputs": [last], "sources": [f"{directory.name}/{record}"],
            })
            known.add(identity)
            print(f"{net_dir.name} {directory.name}/{record}: {graph['letter'] or 'plain'} layers={layers} arena={len(arena)} in={created['names'][0]['dims']} {created['names'][0]['raw']} out={last}")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", action="append", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--label", default="package")
    parser.add_argument("--capture", action="append", default=[], type=Path,
                        help="capture directory holding stamp windows for compressed arenas")
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    manifest = collect(package_dirs=args.package, out=args.out, label=args.label, capture_dirs=args.capture)
    print(json.dumps({"nets": len(manifest["nets"])}))


if __name__ == "__main__":
    main()
