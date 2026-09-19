# OCR 检测器原生 CPU 对照

## 交付与范围

- 检测器：`native-parity-passed`，完整 58 层图的唯一终端输出（含两个通道）通过固定 `atol=rtol=1e-4` 对照。
- 13 个同输入用例，7 个 holdout；尺寸为 H×W `64×96`、`320×640`、`640×960`。最大绝对误差 `2.4020671844482422e-5`。
- `.pt` 含 1,996,596 个 FP32 参数，`weights_only=True`，不依赖厂商动态库加载或前向。所有状态张量和每个用例的保存/重载前向严格一致。
- **不是完整 OCR 产品链验收**：未证明业务层图片归一化、尺寸选择、文字框后处理、字表或 CTC。
- 原始图输入是 `DataV2` 的 `1×1` 占位，而不是固定生产尺寸。原生创建后回读确认 NWHC `[1,1,1,3]`；通过其 `ReInferShape(width,height)` 执行上述非方形尺寸。没有重写图内尺寸、裁剪层或缩小权重；不能称为“固定原始分辨率通过”。

最终报告和产物（全部忽略入库）：

```text
.local/jianying-model-pytorch/ocr-det-20260919-verified/report.json
.local/jianying-model-pytorch/ocr-det-20260919-verified/ocr-detector.pt
```

源资产：`~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/general_ocr_det_fp16_v2.0_size0_md5241d0b04ab38b62c4e7c9f7e6bfd3e40.model`

| 对象 | SHA-256 |
|---|---|
| 完整源模型 | `f060d7ac2f35b0ac74de6fc0f00de03f93f1247d349a9b8bdaa40b90fda1edde` |
| 解码原始图 | `f28e5e3134f79efae40464c750054adb2913e712873689c1de3ff904ea21c0cf` |
| 原始 FP16 arena | `e6912fe24a7caeead6912c1c9934d5ce65795f5b33eeb96d11880522c813343f` |
| 原生运行库 | `1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0` |
| `.pt` | `76b64723c18ce40589f23eea7df68ad6d111dbaab4ee2cad5d6da6fc420e1bd4` |

原生库取自 `JianyingShotSplit/current/Frameworks/libbytenn.dylib`，上述 SHA 为完整文件哈希；具体转换行为只对该 arm64 实现成立，不外推到 GPU、其他版本或其他架构。

## E 与 FP16 的实证

初次将原始 `E` 图与原始 FP16 arena 直接交给 `Thrustor::CreateNet`，返回 `weight not match net`，失败日志保留在 `ocr-det-r2`。不能据模型文件名假定这个低层接口自动解码 FP16。

对已 pin 的原生库检查 `ByteNNInternalConfig::CheckFp16AndConvertModel`（arm64 `0x15084`）确认：

1. 识别并去除开头四字节 `E`、反斜线、`n`、换行。
2. 将末尾四字节之前的 half payload 扩为 FP32。
3. 原样复制末尾 uint32 图标识；本模型标识与图头第三个数相同。

专用 oracle 直接调用该库导出的 `BYTENN::float16buffer_to_float32buffer`，保存完整扩展结果，与 `ocr_torch.widen_fp16` 的结果逐字节比较。

**该运行库转换并非完全等于 NumPy IEEE half 转换**：四元素 SIMD 路径处理次正规数时，把标准 FP32 位表示与 `(half_magnitude << 13)` 做 XOR；尾部 1–3 元素走标准标量转换。检测器 2,967 个参数受影响。用普通 `np.float16.astype(np.float32)` 会使原始源权重语义改变。

验证范围：

- 全部 63,488 个有限 half 位模式，与原生转换逐字节相同。
- 长度 1–8 的正负次正规数、正负零测试，覆盖 SIMD 和标量尾部。
- 本模型完整 1,996,596 个参数和图标识，与原生扩展结果逐字节相同。
- 非有限 half、长度不匹配、图标识不匹配被拒绝；不会放宽容差或替换权重。

原始图、原始 arena、扩展 arena、去 E 后的图、反汇编与早期失败候选均仅存于 `.local/jianying-model-pytorch/ocr-*`。研究代码只有自写解释器和合成测试，没有复制厂商图或权重进仓库。

## 算子与执行证据

- 普通卷积权重 OHWI → PyTorch OIHW；转置卷积也使用 OHWI，转为 PyTorch IOHW，不能按 IHWO 读取。
- 3×3、stride 2、padding 1、output_padding 1 的转置卷积及 4×4 输出头均经过完整图最终输出对照。
- 残差加法拒绝广播；Concat2 只支持已审核的通道轴；未知算子、激活值、参数布局、图拓扑被拒绝。
- `ThrustorEnforceCPURuntime` 在 `CreateNet` 前执行，必须 `GetForwardType()==0`。传入解码图字符串与 FP32 arena，不传模型路径。
- `SetInput` 首整数传**字节数**；输入回读逐字节相同。原生维度 NWHC、内存 NHWC；PyTorch 接口为 NCHW。
- 最终文件大小、输出形状、有限值、完整双通道输出逐元素验证。原生运行工作目录始终为私有目录，不落入产品或用户草稿目录。

`ocr-det-r4` 中的中间层 trace 仅用于定位：最终输出通过，但一个高幅值内部层在近零位置超过固定混合容差，因此**没有声称所有中间层通过或位级前向一致**。正式报告只验收声明的完整终端输出，不拿内部 tensor 池复用推断结果。

## 加载接口

```python
from ocr_torch import load_model

model = load_model(path=artifact_path, expected_sha256=artifact_sha256)
outputs = model({"data": input_tensor})
```

| 项目 | 约束 |
|---|---|
| 输入 `data` | 有限 CPU `torch.float32`，NCHW `[1,3,H,W]` |
| 尺寸 | H/W 为 32 的倍数，范围 32–2048；原生对照仅覆盖上文三个尺寸 |
| 输出 `Sigmoid_78` | CPU FP32，NCHW `[1,2,H/2,W/2]`，sigmoid 概率图 |
| 预处理 | 调用方提供相同归一化张量；此层不接收图片文件、不推断 RGB/BGR 或归一化约定 |

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/ocr_test.py
/opt/homebrew/bin/python3 research/local-model-pytorch/ocr_export.py \
  --out .local/jianying-model-pytorch/ocr-det-new-empty-run --oracle
```

每次导出要求新的空目录，避免旧输出被错误算作当前证据。合成测试覆盖 FP16 次正规数、尾部、OHWI 转置、卷积/激活/池化/残差、非法图与权重、输入 shape/dtype/finite、weights-only 重载、哈希拒绝及证据文件异常。

## 识别器失败候选

独立初探留下的首个失败候选是 `ocr-rec-r1`，它本身未计入通过数量。同一源随后继续做了 v2、v3、v4 候选，v4 已在完整 20/20 用例通过，见 [ocr-rec-phase4.zh-CN.md](ocr-rec-phase4.zh-CN.md)。以下是 r1 的历史记录：

- 源 SHA：`d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac`。
- 269 层，源尺寸 `[1,3,32,512]`；原生 CPU 两个用例成功执行，输入回读相同，完整 FP16 arena 扩展与原生一致。
- 候选路径：`.local/jianying-model-pytorch/ocr-rec-r1/ocr-recognizer-logits.pt`。
- 候选 SHA：`0cbb2e35ac3c65108e36af9b7aaae4cd10088c7c4d4de1da89556f56748003f1`。
- 状态：**`verification-failed`**，两例 `cases[].passed=false`。首个明显差异在 SE 门控卷积的激活值 2；候选 ReLU6 解释未经证明，最终 logit 严重不匹配。
- 原始 logit schema：`embedding` `[1,10537,1,128]`，不等于已识别文字。没有字表/CTC 验收。
- `ocr_rec_torch.load_model` 默认拒绝该失败候选；仅研究诊断可显式 `allow_unverified=True`。不得接入默认推理路径或标记为识别成功。
