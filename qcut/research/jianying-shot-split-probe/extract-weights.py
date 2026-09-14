#!/usr/bin/env python3
"""从剪映镜头分割模型里提取 float32 权重。纯离线,只读模型文件,不加载任何运行库。

背景:`.bytenn` 没有加密。文件头是一张分段表,权重段从偏移 68 开始、到头部 +0x14 处记的偏移结束。
段里是若干张量的 float32 数据,张量之间隔着很短的记录头,而且**浮点数组在段内不按 4 字节对齐**
(backbone 对齐 1,predhead 对齐 3),所以从段起始直接解会是乱码——这一点当初误判成"存在变换"。

用法:
    ./extract-weights.py <模型.bytenn> [输出目录]

产出:
    <名字>-weights-f32.bin   按文件顺序拼接的 float32 数组
    <名字>-runs.json         每个连续段在权重段内的偏移与长度

产物只留本机,不入库、不外发。
"""
import json
import math
import pathlib
import struct
import sys

MIN_RUN = 32          # 少于这么多个连续浮点不算张量
PLAUSIBLE_MAX = 20.0  # 训练权重的量级上限,用来把浮点数据和记录头区分开


def weight_section(data: bytes) -> tuple[int, int]:
    """权重段 = [68, 头部 +0x14 记的偏移)。"""
    if data[:2] != b"BM":
        raise SystemExit("不是 BM 容器")
    end = struct.unpack_from("<I", data, 0x14)[0]
    if not 68 < end <= len(data):
        raise SystemExit(f"权重段结束偏移不合理: {end}")
    return 68, end


def float_runs(section: bytes, align: int) -> list[tuple[int, int]]:
    """在给定对齐下,找出连续的、数值像权重的 float32 段。"""
    count = (len(section) - align) // 4
    values = struct.unpack_from("<%df" % count, section, align)
    runs, start = [], None
    for i, x in enumerate(values):
        ok = math.isfinite(x) and (x == 0.0 or 1e-6 <= abs(x) <= PLAUSIBLE_MAX)
        if ok:
            if start is None:
                start = i
        elif start is not None:
            if i - start >= MIN_RUN:
                runs.append((align + start * 4, i - start))
            start = None
    if start is not None and count - start >= MIN_RUN:
        runs.append((align + start * 4, count - start))
    return runs


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    path = pathlib.Path(sys.argv[1])
    outdir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else path.parent
    outdir.mkdir(parents=True, exist_ok=True)
    data = path.read_bytes()
    start, end = weight_section(data)
    section = data[start:end]

    # 对齐未知,四种都试,取覆盖最多的那个
    best_align, best_runs, best_total = 0, [], 0
    for align in range(4):
        runs = float_runs(section, align)
        total = sum(c for _, c in runs)
        if total > best_total:
            best_align, best_runs, best_total = align, runs, total

    flat = []
    for offset, count in best_runs:
        flat.extend(struct.unpack_from("<%df" % count, section, offset))
    name = path.stem.split("_v")[0]
    blob = outdir / f"{name}-weights-f32.bin"
    blob.write_bytes(struct.pack("<%df" % len(flat), *flat))
    json.dump(
        {
            "model": path.name,
            "section": [start, end],
            "align": best_align,
            "floats": best_total,
            "runs": [{"offset_in_section": o, "floats": c} for o, c in best_runs],
        },
        open(outdir / f"{name}-runs.json", "w"),
        indent=1,
    )
    mean_abs = sum(abs(x) for x in flat) / len(flat)
    print(f"{path.name}")
    print(f"  权重段 {len(section)} 字节,对齐 {best_align},{len(best_runs)} 段")
    print(f"  参数 {best_total} 个,覆盖 {best_total * 4 / len(section):.1%}")
    print(f"  |w| 最大 {max(abs(x) for x in flat):.4f},平均 {mean_abs:.5f}")
    print(f"  -> {blob.name}")


if __name__ == "__main__":
    main()
