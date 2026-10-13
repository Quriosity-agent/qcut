"""Compare saved, unencoded beauty timeline frames without geometric alignment."""

import argparse
import hashlib
import html
import json
import math
from pathlib import Path
import re

import numpy as np
from PIL import Image


MODE_LABELS = {"original": "原画面", "native": "原生", "independent": "自研"}


def require_all_modes(*, values, label):
    if (not isinstance(values, list) or len(values) != len(MODE_LABELS)
            or any(not isinstance(value, str) for value in values)
            or set(values) != set(MODE_LABELS)):
        raise ValueError(f"{label} must contain original, native and independent exactly once")


def validate_e2e_evidence(*, evidence):
    recorded = json.loads((evidence / "e2e-evidence.json").read_text())
    if not isinstance(recorded, dict) or recorded.get("status") != "captured":
        raise ValueError("E2E evidence status must be captured")
    require_all_modes(values=recorded.get("requestedPasses"), label="requestedPasses")
    for name in ("duration", "fps"):
        value = recorded.get(name)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"E2E {name} must be finite and positive")
    frame_duration = recorded["duration"] * recorded["fps"]
    if not math.isfinite(frame_duration):
        raise ValueError("E2E duration times fps must be finite")
    # The harness uses Math.round, which rounds positive half-frames upward.
    expected_count = math.floor(frame_duration + 0.5)
    total_frames = recorded.get("totalFrames")
    if type(total_frames) is not int or total_frames < 1 or total_frames != expected_count:
        raise ValueError("E2E totalFrames must equal rounded duration times fps")
    completed = recorded.get("completed")
    if not isinstance(completed, list) or any(not isinstance(row, dict) for row in completed):
        raise ValueError("E2E completed must describe every completed export")
    require_all_modes(values=[row.get("pass") for row in completed], label="completed passes")
    for row in completed:
        exported = row.get("exported")
        probe = exported.get("probe") if isinstance(exported, dict) else None
        count = probe.get("frameCount") if isinstance(probe, dict) else None
        if type(count) is not int or count != total_frames:
            raise ValueError(f"{row['pass']} exported frameCount must equal totalFrames ({total_frames})")
    samples = recorded.get("sampleIndices")
    if (not isinstance(samples, list) or not samples
            or any(type(frame) is not int or frame < 0 or frame >= total_frames for frame in samples)
            or len(set(samples)) != len(samples)):
        raise ValueError("sampleIndices must contain unique, nonempty integer indices within totalFrames")
    for mode in MODE_LABELS:
        for kind in ("export", "preview"):
            expected = {f"{kind}-frame-{frame:06d}.png" for frame in samples}
            canonical = re.compile(rf"{kind}-frame-[0-9]+\.png")
            actual = {path.name for path in (evidence / mode).glob(f"{kind}-frame-*.png")
                      if path.is_file() and canonical.fullmatch(path.name)}
            if actual != expected:
                raise ValueError(f"{mode} {kind} PNG samples must exactly match sampleIndices; "
                                 f"missing={sorted(expected - actual)}, extra={sorted(actual - expected)}")
    return {"status": recorded["status"], "completed_passes": list(MODE_LABELS),
            "duration": recorded["duration"], "fps": recorded["fps"],
            "total_frames": total_frames, "sample_indices": sorted(samples)}


def compare_pixels(*, reference, candidate):
    if reference.size != candidate.size:
        raise ValueError(f"Frame dimensions differ: {reference.size} vs {candidate.size}")
    before = np.asarray(reference.convert("RGBA"))
    after = np.asarray(candidate.convert("RGBA"))
    delta = np.abs(after.astype(np.int16) - before.astype(np.int16))
    rgb = delta[:, :, :3]
    magnitude = rgb.max(axis=2)
    return {
        "width": reference.width,
        "height": reference.height,
        "max_rgb": int(rgb.max()),
        "mean_rgb": float(rgb.mean()),
        "p99_rgb": float(np.percentile(rgb, 99)),
        "changed_pixels": int(np.count_nonzero(magnitude)),
        "pixels_over_one": int(np.count_nonzero(magnitude > 1)),
        "max_alpha": int(delta[:, :, 3].max()),
        "reference_rgba_sha256": hashlib.sha256(before.tobytes()).hexdigest(),
        "candidate_rgba_sha256": hashlib.sha256(after.tobytes()).hexdigest(),
        "within_one_rgb": bool(rgb.max() <= 1 and delta[:, :, 3].max() == 0),
    }, Image.fromarray(np.minimum(magnitude.astype(np.uint16) * 4, 255).astype(np.uint8))


def compare_files(*, reference, candidate, difference):
    with Image.open(reference) as before, Image.open(candidate) as after:
        metrics, display = compare_pixels(reference=before, candidate=after)
    display.save(difference)
    return {"reference": str(reference), "candidate": str(candidate),
            "difference": str(difference), **metrics}


def summarize_preview_parity(*, records):
    summary = {}
    for mode in MODE_LABELS:
        comparisons = [row["comparisons"][f"{mode}_preview_export"] for row in records]
        failed_frames = [row["frame"] for row in records
                         if not row["comparisons"][f"{mode}_preview_export"]["within_one_rgb"]]
        summary[mode] = {
            "passed": not failed_frames,
            "max_rgb": max(item["max_rgb"] for item in comparisons),
            "max_alpha": max(item["max_alpha"] for item in comparisons),
            "failed_frames": failed_frames,
        }
    return summary


def parity_badge(*, passed):
    status = "PASS" if passed else "FAIL"
    return f'<strong class="{status.lower()}">{status}</strong>'


def render_parity_summary(*, summary):
    status = "PASS" if all(item["passed"] for item in summary.values()) else "FAIL"
    rows = []
    for mode, item in summary.items():
        failed = ", ".join(str(frame) for frame in item["failed_frames"]) or "—"
        rows.append(
            f'<tr data-mode="{mode}"><th scope="row">{MODE_LABELS[mode]}</th>'
            f'<td>{parity_badge(passed=item["passed"])}</td>'
            f'<td>{item["max_rgb"]}</td><td>{item["max_alpha"]}</td><td>{failed}</td></tr>'
        )
    return (
        f'<section><h2>预览／导出验收：{status}</h2>'
        '<p>每种模式的全部采样帧须满足最大 RGB 差 ≤ 1，且 Alpha 完全相同。'
        '原生／自研算法差异不参与通过／失败门槛。</p>'
        '<table><thead><tr><th>模式</th><th>结果</th><th>最大 RGB 差</th>'
        '<th>最大 Alpha 差</th><th>失败帧</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></section>'
    )


def build_report(*, evidence):
    modes = tuple(MODE_LABELS)
    e2e_validation = validate_e2e_evidence(evidence=evidence)
    output = evidence / "comparison"
    output.mkdir(exist_ok=True)
    records = []
    sections = []
    for frame_index in e2e_validation["sample_indices"]:
        frame = f"{frame_index:06d}"
        comparisons = {}
        for mode in modes:
            comparisons[f"{mode}_preview_export"] = compare_files(
                reference=evidence / mode / f"export-frame-{frame}.png",
                candidate=evidence / mode / f"preview-frame-{frame}.png",
                difference=output / f"{mode}-preview-export-{frame}.png")
        for name, left, right in [("native_independent", "native", "independent"),
                                  ("original_native", "original", "native"),
                                  ("original_independent", "original", "independent")]:
            comparisons[name] = compare_files(
                reference=evidence / left / f"export-frame-{frame}.png",
                candidate=evidence / right / f"export-frame-{frame}.png",
                difference=output / f"{name}-{frame}.png")
        records.append({"frame": int(frame), "comparisons": comparisons})
        columns = [("原画面", f"../original/export-frame-{frame}.png"),
                   ("原生", f"../native/export-frame-{frame}.png"),
                   ("自研", f"../independent/export-frame-{frame}.png"),
                   ("原生 ↔ 自研差分 ×4", f"native_independent-{frame}.png")]
        columns.extend((f"{label}预览 ↔ 导出差分 ×4", f"{mode}-preview-export-{frame}.png")
                       for mode, label in MODE_LABELS.items())
        figures = "".join(f'<figure><a href="{url}"><img loading="lazy" src="{url}" alt="{html.escape(label)}"></a><figcaption>{html.escape(label)}</figcaption></figure>' for label, url in columns)
        parity_rows = []
        for mode, label in MODE_LABELS.items():
            parity = comparisons[f"{mode}_preview_export"]
            parity_rows.append(
                f'<li>{label}预览／导出：{parity_badge(passed=parity["within_one_rgb"])}，'
                f'最大 RGB 差 {parity["max_rgb"]}，均差 {parity["mean_rgb"]:.6f}，'
                f'最大 Alpha 差 {parity["max_alpha"]}，超 1 像素 {parity["pixels_over_one"]:,}。</li>'
            )
        native = comparisons["native_independent"]
        sections.append(f'<section><h2>帧 {int(frame)}</h2><ul>{"".join(parity_rows)}</ul><p>原生／自研算法差异：最大 RGB 差 {native["max_rgb"]}，均差 {native["mean_rgb"]:.6f}。</p><div class="frames">{figures}</div></section>')
    summary = summarize_preview_parity(records=records)
    report = {
        "schema_version": 1,
        "e2e_validation": e2e_validation,
        "method": "Exact decoded PNG RGBA; no resize, registration, blur or codec involved. Difference display is max absolute RGB channel difference with fixed gain 4.",
        "sample_count": len(records),
        "preview_export_passed": all(item["passed"] for item in summary.values()),
        "preview_export_summary": summary,
        "preview_export_within_one_rgb": {mode: item["passed"] for mode, item in summary.items()},
        "native_independent_within_one_rgb": all(row["comparisons"]["native_independent"]["within_one_rgb"] for row in records),
        "frames": records,
    }
    (output / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    summary_html = render_parity_summary(summary=summary)
    body = "".join(sections)
    videos = "".join(f'<figure><video controls preload="metadata" src="../{mode}/export.mp4"></video><figcaption>{label}</figcaption></figure>' for mode, label in MODE_LABELS.items())
    (output / "index.html").write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>1080p 竖屏美颜一致性</title><style>body{{margin:32px;background:#17191d;color:#e8eaee;font:16px/1.65 system-ui}}h1{{font-size:28px}}section{{border-top:1px solid #40444b;padding:20px 0}}.frames,.videos{{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}}.videos{{grid-template-columns:repeat(3,minmax(0,1fr));max-width:960px}}figure{{margin:0}}img,video{{width:100%;background:#000}}figcaption{{color:#b8c0cb}}a{{color:#8bc5ff}}table{{border-collapse:collapse}}th,td{{text-align:left;padding:8px 16px;border:1px solid #40444b}}.pass{{color:#86dfa6}}.fail{{color:#ff9999}}@media(max-width:800px){{.frames{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}</style><h1>1080p 竖屏 · 原生 / 自研 / 差分</h1><p>下方 PNG 来自实际编码前导出画布；预览来自暂停后的实际画面。差分统一放大 ×4，不做模糊、对齐或逐图归一化。指标仅覆盖这些采样帧；原生差异与预览／导出差异分别记录。</p><p><a href="metrics.json">完整逐帧指标</a> · <a href="../e2e-evidence.json">测试证据与范围</a></p>{summary_html}<div class="videos">{videos}</div>{body}</html>''')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    report = build_report(evidence=args.evidence.resolve())
    print(json.dumps({key: value for key, value in report.items() if key != "frames"}, indent=2))
    return 0 if report["preview_export_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
