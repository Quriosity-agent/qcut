"""Owned fresh-photo detector; dynamic integer ONNX, no native box inputs."""
import hashlib

import numpy as np
import onnxruntime as ort

from detection_geometry import prepare_detection
from vendor.face_detector import decode, frame_rectangles

PROFILE = {"strides": [8, 16, 32], "minimum_sizes": [4, 8, 16], "confidence": .225,
           "before": 1500, "after": 200, "iou": .3}
HEAD_NAMES = tuple(f"bbox_head.{kind}_convs.{index}.conv" for kind in ("reg", "cls") for index in range(3))
MODEL_SHA256 = "4733751ec48c8dc5f8ca3fe3fbbfaa87c7f1393be5fba1d02320e4e71faa749a"


class Detector:
    def __init__(self, *, model):
        data = model.read_bytes()
        self.sha256 = hashlib.sha256(data).hexdigest()
        if self.sha256 != MODEL_SHA256:
            raise ValueError("unsupported dynamic detector model identity")
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        self.session = ort.InferenceSession(data, sess_options=options, providers=["CPUExecutionProvider"])
        inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
        if (len(inputs) != 1 or inputs[0].name != "data" or inputs[0].type != "tensor(int64)"
                or len(inputs[0].shape) != 4 or inputs[0].shape[0] != 1 or inputs[0].shape[3] != 3
                or any(type(side) is int for side in inputs[0].shape[1:3])
                or len(outputs) != len(HEAD_NAMES) or {value.name for value in outputs} != set(HEAD_NAMES)):
            raise ValueError("dynamic integer six-head detector model required")

    def detect(self, *, rgba):
        result = prepare_detection(rgba=rgba)
        outputs = self.session.run(list(HEAD_NAMES), {"data": result["tensor"].astype(np.int64)})
        if len(outputs) != len(HEAD_NAMES):
            raise ValueError("six detector outputs required")
        heads = []
        width, height = result["network_size"]
        for index, value in enumerate(outputs):
            stride = PROFILE["strides"][index % 3]
            shape = (1, height // stride, width // stride, 4 if index < 3 else 1)
            if (not isinstance(value, np.ndarray) or value.dtype != np.int64 or value.shape != shape
                    or (value < -128).any() or (value > 127).any()):
                raise ValueError("detector output left signed-byte profile")
            heads.append((value[0].astype(np.int8), 4))
        boxes = decode(heads=heads, image_size=result["network_size"], **PROFILE)
        rects = frame_rectangles(boxes=boxes, scales=result["scales"])
        result.update(heads={name: value for name, (value, _) in zip(HEAD_NAMES, heads, strict=True)},
                      rects=rects, scores=boxes[:, 4].copy(), model_sha256=self.sha256,
                      equal_score_proposals_order="stable-owned-order-native-ties-unverified")
        return result
