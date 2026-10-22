"""Apple person segmentation and a bounded background-preserving photo composite."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter


BODY_ROOT = Path(__file__).resolve().parent
MASK_THRESHOLD = 16


def _opaque_photo(*, value, name):
    if (not isinstance(value, np.ndarray) or value.dtype != np.uint8 or value.ndim != 3
            or value.shape[2] != 4 or min(value.shape[:2]) < 32 or max(value.shape[:2]) > 4096
            or value.shape[0] * value.shape[1] > 8_294_400 or np.any(value[..., 3] != 255)):
        raise ValueError(name + " must be a bounded opaque uint8 RGBA photo")


def _person_mask(*, value, shape, name):
    if not isinstance(value, np.ndarray) or value.dtype != np.uint8 or value.shape != shape:
        raise ValueError(name + " must be a uint8 mask matching the photo")
    foreground = int(np.count_nonzero(value >= 224))
    background = int(np.count_nonzero(value <= 32))
    support = int(np.count_nonzero(value >= MASK_THRESHOLD))
    minimum = max(16, round(value.size * .0005))
    if foreground < minimum or background < minimum or support / value.size >= .995:
        raise ValueError(name + " has no usable separation between person and background")
    return {"foregroundPixels": foreground, "backgroundPixels": background,
            "supportPixels": support, "sha256": hashlib.sha256(value.tobytes()).hexdigest()}


def _environment():
    return {name: value for name, value in os.environ.items()
            if not name.startswith(("DYLD_", "QCUT_", "BEAUTY_"))
            and name not in ("PYTHONPATH", "PYTHONHOME")}


def _run(*, arguments, timeout):
    try:
        result = subprocess.run(arguments, env=_environment(), capture_output=True,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("person segmentation command timed out") from error
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()[-800:]
        raise RuntimeError("person segmentation command failed: " + detail)
    return result.stdout


def _build_helper():
    if sys.platform != "darwin":
        raise ValueError("automatic person background protection currently requires macOS")
    source = BODY_ROOT / "person_mask.swift"
    source_bytes = source.read_bytes()
    compiler = _run(arguments=["/usr/bin/xcrun", "--find", "swiftc"], timeout=15).decode().strip()
    version = _run(arguments=[compiler, "--version"], timeout=15)
    identity = hashlib.sha256(source_bytes + version + platform.machine().encode()).hexdigest()
    cache = BODY_ROOT / ".state" / "cache"
    for path in (BODY_ROOT / ".state", cache):
        if path.is_symlink():
            raise ValueError("person segmentation cache cannot be a symlink")
        path.mkdir(mode=0o700, exist_ok=True)
    executable = cache / ("person-mask-" + identity)
    if executable.is_symlink() or (executable.exists() and not executable.is_file()):
        raise ValueError("person segmentation helper must be a regular file")
    if not executable.exists():
        with tempfile.TemporaryDirectory(prefix=".person-mask-build-", dir=cache) as temporary:
            staged = Path(temporary) / "person-mask"
            _run(arguments=["/usr/bin/xcrun", "swiftc", "-O", str(source), "-o", str(staged)], timeout=90)
            if source.read_bytes() != source_bytes:
                raise ValueError("person segmentation source changed during compilation")
            staged.chmod(0o700)
            os.replace(staged, executable)
    if not 0 < executable.stat().st_size <= 16 * 1024**2:
        raise ValueError("bounded person segmentation helper required")
    return executable, {"helperSourceSha256": hashlib.sha256(source_bytes).hexdigest(),
                        "helperSha256": hashlib.sha256(executable.read_bytes()).hexdigest()}


def get_person_mask(*, rgba, work):
    """Return top-left uint8 alpha; invalid segmentation never falls back to unprotected output."""
    _opaque_photo(value=rgba, name="source")
    executable, identity = _build_helper()
    work = Path(work)
    if not work.is_dir() or work.is_symlink():
        raise ValueError("existing regular mask work directory required")
    with tempfile.TemporaryDirectory(prefix="person-mask-", dir=work) as temporary:
        folder = Path(temporary)
        image, output, request = folder / "input.png", folder / "mask.raw", folder / "request.json"
        Image.fromarray(rgba).save(image)
        request.write_text(json.dumps({"image": str(image), "output": str(output)}), encoding="utf-8")
        raw_report = _run(arguments=[str(executable), str(request)], timeout=45)
        if ("helperSha256" in identity
                and hashlib.sha256(executable.read_bytes()).hexdigest() != identity["helperSha256"]):
            raise ValueError("person segmentation helper changed during inference")
        try:
            details = json.loads(raw_report)
            width, height = details["width"], details["height"]
            if (type(width) is not int or type(height) is not int or min(width, height) < 1
                    or max(width, height) > 4096 or width * height > 8_294_400
                    or details.get("orientation") != "top-left" or details.get("framework") != "Apple Vision"):
                raise ValueError("invalid Vision mask metadata")
            raw = output.read_bytes()
            if len(raw) != width * height:
                raise ValueError("invalid Vision mask byte count")
            small = np.frombuffer(raw, np.uint8).reshape(height, width)
            mask = np.array(Image.fromarray(small).resize((rgba.shape[1], rgba.shape[0]),
                             Image.Resampling.BILINEAR), dtype=np.uint8, copy=True)
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            raise ValueError("invalid Vision mask response") from error
    stats = _person_mask(value=mask, shape=rgba.shape[:2], name="Vision person mask")
    return mask, {**identity, **details, **stats, "sourceSize": [rgba.shape[1], rgba.shape[0]],
                  "provider": "apple-vision-person-segmentation-v1", "downloadedModels": False,
                  "operatingSystemModel": True, "nativeVendorLibraries": False}


def protection_alpha(*, source_mask, warped_mask):
    if not isinstance(source_mask, np.ndarray) or source_mask.ndim != 2 or min(source_mask.shape) < 32:
        raise ValueError("source mask must be a bounded two-dimensional photo mask")
    shape = source_mask.shape
    if max(shape) > 4096 or shape[0] * shape[1] > 8_294_400:
        raise ValueError("source mask dimensions exceed the photo limit")
    source_stats = _person_mask(value=source_mask, shape=shape, name="source mask")
    warped_stats = _person_mask(value=warped_mask, shape=shape, name="warped mask")
    support = np.maximum(source_mask, warped_mask) >= MASK_THRESHOLD
    padding = max(2, min(8, round(max(shape) / 512)))
    feather = 2
    matte = Image.fromarray(support.astype(np.uint8) * 255)
    expanded = matte.filter(ImageFilter.MaxFilter(padding * 2 + 1))
    alpha = np.array(expanded.filter(ImageFilter.BoxBlur(feather)), dtype=np.uint8, copy=True)
    # The old silhouette stays fully inside the warp to avoid retaining a second person outline.
    alpha[support] = 255
    return alpha, {"sourceMask": source_stats, "warpedMask": warped_stats,
                   "maskThreshold": MASK_THRESHOLD, "dilationPixels": padding, "featherPixels": feather}


def protect_background(*, original, warped, source_mask, warped_mask):
    _opaque_photo(value=original, name="original")
    _opaque_photo(value=warped, name="warped")
    if (original.shape != warped.shape or not isinstance(source_mask, np.ndarray)
            or source_mask.shape != original.shape[:2]):
        raise ValueError("photo and person-mask dimensions must match")
    alpha, mask_details = protection_alpha(source_mask=source_mask, warped_mask=warped_mask)
    weight = alpha.astype(np.uint32)[..., None]
    result = ((original.astype(np.uint32) * (255 - weight)
               + warped.astype(np.uint32) * weight + 127) // 255).astype(np.uint8)
    protected = alpha == 0
    unchanged = int(np.count_nonzero(np.any(result[protected] != original[protected], axis=-1)))
    if unchanged:
        raise RuntimeError("background preservation invariant failed")
    return result, {**mask_details, "enabled": True, "applied": True,
                    "method": "source-and-warped-person-union-v1", "protectedPixels": int(protected.sum()),
                    "editablePixels": int(np.count_nonzero(alpha)), "changedProtectedPixels": unchanged,
                    "blendMaskSha256": hashlib.sha256(alpha.tobytes()).hexdigest(),
                    "backgroundReconstruction": False, "boundaryCorridorMayMove": True,
                    "limitation": "the person boundary corridor and background revealed by shrinking may deform"}
