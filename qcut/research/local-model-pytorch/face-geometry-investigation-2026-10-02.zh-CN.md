# 人脸坐标链逆向：裁剪、重排与还原

日期：2026-10-02。分支：`codex/kpop-beauty-v6`。

## 是否已经反编译过

已经做过模型包恢复、运行库函数反汇编和真实推理输入输出捕获，
但没有恢复整套剪映源码，也没有完成所有人脸处理分支的独立实现。
此前恢复网络图和权重、复现定点算子，解决的是“给定网络输入，输出一致”；
不能因此认为框解码、裁剪、坐标还原、跟踪、精修和最终美颜都已独立实现。

本轮对 `liblens.dylib` 的相关函数做有界反汇编，再直接调用固定版本的原生函数作对照。
没有修改 SDK 指令、绕过模型初始化或把原生函数结果当作独立实现结果。
仓库只保存自有几何代码、测试和行为说明；二进制、模型、反汇编全文、映射表及图片都留在私有目录。

## 整条链当前状态

| 步骤 | 状态 | 证据与尚缺内容 |
| --- | --- | --- |
| 原帧到检测器输入 | 已对拍，有限 profile | 既有 1280×720 帧生成 320×576 输入逐字节一致；不是任意尺寸证明 |
| 检测器网络 | 已转换、已对拍 | PyTorch/ONNX 的 6 个头和全部中间整数张量一致；见前一篇转换文档 |
| 检测头到人脸框 | 未完成 | 已定位 NanoDet/SSD2 提案和 NMS；解码细节、阈值、实际框逐项对拍仍缺 |
| 给定人脸框到方形裁剪 | 本轮已实现、已对拍 | 996 组框和裁剪像素完全一致；包含边界补黑、非整数和 legacy 锚点 |
| 裁剪块到网络输入 | 部分理解，未完成 | 本轮只验证方形裁剪字节，未验证缩放/量化后的 120/160 网络输入 |
| 旋转/平均脸仿射裁剪 | 未完成 | 已定位旋转变换和 NewAlign；不能用非旋转 resize 替代 |
| 对齐/关键点网络 | 历史解释器已对拍；转换未完成 | SDK 已准备的真实输入，浮点输出误差最高 3.4e-5；这是网络数值误差，不是像素误差 |
| 212 输出值的 106 点重排 | 本轮已验证 | 初始化后读出映射；普通版/优化版各 4 组，共 8 组逐位一致 |
| 重排后的平均脸基准叠加 | 静态确认，动态验收未完成 | 部分分支按 256 基准缩放到网络尺寸后相加；本轮没有冒充完整解码已通过 |
| 非旋转坐标还原 | 本轮已实现、已对拍 | 978 组，最大坐标分量误差 0.00006103515625 像素，验收门槛 0.001 像素 |
| 二阶段精修、眼/虹膜、视频跟踪 | 未完成 | 存在不同模型和状态分支，仍需逐阶段捕获 |
| 独立模型接入 QCut 美颜/美妆 | 未完成 | 本轮未替换编辑器后端，未宣称鼻子、眼睛或妆容整链一致 |

图示中需要区分三个坐标域：检测器输入像素、SDK 的分析图像像素、编辑器原素材像素。
本轮验证的逆变换回到**调用方传入的图像**，不自动恢复宿主此前的缩小、镜像或方向变换。

## 本轮搞清楚的规则

### 1. 检测后的裁剪不是简单 clip-to-image

`CropObjectRegion` 把框扩大成方形，边长为 `max(w, h) × expansion`。
普通分支以 `x + w/2, y + h/2` 为中心；legacy 分支以底部/右侧为锚点，
框在对应边界超过图像时再回退到另一种锚点。

起点根据未取整边长计算，减去 `(expanded - 1)/2`，再向零截断。
边长单独按正数 .5 进位取整，不能直接使用 Python 的 ties-to-even round。
因此负起点不能替换成 floor，也不能先把边长取整再算起点。

输出框保留扩展后的坐标，而不是改成图像交集。
输出像素先清零，再把交集复制到方形内的相应位置；超出图像的区域是黑色。
探针只接收有交集、有限大小的 uint8 三通道图像，不把非法框交给原生函数。

初始对齐调用路径中看到了 1.5，以及配置相关的 1.4 分支；
本轮没有证明它们在每种检测/跟踪模式中的选择条件都已恢复，工具仍显式传入 expansion。

### 2. 非旋转坐标还原采用端点约定

设方形裁剪框为 `(left, top, S, S)`，网络尺寸为 `(W, H)`，
已解码到网络像素坐标的点为 `(u, v)`，独立公式是：

```text
x = left + u * (S - 1) / (W - 1)
y = top  + v * (S - 1) / (H - 1)
```

原生 `ImageTransform` 通过线性求解构造矩阵；独立实现直接计算比例，
所以浮点矩阵不能宣称逐位相同。本轮比较矩阵和映射后的坐标并显式记录误差。
网络输出仍需先解码为 `(u,v)`，不能直接将任意 212 个浮点值送进该公式。

### 3. 106 点重排的方向和初始化条件

网络输出布局是交错的 `x0,y0,x1,y1,...`。
原生函数采用 scatter：`result[destinations[i]] = raw_pairs[i]`，
不是 `result[i] = raw_pairs[destinations[i]]`。

这个映射表在只加载 `.dylib` 时全为零，模型初始化成功后才填充。
探针检查初始化返回值、有效句柄及 0..105 的完整排列，才允许对拍。
实际表只写入私有 `.npy`，没有把厂商表常量嵌进公开代码。

本轮使用自有 C++ 合成张量 provider，把可识别序列和随机浮点值送给
SDK 真正的 `GetLandmark` / `GetLandmarkOpt`，比较其重排结果。
因此这 8 组证明重排语义，不是关键点网络精度、平均脸叠加或最终人脸位置精度。

### 4. 不能遗漏平均脸与第二阶段

`doCnnAlignmentNewPhase2` 的部分分支在重排之后相加平均脸基准：
平均脸的 256 坐标系按网络宽高缩放，再加到当前点坐标。
这一步采用网络宽高，不能与上面的“宽高减一”逆映射混为同一种约定。

静态指令和初始化后的常量读取支持这个判断；
但还没有用完整真实路径验证每个模型输出的单位、所有分支的基准选择及精修顺序。
`FaceAlignmentStage2`、旋转仿射、跟踪状态和眼/虹膜细化仍要单独验收。

## 验证结果与文件

- 合成测试：种子 17、41、509；图像 67×43、179×101、384×224；
  11 类框 × 5 种倍率 × 2 种锚点 × 3 尺寸 × 3 种子，共 990 组。
- 人像测试：已有正面大脸素材的 2 个手动框 × 3 倍率，共 6 组。
  素材是此前生成的测试肖像，不是真人实拍；框不是检测器预测结果。
- 996 组框与 RGB 裁剪像素全部一致；978 组有合法的 >=2 端点尺寸，进行了坐标对拍。
- 8 组重排逐位一致；普通/优化版均执行 SDK 原函数。
- 本地 6 个回归模块共 102 个测试通过，其中 36 个新增；旧 ONNX exporter 仍有弃用警告。
- 三平台公开 CI 已加入 `face_geometry_test` 并通过；macOS 102 个通过，
  Windows/Linux 各 92 个通过、10 个既有 macOS 原生探针跳过。
  本轮 36 个几何测试三平台均执行通过；公开 CI 不包含私有模型或原生对拍素材。

CI 基线为 `b529edfb4b348b6f84f84dca6388877a762e1ebb`，
[运行 36978089198](https://github.com/Quriosity-agent/qcut/actions/runs/36978089198) 三个 job 均为 success。
随后只提交本文及两篇历史文档的链接更新，没有改变已测试的代码或 workflow。

自有实现与探针：

- [face_geometry.py](face_geometry.py)：裁剪框、补黑像素、端点逆矩阵与通用重排。
- [face_geometry_native.py](face_geometry_native.py)：固定版本 macOS arm64 私有原生 oracle。
- [face_geometry_landmark.mm](face_geometry_landmark.mm)：合成张量 provider 的 ABI 桥接。
- [face_geometry_verify.py](face_geometry_verify.py)：真实原生对拍、来源哈希、数值门槛、图片与报告。
- [face_geometry_test.py](face_geometry_test.py)：公开几何、内存生命周期、非法输入与证据保护回归。

本地证据目录：

```text
/Users/peter/Desktop/code/qcut/qcut/.local/jianying-model-pytorch/face-geometry-20261002-r1/
  liblens.arm64.dylib / function-starts.txt / *.asm / verify.log
/Users/peter/Desktop/code/qcut/qcut/.local/jianying-model-pytorch/face-geometry-20261002-r2/
  summary.json / initialized-landmark-order.npy / landmark-shim.dylib
  portrait-box-*-factor-*.png
```

6 张人像图均为“原图、Native 裁剪、自有裁剪、统一 ×8 灰度绝对差分”，
不是剪映 GUI 截图，也不是最终美颜成片。已人工检查代表性全脸图，差分全黑。
原始框、倍率、每组输入/输出哈希及全部坐标误差留在 `summary.json`。

版本绑定：`liblens.dylib` SHA-256
`fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`；
初始化模型 SHA-256
`89e4cf058aa4ec0eceda3ecffe6b5b599b718f58aaadac5e03e5c2c1b2d66227`。
私有 oracle 的 ABI/函数偏移只针对这一版本；不支持拿其他库直接运行。
自有 NumPy 几何模块本身不加载运行库或模型。

## 复现

在 `qcut/` 目录运行，必须选一个不存在的新输出目录：

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
PY=.local/jianying-model-pytorch/tflite/venv/bin/python
env DYLD_LIBRARY_PATH="$R/Frameworks" "$PY" \
  research/local-model-pytorch/face_geometry_verify.py \
  --out .local/jianying-model-pytorch/face-geometry-fresh \
  --image output/beauty-kpop-v6-20261002/source/kpop-front-original.png \
  --box 440,170,570,640 --box 555,380,330,225

cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest \
  espresso_test espresso_package_collect_test native_probe_test \
  espresso_integer_test espresso_integer_export_test face_geometry_test -v
```

需要 NumPy、Pillow，以及 macOS arm64 的已有私有参考运行库和模型；
关键点重排桥接在私有输出目录中使用 `xcrun clang++` 编译。
公开回归不需要厂商运行库或权重。

## 剩余推进顺序

1. 恢复实际启用的检测框解码、分数筛选和 NMS，拿 SDK 的真实框逐项对拍。
2. 用这些框验证 crop -> resize/量化 -> 对齐网络输入，避免手动框掩盖问题。
3. 捕获平均脸叠加前后、旋转变换、Stage2 输入输出；确认每个模型的输出单位和坐标域。
4. 转换对齐网络到 PyTorch/ONNX，先过逐层门槛，再过最终原图关键点像素门槛。
5. 验证侧脸、多人、遮挡、镜像/旋转和视频时序后，才接入 QCut 实验后端并做真实编辑器导出对比。

相关历史：[整数检测器转换](face-integer-conversion-2026-10-02.zh-CN.md)、
[真实网络输入对拍](espresso-real-input-parity.zh-CN.md)、
[模型图恢复](face-espresso-parity.zh-CN.md)。
