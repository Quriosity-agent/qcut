# VideoEditor 非空 graph 与曲线变速属性合同（2026-09-08）

本轮将两条已恢复的真实链闭合到同一次属性调用：右关键帧非空 graph → 原生 graph 展开记录 → 正向连续曲线变速时间转换 → 每通道控制点选择 → 实际 VEUtils cubic。交付原创独立 C++20 实现及真实 SDK 对象差分，不止是调用 wrapper。1,330 组配置、95,372 次真实属性求值均零差异；仍不代表完整属性分派、seek 状态机、整库恢复或 QCut 预览/导出接入。

源码入口是 [variable_graph.hpp](../../../research/independent-editor-contract/variable_graph.hpp)，实现 [variable_graph.cpp](../../../research/independent-editor-contract/variable_graph.cpp)，公共记录选择/通道求值位于 [resolved_graph.cpp](../../../research/independent-editor-contract/resolved_graph.cpp)。此前的恒速 graph 路径共用同一求值逻辑，未复制另一份数学实现。原生 graph 测试上下文同样提取为共用 header，旧 oracle 输出整份 JSON 保持一致。

本批起点为 `68dda55478f454ffd2c61e4faf0686ed6877d656`，工作树为 `qcut-binary-cpp-scaleup-wt/qcut`，分支 `codex/jianying-binary-cpp-scaleup-20260908`。全部原始证据位于 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch3/editor-variable-graph/`；没有覆盖 batch2，也没有把厂商二进制、ASM、原始日志或项目文件放入仓库。该目录 `verification.json` 固定源码/证据 SHA-256。

## 1. 新证据与对象来源

重新核验本机剪映 11.3.0，两库身份仍为：

| 镜像 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

每次 oracle 先验证请求文件和实际加载镜像 hash、arm64 UUID、导出锚点。地址按本版本未滑移镜像解释。新有界 ARM64 解码保存在 `property-graph.arm64.txt`、`record-curve.arm64.txt`、`graph-expansion.arm64.txt`，分别覆盖 `0x33f35f4…0x33f49e0`、`0x1e92850…0x1e92b54`、`0x3a13eb0…0x3a14608`；命令使用 `xcrun llvm-objdump -d --start-address=… --stop-address=…`，没有使用忽略地址范围的 `--macho` 模式。

| 静态定位 | 恢复的行为 | 本轮动态证据 |
| --- | --- | --- |
| editor `0x33f3ce8` → `0x3a13eb0` | 实际 property 先展开 graph，第一/末端点复用输入 packed record | 对照展开后所有记录，核验原生端点对象 identity |
| editor `0x33f3d18` → `0x1e92190` | 展开之后才转换记录时间 | 同批原生记录调用真实 resolver 后再次逐字段对照 |
| curve 分支 `0x1e929c0…0x1e92b4c` | 写 record time、普通 incoming/outgoing time；不写 channel time/vector | 非空 graph 的 channel 时间和值转换前后按位保留，scalar 时间按曲线改变 |
| `0x33f42dc…0x33f42f4` | left-record outgoing channel vector 覆盖当前通道时，取其值及 `0xb0` 的整数时间偏移 | 与普通 outgoing 并存且不同的实测数据 |
| `0x33f4300…0x33f4344` | right-record incoming channel vector 覆盖通道时取 `0x78` 整数时间；否则使用普通控制 | 有/无 channel 的 graph 结构及普通控制特殊值对照 |
| `0x33f4348…0x33f43c8` | 时间/值转 double、加控制 offset，再窄化 float，调用真实 VEUtils `vtable+0x168` | 同一个实际 property 入口的 95,372 次值向量对照 |

Graph / GraphPoint / CommonPoint 使用先前已验证的真实工厂 `0x340c4a0`；值参数是包含真实 libc++ string/vector 的只读聚合，并有保护页。CurveSpeed 使用真实工厂 `0x1e72f48`；Video / MaterialSpeed / TimeRange / CommonKeyframe / CommonKeyframes / packed record 也全部来自真实工厂。factory 输出直接验证后才运行，不构造假的 SDK storage、虚表或共享控制块。模型由真正 shared handle 持有；裸 CurveSpeedUtils 工具经真实 deleting destructor 释放，库驻留到隔离进程退出。

本轮没有扩大原生 ABI：只复用已核验的模型工厂和 resolver / property 签名；身份以外的 SDK 动态依赖仍未逐一锁定。未修改 App、注入进程、打开或写入用户 draft。构造与数值层的详细来源分别见 [graph 工厂合同](videoeditor-graph-contract-2026-09-08.zh.md) 和 [曲线变速合同](videoeditor-variable-time-2026-09-08.zh.md)。

## 2. 每个时钟与控制来源

`prepare_variable_graph` 先执行原来的 graph 展开，再逐记录调用已恢复的曲线时间规则。输入两帧的原始值、普通控制和 graph 点保持只读，输出拥有独立的普通 C++ vector。

- Record 的绝对素材时间先减 source.start，再经过曲线逆映射成为序列时间；范围外按前一批的记录专用规则夹取。
- 普通 incoming/outgoing 的时间 offset 按 `truncate` 后绝对值 `>=1000` 决定是否转换；转换的是记录相对素材时间加控制 offset，之后减新记录时间。控制 value 保留。
- Graph 的 channel incoming/outgoing 时间是**原始展开结果的整数偏移**，包括单控制点二次曲线提升得到的偏移；不经过曲线时间映射。每通道 value offset 同样保留。
- 因此“把所有控制点统一变速”会改变原生结果。普通控制时间与每通道控制时间可以同时存在，并且拥有不同单位。

例：素材间隔 `[10,000, 3,990,000]`、速度曲线恒为 2、一个 graph 控制点 `(0.5,0.75)`。两端 record 时间为 `5,000 / 1,995,000`；普通 outgoing `4,000` 和 incoming `-8,000` 转成 `2,000 / -4,000`。二次提升的 graph outgoing `1,326,666`、incoming `-1,326,667` 保持原整数值，不能除以 2。

属性阶段按通道独立选择：某侧 channel value vector 覆盖当前通道，就同时采用该侧 channel integer time 与对应 value；否则用该侧普通 scalar time/value。左右侧独立判断。合法工厂语料覆盖 channel vector 完整存在或不存在的情况；任意手工构造的部分长度原生记录不属于本轮 factory 验证域，没有伪造记录去扩展声明。

将 selected record 的时间转 double，加入所选控制 time；将端点 value 加所选控制 value，然后全部窄化 float。`prepare_cubic_interval` 与实际 cubic 算法仍复用之前实现，保留明确 FMA/非 FMA 顺序，不重新拟合。

## 3. 选择、复制与 API 的限制

`evaluate_variable_graph_property` 接收**已选定的两个 Video 关键帧**、右帧非空 graph、同形非空通道值和严格处于 raw 端点内的 query，至少一侧 curve type 非零。它先验证 graph 拓扑并准备记录，再计算两帧及 query 的 relative-sequence 时间；完整 Segment 验证包含有限正 fallback speed。`prepare_variable_graph` 单独只需要有效 source/target duration，不使用 fallback speed 或 offset。

Mapped 范围检查与 resolved record 范围仍分开。公共记录扫描保留首个 closed record：只在 `record.time < query` 时前移；重复时间不能改成 `<=`。第一次命中时 previous 仍为首记录，progress 左界保留 mapped-left；之后前移更新为前一个 record 的时间。所有 record 时间在属性域内必须不降序。

计算路径 float→double，范围外/超过末记录的回退路径直接复制原 double values。±0 与 NaN payload 在复制时保留；算术 NaN 只比较分类。对输入 source frame、graph points 与局部 mutation 的快照不变，只证明本次字段未被改动，不保证 SDK 全局纯净或完整播放状态。

原有 graph 的首末 anchor 要求和 `2^20` 点×通道预算继续适用；曲线点要求 positive continuous、窄化后坐标严格递增，采用前一批 2–4096 点预算。source.duration 非负、target.duration 正。预算和拒绝规则是独立实现的限定域，不冒充 SDK 输入校验。首末 control、降序 resolved records、完整 graph dispatch、raw exact-hit 上层分派、Caption/rotation 特例、反向/离散曲线、编辑事件、seek/undo 和 UI 行为没有新增完成声明。

## 4. 可重复验证

Release 与 Debug ASan/UBSan 正式 oracle 的整份解析 JSON 相同，`passed=true`、0 mismatches：

| 项目 | 数量 |
| --- | ---: |
| 原生配置 | 1,330 |
| 展开记录与曲线转换记录比较 | 10,764 |
| 实际 property 调用 | 95,372 |
| 整数逐项比较 | 173,380 |
| 非 NaN double 逐位比较 | 829,812 |
| NaN 分类一致 | 19,286 |
| 源 frame/graph 快照检查 | 2,660 |

主要语料为 12 种 graph × 96 组素材/速度配置，共 1,152 组；复用 48 条速度曲线，交叉 2,000,000 与 100,000,000 序列时长、裁切源长、source/target 起点、offset、单侧/双侧 curve code 和 1/3/8/17 通道。Graph 含纯 anchor、单控制、双控制、额外 control、反向控制 handle、重复 anchor、近端 anchor、非 0/1 端点输入及 19-anchor 多段。

每组查询含原始区间近端点、内部网格、graph anchor 的 ±1 邻域，并按正向/反向顺序重复。额外 178 组包含 22 种浮点位型、144 组 wrapped int64 端点记录、12 组有/无 channel 配合 scalar 999.9/1000/±∞/NaN/最大 double。极端 wrapped 端点只验证展开和记录转换，不把这些无序端点冒充可求值的 property 域。实际 property 使用相同 query 作为 window 两端，没有冒充完整时间窗搜索。

总 FNV-1a 为 `16902837967886549324`。Standalone 固定主语料原生输出 fingerprint `9119564553003171886`，对应 46,464 次单向属性调用、336,864 个输出、4,425 个 NaN；加四组单独捕获的 native goldens（29 个逐位结果）、控制时钟独立手算示例、复制位型、非法/预算边界。所有 hash 状态显式使用 `std::uint64_t`，不依赖 Linux 上 `unsigned long long` 与 `uint64_t` 相同。

本目录 Release 13/13 CTest、Debug ASan/UBSan 13/13 通过，Werror 与严格浮点保持。原生 sanitizer 仅禁用 SDK 进程级 leak 检查；standalone 不禁用，且 ASan/UBSan 的 recover 关闭。SDK 二进制未被插桩。已重跑 old graph / nonlinear_property / variable_time 三个 oracle，整份解析 JSON 分别与 batch2 相同。新增代码本机已验证 AppleClang/macOS arm64，Linux/GCC13 和 Windows/MSVC 的本批运行仍以 CI 实际结果为准。

六个独立编译的错误实现同时被 standalone 与 native probe 检出：错误重映射 channel time、清空 channel values、清空 scalar outgoing、取消 channel 优先级、closed-record 改为 `<=`、末端复制错误窄化成 float。另验证无参数、错误镜像、fast-math 编译和 sanitizer UB witness 非零退出。一个探索 mutant 将首 progress 左界改为首 record 时间，当前 standalone corpus 未检出；留存在 `negative-controls-initial.log`，不计入六个检出项，也不声称覆盖所有局部控制流变体。

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-variable-graph -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-variable-graph --parallel
ctest --test-dir /tmp/qcut-variable-graph --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-variable-graph/editor-variable_graph-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-variable-graph.json 2> /tmp/editor-variable-graph.stderr
```

纯 C++ 和 CI 无需启用 native probe，也不需要剪映文件。下一单元可以将真正上层 keyframe type / window 分派与已恢复的 exact-hit、linear、nonlinear、graph 子域接起来；仍应先跟踪实际分支并通过合法模型验证，不用这些子域拼出猜测的完整播放器。
