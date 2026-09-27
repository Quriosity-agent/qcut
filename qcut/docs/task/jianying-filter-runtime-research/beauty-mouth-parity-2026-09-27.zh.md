# 嘴部逐项对齐：界面、参数路由与组合状态

日期：2026-09-27。分支：`beauty-kpop`。本轮只处理嘴部，不等待其它五官审计完成才修复。前置：[嘴倾斜/眼倾斜](beauty-feature-tilt-parity-2026-09-27.zh.md)、[鼻部路由](beauty-nose-routing-root-cause-2026-09-27.zh.md)。

## 本轮结论

1. UI 主入口收敛为剪映同序六项：**白牙、嘴大小、嘴高低、嘴倾斜、微笑唇、笑容**。重复/基础项放在“精修”，旧值和旧参数语义不迁移、不删除。
2. “微笑唇”不是缺算法：QCut 原有“嘴角精修”就是 `face_adjust_mouse_corner`。直接包探针确认本照片正值结果一致，因此只修名称和位置，不增加冗余渲染 stage。
3. “笑容”确实缺路由：补独立 `smile` 包，项目键使用 `face_adjust_Smile`，只在该包内翻译为原生 `face_adjust_SmallFace`，避免覆盖既有“短脸”。
4. 真实 E2E 又发现组合状态缺陷：先调笑容再加微笑唇，与冷启动直接渲染不一致。已修正笑容的静帧历史处理；共享鼻部的输入/参数/时间戳状态策略，不复制一套逻辑。
5. 这是本机原生参照路径的修复，不等于 QCut 独立实现、全平台完成或全部美颜达到剪映精度。

## 剪映证据与 UI 顺序

只读本机资源库：

`/Users/peter/Movies/JianyingPro/User Data/Cache/ressdk_db/515395108782262524/rp.db`

`http_cache` 第 24333 行的 `data.effect_item_list[].common_attr` 与 JSON `extra`，结合剪映 11.3.0 实际嘴部面板核对。素材仍为 Pexels 2709386 / Ike louie Natividad 的静态单人照片，来源见前置文档。

| 剪映项目 | UI 范围 | 原生键 | 资源 ID / 版本 |
| --- | --- | --- | --- |
| 白牙 | 0..100 | `face_adjust`，独立白牙包 | `7408077691880049960` / `314c864e3cac447612ba24e8261eab31` |
| 嘴大小 | -50..50 | `face_adjust_ZoomMouth` | `7408077448513998114` / `aa4932200616e291a252039a3aac7232` |
| 嘴高低 | -50..50 | `face_adjust_MoveMouth` | `7408076336658500864` / `aa4932200616e291a252039a3aac7232` |
| 嘴倾斜 | -100..100 | `face_adjust_MouthTilted` | `7406181636397616419` / `73eaa893dad063f175650f9fcf144f0a` |
| 微笑唇 | -50..50 | `face_adjust_mouse_corner` | `7408077321175026944` / `a56ec77b7f225d51a77b2df6e51d7be6` |
| 笑容 | -100..100 | `face_adjust_SmallFace`，独立笑容包 | `7406174614939880704` / `51d0a761ae1ce8c88b23fb414d009a91` |

测试草稿为 `QCut-Beauty-RealPeople-20260927`，只操作人脸时间线 02。拍摄每项前归零；完成后全零且关闭五官组，未改变身体时间线。

### 微笑唇：纠正最初假设

资源卡 ID 对应目录未缓存，但同版本包存在于：

`Cache/effect/7408076851651874088/a56ec77b7f225d51a77b2df6e51d7be6`

其中 Lua 将 `face_adjust_mouse_corner` 送入 `MouseCorner` 正负实体。QCut 现有 `features` 包也支持此键，路径为：

`Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76`

本照片 600×900、+50 时，两条路径的 PNG SHA-256 相同：

`318740668e7f7f24612d7b59a930bceef5e51f6d3fb2b17a850b927155cb38da`

因此移除了试验性的额外路由，正式实现沿用现有 project key、包和参数范围。这里只证明这张照片/此数值，不外推所有版本和输入。直接包探针的历史输出文件名含 `nose`，应以 `direct-smile-lips/report.json` 的实际 key/value 为准。

### 笑容：同名原生键不能等同项目语义

`smile` 包的 `AmazingFeature/lua/FaceReshapeControlSystem.lua` 将 `face_adjust_SmallFace` 映射至 `wry_smile_all`，接受 `[{id, intensity}]`；内部再做 `intensity * 0.5 + 0.5`。QCut 发送 UI 值 / 100 一次，不额外改变增益。

既有 `face_adjust_SmallFace` 是 face 包的“短脸”。新增 `face_adjust_Smile` 才能分别存储两者；全脸和逐脸向量都只在 smile stage 内翻译。缺 smile 包只禁用笑容，不把它降级到短脸或微笑唇。包解析要求 config、algorithmConfig、main.scene、控制 Lua 齐全。

主面板以外，旧 `MouthCorner`、`mouse`、`mouse_width`、`mouse_position`、上下唇和唇线继续从“精修”访问。没有静默改写旧项目或已有预设。

## 实际发现并修复的组合缺陷

第一次真实 E2E：保存参数成功，但完整退出/重开后的嘴部 PNG 与退出前不一致。不是放松 SHA-256 断言绕过。

用同一份 1080×1620 输入 RGBA、同一时间戳 0 做独立 provider 复现：

| 路径 | 修复前 RGBA SHA-256 |
| --- | --- |
| 冷启动直接渲染笑容 50 + 微笑唇 -25 | `0b7c7f644c8746646db8ef632a23b9a7990e63c0217a1b8bfbf8c2144eefa03c` |
| 先笑容 50，再叠加微笑唇 -25 | `a90e76f8d7741712c32b19ab11ef40992b632eeb72e660f47e0a81c303f2304b` |

上游 `features` 改变了送给笑容 stage 的图像，而笑容 host 沿用上一帧的拟合/跟踪历史。重开是冷状态，所以得到不同结果。

共享 `fitting-frame-state.ts` 后：

- 相同输入和参数复用结果，静态图片的重复帧不推进拟合。
- 暂停帧的输入变化，或该包参数变化，重建对应 host。
- 连续前进且图像变化的视频仍允许跟踪；倒放/大跳转按已有策略重置。
- 只对已有鼻部 3D 与本轮笑容启用该策略，不全局重置所有美颜包。

修复后冷/热两条路径均得到表中 `0b7c...a03c`。这是原生真实像素实验；单测另覆盖上游变化、静帧复用、连续帧和参数变化。多人动作视频仍未验收。

## 原图、剪映、QCut 与统一灰度差分

证据根目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/`。

- [微笑唇 -50/+50](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/comparison/smile-lips.png>)
- [笑容 -100/+100](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/comparison/smile.png>)
- [嘴大小 -50/+50](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/comparison/size.png>)
- [嘴高低 -50/+50](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/comparison/position.png>)
- [白牙 100](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/comparison/teeth.png>)

每张图五列：零值参考、剪映改后、剪映灰度差分、QCut 改后、QCut 灰度差分。各减各自零值；固定增益 ×6、sigma=0.6、统一 600×900、固定面部 ROI `(70,195)-(535,750)`。不配准、不自动拉伸、不生成式修图。

剪映列是 1751×1114 UI 截图的播放器区域，不是同规格无损导出；其中原截图可能有选脸框，面部 ROI 避开框线。浮点差分、来源哈希、裁切和指标保存在 `comparison/report.json` 及各案例目录。`missingRouteDeltaMae` 只是零变化假设的数学基线，不代表旧微笑唇实现没有效果。

| 项目 | 负值/正值差分方向余弦 | 负值/正值差分 MAE |
| --- | --- | --- |
| 微笑唇 ±50 | 0.598 / 0.627 | 0.431 / 0.426 |
| 笑容 ±100 | 0.753 / 0.704 | 1.080 / 0.832 |
| 嘴大小 ±50 | 0.478 / 0.514 | 0.722 / 0.692 |
| 嘴高低 ±50 | 0.741 / 0.749 | 2.046 / 2.012 |
| 白牙 100 | 0.526 | 0.031 |

人工查看：微笑唇主要改变嘴角，笑容主要改变嘴部开合/弧度，嘴高低涉及嘴与附近下巴；两端位置和正负趋势接近，但仍有范围/幅度差异。嘴大小的差异仍较明显；不能从跨分辨率截图直接推导一个强度补偿倍数。

**白牙照片露齿过少，本轮只确认路由有响应，不能验收美白效果。** 后续需要露齿正面、侧脸、说话视频。灰度只表达 RGB 变化幅度，不是几何位移、内部 mask 或美观分数。

## 测试与复现

| 层级 | 当前结果 |
| --- | --- |
| 单元/组件 | 24 文件、157 项通过；含六项顺序、旧项目值保留、缺包、范围/无穷值、逐脸键隔离、stage 顺序及静帧状态 |
| 数学工具 | 11 项 Python 单测通过 |
| 构建 | Electron TypeScript/bundle 与 web TypeScript/Vite 通过；Vite 仍有既有 chunk 等警告 |
| 静态检查 | 本轮 17 个 TS/TSX 文件 Biome 通过，`git diff --check` 通过 |
| 真实 native | 13 个单参数/零值案例已跑通；归零与输入一致；另有直接包探针和冷/热组合复现 |
| 嘴部编辑器 E2E | 已通过：13 个单项档位、组合、独立/整组归零、完整重开、真实导出；renderer page errors = 0 |
| 重开一致性 | 笑容 50 + 微笑唇 -25 的前后 PNG SHA-256 均为 `99e35fa9059ea519fddd0daab60a7c0592e5cebfeecc8a9937ea6ec5b3f8c629` |
| 导出 | 1080×1620、1 秒/30 帧 MP4，FFmpeg 完整解码；已查看首帧和重开 UI |
| 鼻部/倾斜回归 E2E | 通过，1.9 分钟；宽/窄窗口处理像素不变，组合重开 PNG 哈希相同，另一个 30 帧 MP4 完整解码，renderer page errors = 0 |

嘴部实测记录为 `editor/report.json`，截图见 [重开后的六项 UI](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/editor/17-mouth-reopened-ui.png>) 和 [导出首帧](</Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/editor/export-frame.png>)。`editor/failure-ui.png` 保留的是修复前的失败现场，不是最终结果。

鼻部回归一度在缩放窗口后显示素材之外的画面：测试鼠标留在时间线上，激活了 `previewScrubTime`，而非鼻子 native 输出空白。共享测试 helper 在输入前先 hover 数值框，让正常指针移动清掉时间线悬停；没有强行改播放头或放松像素断言。修正后重跑通过，记录位于 `nose-tilt-regression/report.json`。

```sh
QCUT_PORTRAIT_REFERENCE_SOURCE=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_REFERENCE_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/native \
QCUT_PORTRAIT_REFERENCE_WIDTH=600 QCUT_PORTRAIT_REFERENCE_COLD=1 \
QCUT_PORTRAIT_REFERENCE_FILTER='^(16|4[3-9]|5[0-3])-' \
  bun scripts/audit-portrait-slider-reference.ts

python3 scripts/compare-portrait-tilt-reference.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27 --region mouth
python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait_*.py'

# 先构建 Electron 与 apps/web；测试使用隔离的临时用户目录。
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_MOUTH_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/editor \
QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/mouth-fix/nose-tilt-regression \
  bunx playwright test portrait-mouth-reference.e2e.ts portrait-slider-reference.e2e.ts --workers=1 --reporter=line
```

E2E 不 mock 原生渲染、保存或编码，仅替换导出文件对话框。嘴部测试包含多档值、Home/End、独立/整组归零、组合参数、完整应用重开、严格 PNG 哈希和 30 帧 MP4 完整解码。预览输入和截图不提交 Git；原生包、模型和二进制也不提交。

下一轮按部位处理眼睛其余项：先找 UI/映射差异，立即修复已证实的问题，再做原图/两端结果/统一灰度差分。嘴部同规格剪映导出、露齿/侧脸/动态/多人、离线资源安装与 Windows 保持明确的未完成状态。
