# actual 160 预处理：真实捕获与自有像素零差

日期：2026-10-03。分支：`codex/kpop-beauty-v6`，同一 PR #483。

## 本检查点

上一轮只静态定位了 matrix 之前的调用。本轮新增硬件断点 sidecar、串行原生基准对照和纯 CPU 自有采样重放；没有修改旧 50 个 provenance source、旧捕获、模型、运行库或效果包，也没有注册实时 candidate driver。

```text
实际宿主的 algorithm RGBA
  + 实际 pre-crop Rect、target、flags、expansion
  → 自有 RGBA -> BGR（当前只验收 format=0、orientation=0）
  → 已有自有 crop_region / crop_pixels：正方形扩框、截断、padding
  → 已有自有 resize：本 profile 为 reciprocal nearest-floor
  → uint8 - 128 -> int8 [1,160,160,3]
  → 与捕获的 source / crop / resize / NN input 逐阶段比较
```

**两个生命周期调用都通过，但使用同一幅算法图、同一组几何参数。** 它们是冷启动 prediction 0、face ID 0，以及无脸后重获 prediction 20、face ID 1，不是两张不同脸或不同姿态的覆盖。

## 捕获方式与中立性

- 只启动新的 QCut 自写研究宿主，不 attach 剪映或用户编辑器。
- 锁定 `liblens.dylib` SHA `fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`、arm64 UUID `248872F2-7736-32A9-A48B-DC5DFEE20C99`；地址按加载模块解析，不猜 ASLR 或 PAC mask。
- 两个常驻点：FsNew prediction entry、ProcessDetectionImage entry。临时点滚动捕获 crop-after、resize return、Predict 调用前；最多同时启用 4 个硬件点。
- callback 只读寄存器和停止进程的内存。没有软件断点、目标内函数求值、修改 Rect/返回值/points、追加推理或补跑 SDK。
- 300 秒外部 watchdog、64 predictions、128 callbacks、每 blob 16 MiB、总像素 trace 128 MiB；Mat header、stride、指针范围、部分读、线程、重入和未完成状态均拒绝不合法值。
- 串行 fresh baseline 与 observed 各有 6 次 warmup、7 帧及每请求两次 seek。26 次 prediction、24 次 owned conversion/restoration、ordered host protocol 和时间戳均验证。
- 7 帧最终 RGBA 全部 `changed_pixels=0, max_delta=0`。没有降低像素门槛。
- source union 的旧 50 文件及三个旧 report SHA 启动前后仍匹配。新 sidecar 和原始帧另记独立哈希。

最终采集目录：`.local/jianying-model-pytorch/face-160-preprocess-host-20261003-r6/`。

先前 R1 因要求同一个 Mat header 地址而被拒绝：原生在消费链复制了 header，但 storage 与像素保持相同。随后改为检查实际 predictor/network 关联及像素精确一致，保留两个 header/data 地址。没有改像素阈值。R2/R3/R4 也通过了采集检查，但代码版本有后续边界修复，最终验收以 R6 为准。

R5 在 prediction 15 之后出现 debugger unexpected stop，被终止并标为失败，不计入完整证据；该次没有 callback 校验错误，具体停止原因尚未定位。采集器随后补记 unexpected stop 的 thread/reason/description/PC，仍然拒绝异常停止，不自动继续或改用软件断点。R6 完整通过。这个实验探针的偶发停止风险保留，不能宣称所有采集运行都稳定。

## 实际参数

两个调用都来自 `0x2d5fd4`（`bl 0x2ca3bc` 的返回地址），并与当前 prediction、owner、alignment、face ID、predictor/provider/network 和 NN marker window 关联。

| 阶段 | 实际值 |
| --- | --- |
| algorithm request | `[0,640,480,2560,0]` |
| source Mat | 640×480、三通道 uint8、row stride 1920 |
| pre-crop Rect | `[221,81,204,277]` |
| target | `[160,160]`，来自 `A+0x95c/+0x960` |
| flags `w5,w6,w7` | `[1,0,0]` |
| expansion | `1.0f`，bits `0x3f800000`，实际 ScaleEnlarge 分支 |
| post-crop Rect | `[185,81,277,277]` |
| crop | 277×277 BGR，230,187 bytes |
| resize / prepared | 160×160 BGR，76,800 bytes；header 不同，storage 相同 |
| tensor | signed int8 `[1,160,160,3]`，raw `[1,6]` |

这次 `[185,81,277,277]` 是**实际回写和自有 crop 计算都验证的结果**，不再只是从 matrix 反解的假说。不能把旧文档中的假说直接当作新生产函数的输入；生产函数仍从 pre-crop Rect 开始。

实际 source SHA：`cd085c3ebfe378aa85c40cc967301558c13ba444dc74ef214b6948367eca3349`。

实际 crop SHA：`d1c41b0e5b75762503cf797e2bbdf34ed3b1e42b3e8577177d828aef534edb0f`。

实际 resize/prepared SHA：`306a151882a45c83324d817b1cd1fe4c3b06f1cd6b250c2e3c73d1c6b97bd714`。

实际 int8 tensor SHA：`dd260011e481c0270c15cb2a3aa9863fc3e28f11cb1caddf960a43768c9110ef`。

## 自有重放结果

`face_preprocess_replay.prepare()` 只接收 algorithm RGBA 和 caller 参数。捕获的 source、crop、resize 和 NN tensor 在生产函数返回之后才作为 oracle 比较，不能喂回生产函数或用于拟合。

| 比较阶段 | 每次元素数 | 两次结果 |
| --- | --- | --- |
| own BGR vs source | 921,600 | 0 mismatch |
| own crop vs crop | 230,187 | 0 mismatch |
| own resize vs resize | 76,800 | 0 mismatch |
| own post-crop Rect vs 回写 | 4 | 精确相同 |
| own int8 vs NN input | 76,800 | 0 mismatch，max abs 0 |

最终重放目录：`.local/jianying-model-pytorch/face-160-preprocess-replay-20261003-r5/`。包含报告及两个调用的 source/crop/resize PNG；已经人工查看裁剪与缩放图。

旧 direct-affine 方案的两个 67,068/76,800 mismatch 结论保留，没有改旧 sampler、旧审计或阈值让它转绿。本轮是新增真实 caller 路径和新的重放 profile。

## 测试

本轮最终 CPU 回归 **242 tests passed**：新增 memory 43、probe 33、LLDB 状态机 29、独立 replay 41，共 146 项；已有 160 sampler / alignment input / sampling / geometry 回归 96 项。没有启动模型或 GPU 的合成测试与上述实际宿主采集分别记录，不互相替代。

新增回归覆盖部分读/越界/stride、实际 caller 分支、协议分隔符与时间戳、prediction/face/network 关联、仅硬件断点与最大活动预算、Mat header 复制、异常停止/未完成状态、timeout-exit race 的进程回收、显式 oracle SHA、非空双案例、生产输入不可混入 oracle、输入不变和持有独立输出。

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B -m unittest \
  face_preprocess_memory_test face_preprocess_probe_test face_preprocess_lldb_test \
  face_preprocess_replay_test face_host_sampling_160_inputs_test \
  face_alignment_sampling_test face_alignment_input_test face_geometry_test
```

没有修改前端，本轮没有重新运行产品 Electron E2E、全仓库测试、CI 或发布；前一检查点的产品 E2E 不算本轮新 driver 验收。

## 仍依赖什么

- 原生宿主仍负责从完整编辑画面形成 640×480 algorithm RGBA；本轮没有独立复现这个上游缩放。
- 人脸检测及实际 pre-crop Rect、flags、expansion 选择仍来自原生。自有采样不等于自有人脸检测/跟踪路由。
- 本轮未把新 tensor 接入 160 ONNX → seed → temporal → coordinate mapping → renderer 的完整新审计；旧 ONNX/seed/平滑/渲染验收仍属于旧锁定 profile。
- 当前格式/旋转只动态验证 `format=0, orientation=0`。allocator flag 1、侧脸、多脸、其他尺寸/旋转/扩框和分钟级视频未验收。
- 实验室 candidate provider 仍 `not-connected`。没有启用任意画面按钮、预览或导出替换；没有修改旧产品能力声明。
- 模型/效果资产依赖与软件运行库依赖是不同问题；像素零差不证明资产授权、跨平台或发布可用。

## 下一步

1. 新建独立审计 profile，把本轮**自有生成**的 160 tensor 接入已有 ONNX/seed/平滑/坐标回映重放，逐阶段比较，不使用 native 最终点校正，不修改旧 50 source。
2. 与相同 renderer 重验最终 RGBA。捕获 stage 成功和 tensor 相同，不能替代最终 renderer 产品验证。
3. 把 native algorithm RGBA/Rect/flags 的边界变为显式实时输入契约；再复现完整画面缩放和扩展 caller profile。
4. 只有真实 driver 对任意输入通过门槛，才注册实验室 candidate provider 并跑新的 QCut preview/export E2E；保持准确的 nativeDependencies。

## 复现

在 `qcut/` 目录，指定**未使用过的新目录**，不要覆盖上述最终证据：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B \
  research/local-model-pytorch/face_preprocess_probe.py \
  --capture .local/jianying-model-pytorch/face-host-geometry-sequence-20261003-r12 \
  --audit .local/jianying-model-pytorch/face-temporal-capture-audit-20261003-r7 \
  --out .local/jianying-model-pytorch/face-160-preprocess-host-next

env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B \
  research/local-model-pytorch/face_preprocess_replay.py \
  --capture .local/jianying-model-pytorch/face-160-preprocess-host-next \
  --out .local/jianying-model-pytorch/face-160-preprocess-replay-next
```

新 source 的哈希也属于捕获锁定条件；修改采集器后必须重新采集，不能用新代码解释旧报告却跳过哈希 guard。运行时、tensor、像素和私有效果资产都不提交 Git。
