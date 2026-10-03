"""Export only the 120/160 integer alignment backbone, with per-blob native gates.

No landmark heads, host routing or editor replacement is claimed. Original weights,
derived models, reference crops and actual tensor evidence remain private.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch
from PIL import Image, ImageDraw

import espresso_oracle
from espresso_graph import analyze
from espresso_integer_export import evaluate, profile
from espresso_parity import synthetic_input
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


NETWORKS = {120: "2b13415220a208e7", 160: "af10da6a6a376270"}
CHART_CHANNELS = (0, 4, 31, 32, 63, 64, 95, 127)


def backbone_spec(*, text):
    graph = analyze(text)
    inputs = [layer for layer in graph["layers"] if layer["op"] == "Input"]
    if len(inputs) != 1:
        raise ValueError("one alignment input required")
    input_layer = inputs[0]
    batch, height, width, channels = input_layer["shape"]
    if (batch != 1 or height not in NETWORKS or width != height or channels != 3
            or input_layer["storage"] != {"type": 2 if height == 120 else 1, "fraction": 6}):
        raise ValueError("unsupported alignment input profile")
    boundary = next((index for index, layer in enumerate(graph["layers"])
                     if any(graph["descriptors"][name]["type"] == 4 for name in layer["outputs"])), None)
    if boundary is None or boundary < 2:
        raise ValueError("expected explicit integer-to-float boundary")
    first_float, last_integer = graph["layers"][boundary], graph["layers"][boundary - 1]
    if (first_float["op"] != "PoolingDown" or first_float.get("mode") != "AVE"
            or first_float.get("is_global") is not True or len(last_integer["outputs"]) != 1
            or first_float["inputs"] != last_integer["outputs"] or last_integer["shape"][3] != 128):
        raise ValueError("unsupported alignment backbone boundary")
    return {"size": height, "input": input_layer["name"], "prefix": last_integer["outputs"][0],
            "excluded_first_operator": first_float["op"], "layers": boundary - 1,
            "blobs": sum(len(layer["outputs"]) for layer in graph["layers"][1:boundary]), "graph": graph}


def float_check(*, actual, expected, raw):
    if (tuple(raw) != (4, 0) or actual.dtype != np.float32 or expected.dtype != np.float32
            or actual.shape != (1, 1, 1, 212) or expected.shape != (106, 2)
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        return {"passed": False, "reason": "invalid original landmark provenance control"}
    error = np.abs(actual.reshape(106, 2).astype(np.float64) - expected.astype(np.float64))
    maximum = float(error.max())
    return {"passed": maximum <= 0.0001, "exact": maximum == 0, "max_abs": maximum,
            "scope": "original CPU oracle vs recorded original SDK head; not converted head"}


def reference_case(*, root, size):
    root = espresso_oracle.private_path(path=root)
    summary = json.loads((root / "summary.json").read_text())
    if (not isinstance(summary, dict) or summary.get("passed") is not True or summary.get("runtime_sha256") != LIBRARY_SHA256
            or summary.get("model_sha256") != MODEL_SHA256
            or not isinstance(summary.get("loaded_bytenn"), dict)
            or summary.get("loaded_bytenn", {}).get("sha256") != BYTENN_SHA256):
        raise ValueError("original alignment reference provenance mismatch")
    key, stem = ("cases", "case") if size == 120 else ("seeds", "seed")
    records = summary.get(key)
    if not isinstance(records, list) or not 1 <= len(records) <= 64 or size not in NETWORKS:
        raise ValueError("bounded original reference cases required")
    selected = [(index, item) for index, item in enumerate(records)
                if isinstance(item, dict) and item.get("expansion") == 1.5 and item.get("optimized") is False
                and (size == 160 or item.get("step") == 1)]
    if len(selected) != 1:
        raise ValueError("one ordinary 1.5-crop original reference required")
    index, report = selected[0]
    if report.get("passed") is not True or type(report.get("threshold")) is not float or report["threshold"] != 0.0:
        raise ValueError("expected passed controlled reference with threshold=0")
    directory = root / f"{stem}-{index:03d}"
    arrays, hashes = {}, {}
    for name in ("network-input", "prepared-bgr", "raw"):
        path = directory / f"{name}.npy"
        digest = espresso_oracle.sha256(path=path)
        if digest != report.get(name + "_sha256"):
            raise ValueError("original reference array hash mismatch")
        hashes[name] = digest
        arrays[name] = np.load(path, allow_pickle=False)
    inputs, pixels, raw = (arrays[name] for name in ("network-input", "prepared-bgr", "raw"))
    if (inputs.shape != (1, size, size, 3) or inputs.dtype != (np.int16 if size == 120 else np.int8)
            or pixels.shape != (size, size, 3) or pixels.dtype != np.uint8
            or raw.shape != (106, 2) or raw.dtype != np.float32 or not np.isfinite(raw).all()
            or not np.array_equal(inputs, (pixels.astype(np.int16) - 128).astype(inputs.dtype)[None])):
        raise ValueError("original reference shape, dtype or preprocessing mismatch")
    return {"input": inputs, "pixels": pixels, "raw": raw, "files": hashes,
            "directory": str(directory), "summary_sha256": espresso_oracle.sha256(path=root / "summary.json")}


def case_passed(*, report, names, prefix):
    if not isinstance(report, dict) or not isinstance(report.get("blobs"), dict):
        return False
    blobs = report.get("blobs", {})
    if (not names or len(set(names)) != len(names) or prefix not in names or set(blobs) != set(names)
            or report.get("passed") is not True):
        return False
    for name in names:
        checks = blobs[name]
        expected = {"pytorch", "onnx", "pytorch_reloaded", "onnx_terminal"} if name == prefix else {"pytorch", "onnx"}
        if not isinstance(checks, dict) or set(checks) != expected or any(
                not isinstance(check, dict) or check.get("passed") is not True
                or type(check.get("max_abs")) is not int or check["max_abs"] != 0
                or type(check.get("mismatches")) is not int or check["mismatches"] != 0
                                          or type(check.get("elements")) is not int or check["elements"] < 1
                                          for check in checks.values()):
            return False
    return True


def feature_tiles(*, values, difference):
    if values.ndim != 4 or values.shape[0] != 1 or values.shape[3] != 128:
        raise ValueError("128-channel feature mosaic required")
    canvas = Image.new("L", (220, 110))
    for index, channel in enumerate(CHART_CHANNELS):
        data = values[0, :, :, channel].astype(np.float64)
        data = np.clip(data * 8, 0, 255) if difference else np.clip((data + 2047) / 4094 * 255, 0, 255)
        tile = Image.fromarray(data.astype(np.uint8)).resize((55, 55), Image.Resampling.NEAREST)
        canvas.paste(tile, ((index % 4) * 55, (index // 4) * 55))
    return canvas


def visual(*, pixels, native, pytorch, portable, output):
    error = np.maximum(np.abs(native.astype(np.int64) - pytorch), np.abs(native.astype(np.int64) - portable))
    tiles = (Image.fromarray(pixels[:, :, ::-1]).resize((220, 220)),
             feature_tiles(values=native, difference=False), feature_tiles(values=pytorch, difference=False),
             feature_tiles(values=portable, difference=False), feature_tiles(values=error, difference=True))
    labels = ("Original SDK prepared face block", "Native integer features", "PyTorch integer features",
              "ONNX integer features", "Abs difference x8")
    canvas = Image.new("RGB", (1250, 300), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (tile, label) in enumerate(zip(tiles, labels, strict=True)):
        canvas.paste(tile, (index * 250 + 5, 30))
        draw.text((index * 250 + 5, 8), label, fill="black")
    draw.text((5, 275), "8 displayed feature channels; all 87 integer blobs checked; no converted landmark head or beauty rendering", fill="black")
    canvas.save(output)


def run(*, networks, reference, output):
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite backbone evidence")
    references = {size: reference_case(root=reference, size=size) for size in NETWORKS}
    networks = Path(networks)
    manifest = json.loads((networks / "manifest.json").read_text())
    if manifest.get("library_sha256") != espresso_oracle.RUNTIME_SHA256:
        raise ValueError("recovered network manifest runtime mismatch")
    specifications = {}
    for size, identifier in NETWORKS.items():
        network = networks / identifier
        spec = backbone_spec(text=(network / "graph.txt").read_text())
        entries = [entry for entry in manifest.get("nets", []) if entry.get("id") == identifier]
        if len(entries) != 1 or spec["size"] != size:
            raise ValueError("recovered alignment network identity mismatch")
        for name, key in (("graph.txt", "graph_sha256"), ("arena.bin", "arena_sha256")):
            if espresso_oracle.sha256(path=network / name) != entries[0].get(key):
                raise ValueError("recovered alignment network hash mismatch")
        specifications[size] = spec
    output.mkdir(parents=True)
    torch.set_num_threads(1)
    reports = {}
    for size, spec in specifications.items():
        network = networks / NETWORKS[size]
        desc = spec["graph"]["descriptors"][spec["input"]]
        shape = spec["graph"]["shapes"][spec["input"]]
        raw = (desc["type"], desc["fraction"])
        cases = [(f"seed-{seed}", synthetic_input(shape, desc, seed)) for seed in (17, 41, 509)]
        cases.extend((name, np.full(shape, value, np.int64)) for name, value in (("black", -128), ("neutral", 0), ("white", 127)))
        cases.append(("recorded-face", references[size]["input"]))
        directory = output / f"align-{size}"
        runner = profile(network=network, inputs={spec["input"]: (cases[0][1], raw)},
                         out=directory / "artifacts", prefix_output=spec["prefix"])
        checks = {}
        for name, value in cases:
            case = directory / name
            report, native, pytorch, portable = evaluate(network=network, inputs={spec["input"]: (value, raw)},
                                                        runner=runner, out=case)
            report["backbone_gate"] = case_passed(report=report, names=runner["names"], prefix=spec["prefix"])
            for label, array in (("input", value), ("native-terminal", native[spec["prefix"]][0]),
                                 ("pytorch-terminal", pytorch[spec["prefix"]].numpy()),
                                 ("onnx-terminal", portable[spec["prefix"]])):
                path = case / f"{label}.npy"
                np.save(path, array)
                report[label + "_sha256"] = espresso_oracle.sha256(path=path)
            if name == "recorded-face":
                original = espresso_oracle.predict(graph=network / "graph.txt", arena=network / "arena.bin",
                                                   inputs={spec["input"]: (value, raw)}, outputs=["fc_landmark_s1"],
                                                   out=case / "original-head-crosscheck")
                head, descriptor = original["fc_landmark_s1"]
                report["original_runtime_crosscheck"] = float_check(actual=head, expected=references[size]["raw"], raw=descriptor)
                report["backbone_gate"] = report["backbone_gate"] and report["original_runtime_crosscheck"]["passed"]
                visual(pixels=references[size]["pixels"], native=native[spec["prefix"]][0],
                       pytorch=pytorch[spec["prefix"]].numpy(), portable=portable[spec["prefix"]], output=case / "features.png")
            (case / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            checks[name] = report
            print(f"align-{size}/{name}: passed={report['backbone_gate']} blobs={len(report['blobs'])}", flush=True)
        reports[str(size)] = {"prefix_output": spec["prefix"], "executed_layers": spec["layers"],
                              "excluded_first_operator": spec["excluded_first_operator"],
                              "graph_sha256": espresso_oracle.sha256(path=network / "graph.txt"),
                              "arena_sha256": espresso_oracle.sha256(path=network / "arena.bin"),
                              "original_reference": {key: value for key, value in references[size].items() if key not in ("input", "pixels", "raw")},
                              "cases": checks}
    summary = {"passed": all(report["backbone_gate"] for item in reports.values() for report in item["cases"].values()),
               "scope": "independent integer backbone only; original floating landmark head used solely as provenance control",
               "editor_changed": False, "full_landmark_network_converted": False,
               "native_oracle_sha256": espresso_oracle.RUNTIME_SHA256, "networks": reports,
               "versions": {"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__},
               "artifacts": {str(path.relative_to(output)): espresso_oracle.sha256(path=path)
                             for path in output.glob("align-*/artifacts/*") if path.is_file()},
               "unverified": ["floating pooling/dense/quality heads", "Stage2/iris", "complete independent frame-to-points",
                              "editor preview/export", "private-model Windows/Linux execution", "GPU performance", "weight distribution"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--networks", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    summary = run(networks=args.networks, reference=args.reference, output=args.out)
    print(json.dumps({"passed": summary["passed"], "cases": sum(len(item["cases"]) for item in summary["networks"].values()),
                      "output": str(args.out)}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
