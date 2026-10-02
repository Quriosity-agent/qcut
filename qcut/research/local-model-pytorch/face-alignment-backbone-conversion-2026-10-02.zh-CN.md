# 120/160 关键点子网：独立整数骨干转换

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮完成什么

沿着[原始基础跟踪调查](face-alignment-tracking-investigation-2026-10-02.zh-CN.md)，
将两个关键点子网的**整数骨干**转换为自写 PyTorch 算子及标准 ONNX。
推理结果不调用厂商运行库；原始 CPU 运行库只在验收时提供参考。

不是完整关键点网络、独立美颜引擎或编辑器接入。本轮没有改动 QCut UI、预览或导出后端。
权重仍来自本机私有参考模型；执行代码独立不等于权重可自行发布。

| 子网 | 输入 NHWC | 独立骨干输出 NHWC | 输出存储描述 |
| --- | --- | --- | --- |
| 基础 120 | `1×120×120×3`，int16，fraction=6 | `1×4×4×128` | int16，fraction=7 |
| 检测种子 160 | `1×160×160×3`，int8，fraction=6 | `1×5×5×128` | int8，fraction=2 |

PyTorch/ONNX 用 int64 承载固定点整数，不把原始定点数据直接改成浮点 Conv。
原始存储宽度、fraction、32 位累积回绕、移位舍入和饱和语义由自写算子保留。
这里的输出是特征张量，**不是 106 点坐标**。

两个原始图各有 81 个非输入算子。本轮执行前 72 个，产生 87 个整数 blob。
这个数量不是整套美颜的完成百分比；最后少量浮点算子决定关键点与质量输出，仍需单独验收。

## 原实现中必须保留的行为

现有独立卷积、深度卷积、Slice 和 Concat 执行器可以复用；本轮缺口是每个子网中的
14 个 `ShuffleNet` 和 1 个 `Shuffle`。

1. 通道重排不是普通的逐通道交替。它按 lane 分块，在 group 维与块维之间转置；
   例如两个 group、4 lane 的 16 通道输入，会成为 `0..3, 8..11, 4..7, 12..15`。
2. `ShuffleNet` 先合并源张量，再按相同顺序移动源 fraction 标签，分成两份输出。
   每个输出通道必须按照它的来源 fraction 重量化，不能给整份输入套同一个移位。
3. 原 int8 分支双侧饱和；已测 int16 分支按 lane **只限一侧**，交替执行上限 2047
   或下限 -2047。直接换成对称 `clamp(-2047, 2047)` 会改变行为。

合成测试覆盖非连续内存、不同源通道数、多个源、fraction 差异、负值、饱和、分组变化，
以及导出后输入变化。真实子网的所有中间张量另与原始 CPU 输出对拍，避免只验证最终值。
本轮不宣称遍历全部整数载体极值与任意 fraction 组合，也不宣称其他厂商版本语义相同。

## 显式停在浮点边界

`EspressoIntegerGraph` 新增可选 `prefix_output`，但默认仍执行完整图，碰到不支持的
浮点层就拒绝，不能静默截断后宣布完整网络通过。

本轮显式选择 `backbone.stack2.6.shuffle_channels`，截断在首次产生 float32 输出的
全局平均 `PoolingDown` 之前。后面的池化、reshape、5 个 InnerProduct、Sigmoid、
Softmax 共 9 个算子全部未转换。

- 截断前仍解析完整原图，验证全部 arena 字节数与 stamp；不是拿删减图绕过完整性检查。
- `execution_layers` 与原始 `graph` 分开保留，验收只列实际执行的整数 blob。
- 默认导出只有显式 prefix，不把未执行的关键点头或旁支标成已导出结果。
- 不允许请求 prefix 之后的输出，也不跳过 prefix 之前的不支持算子。
- ONNX opset 18，所有节点仅使用标准域；没有自定义 native 算子或 Python 回调。

## 逐阶段对拍结果

每个子网使用 7 组输入：随机 seed 17/41/509、全黑 -128、中性 0、全白 127，
以及上一轮原始 SDK 产生的普通 1.5 倍裁剪脸块。120 来自 `case-004`，160 来自 `seed-002`。
肖像沿用已有生成素材，不是实际女团成员。

验收读取原始参考报告，核对运行库/模型/实际加载 ByteNN 的 SHA-256，唯一选择普通路径，
核对三份数组哈希、shape、dtype，再确认 `prepared BGR - 128` 等于记录的网络输入。
原始参考依然是 `quality threshold=0` 的受控链，不证明剪映宿主实际接纳该脸。

| 验收层次 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 原始 CPU vs 自写 PyTorch 中间张量 | 14×87 = 1,218 个 blob 全部逐值相同 | 本轮整数骨干 |
| 原始 CPU vs diagnostic ONNX 中间张量 | 同样 1,218 个全部相同 | 标准 ONNX 算子重现同一整数行为 |
| `.pt2` 重载、终点 ONNX | 14 组终点各自相同 | 文件可以重载，不是只在导出输入上正确 |
| 两个新进程重复 | 56 份 `.npy` 文件哈希一致；1,218 份 blob 检查结果一致 | 输入/终点与验收结果可重复 |
| 无 Torch 环境单独运行 ONNX | 14 组通过，每组 87 个中间输出及 1 个终点 | macOS arm64 无 Torch 推理 |
| 原始 CPU 完整关键点头 vs 原始 Filter SDK 记录 | 120/160 最大绝对差都是 0 | 参考链身份核对，不是独立头验收 |

每轮共 2,464 次精确检查、11,490,752 个元素比较；包括终点重复计数，不能说成同样数量
的独立张量。2 次进程运行也不能算作 28 个不同输入。

独立 ONNX 环境为 Python 3.12.12、NumPy 2.5.3、ORT 1.30.0，没有安装或导入 Torch，
也没有加载原始二进制。导出环境为 Torch 2.10.0、ONNX 1.23.0、ORT 1.30.0。
本轮没有测 GPU、编辑器帧率、持续视频吞吐或私有模型在 Windows/Linux 的实际执行。

### 灰度对照

每个子网保留原始 SDK 的准备脸块、原始/自写 PyTorch/ONNX 特征，以及统一 x8 的绝对差。
图展示 128 个通道中的 8 个，所有 87 个 blob 的完整值另外数值验收。
两张图已打开检查，灰度差分全黑；这不是原图与最终美颜画面的像素差分。
160 输出值动态范围较小，按统一 -2047..2047 映射看起来接近均匀灰，不是空输出的证明。

私有证据根目录（从 `qcut/` 起）：

- `.local/jianying-model-pytorch/face-backbone-20261002-r1/`：首次完整对拍。
- `.local/jianying-model-pytorch/face-backbone-20261002-r2/`：加强证据守卫后的重复运行。
- `r2/summary.json`：原图/arena/参考输入/导出文件哈希及完整检查。
- `r2/standalone-onnx-report.json`：无 Torch 独立进程的 ONNX 验收。
- `r2/align-{120,160}/artifacts/`：`model.pt2`、`model.onnx`、`all-layers.onnx`。
- `r2/align-{120,160}/recorded-face/features.png`：脸块、特征及灰度差分。

没有覆盖旧证据目录。厂商图文本、权重、二进制、原始输入/输出及肖像对照图没有加入 Git。

## 版本锁定

逐层参考使用 ShotSplit 私有运行库里的 CPU ByteNN：
`1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`。
它与上一轮实际 Filter SDK 加载的 ByteNN 是**两个不同文件**，不能混称同一个 runtime。
后一组 `liblens`、模型、实际加载 ByteNN 的哈希沿用
[旋转/warp 调查](face-alignment-warp-investigation-2026-10-02.zh-CN.md)，并由参考加载守卫检查。

| 文件 | SHA-256 |
| --- | --- |
| 120 原图文本 | `2b13415220a208e74039fd91f69e8f5ad3bc4465701142dab97e60ec0a968f0d` |
| 120 原始 arena | `66a4bafd7a47db5c0bb139088f9d9256b3fad4c6cd63875fe391419b0ccb826e` |
| 160 原图文本 | `af10da6a6a3762709be213b7b795b4acb665841a15d248c745f47f995d319d73` |
| 160 原始 arena | `1b4f6900f3d72b6ee5ada5beadd5179e6ddc82b2f7b2ceb1519ca468baca2f03` |
| 120 终点 ONNX，r2 | `fec16cb6747e6325129c181082379aac54a73f5af149a219e2c2b5d2e71a7cec` |
| 160 终点 ONNX，r2 | `609cd5c58d3bdd5329749f3c377b241b00f5602b32cdb9bb3623ae1970095707` |

完整导出文件哈希留在私有 summary；`.pt2` 档案逐次字节相同不是本轮验收要求。

## 代码与复现

- `espresso_integer_torch.py`：自写重排、分通道定点缩放与显式 prefix。
- `espresso_integer_export.py`：共享导出/逐 blob 验收支持 prefix，原检测器默认行为保留。
- `espresso_integer_shuffle_test.py`：18 个合成测试，含实际 ONNX、`.pt2` 重载与变化输入。
- `face_alignment_backbone_verify.py`：本段子网、原始参考与私有对照图验收。
- `face_alignment_backbone_test.py`：24 个合成守卫测试，覆盖伪真值、缺失检查、歧义参考、
  哈希损坏、输入类型/shape/预处理错误、浮点边界及禁止覆盖证据。
- `.github/workflows/espresso-probes.yml`：纳入三平台回归。

从 `qcut/` 运行；网络/运行库/上一轮参考必须已经在本机私有目录存在：

```bash
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
"$PY" research/local-model-pytorch/face_alignment_backbone_verify.py \
  --networks .local/jianying-model-pytorch/face-capture-20260920/collected \
  --reference .local/jianying-model-pytorch/face-alignment-tracking-20261002-r4 \
  --out .local/jianying-model-pytorch/face-backbone-fresh

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test espresso_integer_shuffle_test \
  face_geometry_test face_detector_test face_alignment_input_test face_alignment_warp_test \
  face_alignment_decode_test face_alignment_tracking_test face_alignment_backbone_test
```

本地相关回归 **273 个通过，无跳过**，其中本轮新增 42 个。
三平台合成 CI 的代码 SHA 为 `e62b3c6ea62ed983217346efdb83c7578f45bf10`；
[运行 37011176200](https://github.com/Quriosity-agent/qcut/actions/runs/37011176200) **三个作业全部通过**。
macOS 273 个全部通过；Windows/Linux 各运行 273 个、跳过既有 10 个 macOS 专用测试，
其余通过。本轮新增 42 个三平台均执行。该 SHA 之后本轮提交仅为两份文档。
公开 CI 只测自造图和证据守卫，不上传或执行这两份私有原始模型。

## 下一步与大蓝图边界

下一段先单独隔离整数特征 → 原始全局平均池化 → 浮点 dense，再逐头对比 landmark、
visibility、质量/姿态输出；不直接用普通 float Linear 宣布过关。各步仍需保存输入、原始、
独立输出与差分，定位累积顺序、定点到浮点换算、FMA/舍入或激活的差异。

完成浮点头后，才把独立检测和 120/160 对齐串成**帧 → 106 点**实验后端；仍需处理：

1. 独立检测的两个同分排序压力样例、误检边界。
2. 裁剪/warp 插值、完整跟踪入口真实输入、质量门槛、时序稳定和丢失恢复。
3. 增强/部分脸、Stage2、眼睛/虹膜等精修路径。
4. QCut 后端选择、缓存/调度、预览与导出一致、Windows/x86 和 Linux 实际模型验收。
5. 再做独立几何形变、皮肤和美妆渲染。关键点正确不等于大眼、鼻子、下颌骨或美妆像素一致。
6. 可分发权重和效果素材来源。转换格式不会改变原资源的权属与许可。

本轮没有关闭上述缺口，也没有修改现有原生美颜后端。推进的是**可独立执行且已逐层验证的
模型片段**，不是用原函数探针替代自主实现。
