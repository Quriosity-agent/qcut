# 原生记录恢复、ID 复用与共享所有权契约

日期：2026-09-08。工作分支 `codex/jianying-binary-cpp-scaleup-20260908`，从 `513a1c67d06fbdbb2a3b89bd27c6e37d3153eaf7` 开始；本批只在新的 `qcut-binary-cpp-scaleup-wt` 工作区编写原创代码。

本轮把上一轮“移除与 retained 清理”的边界推进到实际 **恢复对象值、按历史列表重建 active、复用已存在节点、生成恢复副本**。实现了 `CommonPoint`、无 graph 的 `CommonKeyframe`，以及 `CommonKeyframes::restore_from → NodeArray<CommonKeyframe>::restore_from` 链。真实 SDK 工厂对象的 3,842 个案例、440,390 项比较零差异；Release 和 ASan/UBSan 均通过。

这仍不是完整应用 undo。没有声称找到 Session 如何选择记录、调用此链、合并事务、生成 stash/diff，或何时接受/取消一个 GlobalFilter 编辑。本轮实现的函数真的恢复模型内容，但不能凭 `restore_from` 名字替代上层事务证据。

## 身份、代码与证据

目标仍是剪映专业版 11.3.0 的 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/libvideoeditor.dylib`：

- universal SHA-256：`ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`。
- arm64 UUID：`22337058-B217-3CAF-9979-CFECA7302CF7`。
- 私有反汇编、构建、原生结果、负控和 hash manifest：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/creator-undo/`。
- 原创实现：[record_restore.hpp](../../../research/independent-creator-contract/record_restore.hpp)、[record_restore.cpp](../../../research/independent-creator-contract/record_restore.cpp)。
- 独立测试：[record_restore_tests.cpp](../../../research/independent-creator-contract/record_restore_tests.cpp)。
- 原生差分：[native_record.mm](../../../research/independent-creator-contract/native_record.mm)、[native_record_support.hpp](../../../research/independent-creator-contract/native_record_support.hpp)。

原生 probe 调用前核对文件 SHA、加载镜像 SHA、arm64、UUID、导出锚点地址。使用 SDK 关键帧/组工厂与真实 shared_ptr 控制块；原生 `restore_to` 返回拥有所有权的 raw Node，通过核验的真实 deleting destructor 正常释放。没有伪造 SDK 模型内存、虚表或 SDK 控制块；没有注入运行中的剪映，也不读写用户草稿。

标准库映射参数是由诊断进程构造的真实 `std::unordered_map<std::string_view, std::shared_ptr<lvve::Node>>`。`lvve::Node` 只做不完整类型声明，map 内对象仍来自 SDK 工厂；别名 shared_ptr 保留原来的真实 owner。原生测试以独立稳定字符串保存 key，避免恢复目标 ID 时使 string_view 失效。生产独立模型直接采用拥有字符串的 map，且不暴露厂商 ABI。

## 有界入口与证据级别

| 入口 | arm64 地址范围 | 本轮证据 |
| --- | --- | --- |
| `CommonPoint::restore_from` | `0xc8efc8–0xc8f134` | static-strong；经 frame 左/右递归实际调用，坐标/ID/标记原生比较 |
| `CommonPoint::restore_to` | `0xc8f134–0xc8f1e8` | static-strong；经 frame 副本递归实际调用，所有权/位型原生比较 |
| `CommonKeyframe::restore_from` | `0xc7f17c–0xc7f600` | runtime-observed，原位恢复及空源分支 |
| `CommonKeyframe::restore_to` | `0xc7f600–0xc7f7ec` | runtime-observed，新 frame/controls、共享 values |
| frame 内部 copy constructor | `0xc82d20–0xc82e38` | static-strong，确认 values shared_ptr 的复制；运行时验证其结果 |
| `CommonKeyframes::restore_from` | `0xc84c48–0xc84edc` | runtime-observed，恢复 ID/material/property 后递归数组 |
| `NodeArray<CommonKeyframe>::restore_from` | `0xc87a68–0xc8812c` | runtime-observed，含空表、重复 ID、真实 map 与 retained |
| `CommonKeyframe::set_values` | `0xc7e1c8–0xc7e2f8` | static-strong + runtime-observed，比较相等性及分配所有权 |
| group/array `restore_to` | `0xc84edc–0xc850bc` / `0xc8812c–0xc884f0` | 仅有限静态检查；不在本轮独立 API 或原生等价范围 |

原始反汇编以 `LC_FUNCTION_STARTS` 限定范围，命令采用 thin arm64 文件的 `llvm-objdump -d --start-address --stop-address`，不带会忽略范围的 `--macho`。私有 `*.compact.asm` 只是为阅读移除了长模板注释；原始输出仍留 `*.asm`。两次尝试定位未确认 constructor 的命令被函数起点断言拒绝，未调用这些猜测地址。

## 原位恢复：保持对象身份，只更新需要写入的字段

`restore_point_from(destination, source)` 在 source=null 时立即返回。有效 source 的规则：

1. 直接赋值 ID，ID 改变本身不修改 tracking/code/changed。
2. 依次按 binary64 的 `==` 比较 x、y，不相等才写入相应坐标并标记 destination。
3. 不从 source 复制 mutation 状态。

共同的标记规则沿用已经验证的节点写入门禁：`tracking != 0 && state_code == 0` 时设 code2；随后设 changed=1。已有 code1/2/3 不被普通字段恢复覆盖。

`restore_frame_from` 对无 graph、values 和两控制点均存在的帧，按下列顺序恢复：

```text
ID → curve_type → time_offset → 左控制点原位恢复 → 右控制点原位恢复
   → values 比较与可能的新分配 → string_value
```

curve_type 是 signed32，time_offset 是 signed64；没有时间缩放、排序或限幅。string_value 是完整字节串，包含嵌入 NUL 的样例。帧自身 mutation 只跟随帧字段改变；控制点改变仅修改控制点自身。目标原先的左/右 shared_ptr 始终保留，因此外部持有的控制点引用继续观察到恢复值。如果两个目标控制点别名，左、右恢复按原顺序作用于同一对象。

数值规则不能改为字节相等或总是覆盖：

- `-0.0 == +0.0`：坐标和逐元素相等的 values 保留目标的旧零位型。
- 任意 NaN 比较不等：即使对自己恢复，仍写入/标记；NaN payload 位型保持。
- 同号 Infinity 比较相等，不写入。
- values 长度不同或任一元素不等：新分配 vector，复制 source 数值；不直接绑定 source 的 values owner。
- values 相等：保留目标旧 allocation；空 vector 也相等。

## 恢复副本：控制点独立，values 共享

`restore_frame_copy` 对应 graph-free `restore_to`。它创建新的帧和两个新的控制点，保留 ID、curve、time、string 与数值位型。即使源左/右引用的是同一个点，新帧的两点也分别构造，互不别名。新 frame 和新 points 依各自继承的 tracking/code 标脏；不修改 source。

**values 仍共享同一个 vector allocation。** 这来自 frame copy constructor 的 shared_ptr 复制，原生后续只替换控制点；不是全面深拷贝。替换 values 的 setter 在不相等时再分离 allocation。独立 `RecordFrame` 因此采用 `shared_ptr<vector<double>>`，没有复用前轮只含值 vector 的部分模型来掩盖所有权差别。

这是恢复副本局部 API 的实测行为；不能直接推断完整历史系统把可变 values 任意共享给 UI。更上层可能约束写入、做 copy-on-write 或构建其他 stash 数据，本轮未追完。

## 列表恢复：源顺序、ID 集合与既有映射

调用者提供当前列表、历史源列表和已有 ID→live frame 映射。map lookup 是内容相等的 ID 查找；map 不会因新建副本而新增条目。

1. 按源 active 顺序逐项读取。
2. 查到有效同类型 live 对象：原位恢复它，再追加同一个 shared_ptr 到新列表。
3. 查不到、map 值为空或动态类型不兼容：创建恢复副本并追加；不回填 map。
4. 记录源 active 的 ID 集合，随后按旧 active 顺序检查。旧 ID 不在源集合中就追加旧 shared_ptr 到 destination.retained；否则记录为“之前已存在的 ID”。原有 retained 保留。
5. 对新列表中每个“之前未存在的 ID”按 child-tracking 处理，并各写一次时钟；按 ID 判断，不按指针，也不去重。
6. 源与旧 active 长度不等才有额外的数组自身标脏；替换 active 后无条件再写一次时钟。

| 情形 | 对象/列表结果 |
| --- | --- |
| 两个源项 ID 相同且 map 命中 | 两个 active 项引用同一 live 对象；顺序处理，后面的恢复可改变前面项观察的值 |
| 两个源项 ID 相同但 map 缺失 | 创建两个不同 frame 和控制点；两项仍可能共享源 values |
| 旧 active 有相同的被移除 ID 多次 | 按旧顺序多次追加 retained，不去重 |
| 源只重排已有 ID | 顺序改变；数组自身 changed 可保持0；仍有最后一次时钟写入 |
| 同长度、开启 child tracking 的新旧 ID 替换 | 新 child 为 code1/changed1；数组自身 changed 可保持0 |
| 空源列表 | active 清空，旧 active 进入 retained；源 retained 不被恢复 |
| source 与 destination 自列表相同 | 按当前 active 构建临时列表，再赋回；支持源/目标自身别名 |

列表恢复时的移除路径只有 retained 追加，**不会像前轮显式 `remove_at` 那样给被移除节点设 code3**。这是另一个容易错误抽象为统一“删除”操作的区别。

新 ID 的状态处理：先把 child.tracking 设为 destination.track_children；若为真，直接设 code1；若为假，普通标记 child 并标记数组。随后每项写时钟，并再普通标记 child。已有 ID 不执行这段跟踪开关变更。

独立返回 `clock_write_events = 新 ID 的出现次数 + 1`。计数来源为静态 `0xc87df4–0xc87e00` 和 `0xc87e70–0xc87e80` 两处写入；原生矩阵没有截取或比较非确定性的 pointer-encoded clock 值，不把该计数称为实测时间戳。

## 输入域与异常策略

- 支持 graph-free 帧，values allocation 与左右点必须非空；active 中不得有空帧。
- `RecordFrameIndex` 使用拥有字符串的 key，值为空代表原生“空或不兼容动态类型”的 fallback。独立 typed API 不创建假的异构 SDK 节点。
- 原生 source 类型不兼容会日志返回；独立类型系统不能表达错误源动态类型。该原生分支没有改为一个虚构的 success bool。
- `restore_frame_from/restore_point_from` 的空 source 是 no-op；`restore_group_from` 空 source 返回0个时钟写入。
- 独立实现先校验整个 active 和被命中的 mapped 输入，才做任何更改。这是 QCut 的前置拒绝政策；不声称原生会以相同异常保护畸形 SDK 对象。
- retained-only 子树不遍历或校验；source retained 不参与重建。
- 不承诺 allocation failure 时跨全部已复用对象原子回滚；没有无证据地实现事务或锁。

## 验证结果与负控

| 检查 | 结果 |
| --- | --- |
| 独立 Release CTest | 10/10；1229项断言，保留旧1143项并新增86项 |
| 独立 ASan + UBSan | 10/10，`-fno-sanitize-recover=all` |
| frame 原位恢复 | 2048 案例，包含空源、自恢复、零/NaN/Infinity、不同时间/曲线/字符串 |
| frame 恢复副本 | 1024 案例，复制前后别名与 values 分离验证 |
| group/list 恢复 | 768 案例，空 active、已有 retained、重复 ID、部分 map、空/错类型 map 值、自列表恢复 |
| weak_ptr 生命期 | 2 案例，映射复用与同 ID 未映射替换，检查 frame/control/values 最终释放 |
| 原生总计 | 3842 案例、440390项比较，0 mismatch；Release 和 native probe ASan/UBSan同批通过 |
| 算法 mutation controls | 6个副本均编译成功，再以原生比较 mismatch 退出1 |
| 身份负控 | 相对路径、错误 SHA 各正确退出1 |
| 编译负控 | `-ffast-math` 命中 IEEE guard，编译失败 |

6个算法负控分别破坏：values 的共享、原位控制点身份、ID map 复用、retained 保存、tracked insertion 的数组 dirty 条件，以及相等零值的位型保留。编译失败不计为有效算法负控。

原生准备使用正常 SDK insertion/removal 生成 code1/3，普通写入生成 code2；没有直接填写 SDK 状态字段。比较不仅看输出值，还双向核对别名关系、live 外部引用、source 不变性、active/retained 长度顺序、空/错误类型 map fallback，以及 control/values 分配生命周期。

原生库未做 sanitizer instrumentation；ASan/UBSan覆盖诊断与原创代码。macOS 环境关闭 LeakSanitizer，不能从该执行声称整个 SDK 无内存泄漏；本轮 weak_ptr 只验证所测对象与 values allocation 的释放。

私有 `verification.json` 保存精确源码/证据 hash、命令与退出码。`negative-controls/manifest.json` 保留每个副本源码 SHA、编译命令和故障日志。复现从源码目录的 CMake 构建，在仓库外输出；需要 `CREATOR_CONTRACT_NATIVE_PROBE=ON`，并为诊断 child 设置 app Frameworks 搜索路径。标准独立测试无需 SDK。

## 还未闭合的上层链

本轮没有把 `get_stash_copy`、`restore_by_diff`、Server/Session 的 record 管理、`dismissRecord` 或应用 Undo 指令拼成猜测框架。已确认的局部链是实际 group→array→frame→point restore；调用者提供记录源和 live ID map。下一步应定位记录管理器如何生成、保留、选择该源和映射，以及 graph 子树恢复和事务失败/成功边界。
