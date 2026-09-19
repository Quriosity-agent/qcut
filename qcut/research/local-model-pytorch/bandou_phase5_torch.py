"""Strict loader for the separately validated ordered bandou CPU execution profile."""
import io
from pathlib import Path

import torch
from torch import nn

from bandou_phase5_numeric import upsample_twox
from ocr_rec_numeric import ordered_convolution
from vision_batch_profiles import PROFILES, RUNTIME_SHA256
from vision_batch_torch import VisionGraph, digest, parse_graph, state_digest

FORMAT = "qcut-private-bandou-ordered-pytorch-v1"
PROFILE = "bandou-ordered-v1"
EXECUTION_PROFILE = "cpu-fp32-ordered-hwc-fma-bilinear-xy-v1"
NATIVE_REPORT_SHA256 = "6e5b5a555d7d7f86ba03ae62267a8c835d6d85622c7a0ab3f81fb690540f186e"


class OrderedConvolution(nn.Conv2d):
    def forward(self, value):
        return ordered_convolution(value=value, weight=self.weight, bias=self.bias,
                                   stride=self.stride, padding=self.padding, groups=self.groups)


class BandouGraph(VisionGraph):
    def __init__(self, *, nodes, ordered_resize):
        super().__init__(nodes=nodes)
        self.ordered_resize = ordered_resize

    def upsample(self, *, value, mode):
        if self.ordered_resize:
            if mode != "bilinear":
                raise ValueError("only audited bandou bilinear x2 supported")
            return upsample_twox(value=value)
        return super().upsample(value=value, mode=mode)


def substitute(*, model, ordered_resize=False):
    clone = BandouGraph(nodes=model.nodes, ordered_resize=ordered_resize)
    clone.load_state_dict(model.state_dict(), strict=True)
    for key, layer in tuple(clone.layers.items()):
        if not isinstance(layer, nn.Conv2d):
            raise ValueError("bandou candidate supports convolution layers only")
        ordered = OrderedConvolution(layer.in_channels, layer.out_channels, layer.kernel_size,
                                     stride=layer.stride, padding=layer.padding, groups=layer.groups)
        ordered.load_state_dict(layer.state_dict(), strict=True)
        clone.layers[key] = ordered
    return clone.eval()


def load_model(*, path, expected_sha256=None):
    with Path(path).open("rb") as stream:
        payload = stream.read(64 * 1024 * 1024 + 1)
    if not 0 < len(payload) <= 64 * 1024 * 1024:
        raise ValueError("invalid bandou bundle size")
    if expected_sha256 is not None and digest(data=payload) != expected_sha256:
        raise ValueError("bandou artifact hash mismatch")
    bundle = torch.load(io.BytesIO(payload), weights_only=True, map_location="cpu")
    if (not isinstance(bundle, dict) or bundle.get("format") != FORMAT or bundle.get("profile") != PROFILE
            or bundle.get("local_only") is not True):
        raise ValueError("only the validated ordered bandou format is accepted")
    if (bundle.get("execution_profile") != EXECUTION_PROFILE or bundle.get("runtime_sha256") != RUNTIME_SHA256
            or bundle.get("verification_status") != "native-parity-passed"
            or bundle.get("native_report_sha256") != NATIVE_REPORT_SHA256):
        raise ValueError("unapproved bandou execution profile or native evidence")
    spec = PROFILES["bandou"]
    if any(bundle.get(key) != spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256")):
        raise ValueError("bandou source or state identity mismatch")
    text = bundle.get("graph_text")
    if not isinstance(text, str) or digest(data=text.encode()) != spec["graph_sha256"]:
        raise ValueError("bandou graph hash mismatch")
    if state_digest(state=bundle.get("state_dict")) != spec["state_sha256"]:
        raise ValueError("bandou state digest mismatch")
    graph = VisionGraph(nodes=parse_graph(text=text))
    if (graph.input_shapes != {"data": tuple(spec["input_shape"])}
            or graph.output_shapes != {key: tuple(value) for key, value in spec["outputs"].items()}):
        raise ValueError("bandou tensor schema mismatch")
    graph.load_state_dict(bundle["state_dict"], strict=True)
    return substitute(model=graph, ordered_resize=True)
