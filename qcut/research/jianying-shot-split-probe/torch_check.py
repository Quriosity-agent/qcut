#!/usr/bin/env python3
"""行为验证:用纯 PyTorch 复现在一段视频上出切点,和已知切点(或剪映桥接的结果)比一下。

比 detect_cuts_torch.py 多做的只是打印每个切点附近的概率,方便看边缘案例。

用法: ./torch_check.py <视频> <backbone.bytenn> <backbone params.tsv> <predhead.bytenn> <predhead params.tsv> [fps] [期望切点帧,逗号分隔]
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from detect_cuts_torch import cut_points, frame_scores, frames_from_video  # noqa: E402
from torch_backbone import build  # noqa: E402
from torch_predhead import PredHead  # noqa: E402


def main():
    if len(sys.argv) < 6:
        raise SystemExit(__doc__)
    video, bb_file, bb_tsv, ph_file, ph_tsv = sys.argv[1:6]
    fps = float(sys.argv[6]) if len(sys.argv) > 6 else 24.0
    expected = [int(x) for x in sys.argv[7].split(",")] if len(sys.argv) > 7 else None
    frames = frames_from_video(video, fps)
    scores, diffs = frame_scores(build(bb_file, bb_tsv), PredHead(ph_file, ph_tsv).eval(), frames)
    cuts = cut_points(scores, diffs, 0.35)
    print(f"{len(frames)} 帧 @ {fps:g} fps;切点 {cuts}" + (f";期望 {expected} -> {'一致' if cuts == expected else '不一致'}" if expected else ""))
    for c in cuts:
        near = " ".join(f"{k}:{scores[k]:.3f}" for k in range(c - 2, c + 3) if k in scores)
        print(f"  切点 {c} ({c / fps:.3f}s) 附近概率  {near}")


if __name__ == "__main__":
    main()
