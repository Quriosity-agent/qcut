"""Pair genuine Jianying UI captures with completed QCut multi-person editor runs."""

import argparse
import html
import importlib.util
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

SPEC = importlib.util.spec_from_file_location(
    "people_gallery", Path(__file__).with_name("create-portrait-face-shape-gallery.py")
)
GALLERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GALLERY)
COMPARISON = GALLERY.COMPARISON
DIFF = GALLERY.DIFF
CONTROLS = COMPARISON.MATRIX["faceControls"]
TILE = (288, 344)


def validate_reference(*, editor, reference):
    samples = COMPARISON.validate_editor_report(editor=editor)
    if reference.get("evidence") != "ui-screenshot":
        raise ValueError("Require genuine UI screenshot references")
    if editor["sourceSha256"] != reference["sourceSha256"]:
        raise ValueError("Source images must match")
    expected = {f"{item['slug']}-{value}": {item["key"]: value}
                for item in CONTROLS for value in item["values"]}
    refs = {}
    for item in reference["samples"]:
        name = item["name"]
        if name in refs or name not in expected or item["values"] != expected[name]:
            raise ValueError("Require unique isolated matching reference parameters")
        if item["value"] != samples[name]["value"]:
            raise ValueError("Reference numeric value does not match")
        refs[name] = item
    if set(refs) != set(expected):
        raise ValueError("Require all 26 face reference cases")
    return samples, refs


def load_reference(*, root, record, size, crop):
    path = root / record["file"]
    actual = COMPARISON.SKIN.fingerprint(path=path)
    if actual["sha256"] != record["sha256"]:
        raise ValueError(f"Reference fingerprint changed: {path}")
    with Image.open(path) as frame:
        if list(frame.size) != size:
            raise ValueError(f"Reference dimensions changed: {path}")
        result = GALLERY.display_frame(frame=frame.convert("RGB"), crop=crop)
    if np.asarray(result).std() < 2:
        raise ValueError(f"Blank reference frame: {path}")
    return result


def normalized_pair(*, baseline, adjusted, size):
    source_ratio = baseline.width / baseline.height
    if abs(source_ratio - size[0] / size[1]) > 0.003:
        raise ValueError("Reference player crop would distort source aspect ratio")
    return tuple(frame.resize(size, Image.Resampling.LANCZOS) for frame in (baseline, adjusted))


def change_pixels(*, frame, baseline):
    return (np.asarray(frame.filter(ImageFilter.GaussianBlur(DIFF.BLUR_SIGMA)), dtype=np.float64)
            - np.asarray(baseline.filter(ImageFilter.GaussianBlur(DIFF.BLUR_SIGMA)), dtype=np.float64))


def require_changed_pixels(*, delta, name, side):
    if not np.any(delta):
        raise ValueError(
            f"No pixel change in {side} {name}; recheck active face and preview before pairing"
        )


def render_sheet(*, title, rows, output, crop=None):
    margin, gap, header, row_height, footer = 24, 12, 140, TILE[1] + 48, 80
    labels = ["原图 / 剪映零值", "剪映效果", "剪映改动 ×6", "QCut 效果", "QCut 改动 ×6"]
    width = margin * 2 + len(labels) * TILE[0] + gap * (len(labels) - 1)
    sheet = Image.new("RGB", (width, header + len(rows) * row_height + footer), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def label(*, x, y, text, size=19):
        DIFF.draw_label(draw=draw, xy=(x, y), text=text, size=size,
                        font_path=GALLERY.FONT, max_width=width - x - margin)

    label(x=margin, y=18, text=title, size=29)
    label(x=margin, y=62, text="同源照片、同项、同数值；等比展示。黑=未变，白=变化大，统一增益 ×6。")
    for column, text in enumerate(labels):
        label(x=margin + column * (TILE[0] + gap), y=106, text=text, size=21)
    for row_index, (name, frames) in enumerate(rows):
        top = header + row_index * row_height
        label(x=margin, y=top + 5, text=name, size=23)
        for column, frame in enumerate(frames):
            display = GALLERY.display_frame(frame=frame, crop=crop)
            tile = ImageOps.pad(display.convert("RGB"), TILE, method=Image.Resampling.LANCZOS,
                                color="#000000" if column in (2, 4) else "#e5e7eb")
            sheet.paste(tile, (margin + column * (TILE[0] + gap), top + 40))
    label(x=margin, y=sheet.height - footer + 8,
          text="各减各自零值；RGB绝对差均值，σ=0.6；不逐图拉伸、不做几何配准。", size=18)
    label(x=margin, y=sheet.height - footer + 36,
          text="真实剪映界面截图 vs QCut 编辑器画布；不是同规格导出精度验收。", size=18)
    sheet.save(output)


def render_parameter_proof(*, root, references, size, output):
    width, height = 368, 64
    sheet = Image.new("RGB", (width * 4, 60 + height * 7), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)
    DIFF.draw_label(draw=draw, xy=(16, 12), text="剪映实际数值证据：逐项复核，不靠文件名推断", size=24,
                    font_path=GALLERY.FONT)
    for index, record in enumerate(references.values()):
        frame = load_reference(root=root, record=record["ui"], size=size, crop=None)
        x, y = (index % 4) * width + 10, 60 + (index // 4) * height
        draw.text((x, y), record["name"], fill="#222222")
        sheet.paste(GALLERY.display_frame(frame=frame, crop=record["parameterCrop"]), (x, y + 22))
    sheet.save(output)


def create_comparison(*, editor, manifest_path, output, title):
    report_path = editor / "report.json"
    report = json.loads(report_path.read_text())
    reference = json.loads(manifest_path.read_text())
    samples, refs = validate_reference(editor=report, reference=reference)
    source = COMPARISON.SKIN.fingerprint(path=Path(report["source"]))
    if source["sha256"] != report["sourceSha256"]:
        raise ValueError("Original source fingerprint changed")
    root, screenshot_size, player_crop = manifest_path.parent, reference["screenshotSize"], reference["playerCrop"]
    baseline_j = load_reference(root=root, record=reference["zero"], size=screenshot_size, crop=player_crop)
    after_j = load_reference(root=root, record=reference["zeroAfter"], size=screenshot_size, crop=player_crop)
    drift = float(np.abs(change_pixels(frame=after_j, baseline=baseline_j)).mean())
    if drift > 0.1:
        raise ValueError(f"Reference zero drift too large: {drift}")
    display_crop = reference["displayCrop"]
    GALLERY.display_frame(frame=baseline_j, crop=display_crop)
    output.mkdir(parents=True, exist_ok=True)
    source_path = Path(report["source"])
    shutil.copy2(source_path, output / f"source-original{source_path.suffix}")
    drift_gray, _ = DIFF.difference_map(baseline=baseline_j, adjusted=after_j)
    drift_gray.save(output / "zero-drift-x6.png")
    pages, records, overviews = [], [], []
    render_parameter_proof(root=root, references=refs, size=screenshot_size, output=output / "parameter-proof.png")
    for control in CONTROLS:
        rows = []
        for value in control["values"]:
            name = f"{control['slug']}-{value}"
            result_j = load_reference(root=root, record=refs[name]["result"], size=screenshot_size, crop=player_crop)
            base_q, result_q, fingerprints = GALLERY.load_pair(editor=editor, sample=samples[name])
            base_q, result_q = normalized_pair(baseline=base_q, adjusted=result_q, size=baseline_j.size)
            gray_j, magnitude_j = DIFF.difference_map(baseline=baseline_j, adjusted=result_j)
            gray_q, magnitude_q = DIFF.difference_map(baseline=base_q, adjusted=result_q)
            delta_j = change_pixels(frame=result_j, baseline=baseline_j)
            delta_q = change_pixels(frame=result_q, baseline=base_q)
            require_changed_pixels(delta=delta_j, name=name, side="Jianying")
            require_changed_pixels(delta=delta_q, name=name, side="QCut")
            directory = output / name
            directory.mkdir(exist_ok=True)
            for prefix, frames in [("jianying", [baseline_j, result_j, gray_j]), ("qcut", [base_q, result_q, gray_q])]:
                for suffix, frame in zip(["zero", "result", "difference-x6"], frames):
                    frame.save(directory / f"{prefix}-{suffix}.png")
            left, top, right, bottom = display_crop
            record = {"name": name, "value": value, "key": control["key"], "status": "paired",
                      "jianyingMeanRGBChange": float(magnitude_j.mean()),
                      "qcutMeanRGBChange": float(magnitude_q.mean()),
                      "deltaMetrics": COMPARISON.METRICS.delta_metrics(
                          reference=delta_j[top:bottom, left:right], candidate=delta_q[top:bottom, left:right]),
                      "qcutInputs": fingerprints, "reference": refs[name]}
            rows.append((f"{control['label']} {value}", [baseline_j, result_j, gray_j, result_q, gray_q]))
            records.append(record)
        filename = f"{control['slug']}.png"
        render_sheet(title=f"{title} · {control['label']}", rows=rows, output=output / filename, crop=display_crop)
        render_sheet(title=f"{title} · {control['label']} · 全画幅", rows=rows,
                     output=output / f"{control['slug']}-full.png")
        pages.append({"label": control["label"], "file": filename})
        overviews.append(rows[-1])
    for index in range(0, len(overviews), 3):
        filename = f"overview-{index // 3 + 1}.png"
        render_sheet(title=f"{title} · 剪映/QCut 对照 {index // 3 + 1}/5", rows=overviews[index:index + 3],
                     output=output / filename, crop=display_crop)
    summary = {"source": source, "editorReport": COMPARISON.SKIN.fingerprint(path=report_path),
               "referenceManifest": COMPARISON.SKIN.fingerprint(path=manifest_path),
               "evidence": "ui-screenshot-vs-editor-canvas", "jianyingCompared": True,
               "normalizedSize": list(baseline_j.size), "displayCrop": display_crop,
               "gain": DIFF.DISPLAY_GAIN, "sigma": DIFF.BLUR_SIGMA,
               "geometricRegistration": False, "perMapNormalization": False,
               "zeroDriftMeanRGB": drift, "records": records, "pages": pages}
    (output / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    figures = "".join(
        f'<figure><figcaption>{html.escape(page["label"])}</figcaption>'
        f'<a href="{page["file"]}"><img loading="lazy" src="{page["file"]}" alt="{html.escape(page["label"])}"></a>'
        f'<a href="{Path(page["file"]).stem}-full.png">全画幅对照</a></figure>' for page in pages)
    (output / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{html.escape(title)}</title><style>body{{max-width:1536px;margin:24px auto;padding:0 16px;'
        'background:#f5f6f7;color:#202124;font-family:system-ui}img{width:100%;height:auto}'
        'figure{margin:32px 0}figcaption{font-size:22px}</style>'
        f'<h1>{html.escape(title)}：剪映与 QCut</h1>'
        '<p>同源、同项、同值，统一灰度增益×6；真实界面截图对编辑器画布，不是导出精度验收。</p>'
        '<p><a href="parameter-proof.png">剪映数值证据</a> | <a href="report.json">参数、哈希与测量数据</a></p>'
        + figures + '</html>\n')
    return {"pairedCases": len(records), "zeroDriftMeanRGB": drift, "output": str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("editor", type=Path)
    parser.add_argument("references", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--title", default="真人脸型")
    args = parser.parse_args()
    print(json.dumps(create_comparison(editor=args.editor, manifest_path=args.references,
                                       output=args.output, title=args.title), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
