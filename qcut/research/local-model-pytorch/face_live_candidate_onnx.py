"""Persistent, hash-bound CPU Stage1 sessions; no capture or native oracle reads."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

import numpy as np

from face_alignment_replay import HEADS, LockedFiles
from face_render_model_parity import no_torch, validate_export


def head_shapes(*, size):
    if type(size) is not int or size not in (120, 160):
        raise ValueError("typed 120/160 model size required")
    return dict(HEADS, prob=3 if size == 120 else 5)


def validate_heads(*, outputs, size):
    shapes = head_shapes(size=size)
    if type(outputs) is not dict or set(outputs) != set(HEADS):
        raise ValueError("all five fresh Stage1 heads required")
    result = {}
    for name, count in shapes.items():
        value = outputs[name]
        if (type(value) is not np.ndarray or value.dtype != np.float32 or
                value.shape != (1, 1, 1, count) or not np.isfinite(value).all()):
            raise ValueError(f"invalid Stage1 output: {name}")
        result[name] = value.copy()
    return result


class OnnxHeads:
    def __init__(self, *, root):
        no_torch()
        import onnxruntime
        from espresso_onnx_runtime import session

        if onnxruntime.__version__ != "1.22.1":
            raise ValueError("pinned Torch-free ORT 1.22.1 required")
        root = Path(root).resolve(strict=True)
        self.locked = LockedFiles()
        exported = self.locked.json(path=root / "summary.json")
        validate_export(exported=exported)
        self.sessions, self.names = {}, {}
        self.provenance = dict(onnxruntime=onnxruntime.__version__, numpy=np.__version__, models={})
        for size in (120, 160):
            relative = f"align-{size}/artifacts/model.onnx"
            path = root / relative
            expected = exported["artifacts"][relative]
            self.locked.read(path=path, maximum=128 * 1024**2, expected=expected)
            runner = session(path=path)
            inputs = runner.get_inputs()
            if (len(inputs) != 1 or inputs[0].name != "data" or
                    inputs[0].type != "tensor(int64)" or inputs[0].shape != [1, size, size, 3]):
                raise ValueError("ONNX Stage1 input metadata mismatch")
            names = exported["networks"][str(size)]["terminal_names"]
            outputs = runner.get_outputs()
            shapes = head_shapes(size=size)
            if ([item.name for item in outputs] != names or set(names) != set(HEADS) or
                    any(item.type != "tensor(float)" or item.shape != [1, 1, 1, shapes[item.name]]
                        for item in outputs)):
                raise ValueError("ONNX Stage1 output metadata mismatch")
            self.sessions[size], self.names[size] = runner, names
            self.provenance["models"][str(size)] = dict(onnx_sha256=expected,
                graph_sha256=exported["networks"][str(size)]["graph_sha256"])
        directory = Path(__file__).resolve().parent
        for module in tuple(sys.modules.values()):
            filename = getattr(module, "__file__", None)
            if filename and Path(filename).suffix == ".py" and Path(filename).resolve().parent == directory:
                self.locked.read(path=Path(filename), maximum=1024**2)
        self.verify()
        self.provenance["files"] = dict(self.locked.files)
        identity = json.dumps(self.provenance, sort_keys=True).encode()
        self.version = "dependency-core-v1:" + hashlib.sha256(identity).hexdigest()

    def verify(self):
        no_torch()
        self.locked.verify()

    def infer(self, *, size, values):
        if type(size) is not int or size not in (120, 160):
            raise ValueError("typed 120/160 model size required")
        dtype = np.int16 if size == 120 else np.int8
        if (type(values) is not np.ndarray or values.dtype != dtype or
                values.shape != (1, size, size, 3) or (values < -128).any() or (values > 127).any()):
            raise ValueError("fresh sampled signed NHWC pixels required")
        outputs = self.sessions[size].run(None, {"data": values.astype(np.int64)})
        return validate_heads(outputs=dict(zip(self.names[size], outputs, strict=True)), size=size)
