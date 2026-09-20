# 匀肤 GAN（`jypc_yunfuhua_gpucpu` v1.0）CPU 网络对拍

日期：2026-09-19。分支：`codex/local-neural-model-remaining-20260919`。
盘点表编号 N14（匀肤、丰盈共用的 `skin-gan` 包），本轮之前研究目录里没有任何相关工作。

## 结论

- 网络已恢复为可读、可回读、可推理的 PyTorch 图，`vision_batch_profiles.py` 新增 `yunfuhua` profile。
- 原生 CPU 对拍 **10/10 通过**，判定不变：`atol=1e-4, rtol=1e-4`，形状一致、数值有限、全部终端输出比较。
- 使用固定的 CPU 数值 profile 后，输出 `Tanh_126` 十组全部**逐位一致**，`Tanh_127` 最大绝对误差 `4.8e-7`。
- 独立进程回放 10/10 通过；ONNX **未导出**（原因见下）；没有任何产品或编辑器接入。

## 源与身份

| 项 | 值 |
| --- | --- |
| 源文件 | `~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/jypc_yunfuhua_gpucpu_v1.0_size0_md52fb34821a520d7c79c38d93a494cfe00.model` |
| 源 SHA256 | `ff86b484516a6e1333e4678492e5c92ec5f423ab8e596968c53f7d2589a624d4` |
| 容器 | `named-records-v3`；内含 1 个 `bytenn-bm`（偏移 3664，1,954,125 字节）、1 个 JSON 记录、7 个 4 字节记录 |
| 网络 SHA256 | `5c0d3dc4c230ea12a7affebcb7ecafde8c7a446bec7a5c2e2e1492c91c1a6f99` |
| 图 SHA256 | `0d4ee06dc029fc5be581a47248d4bee32a489721d96a00b7db36a0038a981256`（84 层，头 `D`） |
| 权重 | float32 arena 487,070 个值，与图内卷积参数总数逐一相等；末尾 uint32 图戳 `1672745525` |
| 运行库 | `libbytenn.dylib` `1bf9be78…c53ad0`（与其他 bytenn 网络相同的固定 CPU oracle） |
| 产物 | `.local/jianying-model-pytorch/yunfuhua-20260919-r4/yunfuhua.pt`，SHA256 `7517a124620cbe73c6fbcd80fad64036097bea61b64174b5f9c7f3151818bced` |
| 状态摘要 | `4ccd96412fe3bf55c0cd255b7a693287c30f97b50d95afe134461eb17e29bb8e` |

容器 JSON 记录声明模型名 `yunfu`、`forwardType: 1`、输入 `data0 [320,320]` 与 `data1 [1,1]`（格式 10）、
输出 `Tanh_126`/`Tanh_127`，另有 `gamma: -0.04212`。这里只记录，不解释产品语义。

## 图结构

两个输入：`data0` `[1,3,320,320]` 图像，`data1` `[1,3,1,1]` 三值条件向量。
编码器是 MobileNet 风格的 1x1 / 3x3 深度可分离卷积，7 次 stride-2 下采样到 3x3；解码器每级
`UpSampling BILINEAR` x2，加残差，再经 `SEScale` 用条件向量算出的 sigmoid 门逐通道缩放。
瓶颈处有一个 `Upsample 1.6666666 linear 0 1`，把 3x3 放大到 5x5。
输出 `Tanh_126 [1,4,320,320]` 与 `Tanh_127 [1,2,320,320]`。

算子计数：Convolution 38、DepthwiseSeparableConvolution 15、Eltwise 10、Sigmoid 6、SEScale 6、
UpSampling 6、Upsample 1、Tanh 2、DataV2 2。

通用解释器 `vision_batch_torch.py` 为此新增：多输入图（头行 `<输入数> <层数> <戳>`，
声明数必须等于前导 `DataV2` 行数）、`Sigmoid`、`SEScale`（门必须是 `[N,C,1,1]`）、
分数倍 `Upsample`（只接受 `linear 0 1`，输出边长按 `floor(h*f+0.5)`）。
`vision_batch_export.py` 的合成用例、真实帧用例与 `run_case` 都改为按输入名生成和保存。

## 数值 profile 是怎么定下来的

| 轮次 | 执行 profile | 结果 |
| --- | --- | --- |
| r1 | 普通 fp32（`cpu-fp32-ohwi-hwc-v1`） | 8/10；`zeros` 与 `negative-ones` 的 `Tanh_126` 最大误差 `5.7e-4`、`2.1e-4`，随机输入最大 `9.2e-5` |
| r2 | 卷积改为 `ocr_rec_numeric.ordered_convolution`（原生 FMA 累加顺序） | 仍 8/10；随机输入降到 `3.4e-5`，常量输入 `5.3e-4` |
| r3 | 再加 `PinnedSigmoid` 与可分离 FMA 双线性（先 x 后 y） | **10/10**，两路最大 `1.7e-6` / `2.0e-6` |
| r4 | 再加 `matting_phase5_numeric.ordered_tanh` | **10/10**，`Tanh_126` 全部逐位一致，`Tanh_127` `≤4.8e-7` |

定位依据（`vision_batch_probe.py`，已改为支持多输入前缀图）：

- 前缀图对拍到 `Upsample_60` 都在 `1e-5` 内，说明分数倍上采样的输出尺寸与网格是对的；
  误差沿解码器逐级放大，`Add_80` `6e-5` → `Upsample_97` `8e-5` → `Add_116` `4.4e-4`。
- 把每一层单独用**原生输入张量**回放：普通 `nn.Conv2d` 与原生差 `2e-6`～`4e-6`，
  `ordered_convolution` 对稠密 1x1 和深度可分离 3x3 都逐位相同。
- `torch.sigmoid` 与原生门差 `8e-7`，`PinnedSigmoid` 逐位相同。
- `F.interpolate(align_corners=False)` 与原生 x2 上采样差 `1.9e-6`；x 方向先融合乘加、再 y 方向的
  可分离形式逐位相同；3→5 的分数倍上采样用同一公式（网格比例 5/3、半像素、越界钳到边缘）也逐位相同。
  抠像 GRU 用到的零填充邻居版本在这里误差 `1.8`，两套 bytenn 上采样内核不同，不能互换。
- `ordered_tanh` 使 4 通道头逐位相同；2 通道头仍差 `4.8e-7`，其 NHWC 尾部规则尚未针对 2 通道校准。

新 profile 名 `cpu-fp32-ohwi-hwc-ordered-fma-pinned-v1` 写入 bundle 与报告；`load_model` 只在
profile 声明 `execution: ordered-fma` 时接受该 stamp，其余四个视觉 profile 与它们的 bundle 不变。

## 验证范围

- 十组合成输入：零、一、负一、ramp、seed 17/41 均匀随机、seed 509/1709/20260919 正态保留集、
  非对称脉冲；`data1` 用相同配方但不同种子生成，与图像输入的随机张量不同。
- 原生与 PyTorch 输入完全相同，绕过图像解码、归一化、裁剪与后处理。
- 独立进程回放：`vision_batch_replay.py`，禁止读取厂商源文件与 Python 网络，10/10 通过。
- 台账快照：`yunfuhua-20260919-ledger.json` 由第二阶段索引加本报告生成，`main` 网络 `verified: true`；
  它不是全局累计台账，第四阶段的 21 个网络版本计数不因此改变。

不能据此宣称：真实人脸素材经产品前处理后的输出；条件向量三个分量的产品含义与取值范围；
`forwardType: 1` 所指的 GPU 路径；匀肤或丰盈滑条的可见效果；任何编辑器接入。

## ONNX

`onnx_export.py` 对 r4 bundle 导出失败：固定 profile 的 `cpu_exp` / `reciprocal_estimate` 用
`view(torch.int32)` 做位级运算，旧版 tracer 报 `aten::view` 别名分析断言。
若改用普通 fp32 算子导出，ONNX 图会带回 r1 的偏差（常量输入最大 `5.7e-4`），
无法用同一 `1e-4` 门槛通过原生冻结输出回放。与 GRU v3 一样，在有合格的数值适配器之前不导出。

## 证据目录（全部在 `.local/`，不进 Git）

- `yunfuhua-20260919-r1` … `r4`：四轮导出与逐 case 原生输出；`r4/report.json` 为最终报告。
- `yunfuhua-20260919-probe-r1`、`-probe-r2`：前缀图原生对拍。
- `yunfuhua-20260919-replay-r1`：独立进程回放。
- `yunfuhua-20260919-onnx-r1`：导出失败记录。
- `yunfuhua-20260919-ledger.json`：台账快照。

## 复现

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_export.py \
  --profile yunfuhua --out .local/jianying-model-pytorch/yunfuhua-new-empty-run --oracle
/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_replay.py \
  --report .local/jianying-model-pytorch/yunfuhua-new-empty-run/report.json \
  --out .local/jianying-model-pytorch/yunfuhua-new-empty-replay
/opt/homebrew/bin/python3 -m unittest vision_batch_test
```

## 剩余工作

1. `tt_face_extra_v15.0` 的 `B` 图（16 位定点）已在 2026-09-20 与整个人脸家族一起恢复并逐位对拍，
   见 [face-espresso-parity.zh-CN.md](face-espresso-parity.zh-CN.md)；`SetInput` 报 `set_datasize 307200, blob_datasize 153600`
   的原因正是 type-2 blob 每值 2 字节，定点语义记录在 [espresso-fixed-point.zh-CN.md](espresso-fixed-point.zh-CN.md)。
2. `tt_fsnew_base_jianying`、`tt_face_v11.2`、`tt_freid` 的明文图与 arena 已在无头人像宿主里捕获（同上）；
   `tt_faceverify` 与人脸属性模型在缓存里没有能触发它们的特效包，仍未捕获。
3. 2 通道 `Tanh` 尾部规则、ONNX 数值适配器、真实素材与产品前处理、编辑器接入。
