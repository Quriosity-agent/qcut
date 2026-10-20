"""Summarize recorded editor operations without turning partial checks into acceptance."""

import html
import json
import re
import subprocess


COMPLETE_STAGES = (
    "sequential", "parameter-changed", "restored-cold-seek", "after-cancel",
    "worker-killed", "after-restart", "after-restart-recomputed",
)
REQUIRED_CHECKS = frozenset({
    "sequential_preview_export_identical", "parameter_change_visible_and_preview_export_identical",
    "parameter_restore_and_cold_seek_identical", "cache_cleared_identical",
    "cancel_ipc_entered_with_pending_frame", "cancel_then_export_identical",
    "worker_killed_mid_export_recovered", "restart_cached_identical",
    "restart_cache_cleared_identical", "restart_session_identity_reused",
})
STATUS_LABELS = {"passed": "通过", "failed": "失败", "running": "运行中（未验收）",
                 "incomplete": "证据不完整（未验收）", "unknown": "未声明总态（未验收）"}


def digest_comparison(*, values, reference, frames, digits):
    pattern = re.compile(rf"[a-f0-9]{{{digits}}}")
    valid = (isinstance(values, list) and len(values) == frames
             and all(isinstance(value, str) and pattern.fullmatch(value) for value in values))
    reference_valid = (isinstance(reference, list) and len(reference) == frames
                       and all(isinstance(value, str) and pattern.fullmatch(value) for value in reference))
    matches = sum(left == right for left, right in zip(values, reference)) if valid and reference_valid else None
    return {"count": len(values) if isinstance(values, list) else 0, "complete": bool(valid),
            "identical_frames": matches, "different_frames": frames - matches if matches is not None else None}


def verify_decoded_exports(*, record, directory, ffmpeg="ffmpeg"):
    """Recompute actual RGBA framemd5, including exports whose JSON omitted digests."""
    verified = {}
    for stage in COMPLETE_STAGES:
        source = directory / f"export-{stage}.mp4"
        if not source.exists():
            verified[stage] = {"status": "missing", "path": str(source)}
            continue
        try:
            result = subprocess.run([str(ffmpeg), "-v", "error", "-xerror", "-i", str(source),
                                     "-map", "0:v:0", "-an", "-pix_fmt", "rgba", "-f", "framemd5", "-"],
                                    capture_output=True, text=True, check=True, timeout=120)
            digests = [line.split(",")[-1].strip() for line in result.stdout.splitlines()
                       if line.strip() and not line.startswith("#")]
            recorded = record.get(stage, {}).get("decodedFrameDigests")
            verified[stage] = {"status": "verified", "path": str(source), "decoder": str(ffmpeg), "decodedFrameDigests": digests,
                               "matches_recorded": digests == recorded if recorded is not None else None}
        except (OSError, subprocess.SubprocessError) as error:
            verified[stage] = {"status": "failed", "path": str(source), "error": str(error)}
    return verified


def stage_summary(*, record, stage, frames, verified_videos=None):
    rows = record.get("preEncodeStages", {}).get(stage)
    reference_rows = record.get("preEncodeStages", {}).get("sequential")
    def hashes(rows):
        if not isinstance(rows, list) or any(not isinstance(row, dict) or type(row.get("frame")) is not int or row["frame"] != index
                                            for index, row in enumerate(rows)):
            return None
        return [row.get("rgbaSha256") for row in rows]
    sha = digest_comparison(values=hashes(rows), reference=hashes(reference_rows), frames=frames, digits=64)
    video = verified_videos.get(stage) if verified_videos else None
    reference_video = verified_videos.get("sequential") if verified_videos else None
    decoded = digest_comparison(values=(video or record.get(stage, {})).get("decodedFrameDigests"),
                                reference=(reference_video or record.get("sequential", {})).get("decodedFrameDigests"),
                                frames=frames, digits=32)
    decoded["source"] = "actual-export" if video else "e2e-record"
    if video:
        decoded["verification"] = {key: value for key, value in video.items() if key != "decodedFrameDigests"}
    expectation = "changed" if stage == "parameter-changed" else "partial" if stage == "cancelled" else "identical"
    return {"stage": stage, "expectation": expectation, "pre_encode_sha256": sha, "decoded_md5": decoded}


def pending_cancel_summary(*, record):
    cancelled = record.get("cancelled", {})
    entry = cancelled.get("pendingAtCancel")
    if not isinstance(entry, dict):
        return {"recorded": False, "captured_frames": cancelled.get("capturedFrames")}
    request = entry.get("sequenceRequest") or {}
    pending = entry.get("pending") or []
    active = entry.get("activeSequenceRequests") or []
    frame = request.get("frame")
    matching = [row for row in pending if row.get("frame") == frame
                and isinstance(row.get("startedAt"), (int, float))
                and isinstance(request.get("enteredAt"), (int, float))
                and row["startedAt"] >= request["enteredAt"]]
    verified = (entry.get("cancelled") is True and frame is not None and bool(matching)
                and sum(row.get("frame") == frame for row in active) == 1)
    return {"recorded": True, "pending_frame_verified": verified, "frame": frame,
            "request_id": request.get("requestId"), "worker_pids": [row.get("pid") for row in matching],
            "captured_frames": cancelled.get("capturedFrames")}


def worker_kill_summary(*, record):
    killed = record.get("workerKilled")
    if not isinstance(killed, dict):
        return {"recorded": False}
    request = killed.get("inFlightRequest") or {}
    observation = killed.get("observation") or {}
    pid = request.get("pid")
    spawned = observation.get("spawned", [])
    position = spawned.index(pid) if type(pid) is int and pid > 0 and pid in spawned else None
    replacement = [candidate for candidate in spawned[position + 1:]
                   if type(candidate) is int and candidate > 0 and candidate != pid
                   and candidate not in observation.get("exited", [])] if position is not None else []
    return {"recorded": True, "frame": request.get("frame"), "worker_pid": pid,
            "replacement_pids": replacement, "killed_pid_exited": pid in observation.get("exited", []),
            "export_error_recorded": "error" in killed, "export_error": killed.get("error"),
            "resumptions": observation.get("resumptions", [])}


def summarize(*, record, verified_videos=None):
    declared = record.get("status")
    frames = record.get("frames")
    checks = record.get("checks") or {}
    stages = []
    if type(frames) is int and frames > 0:
        names = list(dict.fromkeys([*COMPLETE_STAGES, *record.get("preEncodeStages", {})]))
        stages = [stage_summary(record=record, stage=name, frames=frames, verified_videos=verified_videos) for name in names]
    parameter = record.get("parameterChange")
    status = declared if declared in ("passed", "failed", "running") else "unknown"
    complete_rows = [row for row in stages if row["stage"] in COMPLETE_STAGES]
    evidence_complete = len(complete_rows) == len(COMPLETE_STAGES) and all(
        row["pre_encode_sha256"]["complete"] and row["decoded_md5"]["complete"] for row in complete_rows)
    comparison_failed = any(
        any(row[plane]["different_frames"] not in (None, 0) for plane in ("pre_encode_sha256", "decoded_md5"))
        if row["expectation"] == "identical" else
        any(row[plane]["different_frames"] == 0 for plane in ("pre_encode_sha256", "decoded_md5"))
        if row["expectation"] == "changed" else False
        for row in stages)
    video_failed = any(row.get("status") == "failed" or row.get("matches_recorded") is False
                       for row in (verified_videos or {}).values())
    cancel, worker_kill = pending_cancel_summary(record=record), worker_kill_summary(record=record)
    missing_checks = sorted(REQUIRED_CHECKS - checks.keys()) if record.get("schemaVersion", 1) >= 2 else []
    incomplete_recovery = []
    if not cancel.get("pending_frame_verified"):
        incomplete_recovery.append("cancel_pending_frame")
    if not worker_kill.get("killed_pid_exited"):
        incomplete_recovery.append("killed_worker_exit")
    if not worker_kill.get("replacement_pids"):
        incomplete_recovery.append("replacement_worker")
    if not worker_kill.get("export_error_recorded"):
        incomplete_recovery.append("worker_kill_export_result")
    recovery_complete = not incomplete_recovery and worker_kill.get("export_error") is None
    failed_checks = any(value is not True for value in checks.values())
    observed_failure = (worker_kill.get("export_error") is not None or video_failed or failed_checks
                        or comparison_failed or bool(record.get("failure")) or bool(record.get("errors")))
    incomplete_schema_two = (record.get("schemaVersion", 1) >= 2
                             and (missing_checks or not evidence_complete or not recovery_complete))
    if status == "passed":
        if observed_failure:
            status = "failed"
        elif incomplete_schema_two:
            status = "incomplete"
    return {"status": status, "label": STATUS_LABELS[status], "declared_status": declared,
            "schema_version": record.get("schemaVersion", 1), "frames": frames, "checks": checks,
            "failure": record.get("failure"), "stages": stages, "full_frame_evidence_complete": evidence_complete,
            "missing_required_checks": missing_checks, "recovery_evidence_complete": recovery_complete,
            "incomplete_recovery_evidence": incomplete_recovery,
            "parameter_change": {**parameter, "changed_frame_count": len(parameter.get("changedFrames", []))}
            if isinstance(parameter, dict) else None,
            "cancel": cancel, "worker_kill": worker_kill}


def structured(*, value):
    if value is None:
        return "<p>未记录。</p>"
    return f'<pre>{html.escape(json.dumps(value, ensure_ascii=False, indent=2))}</pre>'


def plane_label(*, result, frames):
    source = "；从实际导出复核" if result.get("source") == "actual-export" else ""
    if not result["complete"]:
        return f'{result["count"]}/{frames} 帧；证据不完整{source}'
    identical = result["identical_frames"]
    return (f'{frames}/{frames} 帧；参考证据不完整' if identical is None
            else f'{frames}/{frames} 帧；相同 {identical}，不同 {result["different_frames"]}{source}')


def render(*, summary):
    checks = "".join(f'<li>{html.escape(name)}：{"通过" if value is True else "未通过"}</li>'
                     for name, value in summary["checks"].items())
    rows = "".join(
        f'<tr><th>{html.escape(row["stage"])}</th><td>{html.escape(row["expectation"])}</td>'
        f'<td>{plane_label(result=row["pre_encode_sha256"], frames=summary["frames"])}</td>'
        f'<td>{plane_label(result=row["decoded_md5"], frames=summary["frames"])}</td></tr>'
        for row in summary["stages"])
    parameter = summary["parameter_change"]
    parameter_html = (f'<p>参数变更：{html.escape(str(parameter.get("control", "未记录")))}，'
                      f'{html.escape(str(parameter.get("from", "未记录")))} → {html.escape(str(parameter.get("to", "未记录")))}；'
                      f'记录受影响 {parameter["changed_frame_count"]} 帧。</p>') if parameter else '<p>参数变更：未记录。</p>'
    failure = f'<pre>{html.escape(str(summary["failure"]))}</pre>' if summary["failure"] else ""
    missing = [*summary["missing_required_checks"], *summary["incomplete_recovery_evidence"]]
    missing_html = f'<p>缺失或未证实：{html.escape("、".join(missing))}</p>' if missing else ""
    css = "pass" if summary["status"] == "passed" else "fail"
    return (f'<h2>编辑器操作验收</h2><p class="{css}">总态：{summary["label"]}；'
            f'原始记录状态：{html.escape(str(summary["declared_status"] or "未提供"))}。</p>{failure}{missing_html}'
            f'<p>以下各项只反映已记录步骤；部分检查通过不能替代总体验收。</p><ul>{checks}</ul>{parameter_html}'
            f'<h3>逐阶段全帧证据</h3><p>每阶段与自身 sequential 参考比较；parameter-changed 预期有变化，cancelled 为中止阶段。'
            f'编码前 SHA 来自逐帧采样；解码 MD5 默认读取 E2E 记录，不重新解码；标注“从实际导出复核”时使用重新解码结果。</p>'
            f'<table><thead><tr><th>阶段</th><th>预期</th><th>编码前 RGBA SHA256</th><th>导出解码 MD5</th></tr></thead>'
            f'<tbody>{rows}</tbody></table><h3>取消时的实际 pending</h3>{structured(value=summary["cancel"])}'
            f'<h3>运行中 worker kill 与恢复</h3>{structured(value=summary["worker_kill"])}')
