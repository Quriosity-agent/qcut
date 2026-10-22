"""Plot recorded joint comparisons over the verified original RGBA frame."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from body_float_refine_decode import JOINT_NAMES
from espresso_archive import sha256

EDGES = ((1, 2), (2, 3), (3, 4), (1, 5), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10),
         (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17))


def create_overlay(*, report_path):
    directory = report_path.parent
    if directory.parent.name != "body-default-profile-20261023" or directory.parent.parent.name != ".local":
        raise ValueError("joint overlays must remain in the private evidence directory")
    report = json.loads(report_path.read_text())
    source = Path(report["input"]["source"])
    if sha256(path=source) != report["input"]["sourceSha256"]:
        raise ValueError("original source identity mismatch")
    width, height = report["sourceSize"]
    rgba = np.fromfile(source, np.uint8).reshape(height, width, 4)
    panel_width, panel_height = 360, round(360 * height / width)
    base = Image.fromarray(rgba).convert("RGB").resize((panel_width, panel_height), Image.Resampling.LANCZOS)
    margin, gap, top = 24, 16, 114
    canvas = Image.new("RGB", (margin * 2 + panel_width * 5 + gap * 4, top + panel_height + 174), "#101722")
    draw = ImageDraw.Draw(canvas)
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    font = ImageFont.truetype(font_path, 18) if Path(font_path).is_file() else ImageFont.load_default(size=18)
    title_font = ImageFont.truetype(font_path, 28) if Path(font_path).is_file() else ImageFont.load_default(size=28)
    draw.text((margin, 18), "First float refine call: joint locations and confidence", fill="white", font=title_font)
    algorithm_width, algorithm_height = report["crop"]["algorithmSize"]
    draw.text((margin, 56), f"Original {width} x {height} | algorithm {algorithm_width} x {algorithm_height} | same independently reconstructed crop | no temporal or rendered-pixel parity claim", fill="#c9d3df", font=font)
    colors = {"native": "#52e5ff", "float32": "#72f4a7", "float16": "#ffb85c", "delta": "#ff5e89"}
    rows = report["results"]
    native = np.asarray([row["native"] for row in rows["float32"]["jointRows"]], np.float32)
    points = {name: np.asarray([row["actual"] for row in rows[name]["jointRows"]], np.float32) for name in ("float32", "float16")}
    scale = [panel_width / report["crop"]["algorithmSize"][0], panel_height / report["crop"]["algorithmSize"][1]]

    def xy(*, point, left):
        return (left + point[0] * scale[0], top + point[1] * scale[1])

    def skeleton(*, pose, left, color):
        for a, b in EDGES:
            if pose[a, 3] and pose[b, 3]:
                draw.line([xy(point=pose[a], left=left), xy(point=pose[b], left=left)], fill=color, width=2)
        for point in pose:
            if point[3]:
                x, y = xy(point=point, left=left)
                draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color, outline="#152032")

    labels = ("Original", "Native default", "Owned Float32", "Owned Float16", "Float16 minus native")
    for index, label in enumerate(labels):
        left = margin + index * (panel_width + gap)
        draw.text((left, top - 30), label, fill="white", font=font)
        canvas.paste(base, (left, top))
        if index == 1:
            skeleton(pose=native, left=left, color=colors["native"])
        if index in (2, 3):
            name = "float32" if index == 2 else "float16"
            skeleton(pose=points[name], left=left, color=colors[name])
        if index == 4:
            skeleton(pose=native, left=left, color=colors["native"])
            for joint, (actual, expected) in enumerate(zip(points["float16"], native)):
                if actual[3] and expected[3] and not np.array_equal(actual[:2], expected[:2]):
                    a, b = xy(point=actual, left=left), xy(point=expected, left=left)
                    draw.line([a, b], fill=colors["delta"], width=5)
                    draw.ellipse((a[0] - 6, a[1] - 6, a[0] + 6, a[1] + 6), outline=colors["delta"], width=2)
                    dx, dy = actual[:2] - expected[:2]
                    draw.text((left + 18, b[1] + 20), f"{JOINT_NAMES[joint]}: ({dx:g}, {dy:g}) px", fill=colors["delta"], font=font, stroke_width=1, stroke_fill="#101722")
        foot = top + panel_height + 14
        if index == 0:
            lines = ["Verified original RGBA frame", "No model input from native captures"]
        elif index == 1:
            validation = report["decoderValidation"]["nativeRawTensorToNativePublic72"]
            lines = [f"{int(np.count_nonzero(native[:, 3]))} valid joints", f"Decoder replay: {validation['total'] - validation['different']} / {validation['total']} exact"]
        elif index in (2, 3):
            result = rows["float32" if index == 2 else "float16"]
            lines = [f"Joint locations exact: {result['jointCoordinatesExact']} / 18", f"Validity exact: {18 - result['validity']['different']} / 18",
                     f"Score mean error: {result['confidence']['mean']:.7f}", f"Score max error: {result['confidence']['maximum']:.7f}"]
        else:
            result = rows["float16"]
            lines = [f"Max joint delta: {result['maximumJointDistanceAlgorithmPixels']:g} algorithm px",
                     f"{result['maximumJointDistanceOriginalPixels']:g} original-image pixels",
                     f"{result['jointCoordinatesExact']} / 18 joint locations coincide", "Lower tensor error != exact joints"]
        for offset, line in enumerate(lines):
            draw.text((left, foot + offset * 24), line, fill="#d6dfeb", font=font)
    output = directory / "joint-overlays.png"
    canvas.save(output)
    receipt = {"reportSha256": sha256(path=report_path), "sourceSha256": report["input"]["sourceSha256"],
        "scriptSha256": sha256(path=Path(__file__)), "image": output.name, "imageSha256": sha256(path=output),
        "size": list(canvas.size), "coordinateScaling": "algorithm pixels mapped directly to aspect-matched original-image display",
        "differenceLine": "actual Float16 coordinate to native coordinate; no exaggerated displacement"}
    (directory / "overlay-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    print(create_overlay(report_path=args.report.resolve()))
