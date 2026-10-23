"""Verified, file-backed body skeleton ONNX sessions for the portable photo app."""
from collections import OrderedDict
import hashlib
import json
from pathlib import Path

import numpy as np


MODEL_MANIFEST = Path(__file__).with_name("portable-models.json")
VERIFIED_ORT_VERSION = "1.22.1"
MAX_MODEL_BYTES = 4 * 1024 * 1024
MAX_SESSIONS = 4
OUTPUTS = {"coarse": ("heatmap_output_0", "vectormap_output_0"), "refine": ("output_0",)}
WEIGHTS_ORIGIN = "original private vendor graph and arena; not independently trained"


def supported_shapes():
    return {"coarse": tuple((1, height, width, 3)
                            for height in range(32, 225, 16)
                            for width in range(32, 225, 16) if max(height, width) == 224),
            "refine": ((1, 192, 144, 3),)}


def load_manifest(*, path=MODEL_MANIFEST):
    manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1
            or type(manifest.get("schemaVersion")) is not int
            or manifest.get("onnxruntime") != VERIFIED_ORT_VERSION):
        raise ValueError("unsupported portable body model manifest")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("portable body model entries required")
    found = set()
    for name, item in files.items():
        if (not isinstance(name, str) or Path(name).name != name or any(token in name for token in ("/", "\\", ":"))
                or not name.endswith(".onnx")
                or not isinstance(item, dict)):
            raise ValueError("portable body model paths must be ONNX basenames")
        network, shape = item.get("network"), item.get("inputShape")
        if (not isinstance(network, str) or network not in OUTPUTS or not isinstance(shape, list)
                or any(type(value) is not int for value in shape)
                or tuple(shape) not in supported_shapes()[network]):
            raise ValueError("unsupported portable body model shape")
        key = (network, tuple(shape))
        if key in found:
            raise ValueError("duplicate portable body model shape")
        found.add(key)
        digest, size = item.get("sha256"), item.get("bytes")
        if (not isinstance(digest, str) or len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
                or type(size) is not int or not 0 < size <= MAX_MODEL_BYTES
                or item.get("outputs") != list(OUTPUTS[network])):
            raise ValueError("invalid portable body model integrity declaration")
        output_shapes = item.get("outputShapes")
        if (not isinstance(output_shapes, dict) or set(output_shapes) != set(OUTPUTS[network])
                or any(not isinstance(value, list) or len(value) != 4
                       or any(type(side) is not int or side <= 0 for side in value)
                       for value in output_shapes.values())):
            raise ValueError("invalid portable body output shapes")
    expected = {(network, shape) for network, shapes in supported_shapes().items() for shape in shapes}
    if found != expected:
        raise ValueError("portable body model bundle must cover all 26 supported shapes")
    return manifest


def read_verified_model(*, runtime, name, specification):
    root = Path(runtime)
    if root.is_symlink():
        raise ValueError("portable body model directory cannot be a symlink")
    path = root / name
    if (path.is_symlink() or not path.is_file() or path.stat().st_size != specification["bytes"]):
        raise ValueError(f"portable body ONNX missing or invalid: {name}")
    data = path.read_bytes()
    if len(data) != specification["bytes"] or hashlib.sha256(data).hexdigest() != specification["sha256"]:
        raise ValueError(f"portable body ONNX integrity failed: {name}")
    return data


def verify_models(*, runtime):
    manifest = load_manifest()
    for name, specification in manifest["files"].items():
        read_verified_model(runtime=runtime, name=name, specification=specification)
    return {"files": len(manifest["files"]), "bytes": sum(item["bytes"] for item in manifest["files"].values()),
            "manifestSha256": hashlib.sha256(MODEL_MANIFEST.read_bytes()).hexdigest(),
            "modelWeightsOrigin": WEIGHTS_ORIGIN, "onnxruntime": VERIFIED_ORT_VERSION,
            "nativeRuntimeLoaded": False, "inferencePerformed": False}


class PortableSkeletonNetworks:
    def __init__(self, *, runtime):
        import onnxruntime as ort

        if ort.__version__ != VERIFIED_ORT_VERSION:
            raise ValueError(f"portable body ONNX requires onnxruntime {VERIFIED_ORT_VERSION}")
        self.runtime = Path(runtime)
        manifest = load_manifest()
        self.specifications = {(item["network"], tuple(item["inputShape"])): (name, item)
                               for name, item in manifest["files"].items()}
        self.sessions = OrderedDict()
        self.provenance = {"backend": "onnx-fp64-files-cpu", "onnxruntime": ort.__version__,
                           "provider": "CPUExecutionProvider", "optimization": "disabled",
                           "models": [], "availableModels": len(self.specifications),
                           "maxSessions": MAX_SESSIONS, "weights": WEIGHTS_ORIGIN,
                           "runtimeReadsVendorInstallation": False, "nativeRuntimeLoaded": False,
                           "npzLoadedForInference": False,
                           "manifestSha256": hashlib.sha256(MODEL_MANIFEST.read_bytes()).hexdigest()}

    def infer(self, *, tensor, network="coarse"):
        import onnxruntime as ort

        if (not isinstance(network, str) or network not in OUTPUTS
                or not isinstance(tensor, np.ndarray) or tensor.dtype != np.int16
                or tuple(tensor.shape) not in supported_shapes()[network]):
            raise ValueError("portable skeleton requires a supported int16 NHWC body tensor")
        key = (network, tuple(tensor.shape))
        name, specification = self.specifications[key]
        # Recheck even cached sessions: changing a delivered model never falls back to older weights.
        data = read_verified_model(runtime=self.runtime, name=name, specification=specification)
        if key not in self.sessions:
            options = ort.SessionOptions()
            options.intra_op_num_threads = options.inter_op_num_threads = 1
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            session = ort.InferenceSession(data, sess_options=options, providers=["CPUExecutionProvider"])
            inputs, outputs = session.get_inputs(), session.get_outputs()
            if (session.get_providers() != ["CPUExecutionProvider"] or len(inputs) != 1
                    or inputs[0].name != "input" or inputs[0].type != "tensor(int16)"
                    or inputs[0].shape != specification["inputShape"]
                    or [item.name for item in outputs] != list(OUTPUTS[network])
                    or any(item.type != "tensor(int16)"
                           or item.shape != specification["outputShapes"][item.name] for item in outputs)):
                raise ValueError("portable body ONNX runtime contract does not match its manifest")
            while len(self.sessions) >= MAX_SESSIONS:
                self.sessions.popitem(last=False)
            self.sessions[key] = session
        self.sessions.move_to_end(key)
        self.provenance["models"] = [{"file": self.specifications[item][0], **self.specifications[item][1]}
                                     for item in self.sessions]
        names = OUTPUTS[network]
        values = self.sessions[key].run(list(names), {"input": np.ascontiguousarray(tensor)})
        if len(values) != len(names) or any(not isinstance(value, np.ndarray) or value.dtype != np.int16
                                          or list(value.shape) != specification["outputShapes"][name]
                                          for name, value in zip(names, values)):
            raise ValueError("portable body ONNX returned invalid output tensors")
        return dict(zip(names, values))


def load_skeleton(*, runtime):
    return PortableSkeletonNetworks(runtime=runtime)
