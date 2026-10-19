"""Hash-pinned CPU Stage1 sessions shared by detection and tracking."""
import hashlib

from independent_session_cache import cpu_session

import numpy as np

from align160_heads_contract import GATES, HEAD_CHANNELS, MODEL_SHA256
from alignment_pose_heads import compute_pose_heads, prepare_pose_heads
from alignment_probability import classification_probabilities, prepare_probability_head

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
    def __init__(self, *, size, model, expected_sha256=None, pose_heads=False, probability_heads=False):
        """Optional pose and probability heads use the effect's CPU float32 order
        on shared pooled features; ONNX Runtime's matrix product rounds differently."""
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
        if type(pose_heads) is not bool or type(probability_heads) is not bool:
            raise ValueError("typed alignment-head policies required")
        self.pose = None
        self.probability = None
        self.feature_names = []
        if pose_heads:
            data, features, parameters = prepare_pose_heads(data=data)
            self.pose = (features, parameters)
            self.feature_names.append(features)
        if probability_heads:
            data, features, parameters = prepare_probability_head(data=data)
            self.probability = (features, parameters)
            if features not in self.feature_names:
                self.feature_names.append(features)
        self.runner = cpu_session(data=data, optimize=False)
        inputs, outputs = self.runner.get_inputs(), self.runner.get_outputs()
        heads = outputs[:len(self.channels)]
        features = outputs[len(self.channels):]
        if (len(inputs) != 1 or inputs[0].name != "data" or inputs[0].shape != [1, size, size, 3]
                or inputs[0].type != "tensor(int64)" or [value.name for value in heads] != list(self.channels)
                or any(value.type != "tensor(float)" or value.shape != [1, 1, 1, self.channels[value.name]] for value in heads)
                or [value.name for value in features] != self.feature_names
                or any(value.type != "tensor(float)" or value.shape != [1, 128] for value in features)
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
        values = self.runner.run(None, {"data": tensor.astype(np.int64)})
        heads = dict(zip(self.channels, values[:len(self.channels)], strict=True))
        features = dict(zip(self.feature_names, values[len(self.channels):], strict=True))
        if self.pose:
            heads.update(compute_pose_heads(features=features[self.pose[0]], parameters=self.pose[1]))
        if self.probability:
            heads['prob'] = classification_probabilities(features=features[self.probability[0]], parameters=self.probability[1])
        for name, value in heads.items():
            if (not isinstance(value, np.ndarray) or value.dtype != np.float32
                    or value.shape != (1, 1, 1, self.channels[name]) or not np.isfinite(value).all()):
                raise ValueError("invalid Stage1 terminal: " + name)
        return heads
