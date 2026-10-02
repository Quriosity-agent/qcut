# 外部人脸结果进入原生美颜：入口调查

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
前置：[完整 Stage1 网络转换](face-alignment-heads-conversion-2026-10-03.zh-CN.md)已完成该段数值验收。
本段是第二卡点的静态调查，**不是外部结果注入已完成**。

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

## 有实际实现但尚未确认的入口

`bef_effect_set_external_algorithm`、`bef_effect_set_external_new_algorithm`、
`bef_effect_set_external_algorithm_array` 均有非桩代码。
它们检查 handle/context，再经对象 vtable 的 `+0x538` 槽派发；具体对象与最终消费函数尚未确认。
这个偏移是本版本静态线索，**不是可公开使用的稳定 ABI**。

另有两个 C++ 包装层，符号明确给出参数类型：

- `TEStickerEffectWrapper::setExternalAlgorithmEff(BefRequirement_ST)`。
- `TEStickerEffectWrapper::setExternalAlgorithmEffNew(BefRequirementNew_ST)`。

第一种包装层实际调用 `bef_effect_set_external_new_algorithm`；仅按 old/new 名字配对也会误判。
目前没有恢复两种结构体布局，不能假设它们是 106 点数组，也不能仅凭 Requirement 名字断言它们只包含需求位。
需要追踪调用方如何构造结构和被调方如何读取，才能知道里面是 flags、指针、结果集合还是组合。

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

1. 追 `BefRequirement_ST` / `BefRequirementNew_ST` 的构造与读取，定位 `+0x538` 的消费者；
   先恢复字节布局、count、指针归属与析构时机，不盲调用猜测的 ctypes 原型。
2. 在隔离宿主中先输入与内部结果相同的完整分析结果，对比原始画面与注入画面；
   再小幅移动一组眼/鼻点位，验证对应像素发生受控变化。
3. 禁用内部分析后再验证，或可靠计数内部推理调用，防止接口成功但最终仍使用内部结果。
4. 验证无脸、多脸、track id、图像尺寸/旋转、时间戳、跨帧缓存、丢失恢复与生命周期。
5. 先建立 NativeFaceResult 协议，再接独立网络输出；缺少 Stage2、虹膜、fitting 或 mask 时要显式降级。
6. 只有隔离探针证明消费成立，才修改 Electron IPC、后端选择及预览/导出接入，并做相同帧的真实效果差分。

若这些入口不能可靠消费外部结果，就明确保留原生内部分析，或改走 QCut 自写几何渲染。
本轮已经缩小第二卡点的调查范围，但尚未完成 ABI、运行时注入、内部推理替换或最终美颜画面对齐。
