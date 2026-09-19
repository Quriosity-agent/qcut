# OCR 识别器第四阶段：完整 Logits 原生对照

日期：2026-09-19。范围是 `general_ocr_rec_fp16_v2.4`，不修改检测器、共享 oracle、产品后端或统一入口。
延续 [第三阶段](PHASE3-20260919.zh-CN.md)的私有研究边界：源文件、解码图、权重、PT/ONNX、原生张量与图片只在忽略目录 `.local/jianying-model-pytorch/`。

## 验收结果

**1 个源资产、1 个识别网络、1 个新增通过的 PyTorch 包。**
完整原始 269 层计算图，未删层，未修改输入尺寸；20/20 完整终端输出对照通过。这里的“通过”不包含字表映射、CTC 解码或产品 OCR 流程。

| 项目 | 实测结果 |
| --- | --- |
| 输入 | `data`，CPU FP32 NCHW `[1,3,32,512]` |
| 唯一完整终端输出 | `embedding`，FP32 NCHW `[1,10537,1,128]` |
| 权重数 | 3,275,993；严格 state 内容哈希，重载逐值一致 |
| 原生后端 | 固定哈希 `libbytenn`；创建前强制 CPU，回读 `forward_type=0` |
| 输入回读 | 所有 case 原生输入逐字节一致，NWHC 维度一致 |
| 容差 | 每个元素 `abs(actual-native) <= 1e-4 + 1e-4*abs(native)`，没有放宽 |
| 完整输出比较量 | 26,974,720 个 FP32 元素，全部通过 |
| 最大绝对误差 | `0.00055694580078125`；其对应数值适用同一相对误差项 |
| 最差误差/允许误差比值 | `0.46257996093400566`，全部低于 1 |
| 按类 argmax | 20/20 case 全部 128 个位置相同；不是已解码文本 |
| 输入覆盖 | 9 个数值输入、11 张真实渲染文字图，其中 18 个标记 holdout |
| 单测 | 新增 27 项；加检测器 20 项回归，共 47/47，在 Python 3.14 和私有 3.12 环境均通过 |
| 独立进程回放 | CPU 1/2/4 线程各 20/20，与冻结 PT 逐值一致，重比原生也全部通过，共 60 次推理 |

文字图包括中文、英文、中英数字混排、反白、低对比、模糊、小字号；已查看中英混排、中文、反白英文 PNG，字形正常。
PNG 到张量使用研究用 `RGB / 127.5 - 1`，不声称恢复了原产品预处理。
只有 PNG → 明确记录的张量 → 完整原生/PyTorch logits 比较链条通过，**不是图片到文本 E2E 通过**。

## 修复与证据

### 1. 融合激活 2 是 Hard-Sigmoid8

旧候选把融合激活 2 当成 ReLU6。首个失败层是 SE 门控，其实际语义是 `clamp(x+4,0,8)/8`。
单独修复后，基础数值输入通过，但完整文字图只通过 10/15，不能据此验收。

### 2. 空间归约顺序是数值契约的一部分

用原生中间张量作输入，16 个 `ReduceSum` 层全部与沿 HW 顺序逐项 FP32 累加一致。
普通 `torch.sum`、双精度总和和多累加器重排都不逐值相同，`torch.cumsum` 也不能代替这个顺序。
移植实现使用 TorchScript 顺序循环；ONNX 不能擅自折叠为普通 `ReduceSum`。

### 3. 卷积的 FMA 顺序

对原生中间输入单独诊断，空间卷积遵循 HWC 顺序和 bias-first，1x1 路径使用 bias-last 的顺序累加。
`ocr_rec_numeric.py` 以显式乘加和 FP32 舍入保留该执行顺序，并覆盖 depthwise。
诊断中首卷积、`down_channels` 和 `conv1d` 的前 8 个输出通道逐值一致；这只是定位样本，不写成所有卷积全域逐位证明。
完整模型仍以全部终端输出的固定容差作为验收标准。

### 4. Sigmoid 不是标准 Exp 的直接替代

新增的全新混排留出样本使上一版 ordered 候选仍然 19/20，暴露了 Sigmoid 内部近似的累积差异。
相同原生输入下，当前固定运行库使用已有 `tracking_numeric` 的指数估计与 reciprocal estimate，再执行两次带融合乘减的倒数细化。
六个 Sigmoid 层共 68,608 个输出在诊断样本中逐值一致。不能直接换成 `torch.sigmoid` 或 ONNX 标准 `Sigmoid`。
该数学实现复用现有 helper，没有改动跟踪模块，也不外推到其他库版本/GPU。

### 5. 原生 Half 展开保持已证明的规则

沿用检测器的固定运行库 FP16 展开，包括 SIMD 次正规数行为和 scalar tail。
原生完整展开 arena 与 Python 参数逐字节一致；全部有限 half 模式和尾部证明仍执行。
原生 loader 的变换是去除 E 标记、展开 payload、保留 graph stamp，不改拓扑。

## 版本门槛与失败历史

不能给旧候选换状态标签就冒充新实现。三个旧 format 均不能通过新加载器。

| Format | 执行配置 | 实际状态 |
| --- | --- | --- |
| `...-v1` | 原 ReLU6 候选 | 原第三阶段失败；`load_model(..., allow_unverified=True)` 仅研究用途 |
| `...-v2` | hard8 + 通用卷积/求和/Sigmoid | 两个 quick 输入通过，但文字图验收失败；完整 10/15 |
| `...-v3` | hard8 + ordered FMA/求和 + 通用 Sigmoid | 19/20，仍失败 |
| `...-v4` | hard8 + ordered FMA/求和 + pinned Sigmoid | 20/20 完整输出通过 |

v2/v3 仅由 `load_candidate_model(..., allow_unverified=True, ordered=...)` 加载，默认拒绝。
新入口为 `ocr_rec_torch.load_validated_model`，严格检查 format、execution profile、源/图/运行库哈希、内容 state 哈希、dtype、形状、有限值。
可额外固定 artifact SHA；`torch.load(..., weights_only=True)`，不读取原始模型或加载厂商库。
合成加载测试使用合成权重，不是把 mock 结果充当真实 oracle 证据。

## 交接给 ONNX

```python
from ocr_rec_torch import load_validated_model

model = load_validated_model(
    path=".local/jianying-model-pytorch/ocr-rec-phase4-r4/ocr-recognizer-logits.pt",
    expected_sha256="74a35a9cbde6bdcdb0f8dacdebf85071ac4927f03aafb7bea44f0e18845534ff",
)
outputs = model({"data": input_nchw_float32})
```

- Format：`qcut-private-ocr-recognizer-logits-pytorch-v4`
- Profile：`ocr-rec-cpu-hard8-ordered-fma-pinned-sigmoid-v4`
- Source SHA：`d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac`
- Runtime SHA：`1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`
- State SHA：`17914cad51bd7196ec36757feed130adb4025f8726183bd724235eb489759be7`

每个 `case-*` 目录有 `inputs.npz`、`native-outputs.npz`、`pytorch-outputs.npz`，键名就是 blob 名。
优先复测 `original-zeros`、`original-holdout-7919`、`original-holdout-rendered-fresh-mixed`；然后跑全部 20 个冻结 case。

ONNX 导出需要保留顺序循环、Double 中间乘加到 FP32 的舍入，以及 exp 位操作、`frexp`/倒数估计的实际语义。
普通 Conv/ReduceSum/Sigmoid 替换不能仅凭形状一致就接受。任何导出侧改写都要完整比对 native 与冻结 PT 两份输出，Linux 侧不挂载 PT 或原始权重。
本子任务没有修改父任务 ONNX/统一入口/台账。父任务随后完成 v4 ONNX 导出，本子任务再完成下述全部冻结样本模型级验收；父任务提供的 Linux 完整报告也已核对，结果见后文。

### ONNX 全部 20 个冻结样本回放

新增 `ocr_rec_onnx_replay.py`，第三方依赖只有 NumPy 和 `onnx_infer` 间接使用的 ONNX Runtime，不导入 Torch、转换器或厂商 runtime。
使用父任务交付的 `onnx-phase4/ocr-rec-v4/contract.json`，逐个运行原 r4 的 **全部 20 个 inputs.npz**，分别与完整 native/PT NPZ 比较。
没有重新运行原生或 PyTorch，也没有把 argmax/CTC 一致作为完整 logits 比较的替代。

| 比较 | 完整输出 | 最大绝对误差 | 最大误差/允许误差 | argmax 不一致 |
| --- | --- | --- | --- | --- |
| ONNX 对冻结 native | 20/20，26,974,720 元素 | `0.00061798095703125` | `0.35632523774196917` | 0/2,560 位置 |
| ONNX 对冻结 PT | 20/20，26,974,720 元素 | `0.000255584716796875` | `0.32988262495452947` | 0/2,560 位置 |

仍为 `atol=rtol=1e-4`，每个终端值都检查；没有筛选位置、类别或 case。两组比较均非 bitwise exact。
实际平台 `macOS 26.6.2 arm64`、NumPy `2.3.5`、ORT `1.30.0`，CPUExecutionProvider、图优化关闭、2 个 CPU 线程。
Session 创建 `1.812 s`；20 次推理合计 `7.764 s`，中位数 `0.3874 s`，不包含参考文件读取和比较。
进程中没有加载 Torch/厂商 helper 模块；这不是 OS 沙箱或“机器没有安装 Torch”的证明。

- ONNX SHA：`ddda8bc84346e8474fafca1c4a423a5bc7f60693a31b277cad85d6d59c999812`
- Contract SHA：`7b623731761eceda6f697ec33a7b432f115715ccf8eaf4b5d8a33b5800d9ca07`
- r4 原报告 SHA：`abfbd51550dc9a81b47e42fb914bce940371d08d64a3d417d31e6858ac97022e`
- 完整回放报告：`ocr-rec-phase4-onnx-replay/report.json`

报告记录每份 input/native/PT NPZ、ONNX 输出 NPZ 的 SHA，校验输入内容与原报告的 NHWC SHA 一致，并检查模型、contract、原报告及 case 文件在运行中没有改变。
输出只写新建私有目录；源 report 必须是固定 v4 包的通过记录且包含 20 个唯一成功 case。任何单个 case 出错仍保留失败报告，不会跳过失败来计数。

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/ocr_rec_onnx_replay.py \
  --run .local/jianying-model-pytorch/ocr-rec-phase4-r4 \
  --contract .local/jianying-model-pytorch/onnx-phase4/ocr-rec-v4/contract.json \
  --out .local/jianying-model-pytorch/ocr-rec-new-onnx-replay
```

目标 OS 可以显式提供 `--private-root /mounted-private-root`，再传该目录下的 run/contract/out；脚本忽略原报告中的宿主机绝对 artifact 路径，不需要挂载 `.pt` 或厂商权重。
**结论限于 macOS ARM64 与下述 Linux aarch64 的模型级 ONNX 回放，不宣称 Windows、其他架构、文字解码或产品 OCR E2E 通过。**

### 浅挂载路径修复与回归

父任务首次挂载脚本到 `/runner/ocr_rec_onnx_replay.py` 时，默认根目录的 `parents[2]` 在模块导入阶段触发 `IndexError`，甚至还没有解析显式 `--private-root`。该次运行没有生成样本结果，不能计作模型失败或通过。
现已改为 `(Path(__file__).resolve().parent / "../../.local/jianying-model-pytorch").resolve()`，没有改动模型、输入、比较算法或容差。

`ocr_rec_onnx_replay_test.py` 共 **9/9 项通过**：完整值比较、不能用 argmax 掩盖超限、argmax 仅作诊断、固定相对容差、shape/dtype/finite 检查、恰好 20 个唯一通过样本、旧候选/错误资产拒绝、私有路径边界，以及浅路径导入回归。
浅路径回归通过标准 importlib loader 加载实际脚本，将模块 `__file__` 设为 `/runner/ocr_rec_onnx_replay.py`，再验证显式 mounted root 能正常解析；这是导入回归，不冒充 Linux 模型运行。

```sh
/opt/homebrew/bin/python3 -m unittest discover \
  -s research/local-model-pytorch -p 'ocr_rec_onnx_replay_test.py' -v
```

### Linux 完整回放：父任务报告已核对

浅路径修复后，父任务完成全部 20 个样本，本子任务已读取并核对 `ocr-rec-linux-phase4/report.json`：

- 状态 `onnx-frozen-replay-passed`，20/20 case；对 frozen native 和 frozen PT 的完整终端输出均全部通过 `atol=rtol=1e-4`。
- 两份参考各比较 26,974,720 个元素；最大误差/允许误差分别为 `0.35632523774196917` 和 `0.32988262495452947`，argmax 各 2,560 个位置零差异。
- 平台 `Linux 6.12.76-linuxkit aarch64 / glibc 2.41`，Python `3.13.5`、NumPy `2.5.3`、ORT `1.30.0`，CPUExecutionProvider，2 线程、图优化关闭。
- 单次推理 `0.4413–0.4787 s`，中位数 `0.4488 s`，20 次合计 `9.0079 s`；session 创建 `2.2220 s`。
- ONNX、contract、原始 r4 report SHA 与上述 macOS 回放相同；报告确认运行前后证据哈希未变、未加载 Torch/厂商 helper 模块。

父任务的运行说明为无 Torch、断网的隔离 Linux 镜像。Linux 侧只加载 ONNX 模型和冻结 NPZ 输入/参考输出，不读取 `.pt` 或厂商模型；报告明确 `native_rerun=false`、`pytorch_rerun=false`。
这里的“对 native/PT 比较”指读取已有 NPZ 参考张量，不是 Linux 上重新执行 native/PT，也不提升为图片到文本或产品 E2E 结论。

## 私有证据索引

以下路径相对于 `.local/jianying-model-pytorch/`。

| 证据 | 路径 |
| --- | --- |
| 最终通过包与原生报告 | `ocr-rec-phase4-r4/{ocr-recognizer-logits.pt,report.json}` |
| 独立进程内 20 个冻结 case 回放 | `ocr-rec-phase4-portable/report.json` |
| 1/4 线程回放 | `ocr-rec-phase4-portable-{1thread,4thread}/report.json` |
| macOS ONNX 全部 20 个冻结 case | `ocr-rec-phase4-onnx-replay/report.json` |
| Linux ONNX 全部 20 个冻结 case | `ocr-rec-linux-phase4/report.json` |
| 原始 v1 失败 | `ocr-rec-r1/report.json` |
| v2 完整失败 | `ocr-rec-phase4-r2/report.json` |
| v3 完整失败 | `ocr-rec-phase4-verified/report.json`，目录名不是状态，里面仍为 `verification-failed` |
| 完整图中间张量 | `ocr-rec-phase4-trace-{r1,r2}/report.json` |
| 原生输入下归约顺序诊断 | `ocr-rec-phase4-reduction-r1/report.json` |
| 原生输入下卷积顺序诊断 | `ocr-rec-phase4-convprobe-r1/report.json` |
| 原生输入下 Sigmoid 数学证明 | `ocr-rec-phase4-sigmoid-r2/report.json` |

独立回放在新 Python 进程内阻止 Python 层厂商文件访问、oracle helper 导入、ctypes 动态库加载、子进程和 socket.connect。
同时逐值比较冻结 PyTorch 输出，并用固定容差重比全部原生输出。此检查不是 OS 沙箱、完整断网证明或跨平台证明。

复现使用新的私有空目录，不复用旧输出：

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/ocr_rec_export.py \
  --out .local/jianying-model-pytorch/ocr-rec-new-native-run --oracle
/opt/homebrew/bin/python3 research/local-model-pytorch/ocr_rec_verify.py \
  --run .local/jianying-model-pytorch/ocr-rec-phase4-r4 \
  --out .local/jianying-model-pytorch/ocr-rec-new-replay --threads 2
/opt/homebrew/bin/python3 -m unittest discover \
  -s research/local-model-pytorch -p 'ocr*test.py' -v
```

## 字表与真正文字 E2E 的剩余工作

已只读检查该源 BM 容器和当前私有 runtime 的 manifest。容器除图与 half arena 外只有 8 字节小 section 和 trailer；manifest 中 OCR 相关独立资产只找到检测、识别两个 `.model`。
`libcccreator` 有 `ILASDK::GeneralOCR`/`AlgorithmGeneralOCR` 包装符号，但没有由这些证据确定 10,537 通道的字符顺序、blank ID、CTC 合并规则或真实前处理。
没有取另一个版本的字典凑数，没有用预先已知的 fixture 文本冒充推理结果。

后续需要找到并固定相同版本的字符表和调用端实现，验证完整索引映射及 blank，再串接检测框后处理、裁剪/旋转/缩放、识别、CTC 和文本合并。
至少覆盖重复字、空格、标点、中英混排、数字金额、模糊、竖排与空图；最终再对剪映可见 OCR 和 QCut 场景验收。
