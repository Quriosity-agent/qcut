# 外部人脸结果进入原生美颜：入口调查

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
前置：[完整 Stage1 网络转换](face-alignment-heads-conversion-2026-10-03.zh-CN.md)已完成该段数值验收。
本段是第二卡点的静态调查，**不是外部结果注入已完成**。
后续已恢复需求结构并定位消费者，排除三个 `set_external_*algorithm*` 候选为人脸结果写入入口，见末节。

## 当前链路为什么还不能直接替换

QCut 的 portrait preview 仍经 `jianyingPortraitAdjustment.render` 调用自建原生宿主。
请求有 RGBA、尺寸、调整项和时间信息，没有完整外部分析结果协议。
现有 `filter-face-inspect.mm` 初始化原模型目录与效果包，再执行原 `algorithm_texture` / `process_texture`。
`get_bach_result_by_node_name` 读取的是内部产生的 FaceBuffer，不是写入入口。

因此现在是两条链：

```text
独立研究链：准备脸块 -> PyTorch/ONNX -> 五个头 -> 106 点
产品渲染链：RGBA -> 原生算法图内部分析 -> 原生效果包渲染
```

第一条的点位正确，不证明第二条已经用上这些点。给 IPC 加一个 points 字段，或者改 provider 名称，
也不能替代真实的消费验证。现有产品调用没有被本次探针修改。

## 调查版本

- 本机私有 `JianyingFilter/current/Frameworks/libcccreator.dylib`。
- 整个文件 SHA-256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
- arm64 UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
- 文件另有 x86_64 slice；本段明确只选 arm64，不能将地址/结构套到其他架构。

探针先验证 SHA/UUID，再用 `nm` 选择已存在的名字，按单符号反汇编；对单指令跳转仅检查目标的两条指令。
LLDB 只创建文件目标，不启动进程、不执行厂商函数、不注入或修补二进制。
完整符号表不写入公开报告，有限的反汇编证据留在私有目录；不是运行任意名称或全库反汇编。

## 已排除的四个入口

| 导出符号 | arm64 入口 | 实际行为 |
| --- | --- | --- |
| `bef_effect_algorithm_cap_set_all_algorithm_buffers` | `0x162989c` | 跳到 `0x1303918` |
| `bef_effect_algorithm_cap_set_algorithm_buffer` | `0x16298a0` | 同上 |
| `bef_effect_algorithm_cap_set_all_algorithm_results_serialize` | `0x16298a4` | 同上 |
| `bef_effect_algorithm_cap_set_algorithm_result_serialize` | `0x16298a8` | 同上 |

共同目标只有：

```asm
mov w0, #-3
ret
```

这是固定返回负值的桩入口，不读取参数、保存 buffer 或消费点位。
看到导出名字就以为可以注入结果，会把不存在的功能接进产品。
本版本下这四条路径已经排除；不是对所有剪映版本的结论。

## 初始候选（后续已确认是需求设置）

`bef_effect_set_external_algorithm`、`bef_effect_set_external_new_algorithm`、
`bef_effect_set_external_algorithm_array` 均有非桩代码。
它们检查 handle/context，再经对象 vtable 的 `+0x538` 槽派发；具体对象与最终消费函数尚未确认。
这个偏移是本版本静态线索，**不是可公开使用的稳定 ABI**。

另有两个 C++ 包装层，符号明确给出参数类型：

- `TEStickerEffectWrapper::setExternalAlgorithmEff(BefRequirement_ST)`。
- `TEStickerEffectWrapper::setExternalAlgorithmEffNew(BefRequirementNew_ST)`。

第一种包装层实际调用 `bef_effect_set_external_new_algorithm`；仅按 old/new 名字配对也会误判。
初始调查没有恢复两种结构体布局，不能假设它们是 106 点数组，也不能仅凭 Requirement 名字断言它们只包含需求位。
后续从字段绑定、数组转换和真实消费者恢复了其需求设置含义；下面保留最初的调查边界。

现有 FaceBuffer 读取器有本版本只读字段约定，能读取 face/track id、rect、姿态和点数；
它没有建立写入结构、构造/析构、引用计数、额外点位/质量/掩码协议。
单个 Stage1 的 106 点不应直接等同于渲染器期望的全部人脸分析数据。

## 已写探针和测试

- `face_render_injection_inventory.py`：锁定版本的静态入口、单跳转目标和固定返回值调查。
- `face_render_injection_inventory_test.py`：6 个合成测试，覆盖单跳转、完整返回序列、零/负值区别、
  工具输出边界、禁止覆盖证据、平台/哈希失败不得写文件。
- 私有输出：`.local/jianying-model-pytorch/face-render-injection-20261003-r1/`。
- `summary.json`：9 个符号、4 个固定负值桩，`external_injection_verified=false`。
- 与前置模型回归合计 315 个测试通过、无跳过、退出码 0；使用独立固定 ORT 1.22.1 环境。

复现（从 `qcut/`，需要本机私有库及 Xcode 命令行工具）：

```bash
.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_render_injection_inventory.py \
  --out .local/jianying-model-pytorch/face-render-injection-fresh

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  -m unittest face_render_injection_inventory_test
```

## 下一步必须证明什么

1. 需求结构和 `+0x538` 的静态消费者已确认，但它们不是人脸结果入口；
   下一步沿 Bach 分析结果生产/消费边界寻找可写协议，恢复结果归属与生命周期，不盲调用猜测的 ctypes 原型。
2. 在隔离宿主中先输入与内部结果相同的完整分析结果，对比原始画面与注入画面；
   再小幅移动一组眼/鼻点位，验证对应像素发生受控变化。
3. 禁用内部分析后再验证，或可靠计数内部推理调用，防止接口成功但最终仍使用内部结果。
4. 验证无脸、多脸、track id、图像尺寸/旋转、时间戳、跨帧缓存、丢失恢复与生命周期。
5. 先建立 NativeFaceResult 协议，再接独立网络输出；缺少 Stage2、虹膜、fitting 或 mask 时要显式降级。
6. 只有隔离探针证明消费成立，才修改 Electron IPC、后端选择及预览/导出接入，并做相同帧的真实效果差分。

若这些入口不能可靠消费外部结果，就明确保留原生内部分析，或改走 QCut 自写几何渲染。
本轮已经缩小第二卡点的调查范围，但尚未完成 ABI、运行时注入、内部推理替换或最终美颜画面对齐。

## 后续推进：需求 ABI 与真实消费者

同日新增 `face_render_requirement_trace.py` 与 12 个合成回归测试，仍是读取已安装私有库的隔离静态探针。
产品 IPC、provider、宿主和效果参数没有改变，也没有执行厂商函数。

### 恢复的结构

不是只凭符号名字推测：同时核对 Lua 字段绑定的 getter/setter、字段名字符串的代码交叉引用、
32 字节分配/清零，以及 C++ 包装层两次 16 字节复制。

| `BefRequirementNew_ST` 字段 | arm64 偏移 | 存储类型 | 转换路径实际用途 |
| --- | --- | --- | --- |
| `algorithmReq` | `+0x00` | `uint64` | 合并进需求位集合 |
| `algorithmParam` | `+0x08` | `uint64` | 按位 OR 合并 |
| `algorithmNum` | `+0x10` | `int32` | 算法编号数组的循环上界 |
| 对齐填充 | `+0x14` | 4 字节 | 不作为结果内容 |
| `algorithmRequirement` | `+0x18` | `int32*` | 以 4 字节步长读取算法编号，再转成位集合 |

总大小 32 字节、自然对齐 8 字节，只适用于已锁定的本机 arm64 构建。
这里的指针指向算法编号数组，不是坐标、FaceBuffer、遮罩或网格。
旧 `BefRequirement_ST` 包装层转发两个机器字，`set_external_new_algorithm` 将它们扩展成内部 32 字节需求值；
没有把这两个机器字解释成人脸结果指针。
算法编号完整语义、数组非法值行为没有作为对外稳定协议发布，也没有以猜测结构发起运行时调用。

### 最终消费者

从 `bef_effect_create_handle` 跟到实际 EffectManager 构造函数，确认它写入的主虚表地址，
再读取该虚表的 `+0x538` 槽，而不是给一个名字相近的基类虚表硬加偏移：

```text
create_handle -> EffectManager constructor
  -> constructor-written vptr 0x36580e0
  -> vptr + 0x538 = 0x3658618
  -> consumer 0x1785674
```

消费者从输入复制两个 16 字节值到 manager `+0x898`，比较当前需求并标记更新。
三个 C API 最终传入的都是已经转换的需求值；数组版在调用此消费者之前就消费了编号数组。
**这条路径没有保留外部人脸坐标指针，也没有建立分析结果的引用计数/所有权协议。**

本段静态反汇编还显示编译器抽出的寄存器小函数会跨调用保存参数。
若只看主函数而跳过这些小函数，会误认为 `x19/x20` 是未初始化结果指针。
探针对相关小函数也核对精确指令地址，不把它们当成独立 C ABI 调用。

### 验收与边界

- 私有证据：`.local/jianying-model-pytorch/face-render-requirements-20261003-r2/`。
- 校验完整库 SHA-256、arm64 UUID、构造函数虚表来源、四字段名交叉引用及 60 个精确指令锚点。
- 所有反汇编限制在 33 个指定区域；只建立 LLDB 文件目标，不启动进程，不使用表达式执行或修补二进制。
- 报告为 `static_requirement_trace_verified=true`、`interface_role=algorithm_requirements_not_face_results`；
  `external_injection_verified=false`、`native_function_called=false` 保持不变。
- 相关模型/注入回归共 327 个测试通过，无跳过、退出码 0，使用固定 ORT 1.22.1 完整环境。
- 新增 12 个测试覆盖地址/指令缺失、虚表误选、ADRP 正负页偏移、字段重名/无交叉引用、
  输出不可覆盖、平台/哈希/UUID/读取期间变化、反汇编边界及禁止把静态证明升级为运行时注入。
- 不提交厂商二进制、权重、原始反汇编或图片；本轮没有效果改变，因此没有生成新的美颜对比图。

复现（从 `qcut/`，使用新的输出目录）：

```bash
.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_render_requirement_trace.py \
  --out .local/jianying-model-pytorch/face-render-requirements-fresh

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  -m unittest face_render_injection_inventory_test face_render_requirement_trace_test
```

### 还卡在哪里

已解决的是三个候选接口的结构/消费含义，**不是“外部分析结果进入渲染器”这个卡点全部解决**。
四个固定负值桩加三个需求设置入口，目前都不能当作可用的人脸结果写入协议。
下一步必须找到 Bach/FaceBuffer 的实际可写输入和所有权边界，再完成同值回放、受控点位扰动、
内部推理旁路和跨帧生命周期验证。不能因为这七条路径不可用就断言所有入口都不存在；
也不能把像素缓冲输入、MV 文件/JSON 输入或“有外部插件字符串”直接算作 FaceBuffer 注入成功。
在此卡点通过前，不接产品独立分析后端，也不推进下一阶段的完整独立人脸分析链。
