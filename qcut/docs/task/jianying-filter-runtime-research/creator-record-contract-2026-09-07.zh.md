# 模型记录标记、dirty 传播与 retained 清理契约

日期：2026-09-07。延续前轮 GlobalFilter 添加/删除模型的记录边界；代码是 `research/independent-creator-contract/dirty_tree.*`，原生诊断是 `native_dirty.mm`。

本轮闭合了一个真实可验证的局部生命周期：**移除节点 → retained 保留引用 → 清除活跃子树 dirty → 释放 retained 引用**。两个容器层级均有原生验证，包含真实工厂创建的内存 Segment、关键帧、组、控制点及其 shared_ptr。2,244 个案例、407,020 项比较零差异。

这不是完整 undo。清理不恢复旧数值、不把节点重新放回 active，也未证明它就是事务 commit/rollback 的调用点。此前请求中的策略字段、会话分发和 accept/dismissRecord 不能据此重新命名。

## 二进制身份与可复现证据

目标为剪映专业版 11.3.0：

- 库：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/libvideoeditor.dylib`。
- Universal SHA-256：`ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`。
- arm64 UUID：`22337058-B217-3CAF-9979-CFECA7302CF7`。
- 私有证据：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/creator-record/`。
- `verification.json` 记录源码与证据 SHA、测试结果、构建/运行命令；`negative-controls.json` 记录每个负控制的编译和预期失败。供应商二进制和反汇编没有放入仓库。

| 私有反汇编 | 函数范围 | 语义 |
| --- | --- | --- |
| `frame-dirty-get.asm` | `0xc7e9f4–0xc7ea80` | `CommonKeyframe::get_is_dirty`，自身→左点→右点→可选 graph |
| `frame-dirty-reset.asm` | `0xc7e98c–0xc7e9f4` | 自身标记重置、两个控制点和可选 graph 的递归 reset |
| `group-dirty-get.asm` | `0xc84550–0xc84570` | `CommonKeyframes` 自身→内部关键帧数组 |
| `group-dirty-reset.asm` | `0xc84530–0xc84550` | 组自身 reset 后进入内部数组 |
| `array-dirty-get.asm` | `0xc86f84–0xc86ff0` | `NodeArray<CommonKeyframe>` 自身→active，不看 retained |
| `array-dirty-reset.asm` | `0xc86ff0–0xc870a4` | reset active 后只释放 retained shared_ptr |
| `array-remove-index.asm` | `0xc8ccf8–0xc8ce6c` | 有效索引移除、code3、retained、数组 dirty/clock |
| `group-array-dirty-get.asm` | `0xe109f8–0xe10a64` | `NodeArray<CommonKeyframes>` 的对应查询 |
| `group-array-dirty-reset.asm` | `0xe10a64–0xe10b18` | 外层数组也先 active reset，再释放 retained |
| `group-array-remove.asm` | `0xe1676c–0xe168e0` | 外层组数组索引移除，与内层相同的记录门禁 |
| `point-dirty-get.asm` | `0xc8edc0–0xc8edc8` | 控制点 dirty 直接取节点 changed 字节 |
| `graph-dirty-get.asm` / `graph-dirty-reset.asm` | `0xd98490–0xd984b0` / `0xd98470–0xd98490` | graph 会进一步递归；当前 API 显式不实现该子树 |
| `frame-stash.asm` / `group-stash.asm` / `array-stash.asm` | `0xc7ea80–0xc7f17c` / `0xc84570–0xc84c48` / `0xc873f8–0xc87a68` | 有界检查另一个 stash-copy 路径，未调用或声明完整还原 |

`disassemble.py` 依据 Mach-O `LC_FUNCTION_STARTS` 限定函数范围，在已有 thin arm64 副本上执行 `llvm-objdump -d --start-address --stop-address`。`vtables.json` 把关键帧、组和内层数组的 getter/reset 虚槽对应到上述地址；外层数组真实 vtable 为 `0x4be41f8`，由 `factory-array-inspect.*` 从真实内存 Segment 取得并与反汇编核对。

## Dirty 查询不是记录码查询

节点的相关字段保持前轮中性命名：

| 位置 | 独立字段 | 本轮规则 |
| --- | --- | --- |
| `+0x20` | `tracking` | reset 时决定是否清零 state_code |
| `+0x24` | `state_code` | code 本身不会使 dirty 查询返回 true |
| `+0x28` | `changed` | dirty 查询的自身标记 |
| 数组 `+0x30` | active vector | 查询与递归 reset 遍历它 |
| 数组 `+0x48` | retained vector | dirty 查询忽略它；reset 只释放它的引用 |
| 数组 `+0x60` | 子项跟踪开关 | 插入/移除记录码门禁，与数组自身 tracking 分开 |

在无 graph 且控制点齐全的已验证域中：

```text
frame_dirty = frame.changed || left.changed || right.changed
group_dirty = group.changed || list.changed || any(active frame_dirty)
array_dirty = array.changed || any(active group_dirty)
```

因此 `state_code=3, changed=0` 本身不脏；removed-only 子节点或控制点即使 `changed=1`，也不会被父数组的查询遍历。原生实现有短路，但不能把 retained 误算为 active 或把 code 当成 changed。

API 对整个 active 输入树做前置检查：禁止 graph、空节点、缺失控制点以及 changed 不为0/1。即使父节点已 dirty，仍先拒绝这些输入。这是 QCut 的有限输入域与异常前置政策，区别于原生短路可能不访问某个无效后代的行为。retained-only 子树不检查，因为实现只释放引用。

## Reset 的顺序与共享引用

对一个节点：

```text
if tracking != 0: state_code = 0
changed = 0
```

tracking 保留；没有跟踪的节点保留原 state_code。payload 不变：ID、时间、数值、曲线、控制点坐标均不回退。原生对比包括 `-0.0`、NaN payload、Infinity 的数值位型保持。

帧 reset 处理自身、左点、右点。组 reset 先处理自身，再处理内部数组；数组 reset 先处理自身，再按 active 顺序递归 reset 子节点，最后清空 retained 引用。容器子项跟踪开关、active 顺序与容量均保留；不生成新的时钟事件。

关键区别是 **retained 清理不是 retained 子树 reset**：

| 对象引用位置 | reset 后对象标记 | reset 后生命期 |
| --- | --- | --- |
| 仅 active | 递归重置 | active 继续持有 |
| 仅 retained，外部还有 strong 引用 | 保持原标记 | 外部引用继续持有 |
| 仅 retained，没有其他 strong 引用 | 不先重置 | 最后引用释放，weak_ptr 失效 |
| 同时 active 与 retained | 经 active 路径重置 | retained 引用释放，active 保证仍存活 |
| active 中有多个相同 shared_ptr | 按原遍历顺序重复进入 | 不去重，不改变别名关系 |

原生内层和外层 reset 在 retained 循环只减少 shared_ptr 引用计数，最终把 vector end 设回 begin；没有调用 retained 对象的 dirty reset 虚函数。weak_ptr 验证分别覆盖关键帧与组/帧子树，在“有 active 别名”和“无 active 别名”两种情况下检查最终析构。

## 有效索引移除

`remove_keyframe_at` 和 `remove_common_group_at` 从真实数组的同构实现恢复：

1. 取 index 指定的同一个对象。
2. 当容器子项跟踪开关为真、节点 tracking 非零时，把节点 state_code 设3；节点 changed 保留。
3. 将该 shared_ptr 追加到 retained，不去重。
4. 数组标脏：tracking 非零且 code0 时改2，然后 changed=1；发生一次时钟写入。
5. 从 active 中移除该位置，后续项左移，顺序保持。

独立 API 返回被移除对象及 `clock_write_events=1`。返回值也持有 strong 引用，测试会释放它后再检查 retained 是否为最后一个 owner。有效索引限定在 signed32 域；越界、过大索引或空目标在任何更改之前拒绝。独立实现先确保 retained 追加成功再改变记录码，故分配失败也不留下半更新的原创模型；原生在分配失败时的部分状态不属于等价声明。

组列表 setter 在原生诊断准备别名输入时，会把旧引用放入 retained。诊断读取了实际 active/retained 初态后开始验证移除/reset，没有把这个 setter 冒充本轮独立实现或假设 retained 起初为空。这个准备阶段的差异曾被诊断检查检出，随后修正的是初态建模，而不是放宽比较。

## 真实工厂与原生比较范围

复用 `independent-editor-contract/native_keyframes.hpp`、`native_segments.hpp`：

- 关键帧工厂 `0x2af2edc` 自行分配完整对象、控制点与真实 shared_ptr 控制块。
- 组工厂 `ensureKeyframes` `0x340a010`；独立组可使用已验证的 null-Segment/nonempty-key 路径。
- 外层使用 `CombinationUtils::makeCombination` `0x3014cac` 的空 Draft 参数分支，由 SDK 自行创建完整 detached 内存 SegmentVideo 树。不是手填 Segment 内存。
- `Segment::get_non_const_common_keyframes` `0x12216c4` 返回真实数组 shared_ptr；`ensureKeyframes` 将新组实际附着到这棵内存树。
- 原生控制点 setter、跟踪 setter、插入/移除 helper、dirty getter/reset 都在这些诊断拥有的对象上运行。对象用真实控制块正常析构。

没有 app injection、真实 draft 文件修改、Qt 假对象、伪造 vtable 或控制块。默认 C++ 构建没有厂商运行时依赖。原生 probe 仅限 macOS arm64，调用前检查完整 SHA、加载镜像 SHA、UUID、架构和导出锚点；未知文件或相对路径失败。

比较不是只看返回 bool：同时核对节点/控制点/数组 mutation、活跃及 retained 顺序和身份、值的 binary64 位型、dirty getter 结果、removed-only 对象的外部观察，以及 weak_ptr 的存活/失效。

| 验证 | 结果 |
| --- | --- |
| Portable Release | 9/9 测试组；1143 项断言，旧1082项保留，新增61项 |
| Portable ASan + UBSan | 9/9，使用 `-fno-sanitize-recover=all` |
| 内层 frame-list 原生 | 2000 案例 |
| 外层 group-array 原生 | 240 案例，真实 detached Segment，包含 active/retained 别名 |
| 原生 shared_ptr 生命期 | 4 案例，两层各有/无 active 别名 |
| 原生总比较 | 407,020 项，0 mismatch |
| 原生 probe ASan/UBSan | 同批通过；probe/原创代码被 instrument，厂商 dylib 未 instrument |
| 有效负控制 | 4 个原创 mutant 被检出；2 个路径/SHA 门禁按预期失败 |

四个 mutant 分别是：无条件清 untracked code、错误地 reset retained-only 子节点、忽略控制点 dirty、遗漏 retained 引用清理。每个均能编译，再由原生对比以明确 mismatch 退出；不是编译失败或加载失败充当负控制。原生进程的 LeakSanitizer 被禁用以排除厂商全局初始化的生命期，本轮的 weak_ptr 断言只证明所测局部对象的引用释放。

## 仍未恢复的记录层

`get_stash_copy` 是另一条具有映射表、动态类型检查和拷贝所有权的路径，本轮只做有限静态检查。它与当前 dirty/retained 操作的组合、调用时机、完整 stash/diff 结构没有经过原生调用验证。

前轮 Server → Session → 内部分发虚槽的证据仍然有效，但不能仅凭 reset 或 retained 被清空就声称 accept 提交成功、reset 可撤销或 rollback 已恢复。本轮交付的是可独立编译、可原生差分的模型生命周期单元；下一层应继续定位真实记录管理器的调用点、所有权和成功/失败条件。
