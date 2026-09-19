"""Export the hash-pinned private OCR detector and run unchanged-tolerance cases."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from container_scan import decode_graph, runtime_graph_table
from model_containers import bytenn_sections
from ocr_torch import FORMAT, GRAPH_SHA256, RUNTIME_SHA256, SOURCE_SHA256, OCRDetector, decode_arena, load_model, parse_graph, widen_fp16

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
RUNTIMES = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"
SOURCE = RUNTIMES / "JianyingFilter/current/Models/general_ocr_det_fp16_v2.0_size0_md5241d0b04ab38b62c4e7c9f7e6bfd3e40.model"
LIBRARY = RUNTIMES / "JianyingShotSplit/current/Frameworks/libbytenn.dylib"


def sha(*, data):
    return hashlib.sha256(data).hexdigest()


def fresh_directory(*, path):
    path = path.resolve()
    if not path.is_relative_to(PRIVATE.resolve()) or path == PRIVATE.resolve():
        raise ValueError("OCR outputs must remain under the ignored private root")
    if path.exists() and any(path.iterdir()):
        raise ValueError("fresh empty OCR output directory required")
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_cases(*, quick):
    dimensions = [(64, 96)] if quick else [(64, 96), (320, 640), (640, 960)]
    cases = {}
    for height, width in dimensions:
        shape = (1, 3, height, width)
        prefix = f"{height}x{width}"
        cases[f"{prefix}-zeros"] = np.zeros(shape, dtype=np.float32)
        cases[f"{prefix}-random-17"] = np.random.default_rng(17).uniform(-1, 1, shape).astype(np.float32)
        if not quick:
            cases[f"{prefix}-holdout-509"] = np.random.default_rng(509).normal(0, 0.35, shape).astype(np.float32)
    if not quick:
        shape = (1, 3, 320, 640)
        ramp = np.linspace(-1, 1, np.prod(shape), dtype=np.float32).reshape(shape)
        cases["320x640-holdout-ramp"] = ramp
        pulse = np.zeros(shape, dtype=np.float32)
        pulse[0, 0, 0, 0], pulse[0, 2, -1, -1] = 1, -1
        cases["320x640-holdout-edge-pulse"] = pulse
        cases["320x640-holdout-negative-ones"] = -np.ones(shape, dtype=np.float32)
        from PIL import Image, ImageDraw, ImageFont
        page = Image.new("RGB", (640, 320), "white")
        painter = ImageDraw.Draw(page)
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 42)
        painter.text((25, 30), "OCR 2026 / QCut", font=font, fill="black")
        painter.text((67, 115), "Frame 0123456789", font=font, fill=(50, 30, 20))
        painter.text((30, 220), "A small detector test", font=font, fill=(20, 50, 80))
        cases["320x640-holdout-synthetic-text"] = (np.asarray(page).astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None].copy()
    return cases


def read_native(*, directory, names):
    lines = (directory / "descriptors.tsv").read_text().splitlines()
    descriptors = {}
    for line in lines:
        fields = line.split("\t")
        if len(fields) != 7 or fields[0] in descriptors:
            raise ValueError("invalid native descriptors")
        dims = list(map(int, fields[1:5]))
        if any(d <= 0 or d > 16384 for d in dims) or np.prod(dims) > 64 * 1024 * 1024:
            raise ValueError("invalid native shape")
        descriptors[fields[0]] = {"dims_nwhc": dims, "raw_fields": list(map(int, fields[5:]))}
    if set(descriptors) != {"data", *names}:
        raise ValueError("native tensor set differs")
    tensors = {}
    for index, name in enumerate(names):
        n, width, height, channels = descriptors[name]["dims_nwhc"]
        path = directory / f"native-{index}.f32"
        if path.stat().st_size != n * width * height * channels * 4:
            raise ValueError("native output byte count differs")
        values = np.fromfile(path, dtype="<f4").reshape(n, height, width, channels).transpose(0, 3, 1, 2).copy()
        if not np.isfinite(values).all():
            raise ValueError("nonfinite native output")
        tensors[name] = torch.from_numpy(values)
    return tensors, descriptors


def compare(*, actual, expected):
    if actual.shape != expected.shape or not torch.isfinite(actual).all() or not torch.isfinite(expected).all():
        return {"passed": False, "reason": "shape or finite check failed", "shape": list(actual.shape)}
    delta = (actual.double() - expected.double()).abs()
    return {"passed": bool(torch.all(delta <= 1e-4 + 1e-4 * expected.double().abs())),
            "max_abs": float(delta.max()), "mae": float(delta.mean()), "shape": list(actual.shape)}


def run_oracle(*, out):
    compiler = "/Library/Developer/CommandLineTools/usr/bin/clang++"
    binary = out / "ocr-oracle"
    command = [compiler, "-std=c++17", "-O2", "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
               f"-Wl,-rpath,{LIBRARY.parent}", str(Path(__file__).with_name("ocr_oracle.mm")), "-o", str(binary)]
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=60)
        with (out / "oracle.log").open("w") as log:
            result = subprocess.run([str(binary), str(LIBRARY), str(out / "graph.private.txt"),
                                     str(out / "weights.private.bin"), str(out)],
                                    cwd=out, stdout=log, stderr=subprocess.STDOUT, timeout=240)
        runtime = json.loads((out / "runtime.json").read_text()) if (out / "runtime.json").exists() else {}
        valid = result.returncode == 0 and runtime == {"forced_cpu": True, "forward_type": 0}
        return {"status": "completed" if valid else "failed", "returncode": result.returncode,
                "backend": "bytenn_cpu", **runtime}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return {"status": "failed", "reason": str(error), "backend": "bytenn_cpu"}


def verify_fp16(*, out):
    directory = out / "fp16-proof"
    directory.mkdir()
    all_bits = np.arange(65536, dtype=np.uint16)
    finite = all_bits[(all_bits & 0x7c00) != 0x7c00]
    vectors = {"all-finite-half-patterns": finite}
    for count in range(1, 9):
        vectors[f"vector-tail-{count}"] = np.array([1, 0x8001, 0x3ff, 0x83ff, 0x100, 0x8100, 0, 0x8000][:count], dtype=np.uint16)
    evidence = []
    for name, bits in vectors.items():
        source, destination = directory / f"{name}.f16", directory / f"{name}.f32"
        source.write_bytes(bits.tobytes())
        result = subprocess.run([str(out / "ocr-oracle"), "--widen", str(LIBRARY), str(source), str(destination)],
                                cwd=directory, capture_output=True, timeout=30)
        expected = widen_fp16(bits=bits).tobytes()
        observed = destination.read_bytes() if destination.exists() else b""
        evidence.append({"case": name, "values": len(bits), "passed": result.returncode == 0 and observed == expected,
                         "native_sha256": sha(data=observed), "pytorch_decoder_sha256": sha(data=expected)})
    return {"passed": bool(evidence) and all(case["passed"] for case in evidence), "cases": evidence}


def export(*, out, quick, trace, oracle):
    out = fresh_directory(path=out)
    source = SOURCE.read_bytes()
    if sha(data=source) != SOURCE_SHA256:
        raise ValueError("OCR source hash differs")
    text, graph_report = decode_graph(data=source, offset=0, table=runtime_graph_table(path=LIBRARY))
    if sha(data=text.encode()) != GRAPH_SHA256:
        raise ValueError("OCR graph hash differs")
    nodes = parse_graph(text=text)
    template = OCRDetector(nodes=nodes)
    section = bytenn_sections(data=source, offset=0)["sections"][1]
    arena = source[section["offset"]:section["offset"] + section["bytes"]]
    (out / "graph.private.txt").write_text(text)
    (out / "weights.private.bin").write_bytes(arena)
    weights = decode_arena(arena=arena, count=template.parameter_count)
    stamp = int(text.splitlines()[1].removesuffix("\\n").split()[2])
    if int.from_bytes(arena[-4:], "little") != stamp:
        raise ValueError("OCR arena graph stamp mismatch")
    model = OCRDetector(nodes=nodes, weights=weights).eval()
    artifact = out / "ocr-detector.pt"
    torch.save({"format": FORMAT, "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
                "local_only": True, "graph": text, "state_dict": model.state_dict()}, artifact)
    artifact_sha = sha(data=artifact.read_bytes())
    restored = load_model(path=artifact, expected_sha256=artifact_sha)
    state_exact = all(torch.equal(value, restored.state_dict()[name]) for name, value in model.state_dict().items())
    names = [step["output"] for step in model.steps[1:]] if trace else model.outputs
    (out / "outputs.txt").write_text("\n".join(names) + "\n")
    cases = []
    for name, value in build_cases(quick=quick).items():
        directory = out / f"case-{name}"
        directory.mkdir()
        height, width = value.shape[2:]
        nhwc = value.transpose(0, 2, 3, 1).copy()
        nhwc.tofile(directory / "input.f32")
        (directory / "shape.txt").write_text(f"{height} {width}\n")
        inputs = {model.input_name: torch.from_numpy(value)}
        with torch.inference_mode():
            outputs, cloned = model(inputs, trace=trace), restored(inputs, trace=trace)
        case = {"case": name, "holdout": "holdout" in name, "input_shape_nchw": list(value.shape),
                "input_sha256": sha(data=nhwc.tobytes()), "roundtrip_exact": all(torch.equal(outputs[k], cloned[k]) for k in names),
                "outputs": {}, "passed": False}
        for index, key in enumerate(names):
            outputs[key].numpy().tofile(directory / f"pytorch-{index}.f32")
            case["outputs"][key] = {"shape": list(outputs[key].shape), "finite": bool(torch.isfinite(outputs[key]).all()), "passed": False}
        cases.append(case)
    native = run_oracle(out=out) if oracle else {"status": "not-run"}
    expanded_path = out / "native-expanded.private.bin"
    expansion_exact = expanded_path.exists() and expanded_path.read_bytes() == weights.astype("<f4").tobytes() + arena[-4:]
    native["fp16_expansion_exact"] = expansion_exact
    declared_path = out / "declared-input-shape.json"
    native["original_declared_input_nwhc"] = json.loads(declared_path.read_text()) if declared_path.exists() else None
    fp16_proof = verify_fp16(out=out) if native["status"] == "completed" else {"passed": False, "cases": []}
    for case in cases:
        directory = out / f"case-{case['case']}"
        try:
            expected, descriptors = read_native(directory=directory, names=names)
            echo = (directory / "native-input.f32").read_bytes()
            case["input_echo_exact"] = echo == (directory / "input.f32").read_bytes()
            n, c, h, w = case["input_shape_nchw"]
            if descriptors["data"]["dims_nwhc"] != [n, w, h, c]:
                raise ValueError("native input shape mismatch")
            for index, name in enumerate(names):
                shape = case["outputs"][name]["shape"]
                actual = torch.from_numpy(np.fromfile(directory / f"pytorch-{index}.f32", dtype="<f4").reshape(shape))
                case["outputs"][name].update(compare(actual=actual, expected=expected[name]))
            case["passed"] = (native["status"] == "completed" and case["roundtrip_exact"] and case["input_echo_exact"]
                              and all(case["outputs"][key]["passed"] for key in model.outputs))
            case["all_probed_tensors_passed"] = all(item["passed"] for item in case["outputs"].values())
            case["native_descriptors"] = descriptors
        except (OSError, ValueError) as error:
            case["reason"] = str(error)
    parity = (state_exact and expansion_exact and fp16_proof["passed"]
              and native["original_declared_input_nwhc"] == [1, 1, 1, 3]
              and bool(cases) and all(case["passed"] for case in cases))
    graph_report.update(inference_verified=parity,
                        graph_status="native-final-output-parity-passed" if parity else "native-unverified-or-failed")
    report = {"format": FORMAT, "source": str(SOURCE), "source_sha256": SOURCE_SHA256,
              "artifact": str(artifact), "artifact_sha256": artifact_sha, "artifact_bytes": artifact.stat().st_size,
              "status": "native-parity-passed" if parity else "verification-failed" if oracle else "native-unverified",
              "backend": "CPU float32 PyTorch versus forced bytenn_cpu",
              "scope": "complete detector graph with runtime ReInferShape; no preprocessing, boxes, alphabet or CTC",
              "original_graph_unchanged": False, "original_topology_unchanged": True,
              "graph_transform": "native CheckFp16AndConvertModel recipe: remove E-prefix, widen payload, retain stamp",
              "original_shape_nwhc": [1, 1, 1, 3],
              "original_shape_is_placeholder": True, "deployment_resolution_verified": False,
              "input_schema": {"data": {"dtype": "float32", "layout": "NCHW", "shape": [1, 3, "H", "W"],
                                         "constraints": "H/W multiples of 32, 32..2048; caller-normalized tensor"}},
              "output_schema": {name: {"dtype": "float32", "layout": "NCHW", "shape": [1, 2, "H/2", "W/2"]} for name in model.outputs},
              "runtime_sha256": RUNTIME_SHA256, "graph_recovery": graph_report,
              "weight_values": len(weights), "arena_bytes": len(arena), "arena_sha256": sha(data=arena),
              "arena_encoding": "little-endian float16 with pinned ARM64 four-lane subnormal XOR; final uint32 graph stamp",
              "parameter_roundtrip_exact": state_exact,
              "native": native, "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "cases": cases,
              "fp16_decoder_proof": fp16_proof,
              "all_declared_outputs_verified": parity, "holdouts_passed": any(c["holdout"] for c in cases) and all(c["passed"] for c in cases if c["holdout"])}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--oracle", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(out=args.out, quick=args.quick, trace=args.trace, oracle=args.oracle)
    print(json.dumps({k: v for k, v in report.items() if k != "cases"}, indent=2))
    return int(report["status"] == "verification-failed")


if __name__ == "__main__":
    raise SystemExit(main())
