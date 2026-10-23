"""Analyze an imported photo through the same isolated CPU path used for rendering."""
import json
from pathlib import Path
import tempfile

if __package__:
    from .glute_analysis import validate_detection
    from .photo_controls import validate_photo_controls
else:
    from glute_analysis import validate_detection
    from photo_controls import validate_photo_controls


def analyze_import(*, runner, source, photo):
    if __package__:
        from .backend import verify_native_inventory
    else:
        from backend import verify_native_inventory
    edits = {"backgroundProtection": False, "strokes": [], "autoButtocks": True}
    values = validate_photo_controls(controls={"ButtLift": 0}, extended=True)
    with tempfile.TemporaryDirectory(prefix="body-contour-analysis-") as temporary:
        work = Path(temporary)
        runner(source=source, values=values, edits=edits, output=work / "original.png", report=work / "receipt.json")
        report = json.loads((work / "receipt.json").read_text(encoding="utf-8"))
        if not isinstance(report, dict):
            raise ValueError("import contour analysis receipt must be an object")
        if (report.get("inputRgbaSha256") != photo["rgbaSha256"]
                or report.get("outputRgbaSha256") != photo["rgbaSha256"]
                or report.get("inputPngSha256") != photo["pngSha256"]
                or report.get("changedPixels") != 0 or report.get("sourceAndAssetsUnchanged") is not True
                or report.get("edits") != edits):
            raise ValueError("import contour analysis must preserve the normalized photo")
        detection = report.get("photoEdits", {}).get("buttocksDetection")
        verify_native_inventory(receipt=report)
        return validate_detection(detection=detection, source_hash=photo["rgbaSha256"])
