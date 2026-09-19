# GRU 人像抠像：强制 CPU 对照与未通过项

日期：2026-09-19。本记录只覆盖 `tt_matting_video_gru_v1.0.model`，不替换产品运行时。

## Phase4：扩大真实时序，缩小数值反例

**仍为 `native-parity-failed`，新增通过网络数为 0。** 原有 CPU 候选、权重、算子配置和
`allow_unverified=True` 门槛保持不变；没有改用标准 Softmax、调高容差或把旧失败改成通过。
本阶段只修改抠像研究模块，没有接入统一 infer、ONNX、产品后端或编辑器。

### 本轮实际执行

| 范围 | 新运行结果 |
| --- | --- |
| 原始 FP16 | 同 pinned CPU runtime 重新展开全部 1,787,410 个参数，逐位一致；仍有 50,253 个值不同于标准 NumPy 展开 |
| 单帧四输入/四输出 | 6/6 通过，含三组 holdout；完整状态/forward 回读通过 |
| face 视频 | 10 fps、60 个采样帧，57 个不同帧哈希；完整重放，共 120 次四输出比较，14/120 通过 |
| body 视频 | 10 fps、60 个采样帧，60 个不同帧哈希；完整重放，共 120 次四输出比较，4/120 通过 |
| 状态和回放 | 三状态共 720/720 次比较通过；两个后端各自反馈、输入回读、0/30 帧 reset、完整 replay 均逐位正确 |
| 概率 | `nn_3` 18/240 通过，最大绝对差仍为 `0.00390625`；固定 `atol=rtol=1e-4` |
| 冻结输出回归 | 重构后的逐节点执行器与 Phase3/r7、Phase4/r1 的 12 组已冻结 PyTorch 输出逐位相等；这是回归，不计作新原生对照 |
| 合成回归 | 抠像相关 51/51 项测试通过，新增 15 项覆盖逐层执行、布局实验、边界反例、候选保护及参数校验 |
| 聚合报告 | 6 单帧 + 240 时序，共 246 个网络 case，整体失败；诊断和旧 Softmax 独立证明单列，不增加通过模型数 |

另保留 8 fps 的两段初步运行：各 48 个采样帧、完整重放，共 192 次推理。
该轮 face 有 2 个重复帧，后续补入 `frame_sha256`、`sampled_frames` 和实际 `distinct_frames`，
不再把采样数量直接称为独立帧数量。最终汇总只使用上表 10 fps 的两段，避免重复计数。
预处理仍是研究用 bilinear stretch / BGR / 255，不代表剪映生产预处理一致。

### 首层卷积已定位，但不是整网修复

`MattingGraph.evaluate_node` 与完整 forward 共用同一组算子。
诊断分别记录自然传播输出与“只喂入该层原生输入”的输出，避免把所有差异归给上游。
8 fps 初步序列的 face 首帧和固定随机 holdout 509 均重新执行完整原生图，明确保留全部中间结果。

两组输入的首个局部位差都在 `Conv_0`。对首层与末层分别比较 11 种数值执行方式：
连续 NCHW、channels-last、FP64 单次回转，以及 channel/spatial 两种归约顺序、bias
先/后加入、融合/非融合乘加的组合。

- 首层默认方式最大差约 `5.66e-7`（face）/ `5.96e-7`（holdout 509）。
- 首层 channels-last 与“spatial-major、bias-first、逐项 FP32 FMA”在两组输入均逐位一致。
- 这证明该首层的有效累加行为，不等于已确定每层实际汇编调度。
- face 同输入局部检测中，仅 4/96 个卷积可用 channels-last 逐位匹配；下一个位差在 `Conv_2`。
- 整图 channels-last 实验的 face 概率仍有 35 个超门槛值，最大差 `0.001953125`，因此未写入 bundle 或默认执行器。
- Sigmoid、Tanh、上采样在单独喂原生输入时也有微小差异，不能只修第一层就宣称完成。

### 四像素原生反例

从真实 face trace 选取四个超门槛像素，分别保存其 native/PyTorch logits。
构造独立 `2x2`、二通道 Softmax 图，使四个 pair 仍走 SIMD 路径，不引入 scalar-tail。
两份输入都由同一 pinned CPU runtime 重新执行，并检查输入字节回读和完整输出：

| 项目 | 实测 |
| --- | --- |
| 两份 logits 最大差 | `5.9604644775390625e-6`，通过固定输入比较门槛 |
| 原生两次输出最大差 | `0.0009765625`，8 个输出值中 6 个超门槛 |
| 移植 Softmax 与两次原生结果 | 两组均逐位一致 |
| 原生 logits 的独立结果与全图对应概率 | 逐位一致 |

因此“小幅 logits 偏差跨过原生概率离散边界”已有独立运行的具体反例，不只是量化推断。
完整 face trace 的 18 个失败像素全部发生桶变化；报告保存坐标、两路 logits 的 FP32 位、
差值、denominator、bucket、exponent 和输出概率。它没有证明前层全部误差来源已经消除。

标准 Softmax 只作为不同语义的诊断对照：同帧两份 logits 的标准 Softmax 差小于 `1e-4`，
但原生 logits 的标准 Softmax 与 native 输出最大差约 `0.0026781`，73,107 个值超门槛。
不能用这个平滑函数替换原生数学再称为 parity；没有新增“已通过”的标准 Softmax 模型包。

### 本轮路径与复现

下列路径相对于 `.local/jianying-model-pytorch/`，均为私有忽略产物：

- 汇总：`matting-cpu-phase4-final-20260919-r1/report.json`。
- 单帧、完整 FP16 证明、bundle：`matting-cpu-phase4-20260919-r1/`。
- 时序：`matting-cpu-phase4-media-{face,body}-20260919-r2/report.json`。
- face 全图/逐层/布局诊断：`matting-cpu-phase4-trace-face-20260919-r2/report.json`。
- 独立随机 holdout：`matting-cpu-phase4-trace-holdout509-20260919-r1/report.json`。
- 四像素反例：`matting-cpu-phase4-counterexample-20260919-r1/report.json`。
- 重构冻结回归：`matting-cpu-phase4-refactor-replay-20260919-r1/report.json`。
- 本轮合成回归日志：`matting-cpu-phase4-final-20260919-r1/unittest.log`。

本轮 artifact SHA 仍为 `1fdad2190f3f12677189fa359b0306bd057aea56373e6dd9d6f0fc685907415e`。
聚合保留 Phase3 独立 Softmax 证明的路径，明确是复用旧证据，不声称本轮重跑了它的
524,288 个输出。新四像素原生调用则有独立 compile/runtime/log/input/output 证据。

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/matting_cpu_media.py \
  --run .local/jianying-model-pytorch/matting-cpu-phase4-20260919-r1 \
  --out .local/jianying-model-pytorch/matting-cpu-phase4-media-fresh \
  --video .local/jianying-effect-references/_assets/ref-clip-face-1280x720.mp4 \
  --frames 60 --fps 10
/opt/homebrew/bin/python3 research/local-model-pytorch/matting_cpu_counterexample.py \
  --trace .local/jianying-model-pytorch/matting-cpu-phase4-trace-face-20260919-r2 \
  --out .local/jianying-model-pytorch/matting-cpu-phase4-counterexample-fresh
/opt/homebrew/bin/python3 -m unittest discover \
  -s research/local-model-pytorch -p 'matting*test.py' -v
```

接下来应逐个核对 `Conv_2` 的归约分块、深度卷积、门激活和 resize 的舍入顺序；
每种局部修正都须重跑两段独立状态序列，不以单帧零误差或标准 Softmax 的平滑结果替代。
通用图架构与这个固定 arm64 runtime 的数值 profile 保持分开；本项未做 ONNX、跨平台
或编辑器预览/导出验收。候选加载门槛与旧失败证据继续保留。

## Phase3 最终结果

**整体仍为 `native-parity-failed`，不能计入完整原生时序验证通过的模型。**
新 CPU 结果与旧 Interpreter/session 失败报告分别保留，没有覆盖或改名旧失败。
没有扩展 `tt_matting_v15`，没有改产品路径、用户草稿，也没有提交或推送。

| 验证范围 | 实测结果 |
| --- | --- |
| 后端 | 在 `CreateNet` 前调用 `ThrustorEnforceCPURuntime`；实测 `GetForwardType == 0` |
| 原始权重语义 | 对实际 1,787,410 个参数调用同一 pinned runtime 的 FP16 展开函数，全部与独立解码器逐位一致 |
| 原尺寸单帧 | 零值、2 组随机、2 组独立随机 holdout、ramp，共 6/6 case、24/24 输出通过 |
| 单帧最大误差 | 概率 `0`；三个状态分别 `1.12951e-5`、`2.13981e-5`、`4.82872e-5` |
| 实际参考帧 | face/body 各 24 个不同帧，分别完整重放一次，共 96 次推理 |
| 独立循环反馈 | 三个状态的 288/288 次比较通过；native 只反馈 native 状态，PyTorch 只反馈 PyTorch 状态 |
| Reset/replay | 每轮第 0、12 帧显式清零；两端各自完整重放逐位一致，native applied-input/echo 完全一致 |
| 时序全部四输出 | face 2/48、body 0/48 次完整通过；失败均在概率 `nn_3`，全局最大误差 `0.00390625` |
| 固定门槛 | 始终 `atol=rtol=1e-4`，没有忽略失败像素、放宽容差或改为均值门槛 |
| 回读 | `.pt` 用 `weights_only=True`；完整 state 和六组 forward 逐位相等，不需 vendor runtime |
| 合成测试 | 36 项通过，覆盖候选 opt-in 门槛、输入/输出/状态 schema、布局、字节数、finite、缺失/重复/额外项、算子 profile 与私有输出边界 |

### 原始 FP16 与派生表示边界

原始外层资产与已恢复 BM 的 SHA 保持下文记录的值。
CPU runtime 固定为 `febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863`。
`E` 是 FP16 arena 标记；恢复的 `D` 图已去掉该前缀，直接把原始 FP16 arena 交给
`Thrustor::CreateNet` 会在建图时崩溃。该失败也保留，不当作数值对照。

早期 r4-r6 用 NumPy 展开的 FP32 arena，只证明**派生权重 CPU 图**的数值关系，不能代表
原始资产加载语义。实际 arena 有 **50,253** 个参数的 native 展开不同于 NumPy，最大差
`3.0428171157836914e-5`。四元素向量路径对 half 次正规数还有位 XOR，尾部 1-3 个值使用标准转换。
现复用 OCR worker 的 `ocr_torch.widen_fp16`，再调用本模型 pinned runtime 的
`BYTENN::float16buffer_to_float32buffer` 校验**实际全部 arena**，不是只相信另一模型的测试。
原始 arena 尾部四字节 stamp 原样保留。

r7 的实际展开校验已通过。原始 FP16 arena SHA：
`b1ef5508bcf1cbe4eb57a832155b12fda5d5f8a11880c91ddf78827ce5dcb16c`；
展开后参数 SHA（不含 stamp）：
`aec0e6b1eda6589e5678c824d1ea4f95eae572b35841b79b5c379714a3203f0b`。
这证明转换后的权重语义与原始 native 展开相同，但本次没有直接让强制 CPU oracle
加载完整未修改外层容器；报告同时保留 `unchanged_container_load_tested: false`。

### CPU 输出保留与数学配置

`CreateNet` 的字符串参数是**图内容**，不是路径。其输出名向量要预填全部四个目标输出。
三个循环状态后面仍有消费者，不预填会被内存池复用；`Extract` 返回有限张量和正确形状
也不能证明内容还属于该层。新探针显式保留所有四路输出，诊断探针显式保留全部中间层。
`SetInput` 的第一个整数是字节数。CPU 描述符是 **N,W,H,C**，内存是 NHWC；
这与下文旧 IES Interpreter 的 H,W,C,N view 不能混用。

CPU 专用格式 `qcut-private-matting-gru-cpu-v2` 使用独立的
`arm64-two-channel-frecpe-v1` profile：二通道 Softmax 的快速 exp 多项式、FP32 融合运算、
未迭代倒数估计和另一通道的补数。旧 v1 仍使用标准 PyTorch Softmax，未被悄悄替换。
独立 synthetic Softmax 的零值、ramp、随机 holdout 和极值 holdout 共 524,288 个输出值
全部与 native **逐位一致**。

真实 face 首帧全图 trace 的第一个超门槛张量是最终 `nn_3`：28 个值失败，max
`0.001953125`。之前所有张量均通过固定门槛；把 **native logits** 输入移植的 CPU
Softmax，输出又与 native 逐位一致。这支持“前层小误差跨过最终倒数估计的量化边界”的
定位，但不等于已消除前层舍入差异。不能把均值误差很小当作整体通过。

此处不是漏走 scalar-tail 分支：GRU 的 65,536 个像素 pair 可被 4 整除，使用向量路径；
tracking 的 `[3125,2,1,1]` 则是前 3124 个 pair 走向量路径、最后一个走标准 `expf/divide`。
向量路径在 `1 + fast_exp(logit1 - logit0)` 的归一化 mantissa 上取 256 个倒数估计 bucket，
因此跨 bucket 的微小 logits 差异可变成约 `0.001953125` 或 `0.00390625` 的概率跳变。
已有证据证明 Softmax 接收相同 native logits 时逐位相等；“前层累加/舍入顺序差异导致跨界”
仍是定位推断，尚未确定第一处产生这些微小差异的卷积累加指令。

与 tracking worker 只读核对了 exp/reciprocal 核心：200,001 个 exp 输入、98,304 个
有限倒数输入以及 4096 个无尾部 pair 全部逐位一致。两份 runtime SHA 不同，且 scalar-tail、
输入布局与 `+inf` 策略不同；尚未合并代码，也没有因此替换任何模型的原生证据。

### 交付与集成

私有根目录：`/Users/peter/Desktop/code/qcut/qcut/.local/jianying-model-pytorch/`。

- 最终汇总：`matting-cpu-phase3-final-20260919/report.json`，102 个网络 case，整体失败。
- 单帧与原始权重证明：`matting-cpu-phase3-20260919-r7/report.json`、`native-expand.log`、`native-expanded-weights.f32`。
- Bundle：`matting-cpu-phase3-20260919-r7/matting-gru.pt`。
- Bundle SHA：`1fdad2190f3f12677189fa359b0306bd057aea56373e6dd9d6f0fc685907415e`。
- 时序：`matting-cpu-phase3-media-{face,body}-20260919-r3/report.json`。
- 首失败层：`matting-cpu-phase3-trace-face-20260919-r2/report.json` 与逐层原生/移植张量。
- 独立数学证明：`matting-cpu-phase3-softmax-proof-20260919-r1/report.json`。

```python
from matting_torch import load_model

model = load_model(path=artifact_path, expected_sha256=artifact_sha256,
                   allow_unverified=True)
outputs = model(inputs)  # Four explicit float32 CPU NCHW tensors in and out.
```

`model.input_shapes` / `model.output_shapes` 提供下文四路 schema。
加载只依赖 Python、NumPy、PyTorch、`matting_torch.py` 和 `matting_cpu_math.py`；
导出阶段另需 `ocr_torch.widen_fp16`。加载器校验固定图语义哈希、原始来源哈希、CPU profile、
schema、所有 state keys/dtypes/shapes/finite，不接受未知语义或隐式 dtype 转换。
CPU 候选默认拒绝加载，研究调用必须显式传入 `allow_unverified=True`；该标志不代表验证通过，
也不能绕过 provenance/schema 校验。即使 bundle 自称已通过，CPU_FORMAT 仍需显式 opt-in。
旧 v1 研究加载行为保持不变。CPU_FORMAT 不注册到统一 `infer`，不计入 verified 模型数。
既有 `.pt` 与原生报告保持不变；旧报告的 loader 字符串是生成时 API，使用时以此处显式门槛为准。

重跑使用**新**私有目录：

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/matting_cpu_export.py \
  --out .local/jianying-model-pytorch/matting-cpu-phase3-new
/opt/homebrew/bin/python3 research/local-model-pytorch/matting_cpu_media.py \
  --run .local/jianying-model-pytorch/matting-cpu-phase3-new \
  --out .local/jianying-model-pytorch/matting-cpu-phase3-media-new \
  --video .local/jianying-effect-references/_assets/ref-clip-face-1280x720.mp4
/opt/homebrew/bin/python3 -m unittest discover \
  -s research/local-model-pytorch -p 'matting*test.py' -v
```

实际帧预处理仅为研究输入：ffmpeg 4 fps、双线性拉伸至 256x256、BGR/255。
未证明产品预处理、最终 alpha 后处理、编辑器路径、真实人物视觉质量或产品 GPU parity。
旧日志包含 GPU 字样，但没有在旧 Session 上完成可验证的后端选择查询；最终引用字段称
`legacy_session_evidence`，不把旧失败武断归因于某个已确认 GPU 实现。

## 旧阶段记录：Interpreter/Session

已恢复实际图、导出可回读和可推理的 PyTorch **候选**，但没有通过统一的原生数值门槛。
不得把这份候选计入 `native-parity-passed`，也不得发布或打包其权重。

| 项目 | 实测 |
| --- | --- |
| 外层模型 | 3,601,895 bytes；SHA-256 `101688825490be3704babc7ce49f6d002cdb4fe69e879556b4687ac9006f8596` |
| 加载后的 BM 子容器 | 3,588,512 bytes；SHA-256 `b0216fbfc8f2b810bdd9d7f384fc9b13f897104409c82eade8e83402189ef2f5` |
| 图 | 194 个算子，加 4 个 `DataV2` 输入，共 198 行 |
| 权重 | 1,787,410 个参数；FP16 参数转为 FP32 推理 |
| 导出回读 | `weights_only=True`；所有 state tensor 相等，三组输入的 forward 逐项相等 |
| 原生对照 | 新执行 3 组四输入/四输出，共 12 个输出比较；整体失败 |
| 测试 | 16 项合成 Python 单元测试通过 |

首版把 `UpSampling LINEAR` 当作普通 `interpolate(..., align_corners=False)`，
在后两组循环状态出现约 1.22 的最大误差。根据同张量边界误差定位，
原生行为对应 half-pixel 坐标、**零边界填充**，不是边缘值复制。
现使用 `grid_sample(..., padding_mode="zeros", align_corners=False)`。

修正后，三组对照的整体最大绝对误差为 `0.0049550235`，出现在第三组循环状态。
分割概率最大绝对误差为 `0.0001814030`。统一 `atol=1e-4, rtol=1e-4` 保持不变。
仅全零输入的概率输出通过，循环状态仍失败，不能用几乎全背景的概率掩盖状态差异。

## 实际结构，不是套用 RVM

实际骨干使用 Ghost 风格卷积和拼接，后接三个显式空间循环单元。
图中有 52 个普通卷积、44 个深度卷积、47 个拼接、25 个 Eltwise、
9 个二元运算、6 个切片、4 个上采样、3 个 Sigmoid、3 个 Tanh 和 1 个 Softmax。

原生接口张量为 NHWC 内存，配置维度顺序为 `H,W,C,N`；PyTorch 接口统一为 NCHW。

| 输入 | PyTorch 形状 | 对应返回状态 |
| --- | --- | --- |
| `data` | `[1,3,256,256]` | 双通道概率 `nn_3: [1,2,256,256]` |
| `data1` | `[1,80,16,16]` | `Add_196` |
| `data2` | `[1,56,32,32]` | `Add_213` |
| `data3` | `[1,32,64,64]` | `Add_230` |

循环更新由图中的分支定义：拼接当前特征和旧状态，1x1 卷积产生两个 Sigmoid 门；
重置门作用于旧状态，再经拼接、1x1 卷积及 Tanh 产生候选，
最终按 `old + update * (candidate - old)` 更新。不能替换成默认 `torch.nn.GRU` 的门顺序。

当前 Python 模块要求调用方显式传入全部状态，没有隐藏的全局缓存。
连续帧应将三个状态输出分别反馈到下一帧；reset/seek 应清空，且需要另行验证。
**本次三组 case 是全零和两组固定种子独立随机状态，不是已通过的视频时序反馈测试。**
本轮没有做真实人物素材、完整颜色/缩放预处理、长视频、seek、编辑器 E2E 或性能承诺。

## 为什么分镜探针不能原样套

现有 [产品桥](../../electron/jianying-person-cutout/native/matting-gru-bridge.cpp) 调用
`bef_Portrait_Matting_InitModel(handle, 4, modelPath)`，再检查解析后的模型类型为 6。
本次实际网络对象为 `BYTENN::IESNetwork`，不是分镜用的 `BYTENN::LabNetWork`。
仅按旧 LabNetWork 偏移取层表会访问错误对象。

本次独立探针先加载一个模型并完成原生首帧，然后：

1. 找到 `ByteNNEngineImpl` 对象，并验证返回网络的虚表类型。
2. 在固定版本 `IESNetwork+0x20` 处找到配置；配置 `+0xf8` 是解码后的 `std::string` 图。
3. 配置 `+0x08/+0x10` 分别是已加载的 BM buffer/长度，保存到私有目录。
4. 通过 `IESNetwork+0x108/+0x110` 获取实际 Interpreter/Session。
5. 使用导出的 `GetInputConfig`、`SetEngineInput`、`RunSession`、`GetEngineOutput` 执行相同张量输入。
6. 保存四路输入和四路输出，Python 强制检查名称、形状、有限数值及完整 trace。

这些偏移仅在两份已校验的 dylib 上使用，探针启动前固定 SHA-256：

- `libbytenn.dylib`: `febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863`
- `libcccreator.dylib`: `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`

原生 tensor view 是 72 bytes，数据指针偏移 24、dtype 偏移 36、名称偏移 48。
输入观察到 dtype 4、memory tag 1；输出 API 不初始化输入专用 memory tag，因此不把该垃圾值当作有效枚举。
输出仍必须通过 dtype、名称、精确形状和最大元素数检查。
当前探针复用分镜的进程内对象发现工具；不是任意模型的通用 loader，不能把去噪或人脸模型传入 matting 初始化入口。
启动原生库前会切换到私有输出目录，因为驱动会生成 `config_*.ini` 缓存；本次已把早期落在仓库根目录的缓存移回忽略目录。

容器 worker 独立解码的图与原生配置图，在去掉其额外前导 `E\\n` 后字节相等。
对应私有证据为 `container-scan-20260919/matting-native-graph-crosscheck.json`。
图解码一致仍不等于推理结果一致。

## 重跑与证据

在仓库工作目录编译：

```bash
/Library/Developer/CommandLineTools/usr/bin/clang++ \
  -std=c++17 -fobjc-arc -O2 \
  -isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
  -framework Foundation research/local-model-pytorch/matting_probe.mm \
  -o .local/jianying-model-pytorch/bin/matting_probe

RT="$HOME/Library/Application Support/QCut/PrivateRuntimes"
DYLD_LIBRARY_PATH="$RT/JianyingTransition/current/Frameworks" \
  .local/jianying-model-pytorch/bin/matting_probe \
  "$RT/JianyingTransition/current" \
  "$RT/JianyingMatting/current/Models/mattingmodel/tt_matting_video_gru_v1.0.model" \
  .local/jianying-model-pytorch/matting-native-new-run

/opt/homebrew/bin/python3 research/local-model-pytorch/matting_torch.py \
  --evidence .local/jianying-model-pytorch/matting-native-new-run \
  --out .local/jianying-model-pytorch/matting-candidate-new-run

/opt/homebrew/bin/python3 research/local-model-pytorch/matting_test.py
```

使用新的原生证据目录；探针拒绝复用已有 case/engine，避免旧 tensor 被误计为本次结果。
Python 导出命令在当前未通过的数值对照下返回 **1**，但保留候选和失败报告供研究。
`load_model(path)` 返回接收输入字典、输出字典的 `nn.Module`；加载成功不代表候选已被验证。

本次最终私有证据：

- `.local/jianying-model-pytorch/matting-native-cwd-20260919/probe.log`
- `.local/jianying-model-pytorch/matting-native-cwd-20260919/engine-0/graph-32.txt`
- `.local/jianying-model-pytorch/matting-native-cwd-20260919/engine-0/loaded-buffer.bin`
- `.local/jianying-model-pytorch/matting-native-cwd-20260919/case-{0,1,2}/tensors.tsv` 及相邻张量
- `.local/jianying-model-pytorch/matting-native-20260919/guard-checks.json`：私有目录边界、未知模型哈希和旧证据目录三个拒绝用例均返回 2
- `.local/jianying-model-pytorch/matting-candidate-20260919/candidate.pt`
- `.local/jianying-model-pytorch/matting-candidate-20260919/report.json`

报告保留外层源资产路径和 SHA、加载后 BM 路径和 SHA、候选路径和 SHA、回读检查及每个输出的误差。
这些权重、图、探针日志和原生张量全部留在忽略目录，不提交、不分发。

## 下一个数值关口

1. 先捕获第一个循环单元之前的实际特征、门卷积、Sigmoid、Tanh 输出，找出首个超容差位置。
2. 分别验证卷积累加、非线性近似和实际后端精度，不能仅根据 CPU/GPU 日志猜实现。
3. 保持 `1e-4` 门槛；不用放大容差把结果变绿。
4. 在单帧四路输出通过后，测试各自状态反馈的连续序列、reset 和同帧重放，再接预处理和产品链路。
