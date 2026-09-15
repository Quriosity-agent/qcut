#!/usr/bin/env python3
"""拿引擎自己的输入张量喂 PyTorch 复现,和引擎自己的 128 维输出对拍。

真值来自 `layer-trace`(每层 forward 一返回就取走,不受内存池复用影响);`feature-dump` 的产物只有
形状唯一的几层可信。

用法: ./torch_compare.py <模型.bytenn> <params.tsv> <trace 目录>
"""
import array
import csv
import pathlib
import sys

import torch
import torch.nn.functional as F

from torch_backbone import build


def read_trace(trace_dir, name):
    rows = {r["名字"]: r for r in csv.DictReader(open(trace_dir / "features.tsv"), delimiter="\t")}
    r = rows[name]
    a = array.array("f")
    a.frombytes(next(trace_dir.glob(f'{int(r["序号"]):03d}-*.f32')).read_bytes())
    return torch.tensor(a).reshape(1, *(int(r[k]) for k in ("d1", "d2", "d3")))   # NHWC


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    model_file, params_tsv, trace = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
    model = build(model_file, params_tsv)
    inp = read_trace(trace, "data").permute(0, 3, 1, 2)
    truth = read_trace(trace, "Flatten_212").flatten()
    with torch.no_grad():
        out = model(inp)[0]
    print(f"引擎输入 {tuple(inp.shape)} 取值 [{inp.min():.3f}, {inp.max():.3f}]")
    print(f"整模型 128 维:余弦 {F.cosine_similarity(out, truth, dim=0):+.6f}  最大绝对误差 {(out - truth).abs().max():.6f}")
    print(f"  复现 前6 {out[:6].numpy().round(4)}\n  引擎 前6 {truth[:6].numpy().round(4)}")


if __name__ == "__main__":
    main()
