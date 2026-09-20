# 本地二进制模型批量转换为 PyTorch

日期：2026-09-19。研究工具；第五阶段新增显式选择的 ONNX 分镜路径，不替换默认引擎。

## 批次记录

- [人脸 / 皮肤 / 人体 espresso 网络：捕获、精确 arena 与定点逐位对拍](face-espresso-parity.zh-CN.md)：四个加密人脸容器（fsnew / tt_face / face_extra / freid）、facefitting_3d、tt_skin_seg 与 tt_skeletonsquat 共 19 张网络在无头人像宿主里捕获，arena 按图戳、护页二分或戳窗口精确到字节；定点解释器 `espresso_fixed.py` 两种子下所有整数层逐位一致，规则见 [espresso-fixed-point.zh-CN.md](espresso-fixed-point.zh-CN.md)；两类定点 softmax 与 fp32 全连接累加顺序未固定；产品接入未做。
- [显著性抠像（saliency_matting）CPU 对拍与 ONNX](saliency-matting-parity.zh-CN.md)：盘点表 N07 首次恢复；解释器新增 `E` 头 fp16 arena、dilated `Conv2D`、最大池化、通道 Slice、Mul、ReduceSum；原生对拍 10/10，ONNX 导出并对冻结原生输出回比 10/10；产品接入未做。
- [匀肤 GAN（yunfuhua）CPU 网络对拍](yunfuhua-parity.zh-CN.md)：盘点表 N14 的 `jypc_yunfuhua_gpucpu` 首次恢复；通用视觉解释器新增多输入、Sigmoid、SEScale、分数倍上采样与固定 CPU 数值 profile，原生对拍 10/10，主输出逐位一致；ONNX 与产品接入未做。
- [第五阶段收尾与验收边界](PHASE5-20260919.zh-CN.md)：Windows/x86 合成 CI、无 Torch 视频分镜、编辑器接入、OCR 字表/CTC，以及 GRU/Bandou 新精度 profile。
- [第四阶段：更多模型、ONNX 跨系统与媒体 E2E](PHASE4-20260919.zh-CN.md) 保留该阶段累计：21 个网络版本、16 个 PT 包、19 份 ONNX；产品接入仍另列。
- [第三阶段：分类、OCR、跟踪与时序抠像](PHASE3-20260919.zh-CN.md) 保留当时数值校准与独立进程验证记录。
- [第二阶段：并行扩展、真实帧对照与统一推理](SCALEUP-20260919.zh-CN.md) 保留当时批次结果，不代表最新累计值。
- [容器与批量图恢复](CONTAINER-FORMATS.zh-CN.md) 区分可读图、算法数据和已验证网络。
- 以下是第一阶段固定批次结果，数量不代表后续工作的累计值。

## 第一阶段实际结果

扫描五套 `current` runtime 清单：69 条模型/算法资产记录，按 SHA-256 去重为 64 个文件。
其中 5 个网络生成了可回读、可推理的 PyTorch 版本，存放于 4 个 `.pt`：分镜的两个网络合为一个包。
**新增转换的是皮肤分割、骨骼、视频对象分割三个网络；分镜两个网络复用已有恢复成果。不是 64 个模型全部转换完成。**

| 网络 | 图规模 | 本次验证 | 最大绝对误差 |
| --- | --- | --- | --- |
| 分镜 Backbone new | 原探针 118 层 | 8 份已有原生层输出记录回归 | `2.98e-7` |
| 分镜 PredHead new | 原探针 41 层 | 1 份已有原生层输出记录回归 | `6.34e-9` |
| `tt_skin_seg_v5.1` | 177 层，990,889 参数 | 新运行 CoreML CPU oracle，9 组同输入对照 | `1.23e-7` |
| `tt_skeletonsquat_v10.0` | 153 层，977,858 参数 | 新运行 CoreML CPU oracle，6 组同输入对照 | `1.93e-5` |
| `video_saliency_seg_bce_v1.0` | 298 层，3,969,633 参数 | 新运行 CoreML CPU oracle，7 组同输入对照 | `5.25e-6` |

Espresso 共 22 组原生同张量对照；统一判定 `atol=1e-4, rtol=1e-4`，并要求形状一致、数值有限。
分镜另有 3 组随机输入序列的序列化回读一致性测试。
全量报告状态：`native-parity-passed: 3`、`recorded-native-parity-passed: 2`、`unsupported: 59`、`duplicate: 5`。

这里的 64 是**文件资产数**，含旧模型变体、脚本和拟合数据，不是 QCut 实际启用的 64 个神经网络。
与 [模型盘点](../../docs/technical/ai/local-neural-model-inventory-2026-09-19.zh-CN.md) 中 15 个文件型神经模型家族的口径不同。

## 之前分镜怎么做的

已重新阅读 [分镜交接](../jianying-shot-split-probe/HANDOVER.zh-CN.md)、主干、GRU 头、权重切片和逐层探针代码，
并对照本机 `~/Desktop/智能分镜/torch/export_weights.py` 的已有可移植导出流程。

1. 原生 `layer-trace` 在每层 forward 返回时立即复制输出。不能在整图执行后只调用 Extract：内存池复用会覆盖中间结果。
2. `weight-dump` 得到图顺序、卷积参数和层表。仅扫描二进制浮点数无法知道连线和层权重归属。
3. 使用固定版本、固定哈希定位两个 float32 arena，按层顺序读取权重、偏置、注意力常数和激活常数。
4. 映射密集卷积 OHWI、深度卷积 HWC、两个 GRU 的门顺序和 bias，再用原生中间张量逐层核对。
5. PyTorch 恢复的是 GhostNet 风格主干及双 GRU 时序头，不是从名字猜一个 TransNet 网络。
6. 把结构规格、常数、`state_dict` 一起导出；回读时不再需要 `.bytenn`、私有 runtime 或层表，但仍需要本仓库的 Python 模型实现。

本次 `shot_export.py` 复用仓库已有模块，并对源模型 SHA-256 做精确限制；未知版本不得套用固定 arena 偏移。
`PredHead` 只增加从 bundle 初始化的分支，原模型文件初始化路径和 forward 保留。

**纠正旧交接文档的宽泛措辞**：同张量回归接近一致，不代表整段视频逐位一致。
旧文档第 5.1 节记录了缩放像素误差及 `0.352 / 0.345` 阈值边缘案例。
这次没有重新执行真实长视频、完整解码/缩放/切点后处理对照，不能消除这个已知边界。

## 新增批量路线

三份 `.model` 含带前缀 ZIP，里面有编译后的 `.mlmodelc`，包括可读 Espresso 图、shape 和 weights。
不需要调用私有解密接口。本次仅解析这类已观察到的容器，不宣称支持全部 CoreML 或 ByteNN 格式。

```text
五套 manifest -> 大小/SHA-256 核对 -> 文件内容去重
  -> 已知分镜 SHA -> 原恢复模块 -> 结构 + state_dict
  -> 内嵌 Espresso -> 图/权重解析 -> PyTorch 执行图 -> 结构 + state_dict
  -> 不支持的封装 -> 记录原因，不生成占位 .pt
  -> weights_only 回读 -> 参数逐项相等 -> 前向逐位相等
  -> 原生同输入张量对照 -> 每个 case 的误差/阈值/状态
```

| 文件 | 职责 |
| --- | --- |
| `inventory.py` | 五套清单、路径边界、文件大小和哈希核对 |
| `espresso_archive.py` | ZIP 防路径穿越、blob 表边界、FP32/FP16/U8 权重还原 |
| `espresso_torch.py` | 已观察的九种算子、图依赖、schema、严格回读 |
| `shot_export.py` | 两个已恢复分镜网络的导出、回读和旧探针回归 |
| `coreml-oracle.mm` | macOS CoreML CPU 原生对照，不链接剪映私有 dylib |
| `verify.py` | 固定输入、保留集、可变尺寸、时间状态和误差统计 |
| `batch_export.py` | 批量扫描、去重、逐项状态和 JSON 报告 |
| `test_conversion.py` | 完全合成、可公开的单元测试，不携带原始权重 |

九种算子为 convolution、deconvolution、activation、elementwise、concat、upsample、split_nd、load_constant、pool。
只接受观察到的字段和参数语义；例如仅支持本批次的深度反卷积、无 padding 的 max pool、通道 split。
这不是任意 Espresso 图转换器，遇到其他模式必须扩展测试后再放行。

### 量化陷阱

骨骼模型混用 float32 和每输出通道量化 U8：`W_U8 / per_ch_qscale / per_ch_qbias`。
第一版直接 `q * scale + bias` 得到最大约 `0.00658` 的输出误差，未通过原生对照。
本机 CPU oracle 支持的还原 profile 是：以双精度表达该 U8 仿射运算的融合计算结果，再转 FP32、FP16，最后作为 FP32 权重推理。
仅量化权重执行此步骤，不把普通权重和 bias 一并降精度。

该 profile 明确写入 bundle。校准后，另外使用 seed 17、41、83 的 `[-1, 1]` 输入做保留集测试。
结果在上述容差内通过；这是**已观察版本的数值近似复现**，不是完整量化规范，也不是逐位相同。

### 验证范围

- 皮肤分割：四种声明的输入尺寸，零、一、固定随机和保留集输入。
- 骨骼：固定 192x144 输入；输出 `[1,34,24,18]`，尚未接回关键点解码/坐标映射。
- 视频对象分割：`data`、`prev_img`、`prev_mask` 全部传入，另测清空历史状态。不是忽略历史的单图模型。
- 原生与 PyTorch 使用完全相同的输入张量，绕过图像解码、RGB/BGR、归一化、裁剪、后处理。
- `threshold_0_5_agreement` 只是统一诊断项，不能当作骨骼准确率或真实分割质量。
- 尚未做真人素材、长视频时序稳定性、GPU、CUDA、MPS、Windows/Linux 或编辑器 E2E。
- 导出没有云端调用、没有付费请求，没有修改剪映草稿。

## 重跑

实测环境：macOS arm64、Python 3.14.6、PyTorch 2.10.0、NumPy 2.3.5。
PyTorch 推理本身不用 CoreML；只有原生对照需要 macOS CoreML 和命令行编译器。
外部依赖为 `numpy`、`torch`；本次没有安装或改动系统 Python 环境。

在 QCut 工作区执行：

```bash
mkdir -p .local/jianying-model-pytorch/bin
/Library/Developer/CommandLineTools/usr/bin/clang++ \
  -std=c++17 -fobjc-arc -O2 \
  -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
  -framework Foundation -framework CoreML \
  research/local-model-pytorch/coreml-oracle.mm \
  -o .local/jianying-model-pytorch/bin/coreml-oracle

EVIDENCE=.local/jianying-shot-split
/opt/homebrew/bin/python3 research/local-model-pytorch/batch_export.py \
  --runtime-root "$HOME/Library/Application Support/QCut/PrivateRuntimes" \
  --oracle .local/jianying-model-pytorch/bin/coreml-oracle \
  --shot-tables "$EVIDENCE/params2" \
  --shot-traces "$EVIDENCE" \
  --out .local/jianying-model-pytorch/batch-20260919
```

另一台机器上应传入其自有层表和探针目录。缺少历史 trace 时可省略 `--shot-traces`，报告必须保持原生未验证。
只转换 Filter 目录：省略 `--runtime-root`、`--shot-tables`、`--shot-traces`。
省略 `--oracle` 只做回读和 PyTorch 推理，状态为 `roundtrip-passed-native-unverified`。
退出码 0 表示没有转换错误或数值对照失败，**不代表 unsupported 数量为零**，批处理方仍需检查报告状态。

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/test_conversion.py
bunx vitest run \
  electron/__tests__/jianying-shot-split-torch-engine.test.ts \
  electron/__tests__/jianying-shot-split-compare.test.ts
```

本次 Python 单测 32 项、现有分镜 TypeScript 回归 8 项通过，覆盖损坏 blob、路径穿越、未知算子/字段、分组卷积、反卷积、量化、分支、schema、回读、清单校验及固定分镜哈希。

## 产物和边界

本机正式批次在 `.local/jianying-model-pytorch/batch-20260919/`：

- `report.json`：69 条记录的完整结果、哈希、来源、各 case 误差。
- `shots/shot-split.pt`：两个分镜网络；`shots/report.json` 保留旧原生探针回归结果。
- `f84a8cd7355ec07c/model.pt`：皮肤分割，4,059,127 bytes。
- `734f9e41b6fd4b3f/model.pt`：骨骼，3,995,163 bytes。
- `346b64693e02775f/model.pt`：视频对象分割，18,878,839 bytes，包含常量状态张量。
- 相邻 `oracle.mlmodelc` 和 `case-*`：私有原生对照模型及输入输出记录。

上述目录已被 `.gitignore` 排除。原始权重、恢复图、转换权重和原生张量均不提交、不分发。
换成 `.pt` 不改变原资产的权利状态；这里仅记录本机互操作研究。
仓库中只有自行编写的工具、合成测试和文字结论。不要将私有导出包直接作为公开 QCut 安装包资源。

## 第一阶段剩余工作

59 个去重文件尚未转换，其中一部分本来就是脚本/数据。后续先按作用和容器分类，不能为凑数量生成假模型。

1. 优先 `tt_matting_video_gru`：复用分镜的原生逐层探针，恢复 recurrent state、门顺序及输入输出，测连续帧、reset 和 seek。
2. 人脸检测、附加点、瘦脸：先抓真实 ROI、归一化和图连接，再处理层权重；测多脸、无人脸、边缘脸、坐标回投。
3. 去噪/补帧：单独恢复时间窗口、颜色空间、tile 边界和时序状态，不套用分镜 arena 偏移。
4. 旧分镜两文件是另一对哈希，未自动当成 new 模型。只有结构/权重重新对拍后才启用。
5. 只把已证实的纯脚本、几何表列为非神经资产，不从 face-fitting 文件名推断内容。第二阶段已证明 `tt_facefitting_3d` 是含神经子网的混合包。
6. 三个新模型接入产品前，需要 feature flag、源资产校验、取消/错误/内存限制、真实媒体 E2E 和原桥 fallback。本次不自动替换现有运行时。

## 格式参考

权重容器的 uint64 blob 表和命名以 [Netron 官方 Espresso parser](https://github.com/lutzroeder/netron/blob/main/source/espresso.js) 为交叉参考；执行器是本仓库自写的受限实现。
编译模型的原生推理和 CPU compute units 参见 [Apple Core ML prediction 文档](https://apple.github.io/coremltools/docs-guides/source/model-prediction.html)。
这些资料不替代本机模型输出对照。
