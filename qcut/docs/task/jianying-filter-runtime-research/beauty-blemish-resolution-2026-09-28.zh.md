# 祛斑祛痘：保留模型输入细节

日期：2026-09-28。分支：`beauty-kpop-v2`。承接[同尺寸导出基线](beauty-skin-export-2026-09-28.zh.md)。

## 结论

已缩小同一真人照片上 QCut 与剪映的祛斑祛痘差距：50/100 档真实导出的面部有符号差分 MAE 分别下降 **19.4% / 33.1%**。不是通过放大滑杆强度，而是在模型处理前保留更多原图细节。

修复前，4000×6000 照片先缩到项目的1080×1620，再进入原生祛斑模型。修复后，这个案例以2160×3240进入模型，最后缩回1080×1620进行合成和编码。预览与导出共用尺寸策略；显示尺寸、项目尺寸、滑杆范围、模型包和原生强度映射均未改变。

**这证明处理分辨率是当前差距的一个因果变量，不证明剪映内部固定使用2160×3240。** 100档眼周青紫色边仍存在，不能宣布完整精度或美观验收。

## 证据与排除项

1. 私有目录与当前安装剪映中的祛斑效果包递归比对一致，包为 `7442228961163088434/e8b424917121b52fc69cba119274cc47`，图为 `newbandou`。没有复制新模型、调整事件或改写资源。
2. 同一1080输入，0/50/100分别连续调用12次，首尾像素哈希一致。此静态样本不支持“GAN尚未准备好”这一解释。
3. 仅将 Canvas `imageSmoothingQuality` 改为 `high`，本机Electron的采样像素和8案例导出均未变化；已撤销这项无效改动。显式高质量ImageBitmap重采样改变了像素，但没有改善匹配，也未采用。
4. 用浏览器解码的同源照片做受控原生探针：1080处理的差分余弦为0.503/0.513，2160处理提升到0.915/0.929。换用另一图像解码器会改变结果，因此没有拿非浏览器输入的探针代替产品验证。
5. 人脸检测模型2.5与PC2.3的替换实验未带来明确改善，未采用。QCut私有原生库与当前剪映11.3的UUID不同；直接尝试新版库被现有UUID保护拒绝，没有绕过保护、补猜测偏移或替换共享运行库。版本差异仍是未分离变量，不能断言它导致剩余误差。

## 实现与边界

- `apps/web/src/lib/portrait/portrait-processing-size.ts`：统一读取图片、视频、Canvas、ImageBitmap或VideoFrame的真实源尺寸；仅美颜启用且全局或单人 `face_adjust_SpotAcne > 0` 时增加处理尺寸。
- 放大系数取以下最小值：2倍、源宽/目标宽、源高/目标高、4096边长预算、3840×2160像素预算。不凭空超过源细节；输入不足、零值、关闭和其它独立控件保持原尺寸。预算只限制新增放大，不主动缩小已有更大目标。
- `apps/web/src/lib/color/browser-color-rendering.ts`：在原生模型前使用上述尺寸；最终合成仍使用原目标位置与尺寸。
- `apps/web/src/components/editor/preview-panel/color-preview-canvas.tsx`：在第一次object-fit之前保留源细节，避免预览先缩小后再放大；显示Canvas尺寸不变。

策略也会用于启用祛斑的组合参数与视频源。因此组合中的其它算法可能受到处理尺寸变化影响，不能把“单独磨皮未变”扩大为“所有组合均逐像素不变”。本轮组合功能回归通过，但未完成组合效果与剪映的逐项精度对比。

代价是更多像素和原生计算。同机8段导出的整组E2E耗时由约1.5分钟到约2分钟，包含界面、加载和解码，不是纯模型基准。移动视频、多人、Windows/x86的性能和时序效果尚未验收。

## 真实导出结果

原图：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg`。

SHA-256：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。原始文件保留不改动。

剪映参考沿用上轮已采集的8段导出，没有重新生成或修饰。QCut在隔离用户目录中运行真实Electron编辑器，导入、设置、预览、导出；仅保存文件对话框替换为测试路径，原生模型与编码不mock。

两端均H.264、1080×1620、30fps、5秒、150帧、BT.709有限范围。完整解码16段共2400帧，抽取0/60/149帧。不是无损编码精度对比。

第60帧统一到600×900，面部ROI `(70,195)-(535,750)`，Gaussian σ=0.6。每端效果减自身零值，灰度显示固定×6，不逐图归一化、配准或曝光补偿。下表是有符号RGB差分之间的余弦和MAE，MAE单位0..255，不是美观评分：

| 档位 | 修复前差分余弦 | 修复后差分余弦 | 修复前差分MAE | 修复后差分MAE | MAE下降 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 | 0.4804 | 0.8743 | 2.2092 | 1.7798 | 19.4% |
| 100 | 0.5063 | 0.9183 | 3.5377 | 2.3662 | 33.1% |

额头、脸颊的改动范围更接近，但幅度并非完全吻合。50档剪映面部平均绝对改动为2.129，新QCut为2.506；100档分别为3.922、4.189。高分辨率再缩小也会改变细纹理与背景采样，不能把残差全部当作模型误差。100档眼周色边在两端都存在，仍需要单独定位与质量修复。

零值前后漂移均为0，色彩契约一致。QCut六个非祛斑案例（零值前后、磨皮50/100、清晰50/100）的导出首帧PNG SHA-256相较修复前全部不变。这一结论只针对这些案例与首帧，不扩大到任意素材。

## 测试

- 41项Vitest通过：处理尺寸19项、共享浏览器渲染6项、预览5项，以及既有Canvas池、原生美颜和颜色渲染测试。覆盖单人/组合参数、源尺寸限制、内存预算、固有图片尺寸、预览不二次放大、最终尺寸/位置不变及不可用时回退。
- 29项Python测试通过；新增5项对比协议测试覆盖来源不一致、固定增益/尺寸/帧/模糊方式不一致、缺失一侧诊断、零值漂移与色彩契约异常。
- 两组真实Electron E2E通过：8案例导出矩阵；8个皮肤控件各50/100、复位、键盘、窄窗口、保存重开及组合导出。真实模型与编码均执行。
- `bun run build:electron`、Biome及 `git diff --check`作为提交前检查；构建保留已有路由测试文件和chunk大小警告。

## 保存的证据

根目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/spot-acne-gap/`。

- `qcut-supersampled/`：修复后8段MP4、参数界面、预览PNG、导出截图、首帧与报告。
- `comparison-supersampled/`：三项对照、总览、48张解码帧、固定增益灰度PNG、原始浮点NPY与结构化报告。
- `before-after/blemish-before-after.png`：50/100两行，原图零值、剪映效果/灰度、旧QCut效果/灰度、新QCut效果/灰度。
- `before-after/report.json`：本表原始数值、16张输入图的哈希及方法约束。
- `skin-regression/`：八项16档及组合回归证据。
- `probe-canvas-1080/`、`probe-canvas-2160/`：受控浏览器输入的原生诊断，不代替编辑器导出。

旧基线保留于 `../skin-export/comparison-fixed/`，剪映视频与manifest保留于 `../skin-export/jianying/`。无效或失败实验目录也保留，但不计为通过结果。图片、模型和原生二进制不提交Git。

## 复现

在仓库 `qcut/` 目录执行，先在 `apps/web/` 运行 `bun run build:electron`。以下SOURCE和ROOT均指本地证据路径：

```bash
SOURCE=/path/to/face-ike-louie-natividad.jpg
ROOT=/path/to/evidence
QCUT_REAL_PORTRAIT_IMAGE_PATH="$SOURCE" \
QCUT_PORTRAIT_SKIN_EXPORT_OUTPUT="$ROOT/qcut-supersampled" \
  bunx playwright test portrait-skin-export-reference --workers=1 --reporter=line
QCUT_REAL_PORTRAIT_IMAGE_PATH="$SOURCE" \
QCUT_PORTRAIT_SKIN_E2E_OUTPUT="$ROOT/skin-regression" \
  bunx playwright test portrait-skin-reference --workers=1 --reporter=line
python3 scripts/compare-portrait-skin-exports.py \
  "$ROOT/qcut-supersampled/report.json" \
  /path/to/skin-export/jianying/manifest.json "$ROOT/comparison-supersampled"
python3 scripts/compare-portrait-blemish-revision.py \
  /path/to/skin-export/comparison-fixed "$ROOT/comparison-supersampled" "$ROOT/before-after"
python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait*.py'
```

新增对比脚本复用已有灰度和度量实现，拒绝来源、方法、零值或色彩契约不匹配的报告，并确认新旧剪映参考像素完全一致。

## 下一步

先单独定位100档眼角/发际色边，区分模型输出、面部蒙版与缩放合成；再增加一张低纹理正脸和一段运动视频，检查脸框尺度、时间稳定性与性能。本轮只验收macOS arm64、单张高分辨率真人照片的差距收敛。
