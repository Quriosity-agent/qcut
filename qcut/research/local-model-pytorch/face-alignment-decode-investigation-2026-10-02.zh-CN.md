# 原始 Stage1：实际网络分支、输出单位与平均脸叠加

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 这一段完成了什么

继续解释原始链条，没有替换 QCut 编辑器后端，也没有新增独立对齐器。
在初始化后的真实 SDK 对象上调用原始推理、关键点读取和 Stage1 阶段函数，
而不是只看函数名称或离线张量。

- **32 组**输入、原始解码、平均脸叠加和重复推理全部精确匹配，最大绝对误差为 0。
- 包含 20 组合成输入、12 组已有生成肖像裁剪，覆盖 120/160、普通/优化两条路径。
- 新进程重复 32 组：输入、raw、解码、Stage1 点和诊断重建的文件哈希再次完全一致。
- 新增 **26 个**公开合成回归；本地相关回归合计 **206 个通过**。
- 肖像对照图已保存；原始 Stage1 与诊断重建点的叠加图 x8 灰度差分全黑。

精确匹配证明这一步没有引入坐标解码误差，**不是**最终五官、美颜或剪映导出效果一致。

## 不能凭尺寸或名字判断用途

实际读取初始化对象的预测器指针和网络尺寸，受控调用原始
`FsNewAlignAlgo::doCnnAlignmentNewPhase2`，再读取对应网络的实际输入和 raw 输出。

| 当前模型包、显式基础配置下的分支 | 实际网络 | 输入 | 原始输出的处理 |
| --- | ---: | --- | --- |
| 检测分支 | 160 × 160 | int8，fraction=6，NHWC | 重排后直接作为脸块内坐标 |
| 普通基础/跟踪分支 | 120 × 120 | int16，fraction=6，NHWC | 重排后仍是残差，需要叠加基准脸 |

两种输入均为准备好的 BGR 像素减 128。raw 输出均为 212 个 float32，fraction=0。
本轮不仅比较两个直接预测器：阶段函数选中哪一个预测器，也由阶段调用后的实际张量与
该预测器直接推理的张量精确一致来核对。

这不能扩展为“所有剪映版本都这样”，也不涵盖增强跟踪、部分脸或其他模型配置。
静态变量 `Base120MeanFace` 的名字也不能替代运行时数组单位验证。

## 解码顺序和单位

使用已有 106 点重排诊断函数，再与真正的 `GetLandmark` / `GetLandmarkOpt` 对照：

```text
raw: 106 个交错排列的 (x, y)
  → 按初始化后的 Stage1 表转换为目标点编号
  → 检测 160：保持原坐标
  → 基础 120：叠加 base_reference / 256 * (width, height)
```

120 分支观察到的运算精度为：raw 和基准值先转 double，进行除法、乘法和加法，
最后转回 float32。坐标单位是输入脸块内的像素坐标，不是 `[0, 1]` 比例坐标；
基准使用 256 单位，缩放采用实际 `width/height`，**不是 `width-1/height-1`**。

```text
point = float32(float64(decoded_residual)
                + float64(base_reference) / 256 * network_size)
```

这解释了为什么直接把 120 的 raw 输出套逆矩阵会错：少了整个基准脸的位置。
相反，160 检测结果如果再叠加一次基准脸，则会造成重复位移。

### 当前重排控制的局限

这个模型初始化后的 Stage1 表恰好是 **106 点恒等映射**。
因此本轮实际调用可以确认当前编号与 raw 对应，但不能仅靠运行结果区分
`output[order] = raw` 与 `raw[order]`，也不能区分叠加平均脸是在重排前还是后。

公开测试使用自建非恒等表，检查诊断函数的目标编号和基准叠加契约；
它不是另一套原始模型上的运行证据。没有修改 SDK 的表、指令或权重来制造差异。
非恒等原始表的重排方向仍保留为未验证项。

## 错误对照实际有多大

以下最大绝对误差来自 32 组受控输入，单位为脸块内像素：

| 替代处理 | 实测最大绝对误差 |
| --- | ---: |
| 120 漏加基准脸 | 108.993753433 |
| 120 错用另一张 tracking 基准脸 | 20.126914978 |
| 120 用 size-1 缩放 | 0.908279419 |
| 160 多加一次基准脸 | 145.325012207 |
| 恒等表下用 gather 替代 scatter | 0，不能区分 |
| 恒等表下先加基准再重排 | 0，不能区分 |

零误差的替代处理明确标记为不能区分，不作为“顺序无所谓”的证据。
两张初始化后的原始基准表都读取和保存到了私有目录，没有公开其坐标值。

## 质量门槛与调用边界

探针显式开启基础阶段，分别切换优化标志，并关闭局部精修、增强跟踪和部分脸分支。
检测路径的逆变换显式设置为恒等，隔离脸块内输出；本轮不验证实际原图逆映射。
普通基础分支也使用显式裁剪输入，不是宿主自动旋转对齐后选出的脸块。

主要对照使用 **quality threshold=0**，目的是让所有算子控制输入都能执行。
有些输入质量值很低，不能宣称这些脸块通过了剪映宿主的质量筛选。
另对最后一组肖像设置 threshold=0.5，原始阶段返回失败；探针抛错，
不读取前一次的点缓存来冒充成功。这个控制只证明这组输入的原始质量门槛会生效。

原始解码会重用内部 Mat 存储。探针先复制阶段结果，再调用解码，避免后续读取重写
共享存储后把残差当成已叠加基准的输出。公开测试覆盖了这个所有权边界。

## 证据和复现

公开内容为自写桥接器、受限调用、诊断公式、合成测试和本文：

- `face_alignment_decode_bridge.mm`：读取实际张量，调用原始关键点 getter 并复制结果。
- `face_alignment_decode_native.py`：锁定运行对象布局、初始化表和显式 Stage1 配置。
- `face_alignment_decode_verify.py`：阶段对照、替代处理、哈希与灰度图。
- `face_alignment_decode_test.py`：26 个不需要厂商运行库的合成测试。

运行库/模型继续锁定为上轮的同一组 SHA-256，且校验实际加载的 Filter `libbytenn.dylib`。
版本锁定表见[上轮旋转链](face-alignment-warp-investigation-2026-10-02.zh-CN.md)。
调用点检查用于定位本轮函数；原始反汇编、桥接二进制、表和输出全部留在忽略目录。

最新私有证据：

- `.local/jianying-model-pytorch/face-alignment-decode-20261002-r4/summary.json`
- 同目录 `original-base.npy`、`original-tracking.npy`、`original-order.npy`。
- `case-022/stages.png`：120、1.5 倍裁剪、普通路径的肖像 Stage1 点对照。
- `case-028/stages.png`：160、1.5 倍裁剪、普通路径的肖像点对照。
- 同目录 32 个 `case-*` 保存原始实际输入、raw、解码、阶段点、诊断点和逐项报告。
- `r3` 与 `r4` 是不同进程的重复运行；较早 `r1/r2` 保留旧版报告字段，未覆盖。

从 `qcut/` 目录复现，输出必须是新的私有子目录：

```bash
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
env DYLD_LIBRARY_PATH="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks" \
  "$PY" research/local-model-pytorch/face_alignment_decode_verify.py \
  --out .local/jianying-model-pytorch/face-alignment-decode-fresh \
  --image output/beauty-kpop-v6-20261002/source/kpop-front-original.png

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test face_detector_test \
  face_alignment_input_test face_alignment_warp_test face_alignment_decode_test -v
```

跨平台合成 CI 已通过：[Espresso probe regressions / 37001478559](https://github.com/Quriosity-agent/qcut/actions/runs/37001478559)。
检查的代码/工作流 SHA 为 `52d115e723496f126f7fd62874137074a2964001`；后续两次提交仅为文档。
macOS 206 个全部通过；Windows/Linux 各运行 206 个，跳过既有的 10 个 macOS 专用测试，
其余通过；新增 26 个在三平台全部执行。原始 SDK 调用仍仅在本机锁定的 macOS arm64
版本验证，不能把三平台合成 CI 绿色当作三平台原始模型或产品运行通过。

## 下一段仍需查

后续进展见[基础跟踪、刷新门控与原图逆映射](face-alignment-tracking-investigation-2026-10-02.zh-CN.md)：
普通路径的全 106 点拟合契约、基础目标表缩放和缓存刷新已有调用点及原函数控制证据；
受控 160 检测 → 120 对齐 → 原图点串接已对照。完整宿主时序滤波、动态路由与质量接受
仍未完成，下面的宿主级问题不能仅凭受控算子通过就关闭。

1. 实际宿主的平均脸选取、参与拟合的点集、自动角度，以及 120 标准对齐脸块的产生。
2. 将这一轮的原始解码接到宿主实际逆矩阵，比较最终原图坐标。
3. 增强跟踪、部分脸、Stage2/眼睛/虹膜和连续视频状态。

通用 warp 插值公式、历史原始渲染帧的自动路径、检测器同分排序压力边界和最终
五官/皮肤/美妆导出对拍也未在这一段解决。独立模型权重、跨平台产品后端是后续工作；
本轮诊断公式不构成完整自主模型或自主美颜实现。
