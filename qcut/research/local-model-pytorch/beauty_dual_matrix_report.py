"""Offline static-control evidence from explicit face-live-bridge-probe-v1 audits.

Input: {"schema":"beauty-dual-matrix-v1","cases":[{"id":"eye-50",
"portrait":"front","category":"face-controls","label":"Eye 50",
"audit":"/absolute/fresh/probe/report.json","frame":0}]}.
Optional case fields parameters, adjustments and error are preserved as labels,
not substituted for audited controls. Frame indexes exclude warmup requests.
Explicit nonempty error cases may omit audit/frame; they are RUNNER_FAILED.
Requires only NumPy and Pillow; never imports or launches a native/ONNX runtime.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import html
import io
import json
from pathlib import Path
import stat

import numpy as np
from PIL import Image

LIMIT = 64 * 1024**2
PAIRS = (("native_original", "original", "native"),
         ("live_original", "original", "live"), ("native_live", "native", "live"))
WARNING = ("Static-controls native-dependent research only. Live ONNX hybrid still depends on native "
           "full-frame preprocessing, detection/acceptance, crop geometry, tracking/reset, masks and rendering. "
           "Pixel equality is not UI integration, standalone ONNX support, product parity, native head/point "
           "value parity or temporal acceptance. Audit outcome and visible control activity are separate.")


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def read_bytes(*, path, limit=LIMIT):
    before = path.stat()
    require(condition=stat.S_ISREG(before.st_mode) and before.st_size <= limit,
            message=f"nonregular or oversized file: {path}")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    after = path.stat()
    require(condition=len(data) == before.st_size and
            (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), message=f"file changed: {path}")
    return data


def parse_json(*, data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(condition=key not in result, message=f"duplicate JSON key: {key}")
            result[key] = value
        return result

    def constant(value):
        raise ValueError(f"nonfinite JSON number: {value}")

    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def snapshot(*, data, out, prefix):
    sha = digest(data=data)
    relative = f"sources/{prefix}-{sha}.json"
    path = out / relative
    if not path.exists():
        with path.open("xb") as stream:
            stream.write(data)
    return dict(sha256=sha, bytes=len(data), snapshot=relative)


def metrics(*, reference, actual):
    require(condition=reference.shape == actual.shape and reference.ndim == 3 and
            reference.shape[2] == 4 and reference.size > 0 and
            reference.dtype == actual.dtype == np.uint8, message="equal nonempty uint8 RGBA shapes required")
    delta = np.abs(actual.astype(np.int16) - reference.astype(np.int16))
    rgb, alpha = delta[:, :, :3], delta[:, :, 3]
    changed_rgb, changed_alpha = np.any(rgb != 0, axis=2), alpha != 0
    pixels = int(alpha.size)
    return dict(pixel_count=pixels, rgb_sample_count=pixels * 3,
        rgb_abs_sum=int(rgb.sum()), rgb_mae=float(rgb.mean()), rgb_max=int(rgb.max()),
        alpha_abs_sum=int(alpha.sum()), alpha_mae=float(alpha.mean()), alpha_max=int(alpha.max()),
        rgb_changed_pixels=int(changed_rgb.sum()), alpha_changed_pixels=int(changed_alpha.sum()),
        alpha_only_changed_pixels=int((changed_alpha & ~changed_rgb).sum()),
        rgba_changed_pixels=int((changed_rgb | changed_alpha).sum()), equal=not bool(delta.any()))


def difference_image(*, reference, actual):
    delta = np.abs(actual[:, :, :3].astype(np.int16) - reference[:, :, :3].astype(np.int16))
    return np.minimum(delta.max(axis=2) * 8, 255).astype(np.uint8)


def export_image(*, pixels, path):
    image = Image.fromarray(pixels)
    encoded = io.BytesIO()
    image.save(encoded, format="PNG")
    data = encoded.getvalue()
    with path.open("xb") as stream:
        stream.write(data)
    return dict(file=f"images/{path.name}", sha256=digest(data=data), bytes=len(data))


def select_request(*, audit, phase, frame):
    rows = audit.get("requests", {}).get(phase, [])
    require(condition=type(rows) is list and all(type(row) is dict for row in rows),
            message=f"invalid {phase} request inventory")
    matches = [row for row in rows if type(row.get("frame")) is int and
               row["frame"] == frame and row.get("warmup") is False]
    if not matches:
        raise FileNotFoundError(f"no recorded non-warmup {phase} request for frame {frame}")
    require(condition=len(matches) == 1, message=f"ambiguous {phase} frame {frame}")
    require(condition={"id", "frame", "warmup", "timestamp", "timestamp_us", "output"} <= matches[0].keys(),
            message=f"incomplete {phase} request")
    return matches[0]


def verify_pixels(*, path, audit_path, audit, expected_hashes, width, height):
    path = path if path.is_absolute() else audit_path.parent / path
    require(condition=path.resolve().is_relative_to(audit_path.parent.resolve()),
            message="RGBA artifact outside referenced audit directory")
    data = read_bytes(path=path, limit=16 * 1024**2)
    require(condition=len(data) == width * height * 4, message=f"RGBA byte length mismatch: {path}")
    sha, checks = digest(data=data), ["dimensions"]
    relative = path.relative_to(audit_path.parent).as_posix()
    artifacts = audit.get("artifacts", {})
    require(condition=type(artifacts) is dict, message="invalid artifact inventory")
    if relative in artifacts:
        receipt = artifacts[relative]
        require(condition=type(receipt) is dict, message="invalid artifact receipt")
        expected_hashes["artifacts.sha256"] = receipt.get("sha256")
        if "identity" in receipt:
            identity = receipt["identity"]
            require(condition=type(identity) is list and len(identity) == 5 and
                    type(identity[3]) is int and identity[3] == len(data), message="artifact byte length mismatch")
            checks.append("artifacts.identity.size")
    dependency_hash = audit.get("dependencies", {}).get("files", {}).get(str(path))
    if dependency_hash is not None:
        expected_hashes["dependencies.files"] = dependency_hash
    for source, expected in expected_hashes.items():
        require(condition=type(expected) is str and expected == sha, message=f"SHA-256 mismatch: {source}: {path}")
        checks.append(source)
    pixels = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 4)
    return pixels, dict(path=str(path), sha256=sha, bytes=len(data), checks=checks,
                       audit_hash_verified=bool(expected_hashes))


def record_issue(*, result, error, role=None):
    result["issues"].append(dict(kind="missing" if isinstance(error, FileNotFoundError) else "invalid",
                                 role=role, error=f"{type(error).__name__}: {error}"))


def load_audit(*, case, out, cache):
    path = Path(case["audit"])
    require(condition=path.is_absolute(), message="case audit must be an absolute report path")
    if str(path) not in cache:
        data = read_bytes(path=path)
        receipt = dict(path=str(path), **snapshot(data=data, out=out, prefix="audit"))
        value = parse_json(data=data)
        require(condition=type(value) is dict and value.get("schema") == "face-live-bridge-probe-v1",
                message="face-live-bridge-probe-v1 audit required")
        cache[str(path)] = (value, receipt)
    return path, *cache[str(path)]


def manifest_reference(*, audit, out):
    reference = dict(path=audit.get("manifest"), expected_sha256=audit.get("manifest_sha256"))
    if not reference["path"]:
        return dict(reference, status="unavailable")
    try:
        data = read_bytes(path=Path(reference["path"]))
        reference.update(snapshot(data=data, out=out, prefix="manifest"))
    except OSError as error:
        return dict(reference, status="unavailable", error=str(error))
    expected = reference["expected_sha256"]
    require(condition=expected is None or reference["sha256"] == expected, message="probe manifest SHA-256 mismatch")
    return dict(reference, status="verified" if expected is not None else "unverified")


def collect_pixels(*, result, audit, audit_path, frame, out, index):
    width, height = audit.get("width"), audit.get("height")
    require(condition=all(type(value) is int and 0 < value <= 4096 for value in (width, height)) and
            width * height * 4 <= 16 * 1024**2, message="invalid audit RGBA dimensions")
    result.update(width=width, height=height)
    inputs = audit.get("input_frames", [])
    if type(inputs) is not list or frame >= len(inputs):
        raise FileNotFoundError(f"missing input frame {frame}")
    source = inputs[frame]
    require(condition=type(source) is dict, message="invalid input frame")
    result.update(parameters=source.get("parameters"), expect_change=source.get("expect_change"))
    if "parameters" in result["input"]:
        require(condition=result["input"]["parameters"] == result["parameters"],
                message="matrix parameters differ from audited controls")
    requests, pixels = {}, {}
    for role, phase in (("native", "baseline"), ("live", "live")):
        try:
            requests[role] = select_request(audit=audit, phase=phase, frame=frame)
        except (OSError, ValueError, TypeError, AttributeError) as error:
            record_issue(result=result, error=error, role=role)
    if len(requests) == 2:
        require(condition={key: value for key, value in requests["native"].items() if key != "output"} ==
                {key: value for key, value in requests["live"].items() if key != "output"},
                message="native/live request association mismatch")
    audited_frames = audit.get("frames", [])
    require(condition=type(audited_frames) is list, message="invalid audit frame metrics")
    receipts = [row for row in audited_frames if type(row) is dict and row.get("frame") == frame]
    require(condition=len(receipts) <= 1, message="duplicate audit frame receipt")
    for role in ("original", "native", "live"):
        if role != "original" and role not in requests:
            continue
        try:
            name = source.get("input") if role == "original" else requests[role].get("output")
            if not name:
                raise FileNotFoundError(f"missing {role} RGBA path")
            hashes = {}
            if role == "original" and "input_sha256" in source:
                hashes["input_frames.input_sha256"] = source["input_sha256"]
            key = "native_sha256" if role == "native" else "sha256"
            if role != "original" and receipts and key in receipts[0]:
                hashes[f"frames.{key}"] = receipts[0][key]
            pixels[role], result["artifacts"][role] = verify_pixels(path=Path(name), audit_path=audit_path,
                audit=audit, expected_hashes=hashes, width=width, height=height)
            result["images"][role] = export_image(pixels=pixels[role], path=out / "images" / f"{index:04d}-{role}.png")
        except (OSError, ValueError, TypeError, AttributeError) as error:
            record_issue(result=result, error=error, role=role)
    for name, left, right in PAIRS:
        if left in pixels and right in pixels:
            result["metrics"][name] = metrics(reference=pixels[left], actual=pixels[right])
            result["images"][name] = export_image(pixels=difference_image(reference=pixels[left], actual=pixels[right]),
                                                 path=out / "images" / f"{index:04d}-{name}.png")


def classify(*, result):
    for role in ("native", "live"):
        metric = result["metrics"].get(f"{role}_original")
        result["activity"][role] = ("UNAVAILABLE" if metric is None else "RGB_CHANGED" if metric["rgb_changed_pixels"]
                                   else "ALPHA_ONLY" if metric["alpha_changed_pixels"] else "NO_CHANGE")
    metric = result["metrics"].get("native_live")
    result["comparison"] = "UNAVAILABLE" if metric is None else "EXACT" if metric["equal"] else "DIFFERENT"
    if result["issues"]:
        return "INVALID" if any(row["kind"] == "invalid" for row in result["issues"]) else "MISSING"
    if len(result["artifacts"]) != 3 or metric is None:
        return "MISSING"
    if not metric["equal"]:
        return "DIFFERENT"
    if result["audit_status"] != "PASSED" or result["input"].get("error"):
        return "AUDIT_FAILED"
    if not all(row["audit_hash_verified"] for row in result["artifacts"].values()):
        return "UNVERIFIED"
    activity = result["activity"]["native"]
    return activity if activity in ("NO_CHANGE", "ALPHA_ONLY") else "EXACT"


def inspect_case(*, case, out, cache, index):
    result = dict(id=case["id"], portrait=case["portrait"], category=case["category"],
        label=case.get("label", case["id"]), frame=case.get("frame"), input=case, audit_status="UNAVAILABLE",
        issues=[], artifacts={}, images={}, metrics={}, activity={})
    if not case.get("audit"):
        result.update(status="RUNNER_FAILED", comparison="UNAVAILABLE",
                      activity=dict(native="UNAVAILABLE", live="UNAVAILABLE"))
        return result
    try:
        path, audit, receipt = load_audit(case=case, out=out, cache=cache)
        result["audit"] = receipt
        result["audit_outcome"] = {key: audit.get(key) for key in
            ("passed", "completed", "phase", "failures", "scope", "native_execution_performed", "live_checks_completed")}
        complete = all(audit.get(key) is True for key in
                       ("passed", "completed", "native_execution_performed", "live_checks_completed"))
        result["audit_status"] = "PASSED" if complete and audit.get("failures") == [] else "FAILED"
        try:
            result["probe_manifest"] = manifest_reference(audit=audit, out=out)
        except (OSError, ValueError, TypeError) as error:
            record_issue(result=result, error=error, role="manifest")
        collect_pixels(result=result, audit=audit, audit_path=path, frame=case["frame"], out=out, index=index)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        record_issue(result=result, error=error)
    result["status"] = classify(result=result)
    return result


def escaped(*, value):
    return html.escape(str(value), quote=True)


def render_cell(*, result, name, out):
    artifact = result["images"].get(name)
    if artifact is None:
        return '<td class="missing">UNAVAILABLE</td>'
    metric = result["metrics"].get(name)
    caption = ""
    if metric:
        caption = (f"RGB MAE {metric['rgb_mae']!r}; max {metric['rgb_max']}; "
                   f"RGB changed {metric['rgb_changed_pixels']}/{metric['pixel_count']}<br>"
                   f"Alpha MAE {metric['alpha_mae']!r}; max {metric['alpha_max']}; "
                   f"alpha changed {metric['alpha_changed_pixels']}; RGBA changed {metric['rgba_changed_pixels']}")
    return (f'<td><a href="{artifact["file"]}"><img width="{result["width"]}" height="{result["height"]}" '
            f'loading="lazy" alt="{escaped(value=result["label"])}: {name}" '
            f'src="{artifact["file"]}"></a><p>{caption}</p></td>')


def write_html(*, report, out):
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty dual matrix</title>',
        '<style>body{margin:24px;font:14px system-ui;color:#222;background:#fff}*{box-sizing:border-box;letter-spacing:0}',
        'h1{font-size:24px}h2{font-size:18px;margin:0}p{overflow-wrap:anywhere}a{color:#006e80}',
        '.warning{border-left:4px solid #ae731b;padding:12px;background:#fff8e5}label{display:inline-block;margin:8px 16px 8px 0}',
        'select{max-width:240px;padding:6px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}',
        '.scroll{overflow-x:auto}table{border-collapse:collapse;table-layout:fixed;width:100%;min-width:1140px}',
        'th,td{border:1px solid #ddd;padding:8px;vertical-align:top;overflow-wrap:anywhere;text-align:left}',
        'thead th{background:#edf5f4}tbody th{background:#f5f5f5}img{display:block;width:100%;height:auto;object-fit:contain}',
        'td p{font-size:12px;line-height:1.5}.missing{color:#a12929}pre{white-space:pre-wrap;overflow-wrap:anywhere}',
        '[hidden]{display:none!important}@media(max-width:600px){body{margin:12px}h1{font-size:20px}}</style>',
        '<h1>Beauty dual matrix</h1>', f'<p class="warning">{WARNING}</p>',
        '<p>RGBA byte comparisons; RGB MAE is over all RGB samples (0-255). Differences are grayscale ',
        'min(255, 8 * max(abs(RGB delta))), never normalized per image. Alpha is measured separately.</p>',
        f'<p>{escaped(value=json.dumps(report["counts"], sort_keys=True))}</p>',
        f'<p><a href="{report["matrix"]["snapshot"]}">Immutable matrix</a> | <a href="report.json">Report JSON</a></p>']
    for key in ("portrait", "category"):
        options = ''.join(f'<option value="{escaped(value=value)}">{escaped(value=value)}</option>'
                          for value in sorted({row[key] for row in report["cases"]}))
        parts.append(f'<label>{key.title()} <select id="{key}"><option value="">All</option>{options}</select></label>')
    parts.extend(['<span id="visible" role="status"></span><nav aria-label="Cases">'])
    for index, row in enumerate(report["cases"]):
        parts.append(f'<a data-case="{index}" href="#case-{index}">{escaped(value=row["label"])}</a>')
    columns = ("Original", "Native", "Live ONNX hybrid", "Native - original / gain 8",
               "Live - original / gain 8", "Native - live / gain 8")
    parts.append('</nav><div class="scroll"><table><thead><tr>' +
                 ''.join(f'<th scope="col">{name}</th>' for name in columns) + '</tr></thead>')
    for index, row in enumerate(report["cases"]):
        details = {key: value for key, value in row.items() if key != "images"}
        audit_link = (f'<a href="{row["audit"]["snapshot"]}">Audit JSON</a>' if "audit" in row else "Audit unavailable")
        parts.append(f'<tbody id="case-{index}" data-portrait="{escaped(value=row["portrait"])}" '
            f'data-category="{escaped(value=row["category"])}"><tr><th colspan="6">'
            f'<h2>{escaped(value=row["label"])} / {row["status"]}</h2>'
            f'<p>{escaped(value=row["portrait"])} / {escaped(value=row["category"])} / frame {row["frame"]} / '
            f'audit {row["audit_status"]} / native {row["activity"]["native"]} / live {row["activity"]["live"]}</p>'
            f'{audit_link}<details><summary>Metrics and provenance</summary>'
            f'<pre>{escaped(value=json.dumps(details, indent=2, allow_nan=False))}</pre></details></th></tr><tr>')
        parts.extend(render_cell(result=row, name=name, out=out) for name in
                     ("original", "native", "live", *(pair[0] for pair in PAIRS)))
        parts.append('</tr></tbody>')
    parts.append('''</table></div><script>
const portraits = document.getElementById('portrait'), categories = document.getElementById('category');
function filterCases() {
  let visible = 0;
  for (const [index, row] of [...document.querySelectorAll('tbody')].entries()) {
    row.hidden = Boolean((portraits.value && row.dataset.portrait !== portraits.value) ||
      (categories.value && row.dataset.category !== categories.value));
    document.querySelector(`nav a[data-case="${index}"]`).hidden = row.hidden;
    if (!row.hidden) visible += 1;
  }
  document.getElementById('visible').textContent = `${visible} cases`;
}
portraits.addEventListener('change', filterCases);
categories.addEventListener('change', filterCases);
filterCases();
</script></html>''')
    (out / "index.html").write_text(''.join(parts), encoding="utf-8")


def generate(*, matrix, out):
    data = read_bytes(path=matrix)
    value = parse_json(data=data)
    require(condition=type(value) is dict and value.get("schema") == "beauty-dual-matrix-v1" and
            type(value.get("cases")) is list and bool(value["cases"]), message="nonempty beauty-dual-matrix-v1 required")
    seen = set()
    for case in value["cases"]:
        require(condition=type(case) is dict and all(type(case.get(key)) is str and case[key].strip()
                for key in ("id", "portrait", "category")), message="case id/portrait/category required")
        require(condition=case["id"] not in seen, message="duplicate case id")
        seen.add(case["id"])
        if not case.get("audit"):
            require(condition=type(case.get("error")) is str and bool(case["error"].strip()),
                    message="missing audit allowed only for explicit nonempty runner error")
            continue
        require(condition=type(case["audit"]) is str and type(case.get("frame")) is int and case["frame"] >= 0,
                message="audit path and nonnegative integer frame required")
    out.mkdir(parents=True, exist_ok=False)
    (out / "sources").mkdir()
    (out / "images").mkdir()
    cache = {}
    cases = [inspect_case(case=case, out=out, cache=cache, index=index) for index, case in enumerate(value["cases"])]
    report = dict(schema="beauty-dual-matrix-report-v1", scope="static-controls-native-dependent-research",
        warning=WARNING, product_parity_verified=False, temporal_sequence_acceptance=False,
        gpu_launched=False, difference_gain=8, difference_formula="min(255, 8 * max(abs(RGB delta)))",
        matrix=dict(path=str(matrix.resolve()), **snapshot(data=data, out=out, prefix="matrix")),
        counts=dict(Counter(row["status"] for row in cases)), cases=cases)
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    write_html(report=report, out=out)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="new directory; existing reports are never overwritten")
    args = parser.parse_args()
    try:
        report = generate(matrix=args.matrix, out=args.out)
    except (OSError, ValueError) as error:
        parser.exit(2, f"{type(error).__name__}: {error}\n")
    print(json.dumps(dict(index=str((args.out / "index.html").resolve()), counts=report["counts"])))


if __name__ == "__main__":
    main()
