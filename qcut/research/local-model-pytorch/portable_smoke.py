"""Re-run exported bundles in fresh Python processes with instrumented asset/network guards."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"


def denied_access(*, event, args, allowed, output):
    if event in {"socket.connect", "socket.connect_ex", "socket.bind"}:
        return "network access"
    if event not in {"open", "ctypes.dlopen"} or not args or not isinstance(args[0], (str, bytes, os.PathLike)):
        return None
    path = Path(os.fsdecode(args[0])).resolve()
    if path in allowed or path.is_relative_to(output):
        return None
    vendor = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"
    raw_formats = {".bytenn", ".model", ".tflite", ".mlmodel", ".mlmodelc", ".onnx"}
    if path.is_relative_to(vendor) or path.is_relative_to(ROOT / ".local") or path.suffix in raw_formats:
        return f"non-bundle model asset: {path}"
    return None


def worker(*, job_path, out):
    job = json.loads(job_path.read_text())
    model, inputs = Path(job["model"]).resolve(), Path(job["input"]).resolve()
    out = out.resolve()
    allowed = {model, inputs}
    blocked = []

    def audit(event, args):
        reason = denied_access(event=event, args=args, allowed=allowed, output=out)
        if reason:
            blocked.append({"event": event, "reason": reason})
            raise PermissionError(reason)

    sys.addaudithook(audit)
    result = {"model": str(model), "input": str(inputs), "passed": False,
              "guard_scope": "Python audit events only; not an OS-level sandbox", "blocked": blocked}
    try:
        import torch
        from espresso_archive import sha256
        from infer import run_inference
        torch.set_num_threads(2)
        if sha256(path=model) != job["model_sha256"] or sha256(path=inputs) != job["input_sha256"]:
            raise ValueError("smoke input or artifact hash changed")
        report = run_inference(model_path=model, input_path=inputs, output_path=out / "output.npz", network=job.get("network"))
        result.update(passed=not blocked, inference=report)
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    (out / "worker-report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return 0 if result["passed"] else 1


def run_batch(*, manifest, out, timeout=180):
    from espresso_archive import sha256
    out = out.resolve()
    if out == PRIVATE.resolve() or not out.is_relative_to(PRIVATE.resolve()):
        raise ValueError("portable smoke outputs must remain private")
    if out.exists() and any(out.iterdir()):
        raise ValueError("fresh smoke output directory required")
    jobs = json.loads(manifest.read_text())
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 128:
        raise ValueError("smoke manifest requires 1 through 128 jobs")
    prepared = []
    for job in jobs:
        model, inputs = Path(job["model"]).resolve(), Path(job["input"]).resolve()
        if model.suffix != ".pt" or inputs.suffix != ".npz":
            raise ValueError("smoke jobs require .pt and .npz")
        network = job.get("network")
        if network is not None and (not isinstance(network, str) or not network):
            raise ValueError("network must be a nonempty name when provided")
        prepared.append({"model": str(model), "input": str(inputs),
                         "model_sha256": sha256(path=model), "input_sha256": sha256(path=inputs), "network": network})
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for index, job in enumerate(prepared):
        directory = out / f"job-{index:03d}"
        directory.mkdir()
        job_path = directory / "job.json"
        job_path.write_text(json.dumps(job, indent=2) + "\n")
        result = {**job, "passed": False}
        try:
            with (directory / "worker.log").open("w") as log:
                process = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", str(job_path), "--out", str(directory)],
                                         cwd=directory, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            if (directory / "worker-report.json").is_file():
                result.update(json.loads((directory / "worker-report.json").read_text()))
            result["returncode"] = process.returncode
            result["passed"] = result["passed"] is True and process.returncode == 0
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result.update(passed=False, error=str(error))
        result["evidence"] = str(directory)
        results.append(result)
    report = {"format": "qcut-private-portable-smoke", "passed": all(job["passed"] for job in results),
              "jobs": results, "guard_scope": "Python audit events, not a complete OS isolation or cross-platform test"}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--manifest", type=Path)
    group.add_argument("--worker", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.worker:
        return worker(job_path=args.worker, out=args.out)
    report = run_batch(manifest=args.manifest, out=args.out)
    print(json.dumps({"passed": report["passed"], "jobs": len(report["jobs"])}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
