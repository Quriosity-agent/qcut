#!/usr/bin/env python3
"""用提取出来的权重在 PyTorch 里复现镜头分割主干(GhostNet + 两个注意力块)。

结构来自 `weight-dump.mm` 导出的 params.tsv(层名、类型、卷积核、步长、padding、通道),
权重来自 `extract-weights.py` 切出来的逐层 .f32。层名是 PyTorch 模块路径,GhostNet 的
bottleneck 拓扑按命名还原:primary_conv + cheap_operation + Concat 组成 GhostModule,
两个 GhostModule 之间可选一个步长卷积,再加 shortcut 后相加。

权重由 `arena_weights.slice_arena` 直接从 `.bytenn` 里切(布局见那个文件的说明),
**不要按形状猜着装**:同形状的卷积有几十个,按形状匹配会静默串层。

已经验证的:预处理是 NHWC 的 `x/127.5-1`(引擎输入张量实测落在 [-1,1]);注意力缩放是
`dim**-0.5`(图里的 Constant 实测为 0.125 = 64**-0.5);embedding 这一层单独对拍余弦 0.98。
还没定死的:权重区前 60 层的排列顺序,所以整模型前向暂时对不上(见交接文档第 5 节)。

用法:
    ./torch_backbone.py <模型.bytenn> <params.tsv>
"""
import csv
import pathlib
import sys

import torch
from torch import nn


def conv(cin, cout, k, stride, pad, groups=1):
    return nn.Conv2d(cin, cout, k, stride=stride, padding=pad, groups=groups, bias=True)


class GhostModule(nn.Module):
    """primary 1x1 卷积,再对其输出做 3x3 深度卷积,两者拼接。"""

    def __init__(self, spec_primary, spec_cheap, relu):
        super().__init__()
        self.primary = conv(spec_primary["cin"], spec_primary["cout"], spec_primary["k"],
                            spec_primary["stride"], spec_primary["pad"])
        self.cheap = conv(spec_cheap["cin"], spec_cheap["cout"], spec_cheap["k"],
                          spec_cheap["stride"], spec_cheap["pad"], groups=spec_cheap["cin"])
        self.relu = relu

    def forward(self, x):
        primary = self.primary(x)
        if self.relu:
            primary = torch.relu(primary)
        cheap = self.cheap(primary)
        if self.relu:
            cheap = torch.relu(cheap)
        return torch.cat([primary, cheap], dim=1)


class GhostBottleneck(nn.Module):
    def __init__(self, ghost1, dw, ghost2, shortcut):
        super().__init__()
        self.ghost1 = ghost1
        self.dw = dw          # 步长为 2 时才有
        self.ghost2 = ghost2
        self.shortcut = shortcut   # None 表示恒等

    def forward(self, x):
        out = self.ghost1(x)
        if self.dw is not None:
            out = self.dw(out)
        out = self.ghost2(out)
        residual = x if self.shortcut is None else self.shortcut(x)
        return out + residual


class AttentionBlock(nn.Module):
    """q/k/v 都是 1x1 卷积,在空间位置上做自注意力,再 proj 回去;随后是 ff_block。"""

    def __init__(self, q, k, v, proj, fc1, dw, fc2, dim):
        super().__init__()
        self.q, self.k, self.v, self.proj = q, k, v, proj
        self.fc1, self.dw, self.fc2 = fc1, dw, fc2
        self.scale = dim ** -0.5

    def forward(self, x):
        b, c, h, w = x.shape
        q = self.q(x).reshape(b, c, h * w).transpose(1, 2)   # B,N,C
        k = self.k(x).reshape(b, c, h * w)                   # B,C,N
        v = self.v(x).reshape(b, c, h * w).transpose(1, 2)   # B,N,C
        attn = torch.softmax((q @ k) * self.scale, dim=-1)
        out = (attn @ v).transpose(1, 2).reshape(b, c, h, w)
        x = x + self.proj(out)
        y = self.fc1(x)
        y = torch.nn.functional.gelu(y)
        y = self.dw(y)
        y = self.fc2(y)
        return x + y


def load_specs(params_tsv):
    specs = {}
    order = []
    handle = open(params_tsv, encoding="utf-8", errors="replace")  # 非卷积层的字符串字段是垃圾值
    for row in csv.DictReader(handle, delimiter="\t"):
        kind = row["类型"]
        kh, kw, cin, cout = (int(row[k]) for k in ("kh", "kw", "cin", "cout"))
        if not (0 < kh <= 11 and 0 < kw <= 11 and 0 < cin <= 4096 and 0 < cout <= 4096):
            continue
        if "Convolution" not in kind:
            continue
        stride = int(row["f120"].split(",")[0])
        pad = int(row["f128"].split(",")[0])
        specs[row["层名"]] = {"layer": int(row["序号"]), "type": kind, "k": kh,
                              "cin": cin, "cout": cout, "stride": stride, "pad": pad,
                              "depthwise": "Depthwise" in kind}
        order.append(row["层名"])
    return specs, order


def build(specs):
    def spec(name):
        return specs[f"backbone.backbone.{name}"]

    def make(name):
        s = spec(name)
        groups = s["cin"] if s["depthwise"] else 1
        module = conv(s["cin"], s["cout"], s["k"], s["stride"], s["pad"], groups)
        module.qcut_name = f"backbone.backbone.{name}"   # 按名装权重,不能按形状猜
        return module

    blocks = {}
    for idx in (0, 2, 3, 4, 5, 6, 7, 8):
        prefix = f"features.{idx}"
        ghost1 = GhostModule(spec(f"{prefix}.conv.0.primary_conv.0"),
                             spec(f"{prefix}.conv.0.cheap_operation.0"), relu=True)
        ghost1.primary, ghost1.cheap = make(f"{prefix}.conv.0.primary_conv.0"), make(f"{prefix}.conv.0.cheap_operation.0")
        ghost2 = GhostModule(spec(f"{prefix}.conv.3.primary_conv.0"),
                             spec(f"{prefix}.conv.3.cheap_operation.0"), relu=False)
        ghost2.primary, ghost2.cheap = make(f"{prefix}.conv.3.primary_conv.0"), make(f"{prefix}.conv.3.cheap_operation.0")
        dw = make(f"{prefix}.conv.1.0") if f"backbone.backbone.{prefix}.conv.1.0" in specs else None
        if f"backbone.backbone.{prefix}.shortcut.1" in specs:
            shortcut = nn.Sequential(make(f"{prefix}.shortcut.0.0"), make(f"{prefix}.shortcut.1"))
        else:
            shortcut = None
        blocks[idx] = GhostBottleneck(ghost1, dw, ghost2, shortcut)

    attns = {}
    for idx in (13, 14):
        p = f"features.{idx}"
        attns[idx] = AttentionBlock(make(f"{p}.attention_block.q.conv"), make(f"{p}.attention_block.k.conv"),
                                    make(f"{p}.attention_block.v.conv"), make(f"{p}.attention_block.proj.conv"),
                                    make(f"{p}.ff_block.fc1"), make(f"{p}.ff_block.dw_conv"),
                                    make(f"{p}.ff_block.fc2"), dim=spec(f"{p}.attention_block.q.conv")["cout"])

    model = nn.ModuleDict({
        "first_conv": make("first_conv.conv"),
        **{f"b{k}": v for k, v in blocks.items()},
        **{f"a{k}": v for k, v in attns.items()},
        "final_expand": make("final_expand_layer.conv"),
    })
    emb = specs["backbone.embedding"]
    model["embedding"] = conv(emb["cin"], emb["cout"], emb["k"], emb["stride"], emb["pad"])
    model["embedding"].qcut_name = "backbone.embedding"
    return model


def forward(model, x):
    x = torch.relu(model["first_conv"](x))
    for idx in (0, 2, 3, 4, 5, 6, 7, 8):
        x = model[f"b{idx}"](x)
    for idx in (13, 14):
        x = model[f"a{idx}"](x)
    x = torch.relu(model["final_expand"](x))
    x = model["embedding"](x)
    return torch.flatten(torch.nn.functional.adaptive_avg_pool2d(x, 1), 1)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    model_file, params_tsv = sys.argv[1], sys.argv[2]
    specs, order = load_specs(params_tsv)
    model = build(specs)
    convs = sum(1 for m in model.modules() if isinstance(m, nn.Conv2d))
    params = sum(m.weight.numel() for m in model.modules() if isinstance(m, nn.Conv2d))
    print(f"搭好模型:{convs} 个卷积,权重 {params} 个")
    from arena_weights import install, slice_arena
    install(model, slice_arena(model_file, specs, order))
    print(f"按层名装入 {convs} 层权重")
    with torch.no_grad():
        out = forward(model, torch.zeros(1, 3, 96, 96))
    print(f"前向通过:输入 1x3x96x96 -> 输出 {tuple(out.shape)}")


if __name__ == "__main__":
    main()
