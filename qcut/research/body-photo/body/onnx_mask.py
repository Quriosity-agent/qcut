"""Pinned PP-HumanSeg inference for portable, offline body-photo protection."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

if __package__:
    from .runtime_paths import runtime_root
    from .background import _opaque_photo, _person_mask
else:
    from runtime_paths import runtime_root
    from background import _opaque_photo, _person_mask


BODY_ROOT = Path(__file__).resolve().parent
MODEL_PATH = runtime_root(body_root=BODY_ROOT) / "body-portable" / "models" / "human_segmentation_pphumanseg_2023mar.onnx"
MODEL_SHA256 = "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"
MODEL_SIZE = 6_163_938
INPUT_NAME = "x"
OUTPUT_NAME = "save_infer_model/scale_0.tmp_1"


def model_manifest():
    manifest = json.loads((BODY_ROOT / "person-mask-model.json").read_text(encoding="utf-8"))
    if manifest.get("sha256") != MODEL_SHA256 or manifest.get("size") != MODEL_SIZE:
        raise ValueError("person mask manifest does not match the pinned model")
    return manifest


def verified_model_bytes(*, path=MODEL_PATH):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != MODEL_SIZE:
        raise ValueError("install the pinned person mask model with python -m body.download_person_mask")
    payload = path.read_bytes()
    if len(payload) != MODEL_SIZE or hashlib.sha256(payload).hexdigest() != MODEL_SHA256:
        raise ValueError("person mask model SHA-256 mismatch")
    return payload


@lru_cache(maxsize=1)
def _session(*, model_bytes):
    import onnxruntime

    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = onnxruntime.InferenceSession(
        model_bytes, sess_options=options, providers=["CPUExecutionProvider"])
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if (len(inputs) != 1 or inputs[0].name != INPUT_NAME
            or inputs[0].shape != [1, 3, 192, 192] or inputs[0].type != "tensor(float)"
            or len(outputs) != 1 or outputs[0].name != OUTPUT_NAME
            or outputs[0].shape != [1, 2, 192, 192] or outputs[0].type != "tensor(float)"
            or session.get_providers() != ["CPUExecutionProvider"]):
        raise ValueError("unexpected person mask ONNX input, output or execution provider")
    return session


def prepare_input(*, rgba):
    _opaque_photo(value=rgba, name="source")
    rgb = Image.fromarray(rgba[..., :3]).resize((192, 192), Image.Resampling.BILINEAR)
    normalized = (np.asarray(rgb, dtype=np.float32) / np.float32(255) - np.float32(.5)) / np.float32(.5)
    return np.ascontiguousarray(normalized.transpose(2, 0, 1)[None])


def restore_mask(*, prediction, size):
    if (not isinstance(prediction, np.ndarray) or prediction.dtype != np.float32
            or prediction.shape != (1, 2, 192, 192) or not np.isfinite(prediction).all()
            or np.min(prediction) < -1e-6 or np.max(prediction) > 1.000001
            or not np.allclose(prediction.sum(axis=1), 1, rtol=1e-4, atol=1e-4)):
        raise ValueError("invalid person mask model probabilities")
    if (not isinstance(size, (list, tuple)) or len(size) != 2
            or any(type(value) is not int for value in size)
            or min(size) < 32 or max(size) > 4096 or size[0] * size[1] > 8_294_400):
        raise ValueError("person mask output dimensions exceed the photo limit")
    # Restore the probabilities before class selection, preserving upstream class boundaries.
    foreground = np.asarray(Image.fromarray(prediction[0, 1]).resize(tuple(size), Image.Resampling.BILINEAR))
    background = np.asarray(Image.fromarray(prediction[0, 0]).resize(tuple(size), Image.Resampling.BILINEAR))
    return np.where(foreground > background, 255, 0).astype(np.uint8)


def get_person_mask(*, rgba, work):
    """Return a top-left uint8 silhouette; missing/tampered/empty masks fail closed."""
    _opaque_photo(value=rgba, name="source")
    work = Path(work)
    if work.is_symlink() or not work.is_dir():
        raise ValueError("existing regular mask work directory required")
    manifest = model_manifest()
    # Hash on every request; the cached session only accepts the verified bytes, not a mutable path.
    payload = verified_model_bytes(path=MODEL_PATH)
    session = _session(model_bytes=payload)
    started = time.monotonic()
    prediction = session.run([OUTPUT_NAME], {INPUT_NAME: prepare_input(rgba=rgba)})
    if not isinstance(prediction, list) or len(prediction) != 1:
        raise ValueError("unexpected person mask model response")
    width, height = int(rgba.shape[1]), int(rgba.shape[0])
    mask = restore_mask(prediction=prediction[0], size=(width, height))
    stats = _person_mask(value=mask, shape=rgba.shape[:2], name="ONNX person mask")
    return mask, {
        **stats, "provider": "onnx-pphumanseg-cpu-v1", "framework": "ONNX Runtime",
        "executionProvider": "CPUExecutionProvider", "orientation": "top-left",
        "width": width, "height": height, "sourceSize": [width, height],
        "modelSize": [192, 192], "modelSha256": MODEL_SHA256, "modelBytes": len(payload),
        "modelSource": manifest["sourceDocumentation"], "license": manifest["license"],
        "downloadedModels": True, "operatingSystemModel": False, "nativeVendorLibraries": False,
        "maskType": "semantic-person-silhouette", "backgroundReconstruction": False,
        "elapsedSeconds": round(time.monotonic() - started, 6),
    }
