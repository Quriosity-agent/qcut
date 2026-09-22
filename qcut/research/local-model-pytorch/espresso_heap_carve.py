"""Turn heap-scanned graph texts and stamp windows from a capture run into verified graph+arena pairs.

`bytenn_model_capture.mm` writes `*-heap-graph.txt` (every graph text found in readable
memory after an engine Init) and `*-heap-stamp.bin` (the bytes preceding each occurrence of a
stamp named by one of those graphs). A decoded arena ends with its graph's stamp, so the arena
is the last `arena_bytes` bytes of a stamp window, where `arena_bytes` comes from the graph's
own accounting (`espresso_graph.analyze`). Every candidate is verified with the runtime probe
(a create that succeeds) before it is kept; texts are deduplicated by stamp, layer count and
arena length so truncated heap copies never produce extra entries.
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


def carve(*, capture_dirs, out, label_prefix):
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"nets": []}
    known = {(n["header"]["stamp"], n["header"]["layers"], n["arena_bytes"]) for n in manifest["nets"]}
    for directory in capture_dirs:
        windows = {}
        for meta in directory.glob("*-heap-stamp.json"):
            detail = json.loads(meta.read_text())["detail"]
            stamp = int(re.search(r"stamp=(\d+)", detail).group(1))
            windows.setdefault(stamp, []).append(directory / meta.name.replace(".json", ".bin"))
        for graph_path in sorted(directory.glob("*-heap-graph.txt")):
            text = graph_path.read_text(errors="replace")
            try:
                graph = analyze(text)
            except ValueError:
                continue  # truncated copy or unsupported rows
            layers = sum(1 for layer in graph["layers"] if layer["op"] != "Input")
            key = (graph["stamp"], layers, graph["arena_bytes"])
            if graph["stamp"] is None or key in known:
                continue
            length = graph["arena_bytes"]
            last = graph["layers"][-1]["outputs"][0]
            input_name = graph["layers"][0]["name"]
            found = None
            for window_path in sorted(windows.get(graph["stamp"], [])):
                window = window_path.read_bytes()
                if len(window) < length:
                    continue
                arena = window[-length:]
                net_dir = out / hashlib.sha256(text.encode()).hexdigest()[:16]
                net_dir.mkdir(exist_ok=True)
                (net_dir / "graph.txt").write_text(text)
                (net_dir / "arena.bin").write_bytes(arena)
                code, created = probe(net_dir / "graph.txt", net_dir / "arena.bin", [input_name, last])
                if code == 0 and created and created["create"] == 0:
                    found = (net_dir, arena, created)
                    break
                (net_dir / "arena.bin").unlink(missing_ok=True)
            if not found:
                print(f"{graph_path.name}: stamp {graph['stamp']} layers={layers} arena={length}: no verified window")
                continue
            net_dir, arena, created = found
            inputs = [layer for layer in graph["layers"] if layer["op"] == "Input"]
            entry = {
                "id": net_dir.name, "label": f"{label_prefix}/{directory.name}", "graph_sha256": hashlib.sha256(text.encode()).hexdigest(),
                "graph_bytes": len(text), "arena_sha256": hashlib.sha256(arena).hexdigest(), "arena_bytes": length,
                "trim": "heap-stamp-window+graph-accounting",
                "header": {"letter": graph["letter"] or "plain", "layers": layers, "stamp": graph["stamp"], "legacy": False},
                "default_in": created["default_in"],
                "input": {"dims_nhwc": created["names"][0]["dims"], "raw": created["names"][0]["raw"]},
                "outputs": {last: {"dims_nhwc": created["names"][1]["dims"], "raw": created["names"][1]["raw"]}},
                "requested_outputs": [last], "sources": [f"{directory.name}/{graph_path.name}"],
                "input_rows": [layer["name"] for layer in inputs],
            }
            manifest["nets"].append(entry)
            known.add(key)
            print(f"{net_dir.name} {entry['label']}: {entry['header']['letter']} layers={layers} arena={length} input={entry['input']} out={last}")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="append", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--label", default="heap")
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    manifest = carve(capture_dirs=args.capture, out=args.out, label_prefix=args.label)
    print(json.dumps({"nets": len(manifest["nets"])}))


if __name__ == "__main__":
    main()
