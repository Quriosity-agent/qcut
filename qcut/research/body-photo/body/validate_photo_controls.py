"""Verify optional photo controls on the existing private six-photo fixture over HTTP."""
import argparse
from collections import Counter
from functools import partial
from importlib.metadata import version
import json
import os
from pathlib import Path

if __package__:
    from .runtime_paths import runtime_root
else:
    from runtime_paths import runtime_root
import platform
import sys
import time

from PIL import Image

if __package__:
    from .photo_controls import EXTRA_RANGES, SKIN_CONTROLS, validate_photo_controls
    from .validate_portable import (BODY_ROOT, cpu_service, digest, fixture_cases, png_pixels,
                                    request, save_json, select_cases, verify_case)
else:
    from photo_controls import EXTRA_RANGES, SKIN_CONTROLS, validate_photo_controls
    from validate_portable import (BODY_ROOT, cpu_service, digest, fixture_cases, png_pixels,
                                   request, save_json, select_cases, verify_case)


FIXTURE_SHA256 = "c0cb8f812ebaf1705e4a0f68226b7f35a2420095428fba71129e8eaa47f24375"
SAMPLES = {
    "vsx-26": ("a874aae3f5d3a6d58692ff2e9120f25925c6cb336b58f326bdfd9543454bdacd",
               "26668183e68b09f12b645f59ce91d639608f7bf44a1487c3b1795c5b5daf5204", 1136, 1536),
    "vsx-04": ("dac715afb35878de0d0b55044beb728432e533d175a1699ba07c94f8bff7fb71",
               "86f3bd87a591baf174d0bda93d0a80e16ec8f4819446a2a6914143d294d360d9", 1136, 1536),
    "vsx-13": ("851965a8eca7ab8ae0fbdc9a8bd2f708fa632d51560de5cf3ee1bdc185c15a29",
               "37acf5dbed0d6738d3ffc0360aa5e6b1d10c9853de7dc42e6f328f8b96f64ad4", 1136, 1536),
    "vsx-18": ("fd5af949ff2667cc440a608006da3b1ace6d6ec263a7901533301b0d04c1c29a",
               "75c0b5c509e7134ebba9f280b84b2bb04017bf12e536e7626312e6412c1cdbef", 1237, 1536),
    "vsx-33": ("9581577ffb0b9dddd7c0150a48d4d36f1ba10f5b74800fd06b73be0685f7c97c",
               "afdd39d675451959d7b583d69c7767487ebf2b2e990eebe57da0cd10850eb399", 1136, 1536),
    "vsx-03": ("116dbfd12298f3d83948208c4ea0458b5ef888194b344623f3ecbb39be71eaeb",
               "ceacf8ea20c78fbef8640e6c4ada4b6dd2add5a7043c5b73cc684d358bdeab74", 1136, 1536),
}
EXPECTED = {
    "vsx-26": set(EXTRA_RANGES),
    "vsx-04": set(EXTRA_RANGES) - {"LegStraighten"},
    "vsx-13": set(EXTRA_RANGES) - {"LegStraighten"},
    "vsx-18": {"Abdomen"},
    "vsx-33": {"Abdomen", *SKIN_CONTROLS},
    "vsx-03": set(),
}
VALIDATE_CONTROLS = partial(validate_photo_controls, extended=True)


def photo_cases(*, sample):
    if sample not in SAMPLES:
        raise ValueError("unknown photo fixture identity")
    zeros = {name: 0 for name in EXTRA_RANGES}
    variants = [("zero", zeros, False)]
    variants.extend((name + "-positive", {name: maximum}, False)
                    for name, (_, maximum) in EXTRA_RANGES.items())
    variants.extend((name + "-negative", {name: minimum}, False)
                    for name, (minimum, _) in EXTRA_RANGES.items() if minimum < 0)
    combined = {"Abdomen": 60, "AnkleWidth": -25, "BodySkinTone": 35, "BodySkinWarmth": 15}
    variants.extend((("combined", combined, False), ("combined-protected", combined, True),
                     ("legacy-waist", {"SlimWaist": 60}, False),
                     ("legacy-extra-zero", {"SlimWaist": 60, **zeros}, False)))
    cases = []
    for variant, values, protected in variants:
        requested = {name for name, value in values.items() if value}
        applied = requested & (EXPECTED[sample] | {"SlimWaist"})
        status = ("identity" if not requested else "unavailable" if not applied
                  else "applied" if applied == requested else "partial")
        cases.append({"id": sample + "--" + variant, "sample": sample, "variant": variant,
                      "values": dict(values), "expectedStatus": status,
                      "expectedAppliedControls": sorted(applied),
                      **({"edits": {"backgroundProtection": True, "strokes": []}} if protected else {})})
    return cases


def selected_cases(*, shard_index=0, shard_count=1):
    # Keep both legacy comparison requests on one worker; no cross-job evidence is assumed.
    samples = select_cases(cases=list(SAMPLES), shard_index=shard_index, shard_count=shard_count)
    return [case for sample in samples for case in photo_cases(sample=sample)]


def fixture_inputs(*, root):
    root = Path(root)
    if root.is_symlink() or (root / "inputs").is_symlink():
        raise ValueError("regular fixture directories required")
    manifest = fixture_cases(root=root)
    if digest(data=(root / "cases.json").read_bytes()) != FIXTURE_SHA256:
        raise ValueError("six-photo fixture manifest identity changed")
    if {case["sample"] for case in manifest["cases"]} != set(SAMPLES):
        raise ValueError("fixture sample inventory differs from six-photo identity")
    samples = {}
    for sample, (png_hash, rgba_hash, width, height) in SAMPLES.items():
        path = root / "inputs" / (sample + ".png")
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 20 * 1024**2:
            raise ValueError("bounded regular sample PNG required")
        data = path.read_bytes()
        if digest(data=data) != png_hash:
            raise ValueError("fixture sample identity changed: " + sample)
        pixels = png_pixels(data=data)
        if pixels.shape != (height, width, 4) or digest(data=pixels.tobytes()) != rgba_hash:
            raise ValueError("fixture sample pixels differ: " + sample)
        samples[sample] = data
    return samples


def fresh_output(*, output, fixture_root):
    output = Path(output).absolute()
    resolved = output.resolve()
    protected = (BODY_ROOT.resolve(), (runtime_root(body_root=BODY_ROOT)).resolve(), Path(fixture_root).resolve())
    if output.exists() or output.is_symlink() or any(resolved.is_relative_to(root) for root in protected):
        raise ValueError("fresh output directory outside application, runtime and fixtures required")
    return output


def verify_source(*, sample, photo, original):
    if sample not in SAMPLES or not isinstance(photo, dict) or not photo.get("photoId"):
        raise ValueError("known sample and imported photo identity required")
    _, rgba_hash, width, height = SAMPLES[sample]
    pixels = png_pixels(data=original)
    if (pixels.shape != (height, width, 4) or digest(data=pixels.tobytes()) != rgba_hash
            or photo.get("pngSha256") != digest(data=original)
            or photo.get("rgbaSha256") != rgba_hash or photo.get("width") != width or photo.get("height") != height):
        raise ValueError("normalized source does not match the declared sample identity")


def verify_photo_case(*, case, photo, response, receipt, original, result, download):
    verify_source(sample=case["sample"], photo=photo, original=original)
    evidence, half = verify_case(case=case, photo=photo, response=response, receipt=receipt,
        original=original, result=result, download=download, control_validator=VALIDATE_CONTROLS)
    values = VALIDATE_CONTROLS(controls=case["values"])
    requested = {name for name, value in values.items() if value}
    applied = set(evidence["appliedControls"])
    expected_status = ("identity" if not requested else "unavailable" if not applied
                       else "applied" if requested == applied else "partial")
    if response["status"] != expected_status:
        raise ValueError("status does not describe the actual applied-control set")
    parts = receipt.get("parts")
    if requested:
        if (not isinstance(parts, dict) or set(parts) != set(values)
                or receipt.get("sourceAndAssetsUnchanged") is not True
                or receipt.get("nativeGeometryUsed") is not False or receipt.get("fixedLandmarks") is not False
                or receipt.get("actualEffectStatus") != ("applied" if evidence["changedPixels"] else "unavailable")):
            raise ValueError("actual per-part or source-verification evidence missing")
        for name, value in values.items():
            part = parts[name]
            if not isinstance(part, dict) or type(part.get("moved")) is not bool:
                raise ValueError("per-part movement must be explicit")
            if bool(value and part["moved"] and evidence["changedPixels"]) != (name in applied):
                raise ValueError("per-part movement contradicts applied-control feedback")
            if name in SKIN_CONTROLS and name in applied:
                selection = part.get("skinSelection")
                if (part.get("changedProtectedPixels") != 0 or part.get("alphaUnchanged") is not True
                        or part.get("textureGenerated") is not False or not isinstance(selection, dict)
                        or selection.get("available") is not True):
                    raise ValueError("skin protection evidence missing")
    return {**evidence, "perPart": {name: parts[name] for name in requested} if requested else {}}, half


def verify_legacy_pair(*, legacy, extended, legacy_png, extended_png):
    if (legacy.get("sample") != extended.get("sample") or legacy.get("passed") is not True
            or extended.get("passed") is not True or legacy.get("variant") != "legacy-waist"
            or extended.get("variant") != "legacy-extra-zero"):
        raise ValueError("verified matching legacy/extra-zero pair required")
    values = legacy["request"]["values"]
    extras = extended["request"]["values"]
    if values != {"SlimWaist": 60} or extras != {**values, **{name: 0 for name in EXTRA_RANGES}}:
        raise ValueError("legacy comparison requests do not differ only by zero extra controls")
    if (legacy_png != extended_png or legacy.get("status") != extended.get("status")
            or legacy.get("appliedControls") != extended.get("appliedControls")
            or legacy.get("outputPngSha256") != digest(data=legacy_png)
            or extended.get("outputPngSha256") != digest(data=extended_png)):
        raise ValueError("zero extra controls changed legacy output or application")
    return {"sample": legacy["sample"], "passed": True, "pngBytesIdentical": True,
            "pngSha256": digest(data=legacy_png), "cases": [legacy["id"], extended["id"]]}


def run_case(*, case, base, output, photo, original):
    folder = output / case["id"]
    folder.mkdir()
    payload = {"photoId": photo["photoId"], "values": case["values"]}
    if "edits" in case:
        payload["edits"] = case["edits"]
    save_json(path=folder / "request.json", value=payload)
    started = time.monotonic()
    status, body, _ = request(base=base, path="/api/render", data=json.dumps(payload, allow_nan=False).encode())
    response = json.loads(body)
    save_json(path=folder / "response.json", value=response)
    if status != 200 or not isinstance(response, dict):
        raise ValueError("actual render HTTP request failed: " + str(status))
    downloaded = {}
    for kind, url in (("result", response["result"]["url"]), ("download", response["result"]["downloadUrl"]),
                      ("receipt", response["receiptUrl"])):
        status, data, _ = request(base=base, path=url)
        if status != 200:
            raise ValueError("actual " + kind + " HTTP download failed")
        downloaded[kind] = data
    (folder / "result.png").write_bytes(downloaded["result"])
    (folder / "receipt.json").write_bytes(downloaded["receipt"])
    evidence, half = verify_photo_case(case=case, photo=photo, response=response,
        receipt=json.loads(downloaded["receipt"]), original=original, result=downloaded["result"],
        download=downloaded["download"])
    Image.fromarray(half).save(folder / "half.png")
    return {"id": case["id"], "sample": case["sample"], "variant": case["variant"],
            "passed": True, "request": payload, "expectedStatus": case["expectedStatus"],
            "expectedAppliedControls": case["expectedAppliedControls"], **evidence,
            "milliseconds": round((time.monotonic() - started) * 1000), "source": "sources/" + case["sample"] + ".png",
            "result": case["id"] + "/result.png", "half": case["id"] + "/half.png", "receipt": case["id"] + "/receipt.json"}


def validate(*, fixture_root, output, shard_index=0, shard_count=1):
    samples = fixture_inputs(root=fixture_root)
    fixture_root = Path(fixture_root).resolve()
    cases = selected_cases(shard_index=shard_index, shard_count=shard_count)
    output = fresh_output(output=output, fixture_root=fixture_root)
    output.mkdir(parents=True)
    (output / "sources").mkdir()
    records, comparisons = [], []
    summary = {"schemaVersion": 1, "platform": sys.platform, "system": platform.platform(),
        "machine": platform.machine(), "python": platform.python_version(), "sourceHead": os.environ.get("GITHUB_SHA"),
        "versions": {name: version(name) for name in ("numpy", "Pillow", "onnxruntime")},
        "transport": "real-loopback-HTTP", "engine": "EngineRunner-subprocess", "backend": "portable-CPU",
        "modelProvider": "CPUExecutionProvider", "fixtureSha256": FIXTURE_SHA256,
        "sourceHashes": {name: digest(data=data) for name, data in samples.items()},
        "naturalnessAcceptance": False, "nativeProductParity": False,
        "expectationBasis": "observed six-photo pose and skin gates; no golden output or visual acceptance",
        "fullFixtureTotal": sum(len(photo_cases(sample=name)) for name in SAMPLES),
        "shard": {"index": shard_index, "count": shard_count, "samples": list(dict.fromkeys(case["sample"] for case in cases))},
        "total": len(cases), "completed": 0, "passed": False, "completedAll": False,
        "cases": records, "legacyComparisons": comparisons}
    save_json(path=output / "acceptance.json", value=summary)
    with cpu_service() as (base, _):
        status, raw, _ = request(base=base, path="/api/catalog")
        catalog = json.loads(raw)
        expected_names = set(VALIDATE_CONTROLS(controls={name: 0 for name in EXTRA_RANGES}))
        if (status != 200 or catalog.get("platform", {}).get("backend") != "portable-CPU"
                or {item["name"] for item in catalog.get("controls", [])} != expected_names):
            raise ValueError("HTTP service must expose the exact portable 21-control catalog")
        imported = {}
        for sample in summary["shard"]["samples"]:
            status, raw, _ = request(base=base, path="/api/photos", data=samples[sample], content_type="image/png")
            if status != 200:
                raise ValueError("fixture photo import failed: " + sample)
            photo = json.loads(raw)
            status, original, _ = request(base=base, path=photo["url"])
            if status != 200:
                raise ValueError("normalized photo HTTP download failed")
            verify_source(sample=sample, photo=photo, original=original)
            (output / "sources" / (sample + ".png")).write_bytes(original)
            imported[sample] = photo, original
        for case in cases:
            try:
                photo, original = imported[case["sample"]]
                record = run_case(case=case, base=base, output=output, photo=photo, original=original)
            except (ValueError, OSError, KeyError, TypeError) as error:
                record = {"id": case["id"], "sample": case["sample"], "variant": case["variant"],
                          "passed": False, "status": "verification-failed", "error": str(error)}
            records.append(record)
            if (output / case["id"]).is_dir():
                save_json(path=output / case["id"] / "check.json", value=record)
            summary.update(completed=len(records), counts=dict(Counter(item["status"] for item in records)))
            save_json(path=output / "acceptance.json", value=summary)
            print(json.dumps({key: record[key] for key in ("id", "status", "passed")}), flush=True)
    for sample in summary["shard"]["samples"]:
        try:
            legacy, extended = [next(row for row in records if row["sample"] == sample and row["variant"] == variant)
                                for variant in ("legacy-waist", "legacy-extra-zero")]
            comparisons.append(verify_legacy_pair(legacy=legacy, extended=extended,
                legacy_png=(output / legacy["result"]).read_bytes(), extended_png=(output / extended["result"]).read_bytes()))
        except (ValueError, OSError, KeyError) as error:
            comparisons.append({"sample": sample, "passed": False, "error": str(error)})
    unchanged = fixture_inputs(root=fixture_root) == samples
    summary.update(fixturesUnchanged=unchanged, completedAll=len(records) == len(cases),
                   passed=unchanged and all(row["passed"] for row in records + comparisons))
    save_json(path=output / "acceptance.json", value=summary)
    return summary


def main(*, argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    args = parser.parse_args(argv)
    summary = validate(fixture_root=args.fixture_root, output=args.output,
                       shard_index=args.shard_index, shard_count=args.shard_count)
    print(json.dumps({"passed": summary["passed"], "completed": summary["completed"],
                      "report": str(args.output / "acceptance.json")}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
