# VideoEditor 正向曲线变速与属性时间合同（2026-09-08）

本轮交付可独立编译的 C++20 数值实现：正向连续曲线的 float 归一化、三段速度积分、二次方程逆求值、真实 Video 时间边界、控制记录准备，以及预选两个无 graph 关键帧的非线性属性组合。已通过真实 SDK 工厂对象差分；不是整库恢复，也未实现完整属性分派、播放器 seek、曲线编辑、undo 或产品预览/导出。

源码位于 [independent-editor-contract](../../../research/independent-editor-contract/README.md)。本次从 `7f44e4a11fb5` 的 `codex/jianying-binary-cpp-scaleup-20260908` 继续，未操作旧 worktree。全部厂商二进制、ASM、原生 JSON 和编译产物保留在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/editor-variable-time/`。该目录 `verification.json` 列出源码与证据 SHA-256；仓库仅包含原创实现、原创夹具及本说明。

## 1. 身份与调用边界

当前 `/Applications/VideoFusion-macOS.app` 为 11.3.0。入口先核验文件 hash、实际加载镜像 hash、arm64、UUID 和导出锚点；身份不符即拒绝 ABI 调用。

| 镜像 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

以下地址均为对应 arm64 镜像的未滑移地址。静态证据使用已有同身份 arm64 thin 镜像及非 `--macho` 的有界 `xcrun llvm-objdump -d --start-address=… --stop-address=…`。不能把地址用于别的版本。

| 层 | 真实入口 / 地址 | 本轮确认 |
| --- | --- | --- |
| CurveSpeed 材质工厂 | editor `0x1e72f48` | 原生分配 CurveSpeed / SpeedPoint 与 shared control block，直接读取返回点 x/y 验证参数布局 |
| CurveSpeedUtils 工厂 | editor `0x2d2574c` | 原生构造实际工具对象，真实 deleting destructor `0x2d2594c` 释放 |
| float 归一化 | editor `0x2d25960` → creator `0x1cd2478` | 返回 float vector；设置路径 `0x2d25998` → `0x1cd2658` 使用同样转换 |
| 速度核心 | creator `TECurveSpeedUtils`，set `0x29dd6d0` | 固定三段速度形状，时间尺度来自工具 duration |
| 序列到素材 | editor `0x2d25be0` → creator `0x29de2dc` | 三段定积分、整数平方低 64 位、最终舍入 |
| 素材到序列 | editor `0x2d25bfc` → creator `0x29de620` | 累积面积选段、二次根、最终舍入 |
| Video 时间 helpers | editor `0x340737c`、`0x3407dbc`、`0x340824c` | source / timeline / relative-sequence 三方向及端点、负时间分支 |
| 内部 Video 映射 | editor `0x3408934`、utility 准备 `0x34086e8` / `0x3408bc0` | target.duration 作为曲线时间尺度，负 delta 使用 MaterialSpeed.speed |
| 真实记录转换 | editor `0x1e92190` 的 `0x1e92850…0x1e92b50` 曲线分支 | 素材相对时间、两侧控制时间、范围外记录处理 |
| 属性入口 | editor `0x33f35f4` | 真 Video + CommonKeyframes + 两个 CommonKeyframe，调用既有真实 VEUtils cubic |

`native_variable_time.hpp` 的工厂参数是两个真实 libc++ string 与真实 vector；vector 每项是 48 字节的已核验**值参数**，x/y 位于 `0x20/0x28`，前 32 字节清零。它不是 SDK 对象、虚表或控制块。直接读取工厂输出验证数量和 x/y 数值相等；仅不承诺厂商对数值相等 ±0 的构造位型。模型、Video、TimeRange、关键帧和 packed record 均复用真实工厂，真实 shared_ptr 控制块决定销毁。原始工具工厂返回的裸对象由 RAII 调用其真实 deleting destructor。

工具链依次核验 editor vtable `0x4d03210`、真实子对象 creator vtable `0x36a69b8` 和引擎 `0x375e780`，不写内部状态。真实 MaterialSpeed 通过 setter `0x1052340` 附加 CurveSpeed，`0x10522b0` 设置 mode 1；材质工厂最后整型参数为 0。本轮只覆盖这条连续正向配置。求值使用真实 VEUtils shared handle，保持生命周期到所有调用结束。

SDK 动态依赖超出这两个镜像的身份未逐一锁定。库保持加载到隔离进程退出，避免析构时卸载代码；未 attach、patch 或注入运行中的剪映，也未打开或修改用户 draft。

## 2. 原创数值实现

### float 归一化与三段速度

令输入点为 `(source_fraction, speed)`。两者先窄化为 float，float x 必须严格递增、端点为 0/1。每段使用 float 算术累加：

`average = (y[i] + y[i-1]) * 0.5f`

`cumulative += (x[i] - x[i-1]) / average`

最后每个累计坐标除以总累计坐标得到 sequence fraction。它不是对“素材 x 上线性速度”直接求对数积分，也不等价于整段平均速度。实现保留每一步 float 舍入。

对于相邻归一化点 `x0,x1`、float 速度 `y0,y1` 及正整数序列时长 D：

- `left = double(x0)*double(D)`；`right = double(x1)*double(D)`。
- `width = double(D)*double(float(x1-x0))`；`middle = double(D)*double(float(x0+x1))*0.5`。
- `average = double(float(y0+y1))*0.5`；`delta = double(float(y1-y0))`。
- `A = double(0.8f)`，`B = double(0.2951f)`，不是直接 double 字面量；creator 常量表位于 `0x2e91d10`。
- 两个内部分界为 `fma(-width,B,middle)` 和 `fma(width,B,middle)`；其速度为 `average ∓ (A*delta)*0.5`。
- 外侧两段斜率为 `((1-A)*delta)/(width*fma(B,-2,1))`；中段为 `(A*delta)/((width+width)*B)`。

每段速度为一次函数，因此正向映射为二次面积，逆映射为求二次根；并未用近似 LUT、均速替代或拟合曲线。实现拆分在 `variable_time.cpp` / `variable_time_internal.hpp`，仅观察到融合的运算显式使用 `std::fma`，其余关闭自动 contraction。

### 积分、逆求值和整数边界

正向将负 query 置零，依次累加完整区间面积；所选区间按三段边界累加实际积分。超过最后点停止延伸。局部二次项使用 ARM64 `MUL` 得到 query 平方的低 64 位，再 `UCVTF` 转 double；独立实现以 uint64 乘法表达回绕，避免有符号 C++ UB。极大时间上的非理想结果属于此次恢复的实际行为，不能替换为无限精度实数平方。

逆向选择首个“累计面积严格大于请求值”的区间。原生先以 FMA 更新累计面积，再以反向 FMA 恢复此前累计值，保留舍入残差。速度差 float 为零时走线性除法；否则按面积选择一段，保留 a/b/c 的实际构建顺序后求根。未命中三个区间时返回 0，超过全部面积返回最后归一化点乘时长。

最终整数结果为 `floor(value+0.5)` 后 ARM64 饱和转换：NaN→0，超界饱和到 int64 两端。相对时间、端点和 offset 的整数加减均使用 modulo 2^64。这里的时间是现有整数单位，不把数字擅自解释成秒或帧。

### Video helper 与记录时钟不同

三个真实 Video helper 先按严格 `<1000` 的距离判断起点，再判断终点，保留该顺序；命中返回另一时钟的对应端点。否则，非负相对时间使用曲线；负相对时间使用 `MaterialSpeed.speed` 的恒速乘/除和截断。本 API 将它命名为 `negative_time_speed`，避免让人误以为此值控制整条正向曲线。relative-sequence 结果再减 target.start + offset。

曲线控制记录路径单独处理：

- 记录时间减 source.start；小于零时记录 time=0、incoming time=0；超过 source.duration 时 time=target.duration、outgoing time=0。
- 范围内含端点的记录时间直接经曲线逆映射，不执行 helper 的 1000 单位吸附。
- 控制 offset 先按 ARM64 截断，计算 wrapped absolute，再以 unsigned magnitude `>=1000` 决定是否重映射；999.9 不转换，1000 转换。NaN 截断为零所以保留其 offset；无穷进入饱和转换路径。
- 范围内控制先计算 `truncate(offset+double(relative))`，经过曲线逆映射后减新记录 time；范围外使用原始控制 offset 的单独映射，不能自行改成“记录时间加 offset”。控制 value 与 material values 保持原样。

`variable_record.cpp` 和 `variable_segment.cpp` 分开表达这两种时钟。此条 helper 没有调用 fps 量化；静态探索中的另一个 `VideoUpdateSpeedUtils` / FrameFpsHolder 路径不属于本次确认链。

### 属性组合

`evaluate_variable_property_interval` 输入已经选好的两个无 graph 关键帧、相同非空多通道值和严格处于 raw 端点内部的 query，至少一侧 curve type 非零。它将 raw 端点和 query 变换到 relative-sequence 时钟，再执行范围拷贝；curve type 为 0 的一侧先清除控制 offset，再准备记录。记录选取、first-record 自区间和 float cubic 求值与上一轮恒速路径共用 `resolved_property.cpp`，没有复制另一份算法。

mapped 范围和 resolved record 范围仍独立：在首记录之前或正好命中时两端用同一记录，但保留原 mapped-left 作为 progress 起点；超过末记录直接拷贝原 right values。拷贝路径保留 double bits，计算路径 float→double。此 API 不包含非空 graph、完整列表 dispatch、exact-hit 上层分派或 Caption 特例。

## 3. 原生结果与检查

Release 与 ASan/UBSan 两次正式运行的整份解析 JSON 相同，`passed=true`、0 mismatches：

| 项目 | 数量 |
| --- | ---: |
| 合法原生曲线/Video 配置 | 384 |
| double→float 归一化结果比较 | 7,056 |
| 正逆曲线与 Video helper 调用 | 628,308 |
| 原生 packed record 转换 | 46,080 |
| 实际 property 调用 | 7,872 |
| 整数与非 NaN 浮点逐位比较 | 944,020 |
| NaN 分类相符 | 7,076 |
| 求值前后源关键帧快照检查 | 192 |

48 条原创曲线包含常速、上升/下降、多拐点、小/大幅度速度及 2/3/4/7/16/17/33/65 个点；各交叉 8 个时长，包括 2,000、2,000,000、2^32 邻域、10^12、INT64_MAX。查询覆盖负时间、极值、区间边界及 ±1 邻域。Video 使用独立 source/target 起点、裁切长度、fallback speed 和 offset。记录覆盖 12 种控制 offset（阈值邻域、±0、±∞、NaN、最大 double）。属性覆盖 1–7 通道、单侧/双侧 curve、裁切外端点、NaN/无穷值，顺序查询后反向重放。

总比较 FNV-1a 为 `1250115988544839627`；仅取实际原生正逆映射输出的固定 corpus fingerprint 为 `13960850192421931186`，固定在跨平台 standalone 测试内。测试还包含常速中点、独立原生三点曲线 goldens、精确阈值、极值回绕、非法/超预算拒绝。NaN 计算只声明分类相符，不承诺 payload；source snapshot 检查涵盖字段/局部 mutation，不等价于 SDK 全局状态纯净或完整 seek 验证。

本目录 12/12 CTest 在 Release 与 Debug ASan/UBSan 下通过。警告视为错误，MSVC 使用 `/fp:strict`，其他编译器关闭隐式 contraction；本轮本机为 AppleClang/macOS arm64，新增代码的 Linux/GCC13 与 Windows/MSVC 执行须由本批 CI 再验证。纯 CTest 未禁用 leak detection；原生 sanitized probe 仅用 `ASAN_OPTIONS=detect_leaks=0` 排除未插桩 SDK 的进程级分配。SDK 二进制本身没有被 sanitizer 插桩。

旧 graph 与旧 nonlinear_property 原生回归结果整份解析 JSON 均与上一轮相同。六个独立编译的错误实现同时被 standalone 测试与真实 native probe 拒绝：错误归一化分母、取消整数平方回绕、丢弃前段累计面积、将 float 派生 B 改为 double 字面量、控制阈值改为 >1000、丢失负时间恒速 fallback。另验证无参数、错误镜像身份、fast-math 编译、消毒器溢出 witness 均非零退出。

一个额外探索负控仅将“恢复此前累计面积”的 FMA 改为分离乘减，在当前 standalone corpus 未产生可见差异；该失败探索保存在 `negative-controls-initial.log`，不计入上述六个成功检出的负控，也不据此声称 corpus 能区分所有局部舍入变体。生产实现仍按静态指令保留 FMA。

## 4. 复现与剩余边界

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-variable-time -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-variable-time --parallel
ctest --test-dir /tmp/qcut-variable-time --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-variable-time/editor-variable_time-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-variable-time.json 2> /tmp/editor-variable-time.stderr
```

纯 C++ 构建无需 `EDITOR_CONTRACT_NATIVE_PROBE`、SDK 或外部资源。独立域要求 2–4096 点、double 输入有限且在 x∈[0,1] / y>0，float 窄化后仍有效、归一化坐标严格递增，source.duration 非负、target.duration 正、fallback speed 有限正数。属性最多 2^20 通道，映射/记录范围不得下降。这些拒绝规则是独立 API 的预算和已验证域，不冒充厂商输入校验。

下一单元应将已验证 graph 展开记录接到本次曲线时间转换，验证 per-channel graph control 与 scalar control 是否同样处理，再扩实际 property dispatch。反向/离散/非法 speed 曲线、曲线编辑服务、完整时间窗选择与 property type 分派、帧率换算和完整播放状态仍未恢复。当前无需重写已有 cubic / graph / record 算法来掩盖这些边界。
