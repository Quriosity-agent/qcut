# videoeditor 非空 graph：工厂、展开记录与逐通道求值

本轮在 `codex/jianying-binary-cpp-scaleup-20260908`、基线
`513a1c67d06fbdbb2a3b89bd27c6e37d3153eaf7` 的新 worktree 完成一个独立 C++20
子域：将右关键帧上的非空 graph 展开为记录，再通过恒速 Video 的实际 property
分支求值。它接续[无 graph 非线性合同](videoeditor-nonlinear-property-2026-09-07.zh.md)，
没有把研究范围扩大为完整关键帧调度、seek、undo 或剪映整库还原。

## 身份、源码和证据级别

2026-09-08 重新读取 `/Applications/VideoFusion-macOS.app/Contents/Info.plist`，
版本与 build 均为 `11.3.0`。两个 universal 文件的 SHA-256 与实际加载 arm64
UUID 均由探针再次校验；未知 SHA、UUID、架构、锚点地址或 creator 虚槽拒绝运行。

| 文件 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `Contents/Frameworks/libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `Contents/Frameworks/libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

原创源码位于 [independent-editor-contract](../../../research/independent-editor-contract/README.md)：
`graph.hpp` 定义公开值接口，`graph.cpp` 负责展开，`graph_property.cpp` 负责记录选择与求值。
`integer_time.hpp` 共用原有的 ARM64 饱和转换语义，避免另一份实现；旧 `segment_time.cpp`
只改为调用这个共用函数。`native_graph.hpp` 与 `native_property.hpp` 只属于可选原生诊断。
厂商机器码、运行输出和原始符号不进入仓库。

证据标签：`static-strong` 表示固定地址上的指令路径；`runtime-observed` 表示隔离进程中
真实 SDK 对象与函数的差分；`unresolved` 表示没有闭合的子域。没有本轮 UI 像素对齐声明。

## 真实对象的创建和所有权

`static-strong`：`KeyframeUtils` 更新路径 `0x340c0c4` 在 `0x340c218–0x340c22c`
把参数内部 `+0xc8` 值传给匿名 factory `0x340c4a0`，随后调用
`CommonKeyframe::set_graph` (`0xc7e510`)。
factory `0x340c4a0–0x340c9ec` 自己分配 Graph、GraphPoint、CommonPoint，以及各自的
真实 shared 控制块。诊断没有分配 SDK 模型存储、伪造虚表或写模型偏移。

工厂只读参数视图的已访问字段如下；这不是完整请求类的还原：

| 层 | 工厂读取字段 | 对应动作 |
| --- | --- | --- |
| graph 值 | `+0x20/+0x38` 两个真实 libc++ string | resource ID/name setter |
| graph 值 | `+0x50` int32；`+0x58` 真实 vector | platform setter；逐点遍历 |
| point 值，步长 `0x58` | `+0x20` int32；`+0x48/+0x50` double | type；x/y setter |

未读取区域使用自有保留字节。参数本体通过真正 C++ 移动构造放到页尾，调用期间为只读，
下一页不可访问；vector 元素和长字符串仍是正常 libc++ 分配。此保护检查本体写入与越尾，
不宣称检查了所有子分配的任意读取。

`runtime-observed`：先核对工厂直接产物的 type/x/y 位型与 resource strings，之后才对
数值相等但符号位不同的零执行真实 setter 的 distinct-seed 修正。工厂原有数值相等抑制
可能保留 `+0`；不能先覆盖所有坐标再称“工厂参数布局已验证”。转换与求值 corpus 则明确
包含请求的 `-0`。非零和 NaN 工厂坐标不允许被这一步修正掩盖。

关键帧、组、SegmentVideo、TimeRange、MaterialSpeed 继续通过先前核验的真实工厂创建，
只使用脱离用户项目的对象。Graph 被真实 `set_graph` 持有，末次所有者释放后 graph 与 point
的 weak pointer 均过期。packed record 的 shared 控制块也来自 SDK，库保持加载至进程退出。
没有打开真实 draft、附加进程或修改 App。依赖库本身未全部进行身份固定或 sanitizer 插桩。

## graph 转换和记录展开

`static-strong`：转换入口 `0x1e90318` 读取 `Graph::get_graph_points` (`0xd98070`)，
逐点调用 `GraphPoint::get_point` (`0xda3010`)、`CommonPoint::get_x/get_y`
(`0xc8eba4/0xc8ebf4`) 及 type getter。结果为步长 24 的值序列：int32 type、double x/y。
null graph 与实际空 Graph 都返回空序列，已独立调用核验。

`static-strong + runtime-observed`：`0x1e91c80` 产生实际 packed records，
`0x3a13eb0` 展开它们。后者读取**右记录** `+0x60` graph 数组；左帧故意附上不同图后，
本轮结果仍由右图决定。公开 `expand_graph` 因此只接收右图。

记原左/右记录时间为 `L/R`，对应每通道 double 值为 `A/B`。对每个 graph 点 `(type,x,y)`：

1. `D = double(wrapped_int64(R-L))`；先进行模 2^64 运算，再把结果解释为有符号整数。
2. `T = FCVTZS(x*D + double(L))`。乘法和加法分别舍入；不融合。
3. 每通道 `V = A + y*(B-A)`，减、乘、加分别舍入。
4. 非零 type 都是临时控制点，零 type 是输出锚点。这里没有证明这些数值对应哪些 UI 名称。

`FCVTZS`：NaN→0；超范围正/负数与 Infinity 饱和为 int64 最大/最小值；有限范围内向零截断。
独立实现先检查范围，避免 C++ 非法浮点转整数和有符号溢出。

第一个/最后一个输入点为锚点时，原生输出直接复用原左/右 packed record；图上这两点的
计算坐标不会替换其原时间和值。若原 curve 为 0，左端改为 1、右端改为 2；其他代码保留。
中间锚点用计算出来的 `T/V`，curve=3。无控制点时保留已有普通控制字段；新中间记录的
普通控制字段为零。API 返回独立值，不向调用者承诺 SDK 指针身份；探针另外核验原生端点复用。

锚点之间的控制序列按原顺序消费，不排序：

| 控制数量 | 输出行为 |
| --- | --- |
| 0 | 不生成逐通道控制数组，后续可使用普通控制字段 |
| 1 | 将二次控制提升为三次控制 |
| ≥2 | outgoing 用第一个控制，incoming 用第二个；后续控制忽略 |

对单控制 `C`，前锚点 `P` 与后锚点 `N` 的 outgoing/incoming 绝对坐标分别是
`P*(1/3)+C*(2/3)` 与 `C*(2/3)+N*(1/3)`。两个常量采用 double
`0x1.5555555555555p-2`、`0x1.5555555555555p-1`。
值坐标先按该顺序求和，再减所在锚点值；时间先各自转 double、乘常量、求和，
再 `FCVTZS`，最后与所在锚点时间做 wrapped 减法。两个以上控制直接用控制时间/值减锚点。
每个通道有自己的 value offset，time offset 是公用 int64；不能把第一通道广播到其他通道。

指令定位：点映射 `0x3a140a4–0x3a142e0`；端点/中间锚点 `0x3a14380–0x3a14464`；
单控制分支 `0x3a14484–0x3a14e3c`；双控制分支 `0x3a14e8c–0x3a150ec`；
追加锚点与清临时控制 `0x3a1511c–0x3a151cc`。

## 接通实际 property 的子域

`runtime-observed`：调用真实 property `0x33f35f4`，没有用一个数学叶函数替代此调用。
它先映射原端点和 raw window midpoint；范围外直接复制原 double 值。
非零 curve 进入 graph 打包、展开、记录时间解析 `0x1e92190`，再选择第一条时间 ≥ query
的记录及其前记录。初始选中第一条时，左右均为首记录，progress 的左界仍为原 mapped-left；
超过最后记录返回原右值。重复锚点时间保留顺序，可能出现退化浮点区间。

一个容易错误“修正”的事实：恒速分支 `0x1e92748–0x1e92820` 只写记录时间、普通控制
double 的时间字段 (`+0x40/+0x50`)。graph 整数控制时间 (`+0x78/+0xb0`) 不随速度缩放。
独立实现明确保留这个行为；把它们除以 speed 的负控会被测试检出。

property `0x33f42dc–0x33f4344` 对每通道分别检查 outgoing/incoming 数组长度。
若该通道存在 graph 控制，取对应 value 和整数 time→double；否则取普通 scalar controls。
将偏移与已解析记录时间/值相加后，才窄化为 float。
`0x33f436c` 获得真实 VEUtils shared handle，`0x33f43b4–0x33f43c8` 调用 `+0x168`
虚槽。探针固定 creator vtable `0x36aced0`、目标 `0x1d803e8`，复用已验证 cubic 算法。
该算法的显式 y-FMA 保留；graph 映射阶段不能擅自加 FMA。计算结果是 float→double，
复制分支则保留原 double 位型。

公开域：两个已选定 Video 关键帧、至少一侧 curve 非零、严格位于 raw 两端之间的已解析
midpoint、正有限恒速、非负 source/target duration；非空图必须首尾都是锚点。
展开允许 wrapped/无序时间；property 拒绝 mapped 端点或 resolved 记录降序，允许相等。
point×channel ≤2^20 是独立资源预算，**不是发现的厂商输入校验**。
不合法图即使处于可复制的外侧时间也可能被独立 API 提前拒绝；没有声称复现所有错误路径。

## 验证与反例

最终两次完整原生运行，Release 与 ASan/UBSan JSON 完全相同：

| 项目 | 结果 |
| --- | --- |
| 配置 | 1,673：1,008 常规、88 特殊浮点、576 int64 边界展开、1 个舍入 golden |
| 实际 property 调用 | 43,880，含同时间重复/逆序 query |
| 展开/解析后的记录比较 | 9,886，端点记录同时检查原生对象身份 |
| 整数比较 | 128,527 |
| 非 NaN double 逐位一致 | 475,154 |
| NaN 分类一致 | 21,182；一般计算不承诺 NaN payload 位型 |
| 原 frame/graph 数据及局部 mutation 快照不变 | 3,346 |
| 差异 | 0 |
| 总比较 FNV1a | `6858024063867554827` |
| 常规 property corpus FNV1a | `14033642324964053166`，独立测试固定该值 |

浮点总数含转换、记录字段、property 输出与源值检查，不能全称为 cubic 输出数。
快照不变仅覆盖所列模型字段，不证明所有 SDK 全局状态或播放状态纯函数化。

Release/Werror 与 fail-closed ASan+UBSan 均为 **11/11 CTest**。五份旧 native 探针
`native/evaluation/window/segment_time/nonlinear_property` 输出 JSON 与上一轮逐项相同。
sanitizer 只覆盖独立代码和诊断代码；可选 native 运行使用 `ASAN_OPTIONS=detect_leaks=0`，
纯 CTest 没有关闭 leak detection。本轮本机为 macOS arm64；Linux/Windows 实际执行结果由
统一 CI 另行记录，不能把本地通过算作跨平台执行。

15 个负控均以非零退出拒绝：8 个编译后的算法变体、1 个错误二次提升算法连接真实 native
probe、4 个参数/身份错误、fast-math 编译拒绝、故意有符号溢出的不可恢复 UBSan。
算法变体覆盖：错误 2/3 常量、仅 type=1 被视为控制、只保留一个控制、先 double 后时间相减、
保留 curve=0 的普通控制、graph 值融合乘加、把首通道广播、错误缩放 graph 时间偏移。
真实 native 负控在 `graph=1 config=0` 检出 outgoing time `498266` 与错误实现 `408700`。

普通有限 corpus 最初无法检出 graph 值的 FMA 变体，因为末端窄化可能掩盖细微差异。
因此新增独立手算 golden：`A=-1`、`B=2^-52`、`y=0x1.fffffffffffffp-1`，
分开乘加在中间锚点得到 `+0`，融合计算得到非零。已再由真实展开与 property 验证，
这个负控现在失败。没有只改 fingerprint 来接受变体。

## 私有证据、命令与未完成项

所有原始材料在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/editor-graph/`。
`verification.json` 包含最终源码/doc SHA-256、raw dump SHA、运行命令、结果与负控记录。

| 原始文件 | SHA-256 |
| --- | --- |
| `update-graph.arm64.txt` | `b15b249e81234f6835a7586dcab4cdb2cb7031564d66f81b14a1f0e5d11c115a` |
| `graph-converter.arm64.txt` | `e24a79a98a4292a2165f6dd85401b2f7d8917489b9be5e9a4c3c71f262bae02e` |
| `graph-expand.arm64.txt` | `474ba68df14ec83ec508106b2276e63eb828447dae562394f04049744cb13151` |
| `record-constant.arm64.txt` | `10f449604ddc60f4c81f6b5e17e252ee5143d68c38e878da189c131e8a978ac7` |
| `property-channel-controls.arm64.txt` | `c012ebd12abb2ed0279d3d98dc2dae9943aa0ac0a003afaa132a7d8d4e596865` |

从 QCut package 目录复跑（native 是可选，本地有匹配 SDK 才执行）：

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-graph -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-graph --parallel
ctest --test-dir /tmp/qcut-editor-graph --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-graph/editor-graph-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib"
```

静态命令使用已拆出的 arm64 薄文件及非 `--macho` 的有界反汇编，例如
`xcrun llvm-objdump -d --demangle --start-address=0x3a13eb0 --stop-address=0x3a15400 THIN`。
不把整库 dump 或薄二进制放入 Git。

`unresolved`：原图资源下载/预设选择到 graph 请求的 UI 路径；首尾控制点不合规图、完整图
语法与其他 Segment 类型；curve-speed；Caption 特例；多帧分派、精确命中选择、时间窗口准备；
property→effect event→预览/导出；完整 undo/stash 状态机。下一项可复用真实 graph 工厂，
定点追非恒速 record 时间变换，或在独立 bounded dispatch 中接入已验证 window 和 graph 分支。
这份交付仍不是剪映全部函数的源码恢复，也没有接入 QCut 产品渲染路径。
