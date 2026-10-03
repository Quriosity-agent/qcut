# AE Face Result Adapter / Cache 静态契约

日期：2026-10-03。范围仅限当前 arm64 core 的只读静态恢复；没有 attach、launch、调用 native 函数、构造 clone 或修改缓存。主线报告的 43 次 clone audit / 16 帧像素一致性属于独立证据，不能据此推导缓存替换已安全。

## 固定版本

- 路径：`$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks/libcccreator.dylib`
- SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`
- arm64 UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`
- 地址都是此 image 的静态 VM 地址，不是可直接调用的已重定位进程地址。

## Raw Owning Slot

当前路径是 `Swing updater +0x178 -> AlgorithmManager*`，或 `extraction +0x80 -> AlgorithmManager*`。不要混用旧 BachAlgorithmSystemGE 或 requirement setter。

```text
AlgorithmManager[0] -> imp
imp +0x90 -> AE algorithm manager
AE manager +0xd8: graphIndex map -> node +0x18 -> BachAlgorithmResult*
BachAlgorithmResult +0x10: int32 type map -> type=4 node +0x18 -> FaceBuffer*
```

`0x25e3af8(manager, graphIndex, outputIndex, type)` 的成功路径没有使用 `x2/outputIndex`；它调用 `0x40722c(aeManager, graphIndex)`，再转到 `0xc15cd4(result, type)`。后者返回借用指针，未 retain。

静态恢复的 publisher 输入 ABI：`0xc157e8` 的 `x0=BachAlgorithmResult*`、`w1=int32 type`、`x2=FaceBuffer** incoming`，face 用 type 4。要求 `incoming` 和 `*incoming` 非空；返回 ABI、外部调用可用性及线程安全未确认。它通过 `0xb5a644` 取得 owning map value，调用 `0x407380(slot, incoming)`。

`0x407380` 已确认顺序：同指针则返回；retain incoming；对 old 调用 getRefCount 后 release；最后 store incoming。FaceBuffer 的相关 vtable slots 由 libAGFX 外部绑定解析为 `RefBase::retain`、`release`、`getRefCount`。这是 intrusive raw buffer 所有权，不是 `shared_ptr` 的 buffer/control 双指针。

需要恢复旧结果时，必须在替换前另持有 old 的 owning reference；不能指望借用的 old 指针在 release 后仍存活。此顺序不证明有可安全调用的外部 writer。

## Adapted Cache / Refresh

| 位置 / 地址 | 静态确认 |
| --- | --- |
| `imp+0x738` | adapted cache mutex；不等于已确认的 raw root 写锁 |
| `imp+0x778` | `graphIndex -> outputIndex -> algorithmType` 的 adapted result cache |
| `0x16739ec(extraction, uint64 low, uint64 high)` | 当前 lookup，face requirement `{1,0}`，返回借用的 `algorithm_result_face_st*` |
| `0x25e3784(manager, graph, output, type)` | adapted lookup，缓存非空且非零 type requirement 被当前 requirements 覆盖时直接返回 |
| `imp+0x580` | requirement 对象；128-bit bits 从 `+8` 开始，即 `imp+0x588` |
| `0x25e3440(imp, pipelineIndex)` | 常规清理明确跳过 type 4 和 46，不能充当 face invalidator |
| conversion context `+0x18` | adapted result；不是 raw FaceBuffer |
| conversion context `+0x20` | 当前 `BachAlgorithmResult*` |
| conversion context `+0x30` | type 3 的 blit buffer；不是 FaceBuffer cache |

adapted cache 存的是 `algorithm_result_face_st` 的共享所有权。已检查的 lookup 缓存命中路径不比较 FaceBuffer 指针、时间戳或 generation，因此 render 前才换 raw pointer 可能继续消费旧的 adapted 数据。没有确认持久保存 raw FaceBuffer 指针的 face cache 字段。

已确认的逐帧 old 分支：`0x25e09c8 -> 0x25db3ac -> 0x25db448 -> 0x25db480 -> 0x25d9c24`。single conversion 会复用已有 adapted result、调用其 `vslot+0x38` reset，再进入 adapter conversion。FaceAdapter 构造设置的 vptr 为 `0x36f7c90`，`+0x70` 指向 `0x25f0b44`；它使用 context `+0x20` 的 raw result，type-4 helper `0xc16574 -> 0xc15cd4` 重新取 face。

`imp+0x661 == 1` 选择 new 路径 `imp+0x650 -> 0x25d7494 -> 0x25d7580`；否则走 `imp+0x658` 的 old adapter。实际运行分支、全部 borrowed mask 生命周期、异步消费者完成条件没有在本任务验证。

### Old Adapter 查找 / Converter 输入

已确认 `oldAdapterManager = *(imp+0x658)`。`0x25db480` 的输入为 `x0=oldAdapterManager`、`x1=conversionContext*`、`x2=adapted-result ownership-pair slot*`、`w3=int32 type`。它在 `0x25db4b0` 调用 `0x25dcd08(x0=oldAdapterManager, x1=&int32_type)`，返回值直接作为 adapter 使用。**该 helper 内部 map 的 offset / node layout 未恢复，不能给出直接字段遍历。**

`0x25d9c24` 在检查 raw result 包含 adapter `+0x8` 的 type 后，加载 adapter vptr 的 `+0x70`，并在 `0x25d9c98/9c` 设置 `x0=adapter`、`x1=conversionContext*`，最后 `br x2`。FaceAdapter 的 target 是 `0x25f0b44`，同样使用 `x0=this`、`x1=context`；`x2` 是分支目标，不是已确认的第三输入参数。converter 返回 ABI 未验证。shadow/hook 的同步、可重入性、是否覆盖所有首次转换也未验证；本任务未实施。

## 生命周期约束

静态可支持的候选顺序，不是可写 SDK 或已验证 hook：

1. 独立验证 clone，并停止该 graph 的分析和所有消费者；同步外部接入点仍未找到。
2. 取得当前 graph 的 raw result，先保留恢复所需 old owning reference。
3. 在分析发布当前 raw result 之后、第一次 face conversion 之前，通过 owning type-4 assignment 替换。
4. 由现有逐帧转换刷新 adapted result，之后才允许 effect consumers 使用。
5. 恢复也必须 owning assignment 后重新转换，并覆盖所有 raw/adapted borrowers 的生命周期。

未解决：安全接入这个顺序的同步 hook、独立 late face invalidator、强制 reconversion 的外部 ABI、多 outputIndex 的 raw 路由、异步/辅助 mask borrowers。不能把 `0x25e3440`、requirement setter、缓存直接 store 或一个晚期 getter当作已确认解法。

## 复现与证据

```sh
python3 -m unittest discover -s research/local-model-pytorch -p face_result_adapter_trace_test.py
python3 research/local-model-pytorch/face_result_adapter_trace.py --out ".local/jianying-model-pytorch/face-result-adapter-trace-$(date +%Y%m%d-%H%M%S)"
```

trace 对全文件 SHA、arm64 UUID、constructor/vtable、face requirement 常量、3 条 ownership bindings、145 个指令锚点和 35 个完整窗口 fingerprint 失败关闭。只允许 unloaded `lldb --batch --no-lldbinit` 的 target create / bounded disassemble / quit；绑定表使用静态 `llvm-objdump --bind`，保存时只留相关 3 行。

已成功运行的最终私有证据：`.local/jianying-model-pytorch/face-result-adapter-trace-20261003-r2/{summary.json,static-trace.txt,ownership-bindings.txt,uuid.txt}`。`summary.json` 保存每个窗口地址/长度/fingerprint 和各 evidence SHA。之前的相关函数只读记录位于 `.local/jianying-model-pytorch/face-result-adapter-discovery-20261003/`。所有 vendor dump 均留在忽略的 `.local`，不得提交。输出必须是私有目录下的新路径，禁止覆盖、根目录和 symlink 越界。

本 trace 的 `external_injection_verified`、`runtime_cache_refresh_verified`、`native_function_called` 全部为 false。仅生成原始研究说明、guards、合成测试和私有静态证据；没有更改既有文件，没有 commit/push。
