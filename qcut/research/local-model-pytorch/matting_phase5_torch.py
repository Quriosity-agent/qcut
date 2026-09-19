"""Candidate ordered arithmetic for the pinned, recovered GRU CPU graph."""
import torch

from matting_phase5_numeric import four_lane_pointwise, ordered_convolution, ordered_tanh, ordered_upsample, pinned_sigmoid
from matting_torch import MattingGraph

ORDERED_PROFILE = "arm64-ordered-conv-gates-resize-v1"


class OrderedMattingGraph(MattingGraph):
    def evaluate_node(self, *, index: int, values: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        row = self.nodes[index]
        op = row[0]
        if op in {"Convolution", "DepthwiseSeparableConvolution"}:
            conv, value = self.convs[str(index)], values[row[17]]
            output = (four_lane_pointwise(value=value, conv=conv) if conv.out_channels == 2
                      else ordered_convolution(value=value, conv=conv))
            if row[10] == "1":
                output = torch.where(output > 0, output, 0.)
            return {row[18]: output}
        if op == "Sigmoid":
            return {row[3]: pinned_sigmoid(value=values[row[2]])}
        if op == "Tanh":
            return {row[3]: ordered_tanh(value=values[row[2]])}
        if op == "UpSampling":
            return {row[3]: ordered_upsample(value=values[row[2]], formulation="pinned")}
        return super().evaluate_node(index=index, values=values)
