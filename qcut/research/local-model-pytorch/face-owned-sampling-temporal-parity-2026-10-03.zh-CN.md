# 自写采样接通 ONNX 与真实渲染：静态零差分、动态时序边界

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
沿用 [PR #483](https://github.com/Quriosity-agent/qcut/pull/483)，逐文件提交并推送。
接续 [上一阶段实际几何验收](face-host-geometry-parity-2026-10-03.zh-CN.md)。

## 本轮结论

已经把上一轮仍依赖原生预处理的 **120 脸块采样**换成纯 NumPy 实现，接到 Torch-free ONNX、
自写解码/映射、QCut 持有的点位副本和真实效果渲染。静态四帧仍为零像素差。
不是把捕获的网络输入再次送入 ONNX：自写采样从实际 RGBA 和 forward 矩阵重新生成输入，
捕获输入仅用作逐字节验收参考。模型所有五个输出头仍按原门槛检查。

动态链路也已跑到实际渲染，但**没有全部对齐**。移动/镜像/恢复时，ONNX 解码后的 tracked 点
仍完全一致；tracked 到 FsNew 返回点之间发生时序变化，直接替换消费端点会跳过这一段。
候选的动态几何门槛明确失败，没有放宽阈值、拟合修正，或开启为编辑器默认后端。

```text
QCut 原始画面 + 大眼参数
  -> QCut 自写研究宿主 + 原生检测/跟踪/实际几何
  -> 实际算法帧 RGBA，640x480
  -> 自写 split-quantized 采样 -> int16 BGR-128
  -> Torch-free ORT 1.22.1，120 Stage1 五头
  -> 自写 mean/order 解码 -> 逆矩阵映射 -> tracked 点
  -> [动态未复现：原生输出时序处理/缓存插值的实际路由]
  -> 自写 float32 归一化 -> replay -> QCut 隔离副本
  -> 原生 Adapter / 模型元数据 / 效果包 / GPU 渲染
  -> RGBA 结果、统一增益灰度差分
```

当前检测、几何矩阵/表、接纳规则、身份与最终渲染仍需原生资源。
160 的两次动态初始化输入仍来自捕获，不能把 120 采样的独立化写成整个后端独立。
这些是自写宿主内的真实运行，不是本轮新的剪映 GUI 导出，也不是 QCut 预览/导出产品 E2E。

## 采样误差如何消除

旧 OpenCV nearest/linear 在每份 43,200 元素输入中分别有 16,625/31,657 个不同元素。
原因不是通道交换或网络精度，而是原生采样把列贡献和行贡献**分别量化后再相加**，
普通最近邻/线性插值不能替代这个规则。

锁定库静态指令与实际入口对照支持如下已验证 profile；`f32` 表示明确的 float32 舍入：

```text
F = [a b tx; c d ty]                 # 使用 forward，不直接拿捕获的 inverse 采样
det = f32(f32(a*d) - f32(b*c))
h = f32(1.0 / float64(det))
p,q,r,s = f32(d*h),f32(-b*h),f32(-c*h),f32(a*h)
u = f32(f32(-p*tx) - f32(q*ty))
v = f32(f32(-r*tx) - f32(s*ty))
Q(z) = signed16((round_even(f32(1024*z)) + 512) >> 10)
sx = Q(f32(p*x + u)) + Q(f32(q*y))
sy = Q(f32(r*x + v)) + Q(f32(s*y))
```

目标像素 x/y 为整数，没有额外 0.5 偏移。每个目标像素只取一个 RGBA 源像素；越界为零。
只取 RGB 并转 BGR，之后转 int16 再减 128。两份量化表的 int16 截断必须保留。
原生浮点控制寄存器没有单独读取；目前证明的是 nearest-even profile 的行为一致，
不能宣称任意运行环境的舍入模式均相同。

| 采样验收 | 结果 |
| --- | --- |
| 实际静态 120 输入，20 次预测 | 每次 43,200 元素逐字节相同 |
| 实际动态 120 输入，25 次推理 | 全部逐字节相同，含随后被拒绝的无脸推理 |
| 七种合成变换 x 两个原生入口 | 14 项相同，覆盖分数平移、缩放、旋转、边界 |
| 独立实现导入原生库/读取参考张量 | 均不需要 |

fallback/fused 在本次控制中都一致，但其中一个原生入口的指令求和顺序存在 FMA 差别。
实际宿主到底选择哪个入口、配置何时变化，还没动态观察；`preprocessing_route_verified=false`
保留。输入逐字节验收为真，不等于所有条件分支都已独立复现。

## 静态完整数值链

重新生成静态采集 R11、独立采样 producer R2、owned E2E R2，不使用旧结果替代重跑：

| 阶段 | 数量 | 结果 |
| --- | ---: | --- |
| 原生双观察器中立性 | 四帧 | 改变像素 0 |
| 120/160 五头 ONNX 验收 | 105 项 | 原门槛通过，raw 关键点精确相同 |
| 自写采样 -> 自写 Stage1 解码 | 20 次 | 输入、Stage1 点精确相同 |
| 逆矩阵映射 -> tracked | 20 次 | float32 点精确相同 |
| 归一化、实际人脸 ID | 18 次 conversion | 精确相同 |
| 候选点在真实副本内被消费 | 四帧 | 改变像素 0，最大 RGBA 差 0 |
| 相同点控制 | 四帧 | 零差分 |
| 眼部 X +0.01 / -0.01 | 各四帧 | 分别改变 24,607 / 24,713 个像素 |
| 错误 replay 实际宿主拒绝 | 七类 | 全部通过 |

通用 E2E 的 `model_parity_verified=false` 保留，因为通用消费者不鉴定文件是否来自 ONNX。
必须联合 producer 的头部验收和 E2E 的候选像素结果，不能改一个通用布尔值制造“独立成功”。

## 动态真实链与已定位差异

七帧素材是同一张生成的成年正面肖像衍生的静态、平移、镜像、灰色无脸、恢复、效果零、效果半强度。
输出 1448x1086，算法帧 640x480。不是七位真人，也不是分钟级真实视频。
两台新宿主各先六次预热；每个请求两次内部 seek，共 26 次预测、24 次副本转换/恢复。

原调用会在第 18 次预测的接纳检查后不读取若干输出头，但网络已经完成推理。
新增可选 `QCUT_BYTENN_CAPTURE_TERMINALS=1`，只对声明了完整五个 Stage1 头的网络，
在成功推理后通过原 Extract 只读获取输出。默认行为不变，没有增加推理，也没有改原结果。
观察器七帧零像素差；25 次 120 加两次 160 的 **135 项五头验收全部通过**。

| 动态阶段 | 验收 |
| --- | --- |
| 25 份自写采样输入 | 逐字节一致 |
| 24 组有效 Stage1 / tracked 点 | 全部精确相同 |
| 22 组有效最终归一化点 | 10 组不同，最大差 0.0075384378433 |
| 第 18 次预测 | 已推理但脸被拒绝，不发布旧点 |
| 第 19 次预测 | 无 120 推理，不复用旧输入/旧点 |
| 恢复 | 原生脸 ID 从 0 变成 1，候选保留对应身份 |
| 动态外部回放 | 24 次实际消费/恢复全部通过 |

新的只读探针在原 FsNew 返回后捕获输出 count 和 106 XY 对。
count/数组/索引/有限值/边界均严格验证，只有单有效脸可关联；多脸仍拒绝猜测身份。

**逐层证据：**

- tracked -> 原 FsNew 返回点：预测 14-17、20-25 不同，最大 4.824615478515625 算法像素；
  初次冷启动预测 0 也不同，但没有对应渲染器 conversion，不能混进十组消费端差异。
- 原 FsNew 返回点 -> 原渲染器收到的归一化点：22 组有效脸全部零差；两组无脸数量一致。
- 因而这次动态差异位于 tracked 之后、返回结果之前，不在已通过的采样、NN 或归一化步骤。

诊断 replay 使用自写链的点，不从返回点补值。普通 producer 会抛错，不写 `replay.json`。
只有显式 `--diagnostic` 才写 `diagnostic-replay.json`，报告为 `passed=false`、`geometry_exact=false`。
普通动态 renderer 也拒绝该候选；诊断模式仅用于显示失败位置，不能作为启用条件。

### 像素结果与灰度图

每行四列为原生 baseline、候选、统一 x8 灰度差分、原始输入。
灰度值 `min(255, 8 * max(abs(RGBA 差)))`，比较在完整原尺寸完成；拼图缩小只为查看。
已目视检查差异集中于双眼；保存了原尺寸候选、逐帧差分及数值 bbox。

| 帧 | 状态 | 不同像素 | 最大 RGBA 差 |
| --- | --- | ---: | ---: |
| 00 | 静态 | 0 | 0 |
| 01 | 平移 | 41,522 | 100 |
| 02 | 镜像 | 42,185 | 116 |
| 03 | 无脸 | 0 | 0 |
| 04 | 恢复 | 39,659 | 88 |
| 05 | 效果 0 | 0 | 0 |
| 06 | 效果 0.5 | 20,532 | 16 |

不能把无脸/零强度的黑色差分计为有效美颜对齐。非零效果帧也检查了与原始输入不同。

## 时序处理的二进制证据与未确认部分

只做锁定本地库的静态反汇编，没有附加或启动剪映调试进程，没有修改原生代码页。
`liblens.dylib` SHA：`fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`。
以下为接口/地址关系的文字记录，不提交厂商指令转储或表数据：

- `convertMatToPoints`，0x2d66e4：普通分支把 tracked 矩阵发布到点向量，不在这一循环做时序数学。
- `FaceAlignmentTrackingOpt`，0x2db270：RunningTimeInfo 为 x5，发布向量位于该对象 +0x38。
- 跟踪调用者 0x334ac4 的两处 TrackingOpt 和 BaseInfoSmoothOutput 使用同一个 RunningTimeInfo 指针。
- `BaseInfoSmoothOutput`，0x37cc58：106 点分成 33+73，经两组 AvgFilter 后写回发布向量。
- 调用者检查 owner+0x7e5c bit0；清零分支包含 Base 平滑，置位分支走 Extra/Iris 平滑。
  owner+0x7e63 bit0 决定 Base 的优化/普通选项，不是总启用开关。
- `ExtractBaseInfoAndExtraInfo`，0x3381c8：发布点写入返回记录；stride 0x52c、XY 起点 +0x14。
  `GetAnalysisResult`，0x331c74：返回 count 位于输出 +0x6ab8。这些返回字段已实际捕获验证。
- `interpolate_face_info`，0x330f20：FsNew 的配置分支另有缓存插值，调用点 0x2c50f0，常数 0.5。

**不能断言这次必然是 Base 平滑造成全部差异。**实际分支启用状态、RunningTimeInfo 到十槽池的
完整关系、Extra/Iris 的作用、缓存插值是否经过，仍需有界动态探针确认。
现有逐层数据已证明误差区域，不证明每个候选函数的实际激活；不从曲线拟合滤波系数。

## 新文件职责与验收策略

- `face_alignment_sampling.py`：纯 NumPy 采样数学，独立测试舍入、边界、旋转及 int16 截断。
- `face_host_sampling_inputs.py`：真实 RGBA/矩阵/推理窗口的严格关联、输入生成与逐字节验收。
- `face_host_geometry_sequence_probe.py`：中立动态采集，不替换原生分析。
- `face_host_geometry_sequence_replay.py`：独立采样 -> ORT -> 解码 -> 严格候选或失败诊断。
- `face_host_geometry_output.py`：tracked/返回/消费者三层对照，绝不校正候选点。
- `face_host_geometry_sequence_render.py`：七帧实际消费、恢复、GPU 完成、像素与灰度验收。

沿用 LockedFiles、严格 JSON、网络 inventory、副本回放与原宿主协议，不另写一套解析器。
动态时间上限需显式选择：Python/原生均限 60,000,000 微秒；默认仍是 100,000 微秒。
64 条记录、十脸、106 点、顺序/身份/未消费数据门槛不变。
这是协议容量扩展，**不是分钟视频、无限生命周期或多脸已经测试通过**。

## 本机证据与复现

所有厂商模型、二进制、包、私有表、图像及原始记录均留在忽略的 `.local/jianying-model-pytorch/`：

- `face-render-model-capture-20261003-r5/`：当前静态编译宿主/ByteNN 基准。
- `face-host-geometry-20261003-r11/`：当前静态实际几何与返回输出采集。
- `face-host-sampling-20261003-r9/`：20 次实际输入及 14 项合成原生采样对照。
- `face-host-own-sampling-replay-20261003-r2/`：静态独立采样 producer。
- `face-host-own-sampling-owned-e2e-20261003-r2/`：四帧零差及 `comparison.png`。
- `face-host-geometry-sequence-20261003-r5/`：26 次动态预测与实际返回点。
- `face-host-geometry-sequence-replay-strict-20261003-r1/`：真实门槛拒绝，无 replay 文件。
- `face-host-geometry-sequence-replay-20261003-r6/`：失败诊断、135 项头部与三层坐标报告。
- `face-host-geometry-sequence-render-20261003-r4/`：七帧实际消费与 `comparison-sheet.png`。

旧失败/中间记录保留，不覆盖。运行目录为 `qcut/`，每次 `--out` 必须为新目录。
使用已有锁定 RUNTIME/PACKAGE，动态 MANIFEST 为七帧 fixture 的 `manifest.json`：

```bash
.local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python -B \
  research/local-model-pytorch/face_host_geometry_sequence_probe.py \
  --capture .local/jianying-model-pytorch/face-render-model-capture-20261003-r5 \
  --manifest "$MANIFEST" --runtime "$RUNTIME" --package "$PACKAGE" \
  --out .local/jianying-model-pytorch/dynamic-capture-fresh

.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_host_geometry_sequence_replay.py \
  --capture .local/jianying-model-pytorch/dynamic-capture-fresh \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out .local/jianying-model-pytorch/dynamic-replay-fresh --diagnostic

.local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python -B \
  research/local-model-pytorch/face_host_geometry_sequence_render.py \
  --capture .local/jianying-model-pytorch/dynamic-capture-fresh \
  --candidate .local/jianying-model-pytorch/dynamic-replay-fresh/diagnostic-replay.json \
  --runtime "$RUNTIME" --package "$PACKAGE" \
  --out .local/jianying-model-pytorch/dynamic-render-fresh --diagnostic
```

去掉 producer 的 `--diagnostic` 当前应失败且不生成有效候选；不能把进程退出成功等同于诊断通过。
静态命令继续使用上一文档的 producer/E2E，producer 加 `--independent-sampling`。

## 回归与下一阶段

当前 Python 主套件 **816**、采样套件 **22**，合计 **838 个通过，无跳过**；
相比前阶段 701 增加 137。portrait/provenance TypeScript **29 个通过**。
包括完整五头采集、输入替换、no-face/recovery、实际时序窗口、失败诊断不校正、
返回字段边界、Python/原生默认时间拒绝及显式扩展、宿主关闭与文件/源哈希守卫。
真实动态几何/像素门槛仍失败，测试通过不改变该结论，也不是 CI 绿色声明。

后续按以下顺序推进，不同时把所有原生模块替换掉：

1. 捕获实际平滑/缓存分支与对象身份，建立 tracked -> published -> returned 的每次调用窗口。
2. 先选择在原生时序处理之前安全接入自写 Stage1，或按已验证规则复现该时序处理；
   每个选择都必须保留移动/镜像/拒绝/恢复和七帧像素门槛，不拿最终点反推系数。
3. 动态零差后扩大真人移动、旋转、遮挡、多脸身份与分钟级材料，审计长期副本回收。
4. 再逐步替换检测/接纳、160 初始化、姿态拟合、Stage2/虹膜/遮罩，保留原生路径作对照。
5. 五官形变、皮肤与美妆消费分别验证，之后接产品 IPC、预览/导出和 Windows/x86。

本轮没有合并、发布，也没有把研究资源打进安装包。此时保留原生时序处理是明确依赖，
不是 UI 上有一个 ONNX 开关就算独立了。
