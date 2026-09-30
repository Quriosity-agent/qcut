"""Compare isolated face-shape captures, explicitly retaining missing QCut controls."""

import argparse
import html
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def module(*, name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


SKIN = module(name="face_shape_skin", filename="compare-portrait-skin-reference.py")
METRICS = module(name="face_shape_metrics", filename="compare-portrait-nose-reference.py")
MATRIX = json.loads((Path(__file__).parent / "fixtures/portrait-face-shape-reference.json").read_text())
FONT = Path("/System/Library/Fonts/STHeiti Medium.ttc")


def editor_controls():
    return [item for item in MATRIX["faceControls"] if item["key"]] + [MATRIX["qcutSkinControl"]]


def reference_controls():
    return MATRIX["faceControls"] + [
        {"slug": f"skin-tone-{index}", "label": f"肤色色板 {index}", "key": None, "values": [50, 100]}
        for index in MATRIX["skinSwatches"]
    ]


def validate_editor_report(*, editor):
    if editor.get("errors") or not editor.get("reopenedHash") or not editor.get("exported"):
        raise ValueError("Require completed editor run, reopen and export evidence")
    expected = {f"{control['slug']}-{value}": (control["key"], value)
                for control in editor_controls() for value in control["values"]}
    samples = {}
    for sample in editor["samples"]:
        name = sample["name"]
        if name in samples or name not in expected:
            raise ValueError("Unexpected or duplicate editor case")
        key, value = expected[name]
        if sample["values"] != {key: value} or sample["value"] != value:
            raise ValueError("Comparison requires isolated matching parameters")
        samples[name] = sample
    if set(samples) != set(expected):
        raise ValueError("Missing editor case")
    return samples


def validate_reports(*, editor, reference):
    if editor["sourceSha256"] != reference["sourceSha256"]:
        raise ValueError("Source images must match")
    samples = validate_editor_report(editor=editor)
    if reference["evidence"] != "ui-screenshot":
        raise ValueError("This comparison is screenshot-level, not exported parity")
    expected_refs = {(item["slug"], value) for item in reference_controls() for value in item["values"]}
    refs = [tuple(item) for item in reference["samples"]]
    if len(refs) != len(set(refs)) or set(refs) != expected_refs:
        raise ValueError("Require all isolated reference cases without duplicates")
    return samples


def delta(*, result, baseline):
    def pixels(frame):
        return np.asarray(frame.filter(ImageFilter.GaussianBlur(SKIN.DIFF.BLUR_SIGMA))
                          .crop(SKIN.DIFF.FACE_RECT), dtype=np.float64)
    return pixels(result) - pixels(baseline)


def unavailable_frame():
    frame = Image.new("RGB", SKIN.DIFF.NORMALIZED_SIZE, "#ededed")
    draw = ImageDraw.Draw(frame)
    SKIN.DIFF.draw_label(draw=draw, xy=(110, 380), text="无已验证对应入口", size=34, font_path=FONT)
    SKIN.DIFF.draw_label(draw=draw, xy=(130, 445), text="不伪造效果或差分", size=30, font_path=FONT)
    return frame


def write_gallery(*, output, pages):
    figures = "\n".join(
        f'<figure><figcaption>{html.escape(item["label"])}</figcaption>'
        f'<a href="{html.escape(item["file"], quote=True)}">'
        f'<img loading="lazy" src="{html.escape(item["file"], quote=True)}" '
        f'alt="{html.escape(item["label"], quote=True)}"></a></figure>'
        for item in pages
    )
    document = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>脸型与肤色逐项对照</title><style>
body{margin:24px auto;padding:0 16px;max-width:1536px;background:#f5f6f7;color:#202124;font-family:system-ui}
h1{font-size:28px}figure{margin:32px 0}figcaption{font-size:22px;margin-bottom:12px}img{display:block;width:100%;height:auto}
</style><h1>脸型与肤色逐项对照</h1>
<p>剪映界面截图与 QCut 真实画布；统一灰度增益 ×6，分别减去自身零值。不是同规格导出精度验收。</p>
""" + figures + "</html>\n"
    (output / "index.html").write_text(document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("editor", type=Path)
    parser.add_argument("references", type=Path, help="Jianying manifest.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    editor = json.loads((args.editor / "report.json").read_text())
    reference = json.loads(args.references.read_text())
    samples = validate_reports(editor=editor, reference=reference)
    source = Path(editor["source"])
    if SKIN.fingerprint(path=source)["sha256"] != editor["sourceSha256"]:
        raise ValueError("Original source fingerprint changed")
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, args.output / f"source-original{source.suffix}")
    sources, records, pages, overview_rows = [], [], [], []

    def jy_frame(name):
        path = args.references.parent / f"{name}.png"
        sources.append(SKIN.fingerprint(path=path))
        return SKIN.load_frame(path=path, expected_size=reference["screenshotSize"], crop=reference["playerCrop"])

    def qcut_frames(name):
        sample = samples[name]
        input_path = args.editor / f"{name}-input.png"
        result_path = args.editor / f"{name}-frame.png"
        if SKIN.fingerprint(path=result_path)["sha256"] != sample["hash"]:
            raise ValueError(f"Editor frame hash mismatch: {name}")
        sources.extend([SKIN.fingerprint(path=input_path), SKIN.fingerprint(path=result_path)])
        options = {"expected_size": [sample["width"], sample["height"]]}
        return SKIN.load_frame(path=input_path, **options), SKIN.load_frame(path=result_path, **options)

    base_face, base_skin = jy_frame("face-zero"), jy_frame("skin-zero")
    drift = float(np.abs(delta(result=jy_frame("face-zero-after"), baseline=base_face)).mean())
    if drift > 0.1:
        raise ValueError(f"Jianying neutral face drift too large: {drift}")
    for control in reference_controls():
        rows = []
        for value in control["values"]:
            name = f"{control['slug']}-{value}"
            directory = args.output / name
            directory.mkdir(exist_ok=True)
            baseline = base_skin if control["slug"].startswith("skin-tone-") else base_face
            result = jy_frame(name)
            difference, measured = SKIN.save_side(baseline=baseline, adjusted=result, output=directory, prefix="jianying")
            record = {"name": name, "label": control["label"], "value": value, "jianying": measured,
                      "status": "paired" if control["key"] else "missing-qcut-control"}
            tiles = [baseline, result, difference]
            if control["key"]:
                original_q, result_q = qcut_frames(name)
                difference_q, measured_q = SKIN.save_side(baseline=original_q, adjusted=result_q, output=directory, prefix="qcut")
                record["qcut"] = measured_q
                record["deltaMetrics"] = METRICS.delta_metrics(reference=delta(result=result, baseline=baseline),
                                                               candidate=delta(result=result_q, baseline=original_q))
                tiles.extend([result_q, difference_q])
            else:
                tiles.extend([unavailable_frame(), unavailable_frame()])
            rows.append((f"{control['label']} {value}", tiles))
            records.append(record)
        filename = f"{control['slug']}.png"
        SKIN.render_sheet(title=f"{control['label']}：原图、剪映、QCut", rows=rows,
                          output=args.output / filename, font=FONT, paired=True,
                          evidence_label="剪映界面截图 / QCut真实画布；缺项明确留空；不是同规格导出精度验收。")
        pages.append({"label": control["label"], "file": filename})
        overview_rows.append(rows[-1])

    skin_rows = []
    for value in MATRIX["qcutSkinControl"]["values"]:
        name = f"skin-native-default-{value}"
        directory = args.output / name
        directory.mkdir(exist_ok=True)
        original, result = qcut_frames(name)
        difference, measured = SKIN.save_side(baseline=original, adjusted=result, output=directory, prefix="qcut")
        skin_rows.append((f"QCut现有肤色 {value}，冷暖0", [original, result, difference]))
        records.append({"name": name, "status": "unmapped-qcut-skin-tone", "qcut": measured})
    SKIN.render_sheet(title="QCut现有肤色入口：尚无五色色板选择", rows=skin_rows,
                      output=args.output / "skin-native-default.png", font=FONT, paired=False,
                      evidence_label="只有固定包的肤色强度与冷暖；不能宣称等同剪映五种色板。")
    pages.append({"label": "QCut现有肤色", "file": "skin-native-default.png"})
    overviews = []
    for index in range(0, len(overview_rows), 3):
        filename = f"overview-{index // 3 + 1}.png"
        SKIN.render_sheet(title=f"脸型与肤色：高档位总览 {index // 3 + 1}/6",
                          rows=overview_rows[index:index + 3], output=args.output / filename,
                          font=FONT, paired=True,
                          evidence_label="单照片诊断；缺项留空；UI截图与真实画布，不是导出精度验收。")
        overviews.append(filename)
    report = {"source": SKIN.fingerprint(path=source), "evidence": "ui-screenshot-vs-editor-canvas",
              "editorReport": SKIN.fingerprint(path=args.editor / "report.json"),
              "referenceManifest": SKIN.fingerprint(path=args.references),
              "normalizedSize": list(SKIN.DIFF.NORMALIZED_SIZE), "roi": list(SKIN.DIFF.FACE_RECT),
              "gain": SKIN.DIFF.DISPLAY_GAIN, "sigma": SKIN.DIFF.BLUR_SIGMA,
              "geometricRegistration": False, "perMapNormalization": False,
              "neutralFaceDriftMeanRGB": drift, "records": records, "sources": sources,
              "pages": pages, "overviews": overviews}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    lines = ["# 脸型与肤色逐项对照", "", "剪映界面截图对 QCut 编辑器画布，不是导出精度验收。", ""]
    lines.extend(f"- [{item['label']}]({item['file']})" for item in pages)
    (args.output / "README.md").write_text("\n".join(lines) + "\n")
    write_gallery(output=args.output, pages=pages)
    print(json.dumps({"pages": len(pages), "pairedCases": sum(item["status"] == "paired" for item in records),
                      "neutralFaceDriftMeanRGB": drift}, indent=2))


if __name__ == "__main__":
    main()
