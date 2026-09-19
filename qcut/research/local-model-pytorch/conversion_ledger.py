"""Keep per-network verification histories without treating partial containers as complete."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

from espresso_archive import sha256
from progress_index import PASSED, artifact_details, passed_cases, source_hashes


def report_artifact(*, report, required):
    value = report.get("artifact")
    if value is None and not required:
        return None
    if isinstance(value, dict):
        path, digest = value.get("path"), value.get("sha256")
    else:
        path = value
        digest = report.get("artifact_sha256", report.get("sha256"))
    if not isinstance(path, str) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("report artifact requires path and SHA-256")
    return artifact_details(path=Path(path), expected=digest)


def evidence(*, report, path, inherited=False):
    status = report.get("status")
    if not isinstance(status, str) or not status:
        raise ValueError("explicit verification status required")
    verified = status in PASSED
    flags = passed_cases(value=[report.get("native"), report.get("cases"), report.get("verification")])
    if verified and (not flags or not all(flags)):
        raise ValueError("verified network requires nonempty all-passing native comparisons")
    artifact = report_artifact(report=report, required=verified)
    item = {"status": status, "verified": verified, "report": str(path.resolve()), "report_sha256": sha256(path=path),
            "native_checks": len(flags), "failed_native_checks": flags.count(False), "artifact": artifact,
            "inherited_prior_index": inherited}
    for key in ("verification_scope", "native_backend", "input_shapes", "output_shapes", "spec", "native_graph_input_resized",
                "backend", "scope", "schema", "input_schema", "output_schema", "graph_transform",
                "original_graph_unchanged", "original_topology_unchanged", "fp16_decoder_proof"):
        if key in report:
            item[key] = report[key]
    return item


def prior_evidence(*, entry):
    path = Path(entry["verification_report"])
    report = json.loads(path.read_text())
    if isinstance(report.get("models"), list):
        matches = [item for item in report["models"] if item.get("sha256") == entry["sha256"] and item.get("status") != "duplicate"]
        if len(matches) != 1:
            raise ValueError("prior report does not identify exactly one source asset")
        report = matches[0]
    elif entry["sha256"] not in source_hashes(report=report):
        raise ValueError("prior report source identity differs")
    if report.get("status") != entry["status"]:
        raise ValueError("prior report status changed; regenerate the prior index")
    evidence_fields = {key: report.get(key) for key in ("native", "cases", "verification")}
    return evidence(report={**entry, **evidence_fields}, path=path, inherited=True)


def network_id(*, report):
    value = report.get("network_id", "main")
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,128}", value):
        raise ValueError("network_id must be a bounded stable identifier")
    return value


def report_entries(*, report):
    networks = report.get("networks")
    if not isinstance(networks, list):
        return [report]
    if not networks or any(not isinstance(item, dict) for item in networks):
        raise ValueError("nonempty network evidence entries required")
    inherited = {key: report[key] for key in ("source_sha256", "source_asset_sha256", "source_path") if key in report}
    entries = [{**inherited, **item} for item in networks]
    identities = [(tuple(source_hashes(report=item)), network_id(report=item)) for item in entries]
    if len(set(identities)) != len(identities):
        raise ValueError("duplicate network identity within report")
    return entries


def build_ledger(*, prior, reports=()):
    index = json.loads(prior.read_text())
    if index.get("format") != "qcut-private-conversion-progress":
        raise ValueError("expected verified prior progress index")
    networks = {}
    assets = {item["sha256"]: {"source_sha256": item["sha256"], "source": item.get("source"), "network_ids": []}
              for item in index["records"]}

    def append(*, digest, identifier, record):
        key = f"{digest}:{identifier}"
        network = networks.setdefault(key, {"source_sha256": digest, "network_id": identifier, "history": []})
        identity = (record["report"], record["report_sha256"], record["status"],
                    record["artifact"]["artifact_sha256"] if record["artifact"] else None)
        if not any(item["identity"] == identity for item in network["history"]):
            network["history"].append({**record, "identity": identity})

    for entry in index["records"]:
        if not entry.get("artifact"):
            continue
        if not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]):
            raise ValueError("invalid prior source hash")
        append(digest=entry["sha256"], identifier="main", record=prior_evidence(entry=entry))
    for path in reports:
        report = json.loads(path.read_text())
        for entry in report_entries(report=report):
            identifier = network_id(report=entry)
            assessment = evidence(report=entry, path=path)
            for digest in source_hashes(report=entry):
                assets.setdefault(digest, {"source_sha256": digest, "source": entry.get("source_path"), "network_ids": []})
                append(digest=digest, identifier=identifier, record=assessment)
    artifacts, candidates = {}, {}
    for entry in networks.values():
        history = entry["history"]
        entry["verified"] = any(item["verified"] for item in history)
        entry["has_nonpassing_evidence"] = any(not item["verified"] for item in history)
        assets[entry["source_sha256"]]["network_ids"].append(entry["network_id"])
        for item in history:
            item.pop("identity")
            artifact = item["artifact"]
            if artifact:
                target = artifacts if item["verified"] else candidates
                target[artifact["artifact_sha256"]] = artifact
    for asset in assets.values():
        entries = [networks[f"{asset['source_sha256']}:{identifier}"] for identifier in asset["network_ids"]]
        asset["verified_networks"] = sum(item["verified"] for item in entries)
        asset["assessed_networks"] = len(entries)
        asset["whole_asset_coverage"] = "not-inferred-from-subnet-results"
    return {"format": "qcut-private-network-ledger", "version": 1, "local_only": True,
            "prior_index": str(prior.resolve()), "prior_index_sha256": sha256(path=prior),
            "source_assets": len(assets), "sources_with_verified_networks": sum(item["verified_networks"] > 0 for item in assets.values()),
            "verified_network_versions": sum(item["verified"] for item in networks.values()),
            "unverified_network_versions": sum(not item["verified"] for item in networks.values()),
            "verified_bundle_hashes": len(artifacts), "candidate_bundle_hashes": len(set(candidates) - set(artifacts)),
            "verified_bundle_bytes": sum(item["artifact_bytes"] for item in artifacts.values()),
            "assessment_statuses": dict(Counter(h["status"] for item in networks.values() for h in item["history"])),
            "counting_scope": "source hash plus declared network_id; backend histories do not multiply network counts; no whole-container completeness claim",
            "networks": list(networks.values()), "assets": list(assets.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prior", type=Path, required=True)
    parser.add_argument("--report", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = build_ledger(prior=args.prior, reports=args.report)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in {"networks", "assets"}}, indent=2))


if __name__ == "__main__":
    main()
