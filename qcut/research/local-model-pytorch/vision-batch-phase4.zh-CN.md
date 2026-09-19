# 第四阶段视觉网络批量转换

日期：2026-09-19。仅私有、本机互操作研究，延续 [第三阶段](PHASE3-20260919.zh-CN.md)。

本子任务只新增 `vision_batch_*` 和本文，不改统一 `infer`、台账、ONNX 批处理或产品后端。
所有源容器、解码图、权重、NPZ 和媒体证据位于被 Git 忽略的 `.local/jianying-model-pytorch/`。
没有提交、推送、创建代理、调用云端或修改用户草稿。

## 已验证交付

新增 **3 个源资产、3 个网络版本、3 个 PyTorch 包**。不把原生对照重试重复算成新网络。

| Profile | 网络范围 | 参数量 | 完整输出原生对照 | 最大绝对误差 |
| --- | --- | ---: | --- | ---: |
| `clip2m` | 文件名为 `nodehub_clip_d128_2m_fp32` 的视觉编码网络 | 1,398,448 | 18/18 | `5.96e-6` |
| `clip30m` | 独立的 `nodehub_clip_d128_30M_pc` 视觉编码网络 | 7,067,520 | 18/18 | `1.86e-4` |
| `normal` | `nh_normal_estimation_offline` 三通道输出网络 | 5,684,611 | 18/18 | `1.33e-5` |

比较公式固定为 `abs(pytorch - native) <= 1e-4 + 1e-4 * abs(native)`，没有放宽。
`clip30m` 的最大绝对误差大于 `1e-4`，但这些元素符合从一开始就固定的相对误差项；不能写成绝对误差全部小于 `1e-4`。

每网 18 组包括：零、正一、负一、渐变、两个校准随机输入；三个不同种子的随机 holdout；非对称脉冲；两段真实视频各 4 帧。
三网共 **54 组完整终端输出对照**，其中 **24 组真实帧推理**。每个 case 保存完整输入和全部终端输出，未挑选输出通道或像素。

## 实际链路与范围

1. 校验源文件、内嵌 BM 和恢复图的 SHA256；拒绝不匹配的来源。
2. 从原始 FP32 arena 读取全部参数，只排除末尾 4 字节图标识，检查消费数量和有限值。
3. 原始输入尺寸、完整原图和原始 arena 均不改动。原生侧在建网前强制 CPU，执行后检查 `GetForwardType()==0`。
4. 输入按 NCHW 与原生 NHWC/NWHC 协议转换，原生回读必须逐字节相同；终端尺寸、字节数和有限值全部检查。
5. 用 `weights_only=True` 重载 `.pt`，要求状态和同输入前向逐值一致。
6. 新进程仅允许指定包、输入 NPZ 和输出目录，禁止 Python 审计事件中访问原始私有资产、厂商库及网络；再回比冻结 PyTorch 和原生输出。

真实素材沿用此前的 face/body 参考视频。保存视频 SHA256、FFmpeg 命令、抽帧 SHA256 和所有 NPZ；测试使用 RGB、双线性缩放、除以 255。
**该前处理用于神经网络数值测试，尚未证明是产品实际前处理。** 网络名称不等于产品调用已证实。
两路 CLIP 输出仅是 128 维特征，未证明文字编码器、归一化、语义检索、标签表或相似度阈值。
法线网络未验证坐标系、单位向量后处理、编辑器灯光效果或渲染导出。

独立进程守卫仅覆盖 Python audit hook，不是 OS 沙箱或禁止所有原生 syscall 的隔离保证。
没有声称 Linux、Windows、CUDA、MPS、产品 GPU 或编辑器端到端验收通过。

最终独立进程回放 **3/3 包、54/54 case 通过**：冻结 PyTorch 输出逐值一致，再比全部原生输出满足固定门槛，未触发被监测的私有资产或网络访问。

## 两个被测试发现的问题

### Shuffle 以四通道为一组

普通逐通道 shuffle 会使法线网络失败。用原生前缀终端输出逐层比较后：第 10 个算子前全部通过，第 11 个 Shuffle 首次出现明显差异。
对前后原生张量做逐通道精确匹配，发现 128 通道的顺序为 `0,1,2,3,64,65,66,67,4,5,6,7,...`。
实现改为四通道块交错，并严格要求通道数可被 8 整除；不泛化成未经验证的任意 Shuffle。
修复后保留原始完整图，全部 18 组终端输出通过。

### NPZ 不保留原始 strides

视频解码的转置视图可以保留 channels-last strides，NPZ 重载后变成连续 NCHW，卷积累加次序因此有末位差异。
最初 54 组新进程运行都满足原生容差，但 24 组视频 case 未满足冻结 PyTorch 的逐值一致。
最终入口统一调用 `contiguous()`，加了输入 strides 回归测试，并重新运行原生完整图和独立进程回放。
不能通过降低重载判据隐藏这个差异。

## 未通过候选与未选择项

`bandou` 的 1,999,044 参数网络可恢复并独立推理，但固定门槛只通过 **13/18**：8 个真实帧通过，2 个校准随机输入和 3 个随机 holdout 失败，最大差 `6.4427e-4`。
前缀诊断表明末端卷积 logits 已有偏差；把相同原生 logits 送入常规 Tanh，最大差约 `1.66e-6`，不能把失败归因于 Tanh 本身。
改为 channels-last 计算也未解决，因此不计入 verified，默认加载拒绝。诊断必须显式 `allow_unverified=True`。

优先检查过 `tt_matting_v15` 和 saliency，但本次没有宣称它们完成：前者包含 INT16 指数、ShuffleNet、切片和膨胀卷积；后者包含 FP16、`Conv2D`、多种池化、切片和额外融合。
这些操作不能仅依据名字替换为常规 PyTorch 算子。已完成的人脸拟合和此前 17 个网络排除在本批新增数之外。

## 加载与 ONNX 交接

```python
from vision_batch_torch import load_model

model = load_model(path="<private-model>.pt", expected_sha256="<report-artifact-sha256>")
outputs = model({"data": cpu_float32_nchw})
```

格式为 `qcut-private-vision-batch-pytorch-v1`。源、BM、图、状态摘要和运行库身份有静态白名单；修改包内 `verification_status` 或重算被篡改权重的自报摘要不能绕过候选门槛。

| Profile | 输入 | 完整输出 |
| --- | --- | --- |
| `clip2m` / `clip30m` | `data [1,3,224,224]` FP32 | `v_projector [1,128,1,1]` FP32 |
| `normal` | `data [1,3,400,224]` FP32 | `up3.2 [1,3,400,224]` FP32 |

`model.input_shapes` / `model.output_shapes` 可用于有序张量包装。导出方应固定以上形状，按完整输出名回比所有 NPZ；不要把动态图标志加到未经验证的尺寸上。
ONNX 由父任务导出，本 worker 未修改其文件。后续追加了限定范围的本机 ONNX 冻结证据回放，结果见下节；其他操作系统验收仍由父任务负责。

### ONNX 全部 54 组冻结对照

对父任务 `onnx-phase4/vision-{clip2m,clip30m,normal}/contract.json` 实际执行 ONNX Runtime 1.30.0 CPU，共 **54/54** 组。
ONNX 对冻结 native **54/54**，ONNX 对冻结 PyTorch **54/54**，另复核冻结 PyTorch 对 native **54/54**。
这些是同一批 54 个输入的不同比较关系，不能算作 162 个独立输入或新的原生执行。

| Profile | ONNX 对 native 最大绝对误差 | ONNX 对 PyTorch 最大绝对误差 |
| --- | ---: | ---: |
| `clip2m` | `4.65e-6` | `5.01e-6` |
| `clip30m` | `1.18e-4` | `1.75e-4` |
| `normal` | `7.43e-6` | `8.77e-6` |

仍用 `atol=rtol=1e-4`，逐输出名称、形状、dtype 和每个元素检查。执行提供者仅 CPU，图优化关闭，与父任务运行入口一致。
本次没有原生模型执行、没有 PyTorch 执行、进程未导入 Torch；三份原生报告和 PyTorch NPZ 都是冻结参考，不冒充本次重新生成。
报告保存 handoff、contract、ONNX 模型、源 `.pt`、原生报告、全部输入和两份输出参考的 SHA256，运行前后重查输入/参考及 contract/model 未改变。

报告与实际 ONNX 输出 NPZ 统一保留在已忽略的 `.local/jianying-model-pytorch/vision-batch-phase4-onnx-replay/`。父任务收尾时核对了早期目录副本逐字节一致，再移除未被忽略的额外报告副本；执行器也限制所有报告留在私有根目录。
指定报告目录当前未被 Git 忽略，不应暂存；同一份报告另存于上述已忽略的私有 NPZ 目录。没有修改父任务的 `.gitignore`。
报告格式 `qcut-private-vision-onnx-frozen-replay-v1`，`models[].cases[]` 下分别是 `onnx_vs_native`、`onnx_vs_pytorch` 和 `frozen_pytorch_vs_native`。

### 最终来源与候选审计

实际 `.pt` 审计 **19/19 加载器检查、7/7 活跃访问守卫检查通过**。失败候选 `bandou` 默认拒绝，即使将其包内 `verification_status` 改为通过也拒绝。
只有显式布尔 `allow_unverified=True` 可用于诊断，字符串或数字不能意外放行。图和状态的自报哈希重算后，仍必须匹配静态 profile 的固定摘要。
加载器对同一份有上限的文件字节计算摘要并用 `weights_only=True` 反序列化，避免校验后重新打开路径的替换窗口。三个原有 artifact SHA256 不变，前向计算未改动。
活跃负向探针确认原始厂商模型、解码图、arena、厂商库与 socket 连接被拒绝；批准的包和输入可读取。这仍只是 Python audit 事件级边界。
证据在私有根 `vision-batch-phase4-final-audit-r1/report.json`。

### Ledger 映射

原生报告是单网络的平面对象，`format=qcut-private-vision-batch-pytorch-v1`；有 `source_sha256`、`artifact`、`artifact_sha256`、`status`、`schema` 和 `cases`，没有 `networks` 数组。
原报告**省略** `network_id`，现有 ledger 会使用 `main`；不要把省略字段改成 `null`，也不要把 profile 名当成另一个网络 ID。

每个 `clip2m` / `clip30m` / `normal` 都是独立 source SHA 下的 `main`，各贡献 1 个 verified network 和 1 个 bundle，本批合计 **+3 sources / +3 networks / +3 bundles**。
ONNX 是这三个网络的第二种序列化，不应再增加 3 个神经网络。`bandou` 是另一个 source 下的 `main`，只增加 1 个 unverified network，不增加 verified。
正常网络的早期 Shuffle 失败报告和最终报告属于相同身份；只追加历史，不重复计数。前缀诊断和 ONNX 冻结回放不是新的 native-parity 报告。
完整 source SHA、artifact SHA、`main` 与原生报告路径映射已写入最终审计报告的 `ledger_mapping`。

以下路径均相对于私有根 `.local/jianying-model-pytorch/`：

| 证据 | 路径 |
| --- | --- |
| 三个最终原生报告 / 包 | `vision-batch-phase4-{clip2m,clip30m,normal}-final/report.json` / `<profile>.pt` |
| 每个模型所有真实及合成输入 | 对应目录下 `case-*/inputs.npz` |
| 冻结原生 / PyTorch 输出 | `case-*/native.npz` / `case-*/pytorch.npz` |
| 新进程最终回放 | `vision-batch-phase4-replay-final/report.json` |
| ONNX 批量交接，含完整 54 组 fixture 路径 | `vision-batch-phase4-replay-final/handoff.json` |
| Shuffle 修复前失败与前缀证据 | `vision-batch-phase4-normal-r1/report.json` / `vision-batch-phase4-normal-probes-r1/report.json` |
| bandou 失败候选与诊断 | `vision-batch-phase4-bandou-r1/report.json` / `vision-batch-phase4-bandou-probes-r1/report.json` |
| bandou 布局实验 | `vision-batch-phase4-bandou-layout-r1/report.json` |
| strides 修复前新进程失败记录 | `vision-batch-phase4-replay-r1/report.json` |

## 测试与复现

新增文件按职责分为 `vision_batch_profiles.py`、`vision_batch_torch.py`、`vision_batch_export.py`、`vision_batch_probe.py`、`vision_batch_numeric_probe.py`、`vision_batch_replay.py`、`vision_batch_audit.py`、`vision_batch_onnx_replay.py`、`vision_batch_test.py` 及本文。

最终 34 项合成单测在本机 Python 3.14 和私有 Python 3.12 环境各通过一次；同一组单测不能算成 68 个独立覆盖点。
覆盖权重 OHWI/HWC 排列、四通道 shuffle、残差、池化、输入 strides、全部终端、非有限值、截断/多余权重、未知操作、源/图/状态摘要篡改及候选门槛。
另覆盖 ONNX 对照的精确输出集合、固定容差公式、禁止 dtype/shape 广播、完整 18-case 集合和 contract/source/schema 绑定。

```sh
/opt/homebrew/bin/python3 -m unittest discover \
  -s research/local-model-pytorch -p 'vision_batch_test.py'

/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_export.py \
  --profile normal --oracle \
  --video .local/jianying-effect-references/_assets/ref-clip-face-1280x720.mp4 \
  --video .local/jianying-effect-references/_assets/ref-clip-body-1280x720.mp4 \
  --out .local/jianying-model-pytorch/vision-normal-new-run

/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_replay.py \
  --report .local/jianying-model-pytorch/vision-batch-phase4-clip2m-final/report.json \
  --report .local/jianying-model-pytorch/vision-batch-phase4-clip30m-final/report.json \
  --report .local/jianying-model-pytorch/vision-batch-phase4-normal-final/report.json \
  --out .local/jianying-model-pytorch/vision-replay-new-run
```

每次使用新的输出目录。没有把派生前缀图、合成测试或失败候选混入完整原图通过数量。
