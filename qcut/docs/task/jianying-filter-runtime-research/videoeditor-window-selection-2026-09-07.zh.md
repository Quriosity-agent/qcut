# libvideoeditor 窗口选帧与 cubic 输入适配（2026-09-07）

本轮把上一轮未闭合的 `findKeyframeByTimeOffset_` 恢复为独立 C++20，并用真正的 SDK 工厂创建对象进行差分：100,832 次 finder 调用零差异。另恢复已解析时间/控制记录到 float cubic 的值运算。后者只有静态指令证据，不能等同于完成视频段变速、graph 展开、完整属性求值或 seek 状态机。

源码目录：`research/independent-editor-contract/`。旧五个单元继续保留，新增 `window`、`time_adapter`；`filter_time.cpp` 只把既有 modulo-2^64 运算提取到 `wrapped_time.hpp`，算法未变。厂商二进制、反汇编、原生输出和编译产物均在仓库外。

## 样本与证据级别

样本仍为本机剪映专业版 11.3.0：

- 文件：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/libvideoeditor.dylib`
- SHA-256：`ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`
- arm64 UUID：`22337058-B217-3CAF-9979-CFECA7302CF7`
- 私有证据根：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/editor-window/`

下表地址为该 arm64 slice 的未滑动地址。没有导出名的函数用地址标识；反汇编工具展示的“最近导出符号 + 偏移”不作为真实函数名。

| 单元 | 地址/分支 | 证据与已交付范围 |
| --- | --- | --- |
| `KeyframeUtils::ensureKeyframes` | `0x340a010–0x340a284` | 静态 + 原生；null Segment、非空 material 的 detached group 工厂 |
| group 查找的 null 分支 | `0x340a504`，`0x340a54c→0x340a704` | 静态；先检查第二个 string，再从空 Segment 返回空 group |
| 单点工厂 | `0x2af2edc–0x2af3004` | 静态 + 原生；真实 shared control block、构造、time/curve/value 设置 |
| `findKeyframeByTimeOffset_` | `0x340b6a8–0x340bb70` | 静态 + 100,832 原生调用；命中、邻居及原始索引 |
| 实际移除 | finder `0x340b928–0x340b938` → `0xc8ccf8–0xc8ce6c` | 原生验证活动列表只移除命中项；未声称完整 removed/dirty/event 语义 |
| property 的直接命中 | `0x33f35f4`，finder call `0x33f36b8`，copy `0x33f3708` | 原生 18,544 次 double 原始 bits 完全保留 |
| 控制记录生成/解析 | `0x1e91c80–0x1e91eb8`、`0x1e92190–0x1e9362c` | 静态定位上游边界；未独立重建 Segment 变速映射 |
| cubic 进度/float 适配 | `0x33f4278–0x33f43b0` | 静态 + 独立边界测试；已解析区间上的值运算 |
| 空 Segment 时间 | `0x340737c`、`0x340824c` | 原生 24 例均为 -1；不构成有效 Segment 的时间转换证据 |

## 真实工厂与 ABI 的闭合方式

`native_keyframes.hpp` 是仅供私有诊断使用的薄层，不进入独立库的运行依赖。`KeyframeTypeKey` 的值布局只有两个真实 libc++ `std::string`，property 在偏移 0，material 在偏移 24；当前已核验 ABI 下共 48 字节。字符串、shared_ptr 和 vector 的大小均有编译期断言；没有构造厂商 model 的伪内存或虚表。

group 工厂接收真实空 `shared_ptr<Segment>` 和非空 material。`ensureKeyframes` 先查找失败，然后由 SDK 分配 0x88 字节控制块/对象，调用 `CommonKeyframes(bool)` 的真实构造入口 `0xc83ea8`，设置 property 与 material。`0x340a15c–0x340a160` 的空 Segment 分支跳过 segment 挂载，返回合法 detached group。

单点工厂 ABI 已从实际调用与完整函数体核验为：空 shared_ptr 输出引用、int64 time、double value。它分配 0xa8 字节控制块/对象，调用真实 `CommonKeyframe(bool)` 入口 `0xc7dee8`，再调用 time setter `0xc7dfb8`、curve-type setter `0xc7df78` 和 values setter `0xc7e1c8`。输出必须最初为空，诊断每次都创建新的空 handle。对象生命周期通过原生 shared control block 的真实析构管理，诊断全程保持 dylib 已加载。

group 的列表通过真实 `set_keyframe_list` 入口 `0xc8412c` 写入，并通过 `0xc84118` 读回。先实测确认此 setter 保留输入顺序和对象身份，再进行窗口对比。空列表、重复时间、乱序列表都由相同合法工厂/列表接口构造；没有直接改写模型字段。首次小样本为独立进程中的三点命中/移除，随后扩展确定性语料。只读安装样本，没有打开草稿、注入或修改正在运行的剪映。

加载前后校验请求文件和实际加载 image 的 SHA、arm64 架构、UUID、导出 anchor；错误 hash、相对路径和缺少参数均在调用私有 ABI 前失败。这里固定的是 `libvideoeditor` 身份；它的全部间接依赖没有逐库固定，不能宣称任意系统/版本都支持此诊断。

## 窗口算法与反例

独立 API 接收 time 数组和闭区间 `[start,end]`，返回选中索引及前后邻居，索引属于移除前列表。数组可为空、乱序、包含重复和所有 int64 值；超过 2^20 项被独立实现拒绝，该资源上限不是恢复出的 SDK 校验。

1. 中点先对两个 int64 做 64 位回绕相加，再按有符号数除以 2，负数向零截断。`MAX+MAX` 回绕后中点为 -1，`MIN+MIN` 为 0；`[-2,-1]` 中点为 -1。不能替换成避免溢出的 `std::midpoint`。
2. 距离先回绕减去中点，负数再回绕取负。`abs(INT64_MIN)` 的结果仍是负的 `INT64_MIN`。原生随后使用有符号距离比较；饱和、uint64 距离或扩大精度都会改变选帧。
3. 从第一项开始，仅在下一项距离严格更小时继续。第一次相等或增大就停止，没有排序，也没有继续寻找全局最近点。`[0,0,10]` 查询 `[10,10]` 在首个重复 0 处停下，后面的精确 10 不会被选中；`[10,20,0]` 查询 0 同样不会访问尾部的精确值。
4. 停止项的时间位于闭区间才算命中。命中后给出它在原列表中的紧邻项；实际 `remove=true` 不改变已经计算出的邻居身份。没命中时按中点相对停止项的位置返回候选邻居，并检查相邻项是否处于中点另一侧。

原生的“缺少 group”与“存在但为空的 group”不同：null group 返回空命中但保留调用者原有 previous/next 输出；空列表会清空请求的输出。`window` 的 span API 只表示后者和非空列表，不能拿空 span 模拟 null group。诊断单独验证了该 ABI 分支，并给两个 shared_ptr 输出前后放置 canary。

## 时间准备与 float 的准确边界

原生先求窗口中点，再调用 Segment 时间转换。普通 property 控制路径会把 CommonKeyframe 打包为记录（`0x1e91c80`），可能经 `0x3a13eb0` 展开 graph，随后调用 `0x1e92190` 改写记录时间和控制点。静态可见该函数区分视频/音频、读取 source range 与 speed，并有 curve-speed 分支。普通速度分支 `0x1e9277c–0x1e92820` 对 source 时间差做端点处理，再除以 speed；时间差小于 1000 时吸附起点，距末端小于 1000 或越过末端时吸附末端，控制时间偏移随变换重新计算。此处只陈述静态行为，没有把整个上游函数称为已实现或原生验证。

因此 `time_adapter` 的输入特意分开：`CubicInterval` 是已经解析后的两个记录及相对控制偏移；`IntervalProgress` 是已经选择的左右时间边界和 query。它们的对应关系必须由上游 Segment/graph 规则建立，适配器不会假设原始草稿时间、帧号或微秒值可以直接混用，也不推断所有 graph 分支中两组时间始终相等。

已恢复的值运算为：

- 进度分子和分母分别做 int64 回绕减法，再转 double、相除，最后窄化为 float。没有夹到 `[0,1]`；零时长保留 NaN/Inf。
- 控制记录的 endpoint time 先 int64→double→float。它与直接 int64→float 不总等价：测试值 `9007199791611905` 的实际两次舍入产生 float bits `0x5a000000`。
- 控制时间偏移与 endpoint time 在 double 相加，控制值偏移与 endpoint value 同样先在 double 相加，再转 float。`16777217 + 1` 不能先将 endpoint 舍入到 float 后再加。
- 保留已有 float cubic 求值器的入口形式；不在这里选择 graph 子区间、dispatch curve type、生成控制点、限制 UI 强度或修复 nonfinite 值。

真实 `getTimelineByKeyframeTimeOffset` 的空 Segment 分支返回 -1，`getRelativeSeqTimeByKeyframeTimeOffset` 的空路径也返回 -1。故不能用 detached group 加空 Segment 去“验证”非命中插值；本轮原生 property 调用严格限制在 finder 已命中的早返回路径。该路径直接复制 values，无需进入 Segment 时间转换，并实测保留 ±0、NaN payload、无穷大等 double 原始 bits。

## 原生差分、回归与反向对照

`window_probe.mm` 使用固定种子，192 个数组（0–18 项），小整数及 int64 边界混合，交替排序/乱序、保留重复；每组覆盖固定窗口、逐点精确窗口、回绕 ±1000 窗口和随机窗口。按正序与逆序查询，并遍历 remove 和 previous/next 输出指针的四种组合。没有跨调用缓存；前后顺序一致只证明此 finder 在该语料内的独立调用行为，不能推广成整个播放器无 seek 状态。

| 项目 | 本次结果 |
| --- | --- |
| 真正 SDK 创建对象 | 1,905 个 |
| finder 调用 | 100,832 次，0 mismatch，37,088 次命中 |
| `remove=true` 命中及剩余列表身份验证 | 18,544 次 |
| property 命中 double copy | 18,544 次，bit exact，包含 nonfinite 与 signed zero |
| null Segment 两个时间 helper | 24 次均返回 -1 |
| Release + Werror | 7/7 CTest 通过 |
| ASan/UBSan + 禁止恢复 | 7/7 CTest 通过；私有 SDK 本身不是 sanitizer 构建 |
| 原生窗口 probe 的 ASan/UBSan 构建 | 同一 100,832 次语料通过，JSON 与 Release 完全一致；SDK 全局初始化使 leak 检查另行关闭 |
| 老原生 setter/JSON/evaluation 复跑 | 3,858,432 setter + 1,650 metadata + 88,392 resample values + 40,000 cubic values；两份结果 JSON 与上轮逐值相同 |

独立测试并非只把实现结果抄作期望值：私有复制件分别把 tie 改成继续、把局部搜索改成全局扫描、把回绕中点换成 `std::midpoint`、把 endpoint 改成直接 int64→float、把控制相加改成提前 float，五项都实际失败。另有编译拒绝 fast-math，故意有符号溢出的 sanitizer 程序以 -6 退出；错误库、相对路径、缺少参数均非零退出，stdout 没有伪成功 JSON。完整结果在 `negative-controls/results.json`。

可复跑命令（从 QCut package 目录）：

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-window -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-window --parallel
ctest --test-dir /tmp/qcut-editor-window --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-window/editor-window-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-window.json 2> /tmp/editor-window.stderr

cmake -S research/independent-editor-contract -B /tmp/qcut-editor-window-san -DCMAKE_BUILD_TYPE=Debug -DEDITOR_CONTRACT_SANITIZERS=ON
cmake --build /tmp/qcut-editor-window-san --parallel
ctest --test-dir /tmp/qcut-editor-window-san --output-on-failure
```

本机测试环境 AppleClang 21、macOS arm64；这次没有在 Linux/Windows 运行，也没有宣称跨平台私有 ABI。标准库独立目标不链接厂商库；native 目标默认关闭，非 macOS arm64 明确拒绝配置，CTest 不自动加载私有 SDK。

## 可审计文件与下一步

私有 `verification.json` 保存所有交付源码/本文 SHA、命令、结果与原始证据文件 SHA。关键证据如下：

| 私有文件 | SHA-256 |
| --- | --- |
| `find-window.arm64.txt` | `f00bb073a1c49d1c8fce7c76cb9dcdb4c9bfc56bd2e0e6ccea972bb1d0e6bd88` |
| `create-keyframe.arm64.txt` | `7e116992028d3dfa2c57c3fd1529c5ef4eb55bc6fc57a23d97593352f1412ad0` |
| `create-keyframes.arm64.txt` | `2966d5b68ec11152705cf74faa7bac26c4afcc0930e79a2c772c0ce513983062` |
| `property-float-adapter.arm64.txt` | `29b2a54b42b2f55a59bbcd7d614b77aff0ed5ae3063908f9ae22936648226e21` |
| `resolve-control-record-time.arm64.txt` | `c4e0e1afebf7eb1ccdb7c72990026afeb3e719feb4d647788c819a4d23600ec5` |
| `native-window-final.json` | `a8f842fa38d66d718785b4fcec84559557f395b441ca4ade8e449f06dfc05522` |

下一项应使用真实 SegmentVideo/TimeRange/MaterialSpeed 工厂闭合 source range、恒速与端点吸附，验证 `0x1e92190` 生成的记录时间/控制偏移，再进入实际非命中 property 求值。curve-speed 积分、graph 展开/多通道、事件通知、undo 与完整 seek 仍另需证据。本轮 finder 可供 creator 的捕获窗口/插入路径共用，但该纯函数不替代 creator 的模型状态、记录或事件实现。
