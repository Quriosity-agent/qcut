# 原始人脸对齐链：裁剪、缩放与网络入口

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 本轮目标与结论

先把原始实现的顺序、参数、分支和中间数据摸清，再考虑 QCut 独立替换。
本轮没有改编辑器后端、修检测器排序或转换新的关键点网络。
方法是有界反汇编定位调用关系，再用已初始化的原始 SDK 函数和推理入口捕获作对照。
没有恢复完整厂商源码，也没有修改厂商机器指令。

已验证的是**显式指定分支参数的非旋转预处理子链**：

```text
传入的三通道分析图 + 原始检测框
  -> 原始 CropObjectRegion：扩框成方形、边界补黑
  -> 原始 PreProcessor：选择缩放分支
  -> 原始 BasePredictor：整理 NHWC 输入、减 128
  -> 原始 espresso Inference：120/160 网络
  -> 读取 212 个原始浮点输出
```

196 组原始子模块对照通过；另一次入口抓取中，两个 profile 各执行两次推理，
共 8 份输入/输出张量逐字节或逐值一致。这不是最终关键点位置或美颜成片的验收。

## 如何定位原始调用

沿 `FsNew_CreateHandler`、`ModuleHandler::LoadBaseModelFromBuff`、
`FsNewAlignAlgo::init_base` 和 `FaceAlignmentDet` 追到初始化后的对象。
探针读原始 `PreProcessor::ProcessDetectionImage` 的结果，再执行原始
`BasePredictor::Predict`，不是构造假的网络 provider 替代推理。

固定版本的句柄中有 10 个、每个 400 字节的人脸记录；不是 10 个裸指针。
从其中的对齐对象找到预处理器及 predictor container，并检查初始化标记和实际网络尺寸。
两个已初始化 predictor 分别为 120×120、160×160。
这些对象偏移只属于下文固定版本，不能推广成其它版本的 ABI。

没有把这两个尺寸直接命名为“图片模式/视频模式”：宿主如何选择它们仍需沿实际调用验证。
本轮明确传入缩放标志、legacy 锚点、扩框倍率，未宣称恢复所有自动路由条件。

## 已验证的行为

### 1. 缩放不是统一双线性

原始预处理函数在裁剪后选择插值方式：

- 探针中名为 `allow_upscale` 的标志为真，且裁剪高度小于目标高度：线性分支。
- 其它情况：最近邻分支；裁剪尺寸恰好等于目标时不满足上述严格小于条件。
- legacy 锚点影响前面的裁剪，不等于插值标志；另一个末尾标志在本轮固定为 false。

线性分支在当前 profile 中匹配半像素中心采样、7 位权重、先横向再纵向，
每个方向单独截断的公式。不能直接用 Pillow 默认 bilinear、浮点一次求和或任意 OpenCV 配置代替。
这是目前控制样本的精确解释，不是通用 resize 库的承诺。

### 2. 最近邻要保留原始运算顺序

最近邻采样使用双精度的正向比例，再求倒数：

```text
scale = target_size / source_size
inverse = 1 / scale
source_index = floor(output_index * inverse)
```

数学上相同的 `floor(output_index * (source_size / target_size))`，
在浮点整数边界可能选择不同像素。948 -> 120、输出索引 30 是本轮的真实反例：
前者选 236，后者选 237。

第一轮诊断公式用了后一种写法。196 组中只有大脸的两组 120 profile 失败：
各有 1662 个 RGB 分量不同，最大差 46。与此同时，原始连续调用和分段调用始终一致。
因此错误定位在**用于解释原始行为的采样公式**，不是原始推理不稳定或模型转换精度问题。
修正运算顺序后的第二轮 196 组全部通过；第一轮失败报告保留，没有覆盖。

### 3. 输入存储类型与数值是两件事

| 原始 profile | 张量布局 | 存储描述 | 实际整数值 |
| --- | --- | --- | --- |
| 120×120 | 1×120×120×3，NHWC | int16，fraction=6 | `pixel - 128` |
| 160×160 | 1×160×160×3，NHWC | int8，fraction=6 | `pixel - 128` |

int16 输入不是额外乘 256，也不是直接传 float。当前 uint8 输入产生 -128..127 的整数；
fraction=6 的解释值为整数除以 64。本轮 196 组都验证了原始缓冲区的具体数值和存储类型。

本轮传给子模块的是三通道测试图，已验证该子链保持通道顺序。
不能由此推断完整宿主 RGBA -> 分析图一定用 RGB；历史渲染路径还涉及 BGR 和中间缩小。

### 4. 不只读取“推理后残留的输入”

新 ABI 桥在原始 `Predict` 返回后读 input/output，并立刻复制借用内存。
为了验证它确实对应网络消费的输入，另用既有 `bytenn_model_capture.mm`
在原始 `espresso::Thrustor::Inference` **进入时**抓取 input，随后抓取原始输出。

两个 profile 各两次推理的 4 份入口输入与探针 `.npy` 一致；
4 份 `fc_landmark_s1` 输出也一致，最大绝对差和不一致元素数均为 0。
检查要求输入、输出、成功返回记录齐全；缺失、截断、重复、错误返回或改动过的参考文件不能通过。

这说明本轮入口数据确实匹配读回的数据；不是把准备图像本身冒充真实网络输入。
它仍是 headless 原始 SDK 子模块调用，不是剪映 GUI 的全链捕获。

## 样本、验收与图片

- 合成图：种子 17、41、509；257×257 uint8 三通道。
- 120/160 两个 profile；8 种框，包括小于/等于/大于网络尺寸、分数框、补黑和大裁剪。
- 两种插值标志 × 两种 legacy 锚点，共 192 组。
- 已有生成测试肖像由原始检测器给框 `[508,183,453,632]`；非真人实拍。
  扩框 1.5 后得到 `[261,25,948,948]`；两个 profile × 两种插值标志，共 4 组。
- 合计 196 组：框、原始分段缩放、采样公式、输入量化、重复输入、重复原始输出全部精确一致。
  60 组走线性，136 组走最近邻。重复推理证明稳定性，不证明点位语义正确。
- 独立入口抓取为额外 4 次推理、8 个张量，不与上述 196 组混计。
- 本地 8 个公开回归模块共 154 个测试通过，21 个为新增；原有 ONNX exporter 有弃用警告。
  C++ 桥 `-Wall -Wextra -Werror -fsyntax-only` 通过。

公开三平台 CI：[运行 36991184878](https://github.com/Quriosity-agent/qcut/actions/runs/36991184878)
的三个 job 均为 success，测试代码/工作流基线为
`9ccc90d401a39141cc322a4407aafa748fe13062`。后续仅增加研究文档。
新增 21 个测试三平台均执行；Linux/Windows 跳过 10 个既有 macOS 原生边界测试。
CI 使用公开合成数据，不携带私有模型，不能替代上述本地原始 SDK 对拍。

每组 `stages.png` 有六列：原始 SDK 裁剪、原始 SDK 缩放、解释公式、缩放灰度差分 ×8、
真实网络输入加回 128、输入灰度差分 ×8。
已人工检查大脸 `case-192` 和线性放大 `case-002`，两类差分均全黑。
这些是中间数据图，**不是磨皮、美妆或最终美颜效果图**。

私有证据：

```text
.local/jianying-model-pytorch/face-alignment-input-20261002-r1/  # 保留失败的解释公式
.local/jianying-model-pytorch/face-alignment-input-20261002-r2/  # 196 组通过
  summary.json / case-*/report.json / case-*/stages.png
  case-*/actual-network-input.npy / case-*/actual-raw-landmarks.npy
.local/jianying-model-pytorch/face-alignment-entry-20261002-r1/
  capture/ / profile-120/ / profile-160/ / entry-summary.json
```

原始库、模型、图/权重、反汇编和图片均不进入 Git。仓库只提交自有探针、回归和行为说明。

## 版本与复现

- `liblens.dylib` SHA-256：`fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`。
- 初始化模型 SHA-256：`89e4cf058aa4ec0eceda3ecffe6b5b599b718f58aaadac5e03e5c2c1b2d66227`。
- 本轮实际加载的 Filter runtime `libbytenn.dylib` SHA-256：
  `febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863`。
  已通过 dyld image inventory 核对；不要与另一个 ShotSplit runtime 的 CPU oracle 库混写。
- 原生探针需要 macOS arm64、既有私有运行库/模型、NumPy、Pillow 和 Xcode clang。
  公开合成测试不加载厂商库；不能称 Windows/Linux 原生 SDK 已验证。

在 `qcut/` 目录选择不存在的新输出目录：

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
env DYLD_LIBRARY_PATH="$R/Frameworks" "$PY" \
  research/local-model-pytorch/face_alignment_input_verify.py \
  --out .local/jianying-model-pytorch/face-alignment-input-fresh \
  --image output/beauty-kpop-v6-20261002/source/kpop-front-original.png
```

入口对照的复现先准备新的私有目录、编译既有捕获器，再生成两个 profile 的原始结果。
以下命令只写研究证据，不启动编辑器：

```sh
CAP=.local/jianying-model-pytorch/face-alignment-entry-fresh
mkdir -p "$CAP/capture"
xcrun clang++ -std=c++17 -O1 -dynamiclib -fobjc-arc -framework Foundation \
  -L"$R/Frameworks" -lbytenn -Wl,-rpath,"$R/Frameworks" \
  research/local-model-pytorch/bytenn_model_capture.mm -o "$CAP/capture.dylib"
env QCUT_BYTENN_CAPTURE_DIR="$PWD/$CAP/capture" QCUT_BYTENN_CAPTURE_IO=1 \
  DYLD_INSERT_LIBRARIES="$PWD/$CAP/capture.dylib" DYLD_LIBRARY_PATH="$R/Frameworks" \
  PYTHONPATH=research/local-model-pytorch "$PY" - <<'PY'
from pathlib import Path
import numpy as np
from PIL import Image
from face_alignment_input_native import NativeAlignmentInput
from face_alignment_input_verify import case
root = Path(".local/jianying-model-pytorch/face-alignment-entry-fresh")
image = np.asarray(Image.open("output/beauty-kpop-v6-20261002/source/kpop-front-original.png").convert("RGB"))
with NativeAlignmentInput(output=root / "oracle") as native:
    boxes = native.detector.detect(frame=image)[0]
    if len(boxes) != 1:
        raise ValueError("expected the original single-face fixture")
    for size in (120, 160):
        case(native=native, frame=image, rect=boxes[0], size=size, expansion=1.5,
             allow_upscale=False, legacy_anchor=False, directory=root / f"profile-{size}")
PY
"$PY" research/local-model-pytorch/face_alignment_entry_verify.py \
  --capture "$CAP/capture" --profiles "$CAP" --out "$CAP/entry-summary.json"

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test face_detector_test \
  face_alignment_input_test -v
```

必须用新 `CAP`；捕获器自身不会替用户保护旧目录。新探针和报告拒绝覆盖已有输出。

## 尚未摸清的部分与下一步

1. **原始宿主路由**：实际渲染帧经过哪些缩小、通道转换、方向变换；何时选 120/160、
   1.4/1.5、legacy 和其它标志。显式指定参数不等于恢复自动选择规则。
2. **旋转与平均脸**：继续追 `NewAlign` / 旋转变换，捕获原始矩阵、warp 后图像，
   以及平均脸叠加前后的 106 点。先对拍原始中间值，不先写独立 warp。
3. **原始输出解码**：212 个浮点值的单位、重排和平均脸基准，以及回原图时组合的逆矩阵。
   前一篇验证了重排和非旋转端点逆映射，但不能直接把本轮 raw 输出代入那个公式。
4. **Stage2、眼/虹膜与跟踪**：逐网络捕获输入/输出及视频状态，确认执行次序和触发条件。
5. **效果控制到成片**：滑杆到 SDK 参数、效果包、变形/皮肤/妆容渲染的原始链，
   仍需与剪映导出做参数扫描和统一增益灰度差分；本轮没有据此宣称效果完全一致。

还尝试从历史 1280×720 渲染帧重建当时的 160 输入：2×2 缩小、RGB/BGR、
两类倍率/锚点的有限组合均未精确匹配。这项试验未通过，表明历史宿主路径仍未闭合，
不能拿本轮显式子模块通过覆盖这个缺口。此前检测器同分排序的两组压力失败也仍然保留。

先完成以上原始行为取证，再确定哪些阶段可独立实现、转换到 PyTorch/ONNX 和接入 QCut。
每步保留上一阶段原始输入，单独比较当前输出，避免把上游偏差误归因于新一步。

关联：[坐标链总表](face-geometry-investigation-2026-10-02.zh-CN.md)、
[检测框原始对拍](face-detector-postprocess-2026-10-02.zh-CN.md)、
[历史真实输入网络对拍](espresso-real-input-parity.zh-CN.md)。
