# Bandou 第五阶段精度收敛

日期：2026-09-19。仅本机私有互操作研究。本子任务未提交或推送，未修改共享 infer、onnx_export、ledger 或 inventory。

## 结果

- 完整原始图、原始 arena、CPU 原生对照 **30/30**：原有 18 组、6 个新增随机 holdout、两段视频的 6 个新帧，共 14 个视频帧。
- 全部终端 `/tanh/Tanh [1,4,512,512]` 逐元素比较；固定 `abs(actual-native) <= 1e-4 + 1e-4*abs(native)`，最大绝对误差 `2.294778823852539e-5`，没有放宽容差。
- 最终新包独立进程回放 **30/30**：对冻结 PyTorch 逐值一致，对全部原生输出通过固定门槛。
- 三个已有 profile `clip2m / clip30m / normal` 最终回归 **54/54**，冻结 PyTorch 逐值一致，原生对照通过。
- 单元测试：`vision_batch_test.py` **34** 项；`bandou_phase5_*test.py` **33** 项。实际包审计 **17** 项、主动访问守卫 **7** 项通过。
- 本机 ONNX Runtime CPU 烟测 **4/4**，对 PyTorch 最大误差 `2.980232238769531e-7`。这不是 30 组完整 ONNX/native 验收，也不是 Windows/Linux 或编辑器 E2E。

## 分歧与修复

旧格式原生对照仍为 **13/18**；五个随机输入失败，最大误差 `6.442666053771973e-4`。保留原报告，未修改其通过状态。

同输入卷积探针确认顺序 HWC FMA 对抽测原生输出逐值一致。复用 `ocr_rec_numeric.ordered_convolution`，没有复制或修改其实现。仅替换卷积仍未过门槛，失败报告保留。

顺序卷积后的 `random-17` 前缀 1–27 逐值一致，首次差异发生在第 28 层双线性 x2 放大，最大差 `3.814697265625e-6`。半像素坐标不变，改为先横后纵、两级各自 FMA 舍入后，该校准输入前缀 1–64 逐值一致，最终 Tanh 最大差约 `1.65e-6`。这是该校准输入的前缀证据，不泛化为所有输入逐位一致。

`VisionGraph.upsample` 只抽出原有默认实现供新 profile 覆盖，三个旧 profile 的算术行为不变。

## 新格式交接

```python
from bandou_phase5_torch import load_model

model = load_model(path=private_bundle, expected_sha256=bundle_sha256)
outputs = model({"data": cpu_float32_nchw})
```

- Format：`qcut-private-bandou-ordered-pytorch-v1`
- Profile：`bandou-ordered-v1`
- Execution：`cpu-fp32-ordered-hwc-fma-bilinear-xy-v1`
- 输入：`data [1,3,512,512]`，CPU FP32；原尺寸固定。
- 包 SHA256：`a4a881d5d841dc97c51bd8a562752af0e1d55e24d37b663c5c0b83bf85ea642a`
- 原生报告 SHA256：`6e5b5a555d7d7f86ba03ae62267a8c835d6d85622c7a0ab3f81fb690540f186e`
- Source SHA256：`11f3a90604b6ccdc95f9dbd150884e05e0b9eafed098ad62f1112d949b8916cf`
- State SHA256：`6f6e13fb67861fab74c8f0298e55335b50288c65ba3001a6ff76e2e1cffbb6cb`

新加载器要求新格式、固定源/图/状态、执行 profile、原生证据身份及 `weights_only=True`。没有 `allow_unverified` 绕过。旧 `PROFILES["bandou"]["native_verified"]` 保持 false，旧包改写通过标签仍不能默认加载。新旧属于同一个 source 的 `main` 网络，不应把新序列化或 ONNX 再计为新增网络。

全部证据位于已忽略的 `.local/jianying-model-pytorch/`，以下路径相对于该目录：

| 证据 | 路径 |
| --- | --- |
| 原始图新一轮 30 组原生验证 | `phase5-bandou-full-r1/report.json` |
| 最终包 | `phase5-bandou-delivery-r2/bandou-ordered.pt` |
| 最终不可变模型报告 / 交付状态 | `phase5-bandou-delivery-r2/report.json` / `delivery.json` |
| 全部 30 组交接清单 | `phase5-bandou-delivery-r2/replay/handoff.json` |
| ONNX 导出输入清单 | `phase5-bandou-delivery-r2/onnx-manifest.json` |
| 独立回放 | `phase5-bandou-delivery-r2/replay/report.json` |
| 实际包与守卫审计 | `phase5-bandou-audit-r1/report.json` |
| 三个旧模型最终回归 | `phase5-bandou-regression-final/report.json` |
| 顺序卷积仍失败 | `phase5-bandou-ordered-r1/report.json` |
| 第一分歧 / 修复后前缀 | `phase5-bandou-ordered-prefix-r1/report.json` / `phase5-bandou-ordered-resize-prefix-r1/report.json` |
| 双线性算术对照 | `phase5-bandou-resize-r1/report.json` |
| 最终 ONNX 烟测 | `phase5-bandou-onnx-r2/report.json` / `contract.json` |

`delivery-r1` 的模型回放通过，但包装器在回放后又修改报告，导致回放记录的报告摘要过时。因此最终交付只使用 `delivery-r2`，将交付状态单独写入 `delivery.json`，不覆写模型报告。

## ONNX 注意事项

不需要改变数值算法。直接导出的顺序累加器、广播 bias 被展开成大量常量，初次文件 299,632,703 字节，超过本子任务 64 MiB 限额。只删除了本阶段这份冗余失败导出；失败报告、warnings、字节数和 SHA256 收据保留，未删除此前资产。

`bandou_phase5_onnx.compact_broadcasts(model=graph)` 对空间重复常量逐位验证后改成小常量加标准 `Expand`，不改变权重或算术。共享导出重新生成此 profile 时，应在 `onnx.load` 后、checker/save 前调用该函数。导出到内存后压缩，避免再落盘大临时文件。

最终 ONNX 为 **16,923,652 字节**，SHA256 `efffce57ac86b20486db3449594bd627882ffe6704a00171967914c5b26e9f71`，只有标准 ONNX 操作，CPU provider，优化关闭。入口 `bandou_phase5_onnx.py` 完成实际图检查和 4 组完整输出烟测；广播压缩尚无独立合成单测。父任务负责共享注册及后续完整 ONNX/目标系统验收。

## 限制与收尾

- 原始模型/权重/恢复图/NPZ/ONNX 不进入 Git。未修改用户草稿、未调用云端、未运行产品编辑器。
- 视频 RGB 双线性缩放、除以 255 只是数值验证前处理，尚未证实产品语义或祛斑效果质量。
- 顺序 FMA 使用 FP64 中间量保留 FP32 累加舍入；CPU 耗时不能当作产品实时性能承诺。
- 修复独立回放守卫误拦私有虚拟环境：仅豁免当前环境的只读 Python/共享库代码和限定包元数据；厂商资产、原始模型、其他数据和网络仍拒绝。这是 Python audit 层，不是 OS 沙箱。
- 用户要求立即冻结后未继续实验。所有本子任务 exec 会话已结束，没有实验服务器；其他任务的进程和改动未处理。
