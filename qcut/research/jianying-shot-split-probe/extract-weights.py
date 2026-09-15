#!/usr/bin/env python3
"""从剪映镜头分割模型里提取 float32 权重,并按层切分。纯离线,只读模型文件,不加载任何运行库。

已验证的文件布局(backbone 与 predhead 相同形状):

    [文件头 + 图定义]  [权重: 各张量按层顺序紧挨排列的 float32]  [尾部元数据]

要点,当初都踩过坑:

* 权重**没有加密、没有变换**,就是明文小端 float32。
* 浮点数组**不按 4 字节对齐**(起点由扫描确定),所以从文件头偏移直接解会是乱码。
* 张量之间**没有记录头**,一个接一个;中间看起来像分隔符的 4 字节,其实是绝对值较大的权重。
* 权重区**不止文件头里 +0x14 指的那一段**,会越过它继续排,一直到尾部元数据之前。

每层的形状来自 `weight-dump.mm` 导出的 `params.tsv`(层名、类型、卷积核、输入输出通道)。
GRU 的参数量按 3·H·I + 3·H·H + 6·H 计算。

用法:
    ./extract-weights.py <模型.bytenn> <params.tsv> [输出目录]

产出:
    <层号>-<层名>.f32    该层权重,小端 float32,形状见 layer-map.json
    layer-map.json       每层的类型、形状、参数个数、在文件中的偏移

产物只留本机,不入库、不外发。
"""
import csv
import json
import math
import pathlib
import struct
import sys

GRU_INPUT = 128        # 主干输出 128 维,时序头按同样宽度
GRU_HIDDEN = 128
MAX_PLAUSIBLE = 300.0  # 用来判断某处能否读出一串像权重的浮点


def tensor_stats(data: bytes, offset: int, count: int):
    """返回 (最大绝对值, 平均绝对值);越界或含非有限值时返回 None。"""
    if offset < 0 or offset + count * 4 > len(data):
        return None
    values = struct.unpack_from("<%df" % count, data, offset)
    if not all(math.isfinite(v) for v in values):
        return None
    magnitudes = [abs(v) for v in values]
    return max(magnitudes), sum(magnitudes) / count


def plausible(data: bytes, offset: int, count: int) -> bool:
    stats = tensor_stats(data, offset, count)
    return bool(stats and stats[0] < MAX_PLAUSIBLE and stats[1] < 3)


def layers_from_params(path: pathlib.Path) -> list[dict]:
    """按层顺序算出每层的权重个数与形状;没有权重的层直接跳过。"""
    layers = []
    for row in csv.DictReader(open(path), delimiter="\t"):
        kind = row["类型"]
        kh, kw, cin, cout = (int(row[k]) for k in ("kh", "kw", "cin", "cout"))
        if kind == "GRU":
            count = 3 * GRU_HIDDEN * GRU_INPUT + 3 * GRU_HIDDEN * GRU_HIDDEN + 6 * GRU_HIDDEN
            shape = ["GRU", GRU_INPUT, GRU_HIDDEN]
        elif not (0 < kh <= 11 and 0 < kw <= 11 and 0 < cin <= 4096 and 0 < cout <= 4096):
            continue                                  # 非卷积层的这些字段是无意义值
        elif "Depthwise" in kind:
            count, shape = cout * kh * kw, [cout, 1, kh, kw]
        elif "Convolution" in kind or kind == "InnerProduct":
            count, shape = cout * cin * kh * kw, [cout, cin, kh, kw]
        else:
            continue
        layers.append({"layer": int(row["序号"]), "name": row["层名"],
                       "type": kind, "shape": shape, "floats": count})
    return layers


def find_first_tensor(data: bytes, count: int) -> int | None:
    """首个张量的起点:第一个能连续读出 count 个像权重的浮点的位置。"""
    for offset in range(64, min(len(data), 200_000)):
        if plausible(data, offset, count):
            return offset
    return None


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    model = pathlib.Path(sys.argv[1])
    params = pathlib.Path(sys.argv[2])
    outdir = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else model.parent / "extracted"
    outdir.mkdir(parents=True, exist_ok=True)

    data = model.read_bytes()
    layers = layers_from_params(params)
    if not layers:
        raise SystemExit("参数表里没有带权重的层")
    offset = find_first_tensor(data, layers[0]["floats"])
    if offset is None:
        raise SystemExit("找不到第一个张量")

    good = 0
    for layer in layers:
        stats = tensor_stats(data, offset, layer["floats"])
        layer["file_offset"] = offset
        layer["ok"] = bool(stats and stats[0] < MAX_PLAUSIBLE and stats[1] < 3)
        if layer["ok"]:
            good += 1
            name = layer["name"].replace("/", "_")
            (outdir / f"{layer['layer']:03d}-{name}.f32").write_bytes(
                data[offset:offset + layer["floats"] * 4])
        offset += layer["floats"] * 4
    json.dump(layers, open(outdir / "layer-map.json", "w"), ensure_ascii=False, indent=1)

    total = sum(l["floats"] for l in layers)
    print(f"{model.name}")
    print(f"  {good}/{len(layers)} 层数值正常,共 {total} 个参数")
    print(f"  权重区 +0x{layers[0]['file_offset']:x} .. +0x{offset:x},尾部剩 {len(data) - offset} 字节")
    print(f"  -> {outdir}")


if __name__ == "__main__":
    main()
