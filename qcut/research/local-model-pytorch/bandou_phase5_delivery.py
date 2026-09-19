"""Freeze only the complete hash-pinned 30-case validation into a separate bundle."""
import argparse
import json
from pathlib import Path

import torch

from bandou_phase5_torch import EXECUTION_PROFILE, FORMAT, NATIVE_REPORT_SHA256, PROFILE, load_model
from bandou_phase5_verify import CANDIDATE_FORMAT
from bytenn_oracle import sha256
from vision_batch_export import fresh_directory
from vision_batch_profiles import PROFILES, RUNTIME_SHA256
from vision_batch_replay import run_batch
from vision_batch_torch import state_digest


def qualify(*, source):
    if sha256(path=source) != NATIVE_REPORT_SHA256:
        raise ValueError("not the approved complete native report")
    report = json.loads(source.read_text())
    spec = PROFILES["bandou"]
    if (report.get("format") != CANDIDATE_FORMAT or report.get("status") != "native-parity-passed"
            or report.get("all_declared_outputs_verified") is not True
            or report.get("tolerance") != {"atol": 1e-4, "rtol": 1e-4}
            or any(report.get(key) != spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256"))):
        raise ValueError("native validation is not qualified")
    if (len(report["cases"]) != 30 or len(set(report["required_cases"])) != 30
            or {case["case"] for case in report["cases"]} != set(report["required_cases"])
            or any(case["passed"] is not True or case["roundtrip_exact"] is not True for case in report["cases"])):
        raise ValueError("incomplete or failing native cases")
    for case in report["cases"]:
        directory = Path(case["input_npz"]).parent
        if set(case["files_sha256"]) != {"inputs.npz", "native.npz", "pytorch.npz"}:
            raise ValueError("missing full tensor evidence")
        for name, expected in case["files_sha256"].items():
            if sha256(path=directory / name) != expected:
                raise ValueError("native validation tensor changed")
    if sha256(path=report["artifact"]) != report["artifact_sha256"]:
        raise ValueError("candidate artifact changed")
    return report


def deliver(*, source, out):
    native = qualify(source=source)
    out = fresh_directory(path=out)
    candidate = torch.load(native["artifact"], weights_only=True, map_location="cpu")
    if (candidate.get("format") != CANDIDATE_FORMAT
            or state_digest(state=candidate.get("state_dict")) != PROFILES["bandou"]["state_sha256"]):
        raise ValueError("candidate state no longer approved")
    artifact = out / "bandou-ordered.pt"
    bundle = {**candidate, "format": FORMAT, "profile": PROFILE, "execution_profile": EXECUTION_PROFILE,
              "runtime_sha256": RUNTIME_SHA256, "verification_status": "native-parity-passed",
              "native_report_sha256": NATIVE_REPORT_SHA256,
              **{key: native[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")}}
    torch.save(bundle, artifact)
    artifact_sha = sha256(path=artifact)
    load_model(path=artifact, expected_sha256=artifact_sha)
    report = {**native, "format": FORMAT, "profile": PROFILE, "artifact": str(artifact), "artifact_sha256": artifact_sha,
              "candidate_enabled": True, "execution_profile": EXECUTION_PROFILE, "native_execution_this_stage": False,
              "native_report": str(source.resolve()), "native_report_sha256": NATIVE_REPORT_SHA256,
              "delivery_replay_report": str(out / "replay/report.json"),
              "scope": "approved-full-native-validation-followed-by-independent-bundle-replay",
              "bundle_authored_code_sha256": {name: sha256(path=Path(__file__).with_name(name)) for name in (
                  "bandou_phase5_torch.py", "bandou_phase5_numeric.py", "ocr_rec_numeric.py", "vision_batch_torch.py")}}
    report_path = out / "report.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    passed = run_batch(reports=[report_path], out=out / "replay")
    delivery = {"passed": passed, "report": str(report_path), "report_sha256": sha256(path=report_path),
                "replay_report": str(out / "replay/report.json"), "replay_report_sha256": sha256(path=out / "replay/report.json")}
    (out / "delivery.json").write_text(json.dumps(delivery, indent=2) + "\n")
    if passed:
        handoff_path = out / "replay/handoff.json"
        handoff = json.loads(handoff_path.read_text())
        handoff[0]["report_sha256"] = sha256(path=report_path)
        handoff_path.write_text(json.dumps(handoff, indent=2, allow_nan=False) + "\n")
        fixture = next(case["input_npz"] for case in native["cases"] if case["case"] == "random-17")
        manifest = [{"name": "bandou-ordered", "model": str(artifact),
                     "model_sha256": artifact_sha, "input": fixture,
                     "loader": "bandou_phase5_torch.load_model", "format": FORMAT,
                     "full_case_handoff": str(handoff_path)}]
        (out / "onnx-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    return 0 if deliver(source=args.source, out=args.out) else 1


if __name__ == "__main__":
    raise SystemExit(main())
