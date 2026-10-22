# 独立美体多平台图片版

Windows 和 Linux 使用 ONNX Runtime CPU 推理、NumPy 网格绘图、PP-HumanSeg 人物分割。Mac 原有入口默认仍为 Metal / Apple Vision，新增后端通过 `BODY_RENDER_BACKEND=cpu` 或 `render.py --backend cpu` 选择。无需安装剪映或 QCut，也无需调用它们的原生二进制。

## 交付与启动

完整便携包包含代码和已导出的模型；Git 仓库只包含代码、模型清单和哈希。单独克隆仓库不等于已安装模型。骨架与人脸权重来自既有私有模型数据，转换格式不改变其来源或授权。

解压完整包后，先安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)，再使用包根目录对应平台的启动脚本。脚本创建独立 Python 3.12 环境，检查模型并打开本机图片编辑器；首次安装 Python / 依赖需要网络。推理、对比和导出均在本机进行。

从已有完整模型的开发目录启动：

```sh
# Linux，或 Mac 上显式测试 CPU 后端
BODY_RENDER_BACKEND=cpu sh body/setup.sh
BODY_RENDER_BACKEND=cpu BODY_PORT=5277 body/.venv/bin/python body/launch.py
```

```powershell
# Windows PowerShell
$env:BODY_RENDER_BACKEND = "cpu"
powershell -ExecutionPolicy Bypass -File body/setup.ps1
body/.venv/Scripts/python.exe body/launch.py
```

`BODY_PORT` 可指定空闲端口。关闭终端会停止服务。可以使用滑杆调节十二项身体比例，以及局部拖动、背景保护、半图比较和 PNG 导出。复杂组合仍需等待处理，不是实时视频。

## 模型组成

| 用途 | 文件 |
| --- | --- |
| 身体骨架 | 25 个粗定位输入形状的 ONNX，加 1 个细化 ONNX；对应两套既有网络 |
| 人脸检测与对齐 | 3 个既有 ONNX |
| 背景保护 | 1 个 PP-HumanSeg ONNX，Apache-2.0，来源与哈希见 `person-mask-model.json` |
| 对齐常量 | 1 个 2,286 字节 NPZ；不是需转换的神经网络 |

共 30 个 ONNX。推理直接读取导出的骨架 ONNX，不读取 `body-skeleton-v1.npz`，不运行模型导出器，也不调用 Swift 编译器。骨架所有支持形状均已导出，宽高比例变化不需要现场编译模型。

维护者在已有私有源模型的开发机器上导出：

```sh
body/.venv/bin/python -B body/export_models.py \
  --source-runtime runtime/body --destination runtime/body-portable
body/.venv/bin/python -B -m body.download_person_mask
body/.venv/bin/python -B body/render.py --verify --backend cpu
```

模型哈希不匹配、缺失或人物蒙版不可用时停止交付，不会自动下载另一套权重或偷偷换回原生后端。

## 验证与边界

CPU 图片版新增独立收腹、提臀、臀型、腿型拉直、脚踝和四项身体肤色／皮肤控制，共二十一项；原 Metal 默认目录仍为十二项。参数、组合和适用范围见 [单张照片新控制](PHOTO-CONTROLS.md)。

`validate_portable.py` 对同一套声明过期望的照片执行真实 HTTP 导入、处理、结果下载和回执读取，核对像素变化、尺寸、透明度、各项应用状态、原图不变和导出一致性。无人物、遮挡或裁切造成的“不可用”与实际应用成功分别记录。

```sh
body/.venv/bin/python -B -m body.validate_portable \
  --fixture-root /absolute/private-fixture \
  --output /absolute/fresh-results
```

Windows / Linux 实际出图使用 `.github/workflows/body-portable-render.yml`，每平台四个分片，共用相同 308 项声明和 11 张样本。样本为七张虚构成年人物照片、两名真人的三帧画面和一张空白图；不是大规模真人泛化验证。

测试权重和样本仅以加密附件保存在私有仓库的未发布草稿中，解密密钥存于 Actions secret。结果图也加密保存为 CI artifact，不进入 Git。缺少密钥、模型、出图结果或未满足声明均导致测试失败；无模型单元测试通过不能替代实际出图。

既有同网格采样探针测得 CPU 与 Metal 最大通道差异为 1/255。PP-HumanSeg 与 Apple Vision 的人物边缘也不同，因此背景保护输出不能宣称与 Mac 原版逐像素相同。人物轮廓过渡区以外的受保护背景像素保持不变；人物轮廓附近及收缩后露出的背景仍可能发生形变。复杂遮挡、坐姿、小人物、多人和极端比例需要按应用状态及实际图片检查。

CPU 长腿调节要求同一人的双侧髋、膝、踝完整可信，并确认脚部在画布内。背面照片不会仅因缺少正面人脸被拒绝；缺失腿部关节的半身照会跳过长腿，组合中的其他可用项目仍可执行。界面保持用户请求值，并分别报告各项是否执行。

长腿通过抬高髋部调整腿身比例，固定脚踝与鞋部所在区域，保持原有画布尺寸。肩部至髋部的躯干会相应压缩，100 档是较强的比例改变。网格面积限制在应用强度之前计算，避免较高强度与较低强度都被截到同一个结果。该策略仅用于新 CPU 后端，Mac 默认 Metal 路径保持原有行为。

CPU 背景保护为 192 像素分割模型的边缘不确定性保留有限过渡区，防止恢复原背景时把旧鞋边或脚踝轮廓一并恢复。过渡区使用真实变形图，不生成或补画背景；远处保护区域继续保持原图像素。已有六张真实写真、108 档同参数回归，另检查了高低强度、锁脚像素、旧轮廓残留及裁切照片拒绝行为。该验证不代表任意姿势、复杂背景或所有强度都已通过视觉验收。
