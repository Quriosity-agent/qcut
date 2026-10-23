"""Exercise real image upload, public body controls, reset and exact PNG downloads."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

if __package__:
    from .cli_console import configure_console
    from .control_contract import CONTROL_RANGES, PUBLIC_CONTROLS
else:
    from cli_console import configure_console
    from control_contract import CONTROL_RANGES, PUBLIC_CONTROLS


SINGLE_CASE_IDS = {
    "StretchLeg": "long-leg-100", "SlimWaist": "waist-100", "SmallHead": "head-100",
    "SlimBody": "body-100", "SlimArm": "arm-100", "ShoulderWidth": "shoulder-wide-50",
    "OrthoShoulder": "ortho-100", "SwanNeck": "neck-100", "HipWidth": "hip-wide-50", "BustSize": "bust-full-50",
    "ThighWidth": "thigh-wide-50", "CalfWidth": "calf-wide-50",
}
PHOTO_CASES = (
    ("zero-before", {}, "identity"),
    *((SINGLE_CASE_IDS[name], {name: CONTROL_RANGES[name][1]}, "applied") for name in PUBLIC_CONTROLS),
    ("shoulder-narrow-50", {"ShoulderWidth": -50}, "applied"),
    ("hip-narrow-50", {"HipWidth": -50}, "applied"),
    ("bust-small-50", {"BustSize": -50}, "applied"),
    ("thigh-narrow-50", {"ThighWidth": -50}, "applied"),
    ("calf-narrow-50", {"CalfWidth": -50}, "applied"),
    ("combined", {"StretchLeg": 100, "SlimWaist": 80, "SmallHead": 60}, "applied"),
    ("combined-five", {"StretchLeg": 60, "SlimWaist": 60, "SmallHead": 60, "SlimBody": 60, "SlimArm": 60}, "applied"),
    ("combined-ten-moderate", {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50,
        "ShoulderWidth": 10, "OrthoShoulder": 35, "SwanNeck": 40, "HipWidth": 10, "BustSize": 10}, "applied"),
    ("combined-twelve-moderate", {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50,
        "ShoulderWidth": 10, "OrthoShoulder": 35, "SwanNeck": 40, "HipWidth": 10, "BustSize": 10,
        "ThighWidth": -25, "CalfWidth": -25}, "applied"),
    ("zero-after", {}, "identity"),
)


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def request(*, base, route, body=None, content_type="application/json"):
    with urlopen(Request(base + route, data=body,
                         headers={"Content-Type": content_type}), timeout=150) as response:
        return response.read(), dict(response.headers)


def json_request(*, base, route, value=None):
    body = None if value is None else json.dumps(value).encode()
    data, _ = request(base=base, route=route, body=body)
    return json.loads(data)


def pixels(*, data):
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "PNG" and getattr(image, "n_frames", 1) == 1
        return np.array(image.convert("RGBA"), np.uint8, copy=True)


def verify_result(*, base, photo, source_png, values, directory, name, expected_status):
    response = json_request(base=base, route="/api/render", value={"photoId": photo["photoId"], "values": values})
    (directory / f"{name}-response.json").write_text(json.dumps(response, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert response["status"] == expected_status, (name, response)
    png, headers = request(base=base, route=response["result"]["downloadUrl"])
    displayed, _ = request(base=base, route=response["result"]["url"])
    assert png == displayed and "attachment" in headers.get("Content-Disposition", "")
    original, result = pixels(data=source_png), pixels(data=png)
    assert result.shape == original.shape and np.all(result[..., 3] == 255)
    changed = int(np.count_nonzero(np.any(original != result, axis=-1)))
    assert response["result"]["pngSha256"] == digest(data=png)
    assert response["result"]["rgbaSha256"] == digest(data=result.tobytes())
    receipt = json_request(base=base, route=response["receiptUrl"])
    assert receipt["inputPngSha256"] == digest(data=source_png)
    assert receipt["inputRgbaSha256"] == digest(data=original.tobytes())
    assert receipt["outputPngSha256"] == digest(data=png)
    assert receipt["outputRgbaSha256"] == digest(data=result.tobytes())
    if expected_status in ("identity", "unavailable"):
        assert changed == 0
    if expected_status == "applied":
        assert changed > 0 and receipt["sourceAndAssetsUnchanged"]
        assert receipt["verification"]["assets"] == 5
        assert receipt["verification"]["sourceFiles"] == 107
        assert receipt["nativeGeometryUsed"] is False and receipt["fixedLandmarks"] is False
        assert receipt["execution"]["independence"]["private_native_images"] == []
        for control, value in values.items():
            if value:
                assert response["controls"][control]["applied"], (name, control)
    half = original.copy()
    split = original.shape[1] // 2
    half[:, split:] = result[:, split:]
    Image.fromarray(half).save(directory / f"{name}-half.png")
    (directory / f"{name}.png").write_bytes(png)
    (directory / f"{name}-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fresh_source, _ = request(base=base, route=photo["url"])
    assert fresh_source == source_png
    item = {"name": name, "values": response["values"], "status": response["status"],
            "changedPixels": changed, "milliseconds": response["milliseconds"],
            "resultPngSha256": digest(data=png), "resultRgbaSha256": digest(data=result.tobytes()),
            "dimensions": [result.shape[1], result.shape[0]], "downloadMatchesDisplayedPng": True,
            "sourceUnchanged": True, "controls": response["controls"]}
    print(json.dumps(item, ensure_ascii=False), flush=True)
    return item


def main():
    configure_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base", default="http://127.0.0.1:5270")
    args = parser.parse_args()
    if not args.base.startswith("http://127.0.0.1:"):
        parser.error("the acceptance runner only targets the local body editor")
    args.output.mkdir(parents=True, exist_ok=False)
    original_bytes = args.image.read_bytes()
    photo_raw, _ = request(base=args.base, route="/api/photos", body=original_bytes, content_type="image/png")
    photo = json.loads(photo_raw)
    source, _ = request(base=args.base, route=photo["url"])
    (args.output / "source.png").write_bytes(source)
    catalogue = json_request(base=args.base, route="/api/catalog")
    assert {control["name"] for control in catalogue["controls"]} == set(PUBLIC_CONTROLS)
    started = time.monotonic()
    results = []
    for name, values, status in PHOTO_CASES:
        results.append(verify_result(base=args.base, photo=photo, source_png=source, values=values,
                                     directory=args.output, name=name, expected_status=status))
    blank_data = io.BytesIO()
    Image.new("RGB", (640, 960), (128, 128, 128)).save(blank_data, format="PNG")
    blank_photo_raw, _ = request(base=args.base, route="/api/photos", body=blank_data.getvalue(), content_type="image/png")
    blank_photo = json.loads(blank_photo_raw)
    blank_source, _ = request(base=args.base, route=blank_photo["url"])
    results.append(verify_result(base=args.base, photo=blank_photo, source_png=blank_source,
        values={"StretchLeg": 100, "SlimWaist": 80, "SmallHead": 60}, directory=args.output,
        name="no-person", expected_status="unavailable"))
    assert args.image.read_bytes() == original_bytes
    audit = {"schemaVersion": 1, "sourcePhoto": str(args.image.resolve()),
             "sourcePhotoPngSha256": digest(data=original_bytes), "normalizedSource": photo,
             "sourceCommit": catalogue["sourceCommit"], "realRequests": len(results), "cases": results,
             "allChecksPassed": True, "milliseconds": round((time.monotonic() - started) * 1000),
             "scope": "One supplied photo: twelve individual controls, five signed negative endpoints, original three/five/ten-control and twelve-control combinations, zero reset, and a blank negative; no naturalness or native parity claim"}
    (args.output / "acceptance.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS: " + str(args.output / "acceptance.json"), flush=True)


if __name__ == "__main__":
    main()
