# 关键帧记录选择走查（keyframe_stash）— 第五批 VECreator 线

日期：2026-09-10  
目标库：剪映 11.3.0 `libvideoeditor.dylib`（SHA-256 `ee33e4e6…4c25ab`，LC_UUID `22337058-B217-3CAF-9979-CFECA7302CF7`，arm64 切片偏移 94060544，切片自身 SHA-256 `253e3fdb…d71526`）  
新增单元：`research/independent-creator-contract/keyframe_stash.{hpp,cpp}`、`keyframe_stash_tests.cpp`、`native_keyframe_stash_support.hpp`、`native_keyframe_stash.mm`

## 一、这一批关闭了什么

`CommonKeyframes → NodeArray<CommonKeyframe> → CommonKeyframe → {左控制点, 右控制点, Graph 槽}`
这条链上的 **`get_stash_copy` 记录选择走查**。三个新写的独立函数：

- `stash_keyframe(current, history, changed)`
- `stash_keyframe_array(current, history, changed)`
- `stash_keyframe_group(current, history, changed)`

返回空指针表示「这棵子树不产生记录」；`changed` 是整趟遍历共用的累加出参，孩子直接写进调用方的同一个引用。

**本批新还原的实现只有关键帧节点层与 group 层。** 数组层是同一个类模板的第二个实例被复用并再验证，图那一半（`Graph::get_stash_copy` / `GraphPointArray::get_stash_copy` / `GraphPoint` / `CommonPoint`）在第二批已经作为 `stash_graph_tree` / `stash_graph_array` / `stash_graph_point` / `stash_point` 交付，本批只是把它们作为孩子接进来并在原生对照里再跑一遍。不要把本批读成「数组层或图层是新还原的」。

## 二、静态证据

### 槽表闭合

从 `__DATA_CONST`（本镜像里 vmaddr == 文件偏移）直接读出四张 vtable，四个批次的常量落在同一张表上（完整表见 `recon/array-template-siblings.txt`）：

| 类 | vtable | +0x08 析构 | +0x30 deep_copy_raw | **+0x38 get_stash_copy** | +0x40 restore_from | +0x50 get_all_nodes |
| --- | --- | --- | --- | --- | --- | --- |
| `lvve::CommonKeyframe` | `0x4bce660` | `0xc82d0c` | `0xc7e5e4` | **`0xc7ea80`** | `0xc7f17c` | `0xc81fd0` |
| `lvve::CommonKeyframes` | `0x4bcea70` | `0xc86b90` | `0xc842c0` | **`0xc84570`** | `0xc84c48` | `0xc8637c` |
| `NodeArray<CommonKeyframe>` | `0x4bceb80` | `0xc86f40` | `0xc870a4` | **`0xc873f8`** | `0xc87a68` | `0xc884f0` |
| `lvve::GraphPointArray` | `0x4bdd330` | `0xd9b22c` | `0xd9b390` | **`0xd9b6e4`** | `0xd9bd54` | `0xd9c7dc` |

五个导出入口的地址与 `nm` 一致：`CommonKeyframes 0xc84570`、`CommonKeyframe 0xc7ea80`、`Graph 0xd984b0`、`GraphPoint 0xda3364`、`CommonPoint 0xc8edc8`。全库共 533 个导出的 `get_stash_copy`，本批只碰其中五个。

### 两个数组层是同一个模板实例

把函数内跳转目标改成相对偏移、其余绝对地址一律替换成同一个记号之后（`recon/array-instance-diff.txt`）：

- `NodeArray<CommonKeyframe>::get_stash_copy` 与 `GraphPointArray::get_stash_copy` 各 **412 条指令，归一化差异 3 行**，全部是 `add` 的立即数：数组 typeinfo `0x4bcec18` vs `0x4bdd3c8`、元素控制块 vtable `0x4bce770` vs `0x4bdd3f0`、元素 typeinfo `0x4bce6f8` vs `0x4bdd748`。
- 同一模板的另外两对（`recon/array-template-siblings.txt`）：`set_nodes` `0xc841c8` vs `0xd98120` 各 62 条指令、**归一化差异 0 行**；`std::make_shared<NodeArray<T>>` `0xc83ce4` vs `0xd97bfc` 各 64 条指令、差 2 个 vtable 常量。

独立实现里因此只写了一份数组走查模板，并且把它的第二个实例 `stash_shared_graph_array` 也导出来，让「同一模板」这句话在 CTest 与原生诊断里都变成可执行的断言，而不是文档里的一句话。图那一条产品路径仍然走第二批的 `stash_graph_array`，本批没有改它。

### 走查规则（逐条来自反汇编）

关键帧层（`0xc7ea80`–`0xc7f17c`，447 条指令）：

1. 用自己的 `id` 造 `string_view` 查历史索引；未命中、映射为空、或 `__dynamic_cast`（typeinfo `0x4bce6f8`）失败三种情况一律 `*changed = 1` 并返回 `deep_copy_raw(false)`。
2. 命中后，记录的底稿是**历史节点**的浅拷贝（`0xc82d20` 拷贝构造，共享历史的两个控制点、值向量与 Graph），再盖上**当前**节点的 `state_code`（`+0x24`）与 `changed`（`+0x28`）。
3. 逐字段：`+0x2c` int32 曲线、`+0x30` int64 时间、`+0x68` std::string（长串走 `memcmp`，内嵌 NUL 不截断）。任一不等就补出底稿、写入当前值并置 `*changed`。
4. `+0x58` 的值向量：先比**字节长度**（`end - begin`），再逐元素 `fcmp`。这是 IEEE `==` 而不是逐位比较 —— 两个异号零相等（不触发重写），任何 NaN 都不等于自身（一定触发重写）。不等时由当前区间新造一个共享 vector。
5. `+0x38` 左控制点、`+0x48` 右控制点：无空指针检查直接虚调用，且 `x2` 传的是**调用方自己的 `&changed`**，所以这一层自己不写标志。
6. `+0x80` Graph 槽：当前有图就虚调用（同样直接下传调用方的 `&changed`）；当前无图而历史有图，则把记录的 Graph 槽清空并 `*changed = 1` —— 这是本层唯一自己上报的图相关转移。

数组层（共享模板）：先按当前数组自己的 `id` 查历史数组，命中就把**历史数组** active 列表里每个元素自己的 `id` 灌进一个哈希集合（`max_load_factor` 1.0f）。然后逐个当前元素：

- 每个元素先拿一个**新的局部 bool**，不是调用方的标志；
- 孩子返回非空 → 压入孩子，置替换位；`+0x61` 抑制位为零且局部 bool 为真才写调用方的 `changed`；
- 孩子返回空但元素 `id` 在索引里命中同类型 → 以别名 `shared_ptr` 压入**历史对象**，再拿**历史对象自己的 `id`**（不是查到它的键）去问那个哈希集合：命中就连替换位都不动，未命中才置替换位并（受 `+0x61` 门禁）上报；
- 孩子返回空且索引未命中 → `deep_copy_raw(false)` 压入，置替换位并（受门禁）上报。

收尾：没有任何替换且 retained 为空就返回空指针；否则从**当前**数组拷贝构造记录、装入收集到的 active、清零两个瞬时字（`+0x78`/`+0x80`），retained 非空再（受门禁）上报一次。

group 层（`0xc84570`–`0xc84c48`，438 条指令）：对象 112 字节，只比 `+0x30` material_id 与 `+0x48` property 两个字符串，**没有整数字段比较**（与 Graph 的 `+0x60` 不同），孩子在 `+0x60` 且把调用方的 `&changed` 直接下传。

## 三、对侦察结论的两处修正

侦察阶段有两条判断经复核不成立，按「不许为了好看而修饰」的要求原样记录：

1. **`+0x61` 抑制位并非结构性不可达。** 侦察在两段代码里搜 `strb w*, [x*, #0x61]` 只找到 `deep_copy_raw` 内部那一处，因而判定「没有任何已核验入口能把它置真」。实际的写入在 `make_shared` 辅助函数里，偏移是合并分配块上的 `#0x79`（对象自身的 `+0x61`）：`std::make_shared<NodeArray<CommonKeyframe>>(id, track_children, suppress)` 在 `0xc83ce4`，与第二批早就在用的图点数组工厂 `0xd97bfc` 是同一模板。本批因此用真实工厂造出抑制位为真的关键帧数组，配合同样是模板兄弟的 `set_nodes`（`0xc841c8`，与 `0xd98120` 逐条相同）填入元素，**把抑制分支真的跑了出来**：120 个抑制数组案例，其中 20 个带脏元素、120 个带未入索引的元素、30 个带「索引命中但不在历史 active 集合」的元素、14 个带 retained 列表。对应的负控 `array-shared-flag` 也因此被检出。没有手写内存，没有伪造对象。
2. **数组层 `deep_copy_raw` 并不是把三个状态字段全部清零。** 它先在 `0xc87144`–`0xc8714c` 把 `+0x20/+0x24/+0x28` 清零，随后在 `0xc871b0`–`0xc871bc` 又从源对象把 `changed` 与 `state_code` 抄回来，只有 tracking 真的留在零。第一版独立实现按「全部清零」写，原生对照第 0 个案例第 14 次比较就报错；改成只清 tracking 后一致。这同时确认了第二批 `graph_tree.cpp` 里 `deep_array` 的写法是对的，本批没有改动它。

## 四、原生对照

**身份门禁**（只做加法，复用既有模式）：文件与已加载镜像的 SHA-256、Mach-O arm64、LC_UUID、既有锚符号地址（`native_library.hpp`）；第四批 `HistoryNative` 的十五个 node-history 入口按导出名与地址各解析一次；本批再加五个导出 `get_stash_copy`，每个都要求 `dlsym` 结果 == `base + 记录地址`。两个未导出的数组层不猜地址：从真实对象读 vptr，要求等于 `base+0x4bceb80` / `base+0x4bdd330`，再要求该 vtable 的 `+0x38` 槽等于 `base+0xc873f8` / `base+0xd9b6e4`，任一不符直接拒绝。

**语料**全部来自真实工厂与公开 setter：关键帧组工厂 `0x340a010`、关键帧工厂 `0x2af2edc`、图工厂、`set_graph` `0xc7e510`、`set_keyframe_list` `0xc8412c`、`set_material_id` `0xc83f38`、`set_property_type` `0xc8402c`、`set_time_offset` `0xc7dfb8`、`set_values` `0xc7e1c8`、`set_text` `0xc7e41c`、`reset_is_dirty` `0xc7e98c`、`set_is_tracking` `0x36428c`、`set_track_children` `0xc86f7c`。同 ID 不同对象由已核验的 restore 拷贝（`0xc7f600` / `0xc84edc` / `0xda3830`）产生。历史索引由**第四批的 `get_all_nodes` 填出**，再逐项翻译成独立索引（翻译不上则直接报错），两批在同一进程里串联。

**比较项**：记录指针是否为空、`changed` 出参、`escaped` 出参是否被写、escape map 大小是否变化；记录子树逐字段（id 字节、`+0x2c`/`+0x30`、`+0x68` 字符串字节、值向量长度与逐元素位型、`+0x20/+0x24/+0x28`）；**子对象身份** —— 记录里的孩子究竟是历史对象、当前对象还是新副本，靠一张双向唯一的指针映射交叉核对；调用结束后再拿当前树与历史树各自和调用前的镜像比一遍，既验证输入未被改动，也验证记录选的确实是它声称的那个对象。返回的裸 `Node*` 用各自类的 deleting destructor 释放。

**结果**：

| 构建 | 案例 | 比较次数 | 不一致 |
| --- | --- | --- | --- |
| Release | 2,207 | 397,277 | 0 |
| Release 重复一次 | 2,207 | 397,277 | 0 |
| ASan/UBSan（`-fno-sanitize-recover=all`） | 2,207 | 397,277 | 0 |

三次输出除 SDK 运行时生成的 UUID 外逐字符相同。语料覆盖：group/数组/关键帧三种根 508 / 400 / 292；产生记录 1,100，未产生 100；上报变更 950，静默 250；空历史索引 220；present-but-null 条目 50，类型不符条目 50；带图 642，掉图 66，加图 132；带 retained 的数组 129；抑制数组 120；记录里复用历史元素 209 次。

`-Werror -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -ffp-contract=off -fno-fast-math`，两套构建零告警。

## 五、独立 CTest

新增一组 `creator-keyframe_stash`，114 条断言，默认构建不加载任何厂商库。CTest 组数由 13 增至 14，Release 与 fail-fast ASan/UBSan 均通过。

SDK 的 ID 是运行时 UUID，无法复现，因此钉进默认 CTest 的是**按角色标注的结果**，原始值另存 `native-keyframe-stash.json`：

- `array-clean`：两个与历史元素逐字段相等且已复位的孪生元素 → 不产生记录，不上报变更；
- `array-dirty`：其中一个改了曲线 → 产生记录，元素角色 `[新对象, 历史对象]`，上报变更；
- `array-dirty-suppressed`：同上但抑制位为真 → 记录与角色完全相同，**不**上报变更；
- 四个 group 级案例（种子 3/6/9/21）的「是否产生记录 / 是否上报 / 元素数 / 每个元素的角色 / material 是否取自历史」。

## 六、负控

16 个变体编译并运行，另有 2 个在独立侧根本写不出来，一并留在台账里。分类如实报告（`mutants.json`）：

**14 个真变异，独立测试与原生对照双双检出**：`miss-shallow`（历史未命中返回浅副本）、`shallow-from-current`（用当前对象而非历史对象做底稿）、`no-state-writeback`（去掉当前 state_code/changed 的回写）、`bitwise-values`（值向量改用逐位比较，被异号零与同 payload NaN 抓到）、`no-changed-on-dirty`（脏节点只造记录不上报）、`array-shared-flag`（数组把调用方的标志直接给元素，只有抑制数组能分辨）、`array-current-ids`（历史 ID 集合改用当前 active）、`array-null-child-current`（静默元素压当前对象的副本）、`array-retained-silent`（retained 非空不上报）、`array-no-retained-record`（retained 非空不产生记录）、`graph-keep-slot`（掉图时不清空记录的 Graph 槽）、`deep-array-keeps-tracking`（深拷贝保留数组 tracking）、`string-skip`、`time-skip`。

**2 个根本不是变异**（保留在台账里，不计入检出）：
- `values-not-equal-operator`：对 binary64 而言 `a != b` 就是 `a == b` 的严格取反（含 NaN），两个版本是同一个谓词，两侧都不可能分辨。
- `payload-byte-length`：原生比的是指针相减出来的字节长度，独立实现比的是元素个数；对 `vector<double>` 两者相差一个常数因子 8，是同一个谓词。

**2 个结构性不可观测**（同样保留）：
- `escape-map-as-history`、`escape-forwarding-shape`：独立 API 根本没有 escape 参数，这两个变体在独立侧写不出来；原生侧本族三个新函数对第 3/4 参数只有入口保存、栈上溢出与向孩子转发，全函数没有一条写 escape 标志的 `strb`，因此也没有可比的外部差异。诊断只能给出边界断言：2,207 个案例里 `escaped` 始终保持种子值、escape map 大小始终不变。这是第四批 escape 结论在记录面的重现，不是新发现。域外的已知反例仍是 `lvve::Algorithm::get_escape_history_nodes` @0xbcdb84，本批未碰。

两处语料修补也一并记录：`no-changed-on-dirty` 与 `deep-array-keeps-tracking` 在第一轮分别只被单侧检出，原因是语料里没有「只有脏标志、其余字段与控制点全等」的孤立案例，以及独立测试没有覆盖关键帧数组自己的深拷贝。补上这两个案例后两者被双侧检出 —— 这是补语料去覆盖已存在的分支，不是为了掩盖漏检而增删变体。

## 七、回归

本线既有的八个原生诊断在同一进程环境下重跑，全部通过且计数与既有记录一致（`regression/`）：

| 诊断 | 计数 | 不一致 |
| --- | --- | --- |
| `creator-native-history` | 4,614 案例 / 159,401 比较 | 0（与第四批 `native-history-final.json` 除 SDK 运行时 ID 外完全一致） |
| `creator-native-graph-diff` | 5,890 / 8,123,755 | 0 |
| `creator-native-graph-record` | 4,738 / 692,606 | 0 |
| `creator-native-record` | 3,842 / 440,390 | 0 |
| `creator-native-dirty` | 2,244 案例 / 407,020 值 | 0 |
| `creator-native-insertion` | 4,200 案例 / 82,752 值 | 0 |
| `creator-native-events` | 10,008 | 0 |
| `creator-native-constants` | 2,048 次调用 | 通过 |

## 八、明确没有关闭什么

- **只关闭了节点层的记录选择。** `Draft::get_stash_copy`、`Draft::reorganize_dirty_states`（@0xd18618，实读是对 `+0xb0…+0x170` 一串子成员做 `state_code==0 && get_is_dirty() && tracking → state_code=2` 的提升，属于事务边界的前置 pass）、`lyra::Session::draftTransaction`、`draft_store::IOManager::startTransaction/commitTransaction` 一个都没有动。
- `to_patch_json` / `patch_from_json` / `dirty_node_to_patch_json`（本库分别有 570 / 285 / 285 个符号）刻意没碰。
- escape map / escape flag 的任何非平凡语义不在合同内 —— 本族只透传。
- 返回 map、哈希集合的迭代顺序不复现；`0x2f5c8` 的 `string_view` 散列不复现。
- 分配失败下的原子性不承诺（沿用第三批口径）。
- 空指针输入（Graph 槽除外，原生一律不查空）由独立 API 前置拒绝，这是 QCut 的输入保护策略，不冒充 SDK 行为；诊断不会喂空指针去「证明」崩溃。
- 数组的 retained 列表只按指针拷进记录，从不解引用；要求其非空是 QCut 策略，不是观察到的原生门禁。
- 不修改剪映应用、草稿或运行中的服务，不启动剪映 UI。仓库内只放自有源码、测试、诊断与本文档；反汇编、原生 JSON 与厂商产物留在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/batch5/creator/`。
