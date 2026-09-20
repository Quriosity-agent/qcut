"""Collect graph/arena pairs that the vendor package reader returned into verified network directories.

`smash_package_host.mm` writes one `<record>.config.bin` (graph text) and one
`<record>.weight.bin` (arena) per extracted record. This script pairs them, verifies each pair
with the pinned runtime probe (a create that succeeds and reports the declared blobs), and adds
it to a manifest in the same shape the other collectors produce. Records whose weight payload is
empty are parameter blobs, not networks, and are reported without being added.
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


def collect(*, package_dirs, out, label):
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
            if graph["arena_bytes"] != len(arena):
                print(f"{directory.name}/{record}: accounting {graph['arena_bytes']} != arena {len(arena)}")
                continue
            net_dir = out / digest[:16]
            net_dir.mkdir(exist_ok=True)
            (net_dir / "graph.txt").write_text(text)
            (net_dir / "arena.bin").write_bytes(arena)
            first = graph["layers"][0]["name"]
            last = graph["layers"][-1]["outputs"][0]
            code, created = probe(net_dir / "graph.txt", net_dir / "arena.bin", [first, last])
            if code != 0 or created is None or created["create"] != 0:
                print(f"{directory.name}/{record}: runtime rejected the pair")
                continue
            layers = sum(1 for layer in graph["layers"] if layer["op"] != "Input")
            manifest["nets"].append({
                "id": net_dir.name, "label": f"{label}/{directory.name}.{record}", "graph_sha256": digest,
                "graph_bytes": len(text), "arena_sha256": hashlib.sha256(arena).hexdigest(), "arena_bytes": len(arena),
                "trim": "package-reader",
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
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    manifest = collect(package_dirs=args.package, out=args.out, label=args.label)
    print(json.dumps({"nets": len(manifest["nets"])}))


if __name__ == "__main__":
    main()
