# Graph 子树恢复、数组副本与实际 stash 选择

日期：2026-09-08。沿用 `codex/jianying-binary-cpp-scaleup-20260908`，本批起点 `7f44e4a11`。

上一批限定 graph-free 的恢复，现在推进到真实 **Graph → GraphPoint 列表 → CommonPoint 坐标**，以及含图关键帧的原位恢复、增删图和 group/array `restore_to`。另外闭合了 `GraphPoint::get_stash_copy → CommonPoint::get_stash_copy` 的实际历史快照选择：什么时候返回空、什么时候新建快照、哪些字段来自当前对象或历史对象、哪些子对象继续共享。

新增原生矩阵 **4,738 案例 / 692,606 项比较，零差异**，Release、独立进程重复、ASan/UBSan 一致。旧恢复矩阵仍为 3,842 案例 / 440,390 项比较零差异。没有把这些局部函数拼成完整 Session undo：Graph 整树 stash、`restore_by_diff`、上层记录选择/事务合并仍未闭合。

## 实现与固定环境

- [record_graph.hpp](../../../research/independent-creator-contract/record_graph.hpp)、[record_graph.cpp](../../../research/independent-creator-contract/record_graph.cpp)：图、图点原位恢复及恢复副本。
- [record_stash.hpp](../../../research/independent-creator-contract/record_stash.hpp)、[record_stash.cpp](../../../research/independent-creator-contract/record_stash.cpp)：图点及坐标的历史快照选择。
- [record_list.hpp](../../../research/independent-creator-contract/record_list.hpp)：frame 与 graph-point 共用的有序 ID 对齐和数组副本算法。
- [record_restore.hpp](../../../research/independent-creator-contract/record_restore.hpp)、[record_restore.cpp](../../../research/independent-creator-contract/record_restore.cpp)：已有 frame/group 契约的图子树扩展、group 副本。
- [record_graph_tests.cpp](../../../research/independent-creator-contract/record_graph_tests.cpp)：手算状态、所有权、拒绝及 null stash 金样例。
- [native_graph_record.mm](../../../research/independent-creator-contract/native_graph_record.mm)、[诊断辅助](../../../research/independent-creator-contract/native_graph_record_support.hpp)、[共同快照比较](../../../research/independent-creator-contract/native_record_support.hpp)：真实 SDK 对象与原创模型比较。

目标为剪映专业版 11.3.0 的安装版 `libvideoeditor.dylib`，universal SHA-256 `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`，arm64 UUID `22337058-B217-3CAF-9979-CFECA7302CF7`。诊断复用文件/实际加载镜像双 SHA、UUID、arm64 与锚点地址门禁；恢复副本的动态类型及 deleting destructor 也按已核对的 vtable 限定。

真实图由已经核验的 SDK Graph 工厂创建；该工厂在端页只读的真实 string/vector 值参数后，自己构造 Graph、NodeArray、GraphPoint、CommonPoint 及控制块。数值和别名变更通过 SDK setter，状态通过 SDK tracking/reset/setter 产生。没有伪造复杂 SDK 对象、虚表或 shared_ptr 控制块。返回的 owned raw Node 交给真实 deleting destructor 释放；不注入运行中的剪映，不读写用户草稿。

私有反汇编、源码/库哈希、命令与日志：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/creator-graph-snapshot/`。厂商代码和原始二进制不进入仓库。

## 本轮原生入口

| 入口 | arm64 范围 | 验证范围 |
|---|---|---|
| `GraphPoint::restore_from` | `0xda3704–0xda3830` | 图点 ID/type + 坐标原位递归 |
| `GraphPoint::restore_to` | `0xda3830–0xda3974` | 新图点和新坐标 |
| `Graph::restore_from` | `0xd98c5c–0xd98f24` | ID/resource/platform + 图点数组 |
| `Graph::restore_to` | `0xd98f24–0xd9910c` | 新图对象与数组，含 ID map |
| `NodeArray<GraphPoint>::restore_from` | `0xd9bd54–0xd9c418` | active/retained 重建与 mutation |
| `NodeArray<GraphPoint>::restore_to` | `0xd9c418–0xd9c7dc` | active 重建、retained 浅共享、missing/null 分歧 |
| `CommonKeyframe::restore_from/to` | 既有 `0xc7f17c/0xc7f600` | 本轮新增 graph 空/有四种组合与共享图 |
| `CommonKeyframes::restore_to` | `0xc84edc–0xc850bc` | 新组与 frame 数组；frame 内包含完整 graph |
| `NodeArray<CommonKeyframe>::restore_to` | `0xc8812c–0xc884f0` | 与图点数组相同的有序 map 对齐规则 |
| `GraphPoint::get_stash_copy` | `0xda3364–0xda3704` | 完整两级图点/坐标快照选择 |
| `CommonPoint::get_stash_copy` | `0xc8edc8–0xc8efc8` | 依据 changed 与 typed history 决定 null/copy |
| `Graph::get_stash_copy` | `0xd984b0–0xd98c5c` | 本轮仅静态定位，不计独立实现完成 |

范围使用 Mach-O `LC_FUNCTION_STARTS` 限定，thin arm64 的有界 `llvm-objdump -d` 输出留在私有目录。数组时钟值仍非确定性，不比较 pointer-encoded clock 数值；既有 restore-from 的写入次数是静态恢复结果，不能当实测时间戳。

## 图子树恢复与所有权

GraphPoint 原位恢复依次赋 ID、比较 type、原位恢复 CommonPoint。ID 单独变化不标脏；type 变化只标该图点。坐标 x/y 沿用 binary64 `==`：等值 ±0 保留目标位型，NaN 会写入并标该坐标。目标坐标 shared_ptr 保留，因此外部引用继续看见更新。坐标变化不会自动标 GraphPoint 或 Graph 的父级状态。

Graph 原位恢复依次处理 ID、resource_id、resource_name、signed32 source_platform，然后递归图点数组。字符串含嵌入 NUL 和长字符串，坐标包含零、NaN payload、±Infinity；这层只复制/比较，不做曲线求值或限幅。

恢复副本会新建 Graph、数组、未映射的 GraphPoint 及 CommonPoint。各恢复副本按继承的 tracking/code 标记 changed；不是保留干净状态的普通深拷贝。图点源坐标之间即使别名，未映射的每次复制也各建坐标。values 的共享规则仍是上一批 frame 契约：新 frame 可共享源 values allocation，graph 与 controls 的复制则分别递归。

数组 `restore_from` 共用上一批有序算法：按 source active 顺序查调用者 ID map；命中有效同类型对象就原位恢复，缺失/空/错类型就复制；不把新副本回填 map。旧 active 中不在 source ID 集合的对象按顺序追加 retained，不生成显式删除 code3。原有 retained 保留，source retained 不参与重建。

### 数组 restore-to 不是无条件深拷贝

它先复制数组记录并清空副本 active，再按 source active 的顺序构建：

| ID map 状态 | 副本 active 对象 | 额外 insertion tracking |
|---|---|---|
| 命中有效同类型对象 | 原位恢复并共享该 live 对象 | 不执行 |
| key 存在但值空或动态类型不兼容 | 调用 child restore-to 创建副本 | **不执行** |
| key 缺失 | 调用 child restore-to 创建副本 | 按数组 track_children 设置 child；true 设 code1，false 标 child 和数组 |

missing 与 present-null 在 restore-from 的 fallback 对象构造上相似，在 restore-to 中却有上述状态差别。不能用 `find_or_null` 合并二者。

副本 retained 保留源 retained 的 shared_ptr，不递归复制。重复 ID 命中 map 时共享一个 live 对象；重复 ID 未命中时新建多个对象；被命中的 live 对象可能同时由 source/外部持有，因此 copy 操作也可能修改这些 live 对象。不能声明调用 restore-to 后整个输入关联图必定不变。

## Frame 图空值门控

| 目标 graph | 源 graph | 行为 |
|---|---|---|
| 空 | 空 | 无图操作 |
| 有 | 有 | 在目标 Graph 上恢复，保留 Graph shared_ptr；子图变化不额外标 frame |
| 空 | 有 | 创建恢复副本，将新 Graph 自身 tracking 设0并标记，再标 frame |
| 有 | 空 | 清除目标 Graph shared_ptr，标 frame；外部 owner 仍可继续持有旧图 |

同一 Graph 被两个 frame 共享时，原位恢复的影响通过同一 shared_ptr 观察。原生矩阵包含不同 frame 共享 Graph 和 source==destination；比较器双向检查别名，而非只比较坐标数组。

`RecordFrame::graph` 是新的 typed payload。旧 `has_graph` 仅保留捕获兼容性：只知道“有图”而未提供 typed payload 仍拒绝，避免把旧不完整输入当成空图恢复。正常新调用提供完整 `graph`。

## 实际历史快照选择：null 不等于失败

`stash_point(current, history, changed)` 按 current ID 查同类型历史坐标：

1. 没有有效历史对象：复制当前坐标，所有 mutation 字段原样保留，置累计 `changed=true`。
2. 有历史且 current.changed!=0：同样复制当前坐标并置累计标记。
3. 有历史且 current.changed==0：返回 null，不比较历史/当前坐标数值，也不清除已为 true 的累计标记。

因此干净 NaN 或干净但数值不同的坐标仍可返回 null。不能替换为“比较值是否相等”的通用差异函数。

`stash_graph_point` 先查 current 图点 ID 的同类型历史对象：

- 没有有效历史图点：完整复制当前图点及坐标，保留当前 mutation，置累计 changed，不进入历史坐标复用。
- 有历史：current 图点 changed!=0 或 type 不同，才先分配一个**历史图点的浅副本**。副本 ID、tracking 来自历史；state_code、changed 来自当前；type 更新为当前值，并置累计 changed。
- 然后对子坐标调用上面的 stash_point。若返回新坐标，而图点还没分配副本，此时创建历史图点浅副本；用返回的新坐标替换它的 point。
- 若子坐标没有新快照，已经分配的图点继续共享历史 point owner。若父子都无需替换，返回 null。

这解释了“新快照对象可能 changed==0，但累计 changed=true”：type 内容不同仍要生成快照，而快照节点的 changed 字节取自当前记录，不被强制改成1。

本两级原生链未读取 escape map 来选择对象、也未修改第二个 escape bool；矩阵改变了该 map 内容和 bool 初值验证其保持。独立 API 不暴露这个无变化参数。不能把这一点推广到尚未恢复的 Graph/Session stash。

## 验证与可检出错误

| 检查 | 最终结果 |
|---|---|
| 独立 Release / ASan+UBSan | 各11/11 CTest，1275项断言＝旧1229＋新46 |
| 图恢复及图副本 | 1536案例 |
| 含图 frame 恢复/复制/共享 | 1024案例 |
| group/array 恢复副本 | 512案例 |
| graph-point stash 广域状态/map | 1536案例 |
| 显式 stash 状态组合 | 128案例；硬验4个null、124个replacement |
| 原生 weak_ptr 生命期 | 2案例；独立图副本释放、历史坐标共享至最后stash释放 |
| 新原生总计 | 4738案例、692606项比较；Release / repeat / sanitizer 零差异且JSON相同 |
| 旧恢复原生回归 | 3842案例、440390项比较，Release / sanitizer零差异 |
| 算法负控 | 8个均编译成功，以原生 mismatch 退出1 |

8个负控破坏的规则是：复制时错误共享坐标、原位恢复替换坐标对象、把 present-null 当 missing 触发插入、丢弃 retained、新挂 graph 错保留 tracking、stash 使用当前 tracking、对干净坐标比较值、干净图点总是生成快照。

最后一种负控最初在广域组合中漏检。独立金样例能检出，但初版原生 corpus 没有实际走到 null 结果。本轮保留该失败实验，并增加128项显式组合及4/124硬门禁后重新跑全部原生、sanitizer与8个负控；不把最初的漏检算作通过。私有 `negative-controls-initial/` 与最终 `negative-controls/manifest.json` 区分两次证据。

全部 active 及命中的有效 mapped 节点在修改前验证；缺坐标、缺 frame controls/values、不完整 opaque graph 会拒绝。retained-only 对象不递归访问，按共享引用保留。这是独立实现的安全输入政策，不声称原厂 SDK 接受任意畸形对象。不同 typed index 中的错误类型用空条目表达；不会构造假的异构 SDK 对象。

不承诺内存分配失败后的跨对象事务回滚。ASan/UBSan只覆盖自有实现与诊断代码，厂商库未插桩；关闭 macOS LeakSanitizer，不能由此推出 SDK 全局无泄漏。

## 复现与未完成部分

```sh
CREATOR_GRAPH_EVIDENCE=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/creator-graph-snapshot
CREATOR_GRAPH_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
cmake -S research/independent-creator-contract -B "$CREATOR_GRAPH_EVIDENCE/build-release" \
  -DCMAKE_BUILD_TYPE=Release -DCREATOR_CONTRACT_NATIVE_PROBE=ON
cmake --build "$CREATOR_GRAPH_EVIDENCE/build-release" --parallel 4
ctest --test-dir "$CREATOR_GRAPH_EVIDENCE/build-release" --output-on-failure
DYLD_LIBRARY_PATH="$CREATOR_GRAPH_FRAMEWORKS" DYLD_FRAMEWORK_PATH="$CREATOR_GRAPH_FRAMEWORKS" \
  "$CREATOR_GRAPH_EVIDENCE/build-release/creator-native-graph-record" \
  "$CREATOR_GRAPH_FRAMEWORKS/libvideoeditor.dylib"
```

源码与可执行文件 hash、精确命令、退出码及负控保存在私有 `verification.json`。源代码只依赖标准 C++20；可选原生诊断依赖当前已核验的本地 SDK。

尚未完成 Graph 整树 `get_stash_copy` 与 `restore_by_diff`、Session 记录的选择和事务应用、真实 Undo/Redo UI 指令、Preview/Export 更新。这里已经恢复的是实际数据恢复和两级历史快照选择算法，不是这些上层行为的替代证明。
