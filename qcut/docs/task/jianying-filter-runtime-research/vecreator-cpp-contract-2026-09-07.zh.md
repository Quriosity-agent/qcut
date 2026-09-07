# VECreator 滤镜请求与多选状态：独立 C++20 合同

日期：2026-09-07。工作分支：`codex/jianying-binary-cpp-next`。

本轮把滤镜属性面板的四类行为还原成可编译的原创 C++：选择与数值聚合、更新/接受/重置请求、批量关键帧处理门禁、确认框两个回调。实现位于 `research/independent-creator-contract/`，不依赖 Qt 或供应商运行库，不执行编辑器操作。它还原的是请求与状态语义，不能作为滤镜渲染或草稿最终状态一致性的证明。

## 身份与证据

| 项目 | 本次核验 |
| --- | --- |
| 应用 | 剪映专业版 11.3.0，`/Applications/VideoFusion-macOS.app` |
| 安装库 | `Contents/Frameworks/libVECreator.dylib` |
| Universal SHA-256 | `fb2082654df3a54c39e99d6828abf8189b011c4a1eaf48a5332b18525df7b62b` |
| arm64 UUID | `C4A59C03-BCE4-30E9-801E-BDC096397FD3` |
| arm64 thin SHA-256 | `7a3a18fa51db13294fd05f9f7c40111a4b8a1b527baa2dfa424df18f6e1584f2` |
| 私有证据 | `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/vecreator/` |
| 前轮证据 | `/Users/peter/Downloads/QCut-AGFX-Research-2026-09-06/vecreator/` |

所有地址均为对应 arm64 Mach-O 的未滑动虚拟地址，区间右端不包含。原始二进制、反汇编、加载日志只留在私有目录；仓库保存原创模型、测试与结论。`verification.json` 保存源文件与证据哈希、执行命令、结果和限制。前轮背景见 [VECreator 参数追踪](vecreator-filter-params-2026-09-06.zh.md)。

| 证据 | 地址/范围 | 支持的结论 |
| --- | --- | --- |
| `selection-set.asm` | `0x5a4c164–0x5a4c3f4` | 清空、查询、SegmentFilter 动态类型检查、唯一 map 插入 |
| 前轮 `wrapper-get-value.asm` | `0x5a4c7cc–0x5a4cd20` | 空/单/多选、0.01 桶、相对模糊比较、非有限分支 |
| `keyframe-value.asm` | 目标函数 `0x65fe91c–0x65fe9e4` | 游标时间与 timeline evaluator；文件后段其他函数不作本结论证据 |
| 前轮 `wrapper-set-value.asm` | `0x5a4cd20–0x5a4d760` | raw double、遥测、更新请求 |
| 前轮 `wrapper-reset.asm` | `0x5a4d760–0x5a4da90` | 每个唯一 ID 一条 reset 请求 |
| `request-constructors.asm` | update `0x5a4ec70–0x5a4edb0`；reset `0x5a4eef4–0x5a4f01c` | 请求 service/method 与字段构造 |
| 前轮 `wrapper-dispatch.asm` | `0x5a4b96c–0x5a4bc38` | combo 标识、mode、参数、调用 |
| `draft-combo.asm` | 目标函数 `0xabef018–0xabef39c` | 每条请求写 request id，pending policy 2 分支 |
| 前轮 `model-value-set-accept-reset.asm` | update `0x5a36db0–0x5a36e24`；accept `0x5a36e7c–0x5a37160`；reset 入口 `0x5a3727c` | 批量清关键帧门禁与延期接受 |
| `accept-callbacks.asm` | first `0x5a38324–0x5a383cc`；second 入口 `0x5a38554`，主要语义至 `0x5a38628` | 弱引用、标志、接受、dismissRecord、缓存及通知次数 |
| `clear-all-frames.asm` | 目标函数 `0x5a4da90–0x5a4deec` | 仅包含 filter 关键帧的段，调用 removeKeyFrameDatasAction |
| `global-filter-client.asm` | libvideoeditor update `0x124e10`、reset `0x125178` | 公开客户端转交 `lyra::Server::invoke`；未恢复服务端 handler |

## 选择集合与取值来源

`FilterSegmentActionWrapper::setSegmentIds` 先销毁旧选择树，再取得 editor mode 1 的 query utils。query utils 不存在时保持空集合。按输入顺序查找 ID，不能解析或不能动态转换为 `lvve::SegmentFilter` 的对象被跳过。有效对象进入 `std::map<std::string, shared_ptr<SegmentFilter>>`，使用 `std::less<std::string>`，调用的是 `__emplace_unique_key_args`。

因此，后续值和请求的顺序是 **ID 的字节字典序**，重复 ID 保留第一次成功插入。首次解析失败不占键，后续同 ID 的成功解析仍可插入。这里没有证据支持额外禁止空字符串或规范化 Unicode。独立实现保留这些字符串语义。

独立 `ResolvedCandidate` 是调用方提供的解析快照：包含 ID、是否为滤镜段，以及当前时间线求值结果。原生保存的是段指针，在取值时调用 `PanelKeyframeBase::getKeyframeValueFromTimeline<double>`，键为 `KFTypeFilter`，fallback 为 `0.0`。该 helper 取得游标时间，再转调 `getKeyframeValueFromTimelineWidthTime<double>`。本轮不恢复时间线插值器，也不把材质裸值冒充时间线值。

## 0.01 聚合不是强度量化

设按 ID 排序后得到值序列 `v0…vn-1`。

| 数量 | 返回值 |
| --- | --- |
| 0 | 正零 `+0.0` |
| 1 | 原始 `v0`，不比较、不取整 |
| 大于 1且全匹配 | 原始 `v0`，不返回桶编号，也不返回平均值 |
| 大于 1且存在不匹配 | `-1.0` |

独立结果另外包含 `empty/single/uniform/mixed` 分类，便于区分真实 `-1` 与 mixed 哨兵；这是原创接口便利字段，原生只返回 double。

多选时通常对每个值计算：

```text
a = roundAwayFromZero(v0 / 0.01)
b = roundAwayFromZero(vi / 0.01)
equal = abs(a - b) * 1e12 <= min(abs(a), abs(b))
```

`0.01` 的 binary64 位型是 `0x3f847ae147ae147b`；`1e12` 是 `0x426d1a94a2000000`。原生使用 `FDIV → FRINTA`，不是乘 100。`FRINTA` 的半整数向远离零方向取整。保留除法、相减、乘法与比较顺序，不能随意改成相等、绝对误差常数或除法版容差。

这个区别有可观测反例：binary64 `0.235 / 0.01` 为 `23.499999999999996`，比较桶是 23；`0.235 * 100` 为 `23.5`，遥测取整是 24。`0.235` 与 `0.234` 可同桶，和 `0.236` 不同桶。对于非常大的有限数，模糊比较也不是桶号严格相等：`1e10` 与 `1e10 + 0.01` 的桶相差 1，仍满足相对比较；相差 0.02 的测试不满足。

原生另有一个基于 **未取整的首值** 的无穷分支：首值为任一符号 infinity 时，后续任一符号 infinity 都匹配，因而 `[+inf,-inf]` 返回 `+inf`，`[-inf,+inf]` 返回 `-inf`。其他非有限情况仍落到浮点比较：

| 输入 | 结果 |
| --- | --- |
| 单选 NaN / infinity / -0 | 返回原值；测试包含 NaN payload 位型保持 |
| 多选 NaN，包括两个 NaN | mixed |
| 有限数与 infinity | mixed |
| 首值 infinity、后续有限数或 NaN | mixed |
| 两个相同 `DBL_MAX` | `/0.01` 溢出到 infinity，后续差成为 NaN，mixed |
| 多选 `[-0,+0]` | uniform，保留首个 `-0` |

`filter_intensity_precision=0.001` 是另一个常量，不能替换这里的 `0.01`。

## Update、accept、reset 的原创请求模型

两个构造器的字符串在私有 `selected-strings.json` 中按 Mach-O 地址读取：service 是 `GlobalFilterService`；method 分别是 `updateGlobalFilter`、`resetGlobalFilter`。本轮只恢复使用到的请求子集，不复制继承树、对象内存布局、vtable 或序列化器。

| 入口 | 请求 | wrapper dispatch bool | 本合同记录的 control 遥测 |
| --- | --- | --- | --- |
| `setValue` / update | 每个唯一 ID 一条 UpdateFilter | false | 无 |
| 普通 `acceptValue` | 相同 UpdateFilter | true | `click` |
| shortcut `acceptValue` | 相同 UpdateFilter | true | `shortkey` |
| `reset` | 每个唯一 ID 一条 ResetFilter | true | 此 wrapper 内无 control 遥测；上层另有 reset 事件 |

更新的 ID 位于原生 request `+0xe8`，raw double 在 `+0x100`。传入值直接写入，不预先取整或裁剪。原生构造器默认 `+0x128` 为 true，而此 wrapper 明确覆盖为 false；尚未证明这个 bool 的业务名称，原创接口保留 `observed_flag_0x128`，避免命名成未经验证的 enable、undo 或 keyframe 标志。

每条 accept 的遥测路径是：

```text
rounded = roundAwayFromZero(raw_intensity * 100.0)
int32 = QVariant(rounded).toInt(nullptr)
control_detail = signExtendToInt64(int32)
```

独立 `ControlTelemetry` 只覆盖 segment ID、action、control_detail，不冒充包含素材分类等字段的完整原生 TrackingEvent。

有限且取整结果位于 int32 范围内的输入可以安全转换。NaN、infinity、int32 越界时，原生 Qt 转换的精确结果本轮未验证；独立 accept builder 在此边界拒绝，保证输出未改变。这是 **QCut 的显式策略**，不是原生拒绝行为。update 路径不计算遥测，仍逐位保存这些 raw double。reset 不读强度参数。空选择仍返回可观察的空 combo，且不执行遥测转换。

Combo 固定 tag 为 `Filter_Segment_Base_Action`，editor mode 为 1，观测 policy 整数为 2，request id 为 -1，session id 由调用方提供。`DraftClient::draftCombo` 开头把该 request id 写入所有请求 `+0x38`；pending 且 policy=2 时复制动作向量用于后续回调。wrapper 的 bool 进入 combo params `+0x18`，尚未把此 bool 命名为提交事务或 undo 开关。

重置请求没有显式 intensity。`get_kFilterDefaultIntensity()=1` 也不足以证明 reset 最终写 1。公开 `GlobalFilterClient` 的 update/reset 入口只继续到 `Server::invoke`。这与 wrapper 经 `draftCombo` 的路线是相关接口证据，不能说 wrapper 直接调用了这两个客户端入口。服务端 handler、`UpdateGlobalFilter` 到 `MaterialEffect::set_value` 的字段桥接、reset 默认来源仍是后续目标。

## 批量修改与两个回调

`DraftInspectorFilterPropertiesModel` 的 `+0x62` 对应 batch selection（reset 遥测把它传给 `set_is_batch_selection`）；`+0x90` 是是否已开始移除关键帧的状态。独立 `ModelState` 只建模这两个 bool、wrapper 是否存在、当前是否有关键帧。

1. wrapper 缺失：update、accept、reset 均不发 wrapper 操作。
2. update 或 accept 遇到 batch selection、有关键帧、尚未开始移除：先计划 `clearAllFrames(false)`，再把 removal 标志置 true。之后的 update 不重复清除。
3. update 总是继续 wrapper update。
4. accept 若 batch selection 且 removal 标志为 true：调用 `alertToClearKeyFrames`，暂不直接提交；其他分支直接 wrapper accept。
5. reset 直接 wrapper reset，不从该入口推导清关键帧或默认强度。

`clearAllFrames` 遍历已排序选择，筛出 `hasKeyFrames(segment,"KFTypeFilter","")` 为真的段，将这些段和单一类型 `KFTypeFilter` 交给 `removeKeyFrameDatasAction(..., bool)`。该 bool 保留调用参数；本轮未执行移除，也未扩展成自己的撤销栈。

`dialog_callbacks` 用 **first/second 参数位置**命名，不根据未经 UI 验证的按钮标签起名：

| 回调 | 已恢复状态与调用 |
| --- | --- |
| first | 弱 model 失效则无操作；model 存活则 removal=false；wrapper 存在时，以捕获的原值与 shortcut bool 调用 `setValue(value,true,shortcut)` |
| second | 弱 model 失效则无操作；否则 removal=false；查询 `isInPreviewMode(sid,-1)`，仅为 true 时调用 `dismissRecord(sid,false,-1)`；重新取得 wrapper 聚合值，wrapper 缺失时用 0；与缓存做原始 double 比较 |

second 中缓存不等时写入新值并调用一次 `valueChanged()`，之后还会无条件再调用一次，所以 **变化值发两次通知，相等值发一次**。`+0` 与 `-0` 比较相等，不覆盖缓存的零符号；NaN 比较不等，写入并发两次。原创计划对象显式记录通知数量。它只描述调用和缓存结果，不真正 dismiss 编辑器记录；调用方也不能把这些结果解读为通用 undo/redo 实现。

## 验证与可复现命令

Release 和 ASan+UBSan 均通过 4/4 CTest、每轮 525 项断言：selection 84、requests 189、model gate 188、callbacks 64。测试使用静态恢复的反例/真值表，包括重复选择、失败解析、空/单/多选、半值邻居、除法与乘法差异、相对比较、NaN/infinity/溢出、原值位型、int32 遥测边界、重复 update、弱引用失效、通知次数。Release 没有使用会被 `NDEBUG` 消除的 assert。

可复现的通用构建命令见模块 README。所有目标开启 `-Wall -Wextra -Wpedantic -Werror -Wconversion -Wsign-conversion`，禁用 fast math 与浮点融合。ASan/UBSan 使用 `-fno-sanitize-recover=all`。首次显式 `detect_leaks=1` 被本机运行时以“不支持此平台”拒绝，保留在 `tests-sanitized.log`；随后 `detect_leaks=0` 的通过记录是 `tests-sanitized-supported.log`，**没有 LeakSanitizer 验证结论**。

可选 macOS arm64 probe 对安装库做 universal SHA、加载后的 arm64 UUID、可执行地址范围检查，再调用：

| 函数 | ABI | 本次结果 |
| --- | --- | --- |
| `VECConstKeys::get_kFilterDefaultIntensity`，`0x847b54` | 无参数，double 返回 | 1.0 |
| `VECConstKeys::get_kFilterIntensityPrecision`，`0x847b5c` | 无参数，double 返回 | 0.001，位型 `0x3f50624dd2f1a9fc` |

每个函数重复调用 1,024 次，共 2,048 次与原创常量逐位一致。错误 SHA 文件在 `dlopen` 前被拒绝。首次只有 `DYLD_LIBRARY_PATH` 时缺少 QtSvg framework；增加 `DYLD_FRAMEWORK_PATH` 后成功。加载原生依赖会运行库初始化，并打印其自身日志，包括重复 Objective-C class 提示；日志已完整留存。没有向应用注入、修改 dylib、传入伪造 model/Qt 对象或操作草稿。

```sh
xcrun llvm-objdump -d --demangle --start-address=0x5a4c164 --stop-address=0x5a4c3f4 /private/path/libVECreator.arm64.dylib
cmake -S research/independent-creator-contract -B /private/path/build-release -DCMAKE_BUILD_TYPE=Release -DCREATOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /private/path/build-release -j 4
ctest --test-dir /private/path/build-release --output-on-failure
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks DYLD_FRAMEWORK_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /private/path/build-release/creator-native-constants /Applications/VideoFusion-macOS.app/Contents/Frameworks/libVECreator.dylib
```

目前的验证分级：两项纯常量是身份门禁后的原生执行；四个独立行为单元是静态证据加原创测试；Qt 越界转换、服务端 reset/update、时间线求值、播放器虚调用、确认框 UI 标签及最终编辑结果仍未验证。本轮没有把后者包装成已实现的编辑引擎。
