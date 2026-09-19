"""Aggregate independently verified scopes without hiding failed temporal cases."""
import argparse
import json
from pathlib import Path

from matting_cpu_export import digest, fresh_directory
from matting_cpu_math_oracle import CASE_NAMES as MATH_CASE_NAMES, SCOPE as MATH_SCOPE


def combine(*, run: Path, media: list[Path], trace: Path, math: Path, out: Path,
            extra_traces: list[Path] | None = None, counterexample: Path | None = None):
    out = fresh_directory(path=out)
    base = json.loads((run / "report.json").read_text())
    artifact = Path(base["artifact"])
    if digest(data=artifact.read_bytes()) != base["artifact_sha256"] or not base.get("fp16_decoder_proof", {}).get("passed"):
        raise ValueError("artifact or original FP16 provenance is not verified")
    scopes = [{"name": "synthetic-same-input", "report": str((run / "report.json").resolve()),
               "status": base["status"], "verification_scope": base["verification_scope"]}]
    cases = [{**case, "scope": "synthetic-same-input"} for case in base["cases"]]
    media_checks = []
    if not media or not cases:
        raise ValueError("nonempty same-input and actual-media evidence required")
    for index, path in enumerate(media):
        item = json.loads(path.read_text())
        if any(item[key] != base[key] for key in ("source_sha256", "artifact_sha256", "runtime_sha256")):
            raise ValueError("media provenance differs from the bundle")
        if item["distinct_frames"] < 12 or not item["cases"]:
            raise ValueError("insufficient actual temporal frames")
        scope = f"temporal-clip-{index}"
        scopes.append({"name": scope, "report": str(path.resolve()), "status": item["status"],
                       "verification_scope": item["verification_scope"]})
        cases.extend({**case, "scope": scope} for case in item["cases"])
        media_checks.append({key: item[key] for key in ("video", "video_sha256", "distinct_frames", "inferences",
                                                       "native_feedback_exact", "native_replay_exact", "torch_replay_exact", "reset_frames")})
        media_checks[-1].update({key: item[key] for key in ("sampled_frames", "fps") if key in item})
    diagnosis = json.loads(trace.read_text())
    math_proof = json.loads(math.read_text())
    # The synthetic proof carries no bundle identity, so pin its contract:
    # the published scope, the exact case set, and the bundle's runtime.
    if math_proof.get("scope") != MATH_SCOPE or [case.get("case") for case in math_proof.get("cases", [])] != list(MATH_CASE_NAMES):
        raise ValueError("math proof does not match the synthetic softmax contract")
    if math_proof.get("native", {}).get("runtime_sha256") != base["runtime_sha256"]:
        raise ValueError("math proof runtime differs from the bundle")
    diagnostics = []
    for path in [trace, *(extra_traces or []), *([counterexample] if counterexample else [])]:
        item = json.loads(path.read_text())
        for key in ("source_sha256", "artifact_sha256"):
            if key in item and item[key] != base[key]:
                raise ValueError("diagnostic provenance differs from the bundle")
        if item["native"]["runtime_sha256"] != base["runtime_sha256"]:
            raise ValueError("diagnostic runtime differs from the bundle")
        diagnostics.append({"report": str(path.resolve()), "sha256": digest(data=path.read_bytes()),
                            "status": item.get("status", "diagnostic-only"),
                            "scope": item.get("scope", "not a model-parity assessment")})
    passed = (all(scope["status"] == "native-parity-passed" for scope in scopes) and all(case["passed"] for case in cases)
              and math_proof["status"] == "native-parity-passed")
    temporal_passed = (all(scope["status"] == "native-parity-passed" for scope in scopes if scope["name"].startswith("temporal-clip-"))
                       and all(case["passed"] for case in cases if case["scope"].startswith("temporal-clip-")))
    report = {**base, "status": "native-parity-passed" if passed else "native-parity-failed", "cases": cases,
              "verification_scopes": scopes, "temporal_checks": media_checks, "temporal_passed": temporal_passed,
              "temporal_scope": "executed; every temporal scope and case passed" if temporal_passed
              else "executed; see separately failed temporal scopes",
              "first_failing_layer": diagnosis["first_failure"], "diagnostic_report": str(trace.resolve()),
              "diagnostics": diagnostics,
              "isolated_softmax_on_native_logits": diagnosis["isolated_cpu_softmax_on_native_logits"],
              "synthetic_softmax_proof": {"report": str(math.resolve()), "status": math_proof["status"], "cases": math_proof["cases"]},
              "all_declared_outputs_verified": passed, "product_gpu_parity": False,
              "unchanged_container_load_tested": False, "original_fp16_native_expansion_bit_exact": True,
              "integration": {"module": "matting_torch", "loader": "load_model(path=..., expected_sha256=..., allow_unverified=True)",
                              "candidate_opt_in_required": True,
                              "format": "qcut-private-matting-gru-cpu-v2", "vendor_runtime_required_for_loading": False},
              "scope": "CPU network only; original arena normalization independently native-verified; "
                       + ("complete temporal parity passed" if temporal_passed else "complete temporal parity failed")
                       + "; no product/editor GPU or preprocessing claim"}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--media", type=Path, nargs="+", required=True)
    parser.add_argument("--trace", type=Path, required=True)
    parser.add_argument("--math", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--extra-trace", type=Path, action="append", default=[])
    parser.add_argument("--counterexample", type=Path)
    args = parser.parse_args()
    report = combine(run=args.run, media=args.media, trace=args.trace, math=args.math, out=args.out,
                     extra_traces=args.extra_trace, counterexample=args.counterexample)
    print(json.dumps({"status": report["status"], "artifact": report["artifact"],
                      "artifact_sha256": report["artifact_sha256"], "case_count": len(report["cases"])}, indent=2))


if __name__ == "__main__":
    main()
