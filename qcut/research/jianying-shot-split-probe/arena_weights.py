"""按已验证的布局从 .bytenn 里切权重:起点 16061+8,逐层「权重(OHWI)+偏置」连续排列。

布局是用引擎自己的输入/输出张量反解出来的:embedding 这一层单独对拍余弦 0.98,
且 61 层切完正好用满权重区(576896 个 float,与 GetWeightLen 一致)。
"""
import numpy as np
import pathlib
import torch

ARENA_START = 16069          # 文件头 +0x14 给的是 16061,前 8 字节是权重区自己的头


def weight_count(spec):
    return spec["k"] * spec["k"] * (1 if spec["depthwise"] else spec["cin"]) * spec["cout"]


def slice_arena(model_file, specs, order):
    """返回 {层名: (权重 ndarray, 偏置 ndarray)}。"""
    total = sum(weight_count(specs[n]) + specs[n]["cout"] for n in order)
    raw = pathlib.Path(model_file).read_bytes()
    arena = np.frombuffer(raw[ARENA_START:ARENA_START + total * 4], dtype="<f4").copy()
    table, pos = {}, 0
    for name in order:
        spec = specs[name]
        n = weight_count(spec)
        table[name] = (arena[pos:pos + n], arena[pos + n:pos + n + spec["cout"]])
        pos += n + spec["cout"]
    if pos != len(arena):
        raise SystemExit(f"切分用掉 {pos} 个 float,权重区有 {len(arena)} 个")
    return table


def install(model, table):
    """权重在文件里是 OHWI(cout,kh,kw,cin),转成 PyTorch 要的 OIHW。"""
    for module in model.modules():
        if not isinstance(module, torch.nn.Conv2d):
            continue
        w, b = table[module.qcut_name]
        cout, cin, kh, kw = module.weight.shape
        with torch.no_grad():
            module.weight.copy_(torch.from_numpy(w.copy()).reshape(cout, kh, kw, cin).permute(0, 3, 1, 2))
            module.bias.copy_(torch.from_numpy(b.copy()))
    return model
