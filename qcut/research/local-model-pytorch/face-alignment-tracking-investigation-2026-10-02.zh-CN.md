# 原始基础跟踪：106 点拟合、缓存刷新与原图逆映射

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮进展

沿着[上轮 Stage1 解码](face-alignment-decode-investigation-2026-10-02.zh-CN.md)往外走，
继续研究原始实现，没有替换 QCut 编辑器后端或宣布独立模型完成。

- 原始刷新判断：**36 个独立控制 + 10 步连续位移**与诊断公式一致。
- **6 个检测种子 + 12 个基础对齐步骤**完成原图坐标回映射的算子对照。
- 两个新进程重复，**156 份数组文件哈希一致**；刷新判断报告也完全一致。
- 新增 **25 个**不需要厂商运行库的合成测试，本地相关回归合计 **231 个通过**。
- 已保存生成肖像原图、原始 120 对齐脸块、SDK 回映射点、诊断点和统一 x8 灰度差分。

本轮解决的是基础路径的一个可复现片段，不是完整剪映宿主跟踪，不是最终美颜效果对齐。

## 证据分层

| 问题 | 证据 | 边界 |
| --- | --- | --- |
| 普通跟踪外层传哪些刷新点、阈值 | 锁定版本 `FaceAlignmentTracking` 调用点检查 | 本轮没有直接执行完整外层入口 |
| 四点如何生成两个锚点、何时刷新 | 原始 `getAlignAnchor` / `checkNeedTransform` 运行 | 合成输入隔离判断，未经过宿主时序滤波 |
| 拟合使用多少点 | 外层构造全部 106 点；运行拟合并核对缓存副本，非锚点扰动对照 | 不是仅用四个锚点拟合 |
| 基础目标平均脸及其单位 | 外层读取 base 表并按 256 单位缩放；运行时读取初始化表 | 目标数组按调用点契约重建，未截获完整宿主入口生成的数组 |
| 原图 → 160 检测 → 120 对齐 → 回原图 | 原始裁剪、Stage1、NewAlign、warp 和逆映射算子串接 | 显式配置、关闭精修、质量阈值 0，强制拟合各步骤 |
| 完整自动跟踪和美颜导出 | **未完成** | 不能用上述算子通过替代产品验收 |

这里只记录自写探针与行为说明。厂商表、二进制、反汇编、原始输出和对照帧留在忽略目录。
运行库、模型和实际加载的 ByteNN 使用[旋转链文档](face-alignment-warp-investigation-2026-10-02.zh-CN.md)
中的同一组 SHA-256 锁定。

## 四个点是刷新门控，不是拟合点集

普通基础跟踪的调用点传入零起始编号 `55, 58, 84, 90` 和 float32 阈值 `0.1`。
本轮不靠点编号推断解剖部位；原始函数实际生成两个中点：

```text
A = (P55 + P58) / 2
B = (P84 + P90) / 2
```

再与**上次成功拟合时**缓存的点集所产生的 `A0, B0` 比较：

```text
movement  = distance(A, A0) / 2 + distance(B, B0) / 2
reference = distance(A0, B0) / 2
ratio     = movement / reference

尚未拟合                    → 需要刷新
reference <= 1e-6            → 需要刷新
ratio < float32(0.1)         → 复用缓存
ratio >= float32(0.1)        → 需要刷新
```

这里的 `0.1` 是归一化位移，不是旋转角度或弧度上限。中点、平方、加法、平方根、
除法保留逐步 float32 舍入；reference 的保护比较将其转为 double。
原始函数对点数不是 106 的输入也要求刷新，但探针在调用前拒绝该输入，不把它当成
可继续安全访问四个点的产品契约。

刷新判断本身**不更新缓存**。只有实际 `computeTransform` 才复制参与拟合的点并设置
已拟合状态。小位移不是逐帧清零，而是相对于最后一次拟合积累。

### 实测控制

- 自建两个中点相距 100 像素时，整脸纵向移动 5 像素恰好触发刷新。
- 5 的下一个较小 float32 不刷新，5 和下一个较大 float32 刷新；不是容差猜测。
- 位移序列 1..10 中，仅第 5、10 步刷新。判断前后原始点缓存精确不变。
- 仅改变非锚点，门控可以不刷新；但强制重新做全部 106 点拟合时矩阵会变化。
- 同一对点等量反向移动，中点保持不变，门控可不刷新。
- 负位移、旋转、单点移动和近零参考间距均与原始判断一致。

最后两项说明刷新门控是一种节制重新拟合的策略，不是所有面部形变的检测器。
不能把“门控没刷新”理解成“所有 106 点都没有变”。

## 普通外层实际顺序

锁定版本的非增强、非部分脸普通路径可概括为：

```text
前次原图坐标点
  → 原始时序滤波器提供当前点
  → 全部 106 点构成 source
  → base_reference / 256 * (120, 120) 构成 target
  → 四点中点的缓存刷新门控
      刷新：setMeanFace(target) + computeTransform(source)
      不刷新：复用已缓存的正/逆矩阵
  → 原始 ProcessWarpImage 得到 120 × 120 BGR 脸块
  → 原始基础 Stage1 网络
  → residual + base_reference / 256 * (120, 120)
  → 原始 NewAlign 逆矩阵映射回原图
  → 输出及下一次跟踪状态
```

**这不是“旋转拟合 vs 矩形锚点”的二选一路径**，该门控的 False 分支是复用缓存矩阵。
外层还有增强、部分脸、旧矩阵初始化和姿态/方向处理分支，不包含在这个摘要中。
时序滤波器的实际输出没有在本轮截获，其算法也尚未复现。

## 受控串接：逐步检查误差

素材是已有生成肖像 `output/beauty-kpop-v6-20261002/source/kpop-front-original.png`，
不是实际女团成员。本轮先调用原始检测器得到一个人脸框，分别用 1.2/1.5/1.8 倍裁剪，
普通/优化 Stage1 各一次，得到 6 个 160 检测种子。通过原始 resize 逆矩阵映射回原图。

每个种子强制用原始 NewAlign 将全部 106 点拟合到基础 120 目标表，调用原始 warp、
原始 Stage1 和原始逆点映射；结果作为下一步 source，再执行一次，合计 12 步。
这里两步是**同一张图上的受控反馈**，不是连续视频，也不模拟宿主自动决定是否刷新。
普通/优化标志只切换已验证的 Stage1 路径，不能证明 `FaceAlignmentTrackingOpt` 外层一致。

| 对照 | 12 步最大绝对误差 | 验收方式 |
| --- | ---: | --- |
| BGR 减 128 与实际网络输入 | 0 | 精确 |
| raw 读取/重排、基准叠加 | 0 | 精确 |
| 重复脸块、输入、raw、Stage1 和缓存副本 | 0 | 精确 |
| 原始拟合矩阵 vs double 累积诊断拟合 | 0.000053405762 | 预设阈值 0.001 |
| 原始逆点映射 vs 诊断映射 | 0.000061035156 | 预设阈值 0.002 原图像素 |
| 映射回原图再正向映射 | 0.000015258789 | 预设阈值 0.002 脸块像素 |

6 个检测种子的 resize 回映射最大误差也是 0.000061035156 原图像素。
浮点拟合和逆映射**并非逐位相同**。缩略图点叠加 x8 灰度差分全黑只是视觉检查，
不能把它写成点坐标或最终美颜像素精确一致。

错误对照：漏加基准脸，直接把 120 raw 残差套逆矩阵，12 步中最大误差为
**689.0285263061523 原图像素**。逆矩阵没有坏，是输入点的单位/基准不对。

### 质量边界

全部受控推理仍使用 `quality threshold=0`，并关闭 Stage2/局部精修及增强/部分脸。
12 步返回的质量字段约为 `2.19e-15 .. 8.61e-13`，很低；本轮没有证明这些输入通过
剪映实际宿主门槛，也没有重新解释质量字段的语义。不得用“106 点看起来合理”代替该验证。

## 代码与复现

- `face_alignment_warp_native.py`：增加受限原始锚点、刷新门控和已拟合缓存副本读取。
- `face_alignment_tracking_verify.py`：诊断公式、原函数控制、受控串接与私有灰度图。
- `face_alignment_tracking_test.py`：25 个合成回归，覆盖阈值两侧、相等边界、零间距、
  缓存不变、输入拒绝、资源生命周期、数组所有权、逆映射顺序和验收字段完整性。
- `.github/workflows/espresso-probes.yml`：加入已有三平台合成回归作业。

原始 fitted cache 的 inline 容量在构造时与拟合后可不同。探针验证 inline 所有权、
106 点数、212..264 范围和已拟合标志，再复制数据；没有把借用指针交给调用方。
非法指针、点数、非有限值、已关闭对象和已释放 owner 都在公开测试中覆盖。

从 `qcut/` 运行，输出必须是新的私有目录：

```bash
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
env DYLD_LIBRARY_PATH="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks" \
  "$PY" research/local-model-pytorch/face_alignment_tracking_verify.py \
  --out .local/jianying-model-pytorch/face-alignment-tracking-fresh \
  --image output/beauty-kpop-v6-20261002/source/kpop-front-original.png

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test face_detector_test \
  face_alignment_input_test face_alignment_warp_test face_alignment_decode_test \
  face_alignment_tracking_test
```

有效重复证据在 `.local/jianying-model-pytorch/face-alignment-tracking-20261002-r3/` 和 `r4/`。
其中 `summary.json` 汇总所有控制；`seed-000..005/` 保存检测输入、raw、点和逆矩阵；
`case-000..011/` 保存 source、target、正逆矩阵、脸块、实际输入/raw、Stage1、原图点和诊断点。
`r4/case-004/stages.png` 是 1.5 倍种子的第一个普通基础步骤对照图。
`r1` 因缓存容量守卫过严而中止，保留现场；`r2` 是增加种子证据之前的成功探针，
不替代最终 `r3/r4`。旧目录没有覆盖。

跨平台合成 CI 已通过：[Espresso probe regressions / 37007226051](https://github.com/Quriosity-agent/qcut/actions/runs/37007226051)。
验证的代码/工作流 SHA 为 `a0be7373d2ef561bdfcd62aa2b15c11890171204`；后续提交仅为文档。
macOS 231 个全部通过；Windows/Linux 各运行 231 个、跳过既有 10 个 macOS 专用测试，
其余通过。新增 25 个在三平台均执行。原始 SDK 仍只在本机锁定的 macOS arm64 版本运行，
合成 CI 不证明 Windows/Linux 已能运行原始模型或编辑器完整美颜链。

## 下一段边界

后续已完成[120/160 整数骨干的独立 PyTorch/ONNX 转换](face-alignment-backbone-conversion-2026-10-02.zh-CN.md)，
逐层对拍通过；浮点关键点/质量头、完整跟踪及编辑器后端仍未替换。本页保留原始算子调查的证据边界。

1. 截获完整普通跟踪入口的时序滤波后 source、实际 target、缓存命中和失败恢复，
   对比本轮受控算子链。安全处理原始输出容器所有权后再调用，不能猜布局硬调。
2. 查清宿主质量筛选和真实视频状态，分别测试旋转、遮挡、多脸、帧间丢失与恢复。
3. 再推进增强/部分脸、Stage2/眼睛/虹膜，逐阶段隔离误差。

通用 warp 插值公式、非恒等原始重排表、历史宿主帧重建、检测同分排序压力边界和
最终五官/皮肤/美妆导出对拍仍未解决。独立权重、ONNX/PyTorch 产品后端和无厂商运行库
的完整美颜实现仍是后续工作；本文不把原函数探针算作自主实现。
