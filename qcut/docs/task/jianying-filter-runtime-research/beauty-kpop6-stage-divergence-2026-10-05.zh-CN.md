# beauty-6-kpop：美妆逐阶段诊断与 Extra 精修缺口

日期：2026-10-05。分支：`beauty-6-kpop`。
工作目录：仓库内的 `qcut/`（本文其余路径均以它为基准）。
本轮起点：`36a160b4fecc115f4a1c17eb6a0290f463c9ae53`。
前置记录：[美妆消费闭环与口红差分](beauty-kpop6-makeup-consumer-2026-10-05.zh-CN.md)。

## 结论

**本轮补齐了原生/候选的独立阶段快照、会话关联审计和三张口红素材的实测。**
三张人像的两个冷启动 prediction 中，候选 `decoded_120` 与原生 post-predict
`stage1` 的主 106 点全部 float32 位一致；候选映射结果与原生 post-predict
`tracked` 主点则存在约 3.9 至 6.2 算法像素的最大单坐标差。

**缩小的是定位范围，不是本轮已经缩小口红效果差异。** 三张口红最终 RGBA 与上一轮
完全相同，零容差验收仍失败。大眼 +40 的四个点位阶段和最终 RGBA 仍完全一致。
候选算法、产品 UI 和产品后端开关未改动，候选后端仍禁用。

这里的 baseline 是 QCut 研究宿主调用固定剪映原生运行库，不是本轮新导出的剪映 GUI 视频。
候选端仍是 ONNX 主点混合宿主，不是独立 ONNX 美妆产品链。

## 新增诊断链

```text
原生 predict 返回
  → 私有 native-{0,1}.json：原生矩阵、发布点、滤波状态
  → 原有依赖消息 + 当次算法 RGBA 交给 worker
  → QCut 候选推理、解码、映射、平滑、归一化
  → 私有 candidate-{0,1}.json：真实中间值的不可变副本
  → 原有候选回复、消费者读取/转换、GPU 完成、最终 RGBA
  → 会话/推理审计 → 阶段关联审计 → 原有零容差图像验收
```

原生诊断坐标只写入本地独立文件，**不进入 worker 输入**。不从原生快照补点，不根据
差分修正候选回复，也不把诊断通过当成最终通过。

| 文件 | 职责 |
| --- | --- |
| `face_live_stage_capture.h` | 固定原生对象布局下的 post-predict 只读快照、RGBA/token 摘要、独占写文件 |
| `face_live_bridge_capture.mm` | 在复制 RGBA 之后、worker exchange 之前调用可选诊断 |
| `face_live_candidate_trace.py` | 真实候选中间数组与 33/73 点滤波状态的 detached JSON 快照 |
| `face_live_candidate.py` | 可选 observer；异常或非空返回不提交候选状态 |
| `face_live_worker.py` | 私有候选文件输出，绑定原生请求 PID 和 token hash，不修改 worker 回复格式 |
| `face_live_stage_audit.py` | 严格校验 schema、会话、素材/像素、版本、face/alignment 和实际回复点位；生成位差指标 |
| `face_live_bridge_probe.py` | `--trace-stages` 显式开关、独立目录和精确文件清单、审计分层 |

该模式只允许 `--single-frame --cold-frame`，prediction 精确为 `[0,1]`，timestamp 为 0，
恰好一个 active face。目录必须新建；额外文件、缺文件、覆写旧证据、错误会话、非有限数、
不支持的 route、候选归一化点与实际 worker 回复不一致均拒绝。
私有目录权限为 0700；快照只保存 token 摘要，不保存明文 token。

候选 observer 默认不启用；启用后回调接收 detached 数据，修改快照不能改变实际结果/状态。
回调失败时状态不推进，worker 会话失败后不可继续使用。

## 诊断的证据边界

原生 `stage1`、`tracked`、`mapped` 是 **predict 返回时读取的缓冲区**。
其中 `tracked` 等存储可能已被 Stage2 重写，不能当成历史上“刚完成 120 映射”的快照。
本轮只比较可读取的对应数据，不声称知道每个缓冲区最后写入的精确调用。

- `decoded_120` 相等仅证明这次 106x2 解码结果一致，不等于全部 raw tensor/head 值已验证。
- `mapped_120` 比较项是候选 map120 对原生 post-predict tracked；名称不代表原生调用边界。
- `first_available_mismatch` 是报告比较顺序上的首项，不是执行顺序上的第一处因果分歧。
- `stage_audit.passed=true` 仅表示收据/关联有效；同时保留 `diagnostic_only=true`、
  `first_mismatch_is_causal=false`、`pipeline_parity_verified=false`。
- 候选 seed160 已记录，但没有原生 pre-tracking seed 对应快照，`seed_160_verified=false`。
- 初始化会把原生滤波器 `first` 设为 true，但会保留旧 previous/delta；候选重置状态为空。
  数组长度差异如实报告，不补零伪造相等。本轮大眼出现这种历史状态差，但当前点位/图像一致。

## 本机实测

运行根目录：`.local/jianying-model-pytorch/`。每轮都使用新进程、会话和输出目录；
以下四轮 `cleanup.completed=true`、`dependencies_unchanged=true`。

| 运行目录 | 素材/效果 | 输出尺寸 | 最终候选对原生差异像素 | 最大通道差 | 结果 |
| --- | --- | --- | ---: | ---: | --- |
| `beauty-kpop6-lip-stages-20261005-r9` | 微笑正脸，柔和粉口红 +80 | 640x640 | 3970 | 31 | 消费/阶段关联通过，图像失败 |
| `beauty-kpop6-kpop-lip-stages-20261005-r13` | K-pop 正脸，同口红 | 1448x1086 | 10776 | 23 | 消费/阶段关联通过，图像失败 |
| `beauty-kpop6-outdoor-lip-stages-20261005-r11` | 户外人像，同口红 | 1448x1086 | 7420 | 34 | 消费/阶段关联通过，图像失败 |
| `beauty-kpop6-eye-stages-regression-20261005-r12` | 微笑正脸，大眼 +40 | 640x640 | 0 | 0 | 既有冷启动链通过 |

户外素材沿用 `outdoor-male--02/manifest.json`，历史原图路径含 `mature-eye`；
这里只称户外人像，不将目录名称当成人物身份/年龄证据。

两个 prediction 的 decoded120 均为 212/212 坐标位相等。下面是最终 prediction 1 的点位比较：

| 素材 | 算法 RGBA 尺寸 | decoded 最大差 | mapped 对 post-tracked 最大差 | smoothed 对 published 最大差 | normalized 最大差 |
| --- | --- | ---: | ---: | ---: | ---: |
| 微笑口红 | 640x640 | 0 | 6.229232788 px | 6.229232788 px | 0.009733081 |
| K-pop 口红 | 640x480 | 0 | 4.797821045 px | 4.797821045 px | 0.007496595 |
| 户外口红 | 640x480 | 0 | 3.889968872 px | 3.889968872 px | 0.008104146 |
| 微笑大眼 | 640x640 | 0 | 0 | 0 | 0 |

表中 px 是**算法输入坐标系**，不是 1448x1086 输出画面的像素。
prediction 0 的 mapped 最大差分别为 6.399520874、4.860870361、3.862075806 px。
三个口红样本在这两次预测中均为 212 个 mapped 坐标全部不同。

本轮四例 `frames` 数组与上一轮 r4/r6/r7/r5 逐项完全相等，包括 baseline/candidate SHA256、
差异像素、包围框和原图变化。诊断没有改变这四例最终 RGBA，也没有把旧失败改写成成功。

### 失败记录

- r8 微笑口红完成了渲染，但新阶段审计错误地拒绝原生未使用的 `tracking_size=[0,0]`。
  现仅允许这个成对、typed 整数哨兵；单边零、错误类型等继续拒绝，并新增边界测试。
  原报告保留失败；主证据为修改后新跑的 r9，不回填/覆盖 r8。
- r10 K-pop 的 live 宿主被 signal 9 终止，只读观察器失败；没有成功的阶段/图像验收。
  本轮未确定终止来源，不声称是桌面授权问题。原目录保留；独立新进程 r13 完成采集。
- r9/r11/r13 最终退出码仍为 1，原因均为 `zero-tolerance makeup render mismatch`。
  这是保留验收门槛的正确失败，不是被修饰成通过的测试。

## 灰度差分报告

报告：`.local/jianying-model-pytorch/beauty-kpop6-stage-comparison-20261005-r1/index.html`。
清单：`.local/jianying-model-pytorch/beauty-kpop6-stage-matrix-20261005.json`。

共 24 张 PNG，每例包含原图、原生结果、候选结果和三张两两差分。
统一公式 `min(255, 8 * max(abs(RGB delta)))`，不逐张归一化；Alpha 指标单列。
报告验证源文件 SHA256，结果 `DIFFERENT=3, EXACT=1`，所有素材 `issues=[]`。
已目视查看 K-pop 原图及两条效果图、三个口红差分和大眼全黑差分；
口红差异集中在唇内/唇缘，没有观察到全图偏移。不能由此推断其他美妆功能通过。

## 原生静态核对

固定 `liblens.dylib` SHA256：
`fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`。
arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
下列地址均为 arm64 unslid 虚拟地址，不是 fat Mach-O 文件字节偏移。
`R` 为 RunningTimeInfo，`A=*(R+0)` 为 alignment 对象，`C/F` 为运行/脸部配置。
这里只记录接口和行为，不提交原始反汇编、模型/表内容或私有素材。

| 核对点 | 发现 | 本轮是否捕获调用边界 |
| --- | --- | --- |
| `0x2d9a20` 调 Stage2，返回 `0x2d9a24` | 位于 120 映射之后，能继续修改主点 | 否 |
| PredictExtraInfo `0x2cfe70` | `0x2d0eb4/0x2d0ee8` 写回前 106 点，并非只补额外点 | 否 |
| `0x2d7de4`，返回 `0x2d7de8` | Extra inverse 将结果写回 `A+0xb08`，复用 tracked 存储 | 否 |
| AvgFilter `A+0x310` | Extra 预测前还有内部平滑；其初始化与本例启用条件仍待抓取 | 否 |
| OneEuro `A+0x710` | 特定配置可继续改变主点；首次初始化只保存状态 | 否 |
| canonical correction | 特定配置在 canonical 空间减映射量，再发布 `R.points` | 否 |
| 外层 Extra 平滑 | 原始 raw73、raw33、同一 raw73 的调用顺序与候选一致 | 静态调度核对，不是所有状态数值验收 |

因此，**候选尚缺 Extra 精修链**是明确的实现缺口，而 Stage2 是当前优先抓取的边界。
这些可选路径是否在三个样本实际启用、各自贡献多少偏差，本轮仍未动态证明。
不能直接把差异归因于外层滤波权重、ONNX 模型精度或最终 shader。

## 测试与复跑

本轮 **265 项 Python 测试通过，无跳过**，包含真实本地 ONNX models 的候选测试，
以及合成输入的边界/失败测试；不是 265 次原生 E2E。新增原生 capture 编译通过，
真实原生主证据为上述三例口红和一例大眼。`git diff --check` 通过。

```bash
cd "$(git rev-parse --show-toplevel)/qcut/research/local-model-pytorch"
QCUT_FACE_LIVE_MODEL_ROOT=$PWD/../../.local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_candidate_trace_test face_live_candidate_test face_live_candidate_extra_test \
  face_live_worker_test face_live_worker_trace_test face_live_worker_protocol_test \
  face_live_worker_server_test face_live_stage_audit_test face_live_stage_launcher_test \
  face_live_bridge_probe_test face_live_bridge_audit_test face_live_makeup_render_audit_test \
  face_live_makeup_point_audit_test face_live_makeup_point_trace_test face_live_bridge_lldb_test \
  face_owned_result_probe_test face_live_bridge_process_test beauty_dual_matrix_report_test
```

原生复跑使用对应 `report.json.command`，换新的 `--out` 和 `pycache_prefix`，保留 runtime、
manifest、模型、效果包与 lease，串行执行，运行期间冻结研究源码。
在上一轮口红命令上新增 `--trace-stages`；该开关也可单独叠加于大眼 cold 命令。
失败报告、素材、模型、二进制、快照、raw 日志均留在本机，不提交 Git。

本轮没有跑产品全量 CI、Electron UI E2E、新剪映 GUI 导出、分钟级、多脸或 Windows/x86 验收。

## 下一步顺序

1. 在固定库上新增只读调用边界探针：`0x2d9a20` 之前与 `0x2d9a24` 之后深拷贝
   `A+0xb08`/`R.points`，并绑定当次预测、脸部、线程和配置。不能延迟读取同一地址冒充前值。
2. 先验证调用前矩阵与候选 map120 是否一致。若不一致，继续检查当时实际 inverse/crop，
   不先把 Stage2 当成已证实的唯一原因。
3. 若调用前一致、后不一致，继续在 `0x2d7de8`、可选 OneEuro、canonical 发布前后细分。
   同时捕获 Extra initializer 的真实 seed 和 `A+0x310` 状态，避免只修后半段。
4. 按已证实路径逐项移植 Extra 预测、主点重排/映射和状态调度；保持原生对照隔离，
   每次改动都重跑三张口红与大眼的阶段指标、最终 RGBA 和固定增益差分。
5. 单图达到门槛后再扩不同强度、眉妆/眼妆、人物、真实视频和多脸，最后接产品预览/导出。

大蓝图仍有：原生 full-frame 预处理、检测/接纳、crop/跟踪/重置信号、Extra/iris/fitting/masks、
效果包和 renderer 依赖。不能把这轮逐阶段诊断视为全链独立或全部美妆完成。
