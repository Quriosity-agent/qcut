# libvideoeditor → 独立 C++：值、时间、关键帧契约

日期：2026-09-07。此轮交付 `research/independent-editor-contract/` 三个可独立构建的 C++20 单元，实际编译和测试均已执行。范围是局部模型赋值、滤镜时间区间计算、关键帧字段及元数据投影；不是整库反编译完成，也没有接入 QCut 预览或导出。

## 身份与证据位置

重新读取 `/Applications/VideoFusion-macOS.app/Contents/Info.plist`，版本及构建号均为 **11.3.0**。重新对原始 universal 库计算哈希和 UUID：

| 项目 | 值 |
| --- | --- |
| 原库 | `/Applications/VideoFusion-macOS.app/Contents/Frameworks/libvideoeditor.dylib` |
| SHA-256 | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` |
| arm64 UUID | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| x86_64 UUID，仅作身份记录 | `6B44A39A-B635-3855-B2C3-67D1B2D7B4E5` |

私有证据目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/videoeditor/`。`static-manifest.json` 保存切片反汇编命令、各文件 SHA；`verification.json` 保存最终构建、测试、原生差分和负控结果。原始库、汇编、原生 JSON 均未进入仓库。历史入口笔记为 [videoeditor-filter-chain-2026-09-06.zh.md](videoeditor-filter-chain-2026-09-06.zh.md)。

所有下列地址均为该 **arm64** 切片的未滑动虚拟地址。匿名 helper 用真实入口地址标识，不沿用 objdump 最近的无关符号名。

## 1. MaterialValue 与 KeyframeTime 的赋值状态

`lvve::MaterialEffect::get_value()`：`0xf1cc6c–0xf1cc74`，返回对象 `+0xe8` 的地址。`set_value(double const&)`：`0xf1cc74–0xf1ccbc`。本轮完整解出此前未确定的状态字节：

1. 按 IEEE double 比较新旧值；相等直接返回，不改任何字段。
2. 不等则原样写入 double。
3. 若 `byte(+0x20) != 0` 且 `u32(+0x24) == 0`，把状态码写成 `2`；否则保留原状态码。
4. 所有发生写入的分支均把 `byte(+0x28)` 写成 `1`。

因此 `+0 → -0`、`-0 → +0` 都保留旧符号及旧状态。相同 NaN 位模式再次赋值仍走写入分支；原生测试验证 quiet/signaling NaN 的 payload 位保留。负值、超过 1 的值、无穷值没有 clamp。这里没有把浮点异常寄存器或用户开启浮点 trap 的行为纳入契约。

新补查 `lvve::Keyframe::get_time_offset()` `0xdc37e4–0xdc37ec` 及 `set_time_offset(long long const&)` `0xdc37ec–0xdc3824`：字段位于 `+0x48`，用完整 64 位整数相等比较，同一套状态分支，不换时间单位、不缩窄。

进一步读取 `MaterialEffect::reset_is_dirty()` `0xf1ed4c–0xf1ede0` 与 `get_is_dirty()` `0xf1ede0–0xf1ee90`：`+0x28` 是自身 dirty 标志，但整体 dirty 还检查多个子对象。故独立 `MutationState.changed` 仅表示局部标志，不提供“整个 MaterialEffect 已 clean”的错误推论。完整 reset 会走子对象虚调用，本轮未调用或实现。`tracking` 和 `state_code` 保持中性命名，不猜测 undo、历史记录或状态枚举含义。

**原生验证**：只调用已确认没有对象构造、vtable、指针追踪或外部调用的两个 leaf setter/getter。每例构造带前后哨兵的 256 字节存储，与独立 C++ 回写得到的整段内存逐字节比较，并检查输入不变、getter 返回地址正确。不是构造真实业务模型。

| 检查 | 原生比较数 | 结果 |
| --- | ---: | --- |
| MaterialEffect value getter/setter | 2,973,696 | 0 mismatch |
| Keyframe time getter/setter | 884,736 | 0 mismatch |

组合覆盖所有 256 个 `tracking` 字节、6 个状态码、4 个 dirty 初值；double 为 22 种位模式的有序笛卡尔积，包括 ±0、相邻浮点数、极值、subnormal、±Inf、正负 quiet/signaling NaN；整数为 12 个边界位模式的有序笛卡尔积。portable 回归使用原生输出 FNV-1a 指纹 `8238921485342005053` 和 `9758396941018483869`，记录格式是结果 `u64/u32/u8` 小端连接，循环顺序固定在测试代码中。自产结构的默认成员值只是 API 便利值，不是已恢复的原生 constructor 默认值。

## 2. 插入滤镜的 sequence 与 trim 时间

证据链：`NewVEWrapper::insertFilter` `0x2e7c510–0x2e7c6c4` → helper `0x2debdd0–0x2debe80` → 插入 helper `0x2debe80–0x2dec240` → model clip helper `0x3a0f09c–0x3a0f278`。

独立 `filter_insert_times()` 的输入为 sequence `{in,out}`、是否成功 cast 为 `AmazingFilter`、数值 subtype。不能只凭 subtype 等于 3 就走相对 trim 分支；原生在 RTTI cast 成功后才读取该 subtype。

- `0x2debde0` 的 64 位减法得到 `duration = out - in (mod 2^64)`。
- cast 成功且 subtype **恰等于 3** 时，`0x2debf80` 把局部 trim 起点置 0，duration 不变。
- `0x3a0f134` 只把负的局部起点截成 0；`0x3a0f148–0x3a0f15c` 的终点加法使用**截断前**的局部起点。
- `0x2dec010–0x2dec02c` 重新读取原始 sequence 起点与 duration，重建终点后交给 editor 插入调用。

| 原 sequence | cast/subtype | 独立 trim | duration |
| --- | --- | --- | ---: |
| `[100,140]` | 成功 / 3 | `[0,40]` | 40 |
| `[100,140]` | 失败 / 3 | `[100,140]` | 40 |
| `[-10,20]` | 成功 / 2 | `[0,20]` | 30 |
| `[-30,-10]` | 成功 / 2 | `[0,-10]` | 20 |
| `[20,10]` | 成功 / 3 | `[0,-10]` | -10 |
| `[INT64_MIN,INT64_MAX]` | 成功 / 3 | `[0,-1]` | -1 |
| `[INT64_MAX,INT64_MIN]` | 成功 / 3 | `[0,1]` | 1 |

这些反例说明此函数既不保证 `trim.in <= trim.out`，也不拒绝负 duration。C++ 先转无符号做加减，再 `bit_cast<int64_t>` 解释结果，避免把机器回绕误写成 C++ signed-overflow UB。

**证据级别为 static-strong + 独立测试**。168 个固定 subtype/cast/边界用例与 65,536 个确定性随机端点性质用例通过。没有调用完整原生 insertion：其 shared_ptr、RTTI、clip 构造和 editor vtable 仍需要更大的受控对象环境。这些数值行为不等于 UI 允许用户提交所有输入，也没有证据给该时间值命名为“帧”或“微秒”。电影柔光实例是否真的为 subtype 3 仍未通过该链观察到。

另复核 `updateFilterSequenceTime` `0x2e7e174–0x2e7e198`：把上下文 `+0x150` 的 64 位值存入 wrapper `+0x428`，`+0x41e/+0x41f` 写为 1，然后调用 delegate `+0x148`，字符串和两个时间参数原样传递。此处只是已确认静态的转发边界，不把 delegate 内部算法算作已实现。

## 3. 关键帧字段传递与 JSON 元数据

匿名 transfer helper `0x3a19690–0x3a197cc` 分配 SDK `FilterKeyframe`，然后设置数值 type **2**、输入 record `+0x8` 的完整 64 位 time、`+0x18` 的 double intensity。原强度不缩放、时间不转换。`transfer_filter_keyframe()` 用自产普通 C++ 结构表达这三个字段，并附加元数据；不复制 SDK 对象布局或 shared_ptr。

本轮继续进入此前未解的 JSON helper **`0x3a194b0–0x3a19690`**。输入 record `+0x10` 是 64 位属性编号；第二参数只观察低 32 位，0 与任意非零走两套编号；并非按位组合：

| `code_mode` | 属性 code | JSON 外层键 |
| --- | --- | --- |
| 0 | `0x2000`、`0x4000` | `Intensity` |
| 非 0 | `0x80000000`、`0x100000000` | `Intensity` |
| 0 | `0x10000` | `effects_adjust_intensity` |
| 非 0 | `0x1000000000` | `effects_adjust_intensity` |
| 任意 | 其余 code，包括 OR 组合 | `intensity` |

内层键为 `value`，来自 record `+0x18`。例如 mode=0/code=`0x2000`/value=0.37 输出 `{"Intensity":{"value":0.37}}`，code=`0x6000` 则回到 `{"intensity":{"value":0.37}}`。大小写是数据的一部分。

新发现的静态陷阱：默认键来自 `0x4dfd7f8` 的运行时全局 `std::string`，所在区域在磁盘切片中为零；仅读取文件零字节会误认为默认键为空。隔离原生调用确定其初始化后的值为小写 `intensity`。另外三处只读字符串 VM 地址分别是 `0x48f58e0`（`Intensity`）、`0x48e992d`（`effects_adjust_intensity`）、`0x48527a1`（`value`）；现代编号表位于 `0x4795c20/0x4795c28/0x4795c48`。

**原生验证**：在已验证库中直接调用此完整小 helper，ABI 是 record 指针、u32 模式、libc++ 间接返回的 24 字节 string。15 个 code × 5 个模式 × 22 个 double 位模式，共 **1,650** 次，验证输入 record 没改写、JSON 层级恰为一个外层属性和一个 `value`、键和值语义匹配。有限 double 包括 -0 和最小 subnormal，用 `from_chars` 回读原生数字文本并按位比较；所有 NaN/Infinity 在原生 JSON 中变成 null。

独立 `KeyframeMetadata` 是结构化投影，没有写原生 decimal formatter，因此不声称 JSON 文本逐字节相等。`FilterKeyframeTransfer.intensity` 仍保留非有限值原位模式，其元数据 `value` 为 `nullopt`，两者不能混为一谈。整个 SDK FilterKeyframe 构造/析构及 `set_json` 事件效果未做原生差分。

## 重现与验证

普通和 sanitizer 构建命令见 [independent-editor-contract/README.md](../../../research/independent-editor-contract/README.md)。本机 AppleClang 21/macOS arm64 的 Release `-Wall -Wextra -Wpedantic -Werror` 和 Debug ASan+UBSan 均为 **3/3 CTest 通过**。sanitizer 使用 `-fno-sanitize-recover=all`；fast-math 被拒绝，防止 NaN/signed-zero 条件被优化掉。Linux/Windows 的源码执行尚未验证。

负控也实际执行：未知 SHA、相对路径、缺失文件和缺失参数均非零退出；`-ffast-math` 编译被拒绝；故意 signed overflow 在 UBSan 报错后由 SIGABRT 终止。把自产副本的状态 2 故意改成 3，指纹测试失败；把 trim.out 故意改成使用截断后的起点，固定时间向量失败。负控副本与日志均只在私有目录中。

静态命令先 `xcrun lipo ... -thin arm64` 写入私有目录，再用 `xcrun llvm-objdump -d --demangle --start-address=... --stop-address=...`；不带会忽略区间的 `--macho/--arch` 解码选项。

关键私有原始证据哈希：

| 文件 | SHA-256 |
| --- | --- |
| `material-value.arm64.txt` | `5cd70fba600a5480845001d80a17dada73b3826998c985f1642203ac561b138e` |
| `keyframe-time.arm64.txt` | `433dd719086bc358970a10f22faa342c8d8ea57d937971e0a73bab1dafec4964` |
| `filter-insert-helper.arm64.txt` | `be2dce118dc548483080a513d38fa81b96bebf80c8b6d1d70d6240cd885a5f8d` |
| `filter-model-clip.arm64.txt` | `3300cc1435ed737a4f5de84fec73816a2ba68420baf35675bb04236ef8d1e20a` |
| `filter-keyframe-transfer.arm64.txt` | `30b70a6115aa4e4f872dc912394c3bb55da4ce2ba1880e4f08f04ac9aa6cc17f` |
| `keyframe-record-json.arm64.txt` | `dc88001a8840f1982387ec0441f7658b66447c00706ee8490ad866944024b978` |

## 下一项及未闭环部分

下一项应连接 creator 的 `UpdateGlobalFilterReqStruct`、`GlobalFilterClient` 与实际 MaterialEffect/关键帧 record 的转换入口，确认正常动作对对象、强度及时间的选择，然后才扩展到原生构造的 FilterKeyframe 与插入 editor 的 differential。

当前仍缺：UI 请求到上述 record 的确定类型链、时间单位、完整 reset/dirty 子树、SDK 对象图生命周期、关键帧插值/时间驱动、undo、preview/export 事件顺序。此次原生差分证明的是指定构建下几个小函数的行为，不能提升为电影柔光 UI 像素对齐或 `libvideoeditor` 全库替代。
