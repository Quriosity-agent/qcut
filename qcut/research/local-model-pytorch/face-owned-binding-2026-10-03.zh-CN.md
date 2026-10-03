# QCut 持有的人脸副本进入真实美颜渲染

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。PR：[#483](https://github.com/Quriosity-agent/qcut/pull/483)。

前置：[clone 隔离与引用所有权](face-owned-result-2026-10-03.zh-CN.md)、
[adapter/cache 静态契约](face-result-adapter-cache-2026-10-03.zh-CN.md)。
本轮已证明完整副本在隔离宿主的大眼案例中影响实际渲染；**原生分析仍执行，副本仍来自原生分析，
不是 ONNX 已独立生产全部数据，也没有启用产品的独立分析后端**。

## 为什么同值通过还不够

第一版在 FaceAdapter conversion 前发布 clone，conversion 返回后立即恢复原 raw slot。
同值副本的 4 帧与原宿主一致，看起来成功；但把副本眼点 X 加 0.01，最终图像完全没变。

失败证据完整保留在 `.local/jianying-model-pytorch/face-owned-binding-e2e-20261003-r1/`，
`report.json` 是 `passed=false`。其转换日志有新指针和坐标扰动，不代表效果最终消费了新数据。
这排除了“回调发生”或“setter 成功”就可以验收的做法。

第二版只延长 raw clone 的绑定窗口：从转换之前一直保留到整次 seek 返回、真实效果 renderer 的
GPU completion 完成，然后才恢复。没有修改模型、滑杆、效果包、参数或像素验收门槛。
第二版与第三次重复执行均通过受控扰动。
因此在本案例中，conversion 返回就恢复 raw slot 太早，不能作为完整消费生命周期的终点。
后续具体有哪些晚期借用者仍需单独追踪，不把这个对照推广成所有效果的统一内部实现。

## 验证过的链条

```text
原始 RGBA + 大眼参数
  -> QCut 自建宿主 / 原生 Swing update（仍执行内部分析）
  -> FaceAdapter 即将转换该帧
      -> context +0x20 取得 BachAlgorithmResult
      -> retain 原始 FaceBuffer，保留恢复所需所有权
      -> 原 Clone 生成独立 FaceBuffer，QCut retain 持有
      -> QCut 可修改副本坐标
      -> owning publisher(type=4) 绑定副本
      -> 原 FaceAdapter conversion 和其余效果消费
  -> seek 返回
  -> 等待实际效果 renderer B 完成，不是只等宿主读回 device A
  -> owning publisher 恢复原 FaceBuffer
  -> 输出 RGBA
```

已确认本机运行 old adapter mode。只 shadow 自建进程内对象的转换虚表槽，
保留 RTTI 和其余 16 个主虚表方法；不修改厂商库、不附加到剪映进程。
new adapter mode、并发线程、重复 graph 转换或超出有界数量会明确失败。

`face_owned_binding_bridge.mm` 保留 clone 到宿主整体 teardown 之后才释放：
adapter/cache 可能继续借用其子对象，不能因为 GPU 一帧完成就猜测所有 CPU 缓存也释放了引用。
额外持有库加载引用，避免最后一次释放发生在库卸载之后。
本研究路径最多保留 128 个 clone，是短序列验证策略，**不是产品长视频的内存生命周期方案**。
尚未恢复所有 borrowers，也不能把 raw restore 视为强制 cache reconversion。

## 像素验收

两轮完整 E2E：

- `.local/jianying-model-pytorch/face-owned-binding-e2e-20261003-r2/`
- `.local/jianying-model-pytorch/face-owned-binding-e2e-20261003-r3/`

每轮同值、正扰动、负扰动三组；每组 6 个预热请求加 4 个递增时间请求，
实际有 18 次 owned conversion，并逐次确认 GPU 完成后的原结果恢复。

| 条件 | 4 帧结果 | 相对原生变化 | RGBA SHA-256 |
| --- | --- | --- | --- |
| 同值完整 clone | 全部精确一致 | 0 像素 | `854da161becb1081a9e73ba430c2cddf1233ca5f30f7493033b069802aa1968c` |
| 眼点 X +0.01 | 全部稳定一致 | 24607 像素，最大差 31 | `7c5e96a23da512dc89a27074cd83445f46df3cd53d01868dbd33e39e84ed6fb8` |
| 眼点 X -0.01 | 全部稳定一致 | 24713 像素，最大差 26 | `abf167e0f907cf5dcc759527546d02f3daa21f65c7ef0d104584ce20fcec05da` |

两个扰动均完全落在预先指定的眼部 ROI `[473,306,977,558]` 内。
bbox 用右/下排他边界：正向 `[522,368,924,528]`，负向 `[522,368,924,526]`。
正负结果 SHA 分别与前一阶段借用点位回放的输出相同，说明这次所有权替换没有引入新的画面误差。

`comparison.png` 的第一行是原生对照、正/负副本扰动；第二行是同值零差分、正/负差分，统一增益 8。
已经目视检查输出与差分。它们是隔离宿主的真实像素，不是新跑的剪映 GUI 截图。

附加冷启动控制：

- `face-owned-bound-no-face-20261003-r1/`：4 帧一致，6 次空脸 owned conversion，7 次审计。
- `face-owned-bound-off-20261003-r1/`：4 帧一致，6 次 owned conversion，7 次审计。

这两组没有预热，第一请求用于安装回调；不把第一请求算成已绑定副本的像素证明。
有脸非零效果的主 E2E 都经过预热，4 个验收帧已在绑定阶段。

## 复现与测试

与前置报告相同的 core/AGFX SHA 和 arm64 UUID；编译与执行前后核对源文件、输入图和宿主二进制。
厂商资产和原始 evidence 仍只在私有 `.local`。

```bash
python3 research/local-model-pytorch/face_owned_binding_e2e.py \
  --runtime "$RUNTIME" --package "$PACKAGE" --image "$IMAGE" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}' \
  --eye-roi 473 306 977 558 \
  --out .local/jianying-model-pytorch/face-owned-binding-fresh
```

ROI 必须对应实际输入，不是任意头像通用的常量。
`face_owned_binding_e2e_test.py` 拒绝只有转换日志而没有像素变化、越界变化、缺少 restore/GPU completion、
错误扰动方向或伪造 native bypass。静态 adapter trace 校验 145 个锚点和 35 个完整窗口。
当前模型/宿主/协议回归合计 **458 项 Python 测试通过**；产品协议与 provenance 的 29 项 TypeScript 测试通过。

## 接下来仍缺什么

1. 将连续换图 manifest 用于原生对照与 owned binding，而不只比较两次原宿主。
2. 将 PyTorch/ONNX 输出逐字段写入 owned 结果，并与原生同字段对比；缺少元数据就保留混合路径。
3. 禁止并计数原生推理，证明该帧不再内部分析；当前报告明确为 `native_analysis_bypassed=false`。
4. Stage2/240 点、虹膜、pose/fitting、非空 masks、多脸身份与遮挡，以及全部功能对齐。
5. 有界回收所有者、线程/重入和长视频稳定性；再接产品 IPC、预览/导出和 Windows/x86。

本轮解决的是版本锁定、单线程短序列的大眼副本消费验证。
不能把 `owned_result_rendered=true` 扩大成全部美颜美体独立完成。
