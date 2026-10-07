"""Independent whole-frame skin segmentation for the pinned portrait packages."""
import hashlib
import json
from pathlib import Path

import numpy as np

from algorithm_frame import resize_rgba, validate_frame
from facefitting_infer import native_images

MODELS = {
    (128, 128): "cef47e7fba5edc8afb0780177e1271d6e725e264cff788599a9ee2206b499457",
    (128, 144): "3630081f7bedab245d3f3b8fbd6c19108dc900735a980bca2541a7cdc1c42765",
    (128, 160): "5ae1ee6c1daff7f9646d69719db4cbc936e2c06140ef73e17ab0aac360d92471",
    (128, 176): "035c68972f7358f91554f957c623621b703b79c3e01e3d7bdf504b046639c425",
    (224, 128): "72b9ca7246061c474dcb85aa937a9294eec5441832ff97561e9877c6f337f0db",
}


def algorithm_size(*, width, height):
    if any(type(value) is not int or not 16 <= value <= 1280 for value in (width, height)):
        raise ValueError("bounded original photo dimensions required")
    scale = min(1.0, 640.0 / max(width, height))
    return int(width * scale), int(height * scale)


def segmentation_size(*, width, height):
    if any(type(value) is not int or not 1 <= value <= 640 for value in (width, height)):
        raise ValueError("bounded algorithm image dimensions required")
    short, long = min(width, height), max(width, height)
    unaligned = int(128.0 * long / short)
    aligned = min(256, int(np.float32(unaligned) * np.float32(1 / 16) + np.float32(.5)) * 16)
    return (128, aligned) if width < height else (aligned, 128)


def prepare_skin_tensor(*, rgba):
    if type(rgba) is not np.ndarray or rgba.ndim != 3:
        raise ValueError("bounded uint8 RGBA required")
    validate_frame(frame=rgba, size=(rgba.shape[1], rgba.shape[0]))
    source_size = algorithm_size(width=rgba.shape[1], height=rgba.shape[0])
    mask_size = segmentation_size(width=source_size[0], height=source_size[1])
    algorithm = resize_rgba(frame=rgba, size=source_size)
    resized = resize_rgba(frame=algorithm, size=mask_size)
    tensor = np.ascontiguousarray(resized[..., [2, 1, 0]].astype(np.int16) - 128)[None]
    return tensor, {"algorithmSize": list(source_size), "maskSize": list(mask_size),
                    "originalRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
                    "algorithmRgbaSha256": hashlib.sha256(algorithm.tobytes()).hexdigest(),
                    "signedBgrSha256": hashlib.sha256(tensor.tobytes()).hexdigest()}


def alpha_texture(*, probabilities):
    if (type(probabilities) is not np.ndarray or probabilities.dtype != np.float32
            or probabilities.ndim != 2 or not np.isfinite(probabilities).all()
            or (probabilities < 0).any() or (probabilities > 1).any()):
        raise ValueError("finite skin probabilities in [0,1] required")
    texture = np.zeros((*probabilities.shape, 4), np.uint8)
    texture[..., 3] = (probabilities * np.float32(255)).astype(np.uint8)
    return texture


def predict_skin_mask(*, rgba, runtime):
    import onnxruntime as ort
    tensor, receipt = prepare_skin_tensor(rgba=rgba)
    width, height = receipt["maskSize"]
    if (width, height) not in MODELS:
        raise ValueError("unverified skin segmentation profile")
    model = Path(runtime).resolve() / f"research/skin-mask-integer-{width}x{height}.onnx"
    contract = json.loads(model.with_suffix(".contract.json").read_text())
    data = model.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if (digest != MODELS[(width, height)] or contract["artifact_sha256"] != digest or contract["input_shape"] != list(tensor.shape)
            or contract["input_type"] != "int64" or contract["output_name"] != "prob"):
        raise ValueError("profile-matched skin model identity required")
    if ort.__version__ != "1.22.1":
        raise ValueError("locked ONNX Runtime 1.22.1 required")
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(data, sess_options=options, providers=["CPUExecutionProvider"])
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if (len(inputs) != 1 or inputs[0].name != "data" or inputs[0].type != "tensor(int64)"
            or inputs[0].shape != list(tensor.shape) or len(outputs) != 1 or outputs[0].name != "prob"
            or outputs[0].type != "tensor(float)" or session.get_providers() != ["CPUExecutionProvider"]):
        raise ValueError("skin CPU model metadata mismatch")
    probability = session.run(["prob"], {"data": tensor.astype(np.int64)})[0]
    if probability.shape != (1, height, width, 1):
        raise ValueError("skin terminal shape mismatch")
    texture = alpha_texture(probabilities=probability[0, ..., 0])
    isolation = native_images()
    if isolation["private_native_images"] or hashlib.sha256(model.read_bytes()).hexdigest() != digest:
        raise ValueError("independent skin inference isolation failed")
    return texture, receipt | {"modelSha256": digest, "onnxRuntime": ort.__version__,
                               "providers": session.get_providers(), **isolation,
                               "alphaRowOrder": "image-top-to-bottom",
                               "maskUvForTopLeftSourceUv": "u,v",
                               "maskUvForNativeBottomLeftUv": "u,1-v",
                               "quantization": "float32-probability-times-255-truncate",
                               "outputRgbaSha256": hashlib.sha256(texture.tobytes()).hexdigest()}
