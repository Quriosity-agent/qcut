# 自动人脸框：实际模型配置、独立解码与原生对拍

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮结论

从前一轮“手动框到裁剪”推进到了“实际检测头到自动框到裁剪”。
已经运行实际 SDK 的图像检测函数，不只是构造几个框验证数学公式。
独立解码、NMS、框还原和裁剪在本轮普通控制样例中一致，
但新增同分候选框压力测试仍不一致，所以**完整替代验收未通过，未接入编辑器正式后端**。

| 验证范围 | 当前结果 |
| --- | --- |
| 当前基础包实际检测模型 | 初始化后读取配置并确认是 NanoDet，不是 SSD2 |
| 实际六个检测头 | 三个四通道距离头、三个单通道置信度头，int8、fraction=4 |
| 独立距离解码/框裁边 | 72 组无同分控制样例，与原函数坐标、分数逐位一致 |
| 已确定顺序的 NMS | 300 组原生对拍完全一致 |
| 实际图像检测 | 5 组输入；原生检测框与独立解码还原框逐位一致 |
| 自动框到方形裁剪 | 7 个实际检测框的裁剪坐标和 RGB 字节一致，差分图为黑色 |
| 捕获输入到 PyTorch/ONNX 到独立框 | 六头及两个最终提案框都与原生对照一致 |
| 多个候选框分数相同 | 2 组压力测试失败；整体验收明确为 false |
| 纯黑输入语义正确性 | 原生和独立链都误报整幅图像框，不计为检测正确 |
| 裁剪缩放/关键点输入、旋转、平均脸、精修 | 本轮没有完成，也没有替换这些步骤 |

## 实际配置如何确认

探针对运行库和基础模型文件先做 SHA-256 固定版本校验。
通过 `FsNew_CreateHandler` 正常初始化，不修改代码、权重或配置。
当前 flags=0 路径只初始化默认检测对象；探针读取其实际层配置、模型类型、输出名和锚点。

实测配置为：

- 模型类型：`NanoDet`。
- 步长：8、16、32。
- 各尺度最小宽高：4、8、16，包含边界端点。
- 置信度阈值：float32 的约 0.225。
- NMS 阈值：float32 的约 0.3。
- pre-NMS top-K=1500，post-NMS 最大 200。
- 整数数据按 `raw * 2^(-fraction)` 转成 float32；本包的六头 fraction=4。

这些值是本包、本初始化模式的实测结果，不是所有剪映版本或所有检测模式的通用默认值。
独立算法显式接收配置；不把 SDK 当作独立算法后端。
私有 oracle 的固定布局仅适用于已校验的 macOS arm64 运行库。

### 一个容易误读的地方

函数名包含 NanoDet，且代码存在 GFL 分布回归分支，
并不意味着当前包一定输出 4×8=32 个回归通道。

本包实测输出只有 4 通道，分别是 left/top/right/bottom 的距离。
`channels/4 == 1` 时直接反量化，不做 softmax。
通道数大于 4 时，原函数才会对每边分布做 softmax，再求 bin 下标的期望。
本轮用合成的 32 通道输入单独验证了该分支，但没有声称本包使用它。

## 独立实现的数学规则

### 1. 置信度与距离

置信度是反量化 logit 的 sigmoid，并采用 `score >= threshold`。
直接距离分支保留 float32 距离；分布分支按顺序累加 expf、归一化和下标期望。
原函数采用不减最大值的指数归一化，本探针只允许有限指数范围，避免把极端输入送入原函数。

### 2. 框坐标

已验证的对称锚点在每个网格位置的中心为：

```text
cx = column * stride + stride // 2
cy = row    * stride + stride // 2

left   = cx - max(distance_left,   0) * stride
top    = cy - max(distance_top,    0) * stride
right  = cx + max(distance_right,  0) * stride
bottom = cy + max(distance_bottom, 0) * stride
```

各端点先向零截断，再裁到 `[0, width-1]` / `[0, height-1]`。
最小宽高过滤使用 `right-left+1` / `bottom-top+1`。
不能替换为连续几何里常见的“宽=right-left”约定。

### 3. NMS 与原图还原

交集与框面积都包含 `+1`；IoU **大于**阈值才抑制，相等时保留。
原生 NMS 不自行排序，因此必须区分“排序阶段”与“已确定顺序的 NMS”。

检测器保留原始图像到检测输入的 x/y 缩放比。
各端点先乘 float32 逆缩放，再向零截断；然后得到原图 Rect(x,y,width,height)，宽高仍包含 `+1`。
它回到本次探针传入的图像坐标，不自动处理编辑器宿主此前的旋转、镜像或 GPU 缩小。

## 动态证据

### 实际图像调用

探针调用实际 `FaceDetectorModel::DetectFace`，再读取这次推理的六个头。
独立解码后与该函数返回的原图框比较，再把这些自动框送入已验证的裁剪链。
不是把手动框伪装成检测框，也不是重放上一轮的裁剪结果。

| 输入 | 原生框数量 | 框还原/分数一致 | 自动框裁剪字节一致 |
| --- | --- | --- | --- |
| 1448×1086 正面生成肖像 | 1 | 是 | 是 |
| 同一肖像水平镜像 | 1 | 是 | 是 |
| 320×320 纯黑图 | 1，错误检测 | 是，复现同一个误报 | 是 |
| 同一肖像缩小后拼成双脸 | 2 | 是 | 是 |
| 1280×720 历史双头校准帧 | 2 | 是 | 是 |

正面原图的检测框为 `(508,183,453,632)`；显式 expansion=1.5 的方形裁剪为 `(261,25,948,948)`。
这只是一个已验证倍率，不代表模型所有路径的倍率选择已经恢复。
测试肖像是生成素材，双脸是合成 fixture；不是不同真人脸型的覆盖证明。

### PyTorch/ONNX 链

复用上一轮真实渲染捕获的 320×576 网络输入和已导出的 ONNX：

```text
真实渲染捕获输入
  -> 独立整数 PyTorch / CPU ONNX Runtime
  -> 六个头逐元素比较原捕获
  -> 独立框解码/NMS
  -> 比较 SDK 原解码函数
```

两条链的六头和两个提案框均一致，最大误差 0。
这是捕获输入起点的完整数值链，不是上述任意尺寸原帧的独立预处理证明。
不能将这一条链和实际图像探针拼成未经验证的“任意原帧到全部关键点已经迁移”。

## 明确没有通过的两项

### 同分候选排序

SDK 的全排序/partial-sort 不是稳定排序；独立实现采用稳定输入顺序处理同分。
量化头确实会产生同分，排序不同可能改变重叠候选的保留结果。

固定 seed=41、分数 logit 从 -16/0/16 取值的压力样例：

- 128×128：原生保留 120 个框，独立实现 125 个框。
- 320×320：两者都到 200 个上限，但部分框不同。

这不是浮点误差，也不能通过放宽坐标容差或只比较框数量来验收。
报告将 `controls_passed` 与整体 `passed` 分开：前者 true，后者 false。
探针发现同分失败时正常返回非零退出码，不能把这次运行写成全绿。

下一步先明确产品希望采用“固定版本原生排序兼容”还是“跨平台稳定排序”策略。
如果要求逐框原生兼容，要在同分、top-K 截断和跨平台排序上补独立实现及 oracle 压力测试。
不要直接调用 SDK 的排序冒充独立迁移，也不要把依赖平台的偶然排序当成模型语义。

### 黑图误报

纯黑图期望 0 张脸，当前原生模型输出 1 个整幅图像框；独立链复现了它。
报告单独记录 `fixture_face_counts_match=false`，不拿数值一致掩盖语义失败。
本轮不擅自提高阈值或插入新过滤器，否则改变了对拍基线。
产品接入前需要负样本、遮挡、小脸、多脸等检测正确性验收，以及明确误报抑制策略。

## 代码与复现

- `face_detector.py`：自有解码、NMS、原图 Rect 还原，支持显式配置。
- `face_detector_bridge.mm`：只读 ABI 桥接，调用真实检测、提案、NMS 和 raw 输出读取。
- `face_detector_native.py`：固定哈希、正常初始化、内存/张量边界和关闭后调用保护。
- `face_detector_verify.py`：普通控制、实际图像、整数转换链、同分失败与语义正确性分离。
- `face_detector_test.py`：31 个公开回归测试；不需要厂商模型或原生运行库。

最终本地证据目录：`.local/jianying-model-pytorch/face-detector-20261002-r3/`。
含 `summary.json`、桥接库和 5 张对比图，已查看单脸与双脸图。
图片为原图/SDK 自动框/独立自动框/裁剪/统一增益 RGB 绝对差分；不是剪映 GUI 导出。
二进制、模型、raw 捕获、反汇编和对比图片不进入公开 Git。

```bash
env DYLD_LIBRARY_PATH="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks" \
  .local/jianying-model-pytorch/tflite/venv/bin/python \
  research/local-model-pytorch/face_detector_verify.py \
  --out .local/jianying-model-pytorch/face-detector-new-run \
  --portrait output/beauty-kpop-v6-20261002/source/kpop-front-original.png \
  --frame .local/jianying-model-pytorch/face-capture-20260920/face-1280x720.rgba \
  --network .local/jianying-model-pytorch/face-capture-20260920/collected/3a3fc3c584289096 \
  --capture .local/jianying-model-pytorch/tail-20260920/iocap-sticker \
  --onnx .local/jianying-model-pytorch/face-integer-20261002-r2/profile-1-320-576-3/model.onnx
```

必须使用新的输出目录；历史证据不会覆盖。当前同分边界预期使此命令退出码为 1。

公开回归：

```bash
PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test face_detector_test
```

本地 133 个测试通过，C++ 桥接通过 `-Wall -Wextra -Werror` 语法检查。
公开 CI 只覆盖合成代码、安全边界和回归，不包含私有模型对拍，也不证明完整迁移。

## 后续顺序

1. 关闭同分/top-K 验收缺口，明确独立跨平台行为和兼容要求。
2. 捕获自动框裁剪后的 120/160 对齐网络输入，逐字节验证缩放、通道、量化。
3. 验证 106 点重排后的平均脸叠加及输出单位。
4. 旋转仿射、Stage2、眼/虹膜、视频跟踪分别验收。
5. 最后接入编辑器，对多脸型预览与导出做美颜/美妆结果对比。

前一轮坐标链状态见 [人脸坐标链逆向](face-geometry-investigation-2026-10-02.zh-CN.md)。
