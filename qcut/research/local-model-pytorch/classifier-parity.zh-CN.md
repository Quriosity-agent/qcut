# C73 / Dance 分类网络：本机 CPU 神经输出对齐

## 结论与范围

2026-09-19，本机两个源资产中的两个 118 层 BM 子网络均达到
`native-parity-passed`。每个网络都有 15 个原始固定尺寸样本，包含 6 个 holdout，
逐元素比较所有声明的最终输出，固定 `atol=1e-4, rtol=1e-4`。

| profile | 神经最终输出 NCHW | 参数/常量 float 数 | 完整原生样本 | 最大绝对误差 |
| --- | --- | ---: | ---: | ---: |
| `c73` | `Sigmoid_271: [1,73,1,1]` | 1,586,634 | 15/15 | 0.000012814998626708984 |
| `dance` | `Div_275: [1,1,1,1]` | 1,512,834 | 15/15 | 0.0000028014183044433594 |

两份网络输入都为 `data`，CPU float32、NCHW `[1,3,224,224]`。
不接受动态尺寸、批次改变、非有限输入或其他 dtype/device。
这不是图像分类准确率、剪映 UI、脚本处理链或 GPU 一致性认证。

## 来源与私有制品

仓库根目录为 `/Users/peter/Desktop/code/qcut/qcut`。下述相对路径均相对该根目录。
所有原始子图、派生探针图、权重、输入、输出、原生日志及报告均保留在 git-ignored
`.local/jianying-model-pytorch/`，不进入产品、不分发源模型。

### C73

- 源文件：`~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/c73_v1.0_size0_md5726b5931800d3f3599ebf4cf617a229d.model`
- source SHA256：`20e49208c0ac7f2b167d3ea1024966f1418fd35bfae7fbb3fd2f8b000287d1cf`
- embedded BM SHA256：`0062d0feb383ba8b3f6c883ec5028c130e16cf404d74857ad46b55e55754c099`
- decoded graph SHA256：`930274596b824174b5f5575b9102b11bedc9192b4242a549fbaa3beda34f051e`
- artifact：`.local/jianying-model-pytorch/classifier-c73-20260919-verified/c73.pt`
- artifact SHA256：`821242daffa3aee05935c3896602f9d314c3643dee2d48638582a15b66a9197a`
- 原生报告：`.local/jianying-model-pytorch/classifier-c73-20260919-verified/report.json`
- 无厂商运行时回放：`.local/jianying-model-pytorch/classifier-c73-standalone-verified/report.json`

### Dance

- 源文件：`~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/dance_detection_js_v1.0_size0_md5dc53a9d99f63bcbfd576d99f7db7ac17.model`
- source SHA256：`ca436a5031aa853aa2becd1690e221c77278f84b6d54198485fe2a624e738565`
- embedded BM SHA256：`063ac20a5dbe020541e503b3d57d3db9116fd0cf4ed97e254958571a8daab820`
- decoded graph SHA256：`2e314c0e6fd4e8362e819caae61ebf6293a95c5adab59da48ae13e6a06b57a4f`
- artifact：`.local/jianying-model-pytorch/classifier-dance-20260919-verified/dance.pt`
- artifact SHA256：`8f289581445dd1ba7ab349a702ef0d7171d3d7d1e3141f690450dd7b4402b28c`
- 原生报告：`.local/jianying-model-pytorch/classifier-dance-20260919-verified/report.json`
- 无厂商运行时回放：`.local/jianying-model-pytorch/classifier-dance-standalone-verified/report.json`

两者固定使用 `JianyingShotSplit/current/Frameworks/libbytenn.dylib`，runtime SHA256：
`1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`。
bundle 的 source/BM/graph/runtime 哈希、执行语义标识、state 内容指纹均由加载器校验；
调用方也可传 `expected_sha256` 锁定整个制品文件。

## 实际恢复的执行语义

没有套用 GhostNet 或其他现成网络猜测权重。执行器逐节点消费真实图字段和权重 arena，
对未观察到的操作、字段、激活参数、连接、尺寸或多余/不足权重直接拒绝。

- 普通卷积权重为 OHWI，转为 PyTorch OIHW；深度卷积为 HWC，转为 C1HW；dense 为 OI。
- 融合激活标志 `0` 为不激活，`1` 为 ReLU，`2` 为下述 hard sigmoid。
- 这里的 hard sigmoid 为 `clamp(x + 4, 0, 8) / 8`，hard swish 为 `x * hard_sigmoid(x)`。
  图中显式除数为 8，不能套用常见除数 6。SE 的融合激活也经原生探针确认使用该公式。
- ReduceSum 按空间维求和，再除以从 arena 读取的 scalar；不能直接改成空间均值。
  原始常量不保证等于当前空间面积。末端全局池化另按实际 AVE/GLOBAL 字段执行。
- 一条输入、118 条计算节点；从生产/消费关系得出全部终端输出，而非只比较选中的 top-1。
- arena 的最后 4 字节不作为权重读取，属于未解释尾字段，不假设它们为零。
  源/BM 哈希限定原始内容；所有计算权重必须恰好消费完。

额外为每个网络建立 18 个派生前缀图，将被检查节点变为真正终端输出。
全部 18/18 通过同一容差，覆盖卷积、hard swish、深度卷积、归约/除法、SE、残差、
全局池化、reshape、dense 和最终激活。没有把原图中可能复用内存的任意中间 Extract
当作可信张量。派生探针只用于诊断；15 个主样本使用未修改的完整原图。

## 原生与独立加载证据

复用父任务的 `bytenn_oracle.py` / `.mm`，未修改该公共帮助器。
其 CPU oracle 在 CreateNet 前调用 `ThrustorEnforceCPURuntime` 并检查
`GetForwardType == 0`；CreateNet 收到图字符串与 arena 指针，SetInput 的第一个整数是字节数。
原生尺寸顺序为 NWHC，内存为 NHWC，Python 交换接口为 NCHW。

每例保留 request、response、精确输入 echo、原生输出、运行时/图/arena/oracle 哈希与日志。
输出须尺寸正确、字节数正确且全为有限值。`cases[].passed` 汇总逐输出比较、有限检查与
保存/加载后的逐位 forward 一致性；空样本、漏输出或原生执行失败不会通过。
报告同时记录完整 state roundtrip、holdout 身份和 authored code 哈希。
父任务可直接保留现有 `backend`、`scope` 和 `schema` 字段；`scope` 为
`original-fixed-shape-neural-output-only`，后端明确为 ByteNN enforced CPU / PyTorch CPU float32。

样本包括全零、正/负常数、斜坡、非对称通道、4 个独立随机种子、2 个正态 holdout、
边缘/通道脉冲、棋盘格及语义修复后才加入的 2 个随机 holdout。

`classifier_verify.py` 在独立进程内先加载通用 NumPy/PyTorch，再禁止厂商文件读取、
厂商辅助模块导入、`ctypes.CDLL` 和 `subprocess.Popen`，从 `.pt` 回放冻结输入。
两份最终制品均 `standalone-replay-passed`：15/15 全输出逐位一致，state 内容指纹完全一致。
此阻断是依赖审计测试，不是面向恶意代码的安全沙箱。

## 计数与去重

贡献是 **2 个源资产 / 2 个不同权重的神经子网络 / 2 个 .pt bundle**。
两个图共有前 117 个节点的相同拓扑（含输入，即 116 个神经节点），共享拓扑 SHA256：
`6c2e505dde8455dd8fd3cda55c9618c0477089d04b03a4b0c82904feaa9a6108`。

但该前缀的 state SHA256 不同：C73 为
`8fa29ec056716d20a37d6c906e13edc44d7cee5c702f9cacbe19479445bb523e`，dance 为
`7157578a142f7be6e70027a06f0fd21638a2023b0a5ea9e5dd0b9e8f6879985b`。
因此只能复用转换器/拓扑实现，不能把实际带权重计算去重成一个网络。
18 个前缀探针不计入新增模型数量。

## 失败历史与未验证部分

- `classifier-c73-r1` 在假设 arena 尾字段必须为零时主动拒绝；没有宣称推理通过。
- `classifier-c73-r2/report.json` 为明确失败记录：采用常见 hard6/ReLU6 假设时完整输出偏差过大。
  以第一个随机样本的前缀终端探针定位 hard8 和融合 hard sigmoid 后修复，未放宽容差。
- `classifier-c73-r3`、`classifier-dance-r1` 是修复后的早期验证；最终只交付带 execution profile
  与 state 内容指纹校验的 `*-20260919-verified` 制品。旧候选缺少新加载格式要求，应被拒绝。
- `*-20260919-final` 已通过相同 15 例；之后仅补单通道 depthwise multiplier 的拒绝条件，
  在 `*-20260919-verified` 重新执行全部 native/前缀/独立回放，制品 SHA256 未变。
- 两个脚本均另有 resize、RGBA 到 RGB 和线性归一化。本次输入已是神经网络张量，
  没有验证其图像算子与颜色/采样端到端行为。
- C73 的阈值筛选、top-k 与类别映射不在本次验证内；dance 的最近十帧滑动均值、清缓存和
  上层判定也不在本次验证内。神经单帧标量不能直接冒充最终时间平滑 confidence。
- 不声称 DefaultGPU、动态尺寸、不同源版本或不同 native runtime 的等价性。

## 父任务集成

本任务只增加 `classifier_torch.py`、`classifier_export.py`、`classifier_verify.py`、
`classifier_test.py` 与此文档；没有修改 infer/progress/公共 oracle/产品/editor/草稿。

```python
import torch
from classifier_torch import load_model

model = load_model(
    path="/Users/peter/Desktop/code/qcut/qcut/.local/jianying-model-pytorch/classifier-c73-20260919-verified/c73.pt",
    expected_sha256="821242daffa3aee05935c3896602f9d314c3643dee2d48638582a15b66a9197a",
)
with torch.inference_mode():
    outputs = model({"data": torch.zeros((1, 3, 224, 224), dtype=torch.float32)})
```

同一个 `load_model(path=...)` 支持两个 profile，内部始终
`torch.load(weights_only=True, map_location="cpu")`，不依赖 vendor runtime、源容器或外部图文件。
输入名称/尺寸在 `model.inputs`，输出名称在 `model.output_names`，各张量 NCHW 尺寸在
`model.shapes`。bundle format 为 `qcut-private-classifier-pytorch-v1`。

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/classifier_test.py
/opt/homebrew/bin/python3 research/local-model-pytorch/classifier_export.py \
  --profile c73 --oracle --probes \
  --out .local/jianying-model-pytorch/classifier-c73-new-run
/opt/homebrew/bin/python3 research/local-model-pytorch/classifier_export.py \
  --profile dance --oracle --probes \
  --out .local/jianying-model-pytorch/classifier-dance-new-run
/opt/homebrew/bin/python3 research/local-model-pytorch/classifier_verify.py \
  --run .local/jianying-model-pytorch/classifier-c73-20260919-verified \
  --out .local/jianying-model-pytorch/classifier-c73-new-standalone
```

每次 native/standalone 运行须使用新的空目录，防止旧输出冒充当前结果。
18 项合成测试通过，覆盖权重排列、hard8 边界、未知字段/操作拒绝、拓扑、零除、坏权重、
坏输入、严格比较、私有路径、holdout、weights-only 加载、图/来源/state 篡改与 exact roundtrip。
