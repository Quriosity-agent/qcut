"""Actual-bundle negative checks and active source-access probes for bandou delivery."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import torch

from bandou_phase5_torch import load_model
from bytenn_oracle import LIBRARY, sha256
from vision_batch_export import fresh_directory
from vision_batch_torch import load_model as load_old, state_digest


def audit(*, delivery, old_report, out):
    out = fresh_directory(path=out)
    approved = json.loads(delivery.read_text())
    previous = json.loads(old_report.read_text())
    before = {str(path): sha256(path=path) for path in (delivery, old_report, Path(approved["artifact"]), Path(previous["artifact"]))}
    records = []
    restored = load_model(path=approved["artifact"], expected_sha256=approved["artifact_sha256"])
    records.append({"case": "validated-new-bundle", "passed": state_digest(state=restored.state_dict()) == approved["state_sha256"]})

    def rejected(*, name, path, loader=load_model, **options):
        record = {"case": name, "artifact_sha256": sha256(path=path), "passed": False}
        try:
            loader(path=path, **options)
        except ValueError as error:
            record.update(passed=True, reason=str(error))
        records.append(record)

    rejected(name="historical-default-still-disabled", path=previous["artifact"], loader=load_old)
    rejected(name="new-loader-rejects-historical-format", path=previous["artifact"])
    rejected(name="old-loader-rejects-new-format", path=approved["artifact"], loader=load_old)
    rejected(name="wrong-artifact-hash", path=approved["artifact"], expected_sha256="0" * 64)
    baseline = torch.load(approved["artifact"], weights_only=True, map_location="cpu")
    with tempfile.TemporaryDirectory(prefix="transient-negative-", dir=out) as directory:
        target = Path(directory) / "mutation.pt"
        for key in ("source_sha256", "bm_sha256", "graph_sha256", "runtime_sha256", "execution_profile", "native_report_sha256",
                    "verification_status", "profile", "format", "local_only"):
            bundle = {**baseline, key: "forged"}
            torch.save(bundle, target)
            rejected(name=f"mutation-{key}", path=target)
        bundle = {**baseline, "state_dict": {key: value.clone() for key, value in baseline["state_dict"].items()}}
        first = next(iter(bundle["state_dict"].values()))
        first.reshape(-1)[0] += 1
        bundle["state_sha256"] = state_digest(state=bundle["state_dict"])
        torch.save(bundle, target)
        rejected(name="rehashed-weight-forgery", path=target)
        bundle = torch.load(previous["artifact"], weights_only=True, map_location="cpu")
        bundle["verification_status"] = "native-parity-passed"
        torch.save(bundle, target)
        rejected(name="historical-status-forgery-still-disabled", path=target, loader=load_old)
    guard_out = out / "guard"
    guard_out.mkdir()
    source_directory = Path(approved["native_report"]).parent
    job = {"model": approved["artifact"], "input": approved["cases"][0]["input_npz"], "source": approved["source"],
           "graph": str(source_directory / "graph.private.txt"), "arena": str(source_directory / "arena.private.bin"), "library": str(LIBRARY)}
    job_path = out / "guard-job.json"
    job_path.write_text(json.dumps(job, indent=2) + "\n")
    with (out / "guard.log").open("w") as log:
        process = subprocess.run([sys.executable, str(Path(__file__).with_name("vision_batch_audit.py")),
                                  "--guard-worker", str(job_path), "--out", str(guard_out)],
                                 stdout=log, stderr=subprocess.STDOUT, timeout=30)
    guard = json.loads((guard_out / "guard-report.json").read_text())
    stable = all(sha256(path=path) == expected for path, expected in before.items())
    passed = stable and all(item["passed"] for item in records) and guard["passed"] and process.returncode == 0
    result = {"passed": passed, "checks": records, "guard": guard, "input_history_unchanged": stable,
              "evidence_sha256": before, "scope": "actual artifacts, temporary mutated copies and Python audit probes; not an OS sandbox",
              "temporary_mutations": "removed after recording hashes and refusal reasons; original artifacts preserved"}
    (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"passed": passed, "loader_checks": len(records), "guard_checks": len(guard["checks"])}))
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivery", type=Path, required=True)
    parser.add_argument("--old-report", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    return 0 if audit(delivery=args.delivery, old_report=args.old_report, out=args.out) else 1


if __name__ == "__main__":
    raise SystemExit(main())
