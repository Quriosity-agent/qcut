"""Verify four native body passes, sampled PNG consistency and complete video exports."""

import argparse
import html
import importlib.util
import json
import math
from pathlib import Path
import subprocess

from PIL import Image


def load_sibling(*, filename):
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"),
                                                Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PNG = load_sibling(filename="compare-beauty-timeline-evidence.py")
VIDEO = load_sibling(filename="analyze-beauty-timeline-video.py")
MODE_LABELS = {"original": "无美体基线", "smart": "智能美体", "manual": "手动美体", "combined": "智能＋手动"}
PREVIEW_KINDS = {"ui": "", "composition": "-composition"}
COMBINATION_PAIRS = {"smart_combined": "smart", "manual_combined": "manual"}


def validate_body_evidence(*, evidence):
    validation = PNG.validate_e2e_evidence(evidence=evidence, modes=tuple(MODE_LABELS))
    recorded = json.loads((evidence / "e2e-evidence.json").read_text())
    dimensions = tuple(recorded.get(key) for key in ("width", "height"))
    if any(type(value) is not int or not 1 <= value <= 4096 for value in dimensions):
        raise ValueError("E2E width and height must be positive bounded integers")
    PNG.validate_png_samples(evidence=evidence, modes=tuple(MODE_LABELS),
                             samples=validation["sample_indices"], kind="preview", suffix="-composition")
    for mode in MODE_LABELS:
        for frame in validation["sample_indices"]:
            names = [f"export-frame-{frame:06d}.png"]
            names.extend(f"preview-frame-{frame:06d}{suffix}.png" for suffix in PREVIEW_KINDS.values())
            for name in names:
                with Image.open(evidence / mode / name) as image:
                    if image.size != dimensions:
                        raise ValueError(f"{mode}/{name} dimensions {image.size} differ from E2E {dimensions}")
                    if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
                        raise ValueError(f"{mode}/{name} must be a single PNG frame")
                    image.load()
    return {**validation, "width": dimensions[0], "height": dimensions[1]}


def decode_export(*, path):
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-i", str(path),
                    "-map", "0:v:0", "-an", "-f", "null", "-"],
                   check=True, capture_output=True, timeout=180)


def audit_encoded_exports(*, evidence, validation):
    media, failures = {}, []
    for mode in MODE_LABELS:
        path = evidence / mode / "export.mp4"
        decode_export(path=path)
        probe = VIDEO.probe_media(path=path)
        video, timestamps = probe["video"], probe["video_timestamps"]
        count, rate = VIDEO.frame_count(video=video), VIDEO.frame_rate(video=video)
        geometry = video.get("width") == validation["width"] and video.get("height") == validation["height"]
        complete = count == validation["total_frames"] and timestamps["count"] == validation["total_frames"]
        fps_matches = rate is not None and math.isclose(rate, validation["fps"], abs_tol=1e-6)
        passed = geometry and complete and fps_matches and timestamps["strictly_increasing"]
        if not passed:
            failures.append(mode)
        media[mode] = {"probe": probe, "complete_decode_passed": True, "frame_count": count,
                       "geometry_matches": geometry, "frame_count_matches": complete,
                       "fps_matches": fps_matches, "passed": passed}
    baseline = media["original"]["probe"]["video_timestamps"]["sha256"]
    matching_pts = all(row["probe"]["video_timestamps"]["sha256"] == baseline for row in media.values())
    return {"verified": True, "passed": not failures and matching_pts,
            "failed_modes": failures, "presentation_timestamps_equal": matching_pts, "modes": media,
            "scope": "Complete FFmpeg decode, decoded frame counts, encoded geometry, FPS and full PTS sequences only. No MP4 pixel parity or audio acceptance."}


def summarize_change_activity(*, rows):
    changed = [frame for frame, result in rows if result["changed_pixels"] > 0]
    alpha = max(result["max_alpha"] for _, result in rows)
    failures = ([] if changed else ["no_sampled_rgb_change"]) + ([] if alpha == 0 else ["alpha_changed"])
    return {"passed": not failures, "changed_frames": changed,
            "changed_pixels_sum": sum(result["changed_pixels"] for _, result in rows),
            "max_alpha": alpha, "failures": failures,
            "scope": "Visible RGB changes on at least one sampled frame; no aesthetic, tracking or anatomy correctness claim."}


def summarize(*, records):
    parity, effects = {}, {}
    for mode in MODE_LABELS:
        parity[mode] = {}
        for kind in PREVIEW_KINDS:
            rows = [(row["frame"], row["comparisons"][f"{mode}_{kind}_export"]) for row in records]
            failed = [frame for frame, result in rows if not result["within_one_rgb"]]
            parity[mode][kind] = {"passed": not failed, "failed_frames": failed,
                                  "max_rgb": max(result["max_rgb"] for _, result in rows),
                                  "max_alpha": max(result["max_alpha"] for _, result in rows)}
        if mode == "original":
            continue
        rows = [(row["frame"], row["comparisons"][f"original_{mode}"]) for row in records]
        effects[mode] = summarize_change_activity(rows=rows)
    combination = {name: summarize_change_activity(
        rows=[(row["frame"], row["comparisons"][name]) for row in records]) for name in COMBINATION_PAIRS}
    return parity, effects, combination


def frame_figures(*, frame):
    figures = []
    for mode, label in MODE_LABELS.items():
        figures.append((label, f"../{mode}/export-frame-{frame:06d}.png"))
        figures.append((f"无美体基线 ↔ {label}差分 ×4", f"original_{mode}-{frame:06d}.png"))
        for kind, suffix in PREVIEW_KINDS.items():
            name = "实际 UI" if kind == "ui" else "直接合成画布"
            figures.append((f"{label} {name} ↔ 导出差分 ×4", f"{mode}-{kind}-export-{frame:06d}.png"))
    figures.extend((f"{MODE_LABELS[mode]} ↔ 智能＋手动差分 ×4", f"{name}-{frame:06d}.png")
                   for name, mode in COMBINATION_PAIRS.items())
    return "".join(f'<figure><a href="{url}"><img loading="lazy" src="{url}" alt="{html.escape(label)}"></a>'
                   f'<figcaption>{html.escape(label)}</figcaption></figure>' for label, url in figures)


def write_gallery(*, output, report):
    status = report["verification_status"]
    rows = []
    for mode, label in MODE_LABELS.items():
        for kind, summary in report["preview_export_summary"][mode].items():
            rows.append(f'<tr><th>{label} / {kind}</th><td>{PNG.parity_badge(passed=summary["passed"])}</td>'
                        f'<td>{summary["max_rgb"]}</td><td>{summary["max_alpha"]}</td>'
                        f'<td>{html.escape(str(summary["failed_frames"]))}</td></tr>')
    effects = "".join(f'<li>{MODE_LABELS[mode]}生效检查：{PNG.parity_badge(passed=result["passed"])}；'
                      f'变化采样帧 {html.escape(str(result["changed_frames"]))}</li>'
                      for mode, result in report["effect_activity"].items())
    combinations = "".join(f'<li>{MODE_LABELS[COMBINATION_PAIRS[name]]} ↔ 智能＋手动：'
                           f'{PNG.parity_badge(passed=result["passed"])}；变化采样帧 '
                           f'{html.escape(str(result["changed_frames"]))}</li>'
                           for name, result in report["combination_activity"].items())
    sections = "".join(f'<section><h2>帧 {row["frame"]}</h2><div class="frames">'
                       f'{frame_figures(frame=row["frame"])}</div></section>' for row in report["frames"])
    videos = "".join(f'<figure><video controls preload="metadata" src="../{mode}/export.mp4"></video>'
                     f'<figcaption>{label}</figcaption></figure>' for mode, label in MODE_LABELS.items())
    (output / "index.html").write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>美体暂停采样预览／导出一致性</title>
<style>body{{margin:28px;background:#17191d;color:#e8eaee;font:16px/1.6 system-ui}}.frames,.videos{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}section{{border-top:1px solid #555;padding:24px 0}}figure{{margin:0}}img,video{{width:100%;background:#000}}a{{color:#8bc5ff}}td,th{{padding:8px;border:1px solid #555}}table{{border-collapse:collapse}}.pass{{color:#86dfa6}}.fail{{color:#ff9999}}@media(max-width:700px){{.frames,.videos{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}</style>
<h1>美体暂停采样预览／导出：{status}</h1><p><strong>本轮验证暂停后定位到采样帧的预览一致性；连续实时播放的预览性能和时序一致性尚未验收。</strong></p><p>四路：无美体基线、原生智能、原生手动、原生智能＋手动。基线保留相同的关键帧、裁剪和转场，并非未经编辑的源文件原图。</p>
<p>PNG 是实际编码前导出画布、暂停定位后的实际 UI 截图和直接合成画布。逐像素 RGB ≤ 1 且 Alpha 完全相同；不缩放、不对齐。差分固定 ×4。</p>
<p>仅采样 PNG 接受像素一致性检查。MP4 只检查完整解码、帧数、尺寸、帧率和呈现时间戳；没有声画同步、原生算法正确性或自研美体的结论。</p>
<p>完整视频验证：{html.escape(str(report["encoded_video"]["verified"]))}；PNG 样本通过：{report["png_samples_passed"]}。</p>
<p><a href="metrics.json">逐帧指标与边界</a> · <a href="../e2e-evidence.json">E2E 记录</a></p>
<table><thead><tr><th>模式／预览</th><th>结果</th><th>最大 RGB</th><th>最大 Alpha</th><th>失败帧</th></tr></thead><tbody>{"".join(rows)}</tbody></table>
<p>智能＋手动须分别区别于智能单独、手动单独；全部采样 RGB 相同或 Alpha 改变即失败。该检查不证明每个子滑杆都独立生效。</p>
<ul>{effects}{combinations}</ul><div class="videos">{videos}</div>{sections}</html>''')


def build_report(*, evidence, verify_encoded=True):
    output = evidence / "body-comparison"
    for name in ("metrics.json", "index.html"):
        (output / name).unlink(missing_ok=True)
    validation = validate_body_evidence(evidence=evidence)
    encoded = audit_encoded_exports(evidence=evidence, validation=validation) if verify_encoded else {
        "verified": False, "passed": False, "scope": "PNG-only run; exported frame counts are recorded E2E claims and have not been independently decoded."}
    output.mkdir(exist_ok=True)
    records = []
    for frame in validation["sample_indices"]:
        comparisons = {}
        for mode in MODE_LABELS:
            exported = evidence / mode / f"export-frame-{frame:06d}.png"
            for kind, suffix in PREVIEW_KINDS.items():
                comparisons[f"{mode}_{kind}_export"] = PNG.compare_files(
                    reference=exported,
                    candidate=evidence / mode / f"preview-frame-{frame:06d}{suffix}.png",
                    difference=output / f"{mode}-{kind}-export-{frame:06d}.png")
            comparisons[f"original_{mode}"] = PNG.compare_files(
                reference=evidence / "original" / f"export-frame-{frame:06d}.png", candidate=exported,
                difference=output / f"original_{mode}-{frame:06d}.png")
        for name, mode in COMBINATION_PAIRS.items():
            comparisons[name] = PNG.compare_files(
                reference=evidence / mode / f"export-frame-{frame:06d}.png",
                candidate=evidence / "combined" / f"export-frame-{frame:06d}.png",
                difference=output / f"{name}-{frame:06d}.png")
        records.append({"frame": frame, "comparisons": comparisons})
    parity, effects, combination = summarize(records=records)
    parity_passed = all(item["passed"] for mode in parity.values() for item in mode.values())
    effects_passed = all(item["passed"] for item in effects.values())
    combination_passed = all(item["passed"] for item in combination.values())
    png_passed = parity_passed and effects_passed and combination_passed
    passed = png_passed and encoded["verified"] and encoded["passed"]
    status = "PASS" if passed else "PNG_ONLY" if png_passed and not verify_encoded else "FAIL"
    report = {"schema_version": 1, "scope": "native body four-pass paused sampled preview/export consistency",
              "verification_status": status, "overall_verified": passed,
              "e2e_validation": validation, "sample_count": len(records),
              "preview_export_passed": parity_passed, "preview_export_summary": parity,
              "effect_activity_passed": effects_passed, "effect_activity": effects,
              "combination_activity_passed": combination_passed, "combination_activity": combination,
              "png_samples_passed": png_passed, "encoded_video": encoded,
              "method": "Exact PNG RGBA; no alignment, resizing or encoding. Paused previews seek to sampled frames; UI and direct-composition previews each compared with pre-encode export. Difference display: max absolute RGB channel times four.",
              "limitations": ["Preview parity covers paused, explicitly sought sample frames only; continuous real-time preview playback performance and temporal consistency are not accepted.",
                              "PNG parity covers sampled frames only; complete video decoding does not prove all-frame pixel parity.",
                              "The original pass is a no-body-effects baseline with the same timeline crop, keyframes and transitions, not untouched source pixels.",
                              "Combination changes against both single paths do not prove every individual body control is effective.",
                              "Effects changing pixels does not prove body tracking, anatomy, segmentation or visual quality.",
                              "Native smart/manual/combined paths only; independent body rendering is not tested.",
                              "No encoded MP4 pixel-equality or audio-synchronization acceptance."], "frames": records}
    (output / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    write_gallery(output=output, report=report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--png-only", action="store_true", help="Diagnostic PNG report; never declares complete verification")
    args = parser.parse_args()
    report = build_report(evidence=args.evidence.resolve(), verify_encoded=not args.png_only)
    print(json.dumps({key: value for key, value in report.items() if key not in ("frames", "encoded_video")}, indent=2))
    return 0 if report["png_samples_passed"] and (args.png_only or report["overall_verified"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
