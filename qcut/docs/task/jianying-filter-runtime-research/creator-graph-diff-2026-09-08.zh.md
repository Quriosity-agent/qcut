# Creator 第三批：Graph 整树 stash 与差量恢复

本轮新增原创 C++20 [graph_tree](../../../research/independent-creator-contract/graph_tree.hpp) 和 [graph_diff](../../../research/independent-creator-contract/graph_diff.hpp)，沿既有 GraphPoint/CommonPoint 记录合同闭合 Graph → 点数组 → 坐标的历史快照选择与差量应用。实际入口位于 `libvideoeditor.dylib`，按 Creator 的编辑调用链归组。默认构建不加载厂商库。

固定安装版与上一批 [Graph 子树研究](creator-graph-snapshot-2026-09-08.zh.md) 相同；原生诊断继续在调用前核验 SHA256、arm64 UUID 和函数地址范围。私有证据在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch3/creator-graph-diff/`，包含静态片段、构建日志、`commands.json`、重复原生结果、错误变体与 `verification.json`。没有修改应用、草稿或 SDK 对象内存。

## 快照选择

`stash_graph_array` 比较历史 active ID 的成员关系，复用已有两级点快照算法。干净节点存在于同类型历史数组时共享历史对象；新节点、实际子快照、重新加入的历史节点或非空 retained 列表可以触发数组快照。仅改变顺序不会强制产生快照。浅拷贝保留 retained 和 clock 的共享所有权，重建 active 并清零两个 transient 字段。

数组 suppression 标志只抑制 changed 传播，不阻止实际快照产生，所以“返回非空快照但 changed=false”是有效结果。没有历史 Graph 时深拷贝树，active/retained 的每次出现分别复制，tracking 清零，clock 使用独立所有权令牌；这个令牌不模拟 SDK 进程时间。

有历史 Graph 时按需浅拷贝历史树，保留历史 tracking；state_code/changed 取当前值。resource_id/name/platform 差异逐字段复制，子数组的新快照可以使 Graph 产生替换，即使 suppression 使 changed 仍为 false。坐标干净分支以 dirty 状态选择历史，不能用“数值不同”替代原生门禁。

## 差量应用与共享对象

`restore_graph_tree_diff` 只把 before 与 after 不同的字段写到当前对象；基线与目标相同的字段保留当前分叉值。浮点比较遵循 IEEE 数值相等：正负零相等，NaN 不等，实际写入保留 payload。字段写入不额外标记 dirty。修改对象 ID 不会重新生成调用方 map 的 key。

Graph 或 GraphPoint 在 before/after 中缺少对应类型时整段旁路，不继续遍历子孙。数组仅遍历 active，既不重排/插入，也不恢复 retained。只有 `replace_shared` 打开、shared map 指向当前子对象且 replacements 存在合适条目时，才替换共享坐标/数组 owner 并设置 replaced；旧对象生命期由剩余共享 owner 维持。缺失的 shared key 按实测 operator[] 行为插入空类型，但不凭此替换对象。

四张 typed map 及 active/retained 子对象先验证，数组/索引预算各不超过 `1<<20`。空 map 条目允许表示缺失或类型不匹配；有效树必须包含坐标与 clock。共享替换预检以稳定 key 检查，避免此前别名遍历改写对象 ID 后改变验证结果。这些独立输入保护不声称是 SDK 自身的拒绝策略；内存分配失败下的事务原子性未承诺。

## 原生证据

| 入口 | 固定 arm64 地址 |
| --- | --- |
| Graph stash | `0xd984b0` |
| GraphPoint 数组 stash | `0xd9b6e4` |
| Graph diff | `0xd9a778` |
| 数组 diff | `0xd9c9a4` |
| GraphPoint diff | `0xda4c24` |
| CommonPoint diff | `0xc8fbe8` |
| 真实 GraphPoint 数组工厂 | `0xd97bfc` |

工厂接受字符串和两个布尔配置，返回真实 shared_ptr，能够通过真实构造覆盖 suppression=true；无需手写控制块或虚表。诊断验证 payload、状态、列表顺序、共享别名、历史对象保留和索引副作用。

| 验证 | 结果 |
| --- | --- |
| 独立 Release / ASan+UBSan | 各 12/12 CTest |
| 新真实 SDK 对照 | 5,890 案例，8,123,755 比较，0 差异 |
| 原生重复和消毒器构建 | 三次报告相同；厂商库本身未插桩 |
| 旧 Graph / restore 原生回归 | 分别 4,738 / 692,606 与 3,842 / 440,390，保持原报告 |
| 已编译负控 | 8 个均被独立测试和原生差分检出 |
| 构建/身份门禁 | fast-math、相对路径、错误 SHA 拒绝；身份失败时 0 数值调用 |

八个错误变体分别移除 suppression、强制重建数组、丢失 retained、深拷贝共享 clock、全字段覆盖、忽略 owner 门禁、恢复 retained、跳过 shared 空条目插入。每个变体保存源码 hash 和实际命令/退出码，编译失败不计检出。

从包根构建：

```sh
cmake -S research/independent-creator-contract -B /tmp/creator-graph-diff -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/creator-graph-diff --parallel 4
ctest --test-dir /tmp/creator-graph-diff --output-on-failure
```

macOS arm64 加 `-DCREATOR_CONTRACT_NATIVE_PROBE=ON` 构建 `creator-native-graph-diff`，显式传入已核验的绝对库路径；ASan/UBSan 另开目录加 `-DCREATOR_CONTRACT_SANITIZERS=ON`。详细重跑命令在私有 `commands.json`。

## 仍未完成

本轮没有恢复 Session 选择哪个历史记录、事务栈的提交/回滚、完整请求分派或应用 undo/redo。静态 Session/Combo 片段只用于下一步定位，不能把局部 Graph 差量恢复写成完整撤销系统。完整时间定位、效果事件传播及 UI 回放仍在台账中。
