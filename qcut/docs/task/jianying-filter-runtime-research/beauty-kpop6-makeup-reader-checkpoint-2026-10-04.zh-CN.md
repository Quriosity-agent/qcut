# beauty-6-kpop：口红原生读取路径检查点

日期：2026-10-04。分支：`beauty-6-kpop`。
工作目录：仓库内的 `qcut/`（本文其余路径均以它为基准）。
基线：`c2effe5dd9b6c5d72d555edd7930859653467e6b`，v2026.10.04.2。

## 本轮结论

柔和粉口红的阻断已从笼统的“没有消费”缩小到具体原生调用路径：
真实冷启动中，`FaceMakeupV2System::onUpdate` 直接读取 type-4 人脸结果，
没有经过现有 `FaceAdapter` 克隆交接入口。
ONNX 已返回预测 0，但原生渲染没有取得候选克隆的有效消费收据，因此宿主仍拒绝输出候选图。

后续 r5-r8 已将对象入口和候选发布实际接通：找到 1 个 scene / 9 个 System / 1 个美妆 V2，
在它的真实更新作用域发布独立候选克隆，完成 GPU fence 后恢复原始 buffer。
但发布不是关键点消费，整个口红审计仍失败，不能把这次接线计入口红效果通过数。

另一个关键定位是：此宿主先做初始化 seek，随后才设置口红参数，再执行最终输出 seek。
当前检查在初始化 seek 就因缺少消费收据退出，所以尚未到达带口红参数的最终输出阶段。
不能把预测 0 的缺失消费解释为“已激活口红仍不读取候选点”，也不能据此推断 ONNX 精度不够。

这是已复现的**交接覆盖和渲染阶段协议缺口**，不是已证明的 ONNX 数值精度问题。
尚未解决口红接管，尚未证明美妆使用候选关键点，更没有实现独立于原生运行库的美妆。
本轮不修改 UI、不启用产品候选后端、不放宽消费或 RGBA 零差异门槛。

## 只读探针

新增 `research/local-model-pytorch/face_live_reader_trace.py`，通过
`face_live_bridge_probe.py --trace-face-readers` 显式启用。

- 原有 3 个 liblens 推理观察断点保持不变，新增第 4 个硬件断点。
- 固定 libcccreator UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
- 固定库 SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
- 读取入口：`0xc15cd4`，`x0 = BachAlgorithmResult*`、`w1 = type`，仅保存 type 4 调用栈。
- 上限 512 次断点回调、每条 24 层栈、符号 512 字符，沿用 240 秒观察预算。
- 不写目标内存、不调用目标函数、不向 worker 发送额外消息，不修改推理序号或裁剪状态。
- `reader_trace.events` 独立于推理事件及消费 JSONL，始终标记 `renderer_consumption=false`。
- 观察器成功不等于候选成功；宿主拒绝请求时，整个审计仍失败。

同时修正协议报错：有序、匹配请求的原生拒绝原因不再被
`fresh host did not acknowledge every request exactly once` 覆盖。
错误正文限长并转义控制字符；乱序、陌生请求、重复响应仍被拒绝。

## 真实冷启动结果

输入统一为 `front-smile-original.jpg`，640 x 640，零预热。
以下目录前缀均为 `.local/jianying-model-pytorch/`；每次使用新目录、宿主和 worker。

| 运行 | 结果 | 证据 |
| --- | --- | --- |
| `beauty-kpop6-lip-cold-20261004-r1` | 失败复现 | 预测 0 收到候选；未消费；没有候选图；清理完成 |
| `beauty-kpop6-lip-trace-20261004-r2` | 读取路径已观察，候选仍失败 | 13 次 raw getter 命中，10 次 type-4；全部属于预测 0、同一 graph/thread |
| `beauty-kpop6-eye-trace-20261004-r3` | 无效参数被拒绝 | `face_adjust_eye` 不适用于所选包；原生与候选都不改变原图，不能算通过 |
| `beauty-kpop6-eye-trace-20261004-r4` | 大眼 +40 对照通过 | 正确参数 `face_adjust_EnlargeEye`；2 次预测、2 次真实转换、2 次 GPU 后恢复 |
| `beauty-kpop6-lip-system-20261004-r5` | 对象调度验证通过，候选仍失败 | 1 scene / 9 systems / 1 makeup；真实 V2 更新进入和退出；未声称消费 |
| `beauty-kpop6-eye-owned-refactor-20261004-r6` | 共享交接逻辑回归通过 | 提取克隆/发布公共逻辑后，仍为 2 次预测、转换、恢复，RGBA 零差异 |
| `beauty-kpop6-lip-publication-20261004-r7` | 发布与回滚已验证，消费验收失败 | 独立 buffer，原始点保持不变，GPU 完成后恢复；没有候选图 |
| `beauty-kpop6-lip-publication-20261004-r8` | 最终防御检查后复跑一致 | 加入 manager/wrapper 非空检查；发布/回滚可复现，依赖未变，清理无失败；仍无消费证明 |

大眼通过项：

- 原图改变 4,760 像素，RGB 最大差 30；变化框 `[212,109,408,173]`。
- 原生与候选 RGBA 差异像素 0，最大差 0。
- 两者 RGBA SHA256：`c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8`。
- 新探针记录 57 次 getter 命中、51 条 type-4 栈；包括原生读取、交接检查和恢复检查。
  这些命中不替代已有 2 次转换/恢复收据。

口红原生基线：4,096 个 RGB 像素改变、最大差 44、Alpha 不变。
候选输出缺失，所以没有“口红两链误差数值”。

## 口红实际调用栈

证据文件：`beauty-kpop6-lip-trace-20261004-r2/live/observer.json`。
表内偏移是固定库的非 ASLR 文件地址；“返回地址”不冒充函数入口。

| 条数 | 观察到的上层路径 | 意义 |
| --- | --- | --- |
| 4 | 函数 `0x99b850`，返回地址 `0x99be78/0x99bea0/0x99c04c/0x99c1f8` | 第一阶段原生读取，具体系统身份未在本轮确认 |
| 2 | Lua -> `0xc1f1f0/0xc1f228` -> face count/base accessor | 效果脚本确实读取数量和基础人脸；不能据此声称渲染几何消费 |
| 2 | `0x9ea110` -> helper `0x9eb348` -> count/aux accessor | 与美妆 V2 更新函数处于同一原生栈 |
| 2 | `0x9ea110` -> `0xc16554/0xc16634` -> `0xc15cd4` | 美妆 V2 直接读取数量和 extra 人脸数据，绕过 FaceAdapter |

静态分析通过构造函数/vtable 将 `0x9ea110` 识别为 `FaceMakeupV2System::onUpdate`：
vptr `0x35e6378`、槽 `+0xb8`。静态几何 helper `0x9eb6e8` 可读 base/extra/aux，
但本轮预测 0 的栈没有命中它，不能写成已观测到该 helper 消费候选嘴唇点。
旧 `FaceMakeUpSystem` 更新入口 `0xa24730` 也只是静态候选，本次没有动态命中证据。

### 已动态验证的对象入口

以下对象级路线已在 r5 以真实冷启动验证，r7 增加候选发布。
版本检查和内存布局仍只针对上述 UUID/SHA，不能迁移到任意剪映版本：

- 宿主保留的 `feature_` 是原生 Segment 指针，C API 创建结果没有额外句柄包装。
- `FeatureSegment::getScene(int)`：`0x180b8ac`，读取已有 scene、不主动加载。
  feature 的场景记录 begin/end 位于 `+0x2e8/+0x2f0`，记录步长 `0x58`，scene 在记录 `+0x20`。
- scene 更新函数 `0x61cc20` 使用 `scene+0xb0/+0xb8` 的系统记录，步长 `0x58`，记录 `+0` 为 System 指针。
- V2 vtable shadow 复制含 2 个 ABI 头的 32 个 qword；替换 shadow index 25，
  对象 vptr 指向 shadow index 2。调度 ABI 为 `x0=this`、`double d0=deltaTime`，不能按 float 处理。
- 实现已验证内存可读、起止顺序、步长整除、数量上限、vptr 和目标函数；
  场景表与 `getScene(index)` 必须一致。最多 32 个场景、每场景 256 个系统、总计 512 个唯一系统。
  空 scene 跳过，重复对象去重；这些是固定版本内部布局，不是公开类型。
- 不使用尚未明确 name-key ABI 的 `Scene::getSystem`；不把构造返回容器的 `getScenes()`
  错当普通指针 getter。不尝试给直接调用的 `getBaseInfo` 编造虚函数钩子。

入口观察通过 `--trace-makeup-system` 显式启用，要求 `--single-frame --cold-frame`。
观察器记录 `live_makeup_setup/update_enter/update_exit`，始终标记 `renderer_consumption=false`。

### 独立克隆发布与恢复

`--publish-makeup-candidate` 是仅研究用开关，额外要求 `--trace-makeup-system`。
默认关闭，未接入 Electron 产品后端。

真实 graph 取得路线已通过 r7 验证：

1. `0x40422c()` 取得当前线程 native Amazer。
2. 宿主 `SwingManager::getAmazer()` 返回 wrapper，用 `0x3f9d88(wrapper)` 解包，必须与线程值相同。
3. native vptr 必须为 `0x3530c48`，槽 `+0x98` 必须指向 `0x41d56c`；通过它取得 AE manager。
4. `0x407224(manager)` 取得当前借用 graph；该函数有 manager 参数，不是无参 getter。

随后复用 FaceAdapter 同一套独立克隆/候选点写入/发布代码，保留原生 source、extra 和遮罩。
候选只写克隆中的主 106 点，不修改 source。r7 实测事件顺序：

```text
live_candidate_received (prediction 0)
live_makeup_setup (1 scene, 9 systems, 1 makeup)
live_makeup_update_enter
face_clone_audit (distinct_buffer, primary_points_isolated)
live_makeup_publication (binding 1, graph 1, candidate_injected=true)
live_makeup_update_exit
live_owned_rollback (gpu_complete=true, original_restored=true)
host rejection: live prediction missing or not consumed by renderer
```

退出事件发生在 `validateSource()` 成功之后；发布和原始点未改变均不代表候选点已经被读取。
新路径故意不调用 `liveLeases.converted()`，没有伪造转换收据。
Python 还会拒绝该研究模式的通过状态，即使宿主协议返回成功，也不能只凭发布宣称接管成功。

公共交接逻辑提取至 `face_live_owned_input.h`，已有 FaceAdapter 路径使用同一实现。
r6 在真实原生进程中确认提取没有引入大眼输出误差：改变像素仍为 4,760，原生/候选 RGBA 差异仍为 0，
SHA256 与 r4 相同。源数据、克隆生命周期、GPU 完成和失败恢复仍使用原有 lease 检查。

### 新定位：初始化与最终渲染不是同一阶段

证据来自 `research/jianying-runtime-probe/filter-probe.mm` 和 r5 原生基线日志：

- `FilterHostSession` 创建时只在参数含 `draft_path` 的特殊路径预先设置参数；本次口红不走它。
- 普通 `render()` 先 native seek，成功后才调用 `setSegmentParams`。
- 每个协议请求由 `runFilterHost()` 调用两次 `renderAndWriteFilterFrame()`：初始化一次，再最终输出一次。
- r5 `baseline/host.stdout` 第 674 行是首次 seek，第 675 行是 `post-frame feature params result = 0`，
  第 691 行是第二次 seek，第 693 行才确认 `QCUT RESULT frame-00 0`。
- r7 候选检查在首次 seek 的收尾阶段拒绝，未走到参数应用和第二次 seek。

因此，下一步应建立有明确收据的阶段协议，不能直接取消预测 0 检查或增加隐式预热：
初始化仍需本次新推理、原始数据完整性及 GPU 后恢复；参数必须确认成功应用；最终输出必须证明候选 XY 被几何转换读取。
这套协议尚未实现。当前严格门槛继续保留，不把回滚成功当作候选渲染通过。

### 待验证的几何消费点

静态分析进一步定位到两条几何 helper `0x9eb6e8` / `0x9eb940`，它们都可能读 base 和 extra，
不是“一条只读 106、一条只读 extra”。以下均为下一步观察位置，尚无候选克隆的动态命中证明：

- base 转换器 `0xa2072c` 入口：`x0` 是 source base-info，`x1` 是目标指针槽。
- `0xa207ec` 即将读取 source XY，`x11` 是读取位置，`x19` 是 base-info，`x8` 是点字节偏移。
- `0xa207f0` 后 `s2/s3` 是读取到的 XY；`0xa20800` 写转换后的 `(X * width, height - Y * height)`。
- extra 转换器 `0xa20828` 处理额外向量；其读取不能替代对主 106 点读取来源的关联验证。

需要将这些观察与本次 publication 的 `owned_base/owned_points`、binding、graph、预测和线程关联。
只有函数命中、数量/metadata 读取或最终图片相同，都不足以证明使用了候选 XY。

## 对照图

本地 HTML：`output/beauty-kpop6-reader-20261004/index.html`。
机器报告：同目录 `report.json`；合计 `EXACT:1 / MISSING:1 / AUDIT_FAILED:1`。

共 15 张 PNG：大眼 6 张、口红 3 张、被拒绝的无效参数对照 6 张。
原图、原生、候选分别保存；灰度统一为 `min(255, 8 * max(abs(RGB difference)))`。
人工检查灰度图：大眼变化集中眼部，原生口红变化集中嘴唇。
口红候选及其差分标记为 `UNAVAILABLE`，不复制原生图填补。

本轮没有新的剪映 GUI 导出或 Electron UI E2E；这些是 QCut 本机宿主的研究链对照。
尝试浏览器截图时，Playwright CLI 拒绝 `file:` URL，未绕过此限制；PNG 已逐项读取检查。

## 下一步验收顺序

1. 对象路线、当前 graph、独立克隆发布与 GPU 后恢复已验证；保留版本固定和边界检查。
2. 先补初始化/参数应用/最终输出的阶段协议和失败测试，再允许到达口红激活的最终 seek。
   仍要求两次新推理完整关联；初始化不得伪称渲染消费，不增加隐式预热或复用历史点。
3. 动态证明最终几何转换读取的是本次候选点，再设计独立的 consumer 标识，
   Python 和 Electron 同时验证 binding/graph/预测/时间戳/阶段；发布和检查用 getter 永不算消费。
4. 同值输入先要求零 RGBA 差异，再做受控嘴唇相关扰动，证明变化确实来自候选点。
   眼部扰动通过不能替代嘴唇的因果证据；数量/extra 读取也不能冒充主 106 点消费。
5. 通过单图单口红后才扩展到三个人物、其它妆容、多强度、真实 Electron UI，
   最后才考虑分钟视频、多脸和跨平台。当前仍不进入这些能力的验收通过数。

## 测试与复现

初次读取路径检查：10 个 Python 套件运行 126 项，125 通过，1 项真实 Apple Development 签名测试因未显式启用而跳过。
初次大眼通过运行对应逻辑版本 `db0947b52`。

本次扩展增加纯 CPU 场景布局检查、共享克隆发布逻辑和美妆实验开关：

- C++ 场景对象测试通过，检查空值、越界、不可读、步长、getter 不一致、错误 vtable/槽位和去重。
- 15 项既有克隆 lease 生命周期测试通过，检查发布、转换、GPU fence、覆盖和失败回滚。
- 下列 6 个 Python 套件共 75 项通过，无跳过；覆盖研究开关必须显式组合、可复现命令保留开关、
  基线不被注入、成功协议不能冒充关键点消费。
- r5-r8 均完成进程清理；r6 大眼正向回归通过，r5/r7/r8 口红消费验收仍失败。
- 本轮未运行产品全量 CI、Electron UI 或跨平台验收，不宣称这些能力通过。

```bash
cd "$(git rev-parse --show-toplevel)/qcut/research/local-model-pytorch"
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_reader_trace_test face_live_bridge_lldb_test \
  face_live_bridge_probe_test face_live_bridge_audit_test \
  face_owned_result_probe_test face_live_bridge_process_test
```

真实重跑使用各审计 `report.json` 内的 `command`，先检查父进程/GPU lease 无占用，
保留 `--single-frame --cold-frame --stable-host --trace-face-readers`。
对象观察另加 `--trace-makeup-system`，独立发布实验再加 `--publish-makeup-candidate`。
每次必须换新输出目录和 Python cache prefix；口红预期仍失败，不能为了绿灯取消检查。
私有运行库、模型、效果包、人物图和完整审计不提交 Git。
