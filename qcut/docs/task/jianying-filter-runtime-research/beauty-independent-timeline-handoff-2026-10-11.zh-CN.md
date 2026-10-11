# 自研美颜接入时间线：交接

更新：2026-10-11。分支：`beauty-video-timeline`，PR：https://github.com/Quriosity-agent/qcut/pull/496 。
起点：master `8a9e44ffd`（v2026.10.11.2）。工作目录：仓库内的 `qcut/`，Git 根目录是它的上一级。

先读本文，再读[技术记录](beauty-independent-timeline-2026-10-11.zh-CN.md)。后者包含设计细节、限制和逐项实测。

## 当前状态

- 功能已接通，并用真人视频跑过端到端测试。
- PR #496 已开，**未合并、未发布**。CI 状态以 PR 页面为准。合并和发布都要等用户明确要求。
- 本地单元测试、类型检查、lint 都通过（数字见 PR 正文）。

## 用户定下的范围

用户在「先接通时间线」和「先做性能」之间选了前者，原话是：

> 每个片段可选「原生 / 自研」；导出时自研逐帧处理，显示进度、可取消，并缓存已处理帧，重复导出不用重算；暂停时预览显示自研结果，播放时显示原图。速度先接受现状并在界面标明，下一步再做性能。

另外有一条贯穿始终的要求：**自研不支持的参数不能悄悄改用原生**。

## 代码入口

| 层 | 文件 | 作用 |
| --- | --- | --- |
| 数据 | `packages/editor-core/src/portrait-adjustments.ts` | `engine` 字段；normalize 只保存 `"independent"` |
| 主进程 | `electron/beauty-lab/beauty-lab-independent-queue.ts` | 美颜实验室、预览、导出共用的排队，可按 requestId 取消 |
| 主进程 | `electron/beauty-lab/beauty-lab-independent-frame-cache.ts` | 按内容寻址的磁盘帧缓存，4 GB 上限，最近最少使用的先淘汰 |
| 主进程 | `electron/beauty-lab/beauty-lab-independent-frames.ts` | IPC `beauty-lab:render-independent-frame`：先查缓存，未命中再排队调用引擎 |
| 主进程 | `electron/beauty-lab/beauty-lab-independent-services.ts` | 引擎路径（开发 / 打包）与上面三者的组装 |
| 渲染端 | `apps/web/src/lib/portrait/independent-portrait-adjustments.ts` | 参数转换；不支持的项作为问题返回 |
| 渲染端 | `apps/web/src/lib/portrait/independent-portrait-frame.ts` | 单帧调用、透明边恢复、取消、可读的报错 |
| 渲染端 | `apps/web/src/lib/color/browser-color-rendering.ts` | `portraitAdjustedSource` 按引擎分流 |
| 预览 | `apps/web/src/components/editor/preview-panel/color-preview-canvas.tsx` | 播放跳过、暂停处理、放弃旧帧、失败提示、处理中角标 |
| 导出 | `apps/web/src/lib/export/export-independent-portrait.ts` | 导出前检查；在 `export-engine-muxer.ts` 里调用 |
| 界面 | `apps/web/src/components/editor/properties-panel/portrait/portrait-engine-control.tsx` | 引擎选择、速度说明、不支持项 |

引擎本体是 `research/independent-beauty/`，独立版仓库 `24d3dcf` 的固定快照，源码由 `source-manifest.json` 锁定。

- 开发模式下，运行库在 `research/independent-beauty/runtime`，Python 在 `research/independent-beauty/research/.venv`。
- 打包版的运行库装在用户数据目录的 `PrivateRuntimes/IndependentBeauty/current`。

## 怎么验证

E2E 跑的是编译产物 `dist/electron/main.js`，改了代码要先 `bun run build`。

```sh
# 单元测试（与本 PR 相关的部分）
bunx vitest run electron/__tests__/beauty-lab apps/web/src/lib/portrait apps/web/src/lib/export apps/web/src/components/editor/properties-panel/portrait packages/editor-core packages/jianying-draft-export
# 类型检查必须跑根目录这个：草稿快照字段白名单只有它能查出遗漏
bun check-types
# 真人视频 E2E（约 1.1 分钟）
QCUT_API_PORT=8799 QCUT_REAL_PORTRAIT_VIDEO_PATH="$PWD/.local/jianying-basic-video-probe/real-person-with-audio.mp4" bun run test:e2e:bg apps/web/src/test/e2e/portrait-independent-timeline.e2e.ts
```

运行 E2E 的前提：

- 本机的原生美颜运行库已就绪（面板控件目录来自它）。
- 开发模式的自研运行库和 Python 环境都在。
- 视频素材在 `.local/` 下，不在 Git 里。
- 本机常有另一个 QCut 占着 8765 端口，所以 E2E 用 8799。E2E 用临时用户数据目录，可以与它并存。

E2E 的预期结果：

- 暂停预览：只有眼部约 775 个像素变化。
- 冷导出：8 帧约 25.5 秒。
- 缓存导出：约 0.5 秒，两次导出逐帧 MD5 一致。
- 取消：之后不再写缓存。

截图、导出视频和 `e2e-evidence.json` 写到 `output/playwright/portrait-independent-timeline/`，该目录已被 Git 忽略。

## 已知限制（引擎快照本身，不是本 PR 的缺陷）

- **竖屏 9:16 不能磨皮、美白**：快照的皮肤分割模型缺 128×224 这一档。其余参数在 9:16 上都正常，16:9 和 3:4 全部正常。界面已注明，报错是中文说明。
- **速度**：单项参数约 3 秒一帧，五项组合约 10–11 秒一帧。原因是每帧都重新启动一次 Python 处理进程并加载模型。
- **分辨率**：最长边 1280，1080p 导出会缩小处理再放大。
- **跨帧**：每帧独立处理，没有跨帧跟踪和平滑。引擎目录自己也写着「视频未验收」。

## 坑

- **测试素材的像素不是正方形**：样本宽高比 171:176，浏览器按 360×659 显示。逐像素对比时，参照图要按 `videoWidth/videoHeight` 做「填充」裁切，否则整帧都会算成差异。
- **调色画布只在有生效参数时才挂载**：没有美颜数值时，`color-preview-canvas` 不存在。
- **关闭导出对话框会重置属性面板**：面板重新挂载回到「基础」页，要重新点「美颜美体」并展开分组。
- **「处理中」角标 300 毫秒后才出现**：要先等它出现再等它消失，否则会在处理开始前就读状态。
- **不要和 E2E 同时直接调用引擎**：E2E 用 `pgrep -f independent_pipeline.py` 数引擎进程。
- **全量并行跑单元测试时有两项会超时**：剪映草稿写入的两项测试偶尔超过 5 秒，单独跑都能通过。
- **同一份用户数据目录只能跑一个 QCut**：另开一个会直接退出，没有窗口。

## 下一步（建议顺序）

1. **跟进 PR #496**
   - 等 3 个构建检查通过。
   - 处理 CodeRabbit 意见：除了行内意见，还要看评审正文里的 nitpick 和 outside-diff 部分。
   - 合并与发布都等用户指示。
   - 发布流程沿用以往做法：先把本 PR 的说明写进 master 的 CHANGELOG `[Unreleased]`；再在干净的 detached worktree（基于 origin/master）里执行 `BUN_OPTIONS=--smol bun run release`；脚本不会自己推送，需要手动推送 `HEAD:master` 和 tag。
2. **性能（用户已说「下一步再做」）**
   - 先量清楚每帧时间花在哪：Python 启动与导入、模型加载、运行时编译 Metal/Swift、各阶段本身。主进程每帧要做源码和运行库的哈希校验，实测约 50–175 毫秒（文件缓存冷时偏高），相对每帧数秒不是瓶颈。
   - 方向是常驻进程：模型和编译结果在多帧之间保留。
   - 保持排队、缓存和帧 IPC 的接口不变，调用方不用改。
3. **同步独立版引擎**：可解决竖屏皮肤分割、超过 1280 的源和更多照片的稳健性。
   - 独立版仓库领先快照约 800 个提交。
   - 导入后更新 `source-manifest.json`（来源记在 `importPatches`），并让 `electron/beauty-lab-runtime-payload.json` 的 `sourceManifestSha256` 和文件清单与之对应。
   - 重跑 124 组照片矩阵（每组冷启动，见 [冷启动对照](beauty-lab-cold-native-2026-10-11.zh-CN.md)）、引擎自带测试、美颜实验室 E2E 和本 E2E。
4. **跨帧稳定性**：用更长的视频评估逐帧独立处理带来的抖动，再决定是否引入跟踪或平滑。
5. **可选的界面改进**：导出前显示预计耗时（帧数 × 每帧秒数）。另外「原版美颜美体」开关的名字和引擎选项放在一起容易误解，是否改名由用户决定。

与本 PR 无关、仍待用户决定或之后再做的事：

- 编辑器暂停预览的原生跟踪确定性（稳定帧名单，未经用户同意不要改）。
- 干净 Mac 安装与 notarization，研究项 P1–P3。
- `beauty-lab.e2e.ts` 离线回放所需研究记录的重新采集。
- `beauty-lab-live-candidate*.e2e.ts` 里的旧按钮名。

## 规矩

- 每个文件单独一个提交，使用 conventional commit。提交信息不加 Co-Authored-By。
- 私有模型、权重、人像和视频只放 `.local/`，绝不提交。截图和导出物放 `output/`。
- 文档里不写本机绝对路径，用仓库相对路径和 `.local/` 路径。
- 自研不支持时报错，不要加原生兜底。
- 能用后台 E2E 或 HTTP 接口验证就不要驱动界面。需要手动启动时只用 `bun run electron`。
