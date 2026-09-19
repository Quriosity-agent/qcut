"""Replay frozen classifier cases with vendor access and child processes blocked."""
import argparse
import builtins
import importlib
import io
import json
import os
from pathlib import Path
import re
from unittest.mock import patch

import numpy as np
import torch

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


def private_path(*, path):
    value = path.resolve()
    if value == PRIVATE.resolve() or not value.is_relative_to(PRIVATE.resolve()):
        raise ValueError("standalone verification must stay under private ignored root")
    return value


def blocked(*args, **kwargs):
    raise RuntimeError("native library or child process forbidden in standalone check")


def guarded_open(*, original):
    def open_file(file, *args, **kwargs):
        if not isinstance(file, int) and ("PrivateRuntimes" in os.fsdecode(file) or "libbytenn" in os.fsdecode(file)):
            raise RuntimeError("vendor runtime asset access forbidden")
        return original(file, *args, **kwargs)
    return open_file


def verify(*, run, out):
    run, out = private_path(path=run), private_path(path=out)
    if out.exists() and any(out.iterdir()):
        raise ValueError("standalone report requires a fresh empty directory")
    out.mkdir(parents=True, exist_ok=True)
    report = json.loads((run / "report.json").read_text())
    # A failed native parity report still carries replayable frozen tensors;
    # replaying them must never turn into a standalone pass.
    if report.get("status") != "native-parity-passed":
        raise ValueError("standalone replay requires a native-parity-passed source report")
    if not report.get("cases") or not all(case.get("passed") is True for case in report["cases"]):
        raise ValueError("missing or failed frozen comparison cases")
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.startswith(("bytenn", "container_scan", "model_containers", "native_oracle")):
            raise RuntimeError("vendor helper imports forbidden")
        return original_import(name, *args, **kwargs)

    cases = []
    with patch("builtins.open", guarded_open(original=builtins.open)), patch("io.open", guarded_open(original=io.open)), \
            patch("os.open", guarded_open(original=os.open)), patch("ctypes.CDLL", blocked), \
            patch("subprocess.Popen", blocked), patch("builtins.__import__", guarded_import):
        converter = importlib.import_module("classifier_torch")
        artifact = private_path(path=Path(report["artifact"]))
        model = converter.load_model(path=artifact, expected_sha256=report["artifact_sha256"])
        state_exact = converter.state_digest(state=model.state_dict()) == report["state_sha256"]
        for case in report["cases"]:
            name = case["case"]
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]+", name):
                raise ValueError("invalid frozen case name")
            directory = run / f"case-{name}"
            values = np.load(directory / "input-nchw.npy", allow_pickle=False)
            if converter.digest(data=values.tobytes()) != case["input_sha256"]:
                raise ValueError("frozen input hash mismatch")
            with torch.inference_mode():
                outputs = model({"data": torch.from_numpy(values)})
            exact = all(torch.equal(value, torch.from_numpy(np.load(directory / f"pytorch-{key}.npy", allow_pickle=False)))
                        for key, value in outputs.items())
            cases.append({"case": name, "all_outputs_forward_exact": exact, "passed": exact})
    result = {"status": "standalone-replay-passed" if state_exact and all(case["passed"] for case in cases) else "verification-failed",
              "artifact": str(artifact), "artifact_sha256": report["artifact_sha256"], "source_sha256": report["source_sha256"],
              "state_content_exact": state_exact, "weights_only": True,
              "blocked": ["vendor file reads", "vendor helper imports", "ctypes.CDLL", "subprocess.Popen"],
              "scope": "CPU float32 .pt inference without vendor runtime; frozen exact forward replay", "cases": cases}
    (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = verify(run=args.run, out=args.out)
    print(json.dumps({key: report[key] for key in ("status", "artifact_sha256", "state_content_exact")}, indent=2))
    return int(report["status"] != "standalone-replay-passed")


if __name__ == "__main__":
    raise SystemExit(main())
