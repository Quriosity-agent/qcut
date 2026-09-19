# 第四阶段：真实媒体模型管线 E2E

日期：2026-09-19。本文件只记录模型媒体管线，不代表 QCut 编辑器、剪映 UI 或完整业务算法通过。
基线是 [第三阶段](PHASE3-20260919.zh-CN.md)的 17 个已验证网络版本、12 个 PyTorch 包。
所有模型、媒体、张量、截图和机器报告位于 Git 忽略的 `.local/jianying-model-pytorch/`。
未访问云端，未改产品或草稿，未 commit/push，未新增 agent。

## 实际完成

- 56 条通过的完整媒体链：28 条 PyTorch CPU，28 条 ONNX Runtime CPU。
- 覆盖 14 个视频输入模型包、两段不同参考媒体。基线 12 包加新视觉 3 包中，人脸拟合另列阻塞，不编造图像到 212 维特征的输入。
- 1,200 帧主推理及 1,200 帧独立重放。逐帧保存所有终端输出，不仅比较最终可视化。
- 696 组 PyTorch/ORT 输出比较全部通过，最大绝对误差 `1.0013580322265625e-4`。
- FP32 固定 `atol=1e-4, rtol=1e-4`；INT16 必须逐值完全一致。没有因视频失败而放宽阈值。
- 8 个真实 CLI 异常/取消用例通过预期失败验收；扩展压力工具后，29 项不依赖私有模型的合成单测通过。
- 56 份 MP4 和 56 张 PNG contact sheet。每份 MP4 都经过 ffprobe 和重新完整解码，每张 PNG 重新解码。

上述 56 不包含单独的皮肤预跑，也不包含失败准入重试。聚合报告保留两条分镜准入失败历史，不能从原 suite 的 `passed: false` 直接改成 true。
首批 42 条汇总仍保留为 `summary.json`；新增 tracking ORT 两条及新视觉 PT/ORT 十二条后，最新汇总为 `summary-extended.json`。

CLIP-30M 最大差出现在 face 第 20 帧通道 2：参考值约 `-11.9287319`，ORT 约 `-11.9286318`。
固定 allclose 门槛为 `abs(actual-reference) <= 1e-4 + 1e-4*abs(reference)`，此点允许约 `0.00129287`。
因此全组通过，但不能写成“所有绝对误差均小于 `1e-4`”；没有修改原容差。

## 覆盖矩阵

每一行均跑 `ref-clip-face-1280x720.mp4` 与 `ref-clip-body-1280x720.mp4`。
这些是已有真实媒体文件，不是在线样本或合成张量；face 片含生成式角色/场景，不能据文件名假设都是真人或具有分割 ground truth。

| 包 / 视频 profile | 每片帧数 / 采样时长 | PyTorch | ORT | 可视化边界 |
| --- | --- | --- | --- | --- |
| skin | 24 / 6 秒 | 2/2 | 2/2 | 单通道原始概率，未恢复产品标准化 |
| video-object | 24 / 6 秒 | 2/2 | 2/2 | 单通道响应；真实循环反馈，片中 reset |
| TFLite person segmentation | 24 / 6 秒 | 2/2 | 2/2 | 六通道 logits 经 softmax 后 `1-background` |
| skeleton | 24 / 6 秒 | 2/2 | 2/2 | 原始通道响应投影，不命名关节 |
| 新分镜双网络包 | 24 / 6 秒 | 2/2 | 2/2 | 每帧中心 7 帧窗口，同时保存 features/probability |
| 旧分镜双网络包 | 24 / 6 秒 | 2/2 | 2/2 | 每帧中心 11 帧窗口，同时保存 features/probability |
| denoise | 4 / 1 秒 | 2/2 | 2/2 | 原图尺寸 `[1,3,1088,1920]` 三帧窗口；不声称降噪画质提升 |
| C73 / dance，各独立一包 | 各 24 / 6 秒 | 各 2/2 | 各 2/2 | 原始分数投影，无类别表、无动作标签 |
| OCR detector | 24 / 6 秒 | 2/2 | 2/2 | 双通道响应图，无文字框、无识别文本 |
| tracking bundle / backbone | 8 / 2 秒 | 2/2 | 2/2 | INT16 全输出逐值完全一致；不是完整跟踪器 |
| CLIP-2M / CLIP-30M，各独立一包 | 各 24 / 6 秒 | 各 2/2 | 各 2/2 | 128 维 embedding 的诊断条纹；不是图像质量或图文匹配验收 |
| normal | 24 / 6 秒 | 2/2 | 2/2 | 输入 `[1,3,400,224]`，输出三通道响应投影；不声称几何法线校准 |
| face fitting | 不适用 | 阻塞 | 阻塞 | 输入为 212 维特征，缺少已验证视频到特征链 |

总计：PyTorch 600 主帧，ORT 600 主帧；每端分别执行同量独立重放。
其他任务负责的 ONNX tensor smoke / Linux 容器验证不计入此处的媒体帧数。
本管线实际运行平台是本机 macOS ARM64，不据此宣称 Windows/Linux 媒体 E2E 通过。

## 执行链与严格检查

```text
源视频 SHA + ffprobe
  -> FFmpeg 精确 seek / fps / bilinear resize / RGB 解码
  -> 显式模型 profile 前处理
  -> ledger 中已通过的包 + 文件 SHA + 原生报告 SHA 校验
  -> PyTorch 或 approved ONNX contract / CPUExecutionProvider
  -> 全部终端张量有限值、dtype、shape、逐帧保存
  -> 另一轮从零状态独立重放 + midpoint reset
  -> 重新 seek 解码，并与首轮对应帧逐字节核对
  -> 响应可视化 + 原图 + 60/40 blend
  -> H.264 MP4
  -> ffprobe 尺寸/帧数/时长 + 完整解码 + PNG contact sheet 解码
```

### 状态不能交叉借用

video-object 每端从自己的零 `prev_img/prev_mask` 开始，仅把自己的输出反馈到下一帧；首帧和中点各 reset 一次。
第二轮重新加载后端，从各段的零状态开始重放，所有输出要求逐位相等。
ORT 的 24 帧主序列先独立跑完，之后才读取 PyTorch 已保存输出进行比较，不把 PyTorch mask 送给 ORT。
精确 seek 的输入帧与原序列对应帧逐值一致；seek 后的独立 reset 重放也通过。

### 原生证据不是本次新测

本轮重哈希 `.pt`，准入要求 ledger 存在非空且零失败的已验证记录，并重新校验关联原生报告 SHA。
接受 `native-parity-passed` 与历史 `recorded-native-parity-passed`，保留原状态名称。
本轮并未重新启动 CoreML / ByteNN oracle，报告明确 `native_oracle_rerun: false`。
所以本轮新增的是媒体处理和 PyTorch/ORT 同输入数值比较，不把这些帧再宣传成新增原生 CPU oracle 对照。

GRU 与 OCR 识别器没有纳入本轮准入台账及媒体矩阵，不能从此管线偷渡启用。
ONNX 仅允许 `onnx-runtime-parity-passed` contract，并匹配源 `.pt` SHA、network、固定 schema、ONNX 文件 SHA；不使用 `allow_unverified=True`。
新增视觉用 `conversion_ledger.py` 从原第二阶段索引加三份实际 native 报告生成独立的 `vision-gate-ledger.json`。
它只是新视觉媒体 case 的准入快照，没有包含所有第三/第四阶段网络，**不能当作项目总模型计数**，也没有修改父任务的总台账。
两个 CLIP 模型输入和输出形状相同，因此额外用 source SHA 校验 profile，不能在相同尺寸下把 CLIP-2M 和 CLIP-30M 包互换标签。

### 可视化不等于效果验收

contact sheet 每行依次是原视频、响应、60/40 blend；行取首帧、中帧、末帧。
除已确认的 TFLite metadata 处理外，大多数前处理仍只是明确记录的研究输入。
分类、骨架、OCR、跟踪的响应投影使用绝对值聚合/按帧归一化，不生成未知语义标签。

已实际打开多张 PNG 检查：

- TFLite body 显示五个人物的置信度轮廓，但画面顶部仍有背景误响应；未做质量 ground truth 验收。
- video-object face 在角色画面显示前景响应，切到场景后响应接近黑色。
- skin 首帧概率范围约 `0.0010..0.0449`，因此图很暗；不能把管线通过写成皮肤分割效果已完成。
- OCR 可视化有明显纹理响应，只证明原始图运行，不代表框后处理或 OCR 文本正确。
- tracking-backbone 显示特征响应，无 ROI、框、目标 ID 或轨迹。
- CLIP-30M body 显示 128 维特征投影条纹，条纹不是空间响应、更不是画质评分。
- normal face 显示三通道绝对值均值的灰度投影；保存的原始三通道张量才是数值对照对象，没有把灰度图命名为已校准法线图。

编码检查除了整张视频非空，还记录独立响应区域的输入/解码像素范围、空间常量帧数量和编码 MAE。
有损 H.264 的响应像素 MAE 上限 8/255 仅用于媒体编码检查，**不改变神经网络的 `1e-4` 比较门槛**。
最早几个 PyTorch case 先于这一额外字段完成，原报告保留；对应 ORT case 含响应区域校验。

## 异常与取消

实际启动 CLI 并验证退出码、持久报告，而非仅 mock 返回值：

| 用例 | 实际结果 |
| --- | --- |
| 作者自造损坏 MP4 | ffprobe 失败，退出 1，报告 `failed` |
| 空文件 | ffprobe 失败，退出 1 |
| 只有音频的 WAV | 无视频流，退出 1 |
| 请求零帧 | 输入验证拒绝，退出 1 |
| seek 到视频末尾之外 | 解码零帧，退出 1 |
| 无效 profile | 拒绝，退出 1 |
| skin 包配 C73 profile | 模型格式不匹配，退出 1 |
| 推理完成至少一帧后发 SIGTERM | 实际完成 1 帧后取消，退出 130，持久报告 `cancelled` |

输出目录必须是私有根下的新目录，拒绝复用已有目录；解码总量限制 256 MiB。
保留每个媒体命令的 argv、stderr、returncode；超时保留命令日志。
单测还覆盖整数差 1 LSB、NaN、空张量、dtype/输出名/形状、历史 native 状态、证据篡改、状态不共享和边界窗口。

首次分镜 case 被脚本误拒绝，因为只接受即时通过状态，漏了历史 `recorded-native-parity-passed`。
已补准入兼容和回归测试，使用新的 `pytorch-shot-r2/` 重跑，两段通过。旧 `pytorch/suite.json` 两条失败不删除。

## 文件与接口

| 文件 | 职责 |
| --- | --- |
| `pipeline_e2e_profiles.py` | 显式视频前处理、状态、全部输出比较及无语义投影 |
| `pipeline_e2e_media.py` | 有界 FFmpeg/ffprobe、编码、逐帧解码、PNG 与编码区域验证 |
| `pipeline_e2e_run.py` | 单 case CLI、已验证模型准入、后端、独立重放、seek、失败/取消记录 |
| `pipeline_e2e_suite.py` | 双素材矩阵、真实异常输入、真实 SIGTERM |
| `pipeline_e2e_summary.py` | 合并成功 evidence，同时保留历史失败、阻塞和所有哈希 |
| `pipeline_e2e_stress.py` | 60 秒循环素材、连续反馈、seek/reset、RSS 监测和真实取消 |
| `pipeline_e2e_test.py` | 29 个纯合成契约测试，无私有依赖 |

ORT 接口直接使用 `onnx_infer.ONNXModel(contract_path=...)` 的 NumPy 字典输入/输出。
本媒体工具使用 PyTorch 做前处理/可视化，**不是 ORT-only 可分发运行时**。不依赖 torch 的 tensor runtime 验证由独立 `onnx_infer.py` 承担。

```sh
.local/jianying-model-pytorch/tflite/venv/bin/python \
  research/local-model-pytorch/pipeline_e2e_run.py \
  --model .local/jianying-model-pytorch/batch-20260919/346b64693e02775f/model.pt \
  --ledger .local/jianying-model-pytorch/phase3-20260919/ledger.json \
  --video .local/jianying-effect-references/_assets/ref-clip-body-1280x720.mp4 \
  --profile video-object --frames 24 --fps 4 \
  --out .local/jianying-model-pytorch/pipeline-e2e-new-body

# ORT 再指定三个参数，--out 必须换新目录
# --backend onnx
# --contract .local/jianying-model-pytorch/onnx-phase4/videoobject-r2/contract.json
# --compare-run .local/jianying-model-pytorch/pipeline-e2e-new-body

.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest discover \
  -s research/local-model-pytorch -p pipeline_e2e_test.py
```

## 私有证据

根目录 `.local/jianying-model-pytorch/pipeline-e2e-phase4/`：

- `summary-extended.json`：最新 56 成功 case、1,200+1,200 帧、696 对照组、全部视频/PNG SHA、失败历史。
- `summary.json`：首批 42 条历史快照，未覆盖新增 case。
- `pytorch/suite.json`：首批矩阵和八个异常用例；其中分镜的两条准入失败保留。
- `pytorch-shot-r2/suite.json`：分镜修复后两段通过。
- `onnx-segmentation/suite.json`：三种分割、双素材，共 6 条。
- `onnx-other/suite.json`：骨架、旧分镜、降噪、C73、dance、OCR，共 12 条。
- `onnx-shot/suite.json`：新分镜两条。
- `onnx-tracking/suite.json`：跟踪 backbone 两条，16 组 INT16 对照全部精确一致。
- `pytorch-vision/suite.json` / `onnx-vision/suite.json`：CLIP-2M、CLIP-30M、normal，各双素材，共十二条。
- `vision-gate-ledger.json`：新视觉范围的已验证准入快照，不是全局台账。

每 case 内有 `report.json`、全部 `outputs-*.npz`、reset 点 `inputs-*.npz`、`comparison.mp4`、`contact-sheet.png`、媒体命令及 probe JSON。
代表性截图路径：`onnx-segmentation/tflite-body/contact-sheet.png`、`onnx-segmentation/video-object-face/contact-sheet.png`、
`onnx-other/ocr-det-body/contact-sheet.png`、`pytorch/tracking-backbone-body/contact-sheet.png`。
新增截图：`onnx-vision/clip30m-body/contact-sheet.png`、`onnx-vision/normal-face/contact-sheet.png`、
`onnx-tracking/tracking-backbone-body/contact-sheet.png`。

## 未完成

1. QCut 编辑器项目导入、预览、seek、导出一致性；当前没有启动编辑器。
2. Face fitting 的检测/关键点前处理；tracking 的特征头、相关性、框解码及状态机。
3. 语义质量、ground truth、正确产品前处理、长时稳定性和生产阈值。
4. 真实媒体跨操作系统端到端测试、移动端和 GPU 路径；当前仅本机 CPU。
5. 权重分发授权。格式转换和数值一致不自动赋予公开分发权利。

## 追加：60 秒连续状态压力

这一批与前面的 **56 条普通媒体链分开计数**。只测 video-object，不增加 OCR 媒体条目。
使用现有 body 素材，经 FFmpeg `-stream_loop -1 -t 60 -vf fps=4` 生成私有 240 帧视频。
fixture 明确标记为 **looped stress fixture**，不是 60 秒独立拍摄内容，也不是第三段独立参考素材。

- 源 SHA-256：`5f1f01cabdd3fc6d18bc4735d942d79e0ba624e8b509cb8ce17a305359b5edd2`。
- 循环 fixture SHA-256：`8de8b8493ff317b259875ee395e25bdc57e9d4c91b7b05d3bddd0f17c838fae5`。
- 完整 loop argv、源文件路径、上述哈希及 ffprobe 结果：`video-object-stress-60s/fixture/fixture.json`。
- FFmpeg 命令、退出码及 stderr：同目录 `loop-command.json`。fixture 经实际 ffprobe 验证为 60 秒、4 fps、240 帧。

| 实际执行 | 主帧 / 独立重放 | reset 索引 | 最大跨后端差 | 观测进程树 RSS 峰值 |
| --- | --- | --- | --- | --- |
| PyTorch 连续 60 秒 | 240 / 240 | `[0]` | 作为参考 | 1,374.66 MiB |
| ORT 连续 60 秒 | 240 / 240 | `[0]` | `1.4066696166992188e-5` | 1,377.09 MiB |
| PyTorch 从 30 秒 seek，随后 reset | 8 / 8 | `[0,4]` | 作为参考 | 511.67 MiB |
| ORT 从 30 秒 seek，随后 reset | 8 / 8 | `[0,4]` | `6.884336471557617e-6` | 510.97 MiB |

四条正向压力链全部通过。主段没有中点 reset，连续反馈完整 240 帧；每端的 240 帧重放独立从零状态开始。
seek 段为实际 30 秒定位后的另一次解码和推理，输入精确 seek、两端独立反馈、片中 reset 与完整重放均通过。
固定 `atol=rtol=1e-4` 未变，逐帧保留全部输出。人工打开 ORT 连续 60 秒 contact sheet 检查了首、中、末帧。

### 内存与取消

外部监视器每约 0.25 秒采集该进程及 FFmpeg 子进程的 RSS 之和，同时读取主进程 `getrusage(RUSAGE_SELF)` 高水位。
观测上限设为 2 GiB，超限发 SIGTERM，10 秒仍未结束再 kill；这是采样式停止条件，**不是 OS 级硬内存沙箱**。
实际最高约 **1.35 GiB（1,377.09 MiB）**，四条链全部低于上限。连续推理阶段的采样范围为：PyTorch 567.36–604.81 MiB，ORT 528.25–603.47 MiB；最终峰值包含媒体编码/解码。
每次 RGB 解码仍限制 256 MiB，不能把单数组上限误报为整个进程只需 256 MiB。

另起 ORT 长序列，要求至少完成 32 帧后 SIGTERM；实际第 **35 帧**收到并处理取消，退出码 **130**，报告 `cancelled`，未计入完成帧或成片数量。
又运行一个仅分配 96 MiB 的自造 Python 进程，设置 64 MiB 观测阈值；监视器实际触发 `memory-limit`，进程以 `-15` 结束。
该自造失败探针只验证停止逻辑，不算神经模型证据；记录位于 `video-object-memory-guard/memory-guard-probe.json`。

### 独立计数与证据

- 普通媒体保持 **56 条、1,200 主帧 + 1,200 重放帧、696 对照组**，两段独立参考素材不变。
- 压力正向新增 **4 条、496 主帧 + 496 重放帧、248 对照组**，全部通过；取消的 35 帧不计入。
- 合计正向 60 条、**1,696 主帧 + 1,696 重放帧、944 对照组**。循环素材不增加独立素材数量。
- 已按报告枚举并检查实际文件：计数内 **60 个不同路径 MP4、60 张不同路径 PNG 均存在且非空**。不把预跑、取消和内存失败探针算成成片。
- 原 `summary-extended.json` 仍是 56 条普通媒体快照，不改历史口径；压力权威入口为 `video-object-stress-60s/stress.json`。
- 同目录四个 `*-monitor.json` 含 RSS 时间序列、完整命令、停止原因及子报告哈希；各 case 的 `report.json` 含输出、重放、seek、编码验证。

```sh
.local/jianying-model-pytorch/tflite/venv/bin/python \
  research/local-model-pytorch/pipeline_e2e_stress.py \
  --out .local/jianying-model-pytorch/video-object-stress-new

.local/jianying-model-pytorch/tflite/venv/bin/python \
  research/local-model-pytorch/pipeline_e2e_stress.py --guard-probe-only \
  --out .local/jianying-model-pytorch/video-object-memory-guard-new
```

此处验证的是本机 60 秒循环输入下的有限压力范围，不声称任意时长无泄漏、长视频语义准确或编辑器后台取消已经接通。
