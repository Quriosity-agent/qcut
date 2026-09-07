# libvideoeditor 非线性 property 调用链（2026-09-07）

本轮把真实 Video property 的一个非线性分支闭合为原创 C++20：两帧已选定、graph 为空、至少一个 curve type 非零，使用恒速 Segment 准备记录，选择控制点，再调用已有 cubic 算法。实际调用 `getPropertyValuesByTimeOffsetInner` 117,515 次，784,545 个输出值零差异；两个镜像、SDK 工厂和真正的 VEUtils 虚调用槽均有身份校验。

这里验证的是 property 输出，统计包含该分支内部的原值复制回退，不能把 784,545 个值全部称为 cubic 调用。它仍不是完整 property dispatch、graph/曲线变速、seek 状态机或 QCut 预览/导出接入。

## 固定样本和交付范围

工作树起点：`6c561d0ca5e9415896aae802aaa6af6cbf8df1e0`，`codex/jianying-binary-cpp-next`。样本为本机剪映专业版 11.3.0，均从 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/` 只读加载：

| 文件 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

新增 `research/independent-editor-contract/nonlinear_property.hpp/.cpp`，独立 fixture、tests 和可选 native probe。它复用前轮 `segment_time`、`time_adapter`、`bezier` 的原创实现，没有复制或另写一套近似 cubic。`native_keyframes.hpp` 集中提供真实 curve/values/control getter/setter；旧 `segment_time_probe.mm` 改用相同控制点助手，删除重复的测试准备代码。旧九个单元保留。

原始反汇编、诊断二进制、数值结果及 manifest 位于仓库外：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/editor-nonlinear-property/`。没有读取或修改用户草稿，没有注入运行中的剪映，没有构造 SDK 对象的伪内存、虚表或控制块。

## 静态控制流与原生证据

下列地址是固定 arm64 slice 的未滑动地址。无已确认符号名的内部函数仅用地址标识；反汇编工具显示的“最近符号+偏移”不当作函数名。

| 步骤 | 地址 | 证据与本轮范围 |
| --- | --- | --- |
| 实际 property 入口 | `0x33f35f4` | 真实 Segment、group、两关键帧调用；不替换成独立 resample |
| 原始查询窗口中点、三次 relative time 转换 | `0x33f3ad8–0x33f3bb0` | 回绕中点、query/left/right 的 Segment 时间调用 |
| curve 分支 | `0x33f3c0c–0x33f3c28` | 两侧都为 0 才进入旧 linear 分支；任一非零进入本轮路径 |
| 打包两记录 | `0x33f3c2c–0x33f3ca8` → `0x1e91c80` | 传 `includeGraph=true`，真实记录工厂 |
| curve=0 清控制点 | `0x1e91d74–0x1e91dbc` | 在后续恒速转换之前清零；非零类型复制控制点 |
| 空 graph | `0x1e90338–0x1e90344`；`0x3a14034–0x3a14058` → `0x3a1523c` | graph 转换为空，expand 返回空列表；没有恢复非空 graph 算法 |
| 两原记录回退 | `0x33f4180–0x33f4224` | expand 为空时组成两记录列表，再回到共同时间解析路径 |
| 恒速记录准备 | `0x33f3d10–0x33f3d18` → `0x1e92190` | 复用上一轮验证的 source clamp、FCVTZS、控制残差 |
| 解析后记录选择 | `0x33f3d4c–0x33f3e00`、`0x33f4230–0x33f4234` | first-record 自区间、两记录区间与尾部回退 |
| 控制点/float 参数组装 | `0x33f42dc–0x33f43c8` | 无 graph channel arrays 时选左 outgoing / 右 incoming，double 相加后窄化 |
| 结果 float→double | `0x33f42ac–0x33f42bc` | 计算路径统一存回 double vector，但精度已经经过 float |
| 超过解析后末记录 | `0x33f47dc–0x33f47e8` → `0x33f4af4–0x33f4b58` | 直接复制原右关键帧 values |

本轮既有完整调用的原生差分，也有对应的静态分支证据；没有附加调试器或对每次跳转做运行时插桩。因此“走入该分支”的依据是实际输入、固定代码控制流、实际输出和能区分错误模型的反例，不是声称捕获了完整播放器的执行事件流。

## 真实工厂和 utility 生命周期

Segment、TimeRange、MaterialSpeed 使用[上一轮真实工厂](videoeditor-segment-time-2026-09-07.zh.md)。CommonKeyframe/group 仍由[更早验证的 SDK 工厂](videoeditor-window-selection-2026-09-07.zh.md)构造，public setters 设置时间、values、curve 和两个控制点。控制点 setter 先写 1 再写目标值，避免原生相等值抑制把请求的 `-0` 保留成工厂的 `+0`。每个 fixture 通过真实 graph getter 确认 graph 为空。

property 的 utility 入口 `0x2e877bc` 跳到 `0x3a821bc`，经一次性初始化 `0x3a8247c` 调用真正的 `getVEUtils` 并创建原生 shared control block。诊断调用这个准确工厂取得真实 shared_ptr，而非从外部塞入一个工具对象。它先验证对象 vtable 为 `libcccreator + 0x36aced0`，slot `0x168` 指向 `libcccreator + 0x1d803e8`，再调用 property。utility handle 保持到所有测试结束；镜像保持加载到进程退出，真实 SDK 控制块负责析构。

加载层同时核对请求文件和实际 image 的 hash、arm64、UUID、导出 anchor。四种失败入口均非零退出且 stdout 为空：参数不足、错误 editor、错误 creator、相对路径。两个已固定镜像之外的间接依赖没有逐库固定；私有 ABI 仍只支持本机已核验的 macOS arm64 构建。

## 纯 C++ API 的准确子域

`evaluate_nonlinear_property_interval` 接收 `ConstantSpeedSegment`、两个 `CurvePropertyKeyframe` 和已经由调用者解析的 raw window midpoint。输入不代表整个任意 group；它代表已经选定的两个邻居，而且 midpoint 严格在两 raw time 之间，不是精确命中。至少一侧 int32 curve code 非零。API 不承载 graph，也不把数字 curve code 猜成某个 UI 缓动名称。

两侧 values 必须同尺寸、非空，最多 2^20 个 scalar；values 和控制坐标允许 nonfinite。speed 必须正且有限，range duration 非负，延续上一轮的独立参数子域。映射后的端点和解析后的记录时间分别要求不降序，相等允许。违反这些条件会明确拒绝。这些是独立实现的验证边界，不是声称 SDK 会用相同规则拒绝输入。

原始时间单位仍不解释为秒或帧率。native corpus 的 point/range 窗口先经过真实回绕中点路径，独立侧用 `wrapped_midpoint` 得到同一 raw midpoint，再送入新 API。没有让新 API 隐式选择窗口，也没有用 `std::midpoint` 改变回绕规则。

## 控制点与时钟如何连接

每侧 curve=0 时，把 incoming/outgoing offset 都置零，再进行恒速 record 变换；任意非零 code 保留该侧存储控制点。此时清零的是原始 offset，不能在时间变换之后再清零，否则会丢掉 FCVTZS 截断形成的控制残差。

记原左右 keyframe 的 relative-sequence 时间为 `ML/MR`，query 的 relative-sequence 时间为 `Q`。先比较这个时钟上的范围：`Q<ML` 复制原左 values，`Q>MR` 复制原右 values。通过范围检查后，再将两关键帧打包并转换成 source-clamped 记录，时间记为 `RL/RR`，控制偏移也随之变换。record 的时间不减 Segment offset，而 `Q` 已减 offset；因此不能把 `ML/MR` 与 `RL/RR` 一概等同。

无 graph 的两记录路径有三个可观察结果：

1. `RL<Q<=RR`：左记录取第一项、右记录取第二项，进度分子 `Q-RL`、分母 `RR-RL`。
2. `Q<=RL`：两端都取第一条记录；进度仍保留进入扫描前的左边界 `ML`，成为 `(Q-ML)/(RL-ML)`。这可能退化成零分母，保留原 IEEE 运算，不擅自改为原始 double 的左值快捷返回。
3. `Q>RR`：直接复制原始右 keyframe values，完全不做 float 窄化。

普通两记录区间选的是左记录的 **outgoing** 和右记录的 **incoming**。first-record 自区间相应选同一记录的 outgoing/incoming。无 graph 的控制 x/y 为共享标量，适用于各个 value channel；带 per-channel 控制数组的 graph 路径未实现。

准备 cubic 时，整数记录 time 先转 double，再转 float；控制时间和值先在 double 与端点相加，再窄化为 float。进度使用回绕 int64 差→double 除法→float。已有 `evaluate_cubic` 保留真实 VEUtils 的 Newton/bisection 策略和显式 fused y 运算，时间 Horner 运算则不融合。最终 float 结果扩大为 double 放回 vector；扩大不能恢复已经丢掉的精度。

## 有区分能力的反例

- 原创 golden 0 的值为 0.1→0.9，控制点为左 outgoing `(200000,0.9)`、右 incoming `(-200000,-0.2)`，时间 10000→990000 查询 500000。真实结果是 double 中承载的 float `0x1.866666p-1`，并非线性值 0.5。换错左右控制点立即失败。
- golden 1/2 分别只有右侧/左侧曲线非零。仍给零侧设置非零存储控制点，验证它们确实被忽略，而不是恰好测试输入本身为零。
- golden 3 采用 source trim、speed=1.2 和 offset=731。用 mapped bounds 代替 resolved bounds、改用 raw query、丢掉控制残差都改变真实输出。
- golden 4 的 raw query 尚未命中原帧，但吸附到首个 record。输出 0.1 经 float→double 后 bits 为 `0x3fb99999a0000000`，不能直接返回原 double 0.1。
- golden 5/7 覆盖 record 尾回退和 mapped 范围回退，右值 0.9 保持原 double bits `0x3feccccccccccccd`。不能把所有返回结果都先转 float。
- golden 9 用大于 float 精确整数范围的 values 和小控制偏移，区分“double 相加后窄化”与“分别先窄化再相加”。
- golden 10 另外对尾部 copy 做原始 bits 断言，`-0`、quiet NaN payload、signaling NaN payload 均保留。这条复制语义与算术 NaN 分类的保证分开。

## 测试结果与负控

矩阵完整交叉 48 种 curve-code 对（从 7×7 排除双零）、9 种正有限速度和 8 种时间/range 组合，共 3,456 个矩阵配置；另加 11 个原创 goldens。code 包括 0、1、2、3、-1、int32 最小/最大；只验证数字上的零/非零语义，不替它们命名。速度包含普通分数、1e100、1e-100；时间组合覆盖 trim、源范围前后、±999/1000 邻域、两端吸附到同一时刻、不一致 target duration、超过 2^53 的 raw time。values 有 1/3/8/17 个 channel，混合普通数、极值、NaN/Inf/signed zero；还覆盖逆向/越界控制时间。

每个配置按原顺序和逆序查询，使用 point window 和不包含关键帧的短 range window。调用次数包含这些重放和部分重复边界点，并非声称 117,515 个窗口都唯一。

| 检查 | 最终结果 |
| --- | --- |
| 实际 property 调用 | 117,515 次，0 mismatch |
| property 输出值 | 784,545 个：729,127 非 NaN 逐 bit 一致，55,418 NaN 分类一致 |
| 算术 NaN payload | 不承诺；只有独立 copy golden 另做 payload 位验证 |
| source frame 快照 | 6,912 次数据、controls、graph、局部 mutation bytes 检查均未变化 |
| 纯 C++ Release / Werror | 10/10 CTest 通过 |
| 纯 C++ ASan+UBSan、禁止恢复 | 10/10 CTest 通过 |
| 新 native probe 两构建 | Release 和 sanitizer 均通过，解析后的 JSON 完全相同 |
| 四个旧 native probe 回归 | setter/JSON、resample/cubic、window、Segment-time 结果分别与上一轮 JSON 完全相同 |
| 纯 C++ 原生 fingerprint | 117,515 次/784,545 值固定为 `13853290106620421073`，NaN 采用统一分类值入 hash |

18 个实际负控全部非零失败：11 个私有算法变体分别保留零侧控制、只认 type=1、换错控制方向、混用进度边界、混用 query 时钟、尾回退窄化、首端点原值快捷返回、丢失控制残差、提前 float、融合时间 Horner、去掉 cubic y 的融合；另将“零侧仍保留控制”的错误实现与真实 SDK 比较，得到明确 mismatch。其余为四种入口身份/参数错误、一项故意有符号溢出的 fail-closed UBSan、以及 fast-math 编译拒绝。

两个 FMA 变体由完整原生 fingerprint 抓住，其他算法变体已被明确 golden 抓住；测试不是只把同一份实现运行两次作比较。所有修改发生在私有复制件，未降低正式断言或改 SDK。Sanitizer 覆盖原创库和诊断层，安装的 SDK 本身不是 sanitizer 构建；仅 native sanitizer 运行关闭 SDK 全局初始化相关的 leak 检测，独立 CTest 保持正常 leak 设置。

## 复跑与证据索引

从 QCut package 目录：

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-nonlinear -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-nonlinear --parallel
ctest --test-dir /tmp/qcut-editor-nonlinear --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-nonlinear/editor-nonlinear_property-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-nonlinear.json 2> /tmp/editor-nonlinear.stderr

cmake -S research/independent-editor-contract -B /tmp/qcut-editor-nonlinear-san -DCMAKE_BUILD_TYPE=Debug -DEDITOR_CONTRACT_SANITIZERS=ON -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-nonlinear-san --parallel
ctest --test-dir /tmp/qcut-editor-nonlinear-san --output-on-failure
ASAN_OPTIONS=detect_leaks=0 DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-nonlinear-san/editor-nonlinear_property-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-nonlinear-san.json 2> /tmp/editor-nonlinear-san.stderr
```

本轮本机 AppleClang 21/macOS arm64。原生目标默认关闭，非 macOS arm64 拒绝配置；独立静态库只依赖标准库。本轮不以本机通过宣称 Linux/Windows 原生 ABI 或任意版本 SDK 可用。

私有 `verification.json` 包含所有交付源码/本文 SHA-256、命令、结果、原始证据与最终 JSON hash；原始前轮 Segment 时间证据只引用并取 hash，不复制到仓库。关键新增证据如下：

| 私有原始证据 | SHA-256 |
| --- | --- |
| `property-branch.arm64.txt` | `ee12b46d0d0962a7be3c4fa5c1859db7fa3696814b9d5da7b4274b6867ae5960` |
| `pack-record.arm64.txt` | `c1faba4e3d37f187fff20a10d5b654f83b25d15b78562de592ad0c0474f473e4` |
| `fallback-original-records.arm64.txt` | `cbbb866add645908e8644579f93635a7ac8f8a42e1df3f19ed65df7782d7a1b3` |
| `property-evaluate.arm64.txt` | `cb100e6a372492da63ffaaf98d97b1e644dd21d8f5f0ac536478f4bbd557ee5f` |
| `record-range-cleanup.arm64.txt` | `bf83e3f463a9f5f110204b9ce6a5ff380fd9833789f2619fcaedd45686531f8a` |
| `utility-wrapper.arm64.txt` | `a49075584d414c38d4d63dcb94816d127e56a9666e223e14949a178814387dce` |

下一项可定点恢复非空 graph 的原生构造、展开记录和 per-channel 控制数组，再复用本轮真实 property oracle。曲线变速积分/反解、其他 Segment 类型、任意列表/精确命中/降序配置的完整 dispatch、UI curve 名称、编辑事件/undo 与播放器 seek 状态仍未完成。这里的 frame 快照只说明本测试语料下源帧未变，不证明 SDK 全局没有缓存或副作用。
