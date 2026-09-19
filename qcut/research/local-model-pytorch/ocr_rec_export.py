"""Private fixed-shape OCR logits with complete native output comparisons."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from container_scan import decode_graph, runtime_graph_table
from model_containers import bytenn_sections
from ocr_export import LIBRARY, RUNTIMES, compare, fresh_directory, parity_status, read_native, run_oracle, sha, verify_fp16
from ocr_rec_torch import (EXECUTION_PROFILE, VALIDATED_FORMAT, GRAPH_SHA256, INPUT_SHAPE,
                          SOURCE_SHA256, OCRRecognizer, load_validated_model, parse_graph)
from ocr_torch import RUNTIME_SHA256, decode_arena
from ocr_rec_cases import build_cases

SOURCE = RUNTIMES / "JianyingFilter/current/Models/general_ocr_rec_fp16_v2.4_size0_md57699202ce3514ac281c76ed49bf93814.model"


def export(*, out, quick, trace, oracle, selected_cases=None):
    out = fresh_directory(path=out)
    if sha(data=LIBRARY.read_bytes()) != RUNTIME_SHA256:
        raise ValueError("recognizer oracle runtime hash mismatch")
    data = SOURCE.read_bytes()
    if sha(data=data) != SOURCE_SHA256:
        raise ValueError("recognizer source hash mismatch")
    graph, graph_report = decode_graph(data=data, offset=0, table=runtime_graph_table(path=LIBRARY))
    if sha(data=graph.encode()) != GRAPH_SHA256:
        raise ValueError("recognizer graph hash mismatch")
    nodes = parse_graph(text=graph)
    template = OCRRecognizer(nodes=nodes, execution_profile=EXECUTION_PROFILE)
    section = bytenn_sections(data=data, offset=0)["sections"][1]
    arena = data[section["offset"]:section["offset"] + section["bytes"]]
    weights = decode_arena(arena=arena, count=template.parameter_count)
    stamp = int(graph.splitlines()[1].removesuffix("\\n").split()[2])
    if int.from_bytes(arena[-4:], "little") != stamp:
        raise ValueError("recognizer stamp mismatch")
    (out / "graph.private.txt").write_text(graph)
    (out / "weights.private.bin").write_bytes(arena)
    (out / "keep-original-shape").write_text("No ReInferShape; verify original 32x512 input descriptor.\n")
    model = OCRRecognizer(nodes=nodes, weights=weights, execution_profile=EXECUTION_PROFILE).eval()
    artifact = out / "ocr-recognizer-logits.pt"
    torch.save({"format": VALIDATED_FORMAT, "execution_profile": EXECUTION_PROFILE,
                "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
                "local_only": True, "graph": graph, "state_dict": model.state_dict()}, artifact)
    artifact_sha = sha(data=artifact.read_bytes())
    clone = load_validated_model(path=artifact, expected_sha256=artifact_sha)
    state_exact = all(torch.equal(value, clone.state_dict()[name]) for name, value in model.state_dict().items())
    names = [step["output"] for step in model.steps[1:]] if trace else model.outputs
    (out / "outputs.txt").write_text("\n".join(names) + "\n")
    cases = []
    fixtures, metadata = build_cases(quick=quick, out=out)
    if selected_cases is not None:
        if not selected_cases or not set(selected_cases) <= fixtures.keys():
            raise ValueError("unknown recognizer cases")
        fixtures = {key: value for key, value in fixtures.items() if key in selected_cases}
    for name, values in fixtures.items():
        directory = out / f"case-{name}"
        directory.mkdir()
        nhwc = values.transpose(0, 2, 3, 1).copy()
        nhwc.tofile(directory / "input.f32")
        np.savez(directory / "inputs.npz", **{model.input_name: values})
        (directory / "shape.txt").write_text("32 512\n")
        with torch.inference_mode():
            outputs = model({model.input_name: torch.from_numpy(values)}, trace=trace)
            restored = clone({model.input_name: torch.from_numpy(values)}, trace=trace)
        case = {"case": name, "holdout": "holdout" in name, "input_shape_nchw": list(INPUT_SHAPE),
                "fixture": metadata.get(name), "input_npz": str(directory / "inputs.npz"),
                "input_sha256": sha(data=nhwc.tobytes()), "roundtrip_exact": all(torch.equal(outputs[k], restored[k]) for k in names),
                "outputs": {}, "passed": False}
        for index, key in enumerate(names):
            outputs[key].numpy().tofile(directory / f"pytorch-{index}.f32")
            case["outputs"][key] = {"shape": list(outputs[key].shape), "finite": bool(torch.isfinite(outputs[key]).all()), "passed": False}
        np.savez(directory / "pytorch-outputs.npz", **{key: outputs[key].numpy() for key in model.outputs})
        cases.append(case)
    native = run_oracle(out=out) if oracle else {"status": "not-run"}
    expanded = out / "native-expanded.private.bin"
    native["fp16_expansion_exact"] = expanded.exists() and expanded.read_bytes() == weights.astype("<f4").tobytes() + arena[-4:]
    fp16 = verify_fp16(out=out) if native["status"] == "completed" else {"passed": False, "cases": []}
    for case in cases:
        directory = out / f"case-{case['case']}"
        try:
            expected, descriptors = read_native(directory=directory, names=names)
            np.savez(directory / "native-outputs.npz", **{key: expected[key].numpy() for key in model.outputs})
            case["native_descriptors"] = descriptors
            case["input_echo_exact"] = (directory / "input.f32").read_bytes() == (directory / "native-input.f32").read_bytes()
            if descriptors["data"]["dims_nwhc"] != [1, 512, 32, 3]:
                raise ValueError("original input shape mismatch")
            for index, name in enumerate(names):
                shape = case["outputs"][name]["shape"]
                actual = torch.from_numpy(np.fromfile(directory / f"pytorch-{index}.f32", dtype="<f4").reshape(shape))
                case["outputs"][name].update(compare(actual=actual, expected=expected[name]))
            case["passed"] = (native["status"] == "completed" and case["input_echo_exact"] and case["roundtrip_exact"]
                              and all(case["outputs"][key]["passed"] for key in model.outputs))
            case["all_probed_tensors_passed"] = all(item["passed"] for item in case["outputs"].values())
        except (OSError, ValueError) as error:
            case["reason"] = str(error)
    passed = state_exact and fp16["passed"] and native["fp16_expansion_exact"] and bool(cases) and all(case["passed"] for case in cases)
    # --quick and --case runs are evidence for the selected cases only.
    complete = not quick and selected_cases is None
    report = {"format": VALIDATED_FORMAT, "execution_profile": EXECUTION_PROFILE,
              "source": str(SOURCE), "source_sha256": SOURCE_SHA256,
              "artifact": str(artifact), "artifact_sha256": artifact_sha, "artifact_bytes": artifact.stat().st_size,
              "status": parity_status(parity=passed, oracle=oracle, complete=complete),
              "case_set": "complete" if complete else "partial",
              "backend": "CPU float32 PyTorch versus forced bytenn_cpu", "runtime_sha256": RUNTIME_SHA256,
              "scope": "complete 269-layer raw logits only; alphabet/CTC/preprocessing NOT verified",
              "original_topology_unchanged": True,
              "original_graph_unchanged": False,
              "graph_transform": "native CheckFp16AndConvertModel recipe: remove E, expand pinned half, retain stamp",
              "recognition_verified": False, "native_graph_input_resized": False, "original_input_shape": list(INPUT_SHAPE),
              "input_schema": {model.input_name: {"shape": list(INPUT_SHAPE), "layout": "NCHW", "dtype": "float32"}},
              "output_schema": {key: {"shape": cases[0]["outputs"][key]["shape"], "layout": "NCHW", "dtype": "float32"} for key in model.outputs},
              "graph_recovery": graph_report, "weight_values": len(weights), "parameter_roundtrip_exact": state_exact,
              "native": native, "fp16_decoder_proof": fp16, "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "cases": cases,
              "holdouts_passed": any(c["holdout"] for c in cases) and all(c["passed"] for c in cases if c["holdout"]),
              "all_declared_outputs_verified": passed and complete}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("--case", action="append", dest="selected_cases")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(out=args.out, quick=args.quick, trace=args.trace, oracle=args.oracle, selected_cases=args.selected_cases)
    print(json.dumps({key: report[key] for key in ("status", "artifact", "artifact_sha256", "native", "output_schema")}, indent=2))
    return int(report["status"] == "verification-failed")


if __name__ == "__main__":
    raise SystemExit(main())
