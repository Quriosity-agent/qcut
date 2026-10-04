"""Private Extra-160 fc export and hash-bound CPU inference, not Stage2 geometry.

Export: --source DIRECTORY_WITH_GRAPH_AND_ARENA --out NEW_MODEL_DIRECTORY.
Runtime imports no Torch and returns 240 raw coordinate pairs. Crop selection,
mean/order decoding, affine mapping, filtering and makeup remain caller work.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np

from face_alignment_replay import LockedFiles, strict_json, valid_hash
from face_render_model_parity import no_torch

SCHEMA = "face-extra-heads-onnx-v1"
GRAPH_SHA256 = "7938cfc3abdb0934cfe28353561963b2118f3bf3e439835d86339d4d98f05f85"
ARENA_SHA256 = "84e987cd3155af712ee6c3bef905f82fbfeaf718007509321f429626163c7b9d"
ORT_VERSION = "1.22.1"
INPUT_SHAPE = (1, 160, 160, 3)
OUTPUT_SHAPE = (240, 1, 1, 2)
SEEDS = (17, 41, 509)
INPUT = dict(name="data", dtype="int64", shape=list(INPUT_SHAPE),
             storage_type=2, fraction=6, minimum=-128, maximum=127)
OUTPUT = dict(name="fc", dtype="float32", shape=list(OUTPUT_SHAPE), order="raw-network")
VALIDATION = dict(scope="synthetic-pytorch-vs-onnx-fc-only", seeds=list(SEEDS),
                  bit_mismatches=[0, 0, 0], native_oracle_run=False,
                  geometry_parity_verified=False, product_parity_verified=False)


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def same_json(*, actual, expected):
    # JSON equality must distinguish true from 1 and integral floats from ints.
    return json.dumps(actual, sort_keys=True, allow_nan=False) == json.dumps(
        expected, sort_keys=True, allow_nan=False)


def validate_manifest(*, manifest, exporter_sha256):
    expected = dict(schema=SCHEMA, graph_sha256=GRAPH_SHA256, arena_sha256=ARENA_SHA256,
                    opset=18, input=INPUT, output=OUTPUT, validation=VALIDATION,
                    exporter_sha256=exporter_sha256)
    if (type(manifest) is not dict or set(manifest) != set(expected) | {"model_sha256", "versions"}
            or any(not same_json(actual=manifest[key], expected=value) for key, value in expected.items())
            or not valid_hash(value=manifest["model_sha256"])):
        raise ValueError("Extra manifest identity or contract mismatch")
    versions = manifest["versions"]
    if (type(versions) is not dict or set(versions) != {"torch", "onnx", "onnxruntime"}
            or any(type(value) is not str or not 1 <= len(value) <= 64 for value in versions.values())
            or versions["onnxruntime"] != ORT_VERSION):
        raise ValueError("Extra manifest runtime versions mismatch")


def cpu_session(*, model):
    import onnxruntime

    if onnxruntime.__version__ != ORT_VERSION:
        raise ValueError("pinned ORT 1.22.1 required")
    onnxruntime.disable_telemetry_events()
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    runner = onnxruntime.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])
    validate_session(runner=runner)
    return runner


def validate_session(*, runner):
    inputs, outputs = runner.get_inputs(), runner.get_outputs()
    if (runner.get_providers() != ["CPUExecutionProvider"] or len(inputs) != 1 or len(outputs) != 1
            or inputs[0].name != "data" or inputs[0].type != "tensor(int64)"
            or not same_json(actual=inputs[0].shape, expected=list(INPUT_SHAPE))
            or outputs[0].name != "fc" or outputs[0].type != "tensor(float)"
            or not same_json(actual=outputs[0].shape, expected=list(OUTPUT_SHAPE))):
        raise ValueError("Extra ONNX input/output metadata or CPU provider mismatch")


def input_values(*, values):
    if (type(values) is not np.ndarray or values.dtype not in (np.dtype("int16"), np.dtype("int64"))
            or values.shape != INPUT_SHAPE):
        raise ValueError("Extra input requires signed int16/int64 NHWC [1,160,160,3]")
    copied = np.array(values, dtype=np.int64, order="C", copy=True)
    if not np.isfinite(copied).all() or (copied < -128).any() or (copied > 127).any():
        raise ValueError("Extra input must be finite integers in [-128,127]")
    return copied


def output_values(*, outputs):
    if type(outputs) is not list or len(outputs) != 1:
        raise ValueError("one fresh Extra fc output required")
    value = outputs[0]
    if (type(value) is not np.ndarray or value.dtype != np.float32
            or value.shape != OUTPUT_SHAPE or not np.isfinite(value).all()):
        raise ValueError("finite float32 Extra fc [240,1,1,2] required")
    return value.reshape(240, 2).copy()


class ExtraHeads:
    def __init__(self, *, root: Path):
        no_torch()
        self.root = Path(root).absolute()
        self._root_identity = self.root_identity()
        self.locked = LockedFiles()
        source = Path(__file__).resolve()
        exporter_sha256 = digest(data=self.locked.read(path=source, maximum=1024**2))
        self.check_root()
        manifest = strict_json(data=self.locked.read(path=self.root / "manifest.json", maximum=64 * 1024))
        validate_manifest(manifest=manifest, exporter_sha256=exporter_sha256)
        model = self.locked.read(path=self.root / "model.onnx", maximum=32 * 1024**2,
                                 expected=manifest["model_sha256"])
        # Load the verified bytes, not a path ORT could reopen after a replacement.
        self.runner = cpu_session(model=model)
        for name in ("face_alignment_replay.py", "face_render_model_parity.py"):
            self.locked.read(path=source.with_name(name), maximum=1024**2)
        self.verify()
        identity = dict(manifest=manifest, files=dict(self.locked.files), numpy=np.__version__)
        self.version = "extra-heads-v1:" + digest(data=json.dumps(identity, sort_keys=True).encode())

    def root_identity(self):
        if self.root.is_symlink() or not self.root.is_dir():
            raise ValueError("Extra root must be an existing nonsymlink directory")
        resolved = self.root.resolve(strict=True)
        metadata = resolved.stat()
        return str(resolved), metadata.st_dev, metadata.st_ino

    def check_root(self):
        if self.root_identity() != self._root_identity:
            raise ValueError("Extra model root changed")
        for name in ("manifest.json", "model.onnx"):
            path = self.root / name
            if path.is_symlink() or path.resolve(strict=True).parent != Path(self._root_identity[0]):
                raise ValueError("Extra artifact must remain inside its locked root")

    def verify(self):
        no_torch()
        import onnxruntime

        if onnxruntime.__version__ != ORT_VERSION:
            raise ValueError("pinned ORT 1.22.1 required")
        self.check_root()
        self.locked.verify()
        validate_session(runner=self.runner)
        self.check_root()

    def infer(self, *, values: np.ndarray) -> np.ndarray:
        self.verify()
        inputs = input_values(values=values)
        result = output_values(outputs=self.runner.run(["fc"], {"data": inputs}))
        self.verify()
        return result


def build_module(*, text, arena):
    import torch
    from espresso_graph import analyze
    from espresso_integer_torch import EspressoIntegerGraph
    from face_alignment_heads_torch import FloatDense

    graph = analyze(text)
    layer = next(item for item in graph["layers"] if item["name"] == "fc")

    class ExtraFc(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = EspressoIntegerGraph(text=text, arena=arena, prefix_output="hidden.0")
            self.dense = FloatDense(layer=layer, arena=arena, channels=25)

        def forward(self, data):
            hidden = self.backbone(data)[0]
            # The native reshape is channel-major; each of 240 points has 25 features.
            features = hidden.permute(0, 3, 1, 2).reshape(240, 1, 1, 25).to(torch.float32) / 256
            return self.dense(features)

    return ExtraFc().eval()


def synthetic_input(*, seed):
    return np.random.default_rng(seed).integers(-64, 64, size=INPUT_SHAPE, dtype=np.int64)


def export_model(*, source: Path, out: Path):
    out = Path(out).absolute()
    if out.exists() or out.is_symlink():
        raise FileExistsError("use a new model directory; existing evidence is never overwritten")
    source = Path(source).resolve(strict=True)
    locked = LockedFiles()
    text = locked.read(path=source / "graph.txt", maximum=1024**2, expected=GRAPH_SHA256).decode("utf-8")
    arena = locked.read(path=source / "arena.bin", maximum=1024**2, expected=ARENA_SHA256)
    exporter_sha256 = digest(data=locked.read(path=Path(__file__).resolve(), maximum=1024**2))
    import torch
    import onnx
    import onnxruntime

    torch.set_num_threads(1)
    model = build_module(text=text, arena=arena)
    buffer = io.BytesIO()
    with torch.no_grad():
        torch.onnx.export(model, (torch.from_numpy(synthetic_input(seed=SEEDS[0])),), buffer,
                          opset_version=18, dynamo=False, input_names=["data"], output_names=["fc"])
    artifact = buffer.getvalue()
    onnx.checker.check_model(artifact, full_check=True)
    graph = onnx.load_model_from_string(artifact)
    if (any(node.domain not in ("", "ai.onnx") for node in graph.graph.node)
            or any(tensor.data_location == onnx.TensorProto.EXTERNAL for tensor in graph.graph.initializer)):
        raise ValueError("Extra export must be self-contained standard ONNX")
    runner = cpu_session(model=artifact)
    for seed in SEEDS:
        values = synthetic_input(seed=seed)
        with torch.no_grad():
            reference = model(torch.from_numpy(values)).numpy()
        actual = output_values(outputs=runner.run(["fc"], {"data": values}))
        expected = output_values(outputs=[reference])
        if not np.array_equal(actual.view(np.uint32), expected.view(np.uint32)):
            raise ValueError(f"Extra synthetic ONNX bit parity failed for seed {seed}")
    manifest = dict(schema=SCHEMA, graph_sha256=GRAPH_SHA256, arena_sha256=ARENA_SHA256, opset=18,
                    input=INPUT, output=OUTPUT, validation=VALIDATION, exporter_sha256=exporter_sha256,
                    model_sha256=digest(data=artifact), versions=dict(torch=str(torch.__version__),
                    onnx=str(onnx.__version__), onnxruntime=str(onnxruntime.__version__)))
    validate_manifest(manifest=manifest, exporter_sha256=exporter_sha256)
    encoded = json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False).encode() + b"\n"
    locked.verify()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    with (out / "model.onnx").open("xb") as stream:
        stream.write(artifact)
    # Publish the manifest last; incomplete exports are not loadable bundles.
    with (out / "manifest.json").open("xb") as stream:
        stream.write(encoded)
    locked.verify()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    manifest = export_model(source=args.source, out=args.out)
    print(json.dumps(dict(root=str(args.out.absolute()), model_sha256=manifest["model_sha256"],
                         validation=manifest["validation"]), sort_keys=True))


if __name__ == "__main__":
    main()
