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


def expanded_arena(*, text, capture_dirs, need, stamp, graph_path, names):
    """The expanded arena ends with the graph stamp; take the matching suffix a stamp window offers."""
    for directory in capture_dirs:
        for meta in sorted(directory.glob("*heap-stamp.json")):
            detail = json.loads(meta.read_text())["detail"]
            if f"stamp={stamp} " not in detail:
                continue
            window = (directory / meta.name.replace(".json", ".bin")).read_bytes()
            if len(window) < need:
                continue
            candidate = window[-need:]
            trial = graph_path.parent / "arena.trial.bin"
            trial.write_bytes(candidate)
            code, created = probe(graph_path, trial, names)
            trial.unlink(missing_ok=True)
            if code == 0 and created and created["create"] == 0:
                return candidate, created
    return None, None


def collect(*, package_dirs, out, label, capture_dirs=()):
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"nets": []}
    known = {net["graph_sha256"] for net in manifest["nets"]}
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
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest in known:
                print(f"{directory.name}/{record}: already collected")
                continue
            try:
                graph = analyze(text)
            except ValueError as error:
                print(f"{directory.name}/{record}: unsupported graph ({error})")
                continue
            arena = weight.read_bytes()
            net_dir = out / digest[:16]
            net_dir.mkdir(exist_ok=True)
            (net_dir / "graph.txt").write_text(text)
            source_name = graph["layers"][0]["name"]
            last = graph["layers"][-1]["outputs"][0]
            if graph["arena_bytes"] != len(arena):
                if not marker:
                    print(f"{directory.name}/{record}: accounting {graph['arena_bytes']} != arena {len(arena)}")
                    continue
                # The runtime expands the packed payload while creating the net; the plain arena the
                # accounting describes only exists afterwards, so the graph is stored without the marker.
                (net_dir / "graph.txt").write_text(text.split("\n", 1)[1])
                arena, created = expanded_arena(text=text, capture_dirs=capture_dirs, need=graph["arena_bytes"],
                                                stamp=graph["stamp"], graph_path=net_dir / "graph.txt", names=[source_name, last])
                if arena is None:
                    print(f"{directory.name}/{record}: {marker} arena is compressed and no capture window expanded it")
                    continue
                (net_dir / "arena.bin").write_bytes(arena)
            else:
                (net_dir / "arena.bin").write_bytes(arena)
                code, created = probe(net_dir / "graph.txt", net_dir / "arena.bin", [source_name, last])
                if code != 0 or created is None or created["create"] != 0:
                    print(f"{directory.name}/{record}: runtime rejected the pair")
                    continue
            layers = sum(1 for layer in graph["layers"] if layer["op"] != "Input")
            manifest["nets"].append({
                "id": net_dir.name, "label": f"{label}/{directory.name}.{record}", "graph_sha256": digest,
                "graph_bytes": len(text), "arena_sha256": hashlib.sha256(arena).hexdigest(), "arena_bytes": len(arena),
                "trim": f"package-reader+{marker}-expanded" if graph["arena_bytes"] != weight.stat().st_size else "package-reader",
                "header": {"letter": graph["letter"] or "plain", "layers": layers, "stamp": graph["stamp"], "legacy": graph["stamp"] is None},
                "default_in": created["default_in"],
                "input": {"dims_nhwc": created["names"][0]["dims"], "raw": created["names"][0]["raw"]},
                "outputs": {last: {"dims_nhwc": created["names"][1]["dims"], "raw": created["names"][1]["raw"]}},
                "requested_outputs": [last], "sources": [f"{directory.name}/{record}"],
            })
            known.add(digest)
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
