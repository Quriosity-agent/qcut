# Facefitting 子网的 PyTorch 恢复与 CPU 对照

日期：2026-09-19。仅限本机研究，不替换 QCut 生产路径，不分发厂商模型、原图或原生张量。

## 结论与边界

从已固定 SHA-256 的 `tt_facefitting_3d_v6.2` 文件中恢复了一个六层计算子网，导出独立 PyTorch bundle。
最终 `r4` 使用原生 ByteNN **强制 CPU** 后端，11 组同输入张量、全部声明输出通过数值对照。
这不是默认 GPU 产品路径的等价证明，也不是完整人脸拟合功能的端到端验证。

| 项目 | 已验证范围 |
| --- | --- |
| 输入 | `data`，CPU float32，逻辑形状 `[1,212]`；原生形状 `[1,1,1,212]` |
| 输出 | `Mul_9`，CPU float32，逻辑形状 `[1,442]`；原生形状 `[1,1,1,442]` |
| 结构 | 三层带偏置全连接，宽度 `212 -> 512 -> 512 -> 442`；前两层 ReLU，随后 Sigmoid 与标量乘法 |
| 权重 | OI 矩阵，逐层矩阵后跟 bias；共消费 598,459 个 float32，其中一个是输出缩放常量 `256` |
| Arena 边界 | 2,393,840 字节；末尾 4 字节未作为权重消费，报告保留此事实 |
| Bundle | 2,397,829 字节，含结构和 `state_dict`；回读使用 `weights_only=True, map_location="cpu"` |
| 测试 | 12 项无厂商数据的合成单测；11 组原生 CPU 张量对照 |

**尚未证明 212 个输入特征的业务含义、顺序、归一化方式，以及 442 个输出值的几何含义。**
不能仅因维数就认定输入是某套关键点或输出是 221 个二维点。
尚未接入人脸检测、裁剪、关键点输入、坐标恢复、真人图像、视频时序或编辑器 E2E。

## 来源与可追溯性

原始文件：

```text
~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/tt_facefitting_3d_v6.2_size4_md5054e6805e1f42ba6950a9ff678aedb49.model
```

容器解析复用 `model_containers.py` 与 `container_scan.py`。只接受已审计源文件和内嵌 BM 的哈希。
BM 起点是原文件偏移 1,908，长度 2,394,434；arena 起点为原文件偏移 2,426。
图先通过有界容器/计数校验，再由 `facefitting_torch.parse_spec` 严格检查此子网的连线、维数和算子参数。
报告的 `graph_recovery` 保留通用解码阶段的有限结论；最终对照结论看顶层 `status` 与每个 case 的 `native`。

| 对象 | SHA-256 |
| --- | --- |
| 原始源文件 | `b92958fdf04059110cae7899005b4550ad3ce95d00f5027e7235542971f06e93` |
| 内嵌 BM | `398bc6d292cc2bcec63797e1f5bcce33f63b5f0dde6007c358641587c89010dc` |
| 恢复图文本 | `03d9decadd2271115287b806c67a10eb4946144cde982c7e5c4832adfc5a56e1` |
| 原生 libbytenn.dylib | `1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0` |
| 最终 facefitting.pt | `e42f31bd9fc511d3a1326cd6fd4a0894bcae752e7f48db46bd8216e067657023` |

## 原生调用与后端区别

原生 oracle 使用本机 `JianyingShotSplit/current/Frameworks/libbytenn.dylib` 的 Thrustor 导出接口：

1. 构造 Thrustor，并在 `CreateNet` 之前调用 `ThrustorEnforceCPURuntime`。
2. 将本机恢复的图文本和 arena 传入 `CreateNet`，要求返回成功。
3. 查询 `GetForwardType`，必须为 `0`；写入 `native-runtime.json` 的 `forced_cpu=true`。
4. `SetInput` 的第一个整数是**字节数**，此处为 `212 * 4 = 848`，不是图像宽高。
5. 先 Extract 输入并逐字节核对回显，再 Inference，Extract 全部声明输出。

`bytenn_cpu` 命名空间不能证明执行后端是 CPU。
此 D 图在未强制 CPU 的早期探针中进入 GPU 路径，输出呈 FP16 精度特征，与 float32 PyTorch 对照失败；
`r2/report.json` 保留 `verification-failed`，最大绝对误差为 `0.236114501953125`。
这说明本机该调用方式的默认后端与强制 CPU 不同，**不代表已经追踪并验证产品所有调用点的后端选择**。
最终只声明强制 CPU oracle 的近似数值复现，不将 CPU 通过覆盖或改写为默认 GPU 通过。

## 最终对照结果

最终目录：

```text
.local/jianying-model-pytorch/facefitting-20260919-r4/
```

核心证据为 `report.json`、`native-runtime.json`、`oracle.log`、`facefitting.pt`。
每个 `case-*` 保存同一份 `input.f32`、原生输入回显、原生输出、PyTorch 输出和原生 shape。
所有输入回显逐字节一致，输出有限，每组比较全部 442 个分量，序列化前后参数及推理逐位相同。

11 组包含全零、全一、全负一、线性 ramp、四组 `[-1,1]` 随机输入，以及三组后加入的保留样本：
seed 303/509 的 `[0,1]` 随机输入、首尾分别为 `1/-1` 的脉冲输入。
这些是合成特征张量，不是真实人脸特征，也不能用来报告人脸拟合准确率。

- 11/11 通过；最大原始绝对误差 `0.0003204345703125`，约 `3.2044e-4`。
- 判定始终为 `atol=1e-4, rtol=1e-4`，没有放宽阈值。
- 当前比较调用为 `np.allclose(native, pytorch, ...)`，逐项条件是 `abs(native - pytorch) <= 1e-4 + 1e-4 * abs(pytorch)`。
- 因有相对项，最大绝对误差大于 `1e-4` 仍可通过；不能表述为“绝对误差小于 `1e-4`”。
- 误差除以输出缩放 `256` 后最大约 `1.2517e-6`，仅作诊断，不参与或替代原始输出的判定。
- `r3`、`r4` 是同一模型的不同验证批次，不能重复计入已转换模型数。

## 文件与重跑

| 文件 | 职责 |
| --- | --- |
| `facefitting_torch.py` | 严格图规格、权重切片、CPU PyTorch 网络、严格 bundle 回读 |
| `facefitting_export.py` | 固定来源导出、11 组输入、原生运行、逐例比较和结构化报告 |
| `facefitting_oracle.mm` | 本机 Thrustor 强制 CPU 同输入 oracle，无云端调用 |
| `facefitting_test.py` | 合成图/权重测试、来源和尺寸拒绝、回读、损坏证据的失败记录 |

在 QCut 工作区运行，使用一个新的空私有目录：

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/facefitting_test.py
/opt/homebrew/bin/python3 research/local-model-pytorch/facefitting_export.py \
  --oracle --out .local/jianying-model-pytorch/facefitting-rerun
```

省略 `--oracle` 只能得到 `recovered-native-unverified`，不能由自回读推导原生等价。
原生不可运行保持未验证；输出对照失败写 `verification-failed`。缺失、截断、NaN/Inf 张量、非法 shape
和输入回显不符，均留下 `passed=false` 与 `reason`；无有效误差时写 `null`，不写 Infinity。
误差计算先转 float64，避免有限 float32 极值相减溢出；最终报告使用 `allow_nan=False`。
合成测试还覆盖 shape JSON 中的 NaN/Infinity、空输入文件及相反符号 float32 极值。

仅使用 bundle 推理时，导入 `facefitting_torch.load_model(path=..., expected_sha256=...)`，
随后调用 `model({"data": tensor})["Mul_9"]`。无需安装 ByteNN，但依然需要本仓库的 Python 网络实现、NumPy 和 PyTorch。
加载器与 forward 严格限制此版本、CPU、float32 和固定形状，不是任意 ByteNN 图执行器。
所有权重、恢复图和对照张量仅保存在 `.local/jianying-model-pytorch/`，不提交、不发布。
