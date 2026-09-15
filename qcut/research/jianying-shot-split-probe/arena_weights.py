"""从 .bytenn 里按**已逐层验证**的布局切权重(主干 61 个卷积 + 2 个注意力缩放常数)。

文件头是明文(图定义区加密,权重区不加密):`+0x14`/`+0x18` 是权重区长度/偏移。主干权重区从字节 16061
开始,没有头,就是明文小端 float32 按**图顺序**逐层排列,每层「权重 + 偏置」,中间只多两个 1 元素的
常数(两个注意力块的缩放 0.125,各在自己的 proj.conv 之前)。61 层切完正好用满。

每层权重在文件里的排布(全部用引擎自己算出来的中间张量精确对拍过,误差 0):
    密集 3x3      OHWI  (cout, kh, kw, cin)
    1x1           (cout, cin)
    深度卷积 3x3  HWC   (kh, kw, cout)
"""
import numpy as np
import pathlib
import torch

BACKBONE_ARENA_START = 16061
ATTENTION_SCALE_BEFORE = (
    "backbone.backbone.features.13.attention_block.proj.conv",
    "backbone.backbone.features.14.attention_block.proj.conv",
)


def weight_count(spec):
    return spec["k"] * spec["k"] * (1 if spec["depthwise"] else spec["cin"]) * spec["cout"]


def slice_arena(model_file, specs, order):
    """返回 ({层名: (权重 ndarray, 偏置 ndarray)}, [注意力缩放常数])。"""
    total = sum(weight_count(specs[n]) + specs[n]["cout"] for n in order) + len(ATTENTION_SCALE_BEFORE)
    raw = pathlib.Path(model_file).read_bytes()
    arena = np.frombuffer(raw[BACKBONE_ARENA_START:BACKBONE_ARENA_START + total * 4], dtype="<f4").copy()
    table, scales, pos = {}, [], 0
    for name in order:
        if name in ATTENTION_SCALE_BEFORE:
            scales.append(float(arena[pos]))
            pos += 1
        spec = specs[name]
        n = weight_count(spec)
        table[name] = (arena[pos:pos + n], arena[pos + n:pos + n + spec["cout"]])
        pos += n + spec["cout"]
    if pos != len(arena):
        raise SystemExit(f"切分用掉 {pos} 个 float,权重区有 {len(arena)} 个")
    return table, scales


def to_torch_weight(w, spec):
    """把文件里的一维权重按该层的排布转成 PyTorch 的 OIHW。"""
    k, cout, cin = spec["k"], spec["cout"], spec["cin"]
    t = torch.from_numpy(w.copy())
    if spec["depthwise"]:
        return t.reshape(k, k, cout).permute(2, 0, 1).unsqueeze(1).contiguous()
    if k == 1:
        return t.reshape(cout, cin, 1, 1)
    return t.reshape(cout, k, k, cin).permute(0, 3, 1, 2).contiguous()


def install(model, table, specs):
    for module in model.modules():
        if not isinstance(module, torch.nn.Conv2d):
            continue
        name = module.qcut_name
        w, b = table[name]
        with torch.no_grad():
            module.weight.copy_(to_torch_weight(w, specs[name]))
            module.bias.copy_(torch.from_numpy(b.copy()))
    return model
