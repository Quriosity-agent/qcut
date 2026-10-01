"""Pair isolated feature/makeup UI references with a completed QCut editor run."""

import argparse
import html
import importlib.util
import json
import re
import shutil
from pathlib import Path

import numpy as np

SPEC = importlib.util.spec_from_file_location(
    "portrait_people", Path(__file__).with_name("compare-portrait-face-shape-people.py")
)
PEOPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PEOPLE)
GALLERY, DIFF = PEOPLE.GALLERY, PEOPLE.DIFF
FINGERPRINT = PEOPLE.COMPARISON.SKIN.fingerprint


def isolated_parameters(*, sample):
    values, makeup = sample.get("values", {}), sample.get("makeup", {})
    value = sample.get("value")
    if (not isinstance(value, (int, float)) or isinstance(value, bool)
            or not np.isfinite(value) or value == 0):
        raise ValueError("Require a nonzero numeric value")
    if len(values) == 1 and not makeup and next(iter(values.values())) == value:
        return {"values": values}
    if not values and len(makeup) == 1:
        selection = next(iter(makeup.values()))
        if selection.get("cardId") and selection.get("intensity") == value:
            return {"makeup": makeup}
    raise ValueError("Require one isolated control or makeup card at the recorded value")


def validate_reference(*, editor, reference):
    exported = editor.get("exported", {})
    stream = exported.get("videoStream", {})
    if editor.get("errors") != [] or not editor.get("combined", {}).get("hash"):
        raise ValueError("Require a completed editor run without errors")
    if (exported.get("decodedFrames") != 30 or stream.get("codec_name") != "h264"
            or [stream.get("width"), stream.get("height")] != [1080, 1080]):
        raise ValueError("Require the decoded 1080-square combined export")
    if reference.get("evidence") != "ui-screenshot":
        raise ValueError("Require genuine UI screenshot references")
    if not editor.get("sourceSha256") or editor["sourceSha256"] != reference.get("sourceSha256"):
        raise ValueError("Source images must match")
    samples = {}
    for sample in editor.get("samples", []) + editor.get("makeupSamples", []):
        name = sample["name"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", name):
            raise ValueError("Require a safe evidence sample name")
        if name in samples:
            raise ValueError("Duplicate editor sample")
        isolated_parameters(sample=sample)
        samples[name] = sample
    refs = {}
    for item in reference.get("samples", []):
        name = item["name"]
        if name in refs or name not in samples:
            raise ValueError("Require unique matching reference samples")
        if isolated_parameters(sample=item) != isolated_parameters(sample=samples[name]):
            raise ValueError("Reference parameters do not match editor parameters")
        if item["value"] != samples[name]["value"]:
            raise ValueError("Reference numeric value does not match")
        refs[name] = item
    if not refs:
        raise ValueError("Require at least one real reference sample")
    return samples, refs


def create_comparison(*, editor, manifest_path, output, title):
    report_path = editor / "report.json"
    report = json.loads(report_path.read_text())
    reference = json.loads(manifest_path.read_text())
    samples, refs = validate_reference(editor=report, reference=reference)
    source = FINGERPRINT(path=Path(report["source"]))
    if source["sha256"] != report["sourceSha256"]:
        raise ValueError("Original source fingerprint changed")
    root, size, crop = manifest_path.parent, reference["screenshotSize"], reference["playerCrop"]
    baseline = PEOPLE.load_reference(root=root, record=reference["zero"], size=size, crop=crop)
    zero_after = PEOPLE.load_reference(root=root, record=reference["zeroAfter"], size=size, crop=crop)
    drift = float(np.abs(PEOPLE.change_pixels(frame=zero_after, baseline=baseline)).mean())
    if drift > 0.1:
        raise ValueError(f"Reference zero drift too large: {drift}")
    output.mkdir(parents=True, exist_ok=True)
    source_path = Path(report["source"])
    shutil.copy2(source_path, output / f"source-original{source_path.suffix}")
    rows, records, pages = [], [], []
    for name, record in refs.items():
        PEOPLE.load_reference(root=root, record=record["ui"], size=size, crop=None)
        result_j = PEOPLE.load_reference(root=root, record=record["result"], size=size, crop=crop)
        base_q, result_q, inputs = GALLERY.load_pair(editor=editor, sample=samples[name])
        base_q, result_q = PEOPLE.normalized_pair(baseline=base_q, adjusted=result_q, size=baseline.size)
        gray_j, magnitude_j = DIFF.difference_map(baseline=baseline, adjusted=result_j)
        gray_q, magnitude_q = DIFF.difference_map(baseline=base_q, adjusted=result_q)
        for side, base, result in [("Jianying", baseline, result_j), ("QCut", base_q, result_q)]:
            PEOPLE.require_changed_pixels(delta=PEOPLE.change_pixels(frame=result, baseline=base),
                                          name=name, side=side)
        directory = output / name
        directory.mkdir(exist_ok=True)
        for prefix, frames in [("jianying", [baseline, result_j, gray_j]),
                               ("qcut", [base_q, result_q, gray_q])]:
            for suffix, frame in zip(["zero", "result", "difference-x6"], frames):
                frame.save(directory / f"{prefix}-{suffix}.png")
        row = (f"{record['label']} {record['value']}", [baseline, result_j, gray_j, result_q, gray_q])
        rows.append(row)
        filename = f"{name}.png"
        PEOPLE.render_sheet(title=f"{title} · {record['label']}", rows=[row], output=output / filename,
                            crop=reference["displayCrop"])
        PEOPLE.render_sheet(title=f"{title} · {record['label']} · 全画幅", rows=[row],
                            output=output / f"{name}-full.png")
        pages.append({"label": row[0], "file": filename})
        records.append({"name": name, "parameters": isolated_parameters(sample=record),
                        "jianyingMeanRGBChange": float(magnitude_j.mean()),
                        "qcutMeanRGBChange": float(magnitude_q.mean()),
                        "qcutInputs": inputs, "reference": record})
    for index in range(0, len(rows), 3):
        PEOPLE.render_sheet(title=f"{title} · 对照 {index // 3 + 1}", rows=rows[index:index + 3],
                            output=output / f"overview-{index // 3 + 1}.png", crop=reference["displayCrop"])
    summary = {"source": source, "editorReport": FINGERPRINT(path=report_path),
               "referenceManifest": FINGERPRINT(path=manifest_path),
               "evidence": "ui-screenshot-vs-editor-canvas", "jianyingCompared": True,
               "pairedCases": len(refs), "unpairedEditorCases": sorted(set(samples) - set(refs)),
               "gain": DIFF.DISPLAY_GAIN, "sigma": DIFF.BLUR_SIGMA, "zeroDriftMeanRGB": drift,
               "geometricRegistration": False, "perMapNormalization": False, "records": records}
    (output / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    figures = "".join(
        f'<figure><figcaption>{html.escape(page["label"])}</figcaption>'
        f'<a href="{html.escape(page["file"], quote=True)}"><img loading="lazy" '
        f'src="{html.escape(page["file"], quote=True)}" alt="{html.escape(page["label"], quote=True)}"></a>'
        f'<a href="{Path(page["file"]).stem}-full.png">全画幅</a></figure>' for page in pages)
    (output / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{html.escape(title)}</title><style>body{{max-width:1536px;margin:24px auto;padding:0 16px;'
        'font-family:system-ui;color:#202124;background:#f5f6f7}img{width:100%;height:auto}'
        'figure{margin:32px 0}figcaption{font-size:22px}</style>'
        f'<h1>{html.escape(title)}</h1><p>同源、同项、同数值，统一灰度增益 ×6。'
        '各减各自零值，不做几何配准；界面截图对编辑器画布，不是导出精度验收。</p>'
        '<p><a href="report.json">参数、哈希和未配对项</a></p>' + figures + '</html>\n')
    return {"pairedCases": len(refs), "zeroDriftMeanRGB": drift, "output": str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("editor", type=Path)
    parser.add_argument("references", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--title", default="五官精修与美妆")
    args = parser.parse_args()
    print(json.dumps(create_comparison(editor=args.editor, manifest_path=args.references,
                                       output=args.output, title=args.title), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
