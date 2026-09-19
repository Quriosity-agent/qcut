# 单目标跟踪四子网 PyTorch 对照

## 结论与边界

2026-09-19，`single_object_tracking_v1.0.model` 内四个 ByteNN 子网均已转换到同一个独立 `.pt`，逐子网状态均为 `native-parity-passed`。计数是 **1 个原始源资产、4 个网络、1 个 bundle**，不是四个源资产。

每个原始尺寸子网执行 13 个同输入原生 CPU 样例，包含 7 个 holdout 标签样例；其中 4 个 `holdout-new-*` 是数值规则确定后新增的独立验证。全部声明的终端输出、输入回读、输出形状、dtype、量化指数、有限值和 state/forward 往返均已检查。固定 `atol=rtol=1e-4`，整数输出额外要求逐元素完全相等。

本结论仅覆盖独立子网，不包含图像预处理、跨子网相关运算、框解码、跟踪状态机或视频序列。产品当前 Bingo 使用另一套 `.dat`，本工作不证明产品跟踪 E2E，也不证明 DefaultGPU 后端。前缀图仅用于定位语义，不计入最终整图通过证据。

## 私有产物

所有原始/派生图、权重、tensor、原生程序、日志和报告均在已确认忽略的 `.local/jianying-model-pytorch/` 下。研究目录只有作者代码、合成测试和本文，不收录厂商图或权重。

- 原始源：`~/Library/Application Support/QCut/PrivateRuntimes/JianyingTracking/current/Resources/models/single_object_tracking_v1.0.model`
- source SHA256：`7951eba5af0daa1f78e3962073b938169171d102107ed1585a5c6851adf3aab2`
- 原生库：`~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib`
- runtime SHA256：`1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`
- bundle：[tracking.pt](../../.local/jianying-model-pytorch/tracking-final-20260919/tracking.pt)
- artifact SHA256：`13bd6063507b1435e684d142681d3a7d4784ed15e769902cfa6aaa5d6e245ea2`
- 汇总：[report.json](../../.local/jianying-model-pytorch/tracking-final-20260919/report.json)
- 无厂商访问回放：[portable-smoke.json](../../.local/jianying-model-pytorch/tracking-final-20260919/portable-smoke.json)

汇总的 `networks[]` 每项分别包含稳定 `network_id`、源/图/子容器/arena/runtime SHA、共同 artifact 路径与 SHA、输入输出 schema、backend/scope、逐 case 和逐 output 的 `passed`。每项也单独保存在 `<network>/report.json`。根状态只有四网均通过才标为通过，不会用部分成功掩盖缺网。

| 加载名称 | network_id | 层数 | 状态 / 样例 | 最大绝对误差 |
| --- | --- | ---: | --- | ---: |
| `kernel` | `bm-offset-0002a23b` | 16 | native-parity-passed / 13 | 0 |
| `search` | `bm-offset-00058529` | 14 | native-parity-passed / 13 | 0 |
| `head` | `bm-offset-000867c4` | 35 | native-parity-passed / 13 | 2.682209014892578e-7 |
| `backbone` | `bm-offset-0000f5ca` | 82 | native-parity-passed / 13 | 0 |

## 加载协议

`tracking_torch.load_models(path=..., expected_sha256=...)` 返回名称到 `nn.Module` 的字典；`tracking_torch.load_model(path=..., name=..., expected_sha256=...)` 返回指定子网。`name` 必须明确，不能自动猜测。

模型调用为 `model({"data": tensor})`，返回具名输出字典。公开输入输出与 NPZ 均为 **NCHW CPU**；原生描述符为 **NWHC**，底层内存 **NHWC**。不得把原生维度顺序直接当成内存顺序。

| 名称 | 输入 `data` | 输出 |
| --- | --- | --- |
| `kernel` | int16 `[1,144,16,16]`，shift=8 | `cat5`: int16 `[1,288,6,6]`，shift=9 |
| `search` | int16 `[1,144,32,32]`，shift=8 | `cat5`: int16 `[1,288,30,30]`，shift=8 |
| `head` | float32 `[1,288,25,25]` | `Slice_41`: float32 `[3125,1,1,1]`；`Reshape_46`: float32 `[3125,4,1,1]` |
| `backbone` | int16 `[1,3,255,255]`，shift=6 | `concat2`: int16 `[1,144,32,32]`，shift=8 |

定点接口接受原始整数，范围 `[-2047,2047]`；真实数值是 `raw * 2**(-shift)`。加载器不隐式量化 float32，不替用户猜图像归一化规则。浮点和整数输入不可互换；额外输入、错误 dtype/形状、越界整数和非有限值均拒绝。

```python
from pathlib import Path
import numpy as np
import torch
from tracking_torch import load_model

root = Path(".local/jianying-model-pytorch/tracking-final-20260919")  # relative to the qcut/ checkout
model = load_model(path=root / "tracking.pt", name="kernel")
case = root / "kernel/case-holdout-new-asymmetric"
with np.load(case / "inputs.npz", allow_pickle=False) as fixture:
    inputs = {key: torch.from_numpy(fixture[key].copy()) for key in fixture.files}
with torch.inference_mode():
    outputs = model(inputs)
```

每网每例都有 `inputs.npz`、`pytorch-outputs.npz`、`native-outputs.npz`，键名与 schema 一致。独立进程回放通过审计钩子禁止访问 `PrivateRuntimes`、加载厂商库和启动子进程，使用 `weights_only=True` 回读 bundle；52 例全部与已导出 PyTorch 输出逐元素相同，且仍通过原生对照。运行只需 PyTorch/NumPy 和作者实现，不需源 `.model`、私有图文件或厂商动态库。

## 已确认的语义

- B 格式卷积权重按两个 12-bit 值占三个字节恢复，零点为 2047；偏置是 int32。权重、偏置各按声明指数参与定点运算，arena 末四字节必须与图 header 身份值一致。
- 普通卷积权重为 OHWI，depthwise 权重为 HWC；公开执行转换为 PyTorch 卷积布局。双精度执行有限整数积的精确累加，随后复现 int32 范围和定点舍入，输出饱和到 `[-2047,2047]`。
- Concat 对各输入指数做转换。残差相加先共同对齐、相加，再执行一次舍入；不能分别舍入后再相加。
- 浮点 Reshape 作用于 NCHW 逻辑顺序；已审计的 Transpose 序列对应 NHWC 存储轴变换。
- `head` 两通道 Softmax 的 ARM64 CPU 向量路径使用指数近似和 reciprocal estimate，再用 `1-p0` 得到第二通道；尾部使用标量路径。普通 `torch.softmax` 并不等价。本实现显式复现该固定运行库数值规则，只接受已审计两通道向量布局；不声称通用 ONNX Softmax 或其他架构相同。
- `ThrustorEnforceCPURuntime` 在 `CreateNet` 前调用，并核实 `GetForwardType()==0`。`CreateNet` 接收解码图字符串与 arena 内存；`SetInput` 首个整数是字节数，定点输入按 int16 原样传递并逐字节回读。

最终原生运行仅提取终端输出，不依赖内存池可能复用的中间 blob。`tracking_diagnose.py` 另存前缀图及明确诊断范围；`tracking_probe.py` 的中间输出不作为整图证据。

### 与 Matting 数学核的协调结论

按父任务要求只读对比了 `matting_cpu_math.py`，未修改其代码。指数近似的全部系数、范围缩减、FMA 舍入规则相同；reciprocal 的两种整数/浮点写法在有效分母域等价。对 `torch.linspace(-87,88,200001)` 的指数输出，以及对应 `1+exp` 分母的 reciprocal 输出，均确认逐位相同。

不能直接合并整个 Softmax 包装器：tracking 限定 `[N,2,1,1]` 并处理四行向量块后的标量尾部；matting 包装器接受一般双通道 NCHW 并对全部像素用向量近似。另一个显式边界是 matting 的 reciprocal 接受正无穷并返回零，而 tracking 当前拒绝非有限分母。未来可先合并 exp/reciprocal 原语，保留模型各自的布局、尾部及输入校验，再重跑双方真实 artifact 全样例。

随后已与现有 Carver 交换只读结论：双方系数和有限分母域计算一致，但其 matting runtime SHA 为 `febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863`，不是 tracking 使用的运行库。Carver 报告其原语已对照通过、temporal 整图仍因上游误差跨越近似桶边界而失败；本四网结论不延伸到 matting。双方实现均未因协调而修改。

Carver 的补充只读比较也确认：200,001 个更宽范围 exp 样本、98,304 个涵盖 256 桶/128 指数/桶边界偏移的正有限 FP32 reciprocal 样本，以及经布局映射的 4,096 行双通道数据，分别逐位相同。共用候选范围仅为 exp/FMA/reciprocal 核心，不能因此合并模型特定适配层或清除来源 pin。

## 测试与复现

18 项合成测试通过，覆盖权重解包边界、定点舍入/饱和、残差舍入时机、非正方形 crop/布局、depthwise 权重顺序、多个输出、reshape/transpose、CPU reciprocal 近似、损坏/截断 arena、未知算子/参数、错误输入、原生描述符/有限值/输入回读、holdout/全输出判定和严格 state/forward 回读。

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/tracking_test.py -v
/opt/homebrew/bin/python3 research/local-model-pytorch/tracking_portable_test.py \
  --report .local/jianying-model-pytorch/tracking-final-20260919/report.json
/opt/homebrew/bin/python3 research/local-model-pytorch/tracking_export.py --oracle \
  --out .local/jianying-model-pytorch/tracking-new-empty-run
```

原生编译固定使用 CommandLineTools 的 clang++ 与显式 SDK，cwd 固定到对应私有运行目录。导出拒绝复用非空目录，保留失败尝试而不覆盖旧证据。本轮没有修改共享 infer/progress/oracle、产品/editor 路径、用户草稿；没有 commit/push，也没有新建代理。
