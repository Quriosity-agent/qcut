"""Single-person dynamic body closure: three-way comparison page from the E2E evidence.

Consumes the folder written by body-video-close-threeway.e2e.ts (one subfolder per
pass with export.mp4, pre-encode export-frame PNGs and paused-preview composition
PNGs) and, optionally, the invariance evidence from
portrait-independent-body-video-close.e2e.ts.

Produces <evidence>/report/: metrics.json, difference videos, worst-frame strips and
index.html (原图 / 原生 / 自研 / 差分 + full videos + worst-frame notes).

Decoded MP4 frames serve the recorded frame-count statistics. Picture differences
do not establish detector or tracking state. The ≤1 level paused-preview/export
claim is made only on pre-encode PNG samples.
"""

import argparse
import html
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image


def load_sibling(*, filename):
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"),
                                                Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PNG = load_sibling(filename="compare-beauty-timeline-evidence.py")
VIDEO = load_sibling(filename="analyze-beauty-timeline-video.py")
OPERATIONS = load_sibling(filename="body-video-operation-report.py")

PASS_LABELS = {"original": "原图", "native": "原生", "independent": "自研"}
PAIRS = {
    "original_native": ("original", "native", "原图 ↔ 原生（原生效果量）"),
    "original_independent": ("original", "independent", "原图 ↔ 自研（自研效果量）"),
    "native_independent": ("native", "independent", "原生 ↔ 自研（对齐误差）"),
}
# Encode noise on a static region is a few levels; a body edit moves pixels by far more.
EFFECT_THRESHOLD = 8
STRIP_WIDTH = 270
STRIP_HEIGHT = 480


def frames_of(*, evidence, mode, width, height):
    return list(VIDEO.rgb_frames(path=evidence / mode / "export.mp4", width=width, height=height))


def band_profile(*, mask, bands=8):
    height = mask.shape[0]
    edges = np.linspace(0, height, bands + 1).astype(int)
    return [float(mask[edges[i]:edges[i + 1]].mean()) for i in range(bands)]


BLOCK = 8


def block_mean(*, magnitude):
    """8×8 block means of |Δ|: a body edit lifts whole blocks, encoder noise does not."""
    height, width = magnitude.shape
    h, w = height - height % BLOCK, width - width % BLOCK
    return magnitude[:h, :w].reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK).mean(axis=(1, 3))


def effect_region(*, before, after):
    """Where a pass changed the picture versus the untouched frame (block level)."""
    magnitude = np.abs(after.astype(np.int16) - before.astype(np.int16)).max(axis=2)
    blocks = block_mean(magnitude=magnitude)
    mask = blocks > EFFECT_THRESHOLD
    changed = int(mask.sum())
    summary = {"mean_abs_rgb": float(magnitude.mean()), "max_abs_rgb": int(magnitude.max()),
               "bands": band_profile(mask=mask)}
    if changed == 0:
        return {"changed_fraction": 0.0, "bbox": None, **summary}
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    bbox = {"x0": int(cols[0]) * BLOCK, "y0": int(rows[0]) * BLOCK,
            "x1": (int(cols[-1]) + 1) * BLOCK, "y1": (int(rows[-1]) + 1) * BLOCK}
    height, width = magnitude.shape
    bbox["width_fraction"] = (bbox["x1"] - bbox["x0"]) / width
    bbox["height_fraction"] = (bbox["y1"] - bbox["y0"]) / height
    return {"changed_fraction": changed / mask.size, "bbox": bbox, **summary}


def pair_series(*, reference_frames, candidate_frames):
    rows, previous = [], None
    for index, (before, after) in enumerate(zip(reference_frames, candidate_frames)):
        residual = after.astype(np.int16) - before.astype(np.int16)
        magnitude = np.abs(residual)
        row = {"frame": index, "mean_abs_rgb": float(magnitude.mean()),
               "p99_abs_rgb": float(np.percentile(magnitude, 99)), "max_abs_rgb": int(magnitude.max())}
        if previous is not None:
            change = np.abs(residual - previous)
            row["mean_residual_change"] = float(change.mean())
            row["max_residual_change"] = int(change.max())
        rows.append(row)
        previous = residual
    return rows


def top(*, rows, key, count=5):
    ranked = sorted((row for row in rows if key in row), key=lambda row: row[key], reverse=True)
    return [row["frame"] for row in ranked[:count]]


def write_difference_video(*, reference_frames, candidate_frames, path, fps):
    """×4 amplified absolute difference, the same frame grid as the exports."""
    height, width = reference_frames[0].shape[:2]
    command = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", str(path)]
    try:
        encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    except FileNotFoundError as error:
        raise RuntimeError(f"ffmpeg is required to write {path}") from error
    with encoder:
        try:
            for before, after in zip(reference_frames, candidate_frames):
                delta = np.abs(after.astype(np.int16) - before.astype(np.int16))
                encoder.stdin.write(np.minimum(delta * 4, 255).astype(np.uint8).tobytes())
            encoder.stdin.close()
        except BrokenPipeError:
            # The encoder exited early; its exit code below says why.
            pass
        code = encoder.wait()
        if code != 0:
            raise RuntimeError(f"ffmpeg failed writing {path} (exit code {code})")


def thumbnail(*, frame):
    return Image.fromarray(frame).resize((STRIP_WIDTH, STRIP_HEIGHT), Image.Resampling.LANCZOS)


def write_strip(*, frames_by_mode, index, path):
    """原图 / 原生 / 自研 / 差分(原生↔自研 ×4) side by side."""
    panels = [thumbnail(frame=frames_by_mode[mode][index]) for mode in ("original", "native", "independent")]
    delta = np.abs(frames_by_mode["independent"][index].astype(np.int16)
                   - frames_by_mode["native"][index].astype(np.int16))
    panels.append(thumbnail(frame=np.minimum(delta * 4, 255).astype(np.uint8)))
    strip = Image.new("RGB", (STRIP_WIDTH * 4, STRIP_HEIGHT))
    for column, panel in enumerate(panels):
        strip.paste(panel, (column * STRIP_WIDTH, 0))
    strip.save(path)


def write_full_frames(*, frames_by_mode, index, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for mode, frames in frames_by_mode.items():
        Image.fromarray(frames[index]).save(directory / f"{mode}-{index:06d}.png")
    delta = np.abs(frames_by_mode["independent"][index].astype(np.int16)
                   - frames_by_mode["native"][index].astype(np.int16))
    Image.fromarray(np.minimum(delta * 4, 255).astype(np.uint8)).save(
        directory / f"difference-native-independent-{index:06d}.png")


def sampled_png_parity(*, evidence, modes, samples, output):
    """Pre-encode plane: committed paused-preview composition vs the export canvas."""
    parity = {}
    for mode in modes:
        # The untouched pass records export frames only (no composition surface);
        # every processed pass must have captured every sampled frame.
        if mode == "original":
            continue
        missing = [frame for frame in samples
                   if not (evidence / mode / f"preview-frame-{frame:06d}-composition.png").exists()]
        if missing:
            raise SystemExit(f"Preview evidence incomplete for {mode}: missing frames {missing}")
        rows = []
        for frame in samples:
            difference = output / f"preview-export-{mode}-{frame:06d}.png"
            result = PNG.compare_files(
                reference=evidence / mode / f"preview-frame-{frame:06d}-composition.png",
                candidate=evidence / mode / f"export-frame-{frame:06d}.png",
                difference=difference)
            rows.append({"frame": frame, **{key: result[key] for key in
                                             ("max_rgb", "mean_rgb", "pixels_over_one", "max_alpha", "within_one_rgb")}})
        parity[mode] = {"frames": rows, "max_rgb": max(row["max_rgb"] for row in rows),
                        "max_alpha": max(row["max_alpha"] for row in rows),
                        "failed_frames": [row["frame"] for row in rows if not row["within_one_rgb"]]}
        parity[mode]["passed"] = not parity[mode]["failed_frames"]
    return parity


def sampled_pre_encode_pairs(*, evidence, samples, output):
    """Native vs independent on the pre-encode export PNGs (no encoder in the loop)."""
    rows = []
    for frame in samples:
        difference = output / f"native-independent-preencode-{frame:06d}.png"
        result = PNG.compare_files(reference=evidence / "native" / f"export-frame-{frame:06d}.png",
                                   candidate=evidence / "independent" / f"export-frame-{frame:06d}.png",
                                   difference=difference)
        rows.append({"frame": frame, "mean_rgb": result["mean_rgb"], "p99_rgb": result["p99_rgb"],
                     "max_rgb": result["max_rgb"], "changed_pixels": result["changed_pixels"]})
    return rows


def load_invariance(*, path):
    if path is None:
        return None
    record = json.loads((path / "e2e-evidence.json").read_text())
    return record


def cross_run(*, invariance_dir, independent_frames, width, height):
    """The invariance run's own sequential export against the three-way independent
    export: a separate project, process and export dialog on the same clip."""
    sequential = invariance_dir / "export-sequential.mp4"
    if not sequential.exists():
        return None
    frames = list(VIDEO.rgb_frames(path=sequential, width=width, height=height))
    if len(frames) != len(independent_frames):
        return {"frames": len(frames), "comparable": False}
    rows = pair_series(reference_frames=independent_frames, candidate_frames=frames)
    identical = sum(1 for row in rows if row["max_abs_rgb"] == 0)
    return {"frames": len(frames), "comparable": True, "identical_frames": identical,
            "mean_abs_rgb": float(np.mean([row["mean_abs_rgb"] for row in rows])),
            "max_abs_rgb": max(row["max_abs_rgb"] for row in rows)}


def badge(*, passed):
    return PNG.parity_badge(passed=passed)


def fmt(value, digits=3):
    return "—" if value is None else f"{value:.{digits}f}" if isinstance(value, float) else str(value)


def ranges(frames):
    """Frame numbers as compact runs: [3, 4, 5, 8, 11, 12] → "3–5, 8, 11–12"."""
    runs, start, previous = [], None, None
    for frame in list(frames) + [None]:
        if start is None:
            start = previous = frame
            continue
        if frame is not None and frame == previous + 1:
            previous = frame
            continue
        runs.append(f"{start}–{previous}" if start != previous else f"{start}")
        start = previous = frame
    return ", ".join(runs) if runs else "—"


def write_page(*, output, report, lock):
    evidence_href = html.escape(os.path.relpath(report["evidence_source"], output.resolve()))
    lock_href = html.escape(os.path.relpath(report["scenario_lock_source"], output.resolve())) if report.get("scenario_lock_source") else None
    lock_link = f' · <a href="{lock_href}">场景锁定</a>' if lock_href else ""
    profile_html = OPERATIONS.structured(value=report.get("native_profile"))
    limitations_html = OPERATIONS.structured(value=report.get("limitations"))
    pairs_rows = "".join(
        f'<tr><th>{html.escape(PAIRS[name][2])}</th>'
        f'<td>{fmt(summary["per_frame_mean_abs_rgb"]["mean"])}</td>'
        f'<td>{fmt(summary["per_frame_mean_abs_rgb"]["p95"])}</td>'
        f'<td>{fmt(summary["per_frame_mean_abs_rgb"]["max"])}</td>'
        f'<td>{summary["per_frame_max_abs_rgb"]["max"]:.0f}</td>'
        f'<td>{fmt(summary["per_frame_mean_residual_change"]["max"]) if summary["per_frame_mean_residual_change"] else "—"}</td>'
        f'<td>{html.escape(str(summary["worst_frames_by_mean"]))}</td>'
        f'<td>{html.escape(str(summary["jump_frames"]))}</td></tr>'
        for name, summary in report["pairs"].items())
    effect_rows = "".join(
        f'<tr><th>{PASS_LABELS[mode]}</th><td>{summary["frames_with_effect"]}/{summary["frames"]}</td>'
        f'<td>{html.escape(ranges(summary["frames_without_effect"]))}</td>'
        f'<td>{fmt(summary["changed_fraction"]["mean"] * 100, 2)} %</td>'
        f'<td>{fmt(summary["bbox_height_fraction"]["mean"], 2)}</td>'
        f'<td>{html.escape(ranges(summary["whole_frame_frames"]))}</td></tr>'
        for mode, summary in report["effect_regions"].items())
    parity_rows = "".join(
        f'<tr><th>{PASS_LABELS[mode]}</th><td>{badge(passed=summary["passed"])}</td>'
        f'<td>{summary["max_rgb"]}</td><td>{summary["max_alpha"]}</td>'
        f'<td>{html.escape(str(summary["failed_frames"]))}</td></tr>'
        for mode, summary in report["preview_export_parity"].items())
    pre_rows = "".join(
        f'<tr><td>{row["frame"]}</td><td>{fmt(row["mean_rgb"])}</td><td>{fmt(row["p99_rgb"], 1)}</td>'
        f'<td>{row["max_rgb"]}</td></tr>' for row in report["native_independent_preencode"])
    videos = "".join(
        f'<figure><video controls preload="metadata" src="{evidence_href}/{mode}/export.mp4"></video><figcaption>{label}</figcaption></figure>'
        for mode, label in PASS_LABELS.items())
    videos += "".join(
        f'<figure><video controls preload="metadata" src="{name}.mp4"></video><figcaption>差分 ×4：{html.escape(PAIRS[name][2])}</figcaption></figure>'
        for name in PAIRS)
    worst = "".join(
        f'<section><h3>帧 {entry["frame"]} — {html.escape(entry["reason"])}</h3>'
        f'<a href="frames/{entry["frame"]:06d}/"><img loading="lazy" src="strips/strip-{entry["frame"]:06d}.png" alt="frame {entry["frame"]}"></a>'
        f'<p>{html.escape(entry["note"])}</p></section>' for entry in report["worst_frames"])
    invariance = report.get("invariance")
    invariance_html = ""
    if invariance:
        cross = invariance.get("cross_run")
        if cross and cross.get("comparable"):
            cross_html = (f'<p>跨工程复现：不变性 E2E 的顺序导出 vs 三方对照的自研导出（另一个工程、另一次进程、另一个导出对话框）：'
                          f'{cross["identical_frames"]}/{cross["frames"]} 帧逐像素相同，'
                          f'均值 {cross["mean_abs_rgb"]:.3f}，最大 {cross["max_abs_rgb"]} 色阶。</p>')
        elif cross:
            cross_html = f'<p>跨工程复现：帧数不同（{cross["frames"]}），未比较。</p>'
        else:
            cross_html = ""
        invariance_html = (OPERATIONS.render(summary=invariance["summary"]) + cross_html
                           + f'<p><a href="{html.escape(invariance["source"])}">操作 E2E 记录</a></p>')
    (output / "index.html").write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>单人动态美体闭环对照</title>
<style>body{{margin:28px;background:#17191d;color:#e8eaee;font:16px/1.6 system-ui}}.videos{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}figure{{margin:0}}img,video{{width:100%;background:#000}}a{{color:#8bc5ff}}td,th{{padding:6px 10px;border:1px solid #555;text-align:left}}table{{border-collapse:collapse;margin:12px 0}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}.pass{{color:#86dfa6}}.fail{{color:#ff9999}}section{{border-top:1px solid #444;padding:18px 0}}code{{color:#ffd48a}}@media(max-width:900px){{.videos{{grid-template-columns:1fr}}}}</style>
<h1>单人动态美体闭环对照：{html.escape(report["verdict"])}</h1>
<p>场景锁定：源 <code>{html.escape(Path(lock["source"]["path"]).name)}</code>（sha256 {lock["source"]["sha256"][:16]}…），{lock["timeline"]["width"]}×{lock["timeline"]["height"]}，{lock["timeline"]["fps"]} fps 时间线，{lock["timeline"]["frames"]} 帧；参数 瘦身 {lock["values"]["body_adjust_SlimBody"]} + 长腿 {lock["values"]["body_adjust_StretchLeg"]}；git {report["git_head"][:12]}；自研引擎 manifest {lock["independentEngine"]["sourceManifestSha256"][:12]}…</p>
<p>统计平面：全部 {report["total_frames"]} 帧来自三路导出的解码画面（同一编码器、同一网格，差分视频 ×4）；预览↔导出 ≤1 色阶只在编码前 PNG 样本（{len(report["samples"])} 帧）上判定。</p>
<h2>原生配置与验收范围</h2><h3>原生配置（scenario lock 的 nativeProfile）</h3>{profile_html}
<h3>范围与限制（limitations）</h3>{limitations_html}
<p>未记录的配置或范围不从差分画面推断。下表不证明身份跟踪、自动蒙版、实时播放或跨平台已验收。</p>
<h2>完整视频</h2><div class="videos">{videos}</div>
<h2>逐帧误差（{report["total_frames"]} 帧，解码后）</h2>
<table><thead><tr><th>对</th><th>均值(平均)</th><th>均值 p95</th><th>均值最大</th><th>单像素最大</th><th>最大跳变</th><th>误差最大帧</th><th>跳变最大帧</th></tr></thead><tbody>{pairs_rows}</tbody></table>
<h2>画面变化统计：各路径相对原图的变化</h2>
<p>相对原图，8×8 块均值 |Δ|&gt;{EFFECT_THRESHOLD} 的块计入变化区域（块平均减少编码噪声影响）。低变化阈值为该路径典型变化面积的 10 %，且不低于 0.05 %。初始化、参数和画面内容都可能产生低变化帧；像素差分不能判定跟踪丢失。bbox 仅描述变化范围。</p>
<table><thead><tr><th>路径</th><th>超过变化阈值帧</th><th>低于变化阈值帧</th><th>平均改变面积</th><th>bbox 高度占比</th><th>整帧级变化帧</th></tr></thead><tbody>{effect_rows}</tbody></table>
<h2>产品画面：暂停预览画布 ↔ 编码前导出帧（第 3 步，目标 ≤1）</h2>
<table><thead><tr><th>路径</th><th>结果</th><th>最大 RGB</th><th>最大 Alpha</th><th>失败帧</th></tr></thead><tbody>{parity_rows}</tbody></table>
<h2>原生 ↔ 自研（编码前 PNG 样本）</h2>
<table><thead><tr><th>帧</th><th>均值</th><th>p99</th><th>最大</th></tr></thead><tbody>{pre_rows}</tbody></table>
{invariance_html}
<h2>最差帧说明</h2><p>每条：原图 / 原生 / 自研 / 差分 ×4；点开查看全分辨率。</p>{worst}
<p><a href="metrics.json">metrics.json</a> · <a href="{evidence_href}/e2e-evidence.json">三方 E2E 记录</a>{lock_link}</p>
</html>''')


def summarize_pair(*, rows):
    means = [row["mean_abs_rgb"] for row in rows]
    maxima = [row["max_abs_rgb"] for row in rows]
    changes = [row["mean_residual_change"] for row in rows if "mean_residual_change" in row]
    return {"per_frame_mean_abs_rgb": VIDEO.distribution(values=means),
            "per_frame_max_abs_rgb": VIDEO.distribution(values=maxima),
            "per_frame_mean_residual_change": VIDEO.distribution(values=changes),
            "worst_frames_by_mean": top(rows=rows, key="mean_abs_rgb"),
            "jump_frames": top(rows=rows, key="mean_residual_change"),
            "frames": rows}


def summarize_effects(*, regions):
    # Relative area is a picture-change statistic, never a detector/tracker receipt.
    fractions = [row["changed_fraction"] for row in regions]
    floor = max(0.0005, 0.1 * float(np.median(fractions)))
    with_effect = [row["frame"] for row in regions if row["changed_fraction"] > floor]
    without = [row["frame"] for row in regions if row["changed_fraction"] <= floor]
    heights = [row["bbox"]["height_fraction"] for row in regions if row["bbox"]]
    whole = [row["frame"] for row in regions
             if row["bbox"] and row["bbox"]["height_fraction"] > 0.9 and row["bbox"]["width_fraction"] > 0.9]
    return {"frames": len(regions), "frames_with_effect": len(with_effect), "frames_without_effect": without,
            "effect_floor_fraction": floor,
            "changed_fraction": VIDEO.distribution(values=[row["changed_fraction"] for row in regions]),
            "bbox_height_fraction": VIDEO.distribution(values=heights) or {"mean": None},
            "whole_frame_frames": whole, "per_frame": regions}


def build(*, evidence, lock, invariance_dir, output, lock_path=None, verify_operation_videos=False, operation_ffmpeg="ffmpeg"):
    record = json.loads((evidence / "e2e-evidence.json").read_text())
    width, height, fps = record["width"], record["height"], record["fps"]
    samples = record["sampleIndices"]
    modes = [mode for mode in PASS_LABELS if (evidence / mode / "export.mp4").exists()]
    if set(modes) != set(PASS_LABELS):
        raise SystemExit(f"Three-way evidence incomplete: have {modes}")
    output.mkdir(parents=True, exist_ok=True)
    (output / "strips").mkdir(exist_ok=True)
    frames_by_mode = {mode: frames_of(evidence=evidence, mode=mode, width=width, height=height) for mode in modes}
    counts = {mode: len(frames) for mode, frames in frames_by_mode.items()}
    if len(set(counts.values())) != 1 or counts["original"] != record["totalFrames"]:
        raise SystemExit(f"Decoded frame counts differ from the timeline: {counts}")

    pairs = {}
    for name, (reference, candidate, _label) in PAIRS.items():
        rows = pair_series(reference_frames=frames_by_mode[reference], candidate_frames=frames_by_mode[candidate])
        pairs[name] = summarize_pair(rows=rows)
        write_difference_video(reference_frames=frames_by_mode[reference], candidate_frames=frames_by_mode[candidate],
                               path=output / f"{name}.mp4", fps=fps)

    effects = {}
    for mode in ("native", "independent"):
        regions = [{"frame": index, **effect_region(before=frames_by_mode["original"][index], after=frames_by_mode[mode][index])}
                   for index in range(counts[mode])]
        effects[mode] = summarize_effects(regions=regions)

    parity = sampled_png_parity(evidence=evidence, modes=modes, samples=samples, output=output)
    pre_encode = sampled_pre_encode_pairs(evidence=evidence, samples=samples, output=output)

    # Include low-change frames without inferring why their pixels changed less.
    alignment = pairs["native_independent"]
    selected = []
    for frame in alignment["worst_frames_by_mean"][:3]:
        row = alignment["frames"][frame]
        selected.append({"frame": frame, "reason": "原生↔自研误差最大",
                         "note": f'均值 {row["mean_abs_rgb"]:.2f}，p99 {row["p99_abs_rgb"]:.1f}，最大 {row["max_abs_rgb"]}；'
                                 f'原生效果量 {pairs["original_native"]["frames"][frame]["mean_abs_rgb"]:.2f}，'
                                 f'自研效果量 {pairs["original_independent"]["frames"][frame]["mean_abs_rgb"]:.2f}'})
    for frame in alignment["jump_frames"][:2]:
        row = alignment["frames"][frame]
        selected.append({"frame": frame, "reason": "原生↔自研差分突然跳变",
                         "note": f'相对上一帧残差变化均值 {row.get("mean_residual_change", 0):.2f}，最大 {row.get("max_residual_change", 0)}'})
    for mode in ("native", "independent"):
        for frame in effects[mode]["frames_without_effect"][:2]:
            selected.append({"frame": frame, "reason": f"{PASS_LABELS[mode]}在此帧的画面变化面积较低",
                             "note": "变化面积未超过此路径的统计阈值；该统计不判定跟踪状态，初始化也可能产生这种画面。"})
    seen, worst = set(), []
    for entry in selected:
        if entry["frame"] in seen:
            continue
        seen.add(entry["frame"])
        worst.append(entry)
        write_strip(frames_by_mode=frames_by_mode, index=entry["frame"], path=output / "strips" / f'strip-{entry["frame"]:06d}.png')
        write_full_frames(frames_by_mode=frames_by_mode, index=entry["frame"], directory=output / "frames" / f'{entry["frame"]:06d}')

    invariance = None
    if invariance_dir is not None:
        inv = load_invariance(path=invariance_dir)
        verified = OPERATIONS.verify_decoded_exports(record=inv, directory=Path(invariance_dir), ffmpeg=operation_ffmpeg) if verify_operation_videos else None
        invariance = {"source": str(Path(invariance_dir).resolve() / "e2e-evidence.json"), "checks": inv.get("checks", {}),
                      "record": inv, "summary": OPERATIONS.summarize(record=inv, verified_videos=verified),
                      "cross_run": cross_run(invariance_dir=Path(invariance_dir), independent_frames=frames_by_mode["independent"],
                                             width=width, height=height)}

    parity_ok = bool(parity) and all(summary["passed"] for summary in parity.values())
    verdict_parts = [f'预览↔导出 {"通过" if parity_ok else "失败"}',
                     f'原生↔自研均值 {alignment["per_frame_mean_abs_rgb"]["mean"]:.2f}（最大帧 {alignment["per_frame_mean_abs_rgb"]["max"]:.2f}）']
    if invariance:
        verdict_parts.append(f'编辑器操作 {invariance["summary"]["label"]}')
    report = {"schemaVersion": 2, "evidence_source": str(evidence.resolve()),
              "scenario_lock_source": str(lock_path.resolve()) if lock_path else None,
              "native_profile": lock.get("nativeProfile"), "limitations": lock.get("limitations"),
              "change_statistics_scope": "Pixel-change thresholds do not determine detector or tracking state",
              "git_head": record["gitHead"], "total_frames": counts["original"], "samples": samples,
              "effect_threshold": EFFECT_THRESHOLD, "pairs": pairs, "effect_regions": effects,
              "preview_export_parity": parity, "native_independent_preencode": pre_encode,
              "worst_frames": worst, "invariance": invariance, "verdict": "；".join(verdict_parts)}
    (output / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    write_page(output=output, report=report, lock=lock)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path, help="three-way E2E evidence folder")
    parser.add_argument("--lock", type=Path, required=True, help="scenario-lock.json")
    parser.add_argument("--invariance", type=Path, help="invariance E2E evidence folder")
    parser.add_argument("--verify-operation-videos", action="store_true", help="recompute every operation export decoded MD5 without modifying its evidence")
    parser.add_argument("--operation-ffmpeg", default="ffmpeg", help="FFmpeg used by the operation E2E for exact decoded digest verification")
    parser.add_argument("--out", type=Path, help="report folder (default <evidence>/report)")
    args = parser.parse_args()
    lock = json.loads(args.lock.read_text())
    report = build(evidence=args.evidence, lock=lock, invariance_dir=args.invariance,
                   output=args.out or args.evidence / "report", lock_path=args.lock,
                   verify_operation_videos=args.verify_operation_videos, operation_ffmpeg=args.operation_ffmpeg)
    brief = {name: {"mean": summary["per_frame_mean_abs_rgb"]["mean"], "worst": summary["worst_frames_by_mean"],
                    "jumps": summary["jump_frames"]} for name, summary in report["pairs"].items()}
    print(json.dumps({"verdict": report["verdict"], "pairs": brief,
                      "preview_export": {mode: summary["max_rgb"] for mode, summary in report["preview_export_parity"].items()},
                      "frames_without_effect": {mode: summary["frames_without_effect"]
                                                for mode, summary in report["effect_regions"].items()}},
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
