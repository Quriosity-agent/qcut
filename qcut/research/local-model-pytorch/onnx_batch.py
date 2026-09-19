"""Sequential bounded export jobs with durable failures and no placeholder success."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from onnx_infer import digest

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


def run_batch(*, manifest, out, timeout=300):
    out = out.resolve()
    if out == PRIVATE.resolve() or not out.is_relative_to(PRIVATE.resolve()):
        raise ValueError("batch outputs must remain private")
    jobs = json.loads(manifest.read_text())
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 128:
        raise ValueError("bounded export manifest required")
    for job in jobs:
        if (not isinstance(job, dict) or any(not isinstance(job.get(key), str) or not job[key] for key in ("name", "model", "input"))
                or ("network" in job and (not isinstance(job["network"], str) or not job["network"]))):
            raise ValueError("each job requires name, model, input and an optional nonempty network")
    if type(timeout) not in (int, float) or not 0 < timeout <= 3600:
        raise ValueError("timeout must be positive and at most one hour")
    names = [job.get("name") for job in jobs]
    if any(not isinstance(name, str) or not re.fullmatch(r"[a-z0-9-]{1,64}", name) for name in names) or len(set(names)) != len(names):
        raise ValueError("unique safe export names required")
    if any((out / name).exists() for name in names):
        raise ValueError("each export needs a fresh output directory")
    logs = out / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    results = []
    for job in jobs:
        directory = out / job["name"]
        command = [sys.executable, str(Path(__file__).with_name("onnx_export.py")), "--model", job["model"],
                   "--input", job["input"], "--out", str(directory)]
        if job.get("network"):
            command.extend(["--network", job["network"]])
        result = {"name": job["name"], "status": "export-failed", "report": str(directory / "report.json")}
        try:
            with (logs / f"{job['name']}.log").open("x") as log:
                process = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            result["returncode"] = process.returncode
            if (directory / "report.json").is_file():
                result.update(json.loads((directory / "report.json").read_text()))
            result["passed"] = process.returncode == 0 and result["status"] == "onnx-runtime-parity-passed"
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result.update(passed=False, error=str(error))
        results.append(result)
        print(json.dumps({key: result.get(key) for key in ("name", "status", "passed", "error")}), flush=True)
        complete = len(results) == len(jobs)
        (out / f"batch-{manifest.stem}-report.json").write_text(json.dumps({"manifest_sha256": digest(path=manifest), "jobs": results,
                    "expected_jobs": len(jobs), "complete": complete,
                    "passed": complete and all(item["passed"] for item in results)}, indent=2) + "\n")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    return int(not all(item["passed"] for item in run_batch(manifest=args.manifest, out=args.out)))


if __name__ == "__main__":
    raise SystemExit(main())
