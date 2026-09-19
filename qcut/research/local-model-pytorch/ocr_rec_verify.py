"""Replay every recognizer fixture in a fresh process with vendor access blocked."""
import argparse
import builtins
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import platform
import re
import time
from unittest.mock import patch

import numpy as np
import torch

from classifier_verify import blocked, guarded_open, private_path


def verify(*, run, out):
    run, out = private_path(path=run), private_path(path=out)
    if out.exists() and any(out.iterdir()):
        raise ValueError("recognizer replay requires a fresh empty directory")
    out.mkdir(parents=True, exist_ok=True)
    report_path = run / "report.json"
    report = json.loads(report_path.read_text())
    if report.get("status") != "native-parity-passed" or not report.get("cases"):
        raise ValueError("only a complete passing native report can be replayed")
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.startswith(("bytenn", "container_scan", "model_containers", "native_oracle")):
            raise RuntimeError("vendor oracle imports forbidden")
        return original_import(name, *args, **kwargs)

    cases = []
    with patch("builtins.open", guarded_open(original=builtins.open)), patch("io.open", guarded_open(original=io.open)), \
            patch("os.open", guarded_open(original=os.open)), patch("ctypes.CDLL", blocked), \
            patch("subprocess.Popen", blocked), patch("socket.socket.connect", blocked), \
            patch("builtins.__import__", guarded_import):
        converter = importlib.import_module("ocr_rec_torch")
        model = converter.load_validated_model(path=private_path(path=Path(report["artifact"])),
                                               expected_sha256=report["artifact_sha256"])
        state_exact = converter.state_digest(state=model.state_dict()) == converter.STATE_SHA256
        for case in report["cases"]:
            name = case["case"]
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]+", name):
                raise ValueError("invalid recognizer fixture name")
            directory = run / f"case-{name}"
            with np.load(directory / "inputs.npz", allow_pickle=False) as data:
                inputs = {key: torch.from_numpy(data[key].copy()) for key in data.files}
            nhwc = inputs["data"].numpy().transpose(0, 2, 3, 1).copy()
            if hashlib.sha256(nhwc.tobytes()).hexdigest() != case["input_sha256"]:
                raise ValueError("frozen recognizer input content hash differs")
            started = time.perf_counter()
            with torch.inference_mode():
                outputs = model(inputs)
            elapsed = time.perf_counter() - started
            with np.load(directory / "pytorch-outputs.npz", allow_pickle=False) as data:
                exact = set(data.files) == set(outputs) and all(np.array_equal(value.numpy(), data[key]) for key, value in outputs.items())
            native_results = {}
            with np.load(directory / "native-outputs.npz", allow_pickle=False) as data:
                if set(data.files) != set(outputs):
                    raise ValueError("native frozen output set differs")
                for key, actual in outputs.items():
                    expected = torch.from_numpy(data[key])
                    if actual.shape != expected.shape or not torch.isfinite(expected).all():
                        raise ValueError("native frozen shape or finite check failed")
                    delta = (actual.double() - expected.double()).abs()
                    native_results[key] = {"passed": bool((delta <= 1e-4 + 1e-4 * expected.double().abs()).all()),
                                           "max_abs": float(delta.max()), "mae": float(delta.mean())}
            destination = out / f"case-{name}"
            destination.mkdir()
            np.savez(destination / "outputs.npz", **{key: value.numpy() for key, value in outputs.items()})
            cases.append({"case": name, "all_outputs_replay_exact": exact, "seconds": elapsed,
                           "native": native_results, "passed": exact and all(item["passed"] for item in native_results.values())})
    passed = state_exact and bool(cases) and all(case["passed"] for case in cases)
    result = {"status": "standalone-replay-passed" if passed else "verification-failed", "cases": cases,
              "artifact": report["artifact"], "artifact_sha256": report["artifact_sha256"], "source_sha256": report["source_sha256"],
              "source_report_sha256": hashlib.sha256(report_path.read_bytes()).hexdigest(),
              "scope": "fresh Python process; mocked Python file/dlopen/network/process guards, not OS isolation",
              "blocked": ["vendor file reads", "oracle helper imports", "ctypes.CDLL", "subprocess.Popen", "socket.connect"],
              "state_content_exact": state_exact, "weights_only": True, "platform": platform.platform(),
              "python": platform.python_version(), "torch": torch.__version__, "cpu_threads": torch.get_num_threads(),
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threads", type=int, choices=(1, 2, 4), default=2)
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    report = verify(run=args.run, out=args.out)
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]), "state_content_exact": report["state_content_exact"]}))
    return int(report["status"] != "standalone-replay-passed")


if __name__ == "__main__":
    raise SystemExit(main())
