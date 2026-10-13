"""Summarize sampled app-tree RSS without inferring leak freedom or memory limits.

Usage: python3 scripts/analyze-beauty-timeline-memory.py /path/to/run
Inputs: memory.jsonl, optional command.json, app-process.json, e2e-evidence.json.
Only an explicit runnerStartedAt aligns monotonic samples with ISO stage events.
"""

import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import statistics


GROUPS = ("total", "electron", "workers", "other")


def number(*, value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"Expected finite nonnegative {label}: {value!r}")
    return value


def read_object(*, path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return data


def iso_seconds(*, value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("ISO timestamps must include a timezone")
    return parsed.timestamp()


def process_group(*, process, app_pid):
    name = process["name"].lower()
    if process["pid"] == app_pid or "electron" in name:
        return "electron"
    if "portrait" in name or "beauty" in name or name.startswith("python"):
        return "workers"
    return "other"


def read_samples(*, path, app_pid):
    samples, warnings = [], []
    with path.open() as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                if not line.endswith("\n"):
                    warnings.append(f"Ignored incomplete final JSONL line {line_number}")
                    break
                raise ValueError(f"Malformed memory JSONL at line {line_number}") from None
            seconds = number(value=row["seconds"], label="sample seconds")
            if samples and seconds <= samples[-1]["seconds"]:
                raise ValueError(f"Non-increasing sample time at line {line_number}")
            groups = dict.fromkeys(GROUPS, 0)
            pids = set()
            for process in row["processes"]:
                pid = process["pid"]
                if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or pid in pids:
                    raise ValueError(f"Invalid or duplicate PID at line {line_number}")
                pids.add(pid)
                if not isinstance(process.get("name"), str):
                    raise ValueError(f"Missing process name at line {line_number}")
                rss = number(value=process["rssKiB"], label="process RSS KiB")
                groups[process_group(process=process, app_pid=app_pid)] += rss
                groups["total"] += rss
            recorded = row.get("totalRssKiB")
            if recorded is not None and number(value=recorded, label="total RSS KiB") != groups["total"]:
                warnings.append(f"Line {line_number}: recorded total differs from process sum; used process sum")
            samples.append({"seconds": seconds, "rss_kib": groups, "processes": row["processes"]})
    if not samples:
        raise ValueError("No complete memory samples")
    return samples, warnings


def percentile(*, values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    return ordered[lower] + (ordered[math.ceil(position)] - ordered[lower]) * (position - lower)


def slope(*, samples, group):
    if len(samples) < 2:
        return None
    times = [sample["seconds"] for sample in samples]
    values = [sample["rss_kib"][group] / 1024 for sample in samples]
    center = statistics.mean(times)
    denominator = sum((value - center) ** 2 for value in times)
    return 60 * sum((time - center) * value for time, value in zip(times, values)) / denominator


def summarize(*, samples, warmup_seconds, start_seconds=None):
    if not samples:
        return {"sample_count": 0, "rss_mib": None, "trend": None}
    start = samples[0]["seconds"] if start_seconds is None else start_seconds
    warm = [sample for sample in samples if sample["seconds"] >= start + warmup_seconds]
    first_window = [sample for sample in samples if sample["seconds"] <= samples[0]["seconds"] + 10]
    last_window = [sample for sample in samples if sample["seconds"] >= samples[-1]["seconds"] - 10]
    metrics, trends = {}, {}
    for group in GROUPS:
        values = [sample["rss_kib"][group] / 1024 for sample in samples]
        peak = max(samples, key=lambda sample: sample["rss_kib"][group])
        first_median = statistics.median(sample["rss_kib"][group] / 1024 for sample in first_window)
        last_median = statistics.median(sample["rss_kib"][group] / 1024 for sample in last_window)
        metrics[group] = {
            "first": values[0], "last": values[-1], "min": min(values),
            "median": statistics.median(values), "sample_mean": statistics.mean(values),
            "p95": percentile(values=values, fraction=0.95), "peak": max(values),
            "peak_runner_seconds": peak["seconds"],
        }
        trends[group] = {
            "first_10s_window_median_mib": first_median,
            "last_10s_window_median_mib": last_median,
            "window_delta_mib": last_median - first_median,
            "after_warmup_slope_mib_per_minute": slope(samples=warm, group=group),
        }
    return {
        "sample_count": len(samples), "first_runner_seconds": samples[0]["seconds"],
        "last_runner_seconds": samples[-1]["seconds"],
        "sample_span_seconds": samples[-1]["seconds"] - samples[0]["seconds"],
        "rss_mib": metrics,
        "trend": {"warmup_seconds": warmup_seconds, "after_warmup_samples": len(warm),
                  "window_seconds": 10, "windows_overlap": samples[-1]["seconds"] - samples[0]["seconds"] <= 20,
                  "groups": trends, "verdict": None},
    }


def align_phases(*, command, app, evidence, samples, warmup_seconds):
    origin = command.get("runnerStartedAt")
    if not origin:
        return {"available": False, "reason": "Missing command.json runnerStartedAt; file mtime is not a time origin", "phases": []}
    try:
        origin_seconds = iso_seconds(value=origin)
        start = iso_seconds(value=app["startedAt"]) - origin_seconds
        events = evidence.get("stageEvents", [])
        if not events:
            return {"available": False, "runner_started_at": origin,
                    "app_started_runner_seconds": start, "reason": "No explicit stageEvents", "phases": []}
        boundaries = [{"seconds": start, "name": "app_setup", "pass": None, "stage": "appStarted"}]
        stages = {"exportStart": "export", "exportEnd": "preview", "previewEnd": "between_passes_or_cleanup"}
        for event in events:
            seconds = iso_seconds(value=event["timestamp"]) - origin_seconds
            if seconds < boundaries[-1]["seconds"]:
                raise ValueError("Stage timestamps precede app startup or are out of order")
            boundaries.append({"seconds": seconds, "name": stages[event["stage"]],
                               "pass": event["pass"], "stage": event["stage"]})
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        return {"available": False, "reason": f"Invalid explicit time metadata: {error}", "phases": []}
    phases = []
    closing_stages = {"appStarted": "exportStart", "exportStart": "exportEnd",
                      "exportEnd": "previewEnd", "previewEnd": "exportStart"}
    for index, boundary in enumerate(boundaries):
        next_boundary = boundaries[index + 1] if index + 1 < len(boundaries) else None
        end = next_boundary["seconds"] if next_boundary else max(boundary["seconds"], samples[-1]["seconds"])
        selected = [sample for sample in samples if sample["seconds"] >= boundary["seconds"] and
                    (sample["seconds"] < end if next_boundary else sample["seconds"] <= end)]
        closed = next_boundary is not None and next_boundary["stage"] == closing_stages[boundary["stage"]]
        if boundary["name"] in ("export", "preview"):
            closed = closed and next_boundary["pass"] == boundary["pass"]
        phases.append({
            "name": boundary["name"], "pass": boundary["pass"],
            "start_runner_seconds": boundary["seconds"], "end_runner_seconds": end,
            "end_stage_observed": closed,
            "statistics": summarize(samples=selected, warmup_seconds=warmup_seconds, start_seconds=boundary["seconds"]),
        })
    return {"available": True, "runner_started_at": origin,
            "app_started_runner_seconds": start, "phases": phases,
            "alignment": "Explicit ISO origin plus monotonic seconds; sampling gaps and any recorder clock-origin skew remain"}


def process_inventory(*, samples, app_pid):
    inventory = {}
    for sample in samples:
        for process in sample["processes"]:
            key = (process["pid"], process["name"])
            if key not in inventory:
                inventory[key] = {"pid": process["pid"], "name": process["name"],
                                  "group": process_group(process=process, app_pid=app_pid),
                                  "parents": set(), "first_runner_seconds": sample["seconds"], "peak_rss_mib": 0}
            record = inventory[key]
            record["parents"].add(process.get("parent"))
            record["last_runner_seconds"] = sample["seconds"]
            record["last_rss_mib"] = process["rssKiB"] / 1024
            record["peak_rss_mib"] = max(record["peak_rss_mib"], process["rssKiB"] / 1024)
    final = {(process["pid"], process["name"]) for process in samples[-1]["processes"]}
    records = []
    for key, record in inventory.items():
        records.append({**record, "parents": sorted(parent for parent in record["parents"] if parent is not None),
                        "present_in_final_sample": key in final})
    return sorted(records, key=lambda record: (record["first_runner_seconds"], record["pid"]))


def cleanup_observation(*, samples, inventory, app_pid):
    app_seen = app_pid is not None and any(process["pid"] == app_pid for sample in samples for process in sample["processes"])
    last_app = max((sample["seconds"] for sample in samples if any(process["pid"] == app_pid for process in sample["processes"])), default=None)
    after_app = [sample for sample in samples if last_app is not None and sample["seconds"] > last_app]
    absent = [record["pid"] for record in inventory if record["group"] == "workers" and not record["present_in_final_sample"]]
    remaining = [record["pid"] for record in inventory if record["group"] == "workers" and record["present_in_final_sample"]]
    return {"app_pid": app_pid, "app_was_observed": app_seen,
            "app_absence_after_last_observation": bool(after_app) if app_seen else None,
            "first_post_app_sample_runner_seconds": after_app[0]["seconds"] if after_app else None,
            "post_app_sample_count": len(after_app),
            "worker_pids_absent_from_final_tree": absent,
            "worker_pids_present_in_final_tree": remaining,
            "all_previously_observed_workers_absent_from_final_tree": not remaining if absent or remaining else None,
            "verdict": None,
            "scope": "Only sampled descendant-tree absence. Reparented processes, PID reuse, release completion and leak freedom are not established."}


def build_report(*, evidence_root, warmup_seconds=10):
    number(value=warmup_seconds, label="warmup seconds")
    command = read_object(path=evidence_root / "command.json")
    app = read_object(path=evidence_root / "app-process.json")
    evidence = read_object(path=evidence_root / "e2e-evidence.json")
    app_pid = app.get("appPid", evidence.get("appPid"))
    if app.get("appPid") is not None and evidence.get("appPid") is not None and app["appPid"] != evidence["appPid"]:
        raise ValueError("App PID mismatch between app-process.json and e2e-evidence.json")
    samples, warnings = read_samples(path=evidence_root / "memory.jsonl", app_pid=app_pid)
    inventory = process_inventory(samples=samples, app_pid=app_pid)
    gaps = [after["seconds"] - before["seconds"] for before, after in zip(samples, samples[1:])]
    return {
        "schema_version": 1, "kind": "beauty-timeline-sampled-memory-diagnostic",
        "evidence_root": str(evidence_root.resolve()), "e2e_status": evidence.get("status"),
        "media_duration_seconds": evidence.get("duration"), "warnings": warnings,
        "sampling": {"samples": len(samples), "median_interval_seconds": statistics.median(gaps) if gaps else None,
                     "max_interval_seconds": max(gaps) if gaps else None,
                     "unit": "MiB (RSS KiB / 1024)",
                     "scope": "App PID and descendants selected by recorder; summed RSS may double-count shared pages and misses between-sample peaks"},
        "classification": {"electron": "App PID and process names containing Electron",
                           "workers": "Names containing portrait/beauty or starting Python; Python role is a candidate because command arguments are not recorded",
                           "other": "All other sampled descendants"},
        "overall": summarize(samples=samples, warmup_seconds=warmup_seconds),
        "phase_analysis": align_phases(command=command, app=app, evidence=evidence, samples=samples, warmup_seconds=warmup_seconds),
        "processes": inventory,
        "cleanup_observed": cleanup_observation(samples=samples, inventory=inventory, app_pid=app_pid),
        "acceptance_verdict": None,
        "limitations": ["This run does not establish a memory limit or leak freedom, regardless of short-clip completion.",
                        "Trend is descriptive OLS after a declared warmup; phase changes, cache residency and worker turnover can change RSS.",
                        "Process start times are not recorded: PID reuse and reparented workers cannot be tracked reliably.",
                        "An app startedAt timestamp identifies harness observation after launch, not the OS process birth time."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence_root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--warmup-seconds", type=float, default=10)
    args = parser.parse_args()
    report = build_report(evidence_root=args.evidence_root, warmup_seconds=args.warmup_seconds)
    output = args.output or args.evidence_root / "memory-analysis.json"
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(output), "samples": report["sampling"]["samples"],
                      "peak_total_rss_mib": report["overall"]["rss_mib"]["total"]["peak"],
                      "phases_available": report["phase_analysis"]["available"]}))


if __name__ == "__main__":
    main()
