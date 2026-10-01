"""Render aspect-preserving, fixed-gain evidence sheets from completed real editor runs."""

import argparse
import html
import importlib.util
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps


SPEC = importlib.util.spec_from_file_location(
    "face_shape_comparison", Path(__file__).with_name("compare-portrait-face-shape-reference.py")
)
COMPARISON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARISON)
DIFF = COMPARISON.SKIN.DIFF
FONT = COMPARISON.FONT
TILE_SIZE = (384, 512)


def load_pair(*, editor, sample):
    input_path = editor / f"{sample['name']}-input.png"
    result_path = editor / f"{sample['name']}-frame.png"
    inputs = [COMPARISON.SKIN.fingerprint(path=path) for path in [input_path, result_path]]
    if inputs[1]["sha256"] != sample["hash"]:
        raise ValueError(f"Editor frame hash mismatch: {sample['name']}")
    expected_size = (sample["width"], sample["height"])
    frames = []
    for path in [input_path, result_path]:
        with Image.open(path) as frame:
            if frame.size != expected_size:
                raise ValueError(f"Unexpected evidence dimensions: {path}")
            frames.append(frame.convert("RGB"))
    return frames[0], frames[1], inputs


def fit_tile(*, frame, grayscale=False):
    return ImageOps.pad(frame.convert("RGB"), TILE_SIZE, method=Image.Resampling.LANCZOS,
                        color="#000000" if grayscale else "#e5e7eb")


def display_frame(*, frame, crop=None):
    if crop is None:
        return frame
    if len(crop) != 4 or any(not isinstance(value, int) for value in crop):
        raise ValueError("Display crop requires four integer coordinates")
    left, top, right, bottom = crop
    if not (0 <= left < right <= frame.width and 0 <= top < bottom <= frame.height):
        raise ValueError("Display crop must fit inside evidence frame")
    return frame.crop(crop)


def render_sheet(*, title, rows, output, display_crop=None):
    margin, gap, header, row_height, footer = 24, 16, 140, TILE_SIZE[1] + 48, 72
    width = margin * 2 + TILE_SIZE[0] * 3 + gap * 2
    sheet = Image.new("RGB", (width, header + row_height * len(rows) + footer), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def label(*, x, y, text, size=20):
        DIFF.draw_label(draw=draw, xy=(x, y), text=text, size=size, font_path=FONT,
                        max_width=width - margin * 2)

    label(x=margin, y=18, text=title, size=30)
    label(x=margin, y=65, text="真实 QCut 画布；等比展示；灰度统一增益 ×6；黑=未变，白=变化较大。")
    for index, text in enumerate(["原图（本帧输入）", "QCut · 改后", "QCut · 改动区域"]):
        label(x=margin + index * (TILE_SIZE[0] + gap), y=105, text=text)
    for row_index, (name, frames) in enumerate(rows):
        top = header + row_index * row_height
        label(x=margin, y=top + 6, text=name, size=24)
        for column, frame in enumerate(frames):
            sheet.paste(fit_tile(frame=display_frame(frame=frame, crop=display_crop), grayscale=column == 2),
                        (margin + column * (TILE_SIZE[0] + gap), top + 40))
    label(x=margin, y=sheet.height - footer + 8,
          text="全画幅 RGB 绝对差均值，σ=0.6；固定裁切仅用于展示，原尺寸文件保留。", size=18)
    label(x=margin, y=sheet.height - footer + 36,
          text="此人物没有配套剪映结果，不据此宣称与剪映一致；差分亮度不代表效果好坏。", size=18)
    sheet.save(output)


def write_gallery(*, output, title, pages):
    figures = "\n".join(
        f'<figure><figcaption>{html.escape(page["label"])}</figcaption>'
        f'<a href="{html.escape(page["file"], quote=True)}">'
        f'<img loading="lazy" src="{html.escape(page["file"], quote=True)}" '
        f'alt="{html.escape(page["label"], quote=True)}"></a></figure>' for page in pages
    )
    (output / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{html.escape(title)}</title><style>'
        'body{max-width:1248px;margin:24px auto;padding:0 16px;background:#f5f6f7;'
        'color:#202124;font-family:system-ui}h1{font-size:28px}figure{margin:32px 0}'
        'figcaption{font-size:22px;margin-bottom:12px}img{display:block;width:100%;height:auto}'
        f'</style><h1>{html.escape(title)}</h1>'
        '<p>真人照片与 QCut 真实画布。统一增益灰度差分，不生成或重画人物。'
        '这是 QCut 多人物自检，不是剪映效果对齐验收。</p>' + figures + '</html>\n'
    )


def create_gallery(*, editor, output, title, display_crop=None):
    report_path = editor / "report.json"
    report = json.loads(report_path.read_text())
    samples = COMPARISON.validate_editor_report(editor=report)
    source = Path(report["source"])
    source_info = COMPARISON.SKIN.fingerprint(path=source)
    if source_info["sha256"] != report["sourceSha256"]:
        raise ValueError("Original source fingerprint changed")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output / f"source-original{source.suffix}")
    records, pages, overview = [], [], []
    for control in COMPARISON.editor_controls():
        rows = []
        for value in control["values"]:
            name = f"{control['slug']}-{value}"
            baseline, adjusted, inputs = load_pair(editor=editor, sample=samples[name])
            difference, magnitude = DIFF.difference_map(baseline=baseline, adjusted=adjusted)
            directory = output / name
            directory.mkdir(exist_ok=True)
            baseline.save(directory / "original.png")
            adjusted.save(directory / "adjusted.png")
            difference.save(directory / "difference-gray.png")
            records.append({"name": name, "key": control["key"], "value": value,
                            "size": list(baseline.size), "meanRGBDelta": float(magnitude.mean()),
                            "changedPixelFraction": float(np.mean(magnitude > 1)), "inputs": inputs})
            rows.append((f"{control['label']} {value}", [baseline, adjusted, difference]))
        filename = f"{control['slug']}.png"
        render_sheet(title=f"{title} · {control['label']}", rows=rows, output=output / filename,
                     display_crop=display_crop)
        pages.append({"label": control["label"], "file": filename})
        if control["slug"] in ["smooth-contour", "small-face", "jawline"]:
            overview.append(rows[-1])
    render_sheet(title=f"{title} · 独立包高档位总览", rows=overview, output=output / "overview.png",
                 display_crop=display_crop)
    pages.insert(0, {"label": "流畅脸、小脸、下颌线 · 100", "file": "overview.png"})
    summary = {"source": source_info, "editorReport": COMPARISON.SKIN.fingerprint(path=report_path),
               "evidence": "editor-canvas-only", "jianyingCompared": False, "records": records,
               "gain": DIFF.DISPLAY_GAIN, "sigma": DIFF.BLUR_SIGMA, "roi": "whole-frame",
               "displayCrop": display_crop, "geometricRegistration": False,
               "perMapNormalization": False, "pages": pages}
    (output / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    write_gallery(output=output, title=title, pages=pages)
    return {"cases": len(records), "pages": len(pages), "jianyingCompared": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("editor", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--title", default="真人脸型调节")
    parser.add_argument("--display-crop", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"),
                        help="Same display-only crop for all three columns; full-size evidence is retained")
    args = parser.parse_args()
    print(json.dumps(create_gallery(editor=args.editor, output=args.output, title=args.title,
                                    display_crop=args.display_crop), indent=2))


if __name__ == "__main__":
    main()
