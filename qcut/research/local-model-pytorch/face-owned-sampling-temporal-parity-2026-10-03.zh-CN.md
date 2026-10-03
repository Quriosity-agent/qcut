# 自写采样、ONNX、时序平滑接通真实渲染：静态与有界动态零差分

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
沿用 [PR #483](https://github.com/Quriosity-agent/qcut/pull/483)，逐文件提交并推送。
接续 [上一阶段实际几何验收](face-host-geometry-parity-2026-10-03.zh-CN.md)。

## 本轮结论

已经把上一轮仍依赖原生预处理的 **120 脸块采样**换成纯 NumPy 实现，接到 Torch-free ONNX、
自写解码/映射、QCut 持有的点位副本和真实效果渲染。静态四帧仍为零像素差。
不是把捕获的网络输入再次送入 ONNX：自写采样从实际 RGBA 和 forward 矩阵重新生成输入，
捕获输入仅用作逐字节验收参考。模型所有五个输出头仍按原门槛检查。

第一次动态链路的移动/镜像/恢复曾失败，原因是直接使用 tracked 点跳过了原生输出平滑。
本次继续观察真实发布向量、实际 filter 参数与状态，并接入自写普通分支平滑。
新的七帧动态链路 **135 项五头、24 组平滑输出、22 组有效消费端点、七帧像素全部通过**。
不是拟合修正，也不是复制最终返回点；未开启为编辑器默认后端。
下面保留前一检查点的失败数值，标明历史记录，避免把不同轮次混成同一次成功。

本次进一步移除了预测 `[0,20]` 的**原生关键点 seed 来源**。R12 中立采集 -> R9 owned
初始化 producer -> R7 真实 renderer -> R7 审计全部通过，源码链从 49 增至 50。
160 ONNX `fc_landmark_s1` 是绝对检测坐标：按实际 order 重排，**不叠加 120 mean**，
使用实际 `detection_inverse` 做 double 中间运算并落到 float32。两个 106 点 seed 与原生
pre-update `previous` 精确相同；后者仅作零容差参考，不能校正或替代候选。
预测 1 仍依据真实 first 信号从 owned tracked 点重新初始化，其余帧持续推进 owned 历史。

```text
QCut 原始画面 + 大眼参数
  -> QCut 自写研究宿主 + 原生检测/跟踪/实际几何
  -> 实际算法帧 RGBA，640x480
  -> 自写 split-quantized 采样 -> int16 BGR-128
  -> Torch-free ORT 1.22.1，120 Stage1 五头
  -> 自写 mean/order 解码 -> 逆矩阵映射 -> tracked 点
  -> 自写 Base 33+73 平滑与持续历史状态
     [实际参数/初始化信号依赖原生；新脸 seed 来自 160 ONNX 绝对坐标逆映射]
  -> 自写 float32 归一化 -> replay -> QCut 隔离副本
  -> 原生 Adapter / 模型元数据 / 效果包 / GPU 渲染
  -> RGBA 结果、统一增益灰度差分
```

当前检测、几何矩阵/表、接纳规则、身份与最终渲染仍需原生资源。
160 的两次动态初始化输入仍来自捕获，不能把 120 采样的独立化写成整个后端独立。
这些是自写宿主内的真实运行，不是本轮新的剪映 GUI 导出，也不是 QCut 预览/导出产品 E2E。

## 本次并行推进与动态零差结果

三个 subagent 采用互不交叉的文件写入范围：纯平滑数学及测试、整链路报告审计及测试、
本地视频 fixture 及测试。主 agent 负责原生只读探针、实际状态验证、ONNX 集成、真实渲染、
代码复查和逐文件提交推送。没有另建 branch、worktree 或 PR；没有让多个 agent 编辑同一文件。

继续推进时再次隔离三个任务：160 初始化输入候选及测试、视频 SAR 显式策略及测试、
有界批量 capture/replay/render/audit 工具及测试。主 agent 负责 owned seed 解码、时序集成、
审计和真实验收；原生宿主串行运行，agent 不做 Git 操作，主 agent 逐文件 commit/push。

| 当前验收 | 数量 | 结果 |
| --- | ---: | --- |
| 新观察器中立性 | 七帧、26 次预测 | 改变像素 0 |
| 自写 120 输入 | 25 份 | 逐字节相同 |
| Torch-free ONNX 五头 | 135 项 | 原门槛通过 |
| 自写 Stage1 / tracked | 24 组有效脸 | 精确相同 |
| 自写平滑输出与状态检查 | 24 组有效脸 | current、必要的 previous/delta 精确相同 |
| 自写 160 初始化 seed | 预测 0、20 | 106 点精确相同，不读取原生点作候选 |
| 最终归一化点 | 22 组有效 conversion | 精确相同 |
| 无脸 | 预测 18、19 | 空结果，清除历史，不发布旧点 |
| 实际 owned 副本消费/恢复 | 24 次 | 全部完成 |
| 真实效果候选 vs baseline | 七帧 | 不同像素 0，最大 RGBA 差 0 |
| capture/producer/render 报告及源码链 | 50 份源码 | SHA 一致，审计 `pipeline_parity=true` |

当前对比图为 `face-host-geometry-sequence-render-20261003-r7/comparison-sheet.png`。
已目视检查七行：原生 baseline、候选、统一 x8 灰度差分、原始输入。
七张原尺寸 `frame-XX-diff-gain8.png` 全黑；非零效果也实际改变原图，不能用绕过效果冒充成功。
之前移动、镜像、恢复、半强度的 41,522/42,185/39,659/20,532 个不同像素现在均为 0。

### 已确认的对象关系与参数

实际 FsNew 十槽池的记录跨度为 400 字节，record+0 是已初始化 alignment 对象。
record+0x38 的发布向量实际 storage=280、capacity=512，但 Extract 只复制前 106 点。
这不是把点数门槛放宽：容器容量与有效返回点数分开验证，106 点输出门槛保持不变。
published -> returned 的 24 组有效脸、returned -> consumer 的 22 组有效脸均精确相同。
实际差异只在 tracked -> published；候选没有从 published/returned/consumer 补点。

alignment+0x10 和 +0x110 的两组 filter 分别处理 33、73 点。
实际两组参数均为 alpha=float32(0.2)、escale=10、width=480、height=640，
scale=float32((10/720)*480)=6.6666665077209473。
filter+0x74 是单字节 bool，首次四字节读取失败的 R9 保留；修正读取宽度后 R10 完整通过。

26 次运行状态均为 `base_output_mode_bit=false`、`optimized_output_bit=false`、
`config_cache_mode=0`、`cache_skip_bit=true`、`cache_counter=0`。
这与锁定指令中的普通 Base 分支和非正 cache mode 的直接调用路由相符，
并由普通分支数学及实际输出零差分共同验证；不推广到未捕获的 Extra/Iris/缓存配置。

### 自写时序数学

每个 X/Y 独立处理；`f32` 表示每一步明确的 float32 舍入，不可代数重排：

```text
d = f32(input - current)
h = d                                      # 首次更新
h = f32(f32(alpha*h) + f32(f32(1-alpha)*d))  # 后续更新
r = f32(abs(h) / scale)
w = f32(exp(-pow(float64(r), 0.5)))
output = f32(f32(current*w) + f32(input*f32(1-w)))
previous = current
current = output
```

历史是上一次发布输出，不是上一帧 raw input。初始化 scale 先将 float32 escale 向零取整，
再以 double 除 720、乘最小边长，最后转 float32；初始化不赋值 alpha，必须显式提供。
小 scale、空向量、大小变化、非有限值和不支持的配置均有明确处理或拒绝。
优化分支数学有合成测试，但本次真实验收走普通分支，不宣称优化分支跨平台 bit parity。

### 前一检查点的初始化依赖（R10/R8/R6，历史）

预测 0 和恢复新脸 ID=1 的预测 20，仍需要原生 filter 的 `previous` 作为初始化 seed。
该向量是本次更新之前的 current，不是最终 published/returned/consumer 点。
预测 1 的真实 first 标记表示重新初始化：使用自写 tracked 输入创建 current；
随后 2-17 和 21-25 持续使用自写状态推进，不每次复制原生 current/delta。
只把原生 post-state 用作零容差验收，失败就停止，不反求参数、校正候选或更新为参考值。

因此 `native_smoothing_initialization_required=true`、seed predictions `[0,20]`，
`native_analysis_bypassed=false`、`full_frame_geometry_independent=false` 保留。
原生采集仍执行原始网络；ONNX 候选在独立 producer 生成，再由另一个真实宿主消费。

### 当前 owned 初始化与尚未对齐的 160 输入

当前使用显式 `--owned-smoothing --owned-initialization`，无 native seed fallback。
缺 seed、旧脸/旧窗口 seed、重复 seed、错误类型、非有限值、参考不一致均拒绝，失败不推进历史。
`owned_initialization_used=true`、`owned_smoothing_seed_predictions=[0,20]`、
`native_smoothing_seed_predictions=[]`、`native_smoothing_seed_required=false`。
`native_smoothing_initialization_required=true` 仍表示参数/first 信号等原生依赖，**不再表示点 seed**。

160 输入不能直接套用已对齐的 120 affine sampler。对 R12 两个实际初始化窗口，
`detection_forward` + split-quantized 160 采样候选 **0/2 exact**：各有
**67,068 / 76,800** 个分量不同，最大整数差 **177**。这是预处理候选失败，不能推广成
ONNX 网络转换失败；当前同一原生输入下 160 五头和 owned seed 均通过原门槛。

锁定库的静态调用关系显示，`FaceAlignmentDet` 在 0x2d5f2c/0x2d5fd0 调用
`ProcessDetectionImage`，然后于 0x2d6030..0x2d60d4 构造检测变换。
受控子链此前已证明 resize 存在线性/最近邻分支，但尚未捕获真实宿主的裁剪参数、
插值标志及中间像素，不能由“最终坐标逆映射正确”推断“输入也使用同一 affine warp”。
这里只记录关系和地址，不提交厂商指令、表或包。

`face_host_sampling_160_inputs.py` 严格检查窗口、身份、算法帧、int8 存储和所有实际输入。
不匹配只生成失败诊断，不返回部分 replacement；不猜变换、不拟合、不拷贝捕获输入兜底。
当前审计明确拒绝 `independent_160_sampling_input_used=true` 的未验收 route。
实际 producer 加 `--independent-160-sampling` 亦已执行：退出 1、passed=false、无 `replay.json`，
失败记录在 `face-host-geometry-sequence-replay-160-rejected-20261003-r1/`，未运行替代 ONNX 或渲染。
下一步先增加只读预处理参数/中间缓冲区取证，再按真实 resize 路由实现独立输入。
这证明候选数值和渲染相同，不是已经替换实时原生推理、取消重复分析或打通产品 IPC。

### 视频测试工具的范围

`face_temporal_video_fixture.py` 使用 ffprobe 的整数 PTS/rational time-base，
按解码序号抽帧，记录 requested/actual 时间、源文件/工具/代码/图像/manifest SHA。
支持 1-24 帧和显式 0-60 秒窗口，等比缩放、黑边补齐，不把越界 seek 静默截断。
合成七帧视频、宽屏黑边验证通过；超时、部分提取、源变化、非方形像素失败关闭。
另试已有 QCut 一秒导出时，其 SAR 不满足明确的 `1:1`，已拒绝并保留失败报告；没有猜测比例。
这些不是分钟级真人视频验收，也没有把这一秒导出的 fixture 错写为成功。

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

## 历史检查点：未接平滑的动态差异

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

**在前一检查点不能断言必然是 Base 平滑造成全部差异。**当时实际分支启用状态、RunningTimeInfo 到十槽池的
完整关系、Extra/Iris 的作用、缓存插值是否经过，仍需有界动态探针确认。
当时逐层数据只证明误差区域，不证明每个候选函数的实际激活。本次已增加发布向量、
实际配置位、33/73 filter 状态及连续自写数学验收，结果见上方；仍不从曲线拟合滤波系数。

## 新文件职责与验收策略

- `face_alignment_sampling.py`：纯 NumPy 采样数学，独立测试舍入、边界、旋转及 int16 截断。
- `face_host_sampling_inputs.py`：真实 RGBA/矩阵/推理窗口的严格关联、输入生成与逐字节验收。
- `face_host_geometry_sequence_probe.py`：中立动态采集，不替换原生分析。
- `face_host_geometry_sequence_replay.py`：独立采样 -> ORT -> 解码 -> 严格候选或失败诊断。
- `face_host_geometry_output.py`：tracked/published/返回/消费者分层对照，绝不校正候选点。
- `face_host_geometry_sequence_render.py`：七帧实际消费、恢复、GPU 完成、像素与灰度验收。
- `face_temporal_smoothing.py`：纯 NumPy 滤波数学及显式参数，不加载厂商运行库。
- `face_temporal_smoothing_replay.py`：持续 owned 历史、实际初始化依赖及零容差状态检查。
- `face_temporal_capture_audit.py`：报告 SHA、数量、ID、时间、阶段和初始化依赖的只读审计。
- `face_host_initialization.py`：160 绝对坐标、实际逆矩阵和 owned seed 的严格解码。
- `face_host_sampling_160_inputs.py`：160 实际窗口/输入逐字节门槛，目前只通过失败诊断，不启用替换。
- `face_temporal_audit_metrics.py`：共享类型、零容差点位及像素报告检查。
- `face_temporal_initialization_audit.py`：普通平滑转移、owned seed 来源和实际 160 窗口检查。
- `face_temporal_video_fixture.py`：本地视频 decoded PTS 抽帧与可复现 manifest。
- `face_temporal_campaign.py`：1-4 个显式七帧 manifest 的串行真实四阶段验收及失败记录。

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
- `face-host-geometry-sequence-20261003-r10/`：前一检查点发布向量、配置、平滑状态、中立采集。
- `face-host-geometry-sequence-replay-20261003-r8/`：前一检查点自写平滑 producer，仍用原生 seed。
- `face-host-geometry-sequence-render-20261003-r6/`：前一检查点七帧零差。
- `face-temporal-capture-audit-20261003-r6/`：前一检查点三报告/49 源码链通过。
- `face-host-geometry-sequence-20261003-r12/`：当前源码版本的中立采集，26 个实际预测。
- `face-host-geometry-sequence-replay-20261003-r9/`：当前 owned seed + 自写连续平滑严格 producer。
- `face-host-geometry-sequence-render-20261003-r7/`：当前七帧零差和 `comparison-sheet.png`。
- `face-temporal-capture-audit-20261003-r7/`：当前三报告/50 源码链通过，点 seed 已独立。
- `face-host-sampling-160-20261003-r1/`：当前两个 160 输入候选失败诊断，0/2 exact，不提交 raw 数据。
- `face-temporal-video-fixture-smoke-20261003-r3/`：实际合成视频的七帧 PTS/图像证据。
- `face-temporal-video-fixture-smoke-20261003-wide-r2/`：实际宽屏比例与黑边验证。
- `face-temporal-video-fixture-editor-20261003-r1/`：QCut 一秒导出 SAR 门槛拒绝的历史记录。
- `face-temporal-video-qcut-export-sar-assumed-20261003-r1/`：显式 SAR 假设的七帧抽取，效果强度 0，仅抽帧验证。
- `face-temporal-video-qcut-export-eye100-20261003-r1/`：同一一秒 QCut 导出、七帧、大眼强度 1 的实际验收素材。

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
  --out .local/jianying-model-pytorch/dynamic-replay-fresh --owned-smoothing --owned-initialization

.local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python -B \
  research/local-model-pytorch/face_host_geometry_sequence_render.py \
  --capture .local/jianying-model-pytorch/dynamic-capture-fresh \
  --candidate .local/jianying-model-pytorch/dynamic-replay-fresh/replay.json \
  --runtime "$RUNTIME" --package "$PACKAGE" \
  --out .local/jianying-model-pytorch/dynamic-render-fresh

.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_temporal_capture_audit.py \
  --capture .local/jianying-model-pytorch/dynamic-capture-fresh \
  --sequence-replay .local/jianying-model-pytorch/dynamic-replay-fresh \
  --sequence-render .local/jianying-model-pytorch/dynamic-render-fresh \
  --current-source-root research \
  --out .local/jianying-model-pytorch/dynamic-audit-fresh
```

不加 `--owned-smoothing` 的旧路径仍不得跳过时序误差；显式 `--diagnostic` 只保留失败记录。
不能把进程退出成功等同于诊断通过。真实零差需要联合 producer、renderer 和 audit。
静态命令继续使用上一文档的 producer/E2E，producer 加 `--independent-sampling`。

批量工具对每个 manifest 串行启动上述四阶段，最多四个，默认超时每阶段 900 秒、总计 7200 秒。
脚本白名单、`shell=False`、显式 Python 环境、过滤继承环境、源/模型/包/原生库守卫、
报告与 replay SHA 链全部验证。失败停止后续阶段并记录 skipped；诊断或 partial 不能变为 passed。
需要精确七帧和 1448x1086，不能把 fixture 支持的最多 24 帧宣称为 renderer/audit 已支持。
这只是批次组织，不是原生宿主并发：GPU/native 取证必须串行，修改源码会触发守卫拒绝。

QCut 导出的视频 ffprobe 不提供 SAR。新增 `--assume-square-pixels` 是调用者显式假设，
仅接受缺失、`N/A`、`0:1`，不接受已声明非方形、错误或 null 数据。
原始 ffprobe JSON、调用参数、假设来源写入 `source.json`/报告；不伪造输入 metadata。
只有实际采用假设时，scale 前增加 `setsar=1`。默认继续严格拒绝，不改变源视频。
已抽取的一秒片共 30 帧，七帧 PTS 为 0/5/9/14/18/23/27（1/30 秒）；
多数帧画面相同，**不代表真人运动、多脸、遮挡、分钟级或实时编辑器测试**。

### 批量工具真实运行结果

`face-temporal-campaign-20261003-r1/` 总计 47.62 秒，两组四阶段均 passed，
`completed=true`、`pipeline_parity=true`，failures 为空：

| 素材 | 预测/转换/五头 | owned seed | native 点 seed | 最终不同像素 | 非零效果 vs 输入 |
| --- | --- | --- | --- | --- | --- |
| 移动/镜像/无脸恢复/零/半强度七帧 | 26 / 24 / 135 | `[0,20]` | `[]` | 七帧均 0、max RGBA 0 | 有脸非零帧 42,469-44,022；无脸/零强度为 0 |
| 一秒 QCut 导出抽出的七帧，大眼 1 | 26 / 24 / 135 | `[0]` | `[]` | 七帧均 0、max RGBA 0 | 每帧 41,141-42,224 |

两组均逐阶段验证 50 个源哈希和实际报告链；源码与 committed Git 的 50 个文件亦独立复核一致。
两张 `campaign-XX/render/comparison-sheet.png` 与 x8 灰度图保留在私有目录，已目视查看。
新素材也通过 owned 初始化，但 160 原生输入、检测矩阵/表、初始化信号和效果渲染仍依赖原生。
47.62 秒是这两组离线取证耗时，不是实时帧率或编辑器导出性能指标。

在 `qcut/` 下，用显式路径重跑，每次换一个 fresh 输出目录：

```bash
.local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python -B \
  research/local-model-pytorch/face_temporal_campaign.py \
  --base-capture .local/jianying-model-pytorch/face-render-model-capture-20261003-r5 \
  --models-root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --runtime "$RUNTIME" --package "$PACKAGE" \
  --warp-python .local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python \
  --ort-python .local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  --manifest .local/jianying-model-pytorch/face-sequence-fixture-20261003-r1/manifest.json \
  --manifest .local/jianying-model-pytorch/face-temporal-video-qcut-export-eye100-20261003-r1/manifest.json \
  --owned-initialization --stage-timeout 600 --deadline 1800 \
  --out .local/jianying-model-pytorch/campaign-fresh
```

## 回归与下一阶段

当前 Python 主回归 **958**、采样套件 **22**、批量工具 **19**，
合计 **999 个通过，无跳过**；相比前一 926 检查点增加 73。
portrait/provenance TypeScript **29 个通过**。
包括完整五头采集、输入替换、no-face/recovery、实际时序窗口、失败诊断不校正、
返回字段边界、Python/原生默认时间拒绝及显式扩展、宿主关闭与文件/源哈希守卫。
真实七帧动态几何/像素门槛现已通过；不是多脸、长视频、编辑器产品验收或 CI 绿色声明。

后续按以下顺序推进，不同时把所有原生模块替换掉：

1. 当前 `[0,20]` 点 seed 来源已替换并通过真实像素门槛；下一步先取证真实
   `ProcessDetectionImage` 裁剪参数、插值标志、中间像素和 160 消费窗口，修复 0/2 的输入候选。
2. 扩大真人移动、旋转、遮挡、多脸身份与分钟级材料，审计长期副本回收；
   SAR 不明默认拒绝，需要显式调用者假设且完整记录，不能写成源数据已证明方形像素。
3. 按实际激活配置逐项验证优化/Extra/Iris/缓存路由，不用普通分支通过覆盖所有 profile。
4. 再逐步替换检测/接纳、160 采样、姿态拟合、Stage2/虹膜/遮罩，保留原生路径作对照。
5. 五官形变、皮肤与美妆消费分别验证，之后接实时推理、产品 IPC、预览/导出和 Windows/x86。

本轮没有合并、发布，也没有把研究资源打进安装包。普通平滑数学及点 seed 解码已能由自写实现替代，
但原生 160 输入/初始化参数信号/其他几何与渲染依赖仍在；不是 UI 上有一个 ONNX 开关就算整个后端独立。
