"""Hash-pinned CPU Stage1 sessions shared by detection and tracking."""
import hashlib

import numpy as np

from align160_heads_contract import GATES, HEAD_CHANNELS, MODEL_SHA256

MODELS = {160: MODEL_SHA256, 120: "26b5c79a46478896bb91d9693dd114c2374d7b64b0e0b64245f77cf6289d5364"}


def channels(*, size):
    if type(size) is not int or size not in MODELS:
        raise ValueError("typed 120/160 Stage1 profile required")
    return {**HEAD_CHANNELS, "prob": 3 if size == 120 else 5}


def compare_heads(*, actual, expected, size):
    counts = channels(size=size)
    result = {}
    for heads in (actual, expected):
        if not isinstance(heads, dict) or set(heads) != set(counts):
            raise ValueError("all five Stage1 heads required")
        for name, count in counts.items():
            value = heads[name]
            if (not isinstance(value, np.ndarray) or value.dtype != np.float32
                    or value.shape != (1, 1, 1, count) or not np.isfinite(value).all()):
                raise ValueError("invalid Stage1 comparison head: " + name)
    for name in counts:
        observed = expected[name].astype(np.float64)
        delta = np.abs(actual[name].astype(np.float64) - observed)
        atol, rtol, relative_limit = GATES[name]
        relative = float((delta / np.maximum(np.abs(observed), 1e-30)).max())
        result[name] = {"elements": int(delta.size), "mismatches": int(np.count_nonzero(delta)),
                        "exact": bool(not np.any(delta)), "max_abs": float(delta.max()), "mae": float(delta.mean()),
                        "max_relative": relative, "atol": atol, "rtol": rtol, "relative_limit": relative_limit,
                        "passed": bool((delta <= atol + rtol * np.abs(observed)).all())
                                  and (relative_limit is None or relative <= relative_limit)}
    return result


class Stage1:
    def __init__(self, *, size, model, expected_sha256=None):
        import onnxruntime as ort
        self.channels = channels(size=size)
        self.size = size
        self.model = model
        self.expected = MODELS[size] if expected_sha256 is None else expected_sha256
        if ort.__version__ != "1.22.1":
            raise ValueError("locked ONNX Runtime 1.22.1 required")
        data = model.read_bytes()
        if hashlib.sha256(data).hexdigest() != self.expected:
            raise ValueError("unsupported Stage1 model")
        options = ort.SessionOptions()
        options.intra_op_num_threads, options.inter_op_num_threads = 1, 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        self.runner = ort.InferenceSession(data, sess_options=options, providers=["CPUExecutionProvider"])
        inputs, outputs = self.runner.get_inputs(), self.runner.get_outputs()
        if (len(inputs) != 1 or inputs[0].name != "data" or inputs[0].shape != [1, size, size, 3]
                or inputs[0].type != "tensor(int64)" or [value.name for value in outputs] != list(self.channels)
                or any(value.type != "tensor(float)" or value.shape != [1, 1, 1, self.channels[value.name]] for value in outputs)
                or self.runner.get_providers() != ["CPUExecutionProvider"]):
            raise ValueError("locked CPU model metadata required")

    def infer(self, *, tensor):
        dtype = np.int8 if self.size == 160 else np.int16
        if (not isinstance(tensor, np.ndarray) or tensor.dtype != dtype
                or tensor.shape != (1, self.size, self.size, 3)
                or (tensor < -128).any() or (tensor > 127).any()):
            raise ValueError("profile-matched signed BGR tensor required")
        if hashlib.sha256(self.model.read_bytes()).hexdigest() != self.expected:
            raise ValueError("model changed during persistent inference")
        heads = dict(zip(self.channels, self.runner.run(None, {"data": tensor.astype(np.int64)}), strict=True))
        for name, value in heads.items():
            if (not isinstance(value, np.ndarray) or value.dtype != np.float32
                    or value.shape != (1, 1, 1, self.channels[name]) or not np.isfinite(value).all()):
                raise ValueError("invalid Stage1 terminal: " + name)
        return heads
