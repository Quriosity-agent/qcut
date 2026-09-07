# libvideoeditor 恒速片段时间与非命中线性求值（2026-09-07）

本轮闭合两个可独立编译的单元：真实 Video 片段的恒速时间转换/控制记录准备，以及两个已选定、无 graph、curve type 均为 0 的关键帧之间的线性 property 求值。实际 SDK 对象全部由原生工厂创建；没有使用伪造 Segment 内存或虚表。96 个不同配置、6,336 组时间查询与控制记录、1,153 次真实 property 调用均零差异。

这是上一轮“只有空 Segment 和已解析记录适配”的实质补充。它仍不是整个 `libvideoeditor`、完整关键帧 dispatch/seek、曲线变速或 QCut 产品集成。独立源码位于 `research/independent-editor-contract/`，新增 `segment_time`、`linear_property`、可选诊断 `native_segments.hpp` / `segment_time_probe.mm`；旧七个单元保留。

## 样本、身份与证据等级

样本为本机剪映专业版 11.3.0，结束前重新核验：

- 安装文件：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/libvideoeditor.dylib`
- universal SHA-256：`ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`
- arm64 UUID：`22337058-B217-3CAF-9979-CFECA7302CF7`
- 私有证据：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/editor-segment-time/`

地址均为该 arm64 slice 的未滑动地址；无已核验名字的内部函数只以地址识别，不借最近符号猜函数名。原始反汇编、二进制和诊断结果均留在仓库外。可选 native 目标校验请求路径和实际加载镜像的 hash、架构、UUID、导出 anchor；间接依赖未逐库固定，不能据此支持别的安装版本。

| 入口/分支 | 地址 | 本轮证据 |
| --- | --- | --- |
| `CombinationUtils::makeCombination` | `0x3014cac–0x301527c` | 完整静态工厂路径 + 独立进程原生创建 |
| 空 Draft 分支 | `0x3014e1c→0x3014e78` | 原生构造 detached Draft，未打开现有草稿 |
| `ActionUtils::make_time_range` | `0x1e6e2c4–0x1e6e368` | 真正的 TimeRange 分配、构造、setter 和 shared control block |
| SegmentVideo 创建 MaterialSpeed | `0x137a250–0x137a340`，调用 `0x10520f8` | 静态构造路径 + 原生 getter 返回非空对象 |
| keyframe→timeline / timeline→keyframe | `0x340737c` / `0x3407dbc` | 真正 Video 对象上的双向差分 |
| 恒速方向映射 | `0x3408934–0x3408bc0` | 端点、double 运算、FCVTZS、回绕相加的静态和原生闭合 |
| relative sequence time | `0x340824c–0x340839c` | 包括非零/极值 Segment offset 的原生差分 |
| 打包 CommonKeyframe | `0x1e91c80–0x1e91eb8` | 原生创建控制记录，保留其真实控制块 |
| 记录恒速解析 | `0x1e92190–0x1e9362c`，恒速核心 `0x1e92744–0x1e9284c` | 原生改变记录 time 与控制 x，验证 y 未改变 |
| 实际 property 入口 | `0x33f35f4` | 真实 Segment + 两帧 group 的非命中调用 |
| graph-free linear 分支 | `0x33f47ec–0x33f4a18`、`0x33f5314–0x33f53a4` | 选定递增区间上的 double 线性求值差分 |

## 真实对象如何合法构造

`native_segments.hpp` 的 `video()` 调用 `makeCombination(const shared_ptr<Draft>&)`，参数为真正的空 libc++ shared_ptr。这里的工厂名称有明确含义：它创建 combination 对应的 SegmentVideo / material 子树，不代表已实现所有普通素材导入路径。空 Draft 分支自行调用原生 Draft 构造器 `0xd00f08`；SegmentVideo 经 `0x137dd68` 构造，构造过程中已经建立真实 MaterialSpeed。所测试的时间函数通过 SegmentVideo dynamic cast 进入 Video 路径，不读取实际素材文件或视频像素。

TimeRange 用真实 `make_time_range(int64,int64)` 工厂创建，通过 `0x137ddf8`、`0x122127c` 分别设置 source/target range；MaterialSpeed 经 `0x137e6b4` 取得，再以 `0x10522b0` 设置 mode=0、`0x10522f0` 设置 double speed。Segment offset 通过 `0x122150c` 写入。没有直接写模型字段。SDK 对象、虚表、内存分配、shared control block 与析构始终由 SDK 负责；仅库句柄有意保持到进程退出，避免卸载后执行原生析构。

控制记录也不自造：先用上一轮验证的 CommonKeyframe 工厂及控制点 setter 配置数据，再调用 `0x1e91c80`，其 ABI 为返回真实 shared_ptr、接收 `const shared_ptr<CommonKeyframe>&` 和 `bool includeGraph`。本轮明确传 `false`。解析函数接收真实 libc++ `vector<shared_ptr<Record>>&` 与 `const shared_ptr<Segment>&`。诊断只读该真实记录的 time 与四个控制坐标，并检查解析没有替换记录身份。

首次小样本先验证工厂、setter、双向时间与析构无故障，再扩成语料。初次控制记录差分曾因测试准备方式失败：原生 equal-value setter 把工厂的 `+0` 保留下来，直接设 `-0` 未改变 bits。诊断改为先设 1 再设目标值，确保输入确为请求 bits；没有修改原生或独立算法来掩盖差异。该失败 stderr 仍保留在私有证据目录。

## 两种不同的时间规则

所有输入仍是原始 int64 编辑器时间；本单元没有将它解释成秒、帧号或另行选择帧率。独立 API 明确限制 source/target duration 非负、speed 正且有限；这是已验证子域和独立参数校验，不是声称 SDK 自己会拒绝负速度等输入。start、query、offset 可以覆盖全部 int64。source/target duration 不强制满足 speed 比例，因为原生在端点处直接采用对侧的 duration。

### Video 时间轴转换

先用 64 位回绕减法得到 `delta = time - from.start`。起点距离严格小于 1000 时输出对侧起点；否则距末点严格小于 1000 时输出对侧末点。距离取绝对值也回绕，但此处阈值采用无符号比较，`abs(INT64_MIN)` 不会被误判为近端点。起点分支优先，因此两个吸附区间重叠时先落到起点。

没吸附时，keyframe→timeline 计算 double `delta / speed`，反向计算 `delta * speed`，再按 ARM64 `FCVTZS` 转 int64，最后回绕加对侧 start。这个路径不会把越界 query 夹到片段内。`FCVTZS` 的向零截断与超范围饱和必须显式实现，不能使用会触发 C++ 未定义行为的越界浮点转整数；独立辅助函数也保留 NaN→0 的指令语义，但该 NaN 输入在当前正有限速度和整数 query 子域中不可达。

Video 的这两个公共 helper 不加 Segment offset。relative sequence helper 另做一次回绕减法，减去 `target.start + offset`。它不能被简化成一概忽略 offset 的 `delta/speed`。

一个已验证的反例：source `{start=100000,duration=2000000}`，target `{start=5000000,duration=1000000}`，speed=2。原始时间 101000 正向得到 5000500；再反向，距 target 起点仅 500，因此吸附回 100000。双向函数不是处处互逆。原始时间 3100000 则向外推算为 6500000。另一个反例是 source duration=2000、target duration=3000、speed=2：原始末点输出 3000，不能用 `2000/2` 替代原生存储的对侧末点。

### 为控制曲线准备的记录

记录使用另一规则。先做 `delta = record.time - source.start` 的回绕减法；`delta < 1000` 全部归零，包括远在起点之前的负时间。随后，越过 source duration 或距末点小于 1000 的记录夹到 source duration。这一规则比时间轴 helper 更强，不能共用“端点吸附后其余外推”的策略。

令夹取后的整数为 `d`，`D = double(d)`，新记录时间为 `q = FCVTZS(D/speed)`。每个控制时间偏移重算为 `(oldX + D)/speed - double(q)`；控制 y 的 double bits 不变。target range 和 Segment offset 不参与这个变换。该表达式保留整数截断留下的残差：上述 speed=2，record.time=101001、oldX=0 时，`q=500` 而新控制偏移为 0.5，不能直接写成 `oldX/speed`。

## 非命中的线性 property 分支

本轮没有把先前独立 resample 当作播放器 property 算法。诊断调用真正的 `0x33f35f4`，传入合法 Video 与两个 CommonKeyframe 的真实 group，查询窗口设为 `[query,query]`，query 严格位于两个原始时间之间。两点均为 curve type 0、graph 为空，走过实际邻居查找及 Segment 时间转换后进入 graph-free linear 分支。

独立 `evaluate_linear_property_interval` 的调用者仍须给出已选定的两个端点。它检查原始 query 严格在内、映射后的左右时间递增、映射 query 在闭区间内，以及 values 为同尺寸非空向量；独立资源上限为 2^20 个 scalar。端点可因 1000 阈值吸附使映射 query 落在左右端点上，这仍被允许。确切命中、区间外、映射退化等路径明确拒绝，不能冒充完整 property dispatch。

先把左、右、query 都用 relative sequence helper 转换，进度为两次回绕 int64 差分别转 double 后相除。每个通道按顺序计算 double 的 `right-left`、乘进度、加 left，没有 float 窄化，没有 FMA。静态证据分别位于 `0x33f4934–0x33f49d0`、`0x33f4a10–0x33f4a18`、`0x33f5314–0x33f53a4`。Caption 的旋转特例在更早分支，本次 Video 工厂不进入，独立代码没有猜测复制它。

原生数值反例：left=0.1、right=0.9、progress=4/17，结果为 `0x1.2727272727272p-2`；把乘加融合得到 `0x1.2727272727273p-2`。独立测试直接保存已验证期望值并检查 FMA 确实不同。即使两个 values 相等，也不能擅自用端点恒等快捷路径：本分支的 `-0→-0` 可算出 `+0`，`Inf→Inf` 会产生 NaN。非 NaN 比较要求 bits 一致，NaN 只比较分类，不承诺算术 NaN 的 payload。

## 原生覆盖、回归与失败对照

| 项目 | 本轮最终结果 |
| --- | --- |
| 恒速配置 | 12 种 speed × 8 种 source duration = 96 个唯一组合；不同 start/target/offset 混合 int64 边界 |
| 每配置 query | 33 个时间，按正序和逆序重复；涵盖源/目标两端的 ±999、±1000、±1001 及 int64 极值 |
| 三个公共时间 helper | 6,336 组，共 19,008 个结果；零差异 |
| 原生打包与解析记录 | 6,336 个；原 time、新 time 及记录身份检查 |
| 恒速整数比较总数 | 31,680 个，全部相同 |
| 记录控制 double | 21,888 个非 NaN bit exact；3,456 个 NaN 分类相同；零差异 |
| 非命中 property | 72 组不同配置 × 16 查询 + 1 个 FMA 反例 = 1,153 调用 |
| property double | 3,969 个非 NaN bit exact；4,384 个 NaN 分类相同；零差异 |
| Release / ASan+UBSan CTest | 各 9/9 通过，warnings-as-errors，UBSan 禁止恢复 |
| 新 native probe 的 Release / sanitizer | 两次通过，解析后的 JSON 完全一致 |
| 旧 native / evaluation / window probe | 三次复跑，JSON 与上一轮三份结果逐值一致 |

正反查询顺序只验证本批独立函数调用结果，不证明整个播放器没有 seek 状态。Sanitizer 检查原创实现和诊断层，已安装 SDK 本身未经 sanitizer 重编译；只对 native sanitizer 运行设置 `ASAN_OPTIONS=detect_leaks=0`，独立 CTest 未关闭 leak 检查。当前本机为 AppleClang 21/macOS arm64；未在本轮运行 Linux/Windows。

14 个实际负向对照均非零退出：七个私有源码变体分别破坏严格阈值、末点 duration、记录夹取、relative offset、控制残差、分步乘加、double 精度；修改阈值的独立实现另外与真实 SDK 比较，也产生明确 mismatch。三项入口测试拒绝缺少参数、错误 dylib、相对路径；一项故意有符号溢出验证 UBSan 不恢复；两个新算法源码分别拒绝 fast-math。所有变体与失败输出保存在私有 `negative-controls/`，没有修改生产源码、降低断言或改变 SDK。

从 package 目录可复跑：

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-segment -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-segment --parallel
ctest --test-dir /tmp/qcut-editor-segment --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-segment/editor-segment_time-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-segment.json 2> /tmp/editor-segment.stderr

cmake -S research/independent-editor-contract -B /tmp/qcut-editor-segment-san -DCMAKE_BUILD_TYPE=Debug -DEDITOR_CONTRACT_SANITIZERS=ON -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-segment-san --parallel
ctest --test-dir /tmp/qcut-editor-segment-san --output-on-failure
ASAN_OPTIONS=detect_leaks=0 DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-segment-san/editor-segment_time-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-segment-san.json 2> /tmp/editor-segment-san.stderr
```

## 证据索引与尚未完成的工作

私有 `verification.json` 保存所有交付源码/本文 SHA-256、编译命令和结果，原始证据也逐文件取 hash；它同时引用上一轮的 `pack-common-keyframe.arm64.txt`、`resolve-control-record-time.arm64.txt`、`relative-seq-time.arm64.txt`，不重复把原文带入仓库。关键新增证据如下：

| 私有文件 | SHA-256 |
| --- | --- |
| `segment-factory-d.txt` | `2f90f15e8b73e258fba4259607a73915788246318cfb01f6d99be9aadc3cef5b` |
| `range-factory-c.txt` | `7e23d260a7c758b1b2a012df581e56fdad36ce896b18736ddcf16dc4fb84c186` |
| `segment-speed-construction.txt` | `df53ee9dcca06997e34854274b6efd074449f34e31b7ded7432c0e5e7e210e17` |
| `time-forward.txt` | `ec3ca59979c5e6295a6faabba98842f328c7973f1a4e6b527850e0800a96367b` |
| `property-linear.txt` | `fba2fafcaaa853590b4d485c447ab99b82b0374f70a4aa50cf9815ab24d1a286` |
| `property-linear-add.txt` | `4b953c5354c6e16ebca1633cccd11f3a8340be3f39d882d079351cd9856ba843` |
| `native-segment_time-release-final.json` | `5e7567cd1ae1a574e6106bce46a10d79c78237ed5e62447cb19eba849922855b` |

下一步可以沿相同合法工厂进入非零 curve type 的真正 property 分支，验证记录转换、左右控制点选择和已有 cubic 求值器之间的完整调用组合。仍未完成：MaterialSpeed 曲线模式与积分/反解、graph 展开后的多区间选择、Audio/Caption/其他 Segment 类型、property 区间外策略与完整 dispatch、编辑事件/dirty/record/undo、实际播放器 seek 状态、预览/导出。Creator 的状态传播另有独立单元，本次借出 Segment 工厂不等于已经把整条编辑调用链接入该库。
