#!/usr/bin/env python3
"""镜头分割预测头的 PyTorch 复现:7 帧 128 维特征 -> 切点概率。结构与权重排布全部用 `layer-trace`
抓到的引擎逐层真值精确对拍过。

    GRU_8 -> GRU_11(都是 128->128,单向,PyTorch 式 linear_before_reset,h0=0)
    -> 7x7 帧间余弦相似度(128 维按连续 32 维分 4 组,每组一张 7x7 图)
    -> Conv 5x5 4->128 +ReLU -> [dw5x5 +ReLU -> 1x1 +ReLU] x3 -> 全局平均
    -> Linear 128->128 -> LeakyReLU(0.01) -> Linear 128->128 -> LeakyReLU(0.01) -> Linear 128->1 -> Sigmoid

权重区(文件字节 2911 起,明文 float32,共 303236 个,最后 1 个是垃圾):
    [0, 98816)        GRU_8   = A(256x256: 行 [r;z],列 [x|h]) | W_n(128x128) | R_n(128x128) | b_r b_z b_n_in b_n_h
    [98816, 197632)   GRU_11  同上
    [197632, ...)     卷积按图顺序,每层「权重 + 偏置」;classifier.0 / .2 之后各有 1 个 float 是 LeakyReLU 斜率
    卷积权重排布同主干:密集 OHWI、1x1 (cout,cin)、深度 HWC

用法: ./torch_predhead.py <预测头.bytenn> <params.tsv(engine-5)> [trace 目录]
"""
import array
import csv
import pathlib
import sys

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

HEAD_ARENA_START = 2911
HEAD_ARENA_FLOATS = 303236
GRU_BLOCK = 98816
H = 128
GROUPS = 4


def load_head_specs(params_tsv):
    convs = []
    for r in csv.DictReader(open(params_tsv, encoding="utf-8", errors="replace"), delimiter="\t"):
        kind = r.get("类型") or ""
        if "Conv" not in kind:
            continue
        k, cin, cout = int(r["kh"]), int(r["cin"]), int(r["cout"])
        convs.append({"name": r["层名"], "k": k, "cin": cin, "cout": cout, "depthwise": "Depthwise" in kind,
                      "stride": int(r["f120"].split(",")[0]), "pad": int(r["f128"].split(",")[0])})
    return convs


class GRUCell(nn.Module):
    """引擎的 GRU 约定:rz 共用 [x|h] 拼接输入,n 门 linear_before_reset。"""

    def __init__(self, blk=None):
        super().__init__()
        if blk is None:
            blk = np.zeros(GRU_BLOCK, dtype=np.float32)
        A = torch.from_numpy(blk[:4 * H * H].copy()).reshape(2 * H, 2 * H)
        self.Wr, self.Wz = nn.Parameter(A[:H, :H].clone()), nn.Parameter(A[H:, :H].clone())
        self.Rr, self.Rz = nn.Parameter(A[:H, H:].clone()), nn.Parameter(A[H:, H:].clone())
        self.Wn = nn.Parameter(torch.from_numpy(blk[4 * H * H:5 * H * H].copy()).reshape(H, H))
        self.Rn = nn.Parameter(torch.from_numpy(blk[5 * H * H:6 * H * H].copy()).reshape(H, H))
        b = torch.from_numpy(blk[6 * H * H:6 * H * H + 4 * H].copy()).reshape(4, H)
        self.br, self.bz, self.bni, self.bnh = (nn.Parameter(b[i].clone()) for i in range(4))

    def forward(self, seq):            # seq: (T, H)
        h = torch.zeros(H, dtype=seq.dtype)
        out = []
        for x in seq:
            z = torch.sigmoid(self.Wz @ x + self.Rz @ h + self.bz)
            r = torch.sigmoid(self.Wr @ x + self.Rr @ h + self.br)
            n = torch.tanh(self.Wn @ x + self.bni + r * (self.Rn @ h + self.bnh))
            h = (1 - z) * n + z * h
            out.append(h)
        return torch.stack(out)


class PredHead(nn.Module):
    def __init__(self, model_file=None, params_tsv=None, *, bundle=None):
        super().__init__()
        if bundle is not None:
            self.gru1, self.gru2 = GRUCell(), GRUCell()
            self.conv_specs = bundle["conv_specs"]
            self.alphas = list(bundle["alphas"])
            self.convs = nn.ModuleList([
                nn.Conv2d(s["cin"], s["cout"], s["k"], s["stride"], s["pad"],
                          groups=s["cin"] if s["depthwise"] else 1)
                for s in self.conv_specs
            ])
            self.load_state_dict(bundle["state_dict"], strict=True)
            return
        arena = np.frombuffer(pathlib.Path(model_file).read_bytes()[HEAD_ARENA_START:HEAD_ARENA_START + HEAD_ARENA_FLOATS * 4], dtype="<f4").copy()
        self.gru1, self.gru2 = GRUCell(arena[:GRU_BLOCK]), GRUCell(arena[GRU_BLOCK:2 * GRU_BLOCK])
        self.convs = nn.ModuleList()
        self.conv_specs = load_head_specs(params_tsv)
        self.alphas = []
        pos = 2 * GRU_BLOCK
        for s in self.conv_specs:
            n = s["k"] * s["k"] * (1 if s["depthwise"] else s["cin"]) * s["cout"]
            w = torch.from_numpy(arena[pos:pos + n].copy()); pos += n
            b = torch.from_numpy(arena[pos:pos + s["cout"]].copy()); pos += s["cout"]
            conv = nn.Conv2d(s["cin"], s["cout"], s["k"], s["stride"], s["pad"], groups=s["cin"] if s["depthwise"] else 1)
            k, co, ci = s["k"], s["cout"], s["cin"]
            with torch.no_grad():
                conv.weight.copy_(w.reshape(k, k, co).permute(2, 0, 1).unsqueeze(1) if s["depthwise"] else
                                  w.reshape(co, ci, 1, 1) if k == 1 else w.reshape(co, k, k, ci).permute(0, 3, 1, 2))
                conv.bias.copy_(b)
            self.convs.append(conv)
            if s["name"] in ("classifier.0", "classifier.2"):
                self.alphas.append(float(arena[pos])); pos += 1
        if pos != HEAD_ARENA_FLOATS - 1:
            raise SystemExit(f"切分用掉 {pos} 个 float,应为 {HEAD_ARENA_FLOATS - 1}")

    def similarity_map(self, seq):     # seq: (T, 128) -> (1, 4, T, T)
        g = seq.reshape(seq.shape[0], GROUPS, H // GROUPS)                     # 组 = 连续 32 维
        dots = torch.einsum("igd,jgd->gij", g, g)
        norms = torch.sqrt((g * g).sum(-1))                                    # (T, 4)
        return (dots / (norms.T.unsqueeze(2) * norms.T.unsqueeze(1))).unsqueeze(0)

    def forward(self, feats):          # feats: (7, 128) 7 帧主干特征,时间顺序
        seq = self.gru2(self.gru1(feats))
        x = self.similarity_map(seq)
        for conv, s in zip(self.convs, self.conv_specs):
            if s["name"].startswith("classifier"):
                break
            x = F.relu(conv(x))
        x = F.adaptive_avg_pool2d(x, 1)
        cls = [c for c, s in zip(self.convs, self.conv_specs) if s["name"].startswith("classifier")]
        x = F.leaky_relu(cls[0](x), self.alphas[0])
        x = F.leaky_relu(cls[1](x), self.alphas[1])
        return torch.sigmoid(cls[2](x)).flatten()[0]


def read_trace(trace_dir, name):
    rows = {r["名字"]: r for r in csv.DictReader(open(trace_dir / "features.tsv"), delimiter="\t")}
    r = rows[name]
    a = array.array("f")
    a.frombytes(next(trace_dir.glob(f'{int(r["序号"]):03d}-*.f32')).read_bytes())
    return torch.tensor(a).reshape(*(int(r[k]) for k in ("d0", "d1", "d2", "d3")))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    head = PredHead(sys.argv[1], sys.argv[2]).eval()
    print(f"预测头:{len(head.convs)} 个卷积/线性层,LeakyReLU 斜率 {head.alphas}")
    if len(sys.argv) > 3:
        tr = pathlib.Path(sys.argv[3])
        data = read_trace(tr, "data")                     # (1,1,128,7):[d, t]
        feats = data.reshape(H, 7).T                        # (7, 128)
        t6 = read_trace(tr, "Transpose_6").reshape(7, H)
        print(f"输入排列:data 转成 (7,128) == Transpose_6: {torch.allclose(feats, t6)}")
        with torch.no_grad():
            seq = head.gru2(head.gru1(feats))
            sim = head.similarity_map(seq)
            score = head(feats)
        sq = read_trace(tr, "Squeeze_12").reshape(7, H)
        d26 = read_trace(tr, "Div_26")                    # (7,1,4,7): [i, 0, g, j]
        print(f"GRU 堆叠输出 vs Squeeze_12: 最大误差 {(seq - sq).abs().max():.7f}")
        print(f"相似度图 vs Div_26: 最大误差 {(sim[0] - d26[:, 0].permute(1, 0, 2)).abs().max():.7f}")
        print(f"切点概率 {score.item():.6f}  引擎 Sigmoid_52 {read_trace(tr, 'Sigmoid_52').flatten().item():.6f}")


if __name__ == "__main__":
    main()
