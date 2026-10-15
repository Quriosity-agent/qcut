# 美体现状、原生基线与推进顺序

日期：2026-10-15（Australia/Melbourne）。分支：`codex/body-beauty-research`，从最新 `origin/master` 的 `e00c51052` 创建。

本文记录首次静态审计。其后手动美体的 source-window 限制与智能美体冷启动恢复已修复；动态实跑及其验收范围见 [1080p 动态美体预览／导出记录](./body-preview-export-2026-10-15.zh-CN.md)。下文的问题清单保留首次审计语境。

## 结论

美体已有原生产品实现，包括 10 个智能参数和 3 个手动工具。自研美体尚未实现；不能把此前的自研脸型、五官、妆容或人脸视频验收移用于美体。

本轮重新执行原生静态探针：**24/24 通过**，四个目标效果包均来自 QCut 本机私有快照。它证明当前代码可以驱动美体，并不证明剪映 UI 像素一致、1080p 动态视频质量或预览／导出一致。

同时修复手动控制框把屏幕包围盒当成素材局部尺寸的问题：旋转或缩放后绘制和拖动均使用正确的 SVG 局部尺寸。新增 5 个组件回归，以及加载实际 QCut 组件的 4 组 Chromium 变换检查，修复前失败、修复后通过；其余链路缺口单独列明。

## 两套原生机制

| 路径 | 输入与作用 | 实现与限制 |
| --- | --- | --- |
| 智能美体 | 720×1280 等原图 → 原生算法图的 360×640 输入 → 人脸／身体骨骼 → 身体形变 | `body` 包，`tt_skeletonsquat` 模型；整帧统一参数，不支持选择其中一人的身体 |
| 手动美体 | 原图＋用户定义的边界／矩形／圆形 → 可变形网格 | `manual-stretch/slim/zoom` 三包；算法图 `nodes=[]`，无需骨骼模型 |

智能参数：小头、天鹅颈、瘦手臂、直角肩、瘦身、瘦腰、长腿为 `0..100`；宽肩、胸型、美胯为 `-50..50`。目录及参数发送在 `electron/jianying-portrait-adjustment-runtime/catalog.ts`。

手动三工具强度均为 `-50..50`，发送原生前除以 100；拉长使用 `upper/bottom`，瘦身使用 `x/y/width/height/rotation`，缩放使用 `x/y/radius`（原生键 `r`）。坐标是素材局部归一化坐标，见 `manual-body.ts`。

自动包的 Lua 只取强度向量第一个元素，不读取人物 ID；QCut 因此发送单条 `{id:-1,intensity}`。`SLIM_LEG` 枚举存在不等于当前包能消费独立自动瘦腿参数；手动“瘦身瘦腿”是另一条路径。

当前 stage 顺序包含 `manual-stretch → manual-slim → manual-zoom → … → body`。自动和手动混合时，顺序会影响输入骨架和最终像素，后续必须锁定组合顺序。

## 产品与自研接线

| 部位 | 当前状态 | 证据入口 |
| --- | --- | --- |
| 时间线智能＋手动美体 | 已有滑杆、区域、撤销／重做、项目保存和预设 | `components/editor/properties-panel/portrait/portrait-manual-body-controls.tsx`、`stores/editor/portrait-manual-body-store.ts` |
| 美颜实验室 | 有智能美体和美体预设，没有手动区域编辑工具 | `components/editor/properties-panel/beauty-lab/beauty-lab-controls.tsx` |
| 原生预览／导出 | 共享 portrait provider；参数会传入导出 | `lib/export/export-engine-renderer.ts` |
| 精确暂停合成预览 | 任何 `manualBody` 对象都会让 native source-window 不适用，包括强度全零但保留几何的情况 | `lib/portrait/portrait-temporal-policy.ts`、`lib/preview/canvas-composition-frame.ts`、`electron/jianying-portrait-adjustment-runtime/source-preroll.ts` |
| 美体关键帧 | 没有；现有关键帧是位置、缩放、旋转、裁剪等媒体属性 | `lib/video/video-properties.ts` |
| 自研智能美体 | catalog 没有 body，能力列表及 planner 拒绝 `body_adjust_*` | `electron/beauty-lab/beauty-lab-independent.ts`、`research/independent-beauty/src/independent-pipeline-plan.ts` |
| 自研手动美体 | adapter 明确拒绝非零手动工具，IPC schema 不接受非空 manualBody | `lib/portrait/independent-portrait-adjustments.ts`、`electron/beauty-lab/beauty-lab-independent.ts` |

上表省略的前端路径前缀为 `apps/web/src/`。

独立仓库当前 worker 只载入 face/skin/matting；虽然私有 `runtime/Models` 中有身体 `.model` 文件，本轮没有找到已接入的 skeleton ONNX、执行器、关键点解码和坐标回映。旧页面“网络能跑、关键点解码没写”的文字不能作为当前网络运行证据。

QCut 已有可复用的网格栅格化、场插值、CPU／Metal 采样及 stage／RGBA hash 证据机制。standalone 还有 portable raster/liquefy，但它们不是已经完成的美体算法；迁移还需 body shader 契约、原生输出对照和 source manifest 更新。当前开发 runtime/.venv 通过符号链接依赖 `/Volumes/QCutBeauty/qcut-beauty-standalone/runtime` 等外部资源。

## 本轮原生实跑

证据目录（本机私有，不入 Git）：

```text
.local/jianying-parity/body-beauty-audit-20261015-r1/
  body-probe.ts / body-probe.cjs
  current.log
  resource-verification.json
  current/
    report.json / status.json / manifest.json
    index.html
    original.png
    <case>.png / <case>-diff6.png
    <selected-case>-comparison.jpg
```

用 Node 25.7.0 执行当前源码的 CommonJS bundle，同时设置 `QCUT_JIANYING_DISABLE_APP_BUNDLE=1` 和 `QCUT_JIANYING_DISABLE_USER_CACHE=1`。探针只要求四个目标包存在、ready 且来自 `qcut-private`；保留完整 inspect 状态。

| 检查 | 数量 | 结果 |
| --- | ---: | --- |
| 10 个智能参数端点（含 3 个双向参数的两端） | 13 | 全部产生像素变化 |
| 3 种手动工具，各测 -50 与 +50 | 6 | 全部产生像素变化 |
| 初始零值、保留手动几何的零值、组合后归零 | 3 | 均与输入 RGBA 逐字节相同 |
| 智能瘦身／瘦腰／长腿＋三种手动工具组合 | 1 | 产生像素变化 |
| 清空 provider 后再次智能瘦身 100 | 1 | 与前次同参数输出逐字节相同 |

全部 24 帧尺寸保持 720×1280，alpha 最大差为 0，输入 RGBA hash 不变。一次瘦身重跑一致不能推广为所有参数、时序和机器都确定。

代表性变化像素数：智能瘦身 227,513，瘦腰 26,808，长腿 487,946，组合 906,597。静态 provider 实测同一智能包后续请求约 163–170 ms，手动单项请求约 362–480 ms（工具切换会重建宿主），首次智能约 1.17 s，组合约 1.85 s。未作稳定热启动基准；这些耗时不是播放 FPS 或完整导出性能。

原始测试图片沿用旧审计的 `body-original.png`。旧报告将源文件指向含 `ChatGPT Image` 的文件名，真实拍摄来源没有验证。本轮明确把它当静态算法 fixture，不能作为真人运动或多体型代表性样本。所有对比图中的“原生”均是 QCut 调用本机运行库，不是重新从剪映 UI 导出的独立参考。

`current/report.json` SHA-256：`a3ae3eaa33ac6bb58e9d5cd7bf6ebc302d34a5351b18be7774c9cdce6c9b9dd5`。

## 资源与旧验证入口的问题

当前私有快照实际为 `D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397`，与旧手动报告里的快照后缀不同。本轮对四个效果包及 `tt_skeletonsquat` 共 **87 个文件**重算大小与 SHA-256，87/87 与 manifest 一致。manifest SHA-256 为 `5e56e9b459132c10bbf3b75e73006b4d2ffd98137ae2916c87a3eada36bbeb1d`。

旧 `bun scripts/verify-jianying-manual-body.ts` 在当前 Bun 1.3.9 下因 `node:sqlite` 导入失败。改为 Node bundle 后，又因脚本要求全目录 `offlineReady` 而退出。全目录还缺部分脸型／鼻部包、14 张美妆卡及 4 个肤色，这不代表四个美体包缺失。以上两次失败保留在 `manual.log` 和 `manual-r2.log`，不计入成功。

旧自动审计脚本直接转为 CommonJS 还遇到顶层 await 构建限制。本轮另建私有目标探针执行真实 provider，没有把旧命令标为通过，也没有修改产品的可用性判断。

## 已确认的问题与后续验收

1. **手动区域坐标错误：本轮已修。** overlay 原先以 `getBoundingClientRect()` 的变换后宽高绘图，却先用逆 `getScreenCTM()` 把鼠标恢复到 SVG 局部坐标，再除以变换后的宽高。100×200 的 SVG 旋转 90° 后，中心会从正确的 `(0.5,0.5)` 被算成 `(0.25,1)`。现改用 computed CSS 局部宽高，保留小数并以 client 尺寸兜底；逆 CTM 和原生参数保持原协议。
2. **手动美体的精确预览／导出闭环。** 不能直接去掉 source-window 限制；先用单工具 1080×1920 动态素材验证同帧输入、手动区域坐标、seek／取消／恢复，再叠加自动美体、裁剪和转场。比较暂停预览与编码前 Canvas，并单独分析有损导出。
3. **自研先完成 manual stretch。** 无需骨骼模型；建立原图→区域形变→PNG 闭环，零值 identity、正负值、竖屏／横屏、边界、alpha 和同原生参数差分全部可测，再扩展 slim／zoom。接入统一参数、能力声明和预览／导出，避免只增加按钮。
4. **智能自研先完成骨骼输入输出。** 固定模型与包身份，按原图→模型输入→原始 tensor→关键点解码→原图覆盖图验收；随后才能定义各身体部位的 warp。多人 identity、遮挡与重新出现是独立阶段。
5. **预设语义待明确。** 当前纯智能美体预设会保留片段已有的手动变形；相同预设因此可能受历史状态影响。本轮记录行为，不自行改变预设覆盖约定。
6. **补真实样本与视频质量。** 不同体型／姿态／服装、复杂直线背景、身体出框、遮挡、多人、真实运动、长时内存、音画同步、背景形变均未完成验收。身体磨皮／美白也没有确认独立参数和模型闭环。

历史手动 E2E 是静态图片导出 1 秒；代码只检查 MP4 文件大小并抽一帧，没有预览／导出像素差或完整解码门禁。现有相关单测通过与这条验收缺口并不冲突。

## 坐标修复的回归证据

新增 `apps/web/src/components/editor/preview-panel/__tests__/portrait-manual-body-overlay.test.tsx`：旋转、非等比缩放、翻转缩放下的实际组件绘图／拖动与一次撤销记录，小数尺寸 resize，以及挂载后进入手动编辑。5 项在修复前全部失败，修复后全部通过。

Chromium 隔离页面加载实际 `PortraitManualBodyOverlay` 和 store，检查 90° 旋转、旋转＋非等比缩放、镜像缩放、镜像＋旋转＋缩放四种情况。检查真实 SVG 尺寸、圆形区域位置和真实 pointer 拖动后的归一化坐标；4/4 场景从失败转为通过。它是组件集成验证，不是完整编辑器原生渲染 E2E。

证据位于上述私有目录的 `overlay/`：`vitest-red.log`、`vitest-green.log`、`red-browser.json`、`green-browser.json`、红绿截图和 `browser-check.mjs`。5 套定向回归共 19 项通过，包含新增 5 项；此前审计的 11 套 118 项也通过，计数有重叠，不相加。另跑自研 planner／adapter／网格采样等小范围测试，没有据此声明自研美体可用。

首次 web 类型检查发现本地依赖仍是旧分支的 Mediabunny 1.50.8，而新 master 的 package/lock 已锁定 1.61.4。按现有 lock 执行 `bun install --frozen-lockfile` 刷新环境，未更改音频导出代码或依赖声明。重跑 `bunx tsc --noEmit --pretty false -p apps/web/tsconfig.json` 通过；修改的组件和测试文件 Biome 检查通过，`git diff --check` 通过。
