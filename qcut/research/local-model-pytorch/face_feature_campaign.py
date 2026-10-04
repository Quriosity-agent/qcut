"""Bounded feature campaigns using unchanged native/owned/replay/audit drivers.

Plan is CPU-only. Run requires a hash-bound plan, explicit GPU grant and source
freeze acknowledgements. Failed stages never become candidate parity evidence.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import time

from face_alignment_replay import LockedFiles
import face_feature_campaign_plan as planning
from face_feature_campaign_evidence import export_pngs, export_temporal_pngs
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest
import face_temporal_campaign as driver

STAGES = ("baseline", "temporal", "preprocess", "owned-replay", "owned-render", "owned-audit", "owned-export")


def commands(*, paths, case, directory, stage_timeout, deadline):
    root = planning.SCRIPT_ROOT
    outputs = {stage: directory / stage for stage in STAGES}
    temporal = outputs["temporal"] / "campaign-00"
    parameters = json.dumps(case["spec"]["parameters"]["active"], separators=(",", ":"))
    frames = sequence.validate_manifest(value=json.loads(Path(case["manifest"]).read_bytes()), base=Path(case["manifest"]).parent)
    shared = ["--capture", outputs["preprocess"], "--candidate", outputs["owned-replay"] / "replay.json",
              "--render", outputs["owned-render"], "--root", paths["models_root"]]
    scripts = {
        "baseline": ("face_render_model_capture.py", True, ["--runtime", paths["runtime"], "--package", case["spec"]["hostPackage"],
                      "--image", frames[0]["image"], "--parameters", parameters]),
        "temporal": ("face_temporal_campaign.py", True, ["--base-capture", outputs["baseline"], "--manifest", case["manifest"],
                      "--runtime", paths["runtime"], "--package", case["spec"]["hostPackage"], "--models-root", paths["models_root"],
                      "--warp-python", paths["warp_python"], "--ort-python", paths["ort_python"], "--owned-initialization",
                      "--stage-timeout", stage_timeout, "--deadline", deadline]),
        "preprocess": ("face_preprocess_probe.py", False, ["--capture", temporal / "probe", "--audit", temporal / "audit",
                       "--sequence-replay", temporal / "replay/report.json", "--sequence-render", temporal / "render/report.json"]),
        "owned-replay": ("face_preprocess_chain_replay.py", False, ["--capture", outputs["preprocess"], "--root", paths["models_root"]]),
        "owned-render": ("face_preprocess_chain_render.py", False, ["--capture", outputs["preprocess"],
                         "--candidate", outputs["owned-replay"] / "replay.json"]),
        "owned-audit": ("face_preprocess_chain_audit.py", False, shared),
        "owned-export": ("face_preprocess_chain_export.py", False, [*shared, "--audit", outputs["owned-audit"] / "report.json"]),
    }
    return {name: [str(paths["warp_python" if native_python else "ort_python"]), "-B", "-u", str(root / script),
                   *map(str, argv), "--out", str(outputs[name])]
            for name, (script, native_python, argv) in scripts.items()}


def stage_run(*, stage, command, directory, plan, deadline, timeout, locked):
    start = time.monotonic()
    stage.update(status="running", command=command)
    try:
        planning.verify_epoch(plan=plan)
        print(json.dumps(dict(case=directory.name, stage=stage["name"], status="running")), flush=True)
        code = driver.execute(command=command, log=directory / f"{stage['name']}.log", deadline=deadline, timeout=timeout)
        stage["returncode"] = code
        planning.verify_epoch(plan=plan)
        driver.require(condition=type(code) is int and code == 0, message=f"{stage['name']} exited {code}")
        value = driver.read_report(path=directory / stage["name"] / "report.json", locked=locked)
        if stage["name"] == "temporal":
            driver.require(condition=value.get("pipeline_parity") is True and value.get("completed") is True,
                           message="complete temporal pipeline required")
        stage.update(status="passed", report_sha256=locked.files[str(directory / stage["name"] / "report.json")])
        return value
    except Exception as error:
        stage.update(status="timeout" if isinstance(error, TimeoutError) else "failed", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        stage["elapsed_seconds"] = max(0, time.monotonic() - start)


def summarize(*, cases):
    counts = Counter(cases=len(cases))
    for case in cases:
        counts["candidate_parity_cases"] += case.get("candidate_parity") is True
        for stage in case["stages"]:
            counts["stage_" + stage["status"]] += 1
            counts["wrapper_commands_executed"] += type(stage.get("returncode")) is int
        for child in case.get("temporal_stages", []):
            counts["temporal_child_commands_executed"] += type(child.get("returncode")) is int
        if case.get("temporal_evidence", {}).get("bounded_native160_conditioned_render_parity") is True:
            counts["native160_conditioned_exact_frames"] += len(case["temporal_evidence"]["frames"])
            counts["native160_conditioned_head_comparisons"] += case["temporal_evidence"]["head_comparisons"]
        if case.get("candidate_parity") is True:
            counts["accepted_frames"] += len(case["evidence"]["frames"])
            counts["accepted_head_comparisons"] += case["evidence"]["head_comparisons"]
    return dict(counts)


def run(*, args):
    driver.require(condition=args.gpu_granted is True and args.source_frozen is True,
                   message="explicit parent GPU grant and source freeze required before native execution")
    driver.bounded_integer(value=args.stage_timeout, minimum=1, maximum=3600)
    driver.bounded_integer(value=args.deadline, minimum=1, maximum=14400)
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    start = time.monotonic()
    report = dict(format="face-feature-campaign-result-v1", passed=False, completed=False, candidate_parity=False,
                  product_parity_verified=False, arbitrary_frame_backend_connected=False,
                  independent_full_frame_preprocessing=False, failures=[], cases=[], plan=str(args.plan),
                  plan_sha256=args.plan_sha256, stage_timeout_seconds=args.stage_timeout, deadline_seconds=args.deadline)
    try:
        plan = planning.load(path=args.plan, expected_sha256=args.plan_sha256)
        end = start + args.deadline
        report.update(source_epoch_sha256=digest(data=json.dumps(plan["trees"], sort_keys=True).encode()),
                      source_files=sum(len(tree["files"]) for tree in plan["trees"] if tree["source"]),
                      dependencies=plan["dependencies"])
        for case in plan["cases"]:
            report["cases"].append(dict(id=case["id"], feature=case["feature"], input_kind=case["input_kind"],
                candidate_parity=False, failures=[], stages=[dict(name=name, status="pending") for name in STAGES]))
        for case, result in zip(plan["cases"], report["cases"], strict=True):
            planning.verify_epoch(plan=plan)
            directory = out / case["id"]
            directory.mkdir(mode=0o700)
            argv = commands(paths=plan["paths"], case=case, directory=directory,
                            stage_timeout=args.stage_timeout, deadline=args.deadline)
            try:
                for stage in result["stages"]:
                    stage_run(stage=stage, command=argv[stage["name"]], directory=directory, plan=plan,
                              deadline=end, timeout=args.stage_timeout, locked=locked)
                    if stage["name"] == "temporal":
                        result["temporal_evidence"] = export_temporal_pngs(root=directory / "temporal/campaign-00",
                            directory=directory / "temporal-comparison")
                result["evidence"] = export_pngs(root=directory / "owned-export", directory=directory / "comparison",
                    report_sha256=result["stages"][-1]["report_sha256"])
                planning.verify_epoch(plan=plan)
                locked.verify()
                driver.require(condition=time.monotonic() < end, message="campaign deadline exceeded during validation")
                result["candidate_parity"] = True
            except Exception as error:
                result["failures"].append(f"{type(error).__name__}: {error}")
                report["failures"].append(f"{case['id']}: {error}")
            finally:
                temporal = directory / "temporal/report.json"
                if temporal.is_file():
                    data = locked.json(path=temporal)
                    result["temporal_stages"] = [stage for child in data.get("campaigns", []) for stage in child["stages"]]
                for stage in result["stages"]:
                    if stage["status"] == "pending":
                        stage["status"] = "skipped"
            planning.verify_epoch(plan=plan)
            if time.monotonic() >= end:
                raise TimeoutError("campaign deadline reached; remaining cases skipped")
        locked.verify()
        report.update(completed=True, passed=not report["failures"], candidate_parity=not report["failures"])
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        report["candidate_parity"] = False
        for result in report["cases"]:
            result["candidate_parity"] = False
    finally:
        for result in report["cases"]:
            for stage in result["stages"]:
                if stage["status"] == "pending":
                    stage["status"] = "skipped"
        report.update(counts=summarize(cases=report["cases"]), elapsed_seconds=max(0, time.monotonic() - start),
                      fixture_sha256=dict(locked.files))
        planning.write_json(path=out / "report.json", value=report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    prepare = sub.add_parser("plan", help="CPU only; regenerate after all source edits stop")
    for name in ("runtime", "models-root", "warp-python", "ort-python", "bun", "out"):
        prepare.add_argument("--" + name, required=True, type=Path)
    prepare.add_argument("--manifest", required=True, type=Path, action="append")
    prepare.add_argument("--feature", choices=planning.FEATURES, action="append")
    prepare.add_argument("--effect-cache-root", type=Path,
                         help="Explicit read-only Cache/effect root; exact pinned fallback after private runtime only")
    execute = sub.add_parser("run")
    for name in ("plan", "out"):
        execute.add_argument("--" + name, required=True, type=Path)
    execute.add_argument("--plan-sha256", required=True)
    execute.add_argument("--gpu-granted", action="store_true")
    execute.add_argument("--source-frozen", action="store_true")
    execute.add_argument("--stage-timeout", type=int, default=900)
    execute.add_argument("--deadline", type=int, default=7200)
    args = parser.parse_args()
    report = planning.build(args=args) if args.mode == "plan" else run(args=args)
    print(json.dumps(report if args.mode == "plan" else {key: report[key] for key in
                     ("completed", "passed", "candidate_parity", "counts", "failures")}, allow_nan=False))
    return 0 if args.mode == "plan" or report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
