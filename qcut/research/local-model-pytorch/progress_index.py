#!/usr/bin/env python3
"""Consolidate verified export reports without counting container discovery as conversion."""
import argparse
from collections import Counter
import json
import pathlib
import re

from espresso_archive import sha256

PASSED = {"native-parity-passed", "recorded-native-parity-passed"}


def passed_cases(*, value):
    if isinstance(value, dict):
        own = [value["passed"] is True] if "passed" in value else []
        return own + [result for child in value.values() for result in passed_cases(value=child)]
    if isinstance(value, list):
        return [result for child in value for result in passed_cases(value=child)]
    return []


def source_hashes(*, report):
    source = report.get("source_asset_sha256", report.get("source_sha256"))
    values = list(source.values()) if isinstance(source, dict) else [source]
    if not values or any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value) for value in values):
        raise ValueError("supplemental report lacks original asset SHA-256")
    return values


def artifact_details(*, path, expected=None):
    if path.suffix != ".pt" or not path.is_file():
        raise ValueError(f"missing PyTorch artifact: {path}")
    actual = sha256(path=path)
    if expected and expected != actual:
        raise ValueError(f"artifact digest changed: {path}")
    return {"artifact": str(path.resolve()), "artifact_sha256": actual, "artifact_bytes": path.stat().st_size}


def consolidate(*, baseline, containers=None, supplements=(), candidates=()):
    base = json.loads(baseline.read_text())
    records = {item["sha256"]: dict(item) for item in base["models"] if item["status"] != "duplicate"}
    for item in records.values():
        if item["status"] in PASSED:
            verification = item.get("verification")
            expected = item.get("artifact_sha256") or (verification.get("sha256") if isinstance(verification, dict) else None)
            if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
                raise ValueError("verified baseline entry lacks artifact SHA-256")
            cases = passed_cases(value=verification)
            if not cases or not all(cases):
                raise ValueError("verified baseline entry lacks passing native cases")
            item.update(artifact_details(path=pathlib.Path(item["artifact"]), expected=expected))
            item["verification_report"] = str(baseline.resolve())
    if containers:
        inspection = json.loads(containers.read_text())
        for item in inspection["records"]:
            target = records.get(item.get("sha256"))
            if target and item["status"] == "inspected":
                target["container_classification"] = item.get("classification", {})
                target["container_report"] = str(containers.resolve())
    reports = [(path, True) for path in supplements] + [(path, False) for path in candidates]
    for path, verified in reports:
        report = json.loads(path.read_text())
        if verified and report.get("status") not in PASSED:
            raise ValueError(f"supplemental conversion is not verified: {path}")
        if not verified and report.get("status") not in {
            "native-parity-failed", "native-unverified-or-failed", "roundtrip-passed-native-unverified"
        }:
            raise ValueError(f"candidate must have explicit unverified or failed status: {path}")
        cases = passed_cases(value=[report.get("native"), report.get("cases")])
        if verified and (not cases or not all(cases)):
            raise ValueError(f"missing or failed native cases: {path}")
        artifact_value = report.get("artifact", str(path.parent / "model.pt"))
        if isinstance(artifact_value, dict):
            artifact = pathlib.Path(artifact_value["path"])
            expected = artifact_value.get("sha256")
        else:
            artifact = pathlib.Path(artifact_value)
            expected = report.get("artifact_sha256", report.get("sha256"))
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise ValueError(f"supplemental report lacks artifact SHA-256: {path}")
        details = artifact_details(path=artifact, expected=expected)
        for digest in source_hashes(report=report):
            item = records.setdefault(digest, {"sha256": digest, "source": report.get("source_path", "source outside baseline manifests"),
                                               "outside_baseline": True})
            if not verified and item.get("status") in PASSED:
                raise ValueError(f"candidate cannot overwrite a verified source asset: {digest}")
            item.update(details, status=report["status"], verification_report=str(path.resolve()),
                        native_checks=len(cases), failed_native_checks=cases.count(False))
            for field in ("input_shapes", "original_input_shape", "derived_input_shape", "research_side",
                          "native_graph_input_resized", "verification_scope", "roundtrip"):
                if field in report:
                    item[field] = report[field]
    verified = [item for item in records.values() if item["status"] in PASSED]
    artifacts = {item["artifact"]: item for item in verified}
    candidate_artifacts = {item["artifact"] for item in records.values() if item["status"] not in PASSED and item.get("artifact")}
    return {"format": "qcut-private-conversion-progress", "version": 1, "local_only": True,
            "baseline_manifest_records": len(base["models"]),
            "baseline_unique_assets": len({item["sha256"] for item in base["models"]}),
            "additional_assets": sum(bool(item.get("outside_baseline")) for item in records.values()),
            "verified_network_assets": len(verified), "unique_artifacts": len(artifacts),
            "unverified_candidate_artifacts": len(candidate_artifacts),
            "artifact_bytes": sum(item["artifact_bytes"] for item in artifacts.values()),
            "statuses": dict(Counter(item["status"] for item in records.values())),
            "counting_scope": "verified source assets for these adapters; container payloads and state tensors are not extra models",
            "records": list(records.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=pathlib.Path, required=True)
    parser.add_argument("--containers", type=pathlib.Path)
    parser.add_argument("--supplement", type=pathlib.Path, action="append", default=[])
    parser.add_argument("--candidate", type=pathlib.Path, action="append", default=[])
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = consolidate(baseline=args.baseline, containers=args.containers, supplements=args.supplement, candidates=args.candidate)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "records"}, indent=2))


if __name__ == "__main__":
    main()
