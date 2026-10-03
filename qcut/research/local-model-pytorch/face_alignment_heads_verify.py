"""Gate complete independent Stage1 networks from recorded 120/160 face-block inputs.

Original cropping, warp and inverse matrices are reference fixtures, not migrated
host tracking. Derived weights, tables, tensor dumps and portraits remain private.
"""
import argparse
import gc
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch
from PIL import Image, ImageDraw

import espresso_oracle
from espresso_integer_export import evaluate, profile
from espresso_parity import synthetic_input
from face_alignment_backbone_verify import NETWORKS, float_check, reference_case
from face_alignment_decode_verify import stage1_witness
from face_alignment_heads_parity import FLOAT_LIMITS, case_passed, comparisons
from face_alignment_heads_torch import load
from face_alignment_warp_native import BYTENN_SHA256
from face_alignment_warp_verify import map_witness, near
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


def decode_tables(*, root):
    root = espresso_oracle.private_path(path=root)
    summary = json.loads((root / "summary.json").read_text())
    if (not isinstance(summary, dict) or summary.get("passed") is not True
            or summary.get("runtime_sha256") != LIBRARY_SHA256 or summary.get("model_sha256") != MODEL_SHA256
            or not isinstance(summary.get("loaded_bytenn"), dict)
            or summary["loaded_bytenn"].get("sha256") != BYTENN_SHA256
            or summary.get("order_is_identity") is not True or not isinstance(summary.get("means"), dict)):
        raise ValueError("original decode table provenance mismatch")
    mean_path, order_path = root / "original-base.npy", root / "original-order.npy"
    mean_hash = espresso_oracle.sha256(path=mean_path)
    if mean_hash != summary["means"].get("base"):
        raise ValueError("original mean table hash mismatch")
    mean, order = np.load(mean_path, allow_pickle=False), np.load(order_path, allow_pickle=False)
    if (mean.shape != (106, 2) or mean.dtype != np.float32 or not np.isfinite(mean).all()
            or not ((mean > 0) & (mean < 256)).all() or order.shape != (106,)
            or order.dtype != np.int32 or not np.array_equal(order, np.arange(106))):
        raise ValueError("unsupported original mean or order table")
    return {"mean": mean, "order": order, "files": {"mean": mean_hash, "order": espresso_oracle.sha256(path=order_path)},
            "summary_sha256": espresso_oracle.sha256(path=root / "summary.json")}


def point_reference(*, root, size, reference):
    root = espresso_oracle.private_path(path=root)
    if size not in NETWORKS or espresso_oracle.sha256(path=root / "summary.json") != reference["summary_sha256"]:
        raise ValueError("point reference profile or summary hash mismatch")
    summary = json.loads((root / "summary.json").read_text())
    records = summary.get("cases" if size == 120 else "seeds")
    if not isinstance(records, list) or not 1 <= len(records) <= 64:
        raise ValueError("bounded original point references required")
    selected = [item for item in records if isinstance(item, dict)
                and item.get("network-input_sha256") == reference["files"]["network-input"]
                and item.get("raw_sha256") == reference["files"]["raw"]
                and item.get("passed") is True and item.get("expansion") == 1.5
                and type(item.get("threshold")) is float and item["threshold"] == 0.0
                and item.get("optimized") is False and (size == 160 or item.get("step") == 1)]
    if len(selected) != 1:
        raise ValueError("one matching original point reference required")
    directory = Path(reference["directory"])
    arrays, hashes = {}, {}
    for name, shape in (("stage1", (106, 2)), ("inverse", (2, 3)), ("original-points", (106, 2))):
        path = directory / f"{name}.npy"
        digest = espresso_oracle.sha256(path=path)
        if digest != selected[0].get(name + "_sha256"):
            raise ValueError("original point or inverse array hash mismatch")
        value = np.load(path, allow_pickle=False)
        if value.shape != shape or value.dtype != np.float32 or not np.isfinite(value).all():
            raise ValueError("original point or inverse array contract mismatch")
        arrays[name], hashes[name] = value, digest
    if abs(np.linalg.det(arrays["inverse"][:, :2])) < 1e-12:
        raise ValueError("original inverse matrix is singular")
    return {"arrays": arrays, "files": hashes}


def visual(*, pixels, native, pytorch, portable, size, output):
    background = Image.fromarray(pixels[:, :, ::-1]).resize((300, 300))
    overlays = []
    for points in (native, pytorch, portable):
        picture = background.copy()
        draw = ImageDraw.Draw(picture)
        for x, y in points.astype(np.float64) * (300 / size):
            draw.ellipse((float(x - 1.5), float(y - 1.5), float(x + 1.5), float(y + 1.5)), fill="lime")
        overlays.append(picture)
    original = np.asarray(overlays[0]).astype(np.int16)
    delta = np.maximum(np.abs(original - np.asarray(overlays[1])), np.abs(original - np.asarray(overlays[2]))).max(axis=2)
    tiles = (background, *overlays, Image.fromarray(np.clip(delta * 8, 0, 255).astype(np.uint8)))
    labels = ("Original SDK prepared face", "Original SDK Stage1 points", "Independent PyTorch points",
              "Independent ONNX points", "Overlay abs difference x8")
    canvas = Image.new("RGB", (1550, 360), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (tile, label) in enumerate(zip(tiles, labels, strict=True)):
        canvas.paste(tile, (index * 310 + 5, 30))
        draw.text((index * 310 + 5, 8), label, fill="black")
    draw.text((5, 338), "Complete Stage1 network; recorded native crop/mean/inverse; threshold=0 fixture; no editor or beauty rendering", fill="black")
    canvas.save(output)


def network_cases(*, network, size, reference, points, tables, output):
    model = load(directory=network)
    name = model.input_names[0]
    descriptor = model.graph["descriptors"][name]
    raw = (descriptor["type"], descriptor["fraction"])
    shape = model.input_shapes[name]
    cases = [(f"seed-{seed}", synthetic_input(shape, descriptor, seed)) for seed in (17, 41, 509)]
    cases.extend((label, np.full(shape, value, np.int64)) for label, value in (("black", -128), ("neutral", 0), ("white", 127)))
    cases.append(("recorded-face", reference["input"]))
    runner = profile(network=network, inputs={name: (cases[0][1], raw)}, out=output / "artifacts", loader=load)
    comparators = comparisons(graph=model.graph)
    reports = {}
    try:
        for label, value in cases:
            directory = output / label
            report, native, pytorch, portable = evaluate(network=network, inputs={name: (value, raw)}, runner=runner,
                                                        out=directory, comparisons=comparators)
            report["alignment_gate"] = case_passed(report=report, graph=model.graph, terminals=model.output_names)
            np.save(directory / "input.npy", value)
            for index, target in enumerate(model.output_names):
                for provider, array in (("native", native[target][0]), ("pytorch", pytorch[target].numpy()), ("onnx", portable[target])):
                    path = directory / f"terminal-{index}-{provider}.npy"
                    np.save(path, array)
                    report[path.stem + "_sha256"] = espresso_oracle.sha256(path=path)
            if label == "recorded-face":
                head = model.tail[2]["outputs"][0]
                report["original_runtime_crosscheck"] = float_check(actual=native[head][0], expected=reference["raw"], raw=native[head][1])
                stages = {}
                for provider, array in (("pytorch", pytorch[head].numpy()), ("onnx", portable[head])):
                    _, stage = stage1_witness(raw_pairs=array.reshape(106, 2), mean=tables["mean"], order=tables["order"], size=size)
                    mapped = map_witness(points=stage, matrix=points["arrays"]["inverse"])
                    stages[provider] = stage
                    report[provider + "_stage1"] = near(actual=stage, expected=points["arrays"]["stage1"], tolerance=0.0001)
                    report[provider + "_backmap"] = near(actual=mapped, expected=points["arrays"]["original-points"], tolerance=0.002)
                    np.save(directory / f"{provider}-stage1.npy", stage)
                    np.save(directory / f"{provider}-original-points.npy", mapped)
                report["alignment_gate"] = (report["alignment_gate"] and report["original_runtime_crosscheck"]["passed"]
                                             and all(report[key]["within"] for key in ("pytorch_stage1", "pytorch_backmap", "onnx_stage1", "onnx_backmap")))
                visual(pixels=reference["pixels"], native=points["arrays"]["stage1"], pytorch=stages["pytorch"],
                       portable=stages["onnx"], size=size, output=directory / "points.png")
            (directory / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
            reports[label] = report
            print(f"align-{size}/{label}: passed={report['alignment_gate']} blobs={len(report['blobs'])}", flush=True)
        types = [model.graph["descriptors"][name]["type"] for name in runner["names"]]
        return {"cases": reports, "terminal_names": model.output_names,
                "integer_blobs": sum(kind != 4 for kind in types), "floating_blobs": types.count(4),
                "graph_sha256": espresso_oracle.sha256(path=network / "graph.txt"),
                "arena_sha256": espresso_oracle.sha256(path=network / "arena.bin"),
                "recorded_input": reference["files"], "point_reference": points["files"]}
    finally:
        runner.clear()


def run(*, networks, reference, decode_reference, output):
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite alignment head evidence")
    references = {size: reference_case(root=reference, size=size) for size in NETWORKS}
    points = {size: point_reference(root=reference, size=size, reference=references[size]) for size in NETWORKS}
    tables = decode_tables(root=decode_reference)
    networks = Path(networks)
    manifest = json.loads((networks / "manifest.json").read_text())
    if manifest.get("library_sha256") != espresso_oracle.RUNTIME_SHA256:
        raise ValueError("recovered network manifest runtime mismatch")
    for size, identifier in NETWORKS.items():
        network = networks / identifier
        records = [item for item in manifest.get("nets", []) if item.get("id") == identifier]
        if len(records) != 1:
            raise ValueError("recovered network identity mismatch")
        for file, key in (("graph.txt", "graph_sha256"), ("arena.bin", "arena_sha256")):
            if espresso_oracle.sha256(path=network / file) != records[0].get(key):
                raise ValueError("recovered network hash mismatch")
    output.mkdir(parents=True)
    torch.set_num_threads(1)
    reports = {}
    for size, identifier in NETWORKS.items():
        reports[str(size)] = network_cases(network=networks / identifier, size=size, reference=references[size],
                                          points=points[size], tables=tables, output=output / f"align-{size}")
        gc.collect()
    summary = {"passed": all(report["alignment_gate"] for item in reports.values() for report in item["cases"].values()),
               "scope": "complete independent Stage1 networks from recorded face blocks; not independent host tracking",
               "editor_changed": False, "render_injection_changed": False,
               "native_oracle_sha256": espresso_oracle.RUNTIME_SHA256, "networks": reports,
               "float_policies": FLOAT_LIMITS, "decode_tables": {key: value for key, value in tables.items() if key not in ("mean", "order")},
               "versions": {"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__},
               "artifacts": {str(path.relative_to(output)): espresso_oracle.sha256(path=path)
                             for path in output.glob("align-*/artifacts/*") if path.is_file()},
               "unverified": ["independent full-frame cropping/warp/tracking", "host quality acceptance", "Stage2/iris",
                              "native render result injection", "editor preview/export", "Windows/Linux private-model inference", "weight distribution"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--networks", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--decode-reference", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    summary = run(networks=args.networks, reference=args.reference, decode_reference=args.decode_reference, output=args.out)
    print(json.dumps({"passed": summary["passed"], "cases": sum(len(item["cases"]) for item in summary["networks"].values()), "output": str(args.out)}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
