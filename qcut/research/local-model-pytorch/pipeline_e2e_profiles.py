"""Explicit research video adapters; no inferred class or landmark semantics."""
from dataclasses import dataclass

import numpy as np
import torch
from torch.nn import functional as F


@dataclass(frozen=True)
class Profile:
    name: str
    height: int
    width: int
    output: str
    temporal: bool = False
    window: int = 1
    network: str | None = None


PROFILES = {
    "skin": Profile("skin", 224, 128, "prob"),
    "video-object": Profile("video-object", 256, 256, "nn_3", temporal=True),
    "tflite": Profile("tflite", 256, 256, "logits"),
    "skeleton": Profile("skeleton", 192, 144, "output_0"),
    "shot": Profile("shot", 96, 96, "probability", window=7),
    "legacy-shot": Profile("legacy-shot", 128, 128, "probability", window=11),
    "denoise": Profile("denoise", 1088, 1920, "Add_38", window=3),
    "c73": Profile("c73", 224, 224, "Sigmoid_271"),
    "dance": Profile("dance", 224, 224, "Div_275"),
    "ocr-det": Profile("ocr-det", 320, 640, "Sigmoid_78"),
    "tracking-backbone": Profile("tracking-backbone", 255, 255, "concat2", network="backbone"),
    "clip2m": Profile("clip2m", 224, 224, "v_projector"),
    "clip30m": Profile("clip30m", 224, 224, "v_projector"),
    "normal": Profile("normal", 400, 224, "up3.2"),
}


def initial_state(*, profile):
    if not profile.temporal:
        return {}
    return {"prev_img": np.zeros((1, 3, profile.height, profile.width), np.float32),
            "prev_mask": np.zeros((1, 1, profile.height, profile.width), np.float32)}


def normalized_frame(*, frame, bgr=False):
    if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[-1] != 3:
        raise ValueError("expected RGB uint8 frame")
    rgb = frame[:, :, ::-1] if bgr else frame
    return np.ascontiguousarray(rgb.transpose(2, 0, 1)[None], dtype=np.float32) / 255


def prepare_inputs(*, profile, frames, index, state):
    if not 0 <= index < len(frames):
        raise ValueError("frame index outside decoded sequence")
    frame = frames[index]
    if frame.shape != (profile.height, profile.width, 3):
        raise ValueError("frame dimensions do not match profile")
    current = normalized_frame(frame=frame, bgr=profile.temporal)
    if profile.temporal:
        return {"data": current, **{name: value.copy() for name, value in state.items()}}
    if profile.name == "tflite":
        return {"image": np.ascontiguousarray(frame[None], dtype=np.float32) / 127.5 - 1}
    if profile.name in {"shot", "legacy-shot", "denoise"}:
        half = profile.window // 2
        indices = [max(0, min(len(frames) - 1, index + shift)) for shift in range(-half, half + 1)]
        window = [normalized_frame(frame=frames[i]) for i in indices]
        if profile.name == "denoise":
            return {f"data{i}": value for i, value in enumerate(window)}
        return {"frames": np.concatenate(window)}
    if profile.name == "tracking-backbone":
        return {"data": np.rint(current * 64).astype(np.int16)}
    return {"x_1" if profile.name == "skeleton" else "data": current}


def next_state(*, profile, inputs, outputs):
    if not profile.temporal:
        return {}
    mask = outputs[profile.output]
    if mask.shape != (1, 1, profile.height, profile.width) or mask.dtype != np.float32:
        raise ValueError("invalid recurrent feedback tensor")
    return {"prev_img": inputs["data"].copy(), "prev_mask": mask.copy()}


def validate_outputs(*, outputs, schema=None):
    if not isinstance(outputs, dict) or not outputs:
        raise ValueError("missing named model outputs")
    actual = {}
    for name, value in outputs.items():
        if (not isinstance(name, str) or not isinstance(value, np.ndarray) or not value.size
                or value.dtype not in (np.dtype("float32"), np.dtype("int16")) or not np.isfinite(value).all()):
            raise ValueError("expected nonempty finite float32/int16 outputs")
        actual[name] = {"shape": list(value.shape), "dtype": str(value.dtype)}
    if schema is not None and actual != schema:
        raise ValueError("output schema changed during sequence")
    return actual


def compare_outputs(*, actual, expected):
    validate_outputs(outputs=actual, schema=validate_outputs(outputs=expected))
    result = {}
    for name, value in actual.items():
        reference = expected[name]
        integer = np.issubdtype(value.dtype, np.integer)
        result[name] = {"exact": bool(np.array_equal(value, reference)),
                        "max_abs": float(np.max(np.abs(value.astype(np.float64) - reference))),
                        "passed": bool(np.array_equal(value, reference) if integer else
                                       np.allclose(value, reference, atol=1e-4, rtol=1e-4)),
                        "integer_exact_required": integer}
    return result


def visualization(*, profile, outputs, width=320, height=180):
    value = outputs[profile.output]
    if profile.name == "denoise":
        plane = torch.from_numpy(value).clamp(0, 1)
        description = "clipped RGB response; no denoising quality claim"
    elif profile.name == "tflite":
        logits = torch.from_numpy(value)
        plane = (1 - logits.softmax(dim=-1)[..., 0]).unsqueeze(1)
        description = "1-background softmax confidence; no QCut smoothing/feather"
    elif profile.name in {"skin", "video-object"}:
        tensor = torch.from_numpy(value)
        plane = tensor[:, -1:].clamp(0, 1)
        description = "last-channel raw probability clipped to [0,1]"
    else:
        tensor = torch.from_numpy(value.astype(np.float32))
        if tensor.ndim == 4 and min(tensor.shape[-2:]) > 1:
            plane = tensor.abs().mean(dim=1, keepdim=True)
        else:
            plane = tensor.abs().reshape(1, 1, 1, -1)
        maximum = plane.max()
        plane = plane / maximum if maximum > 0 else plane
        description = "absolute channel-response projection normalized per frame; no semantic labels"
        if profile.name in {"clip2m", "clip30m"}:
            description += "; CLIP embedding diagnostic only, not image quality or text-image matching"
        if profile.name == "normal":
            description += "; not calibrated surface-normal geometry"
    if plane.ndim != 4 or plane.shape[0] != 1 or plane.shape[1] not in (1, 3):
        raise ValueError("unsupported visualization output shape")
    resized = F.interpolate(plane, size=(height, width), mode="bilinear", align_corners=False)
    rgb = resized.repeat(1, 3, 1, 1) if resized.shape[1] == 1 else resized
    return (rgb[0].permute(1, 2, 0).numpy() * 255).round().clip(0, 255).astype(np.uint8), description


def preprocessing_description(*, profile):
    if profile.name == "tflite":
        return "bilinear stretch; NHWC RGB /127.5-1 per model metadata"
    if profile.name == "tracking-backbone":
        return "bilinear stretch; RGB /255 *64 rounded to INT16; research input, product normalization unverified"
    color = "BGR" if profile.temporal else "RGB"
    window = f"; centered {profile.window}-frame window with edge replication" if profile.window > 1 else ""
    return f"bilinear stretch; NCHW {color} /255{window}; product preprocessing unverified"
