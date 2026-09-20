"""Per-layer parity of the fixed-point interpreter against the pinned espresso oracle."""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import espresso_fixed  # noqa: E402
import espresso_oracle  # noqa: E402
from espresso_graph import analyze  # noqa: E402


def synthetic_input(shape, storage, seed):
    rng = np.random.default_rng(seed)
    n, h, w, c = shape
    unit = 2 ** storage["fraction"]
    if storage["type"] == 1:
        return rng.integers(-unit, unit, size=(n, h, w, c), dtype=np.int64).clip(-128, 127)
    if storage["type"] == 2:
        return rng.integers(-unit, unit, size=(n, h, w, c), dtype=np.int64).clip(-2047, 2047)
    return rng.standard_normal((n, h, w, c)).astype(np.float32)


def compare(net_dir, out, seed, *, all_layers=True, reinfer=None):
    text = (net_dir / "graph.txt").read_text()
    arena = (net_dir / "arena.bin").read_bytes()
    graph = analyze(text)
    inputs = {}
    for layer in graph["layers"]:
        if layer["op"] == "Input":
            shape = layer["shape"] if reinfer is None else (layer["shape"][0], reinfer[0], reinfer[1], layer["shape"][3])
            inputs[layer["name"]] = (synthetic_input(shape, layer["storage"], seed), [layer["storage"]["type"], layer["storage"]["fraction"]])
    names = [b for layer in graph["layers"] if layer["op"] != "Input" for b in layer["outputs"]] if all_layers else []
    if not names:
        names = graph["layers"][-1]["outputs"]
    if out.exists():
        shutil.rmtree(out)
    # espresso::Thrustor::ReInferShape takes (width, height); the harness speaks (height, width).
    native = espresso_oracle.predict(graph=net_dir / "graph.txt", arena=net_dir / "arena.bin", inputs=inputs, outputs=names, out=out,
                                     reinfer=None if reinfer is None else (reinfer[1], reinfer[0]))
    ours = espresso_fixed.run(text, arena, inputs)
    report = []
    for name in names:
        expected, raw = native[name]
        mine = ours[name]
        entry = {"blob": name, "raw": list(raw), "shape": list(expected.shape)}
        if tuple(mine["data"].shape) != tuple(expected.shape):
            entry["status"] = f"shape {mine['data'].shape} vs {expected.shape}"
        elif raw[0] == 4:
            error = np.abs(mine["data"].astype(np.float64) - expected.astype(np.float64))
            entry.update(status="float", max_abs=float(error.max()), max_rel=float((error / (np.abs(expected) + 1e-6)).max()))
        else:
            if (mine["type"], mine["frac"]) != tuple(raw):
                entry["status"] = f"descriptor {(mine['type'], mine['frac'])} vs {tuple(raw)}"
            else:
                diff = np.abs(mine["data"].astype(np.int64) - expected.astype(np.int64))
                entry.update(status="exact" if not diff.any() else "mismatch", mismatches=int((diff > 0).sum()), max_abs=int(diff.max()))
        report.append(entry)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nets", nargs="+", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--reinfer", type=int, nargs=2, metavar=("H", "W"), help="run every net at this input extent (dynamic-shape graphs)")
    args = parser.parse_args()
    summary = {}
    for net_dir in args.nets:
        try:
            report = compare(net_dir, args.out / net_dir.name, args.seed, reinfer=args.reinfer)
        except Exception as error:  # noqa: BLE001 - research harness, report and continue
            print(f"{net_dir.name}: ERROR {type(error).__name__}: {str(error)[:160]}")
            summary[net_dir.name] = {"error": str(error)[:200]}
            continue
        exact = sum(1 for e in report if e["status"] == "exact")
        floats = [e for e in report if e["status"] == "float"]
        bad = [e for e in report if e["status"] not in ("exact", "float")]
        first_bad = bad[0] if bad else None
        worst_float = max((e["max_abs"] for e in floats), default=0.0)
        print(f"{net_dir.name}: layers={len(report)} exact={exact} float={len(floats)} (max_abs={worst_float:.3g}) bad={len(bad)}"
              + (f" first_bad={first_bad['blob']} {first_bad['status']} n={first_bad.get('mismatches')} max={first_bad.get('max_abs')}" if first_bad else ""))
        summary[net_dir.name] = {"layers": len(report), "exact": exact, "float": len(floats), "bad": len(bad), "first_bad": first_bad, "worst_float": worst_float}
        (args.out / net_dir.name / "parity.json").write_text(json.dumps(report, indent=1) + "\n")
    (args.out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")


if __name__ == "__main__":
    main()
