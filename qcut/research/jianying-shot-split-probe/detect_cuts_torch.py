#!/usr/bin/env python3
"""纯 PyTorch 的镜头分割:不依赖剪映运行库,只要两个 .bytenn 模型文件和 params.tsv。

流程与引擎逐层对拍过,后处理照 libcccreator 的反汇编(0xcc7844)逐字实现:
    帧(RGB)-> 双线性缩放到 96x96(整帧拉伸、无抗锯齿、align_corners=False)-> x/127.5-1
    -> 主干 128 维特征 -> 最近 7 帧 [f-6, f] 喂预测头 -> 概率 P 归到中心帧 c = f-3(引擎从 f=7 起算)
    -> 在 P 上找局部极大值(上升后下降;平台算继续上升),且 P > 阈值(默认 0.35),切点 = 中心帧 c
    -> 若极值左侧概率差 < 0.1 且 Q[c-1] > 2·Q[c-2],切点左移一帧;
       否则若右侧概率差 < 0.1 且 Q[c] < 2·Q[c+1],切点右移一帧
       其中 Q[k] = 第 k 帧与第 k+1 帧 96x96 RGB uint8 图的逐字节平均绝对差
    在 3 份素材共 15 个切点上与剪映桥接 predict_result 完全一致。

输入可以是视频(用 QCut 自带 ffmpeg 解成 320x180 RGB)或原始 RGBA 帧文件。

用法:
    ./detect_cuts_torch.py <backbone.bytenn> <backbone params.tsv> <predhead.bytenn> <predhead params.tsv> \
        (--video <文件> [--fps 24] | --raw <rgba文件> <宽> <高>) [--threshold 0.35] [--scores out.tsv]
"""
import argparse
import pathlib
import subprocess
import sys

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from torch_backbone import build as build_backbone  # noqa: E402
from torch_predhead import PredHead  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
FFMPEG = HERE.parent.parent / "electron" / "resources" / "ffmpeg" / "darwin-arm64" / "ffmpeg"
WINDOW = 7
CENTER_OFFSET = 3


def frames_from_video(path, fps, width=320, height=180):
    cmd = [str(FFMPEG), "-v", "error", "-i", str(path), "-vf", f"fps={fps},scale={width}:{height}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 3)


def frames_from_raw(path, width, height):
    raw = np.frombuffer(pathlib.Path(path).read_bytes(), dtype=np.uint8)
    return raw.reshape(-1, height, width, 4)[:, :, :, :3]


def preprocess(frames_uint8):
    """(N,H,W,3) uint8 -> (N,3,96,96) float,与引擎 blit 节点一致。"""
    x = torch.from_numpy(np.ascontiguousarray(frames_uint8)).float().permute(0, 3, 1, 2)
    x = F.interpolate(x, size=(96, 96), mode="bilinear", align_corners=False, antialias=False)
    return x / 127.5 - 1.0


FIRST_SCORED_FRAME = 7          # 引擎从喂入第 7 帧起才开始产出概率
FLAT_EPS = 0.1                  # 反汇编里 0x2c46c40 处的 double 常数


def resized_uint8(frames_uint8):
    """引擎 blit 节点的输出:96x96 RGB uint8(双线性、整帧拉伸)。"""
    x = torch.from_numpy(np.ascontiguousarray(frames_uint8)).float().permute(0, 3, 1, 2)
    return torch.round(F.interpolate(x, size=(96, 96), mode="bilinear", align_corners=False, antialias=False)).clamp(0, 255)


@torch.no_grad()
def frame_scores(backbone, head, frames_uint8, batch=64):
    """返回 (P, Q):P[c] 是中心帧 c 的切点概率,Q[k] 是第 k 帧与第 k+1 帧的平均绝对像素差。"""
    small = torch.cat([resized_uint8(frames_uint8[i:i + batch]) for i in range(0, len(frames_uint8), batch)])
    feats = torch.cat([backbone(small[i:i + batch] / 127.5 - 1.0) for i in range(0, len(small), batch)])
    scores = {}
    for f in range(FIRST_SCORED_FRAME, len(feats)):
        scores[f - CENTER_OFFSET] = head(feats[f - WINDOW + 1:f + 1]).item()
    diffs = (small[1:] - small[:-1]).abs().mean(dim=(1, 2, 3))
    return scores, diffs.tolist()


def cut_points(scores, diffs, threshold):
    """照 libcccreator 后处理逐字实现:P 上的局部极大值 + 用像素差 Q 微调一帧。"""
    centers = sorted(scores)
    P = [scores[c] for c in centers]
    Q = lambda k: diffs[k] if 0 <= k < len(diffs) else 0.0
    cuts, carry = [], 0
    for i in range(1, len(P) - 1):
        rising = int(P[i - 1] < P[i]) | carry
        carry = int(P[i] <= P[i + 1]) & rising
        if P[i] <= P[i + 1] or not rising:
            continue
        if not P[i] > threshold:
            carry = 0
            continue
        c = centers[i]
        if abs(P[i] - P[i - 1]) < FLAT_EPS and Q(c - 1) > 2 * Q(c - 2):
            c -= 1
        elif abs(P[i] - P[i + 1]) < FLAT_EPS and Q(c) < 2 * Q(c + 1):
            c += 1
        cuts.append(c)
    return cuts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("backbone"); ap.add_argument("backbone_params"); ap.add_argument("predhead"); ap.add_argument("predhead_params")
    ap.add_argument("--video"); ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--raw", nargs=3, metavar=("FILE", "W", "H"))
    ap.add_argument("--threshold", type=float, default=0.35); ap.add_argument("--scores")
    a = ap.parse_args()
    frames = frames_from_raw(a.raw[0], int(a.raw[1]), int(a.raw[2])) if a.raw else frames_from_video(a.video, a.fps)
    backbone = build_backbone(a.backbone, a.backbone_params)
    head = PredHead(a.predhead, a.predhead_params).eval()
    scores, diffs = frame_scores(backbone, head, frames)
    cuts = cut_points(scores, diffs, a.threshold)
    if a.scores:
        with open(a.scores, "w") as out:
            for frame in sorted(scores):
                out.write(f"{frame}\t{scores[frame]:.8f}\n")
    print(f"{len(frames)} 帧;切点(帧序号,与剪映 predict_result 同约定):{cuts}")
    if not a.raw:
        print("切点(秒):" + " ".join(f"{c / a.fps:.3f}" for c in cuts))


if __name__ == "__main__":
    main()
