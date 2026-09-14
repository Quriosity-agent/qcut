#!/usr/bin/env python3
"""行为验证:用复现的主干算连续帧特征距离,看峰值是否落在已知切点上。

主干若复现正确,镜头切换处相邻帧的特征应当明显拉开距离。用合成夹具(切点已知)可以直接判对错,
同时用来定预处理:几种候选归一化各跑一遍,看哪种把峰值对到真实切点上。

用法:
    ./torch_check.py <视频> <权重目录> <params.tsv> [fps]
"""
import pathlib
import subprocess
import sys

import torch

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arena_weights import install, slice_arena  # noqa: E402
from torch_backbone import build, forward, load_specs  # noqa: E402

FFMPEG = pathlib.Path(__file__).resolve().parents[2] / "electron/resources/ffmpeg/darwin-arm64/ffmpeg"
SIZE = 96

PREPROCESS = {
    "x/255": lambda t: t,
    "x/127.5-1": lambda t: t * 2 - 1,
    "(x/255-0.5)/0.5": lambda t: (t - 0.5) / 0.5,
    "ImageNet": lambda t: (t - torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
    / torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1),
    "raw 0..255": lambda t: t * 255,
}


def frames(video, fps):
    out = subprocess.run(
        [str(FFMPEG), "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale={SIZE}:{SIZE}",
         "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
        capture_output=True, check=True).stdout
    n = len(out) // (SIZE * SIZE * 3)
    data = torch.frombuffer(bytearray(out), dtype=torch.uint8)[: n * SIZE * SIZE * 3]
    return data.reshape(n, SIZE, SIZE, 3).permute(0, 3, 1, 2).float() / 255.0


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    video, model_file, params_tsv = sys.argv[1], sys.argv[2], sys.argv[3]
    fps = float(sys.argv[4]) if len(sys.argv) > 4 else 24.0
    specs, order = load_specs(params_tsv)
    model = build(specs)
    install(model, slice_arena(model_file, specs, order))
    loaded = sum(1 for m in model.modules() if isinstance(m, torch.nn.Conv2d))
    model.eval()
    batch = frames(video, fps)
    print(f"装入 {loaded} 层权重;{batch.shape[0]} 帧 @ {fps} fps")

    for label, fn in PREPROCESS.items():
        with torch.no_grad():
            feats = torch.cat([forward(model, fn(batch[i : i + 32])) for i in range(0, len(batch), 32)])
        feats = torch.nn.functional.normalize(feats, dim=1)
        dist = 1 - (feats[1:] * feats[:-1]).sum(dim=1)          # 相邻帧余弦距离
        top = torch.topk(dist, 6)
        peaks = sorted(int(i) for i in top.indices)
        sharpness = (top.values.mean() / dist.median()).item() if dist.median() > 0 else float("inf")
        print(f"  {label:16} 峰值帧 {peaks}  峰值/中位数 = {sharpness:.1f}")


if __name__ == "__main__":
    main()
