# 人脸模型逐步转换：第一步整数检测器

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮完成什么

从已经恢复的 `tt_fsnew_base_jianying` 中选取 `detector-320-D-int8` 子网，转换为真正的 PyTorch 整数模块、
可重新加载的 `.pt2` 文件，以及只使用标准 ONNX 算子的 `.onnx` 文件。

这不是把 NumPy 解释器包进 PyTorch，也不是把整数网络近似替换成浮点网络。
权重解码阶段复用现有解析器；导出后的网络执行整数张量计算，不调用剪映 `.dylib`。
原生库只在验收时作为独立对照。

| 项目 | 已验证结果 |
| --- | --- |
| 网络结构 | 109 层，112 个非输入输出张量；最后有 6 个检测头 |
| 静态输入 profile | NHWC `1×320×320×3` 和 `1×320×576×3`，载体 dtype 为 int64，内容是原始 int8 值 |
| 合成输入 | 随机种子 17、41、509；320×320 |
| 真实输入 | 既有无头宿主的一次渲染捕获；320×576；不是本轮新运行剪映 GUI |
| 逐层对拍 | 4 组 × 112 张量，PyTorch、诊断 ONNX 全部逐位一致，最大整数差 0 |
| 文件重载 | 两个 profile 的 `.pt2` 重新加载后，6 个输出头逐位一致 |
| 终端 ONNX | 两个 profile 的 `model.onnx`，6 个输出头逐位一致 |
| 真实前处理 | 原 1280×720 RGBA 帧重新生成模型输入，552,960 个通道元素完全一致 |
| 原始渲染输出 | 新运行的原生 oracle 与历史真实渲染捕获的 6 个输出头逐位一致 |
| 无 PyTorch 运行 | 使用既有无 Torch 的隔离 Python 环境加载 ONNX，6 个头共 18,900 元素，差异 0 |
| 可见证据 | 原帧、Native/PyTorch/ONNX 三尺度分类头及统一 ×6 灰度差分，已人工看图；三张差分全黑 |
| 本地回归 | 5 个测试模块共 65 个测试通过，其中 23 个为本轮新增；三平台 CI 已接线，尚未以本轮 head 验证远端结果 |

这里的“效果一致”严格指检测模型输出一致。尚未替换 QCut 编辑器的美颜后端，
不能据此声称鼻子、眼角、磨皮或整张妆容图已经由独立模型完成且与剪映一致。

## 实现与数值规则

- [espresso_integer_torch.py](espresso_integer_torch.py)：只负责整数网络执行。
- [espresso_integer_export.py](espresso_integer_export.py)：导出文件、调用固定哈希原生 oracle、比较所有张量并记录来源。
- [espresso_integer_test.py](espresso_integer_test.py)：公开合成算子、ONNX 与 PyTorch 文件重载测试。
- [espresso_integer_export_test.py](espresso_integer_export_test.py)：证据不完整、shape/dtype 不符、重复捕获与私有目录保护测试。

整数卷积拆为整数切片、矩阵乘法或逐通道乘法与加法。累加后显式按 `2^32` 回绕，
再加舍入偏移并向下整除。回绕发生在舍入之前，舍入的中间值不能再次回绕。
负数也遵循原生的 half-up 规则，而不是默认浮点 round。

深度卷积的核布局、12 位打包权重、bias 标度、Concat/Slice 各分支标度、
旧格式 Eltwise 隐含 ReLU、零填充的 LINEAR ×2 上采样，都保留原先探针确认的语义。
同标度的 Concat/Slice 不擅自加饱和截断。

ONNX 中没有自定义算子域；使用整数 MatMul、Add、Mul、Mod、Div、Clip、Slice 等标准算子组合。
因此之前“定点网络无法用标准 ONNX 表达”的概括过强：本轮证明检测器的这个子集可以，
但尚未证明所有定点网络都可以。

当前支持 Input、普通/深度/膨胀深度卷积、Eltwise、Concat、Slice、LINEAR ×2 UpSampling。
浮点头、特殊 Softmax、ShuffleNet 单边 lane 钳制、其他未知算子明确拒绝。
每个文件绑定一个输入尺寸；没有把两个静态 profile 冒充任意动态尺寸支持。
PyTorch `.pt2` 使用 `torch.export`；ONNX 为与现有工具一致仍使用固定版本的 legacy exporter，
当前可运行但有弃用警告，后续再单独迁移 exporter。

## 证据和复现

权重、派生模型与输入输出全部保留在 Git 忽略的 `.local/`，不提交仓库。
本轮通过结果位于 `.local/jianying-model-pytorch/face-integer-20261002-r2/`：

- `summary.json`：graph、arena、runtime 哈希，版本，捕获文件哈希，模型文件哈希和各 case 状态。
- `profile-1-320-320-3/`、`profile-1-320-576-3/`：`model.pt2`、`model.onnx`、`all-layers.onnx`。
- `seed-17/`、`seed-41/`、`seed-509/`、`real-render/`：新运行的原生输入输出与逐张量报告。
- `real-render/detector-output-comparison.png`：模型输出灰度对比，非美妆后的成片。

工具链：Torch 2.10.0、ONNX 1.23.0、ONNX Runtime 1.30.0、NumPy 2.5.3；本机 macOS ARM CPU。
同一图的原生 oracle 必须符合现有 `espresso_oracle.RUNTIME_SHA256`；每次校验图和 arena 哈希。
重新运行请选新输出目录，工具拒绝覆盖历史证据。

```sh
# 在 qcut/ 目录；使用安装了 requirements-onnx-export.txt 和 Pillow 的 Python
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
$PY research/local-model-pytorch/espresso_integer_export.py \
  --network .local/jianying-model-pytorch/face-capture-20260920/collected/3a3fc3c584289096 \
  --capture .local/jianying-model-pytorch/tail-20260920/iocap-sticker \
  --frame .local/jianying-model-pytorch/face-capture-20260920/face-1280x720.rgba \
  --out .local/jianying-model-pytorch/face-integer-fresh

# 公开合成回归，不需要私有权重；CI 已增加同一组新测试
cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_integer_test espresso_integer_export_test \
  espresso_test espresso_package_collect_test native_probe_test -v
```

## 下一步验收顺序

1. 对齐/关键点子网：补池化、dense 与浮点头语义，逐层原生对拍，再验证真实裁剪块的关键点。
2. 眼部/虹膜与扩展关键点：验证精修所依赖的坐标、特殊 Softmax 与边界输入。
3. 原图到关键点：补框解码、NMS、裁剪仿射与逆变换；不能只比较 SDK 已裁好的人脸块。
4. 接入实验后端：同一原图、同一滑杆值输出“原图、剪映、QCut、统一增益灰度差分”；
   覆盖零值/中值/极值、多人、侧脸、遮挡、视频时间连续性以及保存/重开/导出。
5. 通过逐项画面对拍和性能门槛后再考虑切默认，不因为一张模型文件存在就启用。

尚未完成 Windows/Linux 私有模型运行、GPU 性能、动态尺寸、完整美妆渲染链和权重分发审查。
转换格式不改变权重及贴图来源。
