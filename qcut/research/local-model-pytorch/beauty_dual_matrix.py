"""Run fresh native/ONNX static-control groups; never reuse a baseline as output.

The catalog comes from beauty_dual_matrix_catalog.ts. Portraits JSON contains
[{"id": "portrait", "image": "/absolute/original.png"}]. All GPU work is serial.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import time

from face_alignment_replay import LockedFiles, strict_json
from face_live_bridge_bundle import DependencyGuard, write_json
from face_live_bridge_probe import run as run_probe
from face_render_sequence_probe import fresh_output


def identifier(*, value):
    if type(value) is not str or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", value):
        raise ValueError("bounded path-safe case/portrait identifier required")
    return value


def batches(*, cases, limit=24):
    if not 1 <= limit <= 24:
        raise ValueError("batch size must be between 1 and 24")
    groups = defaultdict(list)
    seen = set()
    for case in cases:
        case_id = identifier(value=case["id"])
        if case_id in seen:
            raise ValueError("duplicate catalog case")
        seen.add(case_id)
        if case.get("available") is False:
            continue
        package = Path(case["package"])
        if not package.is_absolute():
            raise ValueError("absolute host package required")
        groups[str(package)].append(case)
    return [group[offset:offset + limit] for group in groups.values()
            for offset in range(0, len(group), limit)]


def manifest_for(*, image, cases):
    return dict(version=1, frames=[dict(image=str(image), timestamp=0,
        parameters=case["parameters"], expect_change=case.get("expectedChange", True),
        label=case["id"][:80]) for case in cases])


def run_matrix(*, args):
    if not args.execute_native or not args.lease:
        raise ValueError("explicit --execute-native and --lease required")
    locked = LockedFiles()
    catalog = strict_json(data=locked.read(path=args.catalog.resolve(strict=True), maximum=4 * 1024**2))
    cases = catalog if isinstance(catalog, list) else catalog["cases"]
    selected = [case for case in cases if (not args.category or case["category"] in args.category)
                and (not args.case or case["id"] in args.case)]
    if not selected:
        raise ValueError("no selected cases")
    missing = set(args.case or []) - {case["id"] for case in selected}
    if missing:
        raise ValueError(f"unknown selected cases: {sorted(missing)}")
    portraits = strict_json(data=locked.read(path=args.portraits.resolve(strict=True), maximum=128 * 1024))
    if not isinstance(portraits, list) or not 1 <= len(portraits) <= 12:
        raise ValueError("one to twelve explicit portraits required")
    seen = set()
    for portrait in portraits:
        key = identifier(value=portrait["id"])
        if key in seen:
            raise ValueError("duplicate portrait")
        seen.add(key)
        image = Path(portrait["image"])
        if not image.is_absolute():
            raise ValueError("explicit absolute portrait path required")
        locked.read(path=image.resolve(strict=True), maximum=128 * 1024**2)
    grouped = batches(cases=selected, limit=args.batch_size)
    out = fresh_output(path=args.out)
    result = dict(schema="beauty-dual-matrix-v1", scope="native-dependent-static-control-matrix",
        product_backend_acceptance=False, temporal_acceptance=False, cases=[], groups=[],
        catalog_sha256=hashlib.sha256(args.catalog.read_bytes()).hexdigest(), failures=[])
    for portrait in portraits:
        for case in selected:
            if case.get("available") is False:
                result["cases"].append(dict(id=f"{portrait['id']}--{case['id']}", portrait=portrait["id"],
                    category=case["category"], label=case["label"], error="pinned package unavailable",
                    adjustments=case["adjustments"]))
        for group_index, group in enumerate(grouped):
            locked.verify()
            group_dir = out / f"{portrait['id']}--{group_index:02d}"
            group_dir.mkdir()
            manifest = group_dir / "manifest.json"
            write_json(path=manifest, value=manifest_for(image=Path(portrait["image"]), cases=group))
            packages = sorted({str(path) for case in group for path in case.get("dependencies", [])
                               if str(path) != group[0]["package"]})
            guard = DependencyGuard()
            for package in packages:
                guard.tree(directory=Path(package).resolve(strict=True))
            started = time.monotonic()
            print(json.dumps(dict(event="group-start", portrait=portrait["id"], group=group_index,
                cases=[case["id"] for case in group]), ensure_ascii=False), flush=True)
            report = run_probe(args=argparse.Namespace(runtime=args.runtime, package=Path(group[0]["package"]),
                root=args.models, manifest=manifest, out=group_dir / "audit", execute_native=True,
                lease=args.lease, timeout=args.timeout, stable_host=True, single_frame=len(group) == 1,
                static_controls=len(group) > 1, additional_packages=list(map(Path, packages))))
            guard.verify()
            locked.verify()
            result["groups"].append(dict(portrait=portrait["id"], group=group_index, passed=report["passed"],
                elapsed_seconds=time.monotonic() - started, failures=report["failures"],
                audit=str(group_dir / "audit/report.json")))
            for index, case in enumerate(group):
                result["cases"].append(dict(id=f"{portrait['id']}--{case['id']}", portrait=portrait["id"],
                    category=case["category"], label=case["label"], frame=index,
                    audit=str(group_dir / "audit/report.json"), parameters=case["parameters"],
                    adjustments=case["adjustments"], expectedChange=case.get("expectedChange", True)))
            # Each checkpoint is immutable, so an interruption does not erase earlier results.
            write_json(path=out / f"progress-{len(result['groups']):03d}.json", value=result)
            print(json.dumps(dict(event="group-finished", **result["groups"][-1])), flush=True)
            if not report["cleanup"]["completed"] or not report["dependencies_unchanged"]:
                raise RuntimeError("unsafe cleanup or changed dependencies; remaining groups were not launched")
    result["completed"] = True
    result["passed"] = all(group["passed"] for group in result["groups"]) and not any(
        "error" in case for case in result["cases"])
    write_json(path=out / "matrix.json", value=result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("catalog", "portraits", "runtime", "models", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--execute-native", action="store_true")
    parser.add_argument("--lease", required=True)
    parser.add_argument("--category", action="append")
    parser.add_argument("--case", action="append")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--batch-size", type=int, default=24)
    result = run_matrix(args=parser.parse_args())
    print(json.dumps(dict(completed=result["completed"], passed=result["passed"], cases=len(result["cases"]))))


if __name__ == "__main__":
    main()
