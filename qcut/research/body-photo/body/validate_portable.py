"""Run declared photo fixtures through real HTTP and portable CPU rendering."""
import argparse
from collections import Counter
from contextlib import contextmanager
import hashlib
from importlib.metadata import version
import io
import json
import os
from pathlib import Path

if __package__:
    from .runtime_paths import runtime_root
else:
    from runtime_paths import runtime_root
import platform
import re
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

try:
    from .backend import AppError, BodyBackend
    from .control_contract import CONTROL_PARTS, validate_controls
    from .local_shape import validate_edits
    from .server import BodyHTTPServer, parse_json
except ImportError:
    from backend import AppError, BodyBackend
    from control_contract import CONTROL_PARTS, validate_controls
    from local_shape import validate_edits
    from server import BodyHTTPServer, parse_json


BODY_ROOT = Path(__file__).resolve().parent
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
STATUSES = {"identity", "applied", "partial", "unavailable"}


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def save_json(*, path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")


def fixture_cases(*, root):
    root = Path(root)
    path = root / "cases.json"
    if root.is_symlink() or path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024**2:
        raise ValueError("bounded regular fixture cases.json required")
    try:
        manifest = parse_json(data=path.read_bytes())
    except AppError as error:
        raise ValueError("fixture cases.json must contain strict JSON") from error
    cases = manifest.get("cases") if isinstance(manifest, dict) else None
    if (not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1
            or not isinstance(cases, list) or not 1 <= len(cases) <= 2000):
        raise ValueError("fixture schemaVersion1 and 1..2000 cases required")
    identifiers = set()
    for case in cases:
        if not isinstance(case, dict) or not {"id", "sample", "values"} <= set(case):
            raise ValueError("each fixture case needs id, sample and values")
        for name in ("id", "sample"):
            if not isinstance(case[name], str) or not IDENTIFIER.fullmatch(case[name]):
                raise ValueError("fixture identifiers must be bounded portable basenames")
        if case["id"] in identifiers or case["id"].lower() in {"sources", "acceptance.json"}:
            raise ValueError("duplicate or reserved fixture case id")
        identifiers.add(case["id"])
        source = root / "inputs" / (case["sample"] + ".png")
        if source.is_symlink() or not source.is_file() or not 0 < source.stat().st_size <= 20 * 1024**2:
            raise ValueError("fixture PNG must be a bounded regular file")
        expected = case.get("expectedStatus")
        error = case.get("expectedError")
        if expected is not None and (not isinstance(expected, str) or expected not in STATUSES):
            raise ValueError("unknown expected fixture status")
        if error is not None:
            if (expected is not None or not isinstance(error, dict) or set(error) != {"code", "status"}
                    or not isinstance(error["code"], str) or type(error["status"]) is not int
                    or not 400 <= error["status"] <= 599):
                raise ValueError("expectedError requires code and HTTP error status instead of expectedStatus")
        applied = case.get("expectedAppliedControls")
        if (applied is not None and (not isinstance(applied, list)
                or any(not isinstance(name, str) or name not in CONTROL_PARTS for name in applied)
                or len(set(applied)) != len(applied))):
            raise ValueError("expectedAppliedControls must contain distinct public controls")
        for flag in ("expectProtectedPixels", "expectNoPerson"):
            if flag in case and type(case[flag]) is not bool:
                raise ValueError("fixture expectation flags must be booleans")
    return manifest


def request(*, base, path, data=None, content_type="application/json"):
    if not isinstance(path, str) or not path.startswith("/api/") or path.startswith("//"):
        raise ValueError("only local body API URLs are accepted")
    call = Request(base + path, data=data, headers={"Content-Type": content_type})
    try:
        with urlopen(call, timeout=180) as response:
            return response.status, response.read(), dict(response.headers)
    except HTTPError as error:
        return error.code, error.read(), dict(error.headers)


@contextmanager
def cpu_service(*, body_root=BODY_ROOT):
    previous = os.environ.get("BODY_RENDER_BACKEND")
    os.environ["BODY_RENDER_BACKEND"] = "cpu"
    try:
        with tempfile.TemporaryDirectory(prefix="body-portable-validation-") as temporary:
            backend = BodyBackend(root=body_root, state=Path(temporary) / "state")
            server = BodyHTTPServer(address=("127.0.0.1", 0), backend=backend)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                yield "http://127.0.0.1:" + str(server.server_port), backend
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
    finally:
        if previous is None:
            os.environ.pop("BODY_RENDER_BACKEND", None)
        else:
            os.environ["BODY_RENDER_BACKEND"] = previous


def png_pixels(*, data):
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
            raise ValueError("one PNG frame required")
        result = np.array(image.convert("RGBA"), np.uint8, copy=True)
    if np.any(result[..., 3] != 255):
        raise ValueError("opaque PNG required")
    return result


def verify_case(*, case, photo, response, receipt, original, result, download, control_validator=None):
    if (not isinstance(response, dict) or not isinstance(receipt, dict)
            or not isinstance(response.get("result"), dict)):
        raise ValueError("response and receipt must contain image evidence objects")
    source, rendered = png_pixels(data=original), png_pixels(data=result)
    validator = validate_controls if control_validator is None else control_validator
    values = validator(controls=case["values"])
    edits = validate_edits(edits=case.get("edits"))
    requested = any(values.values()) or bool(edits["strokes"])
    if source.shape != rendered.shape or download != result:
        raise ValueError("export differs from preview or dimensions differ from original")
    changed = int(np.count_nonzero(np.any(source != rendered, axis=-1)))
    identities = {"inputPngSha256": digest(data=original), "outputPngSha256": digest(data=result),
                  "inputRgbaSha256": digest(data=source.tobytes()),
                  "outputRgbaSha256": digest(data=rendered.tobytes())}
    if any(receipt.get(name) != value for name, value in identities.items()):
        raise ValueError("receipt hash differs from downloaded image bytes")
    if (response.get("values") != values or receipt.get("controls") != values
            or response.get("photoId") != photo["photoId"]
            or response.get("result", {}).get("pngSha256") != identities["outputPngSha256"]
            or response.get("result", {}).get("rgbaSha256") != identities["outputRgbaSha256"]):
        raise ValueError("response values, identity or hashes do not match the request")
    status = response.get("status")
    if status not in STATUSES or not requested and (status != "identity" or changed or result != original):
        raise ValueError("zero request must return the exact original PNG")
    if status in {"identity", "unavailable"} and changed:
        raise ValueError("identity/unavailable output changed pixels")
    if status in {"applied", "partial"} and not changed:
        raise ValueError("applied status has no changed pixels")
    if requested and (receipt.get("backend") != "portable-CPU"
                      or receipt.get("changedPixels") != changed):
        raise ValueError("nonzero fixture did not produce a verified portable CPU receipt")
    controls = response.get("controls", {})
    if (not isinstance(controls, dict) or set(controls) != set(values)
            or any(not isinstance(item, dict) or item.get("requested") != values[name]
                                        or type(item.get("applied")) is not bool for name, item in controls.items())):
        raise ValueError("per-control feedback differs from requested values")
    applied = sorted(name for name, value in controls.items() if value["applied"])
    if any(not values[name] for name in applied):
        raise ValueError("zero control claimed an effect")
    if case.get("expectedAppliedControls") is not None and applied != sorted(case["expectedAppliedControls"]):
        raise ValueError("applied-control set differs from declared expectation")
    manual_count = 0
    if "edits" in case:
        if receipt.get("edits") != edits or response.get("edits") != edits:
            raise ValueError("local-edit request differs from its receipt")
        feedback = response.get("editFeedback", {})
        if not isinstance(feedback, dict) or not isinstance(feedback.get("manual"), dict):
            raise ValueError("invalid manual-stroke feedback")
        manual = feedback["manual"]
        manual_count = manual.get("applied")
        if (manual.get("requested") != len(edits["strokes"]) or type(manual_count) is not int
                or not 0 <= manual_count <= len(edits["strokes"])):
            raise ValueError("invalid manual-stroke feedback")
    photo_edits = receipt.get("photoEdits", {})
    if not isinstance(photo_edits, dict) or not isinstance(photo_edits.get("backgroundProtection", {}), dict):
        raise ValueError("invalid background-protection evidence")
    background = photo_edits.get("backgroundProtection", {})
    if (edits["backgroundProtection"] and changed) or case.get("expectProtectedPixels"):
        if (background.get("applied") is not True or background.get("changedProtectedPixels") != 0
                or type(background.get("protectedPixels")) is not int or background["protectedPixels"] <= 0):
            raise ValueError("background protection lacks zero-change protected-pixel evidence")
    if case.get("expectNoPerson") and (changed or status != "unavailable"
                                       or receipt.get("reason") != "no person detected"):
        raise ValueError("declared blank/no-person case did not fail closed")
    if case.get("expectedError") or case.get("expectedStatus") not in (None, status):
        raise ValueError("actual successful response differs from declared expectation")
    half = source.copy()
    half[:, source.shape[1] // 2:] = rendered[:, source.shape[1] // 2:]
    return {"status": status, "changedPixels": changed, "appliedControls": applied,
            "manualApplied": manual_count, "protectedPixels": background.get("protectedPixels", 0),
            "changedProtectedPixels": background.get("changedProtectedPixels"),
            "width": source.shape[1], "height": source.shape[0], **identities}, half


def run_case(*, case, base, output, photo, original):
    folder = output / case["id"]
    folder.mkdir()
    payload = {"photoId": photo["photoId"], "values": case["values"]}
    if "edits" in case:
        payload["edits"] = case["edits"]
    started = time.monotonic()
    status, body, _ = request(base=base, path="/api/render", data=json.dumps(payload, allow_nan=False).encode())
    response = json.loads(body)
    if not isinstance(response, dict):
        raise ValueError("body API response must be an object")
    save_json(path=folder / "response.json", value=response)
    record = {"id": case["id"], "sample": case["sample"], "httpStatus": status,
              "expectationDeclared": "expectedStatus" in case or "expectedError" in case,
              "request": payload, "milliseconds": round((time.monotonic() - started) * 1000),
              "source": "sources/" + case["sample"] + ".png"}
    if status != 200:
        error = response.get("error", {})
        if not isinstance(error, dict):
            raise ValueError("body API error must contain a structured error object")
        actual = {"code": error.get("code"), "status": status}
        passed = actual == case.get("expectedError")
        record.update(passed=passed, status="expected-error" if passed else "unexpected-error", error=actual)
        save_json(path=folder / "check.json", value=record)
        return record
    result_status, result, _ = request(base=base, path=response["result"]["url"])
    export_status, download, _ = request(base=base, path=response["result"]["downloadUrl"])
    receipt_status, receipt_bytes, _ = request(base=base, path=response["receiptUrl"])
    if (result_status, export_status, receipt_status) != (200, 200, 200):
        raise ValueError("output/receipt/export HTTP download failed")
    receipt = json.loads(receipt_bytes)
    (folder / "result.png").write_bytes(result)
    (folder / "receipt.json").write_bytes(receipt_bytes)
    evidence, half = verify_case(case=case, photo=photo, response=response, receipt=receipt,
                               original=original, result=result, download=download)
    Image.fromarray(half).save(folder / "half.png")
    record.update(**evidence, passed=record["expectationDeclared"], result=case["id"] + "/result.png",
                  half=case["id"] + "/half.png", receipt=case["id"] + "/receipt.json")
    save_json(path=folder / "check.json", value=record)
    return record



def select_cases(*, cases, shard_index=0, shard_count=1):
    if (type(shard_index) is not int or type(shard_count) is not int
            or not 1 <= shard_count <= min(len(cases), 256) or not 0 <= shard_index < shard_count):
        raise ValueError("shard index must be 0..count-1; count must be 1..min(case count,256)")
    return cases[shard_index::shard_count]


def validate(*, fixture_root, output, shard_index=0, shard_count=1):
    fixture_root, output = Path(fixture_root).resolve(), Path(output).absolute()
    manifest = fixture_cases(root=fixture_root)
    cases = select_cases(cases=manifest["cases"], shard_index=shard_index, shard_count=shard_count)
    if (output.exists() or output.is_symlink() or output.resolve().is_relative_to(BODY_ROOT)
            or output.resolve().is_relative_to(runtime_root(body_root=BODY_ROOT))
            or output.resolve().is_relative_to(fixture_root)):
        raise ValueError("fresh output directory outside application, runtime and fixtures required")
    output.mkdir(parents=True)
    (output / "sources").mkdir()
    sample_bytes = {case["sample"]: (fixture_root / "inputs" / (case["sample"] + ".png")).read_bytes()
                    for case in cases}
    records = []
    summary = {"schemaVersion": 1, "platform": sys.platform, "system": platform.platform(),
               "machine": platform.machine(), "python": platform.python_version(),
               "versions": {name: version(name) for name in ("numpy", "Pillow", "onnxruntime")},
               "transport": "real-loopback-HTTP", "engine": "EngineRunner-subprocess",
               "backend": "portable-CPU", "modelProvider": "CPUExecutionProvider",
               "fixtureSha256": digest(data=(fixture_root / "cases.json").read_bytes()),
               "sourceHashes": {name: digest(data=data) for name, data in sample_bytes.items()},
               "naturalnessAcceptance": False, "nativeProductParity": False,
               "fullFixtureTotal": len(manifest["cases"]),
               "shard": {"index": shard_index, "count": shard_count, "cases": len(cases)},
               "protectedPixelCheck": "verified receipt; independent mask replay is separate", "cases": records}
    with cpu_service() as (base, _):
        catalog_status, catalog_bytes, _ = request(base=base, path="/api/catalog")
        catalog = json.loads(catalog_bytes)
        if catalog_status != 200 or catalog.get("platform", {}).get("backend") != "portable-CPU":
            raise ValueError("HTTP service did not select the portable CPU backend")
        imported = {}
        for name, data in sample_bytes.items():
            status, raw, _ = request(base=base, path="/api/photos", data=data, content_type="image/png")
            if status != 200:
                raise ValueError("fixture photo import failed: " + name + " " + raw.decode("utf-8", "replace"))
            photo = json.loads(raw)
            status, original, _ = request(base=base, path=photo["url"])
            if status != 200 or digest(data=original) != photo["pngSha256"]:
                raise ValueError("fixture normalized source download failed")
            (output / "sources" / (name + ".png")).write_bytes(original)
            imported[name] = photo, original
        for case in cases:
            try:
                photo, original = imported[case["sample"]]
                record = run_case(case=case, base=base, output=output, photo=photo, original=original)
            except (ValueError, OSError, KeyError, TypeError) as error:
                record = {"id": case["id"], "sample": case["sample"], "passed": False,
                          "status": "verification-failed", "error": str(error),
                          "expectationDeclared": "expectedStatus" in case or "expectedError" in case}
            if (output / case["id"]).is_dir():
                save_json(path=output / case["id"] / "check.json", value=record)
            records.append(record)
            summary.update(passed=all(item["passed"] for item in records), completed=len(records),
                           total=len(cases), counts=dict(Counter(item["status"] for item in records)),
                           missingExpectations=sum(not item["expectationDeclared"] for item in records))
            save_json(path=output / "acceptance.json", value=summary)
            print(json.dumps({key: record[key] for key in ("id", "status", "passed")}), flush=True)
    unchanged = digest(data=(fixture_root / "cases.json").read_bytes()) == summary["fixtureSha256"] and all((fixture_root / "inputs" / (name + ".png")).read_bytes() == data
                    for name, data in sample_bytes.items())
    summary.update(fixturesUnchanged=unchanged, passed=summary["passed"] and unchanged,
                   completedAll=len(records) == len(cases))
    save_json(path=output / "acceptance.json", value=summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    arguments = parser.parse_args()
    summary = validate(fixture_root=arguments.fixture_root, output=arguments.output,
                       shard_index=arguments.shard_index, shard_count=arguments.shard_count)
    print(json.dumps({"passed": summary["passed"], "completed": summary["completed"],
                      "counts": summary["counts"], "report": str(arguments.output / "acceptance.json")}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
