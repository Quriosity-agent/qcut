#!/usr/bin/env python3
"""用从 .bytenn 切出的权重在 PyTorch 里复现镜头分割主干(GhostNet + 两个注意力块)。

结构是拿 `layer-trace` 抓到的 118 层引擎真值**逐层对拍**定下来的,每一层都精确一致:

    first_conv  3x3 s2 + ReLU
    GhostBottleneck x8(features.0/2/3/4/5/6/7/8):
        ghost1 = [primary 1x1 + ReLU] ‖ [cheap dw3x3 + ReLU]
        步长 2 的块(0/2/5/8)接 dw3x3 s2(无激活)
        ghost2 = [primary 1x1] ‖ [cheap dw3x3](都无激活)
        shortcut(步长 2 的块)= dw3x3 s2 + ReLU -> 1x1;其余恒等
        输出 = 主路 + 旁路(无激活)
    注意力块 x2(features.13/14),2 头 x 32 维,头按通道分块:
        q/k/v 1x1(无激活);attn = softmax(q k^T * 0.125)(常数存在权重区)
        proj 1x1 + ReLU;a = x + proj;**a = 2a**(图里紧挨着的两个 Add)
        ff  = fc1 1x1 + ReLU -> dw3x3 + ReLU -> fc2 1x1;输出 = a + ff
    final_expand 1x1 + ReLU -> embedding 3x3 -> 全局平均 -> 128 维

预处理:引擎输入是 NHWC 96x96x3,取值 `x/127.5 - 1`(实测落在 [-1,1])。

用法:
    ./torch_backbone.py <模型.bytenn> <params.tsv>
"""
import csv
import pathlib
import sys

import torch
import torch.nn.functional as F
from torch import nn

PREFIX = "backbone.backbone."
BLOCKS = (0, 2, 3, 4, 5, 6, 7, 8)
ATTENTION_BLOCKS = (13, 14)
HEADS = 2


def load_specs(params_tsv):
    """从 weight-dump 导出的 params.tsv 读每个卷积层的形状、步长、padding;返回 (specs, 图顺序层名)。"""
    specs, order = {}, []
    handle = open(params_tsv, encoding="utf-8", errors="replace")  # 非卷积层的字符串字段是垃圾值
    for row in csv.DictReader(handle, delimiter="\t"):
        kind = row["类型"]
        if "Convolution" not in kind:
            continue
        kh, kw, cin, cout = (int(row[k]) for k in ("kh", "kw", "cin", "cout"))
        if not (0 < kh <= 11 and 0 < kw <= 11 and 0 < cin <= 4096 and 0 < cout <= 4096):
            continue
        specs[row["层名"]] = {"k": kh, "cin": cin, "cout": cout,
                              "stride": int(row["f120"].split(",")[0]), "pad": int(row["f128"].split(",")[0]),
                              "depthwise": "Depthwise" in kind}
        order.append(row["层名"])
    return specs, order


class Backbone(nn.Module):
    def __init__(self, specs):
        super().__init__()
        self.specs = specs
        self.convs = nn.ModuleDict()
        for name, s in specs.items():
            conv = nn.Conv2d(s["cin"], s["cout"], s["k"], stride=s["stride"], padding=s["pad"],
                             groups=s["cin"] if s["depthwise"] else 1, bias=True)
            conv.qcut_name = name                       # 按名装权重,绝不按形状猜
            self.convs[name.replace(".", "/")] = conv
        self.scales = [0.125, 0.125]

    def conv(self, x, name, relu=False):
        y = self.convs[(PREFIX + name).replace(".", "/") if not name.startswith("backbone.") else name.replace(".", "/")](x)
        return F.relu(y) if relu else y

    def has(self, name):
        return (PREFIX + name).replace(".", "/") in self.convs

    def bottleneck(self, x, i):
        p = f"features.{i}"
        a = self.conv(x, f"{p}.conv.0.primary_conv.0", relu=True)
        h = torch.cat([a, self.conv(a, f"{p}.conv.0.cheap_operation.0", relu=True)], 1)
        if self.has(f"{p}.conv.1.0"):
            h = self.conv(h, f"{p}.conv.1.0")
        g = self.conv(h, f"{p}.conv.3.primary_conv.0")
        h = torch.cat([g, self.conv(g, f"{p}.conv.3.cheap_operation.0")], 1)
        if self.has(f"{p}.shortcut.1"):
            x = self.conv(self.conv(x, f"{p}.shortcut.0.0", relu=True), f"{p}.shortcut.1")
        return h + x

    def attention(self, x, i, scale):
        p = f"features.{i}"
        b, c, hh, ww = x.shape
        n, d = hh * ww, c // HEADS
        q = self.conv(x, f"{p}.attention_block.q.conv").reshape(b, HEADS, d, n).transpose(2, 3)
        k = self.conv(x, f"{p}.attention_block.k.conv").reshape(b, HEADS, d, n)
        v = self.conv(x, f"{p}.attention_block.v.conv").reshape(b, HEADS, d, n).transpose(2, 3)
        attn = torch.softmax((q @ k) * scale, dim=-1)
        o = (attn @ v).transpose(2, 3).reshape(b, c, hh, ww)
        a = 2 * (x + self.conv(o, f"{p}.attention_block.proj.conv", relu=True))
        y = self.conv(a, f"{p}.ff_block.fc1", relu=True)
        y = self.conv(y, f"{p}.ff_block.dw_conv", relu=True)
        return a + self.conv(y, f"{p}.ff_block.fc2")

    def forward(self, x):
        x = self.conv(x, "first_conv.conv", relu=True)
        for i in BLOCKS:
            x = self.bottleneck(x, i)
        for i, scale in zip(ATTENTION_BLOCKS, self.scales):
            x = self.attention(x, i, scale)
        x = self.conv(x, "final_expand_layer.conv", relu=True)
        x = self.conv(x, "backbone.embedding")
        return torch.flatten(F.adaptive_avg_pool2d(x, 1), 1)


def preprocess_rgb(frames_uint8_nhwc):
    """uint8 NHWC 帧 -> 引擎同款输入 NCHW float,x/127.5-1。"""
    x = torch.as_tensor(frames_uint8_nhwc).float().permute(0, 3, 1, 2)
    return x / 127.5 - 1.0


def build(model_file, params_tsv):
    from arena_weights import install, slice_arena
    specs, order = load_specs(params_tsv)
    model = Backbone(specs)
    table, scales = slice_arena(model_file, specs, order)
    install(model, table, specs)
    model.scales = scales
    return model.eval()


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    model = build(sys.argv[1], sys.argv[2])
    convs = sum(1 for m in model.modules() if isinstance(m, nn.Conv2d))
    with torch.no_grad():
        out = model(torch.zeros(1, 3, 96, 96))
    print(f"主干:{convs} 个卷积,注意力缩放 {model.scales};前向 1x3x96x96 -> {tuple(out.shape)}")


if __name__ == "__main__":
    main()
