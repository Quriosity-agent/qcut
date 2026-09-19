"""Audit candidate refusal, pinned provenance, and live source-access guards."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import sysconfig


def guard_worker(*, job_path, out):
    job = json.loads(job_path.read_text())
    model, fixture = Path(job["model"]).resolve(), Path(job["input"]).resolve()
    from portable_smoke import denied_access
    from vision_batch_replay import dependency_read
    dependencies = {Path(sysconfig.get_path(key)).resolve() for key in ("purelib", "platlib")}
    import ctypes
    import socket
    events = []

    def audit(event, args):
        reason = denied_access(event=event, args=args, allowed={model, fixture}, output=out.resolve())
        if reason and not dependency_read(event=event, args=args, roots=dependencies):
            events.append({"event": event, "reason": reason})
            raise PermissionError(reason)

    sys.addaudithook(audit)
    checks = []
    for path in (model, fixture):
        with path.open("rb") as stream:
            checks.append({"case": "approved-file-readable", "path": str(path), "passed": bool(stream.read(1))})
    operations = [
        ("original-vendor-source", lambda: Path(job["source"]).read_bytes()),
        ("decoded-private-graph", lambda: Path(job["graph"]).read_bytes()),
        ("private-arena", lambda: Path(job["arena"]).read_bytes()),
        ("vendor-library", lambda: ctypes.CDLL(job["library"])),
    ]
    for name, operation in operations:
        result = {"case": name, "passed": False}
        try:
            operation()
        except PermissionError as error:
            result.update(passed=True, reason=str(error))
        except OSError as error:
            result["wrong_failure"] = str(error)
        checks.append(result)
    with socket.socket() as connection:
        connection.settimeout(0.05)
        result = {"case": "socket-connect", "passed": False}
        try:
            connection.connect(("127.0.0.1", 9))
        except PermissionError as error:
            result.update(passed=True, reason=str(error))
        except OSError as error:
            result["wrong_failure"] = str(error)
        checks.append(result)
    report = {"passed": all(c["passed"] for c in checks), "checks": checks, "blocked": events,
              "scope": "active negative Python audit probes; not inference dependencies or OS isolation"}
    (out / "guard-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return 0 if report["passed"] else 1


def run_audit(*, reports, candidate_report, out):
    import torch
    from bytenn_oracle import LIBRARY
    from vision_batch_export import fresh_directory
    from vision_batch_torch import PROFILES, digest, load_model, state_digest
    out = fresh_directory(path=out)
    results = []
    verified = [json.loads(path.read_text()) for path in reports]
    for report in verified:
        model = load_model(path=report["artifact"], expected_sha256=report["artifact_sha256"])
        results.append({"case": f"load-{report['profile']}", "passed": True,
                        "artifact_sha256": digest(data=Path(report["artifact"]).read_bytes()),
                        "state_sha256": state_digest(state=model.state_dict())})

    def rejected(*, name, path, reason, **options):
        result = {"case": name, "passed": False}
        try:
            load_model(path=path, **options)
        except ValueError as error:
            result.update(passed=reason in str(error), reason=str(error))
        results.append(result)

    candidate = json.loads(candidate_report.read_text())
    rejected(name="actual-bandou-default", path=candidate["artifact"], reason="not native verified")
    load_model(path=candidate["artifact"], expected_sha256=candidate["artifact_sha256"], allow_unverified=True)
    results.append({"case": "actual-bandou-explicit-diagnostic-opt-in", "passed": True})
    for value in ("false", "true", 1, None):
        rejected(name=f"truthy-opt-in-{value!r}", path=candidate["artifact"], reason="explicit boolean", allow_unverified=value)
    forged = torch.load(candidate["artifact"], weights_only=True, map_location="cpu")
    forged["verification_status"] = "native-parity-passed"
    forged_path = out / "candidate-forged-status.pt"
    torch.save(forged, forged_path)
    rejected(name="actual-bandou-forged-status", path=forged_path, reason="not native verified")
    reference = verified[0]
    mutations = {
        "source": ("source_sha256", "0" * 64, "source provenance"),
        "bm": ("bm_sha256", "0" * 64, "source provenance"),
        "graph-identity": ("graph_sha256", "0" * 64, "source provenance"),
        "runtime": ("runtime_sha256", "0" * 64, "execution profile"),
        "execution": ("execution_profile", "unknown", "execution profile"),
        "local-only": ("local_only", False, "bundle format"),
    }
    for name, (key, value, reason) in mutations.items():
        bundle = torch.load(reference["artifact"], weights_only=True, map_location="cpu")
        bundle[key] = value
        path = out / f"tampered-{name}.pt"
        torch.save(bundle, path)
        rejected(name=f"tampered-{name}", path=path, reason=reason)
    for kind in ("graph", "state"):
        bundle = torch.load(reference["artifact"], weights_only=True, map_location="cpu")
        if kind == "graph":
            bundle["graph_text"] += "\n"
            bundle["graph_sha256"] = digest(data=bundle["graph_text"].encode())
            reason = "source provenance"
        else:
            key = next(iter(bundle["state_dict"]))
            bundle["state_dict"][key].view(-1)[0] += 0.25
            bundle["state_sha256"] = state_digest(state=bundle["state_dict"])
            reason = "state digest"
        path = out / f"tampered-rehashed-{kind}.pt"
        torch.save(bundle, path)
        rejected(name=f"tampered-rehashed-{kind}", path=path, reason=reason)
    rejected(name="wrong-artifact-hash", path=reference["artifact"], reason="artifact hash", expected_sha256="0" * 64)
    guard_out = out / "guard"
    guard_out.mkdir()
    source_dir = Path(reference["artifact"]).parent
    job = {"model": reference["artifact"], "input": reference["cases"][0]["input_npz"],
           "source": reference["source"], "graph": str(source_dir / "graph.private.txt"),
           "arena": str(source_dir / "arena.private.bin"), "library": str(LIBRARY)}
    job_path = out / "guard-job.json"
    job_path.write_text(json.dumps(job, indent=2) + "\n")
    with (guard_out / "worker.log").open("w") as log:
        child = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--guard-worker", str(job_path), "--out", str(guard_out)],
                               stdout=log, stderr=subprocess.STDOUT, timeout=30)
    guard = json.loads((guard_out / "guard-report.json").read_text())
    mapping = [{"profile": item["profile"], "source_sha256": item["source_sha256"], "network_id": "main",
                "verified_networks": 1, "verified_bundles": 1, "artifact_sha256": item["artifact_sha256"],
                "report": str(path.resolve()), "schema": item["schema"],
                "candidate_status_policy": PROFILES[item["profile"]]["native_verified"]}
               for path, item in zip(reports, verified, strict=True)]
    output = {"passed": all(c["passed"] for c in results) and guard["passed"] and child.returncode == 0,
              "checks": results, "guard": guard, "ledger_mapping": mapping,
              "candidate": {"profile": "bandou", "source_sha256": candidate["source_sha256"], "network_id": "main",
                            "report": str(candidate_report.resolve()), "status": candidate["status"],
                            "verified_networks": 0, "unverified_networks": 1},
              "authored_code_sha256": {name: digest(data=Path(__file__).with_name(name).read_bytes())
                                       for name in ("vision_batch_torch.py", "vision_batch_profiles.py", "vision_batch_audit.py")}}
    (out / "report.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"passed": output["passed"], "loader_checks": len(results), "guard_checks": len(guard["checks"])}))
    return 0 if output["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, action="append")
    parser.add_argument("--candidate-report", type=Path)
    parser.add_argument("--guard-worker", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.guard_worker:
        return guard_worker(job_path=args.guard_worker, out=args.out)
    if not args.report or not args.candidate_report:
        parser.error("reports and candidate report are required")
    return run_audit(reports=args.report, candidate_report=args.candidate_report, out=args.out)


if __name__ == "__main__":
    raise SystemExit(main())
