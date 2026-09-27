# 美颜界面与输出对齐：第二轮

日期：2026-09-27。分支：`beauty-kpop`。前置证据见 [第一轮观察与测试](beauty-body-ui-observation-2026-09-27.zh.md)。

## 结论与边界

这轮修正可证实的控制项映射和操作体验，不宣称已经复刻全部剪映美颜、美体。

- 开眼角：同源、同尺寸真实导出支持 `face_adjust_inner_corner`，不是旧 `face_adjust_CornerEye`。
- 预览：按逻辑画布/素材尺寸处理，不再随属性面板宽窄改变人脸输入；长边最多 1920，不把所有预览强制升到 4K。
- UI：单行紧凑滑杆、零点标记、单项重置、固定解剖分组顺序、可取消的数值编辑。
- 鼻大小后续已正式接入：当前剪映使用独立 `face_adjust_3DNose_Big` 3D 包，QCut 旧 `face_adjust_nose` 二维液化保留为“2D 基础”。新入口通过五档数值、重置、完整应用重开和真实导出 E2E；另修复输入画布读回差异，重开前后 PNG 哈希严格一致。详见[鼻大小路由根因与正式接入结果](beauty-nose-routing-root-cause-2026-09-27.zh.md)。下文表格保留第二轮历史结果，不代表最终 3D 输出。
- 嘴倾斜、眼倾斜后续已接入独立 `feature-tilt` 包：补齐双向控件、持久化和真实预览/导出，并生成统一增益灰度图。详见[两项缺口的根因、修复与验证](beauty-feature-tilt-parity-2026-09-27.zh.md)；剪映参照当前为 UI 截图，尚非同规格导出验收。
- 嘴部下一轮已收敛为六项同序 UI，复用原有微笑唇算法、补独立笑容路由，并修复叠加嘴部参数后的静帧历史差异；详见[嘴部对齐与组合状态](beauty-mouth-parity-2026-09-27.zh.md)。
- 尚未解决：3D 包仍来自剪映用户缓存，未完成独立离线验收；多角度动态一致性、多人实际视频、完整美体对照与 Windows 原生运行能力仍待验证。

## 剪映真实导出

素材沿用 Pexels 2709386、Ike louie Natividad 的同一张照片，来源与 SHA-256 见前文。剪映 11.3.0 的专用测试草稿 `QCut-Beauty-RealPeople-20260927`，仅操作人脸时间线 02。其它美颜组关闭，每次只开一个参数。导出后把鼻大小归零并关闭五官组，未更改身体时间线。

证据根目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/`。

| 文件 | 参数 |
| --- | --- |
| `jy-face-neutral-4k-20260927.mp4` | 全零 |
| `jy-face-corner99-4k-20260927.mp4` | 开眼角 99 |
| `jy-face-nose-minus48-4k-20260927.mp4` | 鼻大小 -48 |
| `jy-face-nose-plus50-4k-20260927.mp4` | 鼻大小 +50 |

实际规格是 **2160×3240、30fps、5 秒 H.264**，不是 1080p。四段均经过 FFmpeg 完整解码，取 t=2s 为参照 PNG。未点击分享、发布或云备份。QCut 原生探针在相同 `2160×3240` 尺寸渲染 7 个案例，原图及结果保留在 `qcut-comparison/native-4k-calibration/`。

### 对比方法

两端各减自己的零值基线，以减少色彩/编码路径的固定差异。统一缩放到 `600×900`，Gaussian sigma=0.8，取 ROI `(70,195)-(535,750)`。不做几何配准、不修改人脸，也没有把差异图当成质量百分比。

| 剪映参照 | QCut 算子和值 | 变化方向余弦 | 差分 MAE |
| --- | --- | ---: | ---: |
| 开眼角 99 | `CornerEye=99`，旧入口 | 0.499 | 0.764 |
| 开眼角 99 | `inner_corner=50` | 0.888 | 0.210 |
| 开眼角 99 | `inner_corner=75` | 0.970 | 0.134 |
| 开眼角 99 | `inner_corner=99`，修正入口 | **0.987** | **0.103** |
| 鼻大小 -48 | `nose=-48` | 0.459 | 2.272 |
| 鼻大小 +50 | `nose=50` | 0.580 | 1.118 |

零值基线 MAE 约 1.884，说明即便同规格也仍有颜色、缩放、H.264/PNG 路径差异。余弦 0.987 是本照片的差分方向一致性，不是“98.7% 复刻完成”。鼻大小没有足够证据可以用统一倍率修正，故不改其底层参数。

可看 [开眼角四列真实对照](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/eye-corner-export-before-after.png)：剪映零值、剪映 99、QCut 旧算子、QCut 修正算子。精确数值、输入哈希及方法参数在 `qcut-comparison/export-reference-metrics.json`。

## 实现方式

### 控制项身份

`advanced-controls.ts` 将 `face_adjust_inner_corner` 标为“开眼角”，UI 范围 0–100。`catalog.ts` 将旧键 `face_adjust_CornerEye` 标为“眼角扩张（基础）”，归入精修。

**不迁移旧项目和预设，不改 native 参数归一化或包路由。** 旧 CornerEye 仍用 face 包；新入口使用 features 包。已有 inner_corner 负值也不会在加载时被清除；只有用户主动编辑才按新的 UI 范围约束。第一轮修正的鼻高低入口继续保留。

### 紧凑 UI

- 新建局部 `PortraitNumberControl`，不改变其它属性面板共用的 `NumberControl`。
- 每行包含标签、滑杆、数值框、单项归零图标；双向滑杆标出零点，填充从零点延伸。
- 数值框可输入不完整的负号，失焦/Enter 提交并检查有限数、范围、step；Escape 放弃；空串/NaN/Infinity 不写进项目。
- 滑杆仍实时更新，支持键盘、指针取消、结束交互；每项独立重置不清掉其他部位。
- 分组固定为眼睛、鼻子、嘴巴、眉毛、精修等语义顺序，不依赖 catalog 插入顺序。
- 折叠标题使用活动状态点，移除会被误解为“分组启用开关”的假复选框。真正的全局开关继续保留参数，仍可看处理前后。
- 健康离线运行时只显示简短状态；详细信息放悬浮提示。缺包、不可用和检查中仍显示完整提示，不掩盖降级。

### 稳定处理尺寸

`ColorPreviewCanvas` 接受 `portraitRenderSize`。视频/铺满图片用逻辑画布；有独立尺寸的图片用素材的逻辑宽高。启用美颜时长边上限 1920、不上采样；仅调色或缺少逻辑尺寸的旧调用仍沿用最多 480 像素宽的路径。

这不是“所有项目都与导出逐像素一致”：4K 项目仍会降采样，多层裁切、编码和色彩也影响结果。提高处理像素数会增加原生渲染成本，当前未宣称动态美颜能实时满帧播放。现有异步串行队列和过期结果丢弃仍保留。

## 复现与测试

```sh
export QCUT_PORTRAIT_REFERENCE_SOURCE="/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg"
export QCUT_PORTRAIT_REFERENCE_OUTPUT="/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/native-4k-calibration"
QCUT_PORTRAIT_REFERENCE_WIDTH=2160 \
QCUT_PORTRAIT_REFERENCE_FILTER='^(04|11|12|26|30|31)-' \
  bun scripts/audit-portrait-slider-reference.ts

# 剪映导出后，FFmpeg 取 t=2s，PNG 放入 qcut-comparison/jianying-export-4k。
# 科学分析脚本依赖 Pillow 和 NumPy，不是生产依赖。
python3 scripts/compare-portrait-export-reference.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison

# 先构建 electron 和 apps/web。使用未占用端口；E2E 自动创建隔离 user-data-dir。
QCUT_API_PORT=8899 \
QCUT_REAL_PORTRAIT_IMAGE_PATH="$QCUT_PORTRAIT_REFERENCE_SOURCE" \
QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT="/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-compact-calibrated" \
  bunx playwright test portrait-slider-reference.e2e.ts --reporter=line
```

E2E 在自己的临时用户目录关闭“首次素材自动设画布”，固定校准尺寸。否则插入第一个素材后的异步尺寸更新会覆盖测试提前设置的画布。真实 native renderer、预览和编码不 mock，仅保存路径对话框由测试指定。

### 最终验收记录

| 层级 | 实测结果 |
| --- | --- |
| 单元/组件 | 8 个文件，59/59 通过：数值草稿、范围、step、取消、重置、键盘、分组顺序、作用域隔离、运行时提示、预览尺寸和 native 参数兼容 |
| 构建/静态检查 | Electron 构建、web TypeScript/Vite 构建通过；19 个相关 TS/TSX 文件 Biome 通过，`git diff --check` 通过。Vite 仍有既有的 route-test、大 chunk 等警告 |
| 真实编辑器 | 校准 fixture 修正后两轮通过（37.9 秒、41.3 秒）。最终轮包括大眼 100、开眼角 99、键盘 End/ArrowLeft、鼻高低 -48/+50、基础位移 -48、单项/整组重置、再次应用和导出 |
| 缩放稳定性 | 窗口 1800×1100 → 1280×800，等待新帧提交后，处理帧仍为 1080×1620 且 SHA-256 相同 |
| 恢复一致性 | 鼻高低 -48 首次与重置后重新应用，PNG SHA-256 均为 `671044de0a8b04d7b11b33ce1610e6262883349463ac642ddd0bcdaad93b6746` |
| 导出 | 1080×1620、H.264/yuv420p、30fps、1 秒/30 帧，FFmpeg 完整解码通过；不是只检查文件存在 |
| 可见证据 | 10 张完整 UI 图、6 张 native 预览 PNG、导出首帧、report.json；宽/窄窗口均已人工查看，没有文本互相覆盖，窄栏需要正常纵向滚动 |
| 错误 | 最终两轮 renderer page errors 均为 0 |

证据在 `qcut-comparison/editor-compact-calibrated/`。其中 `failure-ui.png` 是早期 fixture 失败的保留快照，不是最终结果；以最新 `report.json` 及成功运行的测试输出为准。前期失败分别定位到：单项重置保留显式零值、首次素材异步改写画布；没有放松效果/导出断言来绕过问题。

- [新版眼睛面板与开眼角 99](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-compact-calibrated/01b-corner99-ui.png)
- [新版鼻子面板与鼻高低 -48](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-compact-calibrated/02-nose-minus48-ui.png)
- [1280×800 窄窗口](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-compact-calibrated/02b-compact-ui.png)
- [实际导出首帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-compact-calibrated/export-frame.png)

静态鼻高低样本中，新预览对本轮导出首帧的全图 RGB MAE 约 3.425，旧 `407×611` 预览放大后的 MAE 约 4.216；固定鼻部 ROI 为 3.943 对 4.078。这支持“处理条件更稳定、预览更接近导出”，不等同于动态质量或剪映整体一致性达标。测试使用本分支构建，未替换 `/Applications` 中的安装版，未发布版本。

## 后续优先级

1. 鼻大小的专用 3D 控制项、stage、旧 2D 兼容和 -50/-25/0/25/50 静态验证已完成。下一步补多角度动态与多人实测、私有资源安装及断开剪映缓存的冷启动验证；不要用统一倍率修正旧算子。
2. 用正面、侧脸、眨眼、说话、手遮挡和多人短片，测试轨迹稳定性、选人、撤销/重做、预设重开及逐帧导出。
3. 美体单独校准瘦腰、腿长、肩宽、天鹅颈；全身参照不要复用这张大脸照片的指标。
4. 建立静止/播放状态的延迟和帧率预算，再决定预览质量策略；不能仅靠提高分辨率解决所有结果差距。

## 灰度改动区域图

按用户要求补充「原图零值参考 / 剪映改后 / 剪映灰度差分 / QCut 改后 / QCut 灰度差分」五列图，不再只看人脸前后对照。

- [总览：大眼、开眼角、鼻高低、鼻大小](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/difference-maps/01-overview.png)
- [眼睛：大眼 50/100、开眼角 99](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/difference-maps/02-eyes.png)
- [鼻子：鼻高低 -48/+50、鼻大小 -48/+50](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/difference-maps/03-nose.png)

黑色表示基本没有像素变化，越亮变化越大。所有图共用固定 ×6 显示增益，255 封顶，**不逐图自动拉伸亮度**。差分是各软件的改后帧减其自己的零值帧，RGB 通道取绝对差均值，不把软件间固定色彩偏差算成美颜；未跨软件直接相减。先统一至 600×900，Gaussian sigma=0.6 轻微预滤波，固定面部裁切 `(70,195)-(535,750)`，没有几何配准或生成式修饰。

第一列显示剪映零参数参考，不冒充两端逐像素相同的基线。QCut 自己的零值图、两边的独立灰度 PNG、未乘显示增益的浮点幅度 `.npy`、来源 SHA-256 和封顶比例均保存在 `difference-maps/` 各案例子目录及 `manifest.json`。

开眼角和鼻大小用同尺寸导出/原生 PNG；大眼和鼻高低用既有剪映界面截图/原生 PNG，图内明确标注“非同规格导出”。它们可用于观察变化位置，但不是统一规格精度验收。灰度是像素变化幅度，不是位移距离、移动方向、算法内部蒙版，也不是美观评分；纹理和边缘会使某些位置更亮。

人工查看上述历史三张图：大眼和开眼角主要变化区域接近；旧 2D 鼻大小 -48 的 QCut 亮区明显大于剪映，并扩展到眼周。这是修复前证据。正式 3D 新入口及更新后的灰度差分见根因文档，不能把这里的旧图当成最新输出。

生成脚本 `scripts/create-portrait-difference-sheets.py`，没有改动产品实现。6 个数学/边界单测通过，覆盖同图全黑、正负通道不抵消、局部变化、固定增益、尺寸不符和非法参数。

```sh
python3 scripts/create-portrait-difference-sheets.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27
python3 -m unittest discover -s scripts/__tests__ -p test_portrait_difference_sheets.py
```
