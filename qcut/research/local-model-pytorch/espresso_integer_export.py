"""Export integer graphs or explicit prefixes, gated by the pinned native oracle.

Artifacts and recovered weights stay private. A successful report means model-output
parity, not that face-box decoding, alignment or makeup rendering has been migrated.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch

import espresso_oracle
from espresso_integer_torch import load
from espresso_parity import synthetic_input
from espresso_real_parity import meta_records, tensor


def compare(*, actual, expected, descriptor, raw):
    if (descriptor["type"], descriptor["fraction"]) != tuple(raw):
        return {"passed": False, "reason": "storage descriptor mismatch"}
    if actual.shape != expected.shape or expected.size == 0:
        return {"passed": False, "reason": "shape mismatch or empty output"}
    if actual.dtype != np.int64 or not np.issubdtype(expected.dtype, np.integer):
        return {"passed": False, "reason": "expected integer tensors"}
    difference = actual != expected
    return {"passed": not bool(difference.any()), "elements": int(expected.size),
            "mismatches": int(difference.sum()), "max_abs": int(np.abs(actual - expected.astype(np.int64)).max())}


def capture_case(*, capture, graph_digest, descriptors):
    records = meta_records(capture)
    objects = set()
    for record in records:
        if record["kind"] != "espresso":
            continue
        path = record["path"].with_suffix(".graph.txt")
        if path.exists() and espresso_oracle.sha256(path=path) == graph_digest:
            objects.add(record["fields"]["self"])
    slots = {}
    for record in records:
        fields = record["fields"]
        if record["kind"] not in ("espresso-input", "espresso-output") or fields["self"] not in objects:
            continue
        inference = int(fields["inference"])
        if inference < 0:
            continue
        path = record["path"].with_suffix(".bin")
        if "skipped" in fields or not path.exists():
            raise ValueError("incomplete matching capture tensor")
        value, raw = tensor(path, fields)
        if value is None:
            raise ValueError("capture tensor byte count mismatch")
        name = fields["name"]
        if name not in descriptors or tuple(raw) != (descriptors[name]["type"], descriptors[name]["fraction"]):
            raise ValueError("capture storage descriptor mismatch")
        slot = slots.setdefault((fields["self"], inference), {"inputs": {}, "outputs": {}, "files": {}})
        kind = "inputs" if record["kind"] == "espresso-input" else "outputs"
        if name in slot[kind]:
            raise ValueError("duplicate capture tensor")
        slot[kind][name] = (value, raw)
        slot["files"][f"{kind}/{name}"] = {"path": str(path.resolve()), "sha256": espresso_oracle.sha256(path=path)}
    complete = [slot for slot in slots.values() if slot["inputs"] and slot["outputs"]]
    if not complete:
        raise ValueError("no complete real-input inference for this graph")
    return complete[0]


def session(*, path):
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    return onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def export_onnx(*, model, inputs, path):
    torch.onnx.export(model, inputs, str(path), opset_version=18, dynamo=False,
                      input_names=list(model.input_names), output_names=list(model.output_names))
    onnx.checker.check_model(str(path), full_check=True)
    graph = onnx.load(path)
    if any(node.domain not in ("", "ai.onnx") for node in graph.graph.node):
        raise ValueError("unexpected custom ONNX operator")


def profile(*, network, inputs, out, prefix_output=None):
    shapes = {name: tuple(value.shape) for name, (value, _) in inputs.items()}
    model = load(directory=network, input_shapes=shapes, prefix_output=prefix_output)
    names = [name for layer in model.execution_layers if layer["op"] != "Input" for name in layer["outputs"]]
    diagnostic = load(directory=network, input_shapes=shapes, output_names=names, prefix_output=prefix_output)
    args = tuple(torch.from_numpy(inputs[name][0].astype(np.int64)) for name in model.input_names)
    out.mkdir(parents=True, exist_ok=False)
    with torch.no_grad():
        artifact = out / "model.pt2"
        torch.export.save(torch.export.export(model, args), artifact)
        portable = torch.export.load(artifact).module()
        export_onnx(model=model, inputs=args, path=out / "model.onnx")
        export_onnx(model=diagnostic, inputs=args, path=out / "all-layers.onnx")
    return {"model": model, "diagnostic": diagnostic, "portable": portable,
            "session": session(path=out / "model.onnx"), "all_session": session(path=out / "all-layers.onnx"),
            "names": names, "out": out}


def evaluate(*, network, inputs, runner, out, captured=None):
    model = runner["model"]
    descriptor = model.graph["descriptors"]
    shapes = {name: tuple(value.shape) for name, (value, _) in inputs.items()}
    if set(inputs) != set(model.input_names) or shapes != model.input_shapes:
        raise ValueError("case inputs do not match exported profile")
    for name, (_, raw) in inputs.items():
        if tuple(raw) != (descriptor[name]["type"], descriptor[name]["fraction"]):
            raise ValueError("input storage descriptor mismatch")
    native = espresso_oracle.predict(
        graph=network / "graph.txt", arena=network / "arena.bin", inputs=inputs, outputs=runner["names"],
        out=out / "native", reinfer=(next(iter(shapes.values()))[2], next(iter(shapes.values()))[1]),
    )
    args = tuple(torch.from_numpy(inputs[name][0].astype(np.int64)) for name in model.input_names)
    feed = dict(zip(model.input_names, (value.numpy() for value in args)))
    start = time.perf_counter()
    with torch.no_grad():
        pytorch = dict(zip(runner["names"], runner["diagnostic"](*args)))
        portable = dict(zip(model.output_names, runner["portable"](*args)))
    torch_seconds = time.perf_counter() - start
    start = time.perf_counter()
    onnx_all = dict(zip(runner["names"], runner["all_session"].run(None, feed)))
    onnx_outputs = dict(zip(model.output_names, runner["session"].run(None, feed)))
    onnx_seconds = time.perf_counter() - start
    checks = {}
    for name in runner["names"]:
        expected, raw = native[name]
        checks[name] = {
            "pytorch": compare(actual=pytorch[name].numpy(), expected=expected, descriptor=descriptor[name], raw=raw),
            "onnx": compare(actual=onnx_all[name], expected=expected, descriptor=descriptor[name], raw=raw),
        }
        if name in portable:
            checks[name]["pytorch_reloaded"] = compare(actual=portable[name].numpy(), expected=expected, descriptor=descriptor[name], raw=raw)
            checks[name]["onnx_terminal"] = compare(actual=onnx_outputs[name], expected=expected, descriptor=descriptor[name], raw=raw)
        if captured is not None and name in captured:
            original, original_raw = captured[name]
            checks[name]["recorded_render"] = compare(actual=expected.astype(np.int64), expected=original,
                                                        descriptor=descriptor[name], raw=original_raw)
    if captured is not None and not set(model.output_names) <= set(captured):
        raise ValueError("real render capture is missing terminal detection heads")
    passed = bool(checks) and all(check["passed"] for blobs in checks.values() for check in blobs.values())
    report = {"passed": passed, "blobs": checks, "torch_and_reload_seconds": torch_seconds,
              "onnx_all_and_terminal_seconds": onnx_seconds,
              "input_shapes": shapes, "input_sha256": {name: hashlib.sha256(value.tobytes()).hexdigest() for name, (value, _) in inputs.items()}}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report, native, pytorch, onnx_outputs


def visual(*, frame, native, pytorch, onnx_outputs, out):
    from PIL import Image, ImageDraw

    pixels = np.fromfile(frame, dtype=np.uint8)
    if pixels.size != 1280 * 720 * 4:
        raise ValueError("visual reference must be a 1280x720 RGBA frame")
    source = Image.fromarray(pixels.reshape(720, 1280, 4), "RGBA").convert("RGB")
    image = Image.new("RGB", (1000, 910), "white")
    draw = ImageDraw.Draw(image)
    image.paste(source.resize((480, 270)), (10, 30))
    draw.text((10, 10), "Source frame; model-output comparison, not makeup rendering", fill="black")
    labels = ("Native", "PyTorch", "ONNX", "Abs diff x6 (black = exact)")
    heads = [name for name in native if "cls_convs" in name]
    if len(heads) != 3:
        raise ValueError("visual comparison requires three detection classification heads")
    for row, name in enumerate(heads):
        original = native[name][0].astype(np.int64)
        torch_value = pytorch[name].numpy()
        onnx_value = onnx_outputs[name]
        difference = np.maximum(np.abs(original - torch_value), np.abs(original - onnx_value))
        for column, (label, value) in enumerate(zip(labels, (original, torch_value, onnx_value, difference))):
            scaled = np.clip(value[..., 0] * 6 if column == 3 else value[..., 0] + 128, 0, 255).astype(np.uint8)[0]
            tile = Image.fromarray(scaled).resize((230, 170), resample=Image.Resampling.NEAREST).convert("RGB")
            x, y = 10 + column * 250, 330 + row * 190
            draw.text((x, y), f"{label}: scale {row}", fill="black")
            image.paste(tile, (x, y + 15))
    image.save(out / "detector-output-comparison.png")


def run(*, network, out, seeds, shape=None, capture=None, frame=None):
    out = espresso_oracle.private_path(path=out)
    if out.exists():
        raise ValueError("use a fresh output directory; prior evidence is not overwritten")
    out.mkdir(parents=True)
    torch.set_num_threads(1)
    model = load(directory=network)
    if len(model.input_names) != 1:
        raise ValueError("this verification harness expects one detection input")
    descriptors = model.graph["descriptors"]
    graph_digest = espresso_oracle.sha256(path=network / "graph.txt")
    cases = []
    for seed in seeds:
        inputs = {}
        for name in model.input_names:
            storage = descriptors[name]
            dimensions = model.input_shapes[name]
            if shape is not None:
                dimensions = (dimensions[0], shape[0], shape[1], dimensions[3])
            inputs[name] = (synthetic_input(dimensions, storage, seed), (storage["type"], storage["fraction"]))
        cases.append({"name": f"seed-{seed}", "inputs": inputs})
    recorded = None
    if capture is not None:
        recorded = capture_case(capture=capture, graph_digest=graph_digest, descriptors=descriptors)
        cases.append({"name": "real-render", "inputs": recorded["inputs"], "captured": recorded["outputs"]})
    if not cases:
        raise ValueError("no verification cases")
    preprocessing = None
    if frame is not None:
        from espresso_preprocess_probe import face_detector_tensor

        if recorded is None:
            raise ValueError("frame verification requires a real capture")
        pixels = np.fromfile(frame, dtype=np.uint8)
        if pixels.size != 1280 * 720 * 4:
            raise ValueError("expected a 1280x720 RGBA frame")
        name = model.input_names[0]
        captured_tensor = recorded["inputs"][name][0]
        recreated = face_detector_tensor(pixels.reshape(720, 1280, 4)[..., :3], captured_tensor.shape[2], captured_tensor.shape[1])[None]
        if recreated.shape != captured_tensor.shape or not np.array_equal(recreated, captured_tensor):
            raise ValueError("frame preprocessing does not match recorded model input")
        preprocessing = {"passed": True, "frame_sha256": espresso_oracle.sha256(path=frame), "elements": int(recreated.size)}
    profiles, reports = {}, {}
    for case in cases:
        key = "-".join(map(str, next(iter(case["inputs"].values()))[0].shape))
        if key not in profiles:
            profiles[key] = profile(network=network, inputs=case["inputs"], out=out / f"profile-{key}")
        report, native, pytorch, onnx_outputs = evaluate(network=network, inputs=case["inputs"], runner=profiles[key],
                                                       out=out / case["name"], captured=case.get("captured"))
        reports[case["name"]] = report
        print(f"{case['name']}: passed={report['passed']} blobs={len(report['blobs'])}", flush=True)
        if case["name"] == "real-render" and frame is not None:
            visual(frame=frame, native=native, pytorch=pytorch, onnx_outputs=onnx_outputs, out=out / case["name"])
    passed = all(report["passed"] for report in reports.values())
    summary = {
        "passed": passed, "scope": "integer detection model only; no editor or makeup renderer replacement",
        "graph_sha256": graph_digest, "arena_sha256": espresso_oracle.sha256(path=network / "arena.bin"),
        "runtime_sha256": espresso_oracle.RUNTIME_SHA256,
        "versions": {"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__},
        "preprocessing": preprocessing, "captured_files": None if recorded is None else recorded["files"],
        "cases": {name: {"passed": report["passed"], "blobs": len(report["blobs"])} for name, report in reports.items()},
        "artifacts": {str(path.relative_to(out)): espresso_oracle.sha256(path=path)
                      for runner in profiles.values() for path in runner["out"].iterdir() if path.is_file()},
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if not passed:
        raise ValueError("model parity gate failed; see reports")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--seed", type=int, action="append")
    parser.add_argument("--shape", type=int, nargs=2, metavar=("H", "W"))
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--frame", type=Path)
    args = parser.parse_args()
    print(json.dumps(run(network=args.network, out=args.out, seeds=args.seed or [17, 41, 509],
                         shape=args.shape, capture=args.capture, frame=args.frame), indent=2))


if __name__ == "__main__":
    main()
