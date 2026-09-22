"""Re-run recovered espresso networks on the tensors the product actually fed them.

`bytenn_model_capture.mm` with QCUT_BYTENN_CAPTURE_IO=1 records, during a real render, the input
blobs of every espresso network as they stand when Inference starts and every blob the caller
extracts afterwards. This script pairs those records with the verified graph/arena directories
(matched by the SHA-256 of the graph text), executes `espresso_fixed.run` on the recorded inputs
and compares every recorded output. Unlike the synthetic parity runs this exercises the product's
own preprocessing, so heads that overflow on random noise are checked on realistic values.

Blobs the caller extracted before the first inference are the inputs it filled in place and are
not compared. Integer outputs must match bit for bit; float outputs report the maximum absolute
error, and a blob the runtime itself left non-finite is reported as not comparable.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np

import espresso_fixed

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
DTYPES = {1: "<i1", 2: "<i2", 4: "<f4"}


def meta_records(capture_dir):
    """Every JSON record of a capture directory; the detail field is parsed leniently."""
    records = []
    for path in sorted(capture_dir.glob("*.json")):
        text = path.read_text(errors="replace")
        kind = re.search(r'"kind":\s*"([^"]*)"', text)
        detail = re.search(r'"detail":\s*"([^"]*)"', text)
        index = re.search(r'"index":\s*(\d+)', text)
        if not (kind and detail and index):
            continue
        fields = dict(item.split("=", 1) for item in detail.group(1).split() if "=" in item)
        records.append({"index": int(index.group(1)), "kind": kind.group(1), "fields": fields, "path": path})
    return records


def tensor(path, fields):
    dims = [int(v) for v in fields["dims"].split(",")]
    raw = [int(v) for v in fields["raw"].split(",")]
    n, w, h, c = dims
    data = np.fromfile(path, dtype=DTYPES[raw[0]])
    if data.size != n * w * h * c:
        return None, raw
    array = data.reshape(n, h, w, c)
    return (array.astype(np.float32) if raw[0] == 4 else array.astype(np.int64)), raw


def collected_networks(collected_dirs):
    """graph sha256 -> directory holding the verified graph.txt / arena.bin."""
    index = {}
    for directory in collected_dirs:
        manifest = directory / "manifest.json"
        if not manifest.exists():
            continue
        for net in json.loads(manifest.read_text())["nets"]:
            index.setdefault(net["graph_sha256"], directory / net["id"])
    return index


def compare(mine, expected, raw):
    if raw[0] != 4:
        same = mine["data"].shape == expected.shape and np.array_equal(mine["data"], expected)
        return {"status": "exact" if same else "mismatch",
                "mismatches": None if same else int((mine["data"] != expected).sum()) if mine["data"].shape == expected.shape else -1}
    if not np.isfinite(expected).all():
        return {"status": "native-nonfinite"}
    if mine["data"].shape != expected.shape:
        return {"status": "shape", "mine": list(mine["data"].shape), "native": list(expected.shape)}
    error = np.abs(mine["data"].astype(np.float64) - expected.astype(np.float64))
    if not np.isfinite(error).all():
        return {"status": "nonfinite"}
    return {"status": "float", "max_abs": float(error.max())}


def run(*, capture_dirs, collected_dirs, out):
    out.mkdir(parents=True, exist_ok=True)
    networks = collected_networks(collected_dirs)
    results = []
    for capture in capture_dirs:
        records = meta_records(capture)
        graphs = {}
        for record in records:
            if record["kind"] == "espresso" and "self" in record["fields"]:
                graph_path = record["path"].with_name(record["path"].name.replace(".json", ".graph.txt"))
                if graph_path.exists():
                    graphs[record["fields"]["self"]] = graph_path.read_text(errors="replace")
        cases = {}
        for record in records:
            if record["kind"] not in ("espresso-input", "espresso-output"):
                continue
            fields = record["fields"]
            inference = int(fields["inference"])
            if inference < 0 or "skipped" in fields:
                continue
            binary = record["path"].with_suffix(".bin")
            if not binary.exists():
                continue
            array, raw = tensor(binary, fields)
            if array is None:
                continue
            slot = cases.setdefault((fields["self"], inference), {"inputs": {}, "outputs": {}})
            slot["inputs" if record["kind"] == "espresso-input" else "outputs"][fields["name"]] = (array, raw)
        for (self_id, inference), slot in sorted(cases.items()):
            text = graphs.get(self_id)
            entry = {"capture": capture.name, "self": self_id, "inference": inference}
            if text is None:
                entry["status"] = "no-graph"
                results.append(entry)
                continue
            digest = hashlib.sha256(text.encode()).hexdigest()
            entry["graph_sha256"] = digest
            net_dir = networks.get(digest)
            if net_dir is None:
                entry["status"] = "no-collected-arena"
                results.append(entry)
                continue
            entry["network"] = net_dir.name
            arena = (net_dir / "arena.bin").read_bytes()
            inputs = {name: (array, raw) for name, (array, raw) in slot["inputs"].items()}
            entry["inputs"] = {name: {"shape": list(array.shape), "raw": raw} for name, (array, raw) in inputs.items()}
            try:
                mine = espresso_fixed.run((net_dir / "graph.txt").read_text(), arena, inputs)
            except Exception as error:  # noqa: BLE001 - the report must name the failing network
                entry["status"] = "error"
                entry["error"] = f"{type(error).__name__}: {error}"
                results.append(entry)
                continue
            blobs = {}
            for name, (expected, raw) in slot["outputs"].items():
                if name in inputs:
                    continue
                blobs[name] = {"raw": raw, "shape": list(expected.shape)}
                blobs[name].update(compare(mine[name], expected, raw) if name in mine else {"status": "missing"})
            statuses = [b["status"] for b in blobs.values()]
            entry["blobs"] = blobs
            entry["exact"] = statuses.count("exact")
            entry["float"] = statuses.count("float")
            entry["native_nonfinite"] = statuses.count("native-nonfinite")
            entry["bad"] = sum(1 for s in statuses if s not in ("exact", "float", "native-nonfinite"))
            entry["worst_float"] = max((b["max_abs"] for b in blobs.values() if b["status"] == "float"), default=0.0)
            entry["status"] = "ok" if entry["bad"] == 0 else "failed"
            results.append(entry)
            print(f"{net_dir.name} {capture.name} self={self_id} inference={inference}: "
                  f"inputs={ {n: v['shape'] for n, v in entry['inputs'].items()} } blobs={len(blobs)} exact={entry['exact']} "
                  f"float={entry['float']} (max_abs={entry['worst_float']:.3g}) native-nonfinite={entry['native_nonfinite']} bad={entry['bad']}")
    (out / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="append", required=True, type=Path)
    parser.add_argument("--collected", action="append", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    results = run(capture_dirs=args.capture, collected_dirs=args.collected, out=args.out)
    failed = [r for r in results if r.get("status") not in ("ok",)]
    print(json.dumps({"cases": len(results), "ok": len(results) - len(failed), "other": [r.get("status") for r in failed]}))
    if any(r.get("status") in ("failed", "error") for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
