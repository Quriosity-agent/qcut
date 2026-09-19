"""Restricted recovered matting graph executor; source assets stay private."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from matting_cpu_math import CPU_SOFTMAX, two_channel_softmax

FORMAT = "qcut-private-matting-gru-v1"
CPU_FORMAT = "qcut-private-matting-gru-cpu-v2"
CPU_RUNTIME_SHA256 = "febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863"
NODES_SHA256 = "2f990fecc0a2e4fb1f19763a2e4b9d5b35c615862c912363e8bc38771904ba40"
OUTPUTS = ("nn_3", "Add_196", "Add_213", "Add_230")
SOURCE_SHA256 = "101688825490be3704babc7ce49f6d002cdb4fe69e879556b4687ac9006f8596"
LOADED_SHA256 = "b0216fbfc8f2b810bdd9d7f384fc9b13f897104409c82eade8e83402189ef2f5"
INPUT_SHAPES = {"data": (1, 3, 256, 256), "data1": (1, 80, 16, 16),
                "data2": (1, 56, 32, 32), "data3": (1, 32, 64, 64)}
OUTPUT_SHAPES = {"nn_3": (1, 2, 256, 256), "Add_196": INPUT_SHAPES["data1"],
                 "Add_213": INPUT_SHAPES["data2"], "Add_230": INPUT_SHAPES["data3"]}
SOURCE_PATH = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingMatting/current/Models/mattingmodel/tt_matting_video_gru_v1.0.model"


def linear_upsample(*, value: torch.Tensor) -> torch.Tensor:
    n, _, h, w = value.shape
    yy = (torch.arange(h * 2, device=value.device, dtype=value.dtype) + 0.5) / (h * 2) * 2 - 1
    xx = (torch.arange(w * 2, device=value.device, dtype=value.dtype) + 0.5) / (w * 2) * 2 - 1
    y, x = torch.meshgrid(yy, xx, indexing="ij")
    grid = torch.stack([x, y], dim=-1).unsqueeze(0).expand(n, -1, -1, -1)
    return F.grid_sample(value, grid, mode="bilinear", padding_mode="zeros", align_corners=False)


def parse_graph(*, text: str) -> list[list[str]]:
    lines = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if len(lines) < 3 or lines[0] != ["D"] or len(lines[1]) != 3:
        raise ValueError("unsupported graph header")
    count_inputs, count_nodes = map(int, lines[1][:2])
    if not 1 <= count_inputs <= 64 or not 0 <= count_nodes <= 4096:
        raise ValueError("invalid bounded graph counts")
    nodes = lines[2:]
    if any(len(row) < 2 for row in nodes):
        raise ValueError("incomplete graph row")
    if len(nodes) != count_nodes + count_inputs or sum(n[0] == "DataV2" for n in nodes) != count_inputs:
        raise ValueError("graph node/input count mismatch")
    return nodes


def read_weights(*, path: Path) -> np.ndarray:
    raw = path.read_bytes()
    if len(raw) < 36 or raw[:4] != b"BM\0\2":
        raise ValueError("unsupported BM header")
    _, size, sections, graph_size, graph_start, length, start, _, _ = struct.unpack_from("<9I", raw)
    if size != len(raw) or sections != 3 or graph_start < 36 or graph_start + graph_size > start:
        raise ValueError("invalid BM section table")
    if length < 4 or length % 2 or start + length > len(raw):
        raise ValueError("invalid FP16 weights range")
    # This version's arena ends with four opaque non-parameter bytes.
    weights = np.frombuffer(raw, dtype="<f2", count=(length - 4) // 2, offset=start).astype(np.float32)
    if not np.isfinite(weights).all():
        raise ValueError("nonfinite model weights")
    return weights


class MattingGraph(nn.Module):
    def __init__(self, *, nodes: list[list[str]], weights: np.ndarray | None = None, softmax_profile: str = "torch"):
        super().__init__()
        if softmax_profile not in {"torch", CPU_SOFTMAX}:
            raise ValueError("unsupported softmax profile")
        self.softmax_profile = softmax_profile
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 4096 or any(not isinstance(row, list) or len(row) < 2 or any(not isinstance(token, str) for token in row) for row in nodes):
            raise ValueError("invalid bounded graph rows")
        if weights is not None and (weights.dtype != np.float32 or weights.ndim != 1 or not np.isfinite(weights).all()):
            raise ValueError("weights must be finite one-dimensional float32")
        self.nodes = nodes
        self.convs = nn.ModuleDict()
        self.input_shapes: dict[str, tuple[int, ...]] = {}
        channels: dict[str, int] = {}
        cursor = 0
        for index, row in enumerate(nodes):
            op, name = row[:2]
            if op == "DataV2":
                if len(row) != 9 or row[6:] != ["4", "0", "0"]:
                    raise ValueError("unsupported DataV2")
                n, h, w, c = map(int, row[2:6])
                if min(n, h, w, c) < 1 or max(n, h, w, c) > 1024:
                    raise ValueError("invalid input shape")
                self.input_shapes[name] = (n, c, h, w)
                channels[name] = c
            elif op in {"Convolution", "DepthwiseSeparableConvolution"}:
                if len(row) != 19 or row[11:17] != ["4", "0"] * 3:
                    raise ValueError("unsupported convolution layout")
                cout, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
                if bias != 1 or relu not in {0, 1} or min(cout, kh, kw, sh, sw) < 1:
                    raise ValueError("unsupported convolution parameters")
                source, target = row[17:19]
                if max(cout, kh, kw, sh, sw) > 1024 or min(ph, pw) < 0 or max(ph, pw) > 1024:
                    raise ValueError("convolution parameters exceed bounds")
                cin = channels[source]
                depthwise = op == "DepthwiseSeparableConvolution"
                if depthwise and cin != cout:
                    raise ValueError("unsupported depthwise multiplier")
                conv = nn.Conv2d(cin, cout, (kh, kw), (sh, sw), (ph, pw), groups=cin if depthwise else 1)
                size = cout * kh * kw * (1 if depthwise else cin)
                if weights is not None:
                    end = cursor + size + cout
                    if end > len(weights):
                        raise ValueError("truncated convolution weights")
                    w = torch.from_numpy(weights[cursor:cursor + size].copy())
                    if depthwise:
                        w = w.reshape(kh, kw, cout).permute(2, 0, 1).unsqueeze(1)
                    else:
                        w = w.reshape(cout, kh, kw, cin).permute(0, 3, 1, 2)
                    with torch.no_grad():
                        conv.weight.copy_(w)
                        conv.bias.copy_(torch.from_numpy(weights[cursor + size:end].copy()))
                cursor += size + cout
                self.convs[str(index)] = conv
                channels[target] = cout
            elif op == "Concat":
                count = int(row[2])
                if len(row) != count + 6 or row[-2:] != ["4", "0"]:
                    raise ValueError("unsupported concat")
                channels[row[-3]] = sum(channels[x] for x in row[3:3 + count])
            elif op == "Eltwise":
                if len(row) != 8 or row[5:7] != ["4", "0"] or row[7] not in {"0", "1"}:
                    raise ValueError("unsupported eltwise")
                if channels[row[2]] != channels[row[3]]:
                    raise ValueError("eltwise channel mismatch")
                channels[row[4]] = channels[row[2]]
            elif op == "Slice":
                if len(row) != 11 or row[3:5] != ["1", "1"] or row[6] != "2" or row[8] != "0" or row[10] != "0":
                    raise ValueError("unsupported slice")
                size = int(row[5])
                if channels[row[2]] != size * 2:
                    raise ValueError("unsupported unequal split")
                channels[row[7]] = channels[row[9]] = size
            elif op == "OnnxOp2":
                if len(row) != 8 or row[2] not in {"Mul", "Sub"} or row[-2:] != ["4", "0"]:
                    raise ValueError("unsupported binary operation")
                if channels[row[3]] != channels[row[4]]:
                    raise ValueError("binary channel mismatch")
                channels[row[5]] = channels[row[3]]
            elif op in {"Sigmoid", "Tanh", "Softmax", "UpSampling"}:
                expected = {"Sigmoid": 6, "Tanh": 6, "Softmax": 4, "UpSampling": 5}[op]
                if len(row) != expected:
                    raise ValueError("unsupported unary layout")
                if op in {"Sigmoid", "Tanh"} and row[4:] != ["4", "0"]:
                    raise ValueError("unsupported activation type")
                if op == "UpSampling" and row[4] != "LINEAR":
                    raise ValueError("unsupported upsampling type")
                channels[row[3]] = channels[row[2]]
            else:
                raise ValueError(f"unsupported operation: {op}")
        self.parameter_count = cursor
        self.output_shapes = dict(OUTPUT_SHAPES)
        if weights is not None and len(weights) != cursor:
            raise ValueError(f"unconsumed weights: used {cursor}, total {len(weights)}")

    def forward(self, inputs: dict[str, torch.Tensor], *, trace: bool = False) -> dict[str, torch.Tensor]:
        if set(inputs) != set(self.input_shapes):
            raise ValueError("all four explicit inputs required")
        for name, shape in self.input_shapes.items():
            if not isinstance(inputs[name], torch.Tensor) or tuple(inputs[name].shape) != shape or inputs[name].dtype != torch.float32 or inputs[name].device.type != "cpu" or not torch.isfinite(inputs[name]).all():
                raise ValueError(f"invalid input: {name}")
        values = dict(inputs)
        for index in range(len(self.nodes)):
            values.update(self.evaluate_node(index=index, values=values))
        if trace:
            return values
        outputs = {name: values[name] for name in OUTPUTS}
        if any(tuple(value.shape) != OUTPUT_SHAPES[name] or value.dtype != torch.float32 or not torch.isfinite(value).all() for name, value in outputs.items()):
            raise ValueError("invalid matting output schema or nonfinite output")
        return outputs

    def evaluate_node(self, *, index: int, values: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        """Use the forward operators unchanged for teacher-forced diagnostics."""
        row = self.nodes[index]
        op = row[0]
        if op == "DataV2":
            return {}
        if op in {"Convolution", "DepthwiseSeparableConvolution"}:
            value = self.convs[str(index)](values[row[17]])
            return {row[18]: F.relu(value) if row[10] == "1" else value}
        if op == "Concat":
            return {row[-3]: torch.cat([values[x] for x in row[3:3 + int(row[2])]], dim=1)}
        if op == "Eltwise":
            value = values[row[2]] + values[row[3]]
            return {row[4]: F.relu(value) if row[7] == "1" else value}
        if op == "Slice":
            left, right = torch.split(values[row[2]], int(row[5]), dim=1)
            return {row[7]: left, row[9]: right}
        if op == "OnnxOp2":
            a, b = values[row[3]], values[row[4]]
            return {row[5]: a * b if row[2] == "Mul" else a - b}
        if op == "UpSampling":
            return {row[3]: linear_upsample(value=values[row[2]])}
        if op == "Sigmoid":
            return {row[3]: values[row[2]].sigmoid()}
        if op == "Tanh":
            return {row[3]: values[row[2]].tanh()}
        if op == "Softmax":
            return {row[3]: (two_channel_softmax(value=values[row[2]]) if self.softmax_profile == CPU_SOFTMAX
                            else values[row[2]].softmax(dim=1))}
        raise ValueError(f"unsupported operation: {op}")


def read_case(*, directory: Path) -> tuple[dict[str, torch.Tensor], dict[str, torch.Tensor]]:
    inputs, expected = {}, {}
    for line in (directory / "tensors.tsv").read_text().splitlines():
        fields = line.split("\t")
        if len(fields) != 6:
            raise ValueError("invalid native tensor descriptor")
        kind, name, *dims = fields
        if kind not in {"input", "output"} or name not in (INPUT_SHAPES if kind == "input" else OUTPUTS):
            raise ValueError("unexpected native tensor name")
        h, w, c, n = map(int, dims)
        if min(h, w, c, n) < 1 or max(h, w, c, n) > 1024 or h * w * c * n > 1 << 22:
            raise ValueError("native tensor shape exceeds bounds")
        prefix = "in" if kind == "input" else "out"
        raw = np.fromfile(directory / f"{prefix}-{name}.f32", dtype="<f4")
        value = torch.from_numpy(raw.reshape(n, h, w, c).transpose(0, 3, 1, 2).copy())
        if kind not in {"input", "output"} or not torch.isfinite(value).all():
            raise ValueError("invalid native case tensor")
        destination = inputs if kind == "input" else expected
        if name in destination:
            raise ValueError("duplicate native tensor")
        destination[name] = value
    if set(expected) != set(OUTPUTS):
        raise ValueError("all four native outputs required")
    if set(inputs) != set(INPUT_SHAPES) or any(tuple(inputs[k].shape) != v for k, v in INPUT_SHAPES.items()):
        raise ValueError("native inputs do not match model signature")
    output_shapes = {"nn_3": (1, 2, 256, 256), "Add_196": INPUT_SHAPES["data1"],
                     "Add_213": INPUT_SHAPES["data2"], "Add_230": INPUT_SHAPES["data3"]}
    if any(tuple(expected[k].shape) != v for k, v in output_shapes.items()):
        raise ValueError("native outputs do not match model signature")
    return inputs, expected


def compare_case(*, model: MattingGraph, directory: Path) -> dict[str, object]:
    inputs, expected = read_case(directory=directory)
    with torch.inference_mode():
        actual = model(inputs)
    result = {}
    for name, ref in expected.items():
        value = actual[name]
        error = (value - ref).abs()
        result[name] = {"max_abs": float(error.max()), "mean_abs": float(error.mean()),
                        "passed": bool(torch.isfinite(value).all() and torch.allclose(value, ref, atol=1e-4, rtol=1e-4))}
    return result


def validate_state(*, model: nn.Module, state: object) -> None:
    expected = model.state_dict()
    if not isinstance(state, dict) or set(state) != set(expected):
        raise ValueError("incomplete or unexpected state dictionary")
    for name, reference in expected.items():
        value = state[name]
        if not isinstance(value, torch.Tensor) or value.dtype != reference.dtype or value.shape != reference.shape or not torch.isfinite(value).all():
            raise ValueError(f"invalid state tensor: {name}")


def load_model(path: Path | str, *, expected_sha256: str | None = None,
               allow_unverified: bool = False) -> MattingGraph:
    if type(allow_unverified) is not bool:
        raise ValueError("allow_unverified must be an explicit boolean")
    if expected_sha256 is not None and hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("matting artifact hash mismatch")
    bundle = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(bundle, dict) or not isinstance(bundle.get("source_asset"), dict) or not isinstance(bundle.get("loaded_buffer"), dict):
        raise ValueError("invalid matting bundle schema")
    if bundle.get("format") not in {FORMAT, CPU_FORMAT} or bundle.get("source_asset", {}).get("sha256") != SOURCE_SHA256 or bundle.get("loaded_buffer", {}).get("sha256") != LOADED_SHA256 or bundle.get("resize_profile") != "half-pixel-zero-border":
        raise ValueError("unsupported matting bundle provenance")
    if bundle["format"] == CPU_FORMAT and not allow_unverified:
        raise ValueError("unverified CPU matting candidate: research loading requires allow_unverified=True")
    profile = CPU_SOFTMAX if bundle["format"] == CPU_FORMAT else "torch"
    if bundle.get("softmax_profile", "torch") != profile:
        raise ValueError("matting softmax profile mismatch")
    nodes = bundle.get("nodes")
    if not isinstance(nodes, list) or len(nodes) != 198 or hashlib.sha256(json.dumps(nodes, separators=(",", ":")).encode()).hexdigest() != NODES_SHA256:
        raise ValueError("unsupported matting graph semantics")
    if bundle["format"] == CPU_FORMAT and (bundle.get("runtime_sha256") != CPU_RUNTIME_SHA256 or
            bundle.get("input_schema") != INPUT_SHAPES or bundle.get("output_schema") != OUTPUT_SHAPES or
            bundle.get("fp16_decoder_profile") != "arm64-four-lane-xor-subnormal-standard-tail"):
        raise ValueError("CPU matting runtime or tensor schema mismatch")
    model = MattingGraph(nodes=bundle["nodes"], softmax_profile=profile).eval()
    validate_state(model=model, state=bundle.get("state_dict"))
    model.load_state_dict(bundle["state_dict"], strict=True)
    if model.input_shapes != INPUT_SHAPES or model.parameter_count != 1787410 or len(model.nodes) != 198:
        raise ValueError("unsupported matting graph signature")
    if not all(torch.isfinite(t).all() for t in model.state_dict().values()):
        raise ValueError("nonfinite matting parameters")
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--source-model", type=Path, default=SOURCE_PATH)
    args = parser.parse_args()
    private_root = Path(".local/jianying-model-pytorch").resolve()
    if not args.out.resolve().is_relative_to(private_root):
        raise ValueError("output must be inside the private ignored root")
    source_asset = {"path": str(args.source_model.resolve()), "sha256": hashlib.sha256(args.source_model.read_bytes()).hexdigest()}
    if source_asset["sha256"] != SOURCE_SHA256:
        raise ValueError("unknown outer model version")
    torch.set_num_threads(4)
    containers = list(args.evidence.glob("engine-*/loaded-buffer.bin"))
    if len(containers) != 1:
        raise ValueError("exactly one recovered model required")
    source = containers[0]
    graph = source.with_name("graph-32.txt")
    model = MattingGraph(nodes=parse_graph(text=graph.read_text()), weights=read_weights(path=source)).eval()
    args.out.mkdir(parents=True, exist_ok=True)
    loaded_buffer = {"path": str(source.resolve()), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}
    if loaded_buffer["sha256"] != LOADED_SHA256:
        raise ValueError("unknown loaded BM version")
    bundle = {"format": FORMAT, "nodes": model.nodes, "state_dict": model.state_dict(),
              "source_asset": source_asset, "loaded_buffer": loaded_buffer, "local_only": True,
              "validation_status": "candidate-native-unverified", "resize_profile": "half-pixel-zero-border"}
    artifact = args.out / "candidate.pt"
    torch.save(bundle, artifact)
    clone = load_model(artifact)
    state_equal = all(torch.equal(t, clone.state_dict()[k]) for k, t in model.state_dict().items())
    case_dirs = sorted(args.evidence.glob("case-*"))
    if not case_dirs:
        raise ValueError("native cases must be nonempty")
    forward_equal = True
    with torch.inference_mode():
        for directory in case_dirs:
            inputs, _ = read_case(directory=directory)
            before, after = model(inputs), clone(inputs)
            forward_equal = forward_equal and all(torch.equal(before[k], after[k]) for k in OUTPUTS)
    cases = {p.name: compare_case(model=clone, directory=p) for p in case_dirs}
    report = {"format": FORMAT, "parameters": model.parameter_count, "nodes": len(model.nodes),
              "source_asset": source_asset, "loaded_buffer": loaded_buffer,
              "source_asset_sha256": source_asset["sha256"],
              "artifact": str(artifact.resolve()), "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
              "roundtrip": {"state_equal": state_equal, "forward_equal": forward_equal},
              "input_shapes": model.input_shapes, "native_case_count": len(cases), "cases": cases,
              "tolerances": {"atol": 1e-4, "rtol": 1e-4},
              "status": "native-parity-passed" if state_equal and forward_equal and all(v["passed"] for c in cases.values() for v in c.values()) else "native-parity-failed"}
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if report["status"] != "native-parity-passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
