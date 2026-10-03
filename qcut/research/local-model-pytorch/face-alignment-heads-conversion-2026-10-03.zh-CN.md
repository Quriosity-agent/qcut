# 120/160 关键点子网：完整 Stage1 浮点头转换

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
本轮接续[整数骨干转换](face-alignment-backbone-conversion-2026-10-02.zh-CN.md)，先解决浮点头卡点，没有推进 CI 或替换编辑器后端。

## 结论与边界

两个 Stage1 子网现在可以用自写 PyTorch 和标准 ONNX **完整推理**：

```text
记录的原始准备脸块
  -> 72 个整数算子 / 87 个整数 blob
  -> 全局平均池化与 reshape
  -> landmark / visibility / classification / yaw / pitch
  -> 私有参考 mean/order 解码 106 点
  -> 用记录的原始 inverse 矩阵回映射到原图
```

推理代码不调用厂商运行库。原始 CPU oracle 仅提供验收参考，另外核对其输出与原始 Filter SDK 的记录。
ONNX 可以在没有安装或导入 PyTorch 的环境中运行，不需要剪映主程序。

**仍未独立完成整帧到稳定关键点的链条**：脸块、mean/order、inverse 来自已锁定哈希的原始记录；
本轮没有重新实现宿主裁剪/旋转/warp、完整时序跟踪、质量接纳或 Stage2/虹膜。
也没有把这些结果注入现有原生美颜渲染。权重仍来自私有参考模型，执行器独立不代表权重可分发。

## 完整模型接口

| 子网 | 原始输入 NHWC | 整数终点 | 完整输出 |
| --- | --- | --- | --- |
| 120 | `1×120×120×3`，int16，fraction=6 | `1×4×4×128`，int16，fraction=7 | 212 坐标值、106 可见性、3 分类概率、yaw、pitch |
| 160 | `1×160×160×3`，int8，fraction=6 | `1×5×5×128`，int8，fraction=2 | 212 坐标值、106 可见性、5 分类概率、yaw、pitch |

浮点尾部恰为 9 个算子：PoolingDown、OnnxOp1、5 个 InnerProduct、Sigmoid、Softmax。
完整图执行 81 个非输入算子，产生 96 个非输入 blob，5 个终点均已保存和重载验收。
分类、yaw/pitch 的数值输出对齐，不在本轮推断全部分类标签或角度单位的业务语义。

`EspressoAlignmentGraph` 与原有整数执行器分开。整数执行器默认仍拒绝不支持的浮点图；
不会因为新增转换器而静默截断。共享导出器显式注入 loader 与浮点比较器，整数路径仍逐值比较。
图的输入、输出、连接顺序、存储类型、全部 arena 长度和非有限 dense 权重均有守卫。

## 发现并修复的误差

### 池化倒数

原 160 子网的 5×5 池化先累加整数，再转 float32，乘以预先舍入的 float32 倒数。
直接做 `/25/4` 或 `/100` 与乘 `float32(1/100)` 不同，实测最大差 `2.384185791015625e-7`。
现在保留倒数乘法；两个子网的 pooling 和 reshape 在全部输入上均逐值一致。

### ONNX 可见性的小概率

最初直接导出 `torch.sigmoid`。真人参考输入通过，但扩大到随机与黑/灰/白输入后，
ORT 的 Sigmoid 在非常小的概率上出现约 `1e-7` 绝对差，部分相对差超过 400%。
仅用绝对容差会漏过这个问题，不能因此宣称可见性输出正确。

改为数值稳定且可移植的标准算子组合：

```text
e = exp(-abs(x))
x >= 0: 1 / (1 + e)
x < 0:  e / (1 + e)
```

保留原门槛，没有放宽相对概率限制。另有 `-80..80` logits 的合成 ONNX 回归，验证小概率不消失。
分类 Softmax 是单空间像素，使用减最大值后的 exp 和真正的除法；不能套用其他网络四像素 SIMD 的倒数近似。

### Dense 累加

PyTorch/ORT 的 float32 矩阵累加与原实现不是全部逐位相同。对原输入单独隔离 dense，再检查整网输出，
将浮点容差通过与整数逐值相同分开记录。没有把浮点误差说成零，也没有将整数 Conv 改为近似浮点 Conv。

## 固定验收门槛

| 算子 | 绝对容差 | 相对容差 | 额外限制 |
| --- | --- | --- | --- |
| PoolingDown / OnnxOp1 | 0 | 0 | 逐值相同 |
| InnerProduct | `1e-4` | `1e-5` | 全部有限 float32 |
| Sigmoid / Softmax | `1e-6` | `1e-5` | 最大相对误差不得超过 `1e-3` |

相对误差分母为 `max(abs(reference), 1e-30)`；不能以大的 epsilon 隐藏微小概率错误。
全部 96 个 blob 的 PyTorch、diagnostic ONNX 检查，以及全部 5 个终点的 `.pt2`/ONNX 重载检查都必须存在并通过。
报告里的 shape 元素数、精确标志、有限误差、预定容差与终点集合也单独核对，缺项不能算成功。

每个子网 7 组输入：seed 17/41/509、黑 -128、中性 0、白 127，以及记录的普通 1.5 倍裁剪脸块。
两份真人参考来自同一张已有生成肖像的不同准备路径，不是多个真人或实际女团成员；
参考仍是 `quality threshold=0` 的受控链，不能证明生产宿主会接纳它。

## 数值与可视化结果

下面是固定 ORT 1.22.1 环境中，对全部 14 组输入、全部验收 provider 取最大值：

| 输出 | 120 最大绝对差 | 160 最大绝对差 |
| --- | --- | --- |
| pool / reshape | 0 | 0 |
| landmark raw | `1.33514404296875e-5` | `4.57763671875e-5` |
| visibility logits | `1.52587890625e-5` | `7.62939453125e-6` |
| visibility | `1.7881393432617188e-7` | `8.344650268554688e-7` |
| classification logits | `5.7220458984375e-6` | `5.7220458984375e-6` |
| classification probability | `5.122274160385132e-9` | `1.1920928955078125e-7` |
| yaw | `6.67572021484375e-6` | `1.2874603271484375e-5` |
| pitch | `5.7220458984375e-6` | `1.049041748046875e-5` |

真人记录的 106 点：PyTorch 在 120/160 脸块上的最大差分别为 `7.62939453125e-6`、`1.52587890625e-5` 像素；
ONNX 的两个脸块 Stage1 坐标恰好逐值一致。各自回映射到原图后的最大差均为 `6.103515625e-5` 像素。
预定门槛为脸块 `1e-4`、原图 `0.002` 像素；回映射仍使用原始 inverse，不是独立 warp 验收。

每轮包含 14×96 个中间输出对拍、14×5 个终点重载，两类 provider 共 2,828 次比较；
其中终点重复计数，不应当作 2,828 个不同张量或不同输入。
两个固定环境的新进程均正常退出，232 份输入/终点/坐标 `.npy` 哈希一致。
无 Torch 环境单独验证每组 96 个中间输出与 5 个终点，共 1,414 项，全部通过。

对照图含准备脸块、原始 SDK / 自写 PyTorch / ONNX 的 106 点、统一 x8 的灰度绝对差。
两张图已打开检查，点位重合、灰度差分全黑；这只是点位叠加栅格的差分，**不是最终美颜画面的差分**。

## 退出异常与环境隔离

初次 smoke 虽数值通过，退出时出现 recursive_mutex 异常；后续组合回归也出现退出码 139。
macOS 崩溃报告均定位到 `onnxruntime_pybind11_state.so` 中 Microsoft Events SDK 的后台上传/遥测线程。
只关闭 telemetry events **不足以解决 1.30.0 的退出竞态**，没有用 `os._exit`、忽略退出码或只选成功重跑掩盖它。

因此本段单独固定 CPU 验收环境为 ORT 1.22.1，原 1.30.0 环境不修改：

- 完整环境：Python 3.12.12、Torch 2.10.0、ONNX 1.23.0、NumPy 2.5.3、Pillow 12.3.0、ORT 1.22.1。
- 运行环境：Python 3.12.12、NumPy 2.5.3、ORT 1.22.1，无 Torch。
- 相关回归 309 个，其中新增 36 个；固定环境两次全部通过、无跳过、退出码 0。
- 完整真实模型两次通过且退出码 0。旧环境 ORT 1.30.0 的数值检查也通过，但不作为稳定退出的依据。
- 没有宣称修复 ORT 1.30.0 本身；还保留 legacy ONNX 导出、Slice 常量折叠和 `.pt2` buffer 的既有警告。
- 本轮不改 CI、全局依赖或 QCut 产品运行环境，也未实测 Windows/Linux 的私有模型。

## 私有证据与复现

私有根目录均位于 `.local/jianying-model-pytorch/`，以下资源不加入 Git：

- `face-head-probe-20261002-r1/`：浮点池化、dense、激活的原输出隔离。
- `face-head-smoke-20261002-r1/`：数值通过但退出异常的初测。
- `face-heads-20261002-r1/`：扩大输入后暴露 Sigmoid 相对误差的失败证据。
- `face-heads-20261002-r2..r5/`：修正数值后的旧 ORT 环境对拍。
- `face-heads-20261003-stable-r1/`、`stable-r2/`：固定 ORT 1.22.1 完整验收。
- `stable-r2/summary.json`：全部模型、参考数据、导出文件的哈希与检查结果。
- `stable-r2/standalone-onnx.json`：无 Torch 1,414 项独立推理检查。
- `stable-r2/align-{120,160}/artifacts/`：`model.pt2`、`model.onnx`、`all-layers.onnx`。
- `stable-r2/align-{120,160}/recorded-face/points.png`：点位/灰度对照。

逐 blob oracle 与实际 Filter SDK 的 ByteNN 仍为不同文件，哈希和版本边界沿用骨干文档。
验收前核对 recovered manifest、graph/arena、原始 SDK 参考、mean、order、inverse 的哈希与类型；
不覆盖旧证据。仓库只有实现、合成测试、探针、依赖配置与文档，不提交厂商密钥、权重、图文本、表或肖像。

从 `qcut/` 运行，需要本机既有私有模型和原始参考：

```bash
uv venv .local/jianying-model-pytorch/face-heads-export122 --python 3.12
uv pip install --python .local/jianying-model-pytorch/face-heads-export122/bin/python \
  -r research/local-model-pytorch/requirements-alignment-export.txt

.local/jianying-model-pytorch/face-heads-export122/bin/python \
  research/local-model-pytorch/face_alignment_heads_verify.py \
  --networks .local/jianying-model-pytorch/face-capture-20260920/collected \
  --reference .local/jianying-model-pytorch/face-alignment-tracking-20261002-r4 \
  --decode-reference .local/jianying-model-pytorch/face-alignment-decode-20261002-r4 \
  --out .local/jianying-model-pytorch/face-heads-fresh

uv venv .local/jianying-model-pytorch/face-heads-runtime122 --python 3.12
uv pip install --python .local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  -r research/local-model-pytorch/requirements-alignment-runtime.txt

.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_alignment_heads_onnx_verify.py \
  --root .local/jianying-model-pytorch/face-heads-fresh \
  --networks .local/jianying-model-pytorch/face-capture-20260920/collected \
  --out .local/jianying-model-pytorch/face-heads-fresh/standalone-onnx.json
```

本地相关回归：从 `research/local-model-pytorch/` 调用固定完整环境的 Python：

```bash
../../.local/jianying-model-pytorch/face-heads-export122/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test espresso_integer_shuffle_test \
  face_geometry_test face_detector_test face_alignment_input_test face_alignment_warp_test \
  face_alignment_decode_test face_alignment_tracking_test face_alignment_backbone_test \
  face_alignment_heads_test face_alignment_heads_reference_test face_alignment_heads_onnx_test
```

## 下一卡点

后续 [外部 owned replay 和真实宿主输入验收](face-onnx-owned-replay-2026-10-03.zh-CN.md)
已证明外部点位实际被渲染消费；同值像素完全一致，实际美颜宿主输入的 105 项 ONNX 头部对拍通过。
但旧参考 inverse/脸块的点位仍与宿主最终点位不同，候选画面未达标；原生分析和产品后端未替换。
本页下面的独立整帧验收要求仍然保留，不能以网络对拍代替几何/跟踪和产品效果验证。

第一卡点的**完整 Stage1 网络浮点头**已通过本轮范围内验收；不是整套美颜脱离二进制。
下一段先确认原生渲染能否接纳外部人脸分析结果，再设计注入探针。不能只给 IPC 加 points 字段就宣布接上。

验收必须证明：原生默认结果与同值外部结果画面相同；受控改变点位时画面改变；禁用内部检测后仍能工作；
无脸、多脸、尺寸/旋转、时间戳和结果生命周期有明确处理；预览与导出消费同一份结果。
若宿主没有可靠注入入口，应明确保留内部分析，或另走 QCut 自写形变渲染，不能混称独立后端。
