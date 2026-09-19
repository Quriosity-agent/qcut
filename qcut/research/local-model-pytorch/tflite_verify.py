"""Export and compare actual QCut TFLite tensors against its native interpreter."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import torch

from tflite_schema import read_model
from tflite_torch import TFLiteTorch, load_model


def input_cases(*, videos: list[Path]):
    shape = (1, 256, 256, 3)
    yield "zeros", np.zeros(shape, dtype=np.float32)
    yield "ones", np.ones(shape, dtype=np.float32)
    yield "minus-ones", -np.ones(shape, dtype=np.float32)
    for seed in (19, 41, 83):
        yield f"uniform-{seed}", np.random.default_rng(seed).uniform(
            -1, 1, shape
        ).astype(np.float32)
    ramp = np.broadcast_to(
        np.linspace(-1, 1, 256, dtype=np.float32)[None, :, None, None], shape
    ).copy()
    yield "vertical-ramp", ramp
    impulse = np.zeros(shape, dtype=np.float32)
    impulse[0, 127, 129, 0] = 1
    yield "red-impulse", impulse
    for video_index, path in enumerate(videos):
        for second in (0, 2, 4):
            raw = subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-ss",
                    str(second),
                    "-i",
                    str(path),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=256:256:flags=bilinear",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "pipe:1",
                ],
                check=True,
                capture_output=True,
                timeout=30,
            ).stdout
            if len(raw) != 256 * 256 * 3:
                raise ValueError("Decoded frame byte size mismatch")
            # Explicit test preprocessing; not a claim of browser MediaPipe resize parity.
            value = (
                np.frombuffer(raw, dtype=np.uint8).reshape(shape).astype(np.float32)
                / 127.5
                - 1
            )
            yield f"video-{video_index}-second-{second}", value


def compare(
    *, expected: np.ndarray, actual: np.ndarray, atol: float = 1e-4, rtol: float = 1e-4
) -> dict:
    finite = bool(np.isfinite(actual).all() and np.isfinite(expected).all())
    if expected.shape != actual.shape:
        return {"passed": False, "shape_match": False, "finite": finite}
    delta = np.abs(expected.astype(np.float64) - actual.astype(np.float64))
    return {
        "passed": finite and bool(np.allclose(expected, actual, atol=atol, rtol=rtol)),
        "shape_match": True,
        "finite": finite,
        "max_abs": float(delta.max()),
        "mean_abs": float(delta.mean()),
        "atol": atol,
        "rtol": rtol,
        "argmax_agreement": float((expected.argmax(-1) == actual.argmax(-1)).mean()),
    }


def run(*, source: Path, out: Path, videos: list[Path]) -> dict:
    import tensorflow as tf

    private_root = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
    if not out.resolve().is_relative_to(private_root.resolve()):
        raise ValueError(
            "Generated model/tensors must stay beneath ignored .local/jianying-model-pytorch"
        )
    out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    bundle = read_model(path=source)
    model = TFLiteTorch(bundle=bundle).eval()
    torch.save(model.export_bundle(), out / "model.pt")
    restored = load_model(path=out / "model.pt")
    state_equal = all(
        torch.equal(value, restored.state_dict()[key])
        for key, value in model.state_dict().items()
    )
    interpreter = tf.lite.Interpreter(
        model_path=str(source),
        num_threads=1,
        experimental_preserve_all_tensors=True,
        experimental_op_resolver_type=tf.lite.experimental.OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES,
    )
    interpreter.allocate_tensors()
    report = {
        "source_sha256": bundle["source_sha256"],
        "source_bytes": bundle["source_bytes"],
        "format": bundle["format"],
        "format_version": bundle["version"],
        "tensorflow": tf.__version__,
        "torch": str(torch.__version__),
        "native_backend": "TFLite CPU BUILTIN_WITHOUT_DEFAULT_DELEGATES",
        "operator_count": len(bundle["operators"]),
        "operators": dict(Counter(op["type"] for op in bundle["operators"])),
        "tensor_count": len(bundle["tensors"]),
        "constant_scalars": sum(
            value.numel() for value in bundle["constants"].values()
        ),
        "state_dict_equal": state_equal,
        "cases": [],
        "videos": [str(path.resolve()) for path in videos],
        "scope": "same normalized NHWC tensor; not browser preprocessing/postprocessing or editor E2E",
    }
    report["metadata"] = bundle["metadata"]
    report["status"] = "running"
    if videos and bundle["metadata"].get("normalization") != {
        "mean": [127.5],
        "std": [127.5],
    }:
        raise ValueError("Video test normalization does not match this model")
    input_index, output_index = bundle["inputs"][0], bundle["outputs"][0]
    for case_index, (name, value) in enumerate(input_cases(videos=videos)):
        interpreter.set_tensor(input_index, value)
        started = time.perf_counter()
        interpreter.invoke()
        native_seconds = time.perf_counter() - started
        expected = interpreter.get_tensor(output_index)
        started = time.perf_counter()
        with torch.inference_mode():
            actual = restored(torch.from_numpy(value)).numpy()
            original = model(torch.from_numpy(value)).numpy()
        case = {
            "name": name,
            **compare(expected=expected, actual=actual),
            "roundtrip_equal": bool(np.array_equal(original, actual)),
            "native_seconds": native_seconds,
            "torch_two_forwards_seconds": time.perf_counter() - started,
        }
        # Preserve complete per-layer evidence for one random input, not only terminal masks.
        if name == "uniform-19":
            with torch.inference_mode():
                intermediate = restored(torch.from_numpy(value), capture=True)
            layers = []
            for operator in bundle["operators"]:
                index = operator["outputs"][0]
                target = interpreter.get_tensor(index)
                predicted = intermediate[index].numpy()
                layers.append(
                    {
                        "tensor": index,
                        "operator": operator["type"],
                        **compare(expected=target, actual=predicted),
                    }
                )
            case["layers"] = layers
            np.savez(
                out / "native-intermediates.npz",
                **{
                    str(op["outputs"][0]): interpreter.get_tensor(op["outputs"][0])
                    for op in bundle["operators"]
                },
            )
        np.savez(
            out / f"case-{case_index:02d}.npz",
            input=value,
            native=expected,
            pytorch=actual,
        )
        report["cases"].append(case)
        print(
            f"{name}: max_abs={case.get('max_abs')} passed={case['passed']}", flush=True
        )
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    report["status"] = (
        "native-parity-passed"
        if state_equal
        and all(case["passed"] and case["roundtrip_equal"] for case in report["cases"])
        else "native-parity-failed"
    )
    artifact = out / "model.pt"
    report["artifact"] = {
        "path": str(artifact.resolve()),
        "sha256": sha256(artifact.read_bytes()).hexdigest(),
        "bytes": artifact.stat().st_size,
    }
    report["licensing_boundary"] = (
        "Local conversion of existing QCut MediaPipe asset only. No derived weights, recovered graphs, reference frames or tensors may be committed/distributed by this task. Model redistribution rights are not established by changing its serialization format."
    )
    report["intermediate_diagnostics"] = (
        "Full-graph accumulated per-layer errors are diagnostic; final output tolerances remain fixed at 1e-4."
    )
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        type=Path,
        default=Path("apps/web/public/models/person-segmentation.tflite"),
    )
    parser.add_argument(
        "--out", type=Path, default=Path(".local/jianying-model-pytorch/tflite")
    )
    parser.add_argument("--video", type=Path, action="append", default=[])
    args = parser.parse_args()
    result = run(source=args.model, out=args.out, videos=args.video)
    raise SystemExit(0 if result["status"] == "native-parity-passed" else 1)
