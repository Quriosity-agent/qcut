# Creator 第四批：节点历史索引与 escape 通道

本轮新增原创 C++20 [history_index](../../../research/independent-creator-contract/history_index.hpp)，在已重建的
CommonPoint / CommonKeyframe / CommonKeyframes / NodeArray&lt;CommonKeyframe&gt; / Graph / GraphPointArray /
GraphPoint 这一族节点上，闭合 `get_all_nodes` 的索引构建，以及 `get_escape_history_nodes` /
`set_escape_history_nodes` 两条 escape 通道。实际入口在 `libvideoeditor.dylib`，按 Creator 的编辑调用链归组。
默认构建不加载厂商库。

固定安装版与前三批相同（剪映 11.3.0）；原生诊断在调用前核验 SHA256、arm64 UUID 和锚符号地址，并且额外要求
十五个新入口的 `dlsym` 结果与记录地址逐个相等，任一不符直接拒绝，不做盲调。私有证据在
`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/creator/`，包含静态反汇编片段、vtable 槽位映射、构建与
CTest 日志、`commands.json`、原生结果的重复与消毒器版本、错误变体记录。没有修改应用、草稿或 SDK 对象内存，
没有启动剪映界面。

## 遍历与插入

七个类的访问顺序由类型本身决定，与节点内容无关。CommonPoint 的三个钩子各是一条 `ret`，是递归终止点。
CommonKeyframe 依次处理左控制点（`+0x38`）、右控制点（`+0x48`）、图（`+0x80`），每个孩子都是「先插入、
再递归」；图槽上的 `cbz` 是整个遍历里唯一的空指针门禁。CommonKeyframes 与 Graph 各自插入并递归自己持有的
数组（`+0x60` / `+0x68`）。两级数组的代码逐条指令相同：从 `[+0x30, +0x38)` 以 16 字节步长走 active 列表，
对每个元素先插入再递归；`+0x48` 的 retained 向量自始至终没有被载入。被遍历的根对象从不插入自己。

键是孩子自身 `id`（对象 `+8` 的 `std::string`）上的 `string_view`：`ldrb w8,[x22,#0x1f]` 读 libc++ 的短串
判别位，长串取 `{data,size}`，短串取 `{对象+8, 长度字节}`。空 ID、含内嵌 NUL 的 ID、以及长到离开短串形态的
ID 都在域内，键不会在第一个 NUL 处截断。

值是父对象所持 `shared_ptr` 的强拷贝：代码先把指针和控制块写进新节点、`ldadd` 加一，然后才尝试插入。
`__node_insert_unique` 返回位 0 为 0 时（键已存在），刚做的这份拷贝被销毁、节点被 `operator delete` 释放，
原有条目与原有键字节都保持不变——即「先到先得」。调用方传入的 map 是累加的，不会被清空，预置条目也不会被覆盖。
GraphPoint 把 libc++ 的插入完全内联（`cnt.8b/uaddlv.8b` 求 popcount 的 `__constrain_hash`、链表比较掩码后的
hash、`node+0x18` 的键长、`memcmp`、`__next_prime` 重散列），确认这就是普通 `std::unordered_map` 语义。

顺序只有在两个不同对象共用一个 ID 时才可观测，所以对照语料专门用 SDK 自己的 restore 拷贝制造这种碰撞：
拷贝出的对象与源对象 ID 相同、地址不同。左右控制点碰撞、控制点与图内坐标碰撞、同一数组里两个同 ID 帧，
这三条分支各自有独立计数，报告里给出实际命中数。

## 边界与拒绝策略

原生代码对左右控制点、数组元素、以及 CommonKeyframes / Graph / GraphPoint 各自持有的那一个孩子都不做空
指针检查（`ldr x8,[x21,#0x38]!` 后直接 `add x1,x8,#8`；`ldr x22,[x0,#0x60]` 后直接 `ldrb w8,[x22,#0x1f]`）。
独立 API 因此在遍历前显式拒绝这些空指针。这是 QCut 的输入保护策略，不声称是 SDK 自己的拒绝行为；诊断也
从不喂空指针去「证明」崩溃。retained 条目只检查形状，不递归，因为遍历根本不载入它们。

键的生命期绑在被插入节点自己的 `id` 上。map 里那份强引用正是让这些字节继续有效的东西：父对象释放后键仍然
可用，清空 map 才释放最后一个引用。插入之后再改这个 `id` 会让已记录的键落空，这一点写死在接口注释里，不在
本合同范围内。返回 map 的迭代顺序是 libc++ 桶布局的产物，本轮不重建，比较器只按键查找，从不并行遍历两张表；
`0x2f5c8` 的 string_view 散列函数也没有重建。

## escape 通道：一条被证明的边界

对这七个类，`get_escape_history_nodes` 和 `set_escape_history_nodes` 走的是同一条脊柱，但不插入任何东西、
也不写任何字段：CommonPoint 是单条 `ret`；CommonKeyframes / Graph / GraphPoint 是四条指令的尾调用；
CommonKeyframe 是同样的三孩子分派；两级数组是同样的 active 遍历，只是把虚表槽换成 `+0x58` / `+0x60`。
因此对这一族来说两个钩子是可观测意义上的空操作。这解释了此前 stash 诊断里传空 escape map 为什么是合法输入，
但它不是「恢复了一条历史选择规则」，本轮也不会这么写。

代价是诚实的：escape 脊柱的形状无法被任何对照检出。为了用证据而不是断言说明这件事，本轮另外编译并运行了
三个只改 escape 遍历的变体（跳过图、遍历 retained、倒序遍历 active），三个都通过了独立测试和原生对照——
即未被检出，记录在 `mutants.json` 的 `undetectableByConstruction` 段。

## 原生证据

全部为 arm64 切片内未滑动 VM 地址（切片偏移 94060544，`__TEXT` 的 vmaddr 与 fileoff 均为 0）。

| 入口 | get_all_nodes | get_escape_history_nodes | set_escape_history_nodes |
| --- | --- | --- | --- |
| `lvve::CommonKeyframes` | `0xc8637c` | `0xc86488` | `0xc86498` |
| `lvve::CommonKeyframe` | `0xc81fd0` | `0xc82228` | `0xc8228c` |
| `lvve::Graph` | `0xd9a64c` | `0xd9a758` | `0xd9a768` |
| `lvve::GraphPoint` | `0xda47dc` | `0xda4c04` | `0xda4c14` |
| `lvve::CommonPoint` | `0xc8fbdc` | `0xc8fbe0` | `0xc8fbe4` |

两级数组未导出，只经由上表的导出根到达，虚表指针另行断言：

| 未导出实现 | vptr | `+0x50` | `+0x58` | `+0x60` | `+0x68` |
| --- | --- | --- | --- | --- | --- |
| `NodeArray<lvve::CommonKeyframe>` | `0x4bceb80` | `0xc884f0` | `0xc88620` | `0xc8866c` | `0xc886b8` |
| `GraphPointArray` | `0x4bdd330` | `0xd9c7dc` | `0xd9c90c` | `0xd9c958` | `0xd9c9a4` |

槽位映射本身可自证：`0xd9c9a4` 正是前一批 graph diff 诊断已在用的数组 `restore_by_diff` 常量。

对照用的真实对象全部来自 SDK 工厂与 setter：关键帧组 `0x340a010`、关键帧 `0x2af2edc`、图 `0x340c4a0`、
图点数组 `0xd97bfc`，结构 setter 为 `set_left_control 0xc7dff8`、`set_right_control 0xc7e0dc`、
`set_graph 0xc7e510`、`GraphPoint::set_point 0xda3018`、`set_keyframe_list 0xc8412c`、
`set_graph_points 0xd98084`；同 ID 不同对象由已核验的 restore 拷贝 `0xc7f600` / `0xda3830` 产生，
释放走已核验的 deleting destructor。没有手写虚表、伪造控制块或注入内存。

## 验证

| 验证 | 结果 |
| --- | --- |
| 独立 Release / ASan+UBSan | 各 13/13 CTest（新增前为 12/12），13 组共 1,371 条断言，其中新增 58 条 |
| 新真实 SDK 对照 | 4,614 案例，159,401 比较，0 差异 |
| 原生重复运行与消毒器构建 | 三次报告的案例数、比较数、覆盖计数与角色化金样例完全一致；厂商库本身未插桩 |
| 语料覆盖（来自同一次运行的计数） | 五个导出根分别 2,392 / 615 / 664 / 324 / 613 次；非空 map 4,190；预置 map 3,200；含 retained 列表 308；含同 ID 不同对象 1,296；含图 2,135 |
| 已编译负控 | 11 个全部被独立测试与原生对照同时检出 |
| 声明不可检出的变体 | 3 个 escape 脊柱变体，实测两侧均未检出，如实列出 |
| 身份门禁 | SHA256 / UUID / 锚地址之外，十五个入口逐个要求 `dlsym` 结果等于 base+记录地址 |

十一个被检出的错误变体分别是：遍历 retained、后到覆盖先到、插入根自身、跳过图子树、图先于控制点、
右控制点先于左、插入后不递归、按对象身份取键、escape 也插入、数组倒序遍历、清空调用方 map。每个变体保存
源码改动、实际命令与退出码；编译失败不计检出（`array-reversed` 首次仅被原生对照检出，独立测试的数组样例
是回文所以漏掉了，补一组非对称样例后两侧都检出，记录保留最终状态）。

默认 CTest 里钉了四个角色化金样例（`frame-with-graph`、`duplicate-controls`、`duplicate-across-graph`、
`group-retained`），取自真实 SDK 运行。SDK 的 ID 是运行时生成的 UUID，不可复现，所以钉住的是「按角色标注的
键集合与胜出者」，原始 UUID 一并存进 `native-history.json` 供核对。

## 构建

```sh
cmake -S research/independent-creator-contract -B /tmp/creator-history -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/creator-history --parallel 8
ctest --test-dir /tmp/creator-history --output-on-failure
```

macOS arm64 加 `-DCREATOR_CONTRACT_NATIVE_PROBE=ON` 构建 `creator-native-history`，显式传入已核验的绝对
库路径；ASan/UBSan 另开目录加 `-DCREATOR_CONTRACT_SANITIZERS=ON`。详细重跑命令在私有 `commands.json`。

## 仍未完成

本轮只关闭节点层的历史索引构建，没有恢复 Session 选择哪一条历史记录、事务的提交与回滚、undo/redo 回放，
也没有恢复返回 map 的迭代顺序、`0x2f5c8` 的散列函数、以及这一族之外 escape 覆写非平凡的类（例如
`lvve::Algorithm` 的 `0xbcdb84`）。`to_patch_json` / `patch_from_json` / `dirty_node_to_patch_json` 这条真正的
事务序列化面会拉进 nlohmann JSON DOM 与二次序列化，本轮刻意没有动；`draft_store::IOManager` 的事务接口会
触碰真实草稿文件，同样未动。分配失败下的原子性没有承诺。
