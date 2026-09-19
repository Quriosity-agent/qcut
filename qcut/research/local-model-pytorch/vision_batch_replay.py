"""Fresh-process full-case replay with private-source and Python-network guards."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def file_hash(*, path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def worker(*, job_path, out):
    job = json.loads(job_path.read_text())
    model_path = Path(job["model"]).resolve()
    out = out.resolve()
    allowed = {model_path, *(Path(case["input"]).resolve() for case in job["cases"])}
    from portable_smoke import denied_access
    blocked = []

    def audit(event, args):
        reason = denied_access(event=event, args=args, allowed=allowed, output=out)
        if reason:
            blocked.append({"event": event, "reason": reason})
            raise PermissionError(reason)

    sys.addaudithook(audit)
    result = {"passed": False, "blocked": blocked, "cases": [],
              "guard_scope": "Python audit events; not an OS sandbox or cross-platform proof"}
    try:
        import numpy as np
        import torch
        from vision_batch_torch import load_model
        torch.set_num_threads(2)
        model = load_model(path=model_path, expected_sha256=job["model_sha256"])
        for index, case in enumerate(job["cases"]):
            source = Path(case["input"])
            if file_hash(path=source) != case["input_sha256"]:
                raise ValueError("replay input hash changed")
            with np.load(source, allow_pickle=False) as archive:
                values = {k: torch.from_numpy(archive[k].copy()) for k in archive.files}
            with torch.inference_mode():
                actual = model(values)
            target = out / f"output-{index:03d}.npz"
            np.savez(target, **{k: v.numpy() for k, v in actual.items()})
            result["cases"].append({"case": case["case"], "output": str(target), "sha256": file_hash(path=target)})
        result["passed"] = not blocked and len(result["cases"]) == len(job["cases"])
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    (out / "worker-report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return 0 if result["passed"] else 1


def run_batch(*, reports, out):
    import numpy as np
    import torch
    from classifier_export import compare_outputs
    from vision_batch_export import fresh_directory
    out = fresh_directory(path=out)
    records = []
    for index, path in enumerate(reports):
        source_report = json.loads(path.read_text())
        if source_report["status"] != "native-parity-passed" or not source_report["cases"] or not all(c["passed"] for c in source_report["cases"]):
            raise ValueError("only native-verified full reports may enter delivery replay")
        model = Path(source_report["artifact"])
        if file_hash(path=model) != source_report["artifact_sha256"]:
            raise ValueError("model no longer matches native report")
        job = {"model": str(model), "model_sha256": source_report["artifact_sha256"], "cases": []}
        for case in source_report["cases"]:
            inputs = Path(case["input_npz"])
            job["cases"].append({"case": case["case"], "input": str(inputs), "input_sha256": file_hash(path=inputs)})
        directory = out / f"job-{index:02d}"
        directory.mkdir()
        job_path = directory / "job.json"
        job_path.write_text(json.dumps(job, indent=2) + "\n")
        record = {"profile": source_report["profile"], "source_report": str(path.resolve()),
                  "source_report_sha256": file_hash(path=path), "artifact": str(model),
                  "artifact_sha256": job["model_sha256"], "passed": False, "comparisons": []}
        try:
            with (directory / "worker.log").open("w") as log:
                process = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", str(job_path), "--out", str(directory)],
                                         cwd=directory, stdout=log, stderr=subprocess.STDOUT, timeout=300)
            result = json.loads((directory / "worker-report.json").read_text())
            record.update(worker=result, returncode=process.returncode)
            if result["passed"] and process.returncode == 0 and len(result["cases"]) == len(job["cases"]):
                for item, case in zip(result["cases"], job["cases"], strict=True):
                    if item["case"] != case["case"] or file_hash(path=item["output"]) != item["sha256"]:
                        raise ValueError("worker output identity mismatch")
                    with np.load(item["output"], allow_pickle=False) as archive:
                        actual = {k: torch.from_numpy(archive[k].copy()) for k in archive.files}
                    case_path = Path(case["input"]).parent
                    with np.load(case_path / "pytorch.npz", allow_pickle=False) as archive:
                        exact = set(archive.files) == set(actual) and all(np.array_equal(archive[k], actual[k].numpy()) for k in archive.files)
                    with np.load(case_path / "native.npz", allow_pickle=False) as archive:
                        expected = {k: torch.from_numpy(archive[k].copy()) for k in archive.files}
                    comparison = compare_outputs(expected=expected, actual=actual)
                    comparison.update(case=case["case"], pytorch_replay_exact=exact)
                    comparison["passed"] = comparison["passed"] and exact
                    record["comparisons"].append(comparison)
                record["passed"] = all(c["passed"] for c in record["comparisons"])
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            record["error"] = str(error)
        records.append(record)
        print(json.dumps({"profile": record["profile"], "passed": record["passed"], "cases": len(record["comparisons"])}), flush=True)
        (out / "report.json").write_text(json.dumps({"passed": all(r["passed"] for r in records), "models": records}, indent=2, allow_nan=False) + "\n")
    passed = all(r["passed"] for r in records)
    if passed:
        handoff = []
        for path in reports:
            source = json.loads(path.read_text())
            handoff.append({"profile": source["profile"], "report": str(path.resolve()),
                            "artifact": source["artifact"], "artifact_sha256": source["artifact_sha256"],
                            "source_sha256": source["source_sha256"], "schema": source["schema"],
                            "loader": "vision_batch_torch.load_model(path=..., expected_sha256=...)",
                            "format": source["format"], "onnx_verified_by_this_worker": False,
                            "cases": [{"case": case["case"], "input": case["input_npz"],
                                       "native_output": str(Path(case["input_npz"]).with_name("native.npz")),
                                       "pytorch_output": str(Path(case["input_npz"]).with_name("pytorch.npz"))}
                                      for case in source["cases"]]})
        (out / "handoff.json").write_text(json.dumps(handoff, indent=2, allow_nan=False) + "\n")
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--report", type=Path, action="append")
    group.add_argument("--worker", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.worker:
        return worker(job_path=args.worker, out=args.out)
    return 0 if run_batch(reports=args.report, out=args.out) else 1


if __name__ == "__main__":
    raise SystemExit(main())
