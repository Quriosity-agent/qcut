"""One fresh cold host/worker per portrait and catalog case; no retry or fallback.

Default mode prepares private manifests/RGBA and an immutable plan, without
compiling or loading models. Execution needs --execute-native and --lease and a
NEW --out directory. --route is always explicit: makeup is also an opt-in
consumer investigation for face controls, not a category-derived parity claim.
Zero-strength controls are unsupported by the unchanged probe acceptance API.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import time

from beauty_dual_matrix import identifier, manifest_for
from face_alignment_replay import LockedFiles, strict_json
import face_live_bridge_bundle as bundle
from face_live_bridge_probe import run as run_probe
from face_render_consumer_probe import finite_number
from face_render_sequence_probe import fresh_output, validate_manifest

MAX_JOBS = 72
CATEGORIES = {"face-shape", "eyes", "nose", "mouth", "brows", "skin", "makeup"}
MAKEUP_FLAGS = ("trace_makeup_system", "publish_makeup_candidate", "stage_makeup_render",
                "trace_makeup_points", "consume_makeup_candidate", "trace_extra_stages")


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def local_path(*, value):
    require(condition=isinstance(value, (str, Path)), message="explicit local path required")
    text = str(value)
    path = Path(text)
    require(condition=path.is_absolute() and str(path) == text and ".." not in path.parts and
            len(text) <= 4096 and not any(ord(char) < 32 or ord(char) == 127 for char in text),
            message="canonical absolute local path required")
    for ancestor in (path, *path.parents):
        require(condition=not ancestor.is_symlink(), message=f"symlink path refused: {ancestor}")
    return path


def validate_case(*, case, route):
    require(condition=type(case) is dict, message="catalog case object required")
    for key in ("id", "category", "runtimePackage", "key"):
        identifier(value=case.get(key))
    require(condition=case["category"] in CATEGORIES, message="unsupported catalog category")
    require(condition=type(case.get("label")) is str and 0 < len(case["label"]) <= 512,
            message="bounded catalog label required")
    for key in ("available", "expectedChange"):
        require(condition=type(case.get(key)) is bool, message=f"typed {key} required")
    require(condition=finite_number(value=case.get("value")) and -100 <= case["value"] <= 100,
            message="bounded catalog value required")
    require(condition=case["expectedChange"] and case["value"] != 0,
            message="probe requires nonzero expectedChange; zero-strength cases unsupported")
    require(condition=type(case.get("adjustments")) is dict and
            type(case.get("parameters")) is dict and bool(case["parameters"]),
            message="catalog parameters and adjustments objects required")
    is_makeup = case["runtimePackage"] == "makeup"
    require(condition=is_makeup == (case["category"] == "makeup") and
            is_makeup == ("cardId" in case) and is_makeup == ("makeupCategory" in case),
            message="inconsistent catalog makeup identity")
    if is_makeup:
        identifier(value=case["cardId"])
        identifier(value=case["makeupCategory"])
        require(condition=route == "makeup", message="makeup cards require explicit --route makeup")
    dependencies = case.get("dependencies")
    require(condition=type(dependencies) is list and 1 <= len(dependencies) <= 8 and
            all(type(path) is str for path in dependencies), message="1-8 explicit package dependencies required")
    paths = [str(local_path(value=path)) for path in dependencies]
    package = str(local_path(value=case.get("package")))
    require(condition=len(set(paths)) == len(paths) and package in paths,
            message="unique dependencies must include host package")
    validate_manifest(value=manifest_for(image=Path("/unused.png"), cases=[case]), base=Path("/"), expect_change=True)

    def validate_paths(*, value):
        if type(value) is dict:
            for key, child in value.items():
                if key == "path":
                    require(condition=type(child) is str and child in paths,
                            message="parameter path must be a declared package dependency")
                validate_paths(value=child)
        if type(value) is list:
            for child in value:
                validate_paths(value=child)

    validate_paths(value=case["parameters"])


def select_cases(*, catalog, cases, categories, route):
    require(condition=route in ("face", "makeup"), message="explicit --route face or makeup required")
    rows = catalog.get("cases") if type(catalog) is dict else catalog
    require(condition=type(rows) is list and 1 <= len(rows) <= 4096, message="bounded nonempty catalog required")
    inventory = {}
    for row in rows:
        require(condition=type(row) is dict, message="catalog case object required")
        key = identifier(value=row.get("id"))
        require(condition=key not in inventory, message="duplicate catalog id")
        inventory[key] = row
    cases, categories = cases or [], categories or []
    require(condition=bool(cases or categories), message="explicit --case or --category selection required")
    for values in (cases, categories):
        require(condition=type(values) is list and all(type(value) is str for value in values) and
                len(set(values)) == len(values), message="unique explicit selectors required")
    require(condition=not set(cases) - inventory.keys(), message="unknown selected case")
    known_categories = {row.get("category") for row in rows if type(row.get("category")) is str}
    require(condition=not set(categories) - known_categories, message="unknown selected category")
    selected = [row for row in rows if (not cases or row["id"] in cases) and
                (not categories or row.get("category") in categories)]
    require(condition=bool(selected), message="no matched cases")
    require(condition=not set(cases) - {row["id"] for row in selected},
            message="selected cases excluded by category filter")
    require(condition=not set(categories) - {row.get("category") for row in selected},
            message="selected categories excluded by case filter")
    require(condition=len(selected) <= 24, message="at most 24 explicit catalog cases per matrix")
    for case in selected:
        validate_case(case=case, route=route)
    return deepcopy(selected)


def probe_arguments(*, args, case, directory):
    makeup = args.route == "makeup"
    return argparse.Namespace(runtime=args.runtime, package=Path(case["package"]), root=args.models,
        manifest=directory / "manifest.json", out=directory / "audit", timeout=args.timeout,
        execute_native=args.execute_native, lease=args.lease, stable_host=True, single_frame=True,
        cold_frame=True, static_controls=False, trace_stages=True, trace_face_readers=not makeup,
        trace_extra_model=False, extra_root=args.extra_root if makeup else None,
        additional_packages=[Path(path) for path in case["dependencies"] if path != case["package"]],
        **{key: makeup for key in MAKEUP_FLAGS})


def serializable_arguments(*, args):
    return {key: str(value) if isinstance(value, Path) else
            [str(path) for path in value] if type(value) is list else value for key, value in vars(args).items()}


def load_inputs(*, args, locked):
    require(condition=args.route in ("face", "makeup"), message="explicit route required")
    require(condition=finite_number(value=args.timeout) and 1 <= args.timeout <= 240,
            message="timeout must be between 1 and 240 seconds")
    require(condition=type(args.max_jobs) is int and 1 <= args.max_jobs <= MAX_JOBS,
            message=f"max-jobs must be between 1 and {MAX_JOBS}")
    require(condition=type(args.execute_native) is bool, message="typed execute-native flag required")
    if args.execute_native:
        require(condition=type(args.lease) is str and 0 < len(args.lease.strip()) <= 160 and
                args.lease == args.lease.strip() and not any(ord(char) < 32 for char in args.lease),
                message="explicit --execute-native and nonempty --lease required")
    if args.extra_root is not None:
        require(condition=args.route == "makeup", message="--extra-root requires explicit --route makeup")
        args.extra_root = local_path(value=args.extra_root)
    for key in ("catalog", "portraits", "runtime", "models", "out"):
        setattr(args, key, local_path(value=getattr(args, key)))
    catalog = strict_json(data=locked.read(path=args.catalog, maximum=4 * 1024**2))
    selected = select_cases(catalog=catalog, cases=args.case, categories=args.category, route=args.route)
    portraits = strict_json(data=locked.read(path=args.portraits, maximum=128 * 1024))
    require(condition=type(portraits) is list and 1 <= len(portraits) <= 12,
            message="one to twelve explicit portraits required")
    seen = set()
    for portrait in portraits:
        require(condition=type(portrait) is dict and set(portrait) == {"id", "image"},
                message="portrait requires only id and image")
        key = identifier(value=portrait["id"])
        require(condition=key not in seen, message="duplicate portrait id")
        seen.add(key)
        local_path(value=portrait["image"])
    require(condition=len(selected) * len(portraits) <= args.max_jobs,
            message="selected portrait/case product exceeds explicit max-jobs budget")
    ids = [f"{portrait['id']}--{case['id']}" for portrait in portraits for case in selected]
    require(condition=len(set(ids)) == len(ids), message="ambiguous combined portrait/case id")
    return selected, portraits


def prepare_case(*, args, case, portrait, directory, guard):
    manifest = directory / "manifest.json"
    bundle.write_json(path=manifest, value=manifest_for(image=Path(portrait["image"]), cases=[case]))
    guard.locked.read(path=manifest)
    require(condition=case["available"], message="catalog marks pinned package unavailable")
    for path in (args.runtime, args.models, *map(Path, case["dependencies"]),
                 *([args.extra_root] if args.extra_root is not None else [])):
        require(condition=local_path(value=path).is_dir(), message=f"missing asset directory: {path}")
    # A new guard is retained for every job, including failed preparations.
    bundle.lock_dependencies(runtime=args.runtime, package=Path(case["package"]), models=args.models, guard=guard)
    for path in case["dependencies"]:
        if path != case["package"]:
            guard.tree(directory=Path(path))
    if args.extra_root is not None:
        guard.tree(directory=args.extra_root)
    prepared = directory / "prepared"
    prepared.mkdir(mode=0o700)
    frames, dimensions = bundle.prepare_inputs(manifest=manifest, out=prepared, guard=guard, single_frame=True)
    return dict(frames=frames, dimensions=dimensions, manifest_sha256=guard.locked.files[str(manifest)])


def verify_guards(*, locked, guards):
    combined, trees = bundle.DependencyGuard(), {}
    combined.locked.files = dict(locked.files)
    combined.locked.identities = dict(locked.identities)
    for guard in guards:
        for tree in guard.trees:
            key = (str(tree.root), tree.source)
            if key in trees:
                require(condition=trees[key].files == tree.files, message="dependency tree changed between cases")
            else:
                trees[key] = tree
                combined.trees.append(tree)
        for name, sha in guard.locked.files.items():
            if name in combined.locked.files:
                require(condition=combined.locked.files[name] == sha and
                        combined.locked.identities[name] == guard.locked.identities[name],
                        message="locked input changed between cases")
            combined.locked.files[name] = sha
            combined.locked.identities[name] = guard.locked.identities[name]
        for name, fingerprint in guard.libraries.items():
            require(condition=name not in combined.libraries or combined.libraries[name] == fingerprint,
                    message="native library changed between cases")
            combined.libraries[name] = fingerprint
    combined.verify()


def provenance_receipt(*, guard, out, locked, snapshots):
    evidence = guard.evidence()
    trees = []
    for tree in evidence["trees"]:
        data = (json.dumps(tree, indent=2, allow_nan=False) + "\n").encode("utf-8")
        sha = hashlib.sha256(data).hexdigest()
        path = out / f"tree-{sha}.json"
        if sha not in snapshots:
            bundle.write_json(path=path, value=tree)
            locked.read(path=path, maximum=32 * 1024**2, expected=sha)
            snapshots.add(sha)
        trees.append(dict(directory=tree["directory"], source=tree["source"], files=len(tree["files"]),
                          snapshot=str(path), sha256=sha, bytes=len(data)))
    # Full trees are shared hash-bound artifacts, keeping 72 rows below the report reader's limit.
    return dict(evidence, trees=trees)


def audit_outcome(*, report):
    require(condition=type(report) is dict and report.get("schema") == "face-live-bridge-probe-v1",
            message="invalid probe report schema")
    cleanup = report.get("cleanup")
    safe = (type(cleanup) is dict and cleanup.get("completed") is True and cleanup.get("failures") == []
            and report.get("dependencies_unchanged") is True)
    failures = report.get("failures")
    require(condition=type(failures) is list, message="invalid probe failures receipt")
    passed = safe and not failures and all(report.get(key) is True for key in
        ("passed", "completed", "native_execution_performed", "live_checks_completed"))
    return safe, passed


def execute_case(*, probe_args, row, locked):
    exception = None
    try:
        returned = run_probe(args=probe_args)
    except Exception as error:
        returned, exception = None, f"{type(error).__name__}: {error}"[:2000]
        row["runner_exception"] = exception
    audit_path = Path(row["audit_path"])
    # Without a durable cleanup receipt, another native launch is unsafe.
    try:
        report = strict_json(data=locked.read(path=audit_path, maximum=32 * 1024**2))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"{exception or 'probe returned'}; durable audit unavailable: {error}") from error
    row.update(audit=str(audit_path), audit_sha256=locked.files[str(audit_path)])
    safe, passed = audit_outcome(report=report)
    require(condition=returned is None or returned == report, message="returned and durable probe reports disagree")
    row.update(cleanup=report.get("cleanup"), dependencies_unchanged=report.get("dependencies_unchanged"),
               failures=report["failures"], passed=passed and exception is None,
               native_execution_performed=report.get("native_execution_performed", False))
    if exception:
        row["failures"] = [*row["failures"], dict(phase="runner", error=exception)]
    if not row["passed"]:
        detail = json.dumps(row["failures"], ensure_ascii=True) if row["failures"] else "incomplete probe acceptance"
        row["error"] = exception or detail
    return safe


def run_matrix(*, args):
    locked = LockedFiles()
    selected, portraits = load_inputs(args=args, locked=locked)
    out = fresh_output(path=args.out)
    result = dict(schema="beauty-dual-matrix-v1", runner="isolated-cold-v1",
        scope="native-dependent-isolated-static-control-matrix", route=args.route,
        product_backend_acceptance=False, temporal_acceptance=False, native_independence_verified=False,
        completed=False, passed=False, prepared=False, aborted=False, cases=[], groups=[], failures=[],
        catalog=str(args.catalog), catalog_sha256=locked.files[str(args.catalog)],
        portraits=str(args.portraits), portraits_sha256=locked.files[str(args.portraits)],
        execute_native=args.execute_native, lease=args.lease if args.execute_native else None,
        extra_root=str(args.extra_root) if args.extra_root is not None else None,
        max_jobs=args.max_jobs, retries=0, native_pixel_fallback=False)
    jobs = []
    for portrait in portraits:
        for case in selected:
            key = f"{portrait['id']}--{case['id']}"
            directory = out / key
            probe_args = probe_arguments(args=args, case=case, directory=directory)
            row = dict(id=key, catalog_id=case["id"], cardId=case.get("cardId"), portrait=portrait["id"],
                category=case["category"], label=case["label"], frame=0, route=args.route,
                parameters=deepcopy(case["parameters"]), adjustments=deepcopy(case["adjustments"]),
                expectedChange=case["expectedChange"], input_catalog=deepcopy(case), input_portrait=deepcopy(portrait),
                catalog_sha256=result["catalog_sha256"], portraits_sha256=result["portraits_sha256"],
                audit_path=str(probe_args.out / "report.json"), probe_args=serializable_arguments(args=probe_args),
                status="pending", error="not executed", passed=False, prepared=False,
                native_execution_performed=False, native_launch_attempted=False,
                cleanup=dict(completed=True, failures=[], native_launched=False),
                dependencies_unchanged=None, failures=[])
            result["cases"].append(row)
            jobs.append((case, portrait, directory, probe_args, row))
    bundle.write_json(path=out / "plan.json", value=result)
    provenance = out / "provenance"
    provenance.mkdir(mode=0o700)
    snapshots = set()
    guards = []
    for index, (case, portrait, directory, probe_args, row) in enumerate(jobs):
        started = time.monotonic()
        phase, safe = "preflight", True
        guard = None
        try:
            verify_guards(locked=locked, guards=guards)
            phase = "prepare"
            directory.mkdir(mode=0o700)
            guard = bundle.DependencyGuard()
            guards.append(guard)
            row["preparation"] = prepare_case(args=args, case=case, portrait=portrait, directory=directory, guard=guard)
            row.update(prepared=True, source_image_sha256=guard.locked.files[portrait["image"]])
            phase = "prelaunch"
            verify_guards(locked=locked, guards=guards)
            if args.execute_native:
                phase = "native"
                row.update(native_launch_attempted=True, native_execution_performed=None)
                row["cleanup"] = dict(completed=False, failures=["awaiting durable probe cleanup receipt"])
                safe = execute_case(probe_args=probe_args, row=row, locked=locked)
                row["status"] = "passed" if row["passed"] else "failed"
                if row["passed"]:
                    row.pop("error", None)
            else:
                row.update(status="prepared", error="dry preparation only; native not executed")
        except Exception as error:
            row.update(status="failed", passed=False, error=f"{type(error).__name__}: {error}"[:2000])
            row["failures"].append(dict(phase=phase, error=row["error"]))
            safe = phase == "prepare"
        except BaseException as error:
            row.update(status="interrupted", passed=False, error=f"{type(error).__name__}: interrupted")
            safe = False
        try:
            verify_guards(locked=locked, guards=guards)
            if row["dependencies_unchanged"] is None:
                row["dependencies_unchanged"] = True
        except Exception as error:
            row.update(dependencies_unchanged=False, passed=False, status="failed", error=str(error))
            row["failures"].append(dict(phase="matrix-provenance", error=str(error)))
            safe = False
        row["elapsed_seconds"] = time.monotonic() - started
        try:
            row["hash_provenance"] = provenance_receipt(guard=guard, out=provenance, locked=locked,
                                                      snapshots=snapshots) if guard is not None else {}
        except BaseException as error:
            row.update(passed=False, status="failed", hash_provenance={},
                       error=f"provenance artifact failed: {type(error).__name__}: {error}"[:2000])
            row["failures"].append(dict(phase="provenance-artifact", error=row["error"]))
            safe = False
        if not safe:
            result.update(aborted=True, abort_reason="unsafe cleanup, unknown execution state, interruption or failed provenance")
            for remaining in result["cases"][index + 1:]:
                remaining.update(status="blocked", error=result["abort_reason"])
        result["groups"].append({key: deepcopy(row[key]) for key in
            ("id", "portrait", "catalog_id", "route", "status", "passed", "audit_path", "cleanup",
             "dependencies_unchanged", "failures", "elapsed_seconds")})
        if row["status"] != "prepared" and not row["passed"]:
            result["failures"].append(dict(id=row["id"], error=row.get("error", "unsafe audit")))
        bundle.write_json(path=out / f"progress-{index + 1:03d}.json", value=result)
        print(json.dumps(dict(event="case-finished", id=row["id"], status=row["status"], safe_to_continue=safe)), flush=True)
        if not safe:
            break
    result.update(completed=not result["aborted"], prepared=all(row["prepared"] for row in result["cases"]),
        passed=args.execute_native and not result["aborted"] and all(row["passed"] for row in result["cases"]))
    bundle.write_json(path=out / "matrix.json", value=result)
    return result


def main(*, argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("catalog", "portraits", "runtime", "models", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--route", required=True, choices=("face", "makeup"))
    parser.add_argument("--case", action="append")
    parser.add_argument("--category", action="append")
    parser.add_argument("--extra-root", type=Path)
    parser.add_argument("--execute-native", action="store_true")
    parser.add_argument("--lease")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--max-jobs", type=int, default=24)
    try:
        result = run_matrix(args=parser.parse_args(argv))
    except (OSError, ValueError, TypeError, RecursionError) as error:
        parser.exit(2, f"{type(error).__name__}: {error}\n")
    print(json.dumps({key: result[key] for key in ("completed", "prepared", "passed", "aborted")}))
    return 0 if result["completed"] and (result["passed"] if result["execute_native"] else result["prepared"]) else 1


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    raise SystemExit(main())
