# 关键帧求值：合并重采样与实际 Bézier 入口

日期：2026-09-07。本轮新增两块原创标准库 C++20 数值实现：多通道线性重采样、实际属性求值使用的浮点 Bézier 求值器。它们各自已经过独立进程的原生差分；这不等于整个编辑器的关键帧、seek、事件或渲染链已经还原。

## 身份与调用边界

本机仍为剪映专业版 11.3.0。重新检查的两个原始 universal 文件如下，地址均为其 arm64 slice 的未滑移虚拟地址。

| 原始文件 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

原始路径为 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/` 下同名文件。新原始证据均在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/editor-next/`；仓库只保留原创实现、数值测试样例和说明。没有修改、附加或注入正在运行的剪映，也没有打开真实草稿。

## 一、合并使用的多通道线性重采样

**静态证据**：`lvve::KeyframeUtils::interpolate_values` 为 `0x3414408–0x3414890`，参数是时间数组、二维 double 值数组、查询时间数组、bool。`linearMergeKF` 内 `0x3413acc`、`0x3413c08` 的直接调用指向它；因此此处命名为“合并重采样”，不把它叫作播放时的 seek evaluator。

原创实现是 `research/independent-editor-contract/resample.hpp/.cpp`。已恢复规则：

1. 每个查询重新从第一对时间开始扫描，取第一个闭区间 `left <= query <= right`。输入顺序有意义，不先去重、不排序、不用上一次查询位置。
2. 每通道按 `(rightValue-leftValue) * ((query-leftTime)/(rightTime-leftTime)) + leftValue` 求值。`0x34145fc–0x3414610` 是独立的减、除、乘、加，不能融合成 FMA；即使查询正好在端点也执行该算术。
3. 至少两个时间点、且查询在首尾范围内时才走插值。其他情形 bool=false 输出同维度零行；bool=true 时 `query<=first` 取首行、`query>=last` 取末行，其余仍为零。
4. 单时间点并不自动返回该值：bool=false 时所有查询都为零。NaN 查询的比较均不成立，两个 bool 模式均输出零。无穷查询在 hold 模式取相应端点。
5. 重复时间合法但未被修补。例如 times=`[0,0,1]`，values=`[2,4,8]`，query=0 命中第一对零长度区间并返回 NaN；times=`[0,1,1,2]` 的 query=1 则先命中 `[0,1]`，返回第一个 time=1 对应值。
6. double 值差溢出、NaN/无穷值传播和 signed-zero 运算保留，不使用数值更稳定但语义不同的替代式。

**独立输入策略**：原函数在入口直接读取首个值行，没有这里的完整形状检查。我们的接口拒绝空时间序列、时间/行数不一致、非矩形行、非有限或降序时间；允许空通道和空查询。时间点、查询、标量数分别受上限约束，输入/输出标量预算为 `2^20`，最坏 interval 扫描预算为 `2^24`。这些是独立实现的资源边界，不能归因于原生验证。原生差分仅调用已核验的合法矩形、非降序有限时间域。

**原生证据**：真实 libc++ `std::vector` 作为入参和返回值，未构造 SDK 模型假对象。256 个序列覆盖 1–17 时间点、0–8 通道、重复时间、端点/区间外/非有限查询、正反查询顺序、两种 bool，共 1,024 次调用；检查行/通道数量及所有输入字节没有变化。

- 比较 88,392 个值，0 mismatch。
- 45,624 个非 NaN 结果逐位一致，包括正负零和无穷。
- 42,768 个结果双方均 NaN；只保证分类一致，不声称 NaN payload 一致。

## 二、实际属性 Bézier 求值越过了库边界

**静态调用链**：

| 步骤 | 地址和含义 |
| --- | --- |
| 属性入口 | `libvideoeditor` `KeyframePropertyHelper::getPropertyValuesByTimeOffsetInner`，`0x33f35f4` |
| 选择关键帧 | 调用 `KeyframeUtils::findKeyframeByTimeOffset_`，`0x340b6a8`；另有曲线类型、图形和字幕分支 |
| 区间归一化 | `0x33f4278–0x33f42a4`：先对 int64 做减法，再转换 double、除法，最后转 float |
| 控制点转换 | `0x33f4370–0x33f43b0`：时间由 int64 转 double；控制偏移与值在 double 相加，再将八个坐标转 float |
| 实际虚调用 | `0x33f43b4–0x33f43c8`：utility vtable `+0x168`；第九个 float 是已归一化查询，输出经 float 引用返回，再扩宽 double |
| 工具对象来源 | `0x2e877bc → 0x3a821bc`，初始化 `0x3a8247c` 经导入 `getVEUtils` |
| 另一库入口 | `libcccreator` `getVEUtils` `0x1c3077c` 返回真实单例；`VEUtilsImpl::interpolationCubicBezier` `0x1d803e8–0x1d804e0` |
| 实际求根 | 入口在 `0x1d8047c` 调用内部 helper `0x743284–0x7433f8`，导数 helper `0x74354c–0x743578` |

两次 int64 减法为 ARM64 模二进制运算；不能在未来 C++ 时间适配器里直接引入 signed overflow。当前公共函数接收已经准备好的 float 控制点和归一化进度，没有擅自实现未完成的邻帧选择、时间转换或曲线分派。

原创实现是 `bezier.hpp/.cpp`。设四个时间/值点为 `(x0,y0)…(x3,y3)`，调用方给出的进度为 `p`。它不是绝对查询时间。恢复算法：

1. 用 `(x1-x0)/(x3-x0)`、`(x2-x0)/(x3-x0)` 建立横坐标三次多项式。系数和 Horner 算术均 float，时间求根处的乘、加不融合。
2. `p<0` 或 `abs(p)<1e-6f` 时取参数 t=0；`p>1` 或 `abs(p-1)<1e-6f` 时取 t=1。这两个比较是严格小于。
3. 从 t=p 开始，最多八轮 Newton。横坐标残差 `abs(x(t)-p)<0.001f` 就返回；导数绝对值 `<1e-6f` 则进入二分。每轮 Newton 的 t 通过 numeric min/max 限制在 `[0,1]`。
4. 二分区间重新从 `[0,1]` 开始，不从 Newton 周围开始。中点按分开的乘加计算。区间宽度 `<=1e-6f` 停止；残差门限仍为 `0.001f`。
5. **二分耗尽时返回最后一个 Newton 候选值至多为 1，而不是最后的二分中点。** 独立代码保留这个行为，不主动改善求根器。
6. y 使用 Bernstein 项的特定 float 运算顺序，三个累加点明确是 fused multiply-add。实现只在这三处使用 `std::fma`。端点仍执行 y 算术，所以无穷控制值可能经 `0*∞` 传播 NaN。

函数没有持久 seek 游标，也不钳制 y 到 0–1；可输出负值和 overshoot。相同时间端点、非有限输入仍在有界搜索中完成，保留 IEEE 算术。验证环境为默认 round-to-nearest 和渐进下溢；未宣称其它浮点环境等价。

### 不能替换成同名自由函数

库内还有 `getInterpolationCubicBezier(float ×9)`，`0x219ab10–0x219af60`。它的时间 Horner 使用 FMA，实际虚方法没有。相同 40,000 组输入中，两者有 **4,047 个有限输出的 bits 不同**。第一组反例的输入/输出已保存在原生 JSON sample index 1：实际 wrapper 输出 `0x41c1bed6`，自由函数输出 `0x41c1beda`。因此本实现以真实属性调用链对应的虚方法为依据。

**原生证据**：单独进程先验证两库 SHA/UUID/anchor，调用真正 `getVEUtils()`，核验重复调用返回同一对象、vtable=`base+0x36aced0`、槽 `+0x168`=`base+0x1d803e8`。未自行制造或替换虚表。每次检查 status=0、输出前后 canary 不变。

- 40,000 个结果，0 mismatch；39,803 个非 NaN 逐位一致，197 个双方 NaN。
- 包含退化控制时间、乱序/越界控制点、负值和 overshoot、进度端点邻域/次正规/无穷/NaN、部分非有限 y。
- 24 个小型原生数值样例成为无 SDK 的回归测试；它们不是厂商源码或资源资产。

## 三、时间选择与事件仍须分开说明

`findKeyframeByTimeOffset_` 本轮完成了有界静态阅读，未进行复杂模型原生构造。`0x340b6ec–0x340b710` 先计算 wrapped `(windowStart+windowEnd)/2`，负数除法截零。`0x340b740–0x340b768` 从头扫描，遇到距离不再严格变小时结束，不是对任意无序列表求全局最近点。等距离保留先到的候选。`0x340b790–0x340b798` 对查询窗口做闭区间命中判断。

bool=true 的命中路径在 `0x340b928–0x340b938` 访问 non-const list 并调用内部修改 helper。该分支及完整排序/删除/图形依赖还未做原生验证，因此没有把它塞进所谓“通用 seek 状态机”。本轮纯 resampler 的重复时间和无状态证据，也不能自动推广到这一模型入口。

请求到 MaterialEffect / 已有 ID common keyframe / reset 的服务端连接由同期 [creator/editor 事件记录](creator-editor-events-2026-09-07.zh.md) 单独覆盖。本模块尚未把实际 `effect:seek`、动画采样、缓存失效、播放/导出时钟或完整 undo/event 列表接入 QCut 产品。它也不替代整套 `libvideoeditor` 或 `libcccreator`。

## 验证与复现

从 QCut package 目录运行 [README](../../../research/independent-editor-contract/README.md) 中 Release、ASan/UBSan 与可选原生诊断命令。新可执行文件为 `editor-evaluation-probe`，必须给两个绝对库路径；设置 `DYLD_LIBRARY_PATH` 指向安装目录 Frameworks。诊断 stdout 只输出 JSON，厂商初始化输出导向 stderr。

Release：5/5 CTest 通过。ASan + UBSan：5/5 通过，`-fno-sanitize-recover=all`；全部编译启用 Werror，非 MSVC 使用 `-ffp-contract=off`。旧三个合同仍在同一套测试中，没有减断言或跳过。

原始静态证据：`interpolate-values.arm64.txt`、`property-easing.arm64.txt`、`cubic-sdk-wrapper.arm64.txt`、`cubic-inversion-helper.arm64.txt`、`cubic-evaluation.arm64.txt`、`get-ve-utils.arm64.txt`、`find-keyframe.arm64.txt`。薄 slice 下使用 `xcrun llvm-objdump -d --demangle --start-address=… --stop-address=…`；不得加会忽略地址边界的 Mach-O 全量反汇编选项。

最终动态证据为 `native-evaluation.json`、`release-tests.log`、`sanitized-tests.log`。`negative/results.json` 记录三种算法变异均 exit 1：Newton 八轮改零轮、时间 Horner 改 FMA、跳过重复时间；fast-math 编译及缺参/相对路径/错误第二库身份也都失败。完整源文件和证据 SHA-256 清单保存在同一私有目录 `verification.json`。

本轮编译/执行平台仅为本机 AppleClang 21、macOS arm64。标准库实现未引入平台依赖；Linux/Windows 的实际执行结果仍待 CI 核验。下一步应通过经过验证的真实 CommonKeyframes 工厂建立完整模型测试，覆盖窗口选帧/重复时间、图形类型、seek 次序与实际事件链；不能用未验证的假对象强行补齐。
