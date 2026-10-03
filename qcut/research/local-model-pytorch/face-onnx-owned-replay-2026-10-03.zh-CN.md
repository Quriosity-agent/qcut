# ONNX 到 Owned FaceBuffer：真实消费、真实输入与剩余几何误差

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。同一个 [PR #483](https://github.com/Quriosity-agent/qcut/pull/483)。

接续 [owned binding](face-owned-binding-2026-10-03.zh-CN.md) 与
[Stage1 完整网络转换](face-alignment-heads-conversion-2026-10-03.zh-CN.md)。
本轮只推进研究链路，不更换编辑器后端、不推进发布，也不将模型或效果包加入 Git。

## 本轮结论

已经实际串通：

```text
ONNX 读取锁定的参考脸块
  -> Stage1 raw / mean / order / 参考 inverse
  -> 原图点 -> 显式 normalized-bottom-left 约定
  -> 外部 replay，匹配 conversion 时间与人脸 ID
  -> QCut 持有的深拷贝 FaceBuffer，仅替换副本 106 XY
  -> owning publisher -> 原始 FaceAdapter -> 原始效果渲染
  -> 等待实际 renderer GPU 完成 -> 恢复原绑定
  -> RGBA / 原图对照 / 统一 x8 灰度差分
```

**接通消费不等于效果对齐。** 同值外部点位逐像素一致；改变外部点位确实改变画面。
但使用旧的参考裁剪/逆矩阵产生的 ONNX 点位，仍不等于实际宿主最终点位。
两种候选报告均为 `final_consumer_parity=false`；渲染测试的 `passed=true`
只指协议、同值控制、扰动控制及拒绝测试通过，不指候选效果达到原始效果。

本轮另在实际美颜宿主捕获了输入与输出：把**同一份实际脸块**喂给 ONNX，
120/160 的 `fc_landmark_s1` 全部精确相同，全部 105 项头部比较通过既定门槛。
这把该素材/该版本下的剩余工作收敛到宿主几何路由和后处理；不能归因于 Stage1 关键点网络数值。

## 外部结果的真实所有权

研究宿主的新环境变量 `QCUT_FACE_BIND_REPLAY` 与旧的借用点位写入分开：

- 重用已有有界二进制解析器，版本、尺寸、时间、数量、ID、106 点、有限值和归一化范围均检查。
- 外部 replay **每次 FaceAdapter conversion 消费一帧**，不是每个 render request 或 algorithm update 一帧。
- conversion 用实际 seek 的整数微秒时间匹配；十次请求各含两次 seek，前两次用于安装回调，共 18 次消费。
- 对每张脸验证副本与原结果的 point storage 地址不同，写入后重新读取两边；转换后再次检查原点位不变。
- 记录 `faces_before`、`faces_applied`、时间、外部标志、写入隔离、原结果保持不变及 GPU 完成恢复。
- 禁止同时使用借用 replay 或非零借用点位扰动，不把两种机制混用后的像素当作 owned 证明。

同值与正负扰动都由**外部文件**写入，而非 binding 内部临时偏移。四个验收帧均已完成预热：

| 对照 | 外部 conversion | 每帧改变像素 | 最大 RGBA 差 | 变化框，右下边界不含 |
| --- | ---: | ---: | ---: | --- |
| 同值外部点位 | 18 | 0 | 0 | 无 |
| 眼部 X +0.01 | 18 | 24,607 | 31 | `[522,368,924,528]` |
| 眼部 X -0.01 | 18 | 24,713 | 26 | `[522,368,924,526]` |

两个扰动都在预先指定的眼部 ROI `[473,306,977,558]` 内；各四帧稳定，
输出哈希与前一阶段直接改副本的相同扰动完全一致。ROI 只适用于本张输入，不能泛化到其他人脸。
原生分析没有停用，rect、pose、quality、tracking 等字段仍来自原结果。

### 负向测试实际发现的问题

首次 R1 的同值/正负像素控制全部通过，但 `exit` 前仍有未消费数据时，
宿主打印错误却返回 0。原因是异常发生前成功退出码已写入局部 `result`。
现在异常分支强制失败退出；R1 保留为失败证据，不覆盖。

R2、120-R3、160-R4 均实际通过七类拒绝：截断、非有限坐标、尾随字节、未消费数据、
错误时间、错误人脸 ID、错误人脸数量。必须是正常非零退出且包含对应错误，崩溃/信号退出不算通过。
纯测试还发现日志验收将等值 float/bool 当成整数时间或 ID，以及未核对声明脸数；已收紧这些验收字段。

## 捕获实际美颜宿主的神经网络输入

`face_render_model_capture.py` 在我们自写的研究进程内使用既有 ByteNN 捕获器。
不是附加剪映进程，不改厂商代码页，不启动剪映 GUI；原始采集文件留在 `.local`。
捕获器只观察。四个验收输出必须与未观察的原宿主逐像素一致，之后才验收张量。

本张生成肖像、大眼 100%、六次预热和四个验收请求中，初始化 10 个 espresso 网络，
实际完成 67 次推理。非零计数为：

| 路径 | 实际输入，NWHC | 完成推理 |
| --- | --- | ---: |
| 检测 | `1,416,320,3`，int8 / fraction 6 | 1 |
| 160 检测关键点 | `1,160,160,3`，int8 / fraction 6 | 1 |
| 120 跟踪关键点 | `1,120,120,3`，int16 / fraction 6 | 20 |
| 40 分类 | `1,40,40,3`，int8 / fraction 6 | 40 |
| 112 身份特征 | `1,112,112,3`，int16 / fraction 7 | 5 |

其余初始化的网络没有成功推理记录，包括本次未执行的 extra/iris 网络。
这只是当前控制链的计数，不证明所有功能或运行时均只用这五类网络。
20 次 120 推理使用同一静态肖像，输入相同；不能写成 20 张不同素材或 20 个独立几何路径。
捕获表要求成功计数连续、每次有输入、字节数与类型正确、图对象可关联；不完整捕获不能算完成。

### 实际输入的 ONNX 对拍

`face_render_model_parity.py` 按实际 graph SHA 匹配已有导出，CPU ORT 固定 1.22.1，
没有安装/导入 Torch，也不调用原始推理函数。严格沿用浮点绝对/相对门槛，没有为新素材放宽。
验证 20 次 120 + 1 次 160，每次五个头，共 105 项：

| 输出 | 120 最大绝对差 | 160 最大绝对差 |
| --- | ---: | ---: |
| `fc_landmark_s1` | 0 | 0 |
| `fc_visible` | `1.1920928955078125e-7` | 0 |
| `prob` | `2.546585164964199e-11` | `1.7462298274040222e-10` |
| `fc_yaw` | `1.4007091522216797e-6` | `1.6689300537109375e-6` |
| `fc_pitch` | `1.9073486328125e-6` | `9.5367431640625e-7` |

只有两个 Stage1 导出参与本轮 ONNX 对拍，不能把其余检测/分类/身份网络计数当成转换验收。
yaw/pitch/分类字段的数值对齐也不等于其全部业务语义已经解释。

与先前显式 1.5 倍裁剪参考比较：120 输入 43,200 个元素中 **41,084** 个不同；
160 输入 76,800 个元素中 **76,077** 个不同。
这是直接捕获的输入不同，不是因为模型执行器对同一输入算错。
但不同输入的根因尚未逐项分解成裁剪、旋转、颜色、采样、缓存和路由；不能凭计数断言唯一原因。

## ONNX 候选的最终误差

`face_alignment_replay.py` 锁定图、输入、mean/order、inverse、参考图与 conversion trace 的哈希。
使用参考路径的点，不对最终宿主点拟合、不裁剪越界值、不调阈值强行达标。
本阶段每个参考脸块推理一次，将固定点位按捕获的 18 次 conversion 时间/ID 重复；不是实时跟踪器。
`x/width, 1-y/height` 是显式诊断约定，尚不是独立验证的完整原生坐标转换 ABI。

| 候选路径 | 参考 Stage1 raw 差 | 参考回映射最大差 | 与最终宿主点平均距离 | 最大单轴差 |
| --- | ---: | ---: | ---: | ---: |
| 120 基础对齐 | 0 | `0.00006103515625 px` | `2.101183 px` | `3.889578 px` |
| 160 检测种子 | 0 | `0.00006103515625 px` | `18.310683 px` | `25.613829 px` |

这两组参考的 mean/inverse 是原始算子记录，不是实际美颜宿主每帧选中的数据。
160 是检测种子，尤其不能当作宿主最终跟踪点替换。表内误差对同一输入稳定重复，不代表视频表现。

把候选写入 owned clone 后实际渲染四帧，均稳定，但没有达到 native parity：

| 候选 | 每帧改变像素 | 最大 RGBA 差 | 变化框 |
| --- | ---: | ---: | --- |
| 120 ONNX 参考路径 | 39,780 | 82 | `[520,359,924,528]` |
| 160 ONNX 参考路径 | 49,412 | 211 | `[522,342,926,528]` |

对应 x8 灰度图已实际打开检查：同值控制全黑，受控扰动局限眼部；候选图眼部仍有明显差异。
同值外部输入可以零差分，所以不能把候选误差全部归到 owned 注入。
同一真实脸块的 ONNX raw 也精确相同，所以当前证据支持优先继续查宿主几何/后处理，
但尚未把跟踪、精修及归一化分别隔离。

## 下一卡点和依赖

当前混合链还依赖厂商运行库、权重和效果包。网络执行器可独立执行，不代表权重可分发。
产品仍走原始路径；没有把已知误差的 ONNX 候选打开给用户使用。

下一段顺序：

1. 在同一个实际宿主 conversion 中关联 **face ID、120/160 真实输入、实际 mean/order、正逆矩阵**。
   已捕获网络输入；缺 per-conversion 的矩阵/选表和与网络实例的关联，不能用拟合最终点替代捕获。
2. 同输入、同几何表逐段替换 raw、decode、backmap、tracking/postprocess，保持现有同值像素控制。
   每段分别记录原图坐标误差与美颜 RGBA 差，找到第一处分叉。
3. 保留缺失元数据的混合来源，补检测、质量接纳、身份/无脸/多脸/恢复；之后才禁止并计数原生推理。
4. 再扩展 Stage2/240 点、虹膜、非空 masks、pose/fitting、全部五官/皮肤/美妆效果。
5. 有界回收、线程/重入和长视频；最后接产品 IPC、编辑器预览/导出、Windows/x86。

owned clone 最多保留 128 个，直到宿主销毁后释放；这不是可交付的长视频内存策略。
旧 adapter mode 以外仍拒绝，多线程/重入不支持。没有新的 GUI 导出或 Windows 原库运行证据。

## 私有证据

所有路径相对于 `.local/jianying-model-pytorch/`，不加入 Git：

- `face-owned-replay-e2e-20261003-r1/`：未消费数据的退出码失败现场。
- `face-owned-replay-e2e-20261003-r2/`：原生/同值/正负外部点位与七种拒绝。
- `face-render-model-capture-20261003-r1/`、`r2/`：实际网络输入/输出，四帧 observer 零差分；R2 对应当前源文件。
- `face-render-model-parity-20261003-r4/`：当前提交代码及 R2 捕获的 105 项 ONNX 真实输入验收。
- `face-alignment-replay-{120,160}-20261003-final-r3/`：当前 producer、锁定参考和最终点位差。
- `face-owned-replay-e2e-120-20261003-r3/`、`face-owned-replay-e2e-160-20261003-r4/`：候选的真实渲染、`comparison.png`。
- `face-sequence-owned-20261003-r2/`：移动、镜像、无脸、恢复、关闭、半强度共七个原生/owned 对照帧精确一致。

候选 E2E 使用 final-r2 的 replay；final-r3 仅共享 Torch 检查，两个版本 payload 字节相同。
验证源文件与 Git HEAD 哈希，不能只凭目录名认为是当前代码。

## 复现与本地测试

从 `qcut/`，`RUNTIME`、`PACKAGE`、`IMAGE` 使用前置文档的本机锁定资源；输出必须是新的私有目录。

```bash
python3 research/local-model-pytorch/face_owned_replay_e2e.py \
  --runtime "$RUNTIME" --package "$PACKAGE" --image "$IMAGE" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}' \
  --eye-roi 473 306 977 558 --out .local/jianying-model-pytorch/owned-replay-fresh

python3 research/local-model-pytorch/face_render_model_capture.py \
  --runtime "$RUNTIME" --package "$PACKAGE" --image "$IMAGE" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}' \
  --out .local/jianying-model-pytorch/model-capture-fresh

.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_render_model_parity.py \
  --capture .local/jianying-model-pytorch/model-capture-fresh \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out .local/jianying-model-pytorch/model-parity-fresh

.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_alignment_replay.py \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --reference .local/jianying-model-pytorch/face-alignment-tracking-20261002-r4 \
  --decode-reference .local/jianying-model-pytorch/face-alignment-decode-20261002-r4 \
  --capture .local/jianying-model-pytorch/face-owned-replay-e2e-20261003-r2 \
  --image "$IMAGE" --size 120 --out .local/jianying-model-pytorch/model-replay-fresh
```

新回归为 45 个 owned replay、39 个捕获、9 个真实输入张量/头部、27 个 producer 测试，
共新增 120 个。本地完整相关 Python **585 个通过，无跳过**；产品协议/provenance TypeScript **29 个通过**。
其中 84 个新测试以 `python3 -S` 执行，不加载模型、图像库、NumPy 或原库。
初次合并运行暴露纯 producer 测试继承其他模块的 Torch 导入；现在仅模拟已 mock 推理的纯测试环境，
生产 Torch-free 守卫及其专门拒绝测试保留，真实 ORT 子进程也再次通过。
这些是本地结果，不是 CI 绿色、产品完整 E2E 或多脸长视频完成的声明。
