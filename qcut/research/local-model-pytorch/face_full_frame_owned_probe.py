"""Run the source-original research input chain through CPU ONNX; never render."""
import argparse
import json
from pathlib import Path

from face_alignment_replay import LockedFiles
from face_full_frame_owned_inputs import build_inputs
import face_preprocess_chain_capture as capture
import face_render_model_parity as parity
from face_render_stability_probe import digest

SOURCE_NAMES = ("face_full_frame_owned.py", "face_full_frame_owned_inputs.py", "face_full_frame_owned_probe.py",
                "face_full_frame_quantization.py", "face_full_frame_quantization_probe.py",
                "face_preprocess_chain_inputs.py", "face_preprocess_replay.py",
                "face_alignment_sampling.py", "face_host_sampling_inputs.py", "face_preprocess_chain_capture.py")


def model_input_proof(*, model, inputs, seeds):
    for size, values in ((120, inputs), (160, seeds)):
        if model.get(f"independent_{size}_sampling_input_used") is not True:
            raise ValueError("ONNX did not consume both owned input maps")
        cases = model["model_outputs"][str(size)]["cases"]
        if (type(values) is not dict or not values or not isinstance(cases, list) or not cases or
                any(not isinstance(case, dict) or type(case.get("inference")) is not int or
                    not 0 <= case["inference"] <= 128 for case in cases)):
            raise ValueError("nonempty typed bounded ONNX inference coverage required")
        expected = {(size, case["inference"]) for case in cases}
        if len(cases) != len(values) or expected != set(values):
            raise ValueError("ONNX inference coverage differs from owned input maps")
        for case in cases:
            if (case.get("input_source") != "replacement_inputs" or case.get("passed") is not True or
                    case.get("replacement_input_sha256") != digest(data=values[(size, case["inference"])].tobytes())):
                raise ValueError("ONNX input identity differs from original-pixel producer")


def run(*, capture_root, model_root, out):
    out = out.absolute()
    if out.parent.resolve(strict=True) != out.parent:
        raise ValueError("non-symlink output parent required")
    out.mkdir(exist_ok=False)
    locked = LockedFiles()
    report = dict(profile="original-rgba-owned-preprocess-onnx-v1", passed=False, completed=False,
                  cpu_only=True, original_rgba_input_used=False, captured_tensor_input_used=False,
                  native_algorithm_rgba_input_used=False, native_algorithm_rgba_oracle_required=True,
                  independent_full_frame_preprocessing=False, independent_120_sampling_input_used=False,
                  independent_160_sampling_input_used=False, native_caller_parameters_required=True,
                  native_inference_called=False, native_render_performed=False, full_render_verified=False,
                  arbitrary_frame_backend_connected=False, product_parity_verified=False, failures=[])
    try:
        for name in SOURCE_NAMES:
            locked.read(path=Path(__file__).with_name(name), maximum=1024**2)
        report["source_sha256"] = dict(locked.files)
        root = capture_root.resolve(strict=True)
        context = capture.load(root=root, locked=locked)
        report.update(capture=str(root), capture_sha256=locked.files[str(root / "report.json")])
        inputs, seeds, report["preprocessing"] = build_inputs(context=context, locked=locked)
        model = parity.run(args=argparse.Namespace(capture=root, root=model_root, out=out / "onnx"),
                           replacement_inputs=inputs, initialization_inputs=seeds, expected_comparisons=7)
        if model.get("passed") is not True or model.get("capture_sha256") != report["capture_sha256"]:
            raise ValueError("ONNX execution failed or capture identity differs")
        model_input_proof(model=model, inputs=inputs, seeds=seeds)
        if locked.json(path=out / "onnx/report.json") != model:
            raise ValueError("saved ONNX execution report differs")
        report.update(model_report_sha256=locked.files[str(out / "onnx/report.json")],
                      head_comparisons=model["head_comparisons"],
                      onnx_inputs={size: model["model_outputs"][size]["successful_inferences"] for size in ("120", "160")})
        locked.verify()
        report.update(passed=True, completed=True, original_rgba_input_used=True,
                      independent_full_frame_preprocessing=True, independent_120_sampling_input_used=True,
                      independent_160_sampling_input_used=True)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        report["fixture_sha256"] = dict(locked.files)
        with (out / "report.json").open("x") as stream:
            stream.write(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "root", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    args = parser.parse_args()
    report = run(capture_root=args.capture, model_root=args.root, out=args.out)
    print(json.dumps({key: report[key] for key in ("passed", "head_comparisons", "onnx_inputs", "full_render_verified")}))


if __name__ == "__main__":
    main()
