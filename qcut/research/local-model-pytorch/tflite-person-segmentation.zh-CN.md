# QCut MediaPipe 人像分割的独立 PyTorch 转换

日期：2026-09-19。只新增研究工具，没有替换编辑器生产推理路径。

## 结果

转换的是仓库实际打包的 `apps/web/public/models/person-segmentation.tflite`，不是另找一个同名网络。

- 源文件：16,371,837 bytes，SHA-256 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`。
- 单图、373 个张量、175 个算子、4,070,339 个常量标量。最后一个数字包括 reshape/transpose 的整数常量，不称为可训练参数数。
- 算子：67 Conv2D、18 DepthwiseConv2D、25 Add、18 Mul、20 Reshape、8 Transpose、6 Softmax、6 Sum、3 ResizeBilinear、3 ResizeNearestNeighbor、1 TransposeConv。
- 输入：NHWC float32 `[1,256,256,3]`。输出：NHWC float32 `[1,256,256,6]` **原始 logits**。
- 14 组原生同输入对照通过：8 组合成输入和两段本机参考视频各 3 帧。固定 `atol=1e-4, rtol=1e-4`，最终输出最大绝对误差 `8.881092071533203e-5`。
- seed 19 随机输入下，175 个算子输出全部通过相同容差。逐层报告和原生中间张量保存在私有目录。
- `.pt` 使用 `weights_only=True` 回读，所有常量相等，14 组前向回读结果逐位相等。
- 25 项合成契约测试通过；不安装 TensorFlow 的普通 PyTorch 环境执行时，两项导出器测试跳过，另外 23 项通过。

这新增 **1 个模型家族、1 个网络、1 个 `.pt`**。它不属于前一轮私有 runtime 的 64 个去重资产，因此不能从那批的 unsupported 数量中减去 1。

## 实际产品链路

`apps/web/src/lib/segmentation/person-cutout-client.ts` 将模型 URL 交给 `apps/web/public/mediapipe/person-cutout-worker.js`。
Worker 使用 MediaPipe `ImageSegmenter`、CPU delegate、VIDEO 模式，并获取 confidence masks。

模型附带标签依次为 background、hair、body-skin、face-skin、clothes、others。
结构化读取本地 `TFLITE_METADATA` 证实：输入 normalization mean/std 都为 `[127.5]`；
自定义 `SEGMENTER_METADATA` 的 `V001` activation 为 2，即 `SOFTMAX`。

因此处理顺序是：

```text
RGB 图像 -> resize/ROI -> (pixel - 127.5) / 127.5
  -> TFLite / 新 PyTorch 图 -> 六通道 logits
  -> MediaPipe 图外 softmax -> 六类置信度
  -> QCut 累加所有非背景类并 clamp 到 1
  -> temporal smoothing -> edge shift -> threshold/feather
```

不能把 raw logits 相加当作 alpha。此 `.pt` 的 forward 故意停在原生模型的输出边界，不偷偷加入图外 softmax 或 QCut 羽化。
`person-cutout-client.ts` 在 seek、倒退或时间跨度超过 250 ms 时清除 QCut 的平滑状态。
这份模型本身只有一个输入，没有恢复出需要伪造的 GRU/recurrent state。

MediaPipe 激活来源和图外归一化语义参见 [官方 ImageSegmenter graph](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/image_segmenter/image_segmenter_graph.cc)。
字段位置参见 [metadata schema](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/metadata/metadata_schema.fbs) 和 [segmenter schema](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/metadata/image_segmenter_metadata_schema.fbs)。
这些外部文档用于解释格式；本次报告数值来自本机源文件和原生执行，不来自文档推测。

## 实现范围

| 文件 | 职责 |
| --- | --- |
| `tflite_schema.py` | 调用 TensorFlow 官方 FlatBuffer bindings，读取已支持版本的浮点单图及常量，拒绝量化、稀疏、变量、动态尺寸、外部 buffer、未知算子 |
| `tflite_metadata.py` | 通过 FlatBuffers Table API 读取已观察到的 normalization 和图外 activation，不复制厂商生成绑定 |
| `tflite_torch.py` | 纯 PyTorch 执行器、严格规格检查、常量 buffers、回读；推理不依赖 TensorFlow/MediaPipe |
| `tflite_verify.py` | 原生 CPU 同输入 oracle、逐层诊断、私有产物及报告 |
| `tflite_test.py` | 自造张量和自造 FlatBuffer 的测试，没有模型权重或原图夹具 |

关键语义包括：OHWI -> OIHW、深度卷积通道 multiplier、SAME 非对称 padding、反卷积输出尺寸裁剪、
NHWC reshape/transpose、half-pixel resize 和最近邻的取整规则。不会从模型文件名猜 U-Net 或 RVM。
只支持当前观察到的算子版本；未知模式失败，不生成占位神经网络。

原生 oracle 是 TensorFlow 2.20.0 的 TFLite CPU，禁用默认 delegates 并保留中间张量。
其 API 已标记未来迁移到 LiteRT；本次固定版本，不依赖未来版本的行为。
参见 [官方 Interpreter API](https://www.tensorflow.org/api_docs/python/tf/lite/Interpreter) 和 [TFLite schema](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/compiler/mlir/lite/schema/schema.fbs)。

## 本机产物与 API

所有派生二进制位于 Git 忽略目录 `.local/jianying-model-pytorch/tflite/`：

- `model.pt`：格式 `qcut-bounded-tflite-pytorch`，`version: 1`。
- `report.json`：源 SHA、artifact 绝对路径/大小/SHA、环境、逐 case 和逐层误差、许可边界。
- `case-00.npz` 到 `case-13.npz`：`input`、`native`、`pytorch` 三份同形张量。
- `native-intermediates.npz`：一组输入下的 175 份原生中间结果。
- `venv/`：隔离导出/验证环境，没有修改系统 Python。

```python
from tflite_torch import load_model
import torch

model = load_model(path=".local/jianying-model-pytorch/tflite/model.pt")
with torch.inference_mode():
    logits = model(image_nhwc_float32)
```

输入索引位于 `model.graph["inputs"]`，输出索引位于 `model.graph["outputs"]`；
每个索引的规格位于 `model.graph["tensors"][index]`，具有 `shape` 和 `dtype`。
统一 NPZ 接口应使用输入名 `image`、输出名 `logits`，不能命名成已经后处理的 alpha。

## 重跑

从 QCut 工作区执行，所有依赖只安装到忽略目录中的 venv：

```bash
/opt/homebrew/bin/python3.12 -m venv .local/jianying-model-pytorch/tflite/venv
.local/jianying-model-pytorch/tflite/venv/bin/python -m pip install tensorflow==2.20.0 torch==2.10.0
.local/jianying-model-pytorch/tflite/venv/bin/python research/local-model-pytorch/tflite_test.py
.local/jianying-model-pytorch/tflite/venv/bin/python research/local-model-pytorch/tflite_verify.py \
  --video .local/jianying-effect-references/_assets/ref-clip-face-1280x720.mp4 \
  --video .local/jianying-effect-references/_assets/ref-clip-body-1280x720.mp4
```

没有参考片时省略 `--video`，只验证 8 组合成输入，不得沿用本次的 14 组结论。
真实帧用 FFmpeg bilinear 缩放到 256x256，再按 metadata 归一化，两边共享完全相同的输入。
因此这不是浏览器 MediaPipe 的 ROI/缩放/回投一致性证明。

## 边界与下一步

1. 人物画面参考片没有分割 ground truth，也不能按素材名称推断均为真人实拍。本次证明数值复现，不证明人物分割质量优于原模型。
2. 尚未对照 QCut Web Worker 的 WASM/XNNPACK、图外 softmax、原图尺寸 mask 回投和后处理，也未做编辑器 E2E。
3. 当前逐算子 PyTorch 执行偏研究用途；单次初步随机输入测得原生约 0.11 s、PyTorch 约 0.42 s，不是系统基准，不宣称加速。
4. 原模型已经由既有提交跟踪。本任务没有添加、更新、迁移或重新分发它；metadata 中未提供 license 字段，本轮不据此推断额外分发权利。
5. 所有派生权重、恢复图、参考帧、原生张量只用于本机互操作研究，禁止提交或随公开安装包发布。更换 `.pt` 格式不改变资产权利状态。
6. 生产接入前先做图外处理对照、取消/内存/输入限制、稳定性能和 UI 导出端到端测试。本次没有云端调用、没有付费请求、没有 commit/push。
