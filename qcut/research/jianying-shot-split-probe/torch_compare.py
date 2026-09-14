#!/usr/bin/env python3
"""拿引擎自己的输入张量喂 PyTorch 复现,和引擎自己的输出对拍。

`feature-dump` 把 ByteNN 的输入张量(NHWC,预处理已经做完)和各层输出落了盘,所以这里
不用猜预处理。注意引擎复用内存池:跑完一帧后只有**形状唯一**的缓冲区还留着真值,也就是
`__input`、`114 final_expand`、`115 embedding`、`116 GlobalAveragePool`、`117 Flatten`;
中间层的缓冲区已被后面的层覆写(Softmax 那层甚至出现负数),不能当真值用。

用法: ./torch_compare.py <模型.bytenn> <params.tsv> <feat/engine-N>
"""
import array
import pathlib
import sys

import torch
import torch.nn.functional as F

from arena_weights import install, slice_arena
from torch_backbone import build, forward, load_specs


def read_f32(path):
    a = array.array("f")
    a.frombytes(pathlib.Path(path).read_bytes())
    return torch.tensor(a, dtype=torch.float32)


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    model_file, params_tsv, feat = (pathlib.Path(a) for a in sys.argv[1:4])
    specs, order = load_specs(str(params_tsv))
    model = install(build(specs), slice_arena(model_file, specs, order)).eval()

    inp = read_f32(feat / "__input.f32").reshape(1, 96, 96, 3).permute(0, 3, 1, 2)
    truth = read_f32(next(feat.glob("117-Flatten*.f32")))
    print(f"引擎输入 {tuple(inp.shape)} 取值 [{inp.min():.3f}, {inp.max():.3f}] —— 预处理就是 x/127.5-1")

    # 单层核对:embedding 的输入(114)和输出(115)都是可信缓冲区
    x114 = read_f32(next(feat.glob("114-*final_expand*.f32"))).reshape(1, 3, 3, 384).permute(0, 3, 1, 2)
    y115 = read_f32(next(feat.glob("115-*embedding*.f32"))).reshape(1, 3, 3, 128).permute(0, 3, 1, 2)
    emb = model["embedding"]
    with torch.no_grad():
        y = F.conv2d(x114, emb.weight, emb.bias, 1, 1)
    print(f"单层 embedding(占全模型 77% 参数)余弦 {F.cosine_similarity(y.flatten(), y115.flatten(), dim=0):+.6f}"
          f" 最大误差 {(y - y115).abs().max():.5f}")

    with torch.no_grad():
        out = forward(model, inp)[0]
    print(f"整模型 余弦 {F.cosine_similarity(out, truth, dim=0):+.6f} 输出最大幅度 {out.abs().max():.4g}"
          f"(引擎 {truth.abs().max():.4f})")
    print("整模型还对不上:前 60 层在权重区里的排列顺序尚未定死,见 HANDOVER 第 5 节")


if __name__ == "__main__":
    main()
