# K-pop 正面大脸：19 款美妆与剪映对照

日期：2026-10-02。分支：`codex/kpop-beauty-v6`，基于 master `5e453bfdb58570da093d426acec3b5ccbd7e2bcd`。

这是新的同源配对测试，不把上一轮真人照片的结果计入本轮。结果素材仅在本机 `output/` 中保存，不提交供应商模型、效果包或封面。

## 素材来源

使用内置图像生成工具生成一张虚构成年女性的 K-pop 风格正面头肩照片，提示词明确年龄 25 岁、不模仿具体明星。它不是韩国女团成员的真实照片。

原图为 1448×1086 PNG，4:3，正面、中性表情、头发不遮眉耳、均匀中性光、灰色背景、少妆基线。生成图不保证物理上完全无妆，但双端使用同一文件，并分别减去自己的零值。

```text
/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v6-20261002/source/kpop-front-original.png
SHA-256: 5c76fa2eb885de93c1d034b1918d61f94cdaf97a2e1b3f25ce4c68ba3c1b31f9
```

相邻 `source/provenance.md` 保留原始生成路径、完整提示词和来源说明。仅原图来自生成工具；后面的美妆结果均为剪映或 QCut 的实际输出。

## 证据目录

以下路径均相对本机证据根目录：

```text
/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v6-20261002/
```

| 路径 | 内容与状态 |
| --- | --- |
| source/ | 未修改的原图与来源说明 |
| jianying/manifest.json | 19 款同款、同值的真实界面与结果截图及哈希 |
| jianying/aegyo-natural-recheck-*.jpg | 卧蚕重新选择、数值确认和重复帧复核 |
| jianying/recheck.json | 复核哈希、播放器范围与零值恢复结果 |
| editor-first-occluded/ | 首次截图超时的失败报告，不计作通过 |
| editor-export-size-mismatch/ | 19 款已运行但导出尺寸断言失败的报告，不计作通过 |
| editor-final-pass/report.json | 最终完成的 QCut Electron E2E 报告 |
| editor-final-pass/export-frame.png | 真实组合效果 H.264 导出的首帧 |
| paired/index.html | 19 款对照图库入口 |
| paired/overview-1.png 至 overview-7.png | 全部 19 款的七页总览，已逐页目视检查 |
| paired/report.json | 同源验证、参数配对、差分设置、未配对项与输入哈希 |

每款还保存单项脸部图、全画幅图和各端零值、改后、灰度差分 PNG，可查阅 `<card-id>.png`、`<card-id>-full.png` 及 `<card-id>/`。

## 剪映采集

本机剪映专业版 11.3.0。另建测试草稿「10月2日」，只导入这张 PNG，生成 5 秒静帧素材；未在原有创作草稿「9月26日」中测试或修改效果。

关闭皮肤管理、脸型和五官精修，每次只启用一个美妆分类。跨分类先选“无”清除前项，同类换卡替代旧卡。保留实际选中卡片与程度数值的截图，不靠文件名判断参数。

冻结播放器在 `00:00:00:14`，截图前点击该时间线位置，避免鼠标预览落在 5 秒素材之外产生黑帧。结果截图切回“基础”页，排除青色人脸检测角标。

- 原始全窗口截图：1956×1247 JPEG。
- 播放器裁剪：`[637, 81, 1409, 660]`，772×579，4:3。
- 脸部展示裁剪：播放器内部 `[215, 65, 555, 475]`。
- 19 组界面/结果文件的尺寸和 SHA-256 均已校验。
- 前后零值播放器 RGB 漂移为 0。
- 氧气感另存 `look-oxygen-selection.jpg`，确认选中卡片；其程度 80 截图因素材网格展开而位于下方。

卧蚕的差分较弱，因此重新点击「自然」、确认程度 80，并切回基础页连续复采两张。新、旧播放器 RGB 最大差为 0，重复帧差为 0，排除了该样本未完成渲染的疑点；随后选“无”恢复零值，恢复后与初始零值也逐像素相同。完整窗口哈希会随自动保存时间变化，稳定性只比较固定播放器区域。

## 本轮款式

| 分类 | ID | 名称 | 程度 |
| --- | --- | --- | ---: |
| 套装 | look-oxygen | 氧气感 | 80 |
| 口红 | lip-soft-pink | 柔和粉 | 80 |
| 口红 | lip-coral-nude | 珊瑚裸粉 | 80 |
| 腮红 | blush-baby-pink | 婴儿粉 | 80 |
| 修容 | contour-mixed | 混血 | 80 |
| 卧蚕 | aegyo-natural | 自然 | 80 |
| 眉毛 | brows-standard | 标准眉 | 80 |
| 眉毛 | brows-fluffy | 绒绒眉 | 80 |
| 眉毛 | brows-wild | 野生眉 | 80 |
| 眉毛 | brows-warrior | 侠客眉 | 80 |
| 眉毛 | brows-classical | 古韵眉 | 80 |
| 眉毛 | brows-soft | 淡颜眉 | 80 |
| 睫毛 | lashes-natural-ii | 妈生感 II | 80 |
| 眼线 | eyeliner-natural | 自然 | 80 |
| 眼线 | eyeliner-cat | 小野猫 | 80 |
| 眼影 | eyeshadow-girl-pink | 少女粉 | 80 |
| 美瞳 | contacts-natural | 原生美瞳 | 80 |
| 高光 | highlight-sweetheart | 美式甜心 | 70 |
| 雀斑 | freckles-sunburn | 晒伤雀斑 | 50 |

这覆盖 QCut 当前 19 个非旧项目兼容选择项、12 个分类，不是剪映完整素材库。

## 差分方法与目视结论

并排列为：剪映零值参考、剪映改后、剪映灰度差分、QCut 改后、QCut 灰度差分。QCut 原始输入/零值在单项子目录中单独保存。

各端分别计算自己的 `mean(abs(Gaussian(改后)-Gaussian(零值)), RGB)`，σ=0.6，统一线性增益 ×6，超过 255 封顶。QCut 基线与结果以同样的 Lanczos 缩放至剪映播放器尺寸。未逐张自动增强，未做几何配准。黑色表示没改或变化小，亮色表示变化幅度大，不表示效果更好。

| 部位 | 本轮实际观察 | 仍需验证的差距 |
| --- | --- | --- |
| 氧气感 | 两端都主要改变嘴唇、眼周与面部修容区域，整体接近 | 眼周/鼻侧的细轮廓与纹理仍有残差 |
| 两款口红 | 改动集中在同一唇部，色调及外轮廓接近 | 唇缘颗粒、局部亮度与细节不能判定逐像素一致 |
| 六款眉妆 | 六款各自真实运行，作用位置、眉弧及样式变化接近 | 眉头/眉尾、毛流贴图仍存在细节差异 |
| 腮红、修容、高光 | 主要面颊、鼻梁/鼻侧区域接近，没有明显错贴到背景 | 局部覆盖和柔化边缘有差别，JPEG 噪声影响亮度判断 |
| 卧蚕、睫毛、眼线、眼影 | 大体在正确眼周区域生效，猫眼尾部方向接近 | QCut 部分细线更集中、更清晰；剪映差分更分散，卧蚕细轮廓尤其不相同 |
| 美瞳 | 变化集中于双眼虹膜 | 虹膜边缘与局部纹理尚未通过同规格无损导出判定 |
| 雀斑 | 两端都主要作用在双颊及鼻侧 | 颗粒分布与局部细节残差仍可见 |

`paired/report.json` 的 RGB 平均变化是诊断数，不是接近程度评分。剪映 JPEG 与 QCut PNG 的编码及采样不同；不能通过平均值比例调整强度，也不能把截图噪声判成算法错误。本轮没有修改强度映射或更换原生运行库。

UI 已检查 QCut 1280×800 和 1800×1100 两种窗口：分类自动换行、卡片保持方形，所有按钮位于面板内，均无横向溢出。缩略图分别约 47.14px 和 64px。分类名称、程度控件和卡片方式接近剪映，但 QCut 当前每类可选素材明显少于剪映，不宣称 UI/素材库完全一致。

## E2E 与排查

首轮在切换至剪映窗口后，QCut `page.screenshot` 超时。它是失败，不作为渲染通过；未稳定复现或证明窗口遮挡为唯一根因。后续分开运行，不交叉切换窗口。

第二轮完成 19 款与保存重开，但错误地要求默认导出等于固定宽 1080 的测试画布 `1080×810`；实际导出为 `1440×1080`。代码确认 `resolveExportResolution` 按短边定义 1080p，4:3 导出该尺寸正确。这是测试规格错误，不是用户导出链路故障。

本轮测试改为复用已有导出尺寸解析函数生成参考画布，导出助手通过真实 UI 明确选择 1080p。最终仍严格断言导出等于画布。对照脚本根据报告校验实际画布，不再硬编码 1080 方形，并拒绝非对象、布尔值、浮点、奇数、越界尺寸或导出不匹配；无 `canvasSize` 的历史方形报告保留兼容。

最终 `editor-final-pass/` 的 Electron E2E 约 1.9 分钟通过：

- `completed:true`、页面错误为空、分类切换草稿回归通过。
- 19 张实际封面全部解码，19 次独立应用，每款归零保留选中、恢复原输出哈希、“无”清除均通过。
- 组合柔和粉 50 与小翘鼻 50，缩放及保存退出重开后输出哈希一致。
- 导出 1440×1080、H.264、yuv420p、TV range、BT.709 色彩三项、30 fps、1 秒。
- 30 帧全部解码，首帧已目视确认非黑且主体完整。不是 19 款逐款视频导出，只导出了该组合。
- 同源、同款、同值配对完成 19 组，未配对项为 0；七页灰度总览全部目视检查。

其他本轮检查：Python 人像工具单测 82 个通过，其中本对照校验 13 个；导出尺寸 Vitest 3 个通过；三个 TypeScript 改动文件的 Biome 检查及 `git diff --check` 通过。没有重建生产应用，本轮只改测试/证据工具，实际 Electron 使用此前本机已构建的应用。

## 复现

在仓库子目录 `/Users/peter/Desktop/code/qcut/qcut` 执行，并使用未占用的 API 端口和新的输出目录：

```bash
QCUT_API_PORT=8906 \
QCUT_REQUIRE_PORTRAIT_COVERS=1 \
QCUT_PORTRAIT_MAKEUP_ONLY=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH='/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v6-20261002/source/kpop-front-original.png' \
QCUT_PORTRAIT_FEATURE_E2E_OUTPUT='/absolute/path/to/new-editor-evidence' \
bunx --no-install playwright test \
  apps/web/src/test/e2e/portrait-feature-makeup-reference.e2e.ts \
  --project=electron --workers=1 --reporter=line

python3 scripts/compare-portrait-feature-makeup.py \
  /absolute/path/to/new-editor-evidence \
  output/beauty-kpop-v6-20261002/jianying/manifest.json \
  /absolute/path/to/new-paired-gallery \
  --title 'K-pop 正面大脸美妆对照'

python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait*.py'
bunx --no-install vitest run apps/web/src/types/__tests__/export-resolution.test.ts --reporter=dot
```

需要本机已就绪的原生运行库及合法取得的资源；缺少资源不能靠跳过封面/运行断言冒充通过。E2E 期间不要同时操作剪映窗口。

## 边界与后续

本轮是单张静态、生成的正面大脸，不是多真人、连续运动、侧脸、遮挡或多人测试。配对证据为剪映 UI 截图对 QCut 编辑器画布，不是同规格双端导出的像素精度验收。

后续优先取同尺寸、同色彩的剪映无损零值和眼周改后导出，逐项排查卧蚕、睫毛、眼线的轮廓；再验证运行库/模型版本及输入采样条件。不要用强度乘数抵消截图压缩差，也不要把本轮接近的静帧推广为所有脸型、所有视频都已对齐。
