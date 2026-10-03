# 完整人脸结果的复制与所有权审计

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。

前置：[消费边界与 GPU 完成同步](face-render-injection-investigation-2026-10-03.zh-CN.md)。
本轮从借用原生点位，推进到隔离宿主中创建、修改和释放完整 `FaceBuffer` 副本。
**本节初始审计仅证明副本隔离，不证明消费者绑定。**
随后完成的大眼副本实际消费与正负扰动验证见
[完整绑定的运行时验收](face-owned-binding-2026-10-03.zh-CN.md)；原生分析仍未被 ONNX 替换。

## 锁定的运行库

- 平台：macOS arm64；不能直接套到 Windows、x86 或其他版本。
- core SHA-256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
- core UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
- AGFX SHA-256：`1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee`。
- AGFX UUID：`57ECC10F-8BB8-319C-BA46-AF286E2EBD43`。

探针编译和执行前后核对完整库 SHA/UUID、源文件与输入图快照。
只有 QCut 自建的隔离进程执行这些函数，不附加到剪映进程、不修改已安装的库文件。
原图、模型、效果包、RGBA、PNG 和原始反汇编留在本机私有目录，不提交厂商资产。

## 已确认的构造与生命周期

| 操作 | 本版本入口 | 确认的约定 |
| --- | --- | --- |
| `FaceBuffer` 构造 | `0xcd968c` | 对象分配大小 232 字节；结果类型和容器由原构造初始化 |
| `FaceBuffer::Clone() const` | `0xcd96dc` | 返回新的原始对象指针，不是隐藏返回的智能指针 |
| `_clone()` | `0xcd9c04` | 跳到上面的 Clone 实现 |
| `BachBuffer::clone()` | `0xb9e468` | 经虚表 `+0x30` 派发；不是在外部 memcpy 整个对象 |
| `RefBase::retain()` | AGFX `0xc8afc` | 对象 `+0x08` 的原子引用计数加一 |
| `RefBase::release()` | AGFX `0xc8b0c` | 最后一个引用释放时经虚表销毁对象 |
| `getRefCount()` | AGFX `0xc8b44` | 原子读取，不把字段猜测当作稳定 SDK |

实际调用确认新副本初始计数为 **0**。流程是：

```text
原生 update 完成
  -> 借用该帧 FaceBuffer
  -> 调用原 Clone，取得独立对象
  -> retain：0 -> 1，QCut 研究宿主持有
  -> 核对元数据、指针跨度与点位
  -> 修改副本的一个眼部坐标，确认原结果完全不变
  -> 恢复副本坐标
  -> 额外 retain/release：1 -> 2 -> 1
  -> RAII release 最后一个引用
  -> 原有消费者继续使用原结果并渲染
```

不直接调用 `release` 处理初始计数 0 的对象，不删除借用结果，不 memcpy C++ 所有者。
研究回调错误在 seek 返回后报告，不把异常展开穿过厂商更新器。

## 深拷贝验证范围

每次核对顶层 vtable/type、时间字段，以及六个版本锁定的结果向量。
非空向量必须具有独立存储，子对象必须不同且类型相同。

主脸记录还核对：

- 矩形与置信度的字节一致。
- 姿态、身份与标志元数据的字节一致。
- 106 个 XY 浮点及另一个 primitive 向量内容一致，存储地址不同。
- 只修改副本坐标，原始 106 点不变；副本确实收到修改。
- 原始结果的引用计数在整个审计中不变。

样本中六个向量数量为 `[1,0,0,0,0,1]`。
额外脸点和三组遮罩向量在这个大眼案例中为空，**不能据此宣布遮罩、虹膜、240 点、
fitting 或所有美妆数据均已深拷贝验证**。其非空嵌套数据仍需对应效果与素材覆盖。
本测试也不是长期内存泄漏或线程安全证明。

## 真实执行结果

使用此前的成人正面生成头像，1448x1086；效果参数是
`face_adjust_eye=[{"id":-1,"intensity":1.0}]`。

| 场景 | 输出比较 | 所有权审计 | 结果 |
| --- | --- | --- | --- |
| 正面脸，大眼 100%，时间递增 | 16 帧 | 43 次，有脸 43 次 | 与未安装回调的原宿主逐像素一致 |
| 无脸纯色控制，冷启动 | 4 帧 | 7 次，有脸 0 次 | 与原宿主一致；不把空结果误报为深拷贝脸成功 |
| 正面脸，效果强度 0，冷启动 | 4 帧 | 7 次，有脸 7 次 | 与原宿主一致 |

第一组 16 帧 RGBA SHA-256 全部是
`854da161becb1081a9e73ba430c2cddf1233ca5f30f7493033b069802aa1968c`。
这证明本轮 clone/修改/释放操作没有改变原有输出。

私有证据：

- `.local/jianying-model-pytorch/face-owned-audit-20261003-r1/`
- `.local/jianying-model-pytorch/face-owned-no-face-20261003-r1/`
- `.local/jianying-model-pytorch/face-owned-effect-off-20261003-r1/`

各目录有 `report.json`、两路独立进程日志、逐帧 RGBA、原生对照图、审计路径图和增益 8 的灰度差分。
审计路径图仍由原生原结果驱动；黑色差分不是独立分析或产品全功能对齐的证据。

## 探针与复现

- `face_owned_result_bridge.mm`：版本锁定的 clone、隔离和引用生命周期审计。
- `face_owned_result_probe.py`：两个全新宿主逐帧比较，异常时保存 `passed=false`。
- `face_owned_result_probe_test.py`：纯协议测试，不需要 Pillow 或厂商库。
- `face_render_consumer_bridge.mm`：仅在显式研究编译宏下调用新审计；默认和产品路径不启用。

从 `qcut/`，每次使用新的私有输出目录：

```bash
python3 research/local-model-pytorch/face_owned_result_probe.py \
  --runtime "$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current" \
  --package "$PACKAGE" --image "$IMAGE" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}' \
  --frames 16 --warmup 6 --require-face --expect-change \
  --out .local/jianying-model-pytorch/face-owned-fresh
```

帧数限制 1-24，预热限制 0-6，保留现有消费者探针的 seek 总次数保护。
`--require-face` 不允许只有空脸结果通过；`--expect-change` 不允许非零效果对照始终等于输入。

## 下一步的验收门槛

1. 找到经理所有的 raw result 槽与 adapter cache 的失效/重建顺序，不能只替换借用指针。
2. 保持副本存活到真实效果 renderer 的 GPU completion，之后才能恢复或释放。
3. 完整副本同值进入消费者时，输出逐像素一致；副本眼点小幅移动时，只有对应区域受控变化。
4. 验证换图、镜像、空帧、脸丢失恢复、参数切换与多脸，不能复用上帧缓存伪造通过。
5. 可靠计数并禁用原生分析，再接 PyTorch/ONNX 的完整结构。只替换 106 点不等于这一步。
6. 以上研究门槛通过后，再接产品 IPC、预览/导出，并单独验证 Windows/x86。

上述初始 clone-audit 报告明确保留 `owned_result_rendered=false`、`native_analysis_bypassed=false`。
已经有独立可修改的完整副本；仍缺安全的消费者绑定、缓存刷新和独立分析生产者。
