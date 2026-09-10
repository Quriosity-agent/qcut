# VideoEditor 关键帧属性分派合同（2026-09-10）

本轮把此前分别恢复的窗口选择、恒速时间映射、线性插值与非线性 cubic 子域接到同一个真实入口 `lvve::KeyframePropertyHelper::getPropertyValuesByTimeOffsetInner`（`0x33f35f4`）：一次调用内完成 exact-hit 原样拷贝、单邻居拷贝、映射越界钳位、curve 路由与线性/记录求值。交付原创独立 C++20 实现与真实 SDK 对象差分。384 组配置、15,903 次真实属性调用零差异。

这条合同**只对单个 `SegmentVideo`、正的有限恒速、无 graph 的关键帧成立**。11 条按 Segment 类型的默认取值链和 Caption 颜色专用路径本轮只做识别与报告，没有实现，也不代表 seek 状态机、编辑事件、整库恢复或 QCut 预览/导出接入。

源码入口是 [property_dispatch.hpp](../../../research/independent-editor-contract/property_dispatch.hpp)，实现 [property_dispatch.cpp](../../../research/independent-editor-contract/property_dispatch.cpp)。窗口选择复用 [window.cpp](../../../research/independent-editor-contract/window.cpp)，时间映射复用 [segment_time.cpp](../../../research/independent-editor-contract/segment_time.cpp)，记录选择与 cubic 求值复用 [resolved_property.cpp](../../../research/independent-editor-contract/resolved_property.cpp)，没有复制第二份数学实现。

本批起点为 `97cf30a83fddc4b9f94bbc5f9dad47b8ed3f3809`，工作树 `qcut-binary-cpp-scaleup-wt/qcut`，分支 `codex/jianying-binary-cpp-batch4-20260910`。全部原始证据位于 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/editor/property-dispatch/`；厂商二进制、反汇编、原生 JSON 与 mutant 产物都留在仓库外，`source-manifest.json` 固定源码与两个镜像的 SHA-256。

## 1. 身份与对象来源

| 镜像 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

oracle 每次先校验请求文件与实际加载镜像的 hash、Mach-O arm64、LC_UUID 及导出锚点地址，再通过真实 `getVEUtils` 取 VEUtils 单例并核对 vtable 与 `0x168` cubic 槽，随后才允许调用私有 ABI。`identity.txt` 记录本机 `dwarfdump --uuid` 与 `nm` 结果：`0x33f35f4` 为 `getPropertyValuesByTimeOffsetInner`、`0x340b6a8` 为 `findKeyframeByTimeOffset_`、`0x340824c` 为 `getRelativeSeqTimeByKeyframeTimeOffset`、`0x2a1e5a0` 为 `lyra::CaptionAnimUtils::isCaptionText`。

对象全部来自真实工厂：`SegmentVideo` / `MaterialSpeed` 来自 `CombinationUtils::makeCombination` 的 null-Draft 分支，`TimeRange` 来自 `0x1e6e2c4`，`CommonKeyframes` 来自 `KeyframeUtils::ensureKeyframes`，`CommonKeyframe` 来自 `0x2af2edc`，时间/curve/values/控制点全走原生 getter/setter。没有手搓 vtable、shared control block 或对象存储；销毁归 SDK。厂商库按既有做法驻留到隔离进程退出。

有界反汇编 `property-dispatch.arm64.txt` 覆盖 `0x33f35f4…0x33f6538`（3,027 行），`caption-predicate.arm64.txt` 覆盖 `0x2a1e5a0…0x2a1e690`。

## 2. 分支地图

| 静态定位 | 恢复的行为 | 本轮动态证据 |
| --- | --- | --- |
| `0x33f364c` / `0x33f366c` | group 空指针与空 keyframe 列表是两个独立判据，落到同一条 Segment 默认链 | 独立实现报 `SegmentDefault`，standalone 单独覆盖 |
| `0x33f36b8` | `findKeyframeByTimeOffset_(group, start, end, remove=false, &prev, &next)`，命中走 x8 sret | 15,903 次与原生 finder 的 hit/prev/next **对象 identity** 交叉核对 |
| `0x33f3700` → `0x33f3724` | exact hit 原样拷贝 values；拷贝为空则记 `keyframe_property.cpp:400` 的 `keyframe valueEmpty` 日志再落默认链 | 4,705 次 exact-hit 逐位一致 |
| `0x33f3a94` / `0x33f3a98` | prev 缺失拷贝 next、next 缺失拷贝 prev | 4,681 次 nextCopy、3,065 次 previousCopy |
| `0x33f3aac` | prev 与 next 的 values 字节长度不等 → 默认链 | 320 次原生返回空向量，逐次核对 |
| `0x33f3ad8` | `add` 回绕求和后 `cinc`+`asr #1`：向零取整的有符号除 2，不是 `std::midpoint` | mutant `midpoint-halved-terms` 被原生对照检出 |
| `0x33f3aec` / `0x33f3b4c` / `0x33f3bac` | 同一时间助手依次作用于中点、`prev.get_time_offset()`、`next.get_time_offset()` | 复用已交付的 `keyframe_time_to_relative_sequence` |
| `0x33f3be4` / `0x33f3bec` / `0x33f4040` | `subs`+`b.lt` 与 `cmp`+`b.gt` 是真正的有符号比较；低侧拷 prev、高侧拷 next | 215 次 clampedPrevious、107 次 clampedNext |
| `0x33f3c10` / `0x33f3c20` | 两侧 curve code 皆为 0 才走线性，任一非零走记录/cubic | 997 次 linear、1,813 次 curved |
| `0x33f47f0` | 零曲线路径里右帧 graph 非空且点非空仍回记录路径 | 本轮整体划出域：带 graph 的帧一律拒绝 |
| `0x33f481c`…`0x33f4930` | `isCaptionText(segment) && (rp-lp) > 0` 且 property 名等于四个颜色常量之一才跳 `0x33f4c84` | 实测 `isCaptionText(SegmentVideo)` 为 false；1,156 次把 key 换成 `KFTypeTextColor` 后结果逐位不变 |
| `0x33f4934`…`0x33f5460` | 三个独立循环：`fsub` 求差、`fmul`（progress 在左）乘进度、`fadd` 加左端点；NEON 变体同样是 `fsub.2d`/`fmul.2d`/`fadd.2d`，没有 `fmadd` | mutant `linear-fused` 与原生相差 1 ULP 被检出 |
| `0x33f471c` | 单一返回点，没有后处理，也没有 UI 范围钳位 | — |
| `0x33f3848`…`0x33f412c` | 11 个 `___dynamic_cast`（源 typeinfo 恒为 `lvve::Segment`）构成默认取值链，全不匹配返回空向量 | 本轮只报告 `SegmentDefault`，不实现取值 |

进度分子是 `0x33f3be4` 的 `subs` 结果 `q - lp`、分母是 `0x33f4820` 的 `rp - lp`，两者都按 64 位回绕保留，再各自 `scvtf` 转 double 相除。范围比较用真正的有符号语义，只有被保留的差值回绕，这两件事在实现里是分开的。

## 3. 与已交付子域的差别

`evaluate_linear_property_interval` 要求 raw query 严格位于两端点之间且 mapped 区间严格递增；分派里这两条都不成立：窗口回绕时中点可以正好等于某个端点，端点吸附也可以让 `mappedL == mappedR`。因此线性分支在本单元内直接按原生的三段运算写出。

`mappedL == mappedR` 时原生算 `0/0`，进度为 NaN，整条输出为 NaN——**本单元照原样再现，不抛异常**。这与侦察阶段"按抛异常处理"的预案不同，改动理由是：照做能与原生对得上（NaN 只比较分类），抛异常则会在一个可达输入上与原生产生可观察差异。单向 corpus 里有 108 次 `mappedL == mappedR` 的线性调用；线性分支中整条输出为 NaN 的调用共 115 次（其余 7 次来自 NaN 输入值本身）。计数见证据目录的 `coverage.log`。

非线性分支复用 `property_detail::evaluate_records`，跳过 `evaluate_nonlinear_property_interval` 的 raw-time 严格性检查（该检查是那条 API 自己的定义域，不是原生行为），mapped 范围检查由分派自己的钳位分支完成。

## 4. 明确没有关闭的东西

1. **11 条 Segment 默认取值链没有实现。** 空 group、空列表、hit 的 values 为空、prev/next 形状不等这四种输入原生都会走那条链；本单元只报 `SegmentDefault` 且不给值。实测对本轮合成 property key，`SegmentVideo` 那条 getter 返回空向量（320 + 8 次观察），这只是观察记录，不升级成"默认链已恢复"。
2. **Caption 颜色路径（`0x33f4c84`）没有实现。** 只把门禁写成拒绝：`caption_text && (rp-lp) > 0 && property ∈ {KFTypeTextColor, KFTypeBorderColor, KFTypeShadowColor, KFTypeBackgroundColor}` 抛异常。`isCaptionText` 本身没有还原，本轮只实测它对 Video 返回 false。
3. **带 graph 的关键帧整体划出域。** 已有 `graph` / `variable_graph` 单元覆盖非空 graph 的求值，但"零曲线下右帧 graph 非空导致回到记录路径"这条路由没有并进本单元，输入里出现任一带 graph 的帧就抛异常。
4. **`SegmentVideo` 以外的 Segment 类型、变速片段、反向/离散曲线速度都不在域内。** 变速与 graph 的组合仍由 `variable_graph` 单独覆盖，两者尚未合并到同一次分派。
5. **prev/next 两侧 values 同时为空**：原生的长度检查会放行（0 == 0），但其后续返回值没有追到底，本单元抛异常而不是猜。
6. **降序 resolved record** 沿用 `nonlinear_property` 的既有拒绝；原生在这种输入下不会抛，只是会算出别的东西。这是本实现的定义域限制，不是原生校验。
7. **结构性不可达分支**：列表非空时 finder 至少给出一个邻居，所以"hit 为空且 prev/next 都为空"这条原生分支在本域内不可达，只做文档记录，没有伪造测试去"覆盖"它。
8. 快照只证明本轮调用没有改动这些 keyframe 字段，不保证 SDK 全局纯净或播放状态行为；厂商库本身没有被 sanitizer 插桩。

## 5. 可重复验证

Release 与 Debug ASan/UBSan 两次正式 oracle 的整份解析 JSON 完全相同，另做一次 Release 重跑同样相同，`passed=true`、0 mismatches：

| 项目 | 数量 |
| --- | ---: |
| 原生配置 | 384 |
| 实际 property 调用 | 15,903 |
| finder 分支归因核对 | 15,903 |
| 整数逐项比较 | 17,067 |
| 非 NaN double 逐位比较 | 39,188 |
| NaN 分类一致 | 3,348 |
| Caption 颜色 key 对照调用 | 1,156 |
| 空 values 调用 | 8 |
| 源 keyframe 只读快照检查 | 792 |
| 独立实现拒绝（域外） | 0 |

分支直方图：exact-hit 4,705、next 拷贝 4,681、prev 拷贝 3,065、低侧钳位 215、高侧钳位 107、线性 997、记录/cubic 1,813、默认链 320。比较 FNV-1a 为 `13938471611794060096`，分支序列 FNV-1a 为 `12001548566879557755`。

语料是 12 种时间形状 × 32 组配置，交叉 8 个 Segment（含 target 远短于速度比、target 远长于速度比、零时长、回绕素材起点、0.5/1/2/3.25 速度）、1–5 个关键帧、1–5 个通道、四组 curve code、±0/次正规/±∞/NaN payload 的值型，以及每帧 ±1/±1000 邻域、相邻中点、回绕与极值窗口，正反两种顺序各跑一遍。其中专门设计的边界包括：进度恰为 4/17 的 `.1 → .9`、`q == mappedL`、`q == mappedR`、`mappedL == mappedR`、两侧形状不等、以及靠端点吸附造成的映射非单调（钳位分支的唯一来源）。

standalone 固定同一语料的单向指纹 `1171570040708058013`（7,944 次调用、19,816 个输出、1,558 个 NaN）与分支直方图，另外钉入 15 组原生 golden（覆盖 8 条分支，含 1 ULP 的线性样本、±0 相加样本与 NaN 分类样本）。默认 CTest 不加载任何厂商库。

九个独立编译的错误实现：

| 变体 | standalone | 原生对照 |
| --- | --- | --- |
| 钳位方向对调 | 检出 | 检出 |
| 钳位改用 `<=` / `>=` | 检出 | 检出 |
| 中点改成 `start/2 + end/2` | 检出 | 检出 |
| 删掉 exact-hit 分支 | 检出 | 检出 |
| 线性改用融合乘加 | 检出 | 检出（差 1 ULP） |
| 形状检查放宽成单向 | 检出 | 检出 |
| curve 路由 `||` 改 `&&` | 检出 | 检出 |
| 线性分母改成 `rp - q` | 检出 | 检出 |
| 空拷贝直接返回而不回落 | 检出 | **未检出** |

最后一个如实保留：空拷贝回落与默认链在这个入口处都返回空向量，原生输出无法区分两者，所以只有 standalone 的分支断言能抓到它。侦察阶段未被检出的三个变体（钳位方向、钳位相等、融合乘加）在补齐钳位与边界相等 fixture 后全部被原生对照检出。另外核验了无参数、错误镜像、相对路径与 fast-math 编译四道门禁均非零退出。

本目录 Release 14/14、Debug ASan/UBSan 14/14 通过，`-Werror` 与 `-ffp-contract=off` 保持。原生 sanitizer 运行仅禁用进程级 leak 检查，standalone 不禁用且关闭 recover。已重跑 `graph` / `nonlinear_property` / `variable_graph` 三个 oracle，整份解析 JSON 与既有记录一致。新增代码本机验证于 AppleClang 21 / macOS arm64，Linux 与 Windows 以 CI 实际结果为准。

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-property-dispatch -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-property-dispatch --parallel
ctest --test-dir /tmp/qcut-property-dispatch --output-on-failure
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-property-dispatch/editor-property_dispatch-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-property-dispatch.json 2> /tmp/editor-property-dispatch.stderr
```

纯 C++ 与 CI 不需要启用 native probe，也不需要剪映文件。下一单元可以从 11 条 Segment 默认取值链里挑一条（`SegmentVideo` 的 `0x34234f4` 最接近本轮域），或者把 Caption 颜色路径 `0x33f4c84` 单独立项；两者都应先跟真实分支、用合法模型验证，不要用现有子域拼出猜测的完整播放器。
