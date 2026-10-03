# 美颜实验室交接与下一步

更新：2026-10-03。分支：`codex/kpop-beauty-v6`。继续使用 PR #483：
https://github.com/Quriosity-agent/qcut/pull/483 。不新建分支，不合并、不发布。

工作目录：`/Users/peter/Desktop/code/qcut/qcut`，Git 根目录是其上一级。先阅读此文档，不再继续旧 agent；本轮子任务已经收尾。

## 当前交付

入口：编辑器选中图片/视频 → 属性 → 美颜美体 → 美颜实验室。

- 独立弹窗和本地参数草稿，不直接改时间线、正式预设或编辑器笔刷状态。
- 复用完整目录：90 个参数，皮肤 10、脸型 18、五官 52、美体 10。
- 美妆 12 类、28 个可选卡片；另 1 个 legacy 卡片仅保留既有选择兼容性。
- 美颜、美体、美颜预设、美体预设四个页签；预设支持保存、应用、覆盖、重命名、导入、导出。
- 实验室预设使用 `qcut-beauty-lab-presets-v1`，不混入正式编辑器预设。
- 上传不透明 PNG/JPEG/WebP，或捕获当前解码原始帧；上传复用已有读图器，最长边限制 640 像素。
- 原图 / 原生结果 / 新链路离线回放，并列显示；三组差分统一使用 1–32 倍增益。
- 灰度为 `min(255, max(abs(R), abs(G), abs(B)) * gain)`，不独立归一化；另报 RGB MAE、最大差、Alpha 最大差和变化像素数。
- 导出 ZIP 包含实际可用的 PNG、灰度差分 PNG、参数/来源/增益/指标 JSON；缺失的新链路结果不会伪造。
- 人脸检测使用真实返回身份，最多选择前五张脸；无输入或运行时不可用时不允许检测。
- 变更参数/输入会清空旧结果；异步旧请求完成后不会覆盖新草稿。关闭实验室后旧结果也不会回写。

## 必须区分的两条链路

普通输入：

```text
图片或当前原始帧 + 实验室草稿
  → 现有 jianyingPortraitAdjustment IPC
  → QCut 本机宿主 + 原生运行库 / 模型 / 效果包
  → 原生结果 + 原图差分
```

已验收研究记录：

```text
固定案例 / 帧索引
  → beautyLab IPC（仅可信主窗口）
  → 验证当前源码哈希、报告链接、回放字节、输入 PNG 和输出 RGBA
  → 原图 / 原生基准 / 新链路离线回放
  → 三路统一增益差分
```

**新链路尚未接任意画面的实时推理。回放不是独立产品后端。** 原生分析、160 点输入及最终效果渲染仍有依赖。本轮没有扩大之前的模型精度结论，也没有启用不达标的独立 160 点采样候选。

记录仅允许 `temporal`、`qcut-export`，每组 7 帧，固定 1448×1086。默认开发目录：
`.local/jianying-model-pytorch/face-temporal-campaign-20261003-r1`；源码根目录为 `research`。
Electron 从 `dist/electron/main.js` 启动时开发根目录由 `__dirname/../..` 定位，不能用 `app.getAppPath()` 拼开发数据路径。发行包没有这些私有记录时列表为空，不能把模型、运行库、效果包或原始素材加入 Git。

研究探针的原始 `face_adjust_eye intensity=1` 对应 `/100` 展示值 100，超过产品精修滑杆最大值 50。记录模式只读，保留真实探针值并显式显示原始 intensity；只读控件范围可扩展以展示记录，不改变普通输入的范围或产品校验规则。禁止把 100 静默缩成 50 后声称相同参数。

## 已验证证据

- 前端聚焦测试及相关旧美颜回归：294 passed；原生目录/请求/就绪回归：39 passed；研究记录和 IPC：123 passed，共 456。
- Electron、Web 构建与 TypeScript 检查已通过。最后的弹窗层级修复及桌面/窄屏九点命中复测也已通过；前端 294 项在最后提交前再次全部通过。
- 最终真实 Electron E2E 通过（16.6 秒），不是浏览器假 API。包含原始帧、真实人脸检测、原生处理、预设、离线记录、帧切换、ZIP 保存/PNG 解码、390×844 窄屏和时间线不变验证。窄屏弹窗宽 358、scrollWidth/clientWidth 均 356，没有水平溢出，pageErrors 为空。
- 实时测试：640×480，`face_adjust_eye=40`，原图→原生变化 7,900 像素，RGB MAE 0.183674，最大差 78，Alpha 差 0。
- 时序记录帧 0：1,572,528 像素中，原图→原生变化 43,893；原生→候选变化 0，RGB/Alpha 最大差均 0。
- QCut 导出记录帧 0：原图→原生变化 41,141；原生→候选变化 0。此素材不是多人或分钟级运动视频，不扩大到这些场景。
- 截图人工检查发现时间线栏 z200 挡住默认弹窗 z150，已按现有封面编辑器模式改为遮罩 z1000、实验室 z1001、菜单 z1100，并增加九点命中检查，防止仅功能通过却视觉遮挡。viewport 改变后使用轮询等待实际布局刷新，不在 dvh 更新前读取旧尺寸；最终桌面和窄屏截图均已人工确认。

最终本地证据位于 `output/playwright/beauty-lab-handoff-verified/`：7 张 UI 截图、`native-comparison.zip`、`verified-replay-comparison.zip`、`e2e-report.json`。优先看这个目录。`beauty-lab-final/` 是较早功能通过结果；`beauty-lab-release-ready/` 是 resize 布局尚未刷新的测试失败记录，不当作最终验收。证据和私有运行时保留本地，不加入 Git。

## 代码入口

- `apps/web/src/components/editor/properties-panel/beauty-lab-dialog.tsx`：弹窗与工具栏。
- `beauty-lab-controls.tsx` / `beauty-lab-presets.tsx`：草稿控件、只读浏览、隔离预设。
- `apps/web/src/lib/portrait/use-beauty-lab.ts`：输入、状态、原生请求、请求过期保护。
- `beauty-lab-catalog.ts` / `beauty-lab-difference.ts` / `beauty-lab-export.ts`：目录、差分、ZIP。
- `electron/beauty-lab-contract.ts` / `beauty-lab-handler.ts`：类型、IPC 来源与参数校验。
- `beauty-lab-research.ts` / `beauty-lab-research-files.ts` / `beauty-lab-research-evidence.ts`：固定记录编排、安全文件读取、证据结构。
- `apps/web/src/test/e2e/beauty-lab.e2e.ts`：真实运行时的可复现桌面测试。

## 下一步顺序

1. 断网后先看 `output/playwright/beauty-lab-handoff-verified/e2e-report.json` 和 Git 状态。网络恢复后检查本地 HEAD 与远端 PR HEAD 一致；本轮每个文件单独 commit 后 push，不改精度门槛。
2. 将新链路封装为明确的候选后端接口：输入 RGBA、尺寸、参数快照、源身份/时间、后端版本；输出 RGBA、原生依赖清单、阶段指标。不能以旧帧回放响应新输入。
3. 先接已验收的检测/裁剪/关键点/平滑/坐标回映阶段。每次替换一个阶段，与同输入、同参数、同时间点的原生基准做中间张量及最终像素对比；保留失败候选，不降门槛。
4. 独立 160 点采样仍是第一个关键未解问题。对齐裁剪坐标、边界插值、取整、颜色/通道和实际采样语义，再重新跑两个固定时序案例。不要重新注入原生最终点以制造精度通过。
5. 任意画面候选输出通过门槛后接实验室的真实候选处理按钮，再做预览/导出双链路。之后逐项增加脸型、鼻、嘴、眉、美妆、皮肤、美体及组合参数的对照样本。
6. 再补真实移动、侧脸、多人、无脸、分钟级视频与 Windows/x86。当前单张图/短导出不能证明这些场景。
7. UI 未完项：剪映肤色色板尚未有完整的颜色选择协议；当前是已有肤色/冷暖滑杆。先确认 LUT/效果包与色板选择语义再接色块，不能画几个按钮当作已接通。手动笔刷/美体叠加层也尚未接实验室，不能共用编辑器的全局笔刷状态。只读研究记录可浏览数值分组，但美妆分类切换暂仍锁定，不影响普通输入的分类选择。

每一步保持 single file / single commit / push，同一个 PR。CI、合并、发行只在用户下一次明确要求后进行。

## 复现命令

在仓库的 `qcut/` 目录执行：

```sh
bun run build:electron
cd apps/web
bun run build
cd ../..
QCUT_E2E_OFFSCREEN=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH=output/beauty-kpop-v6-20261002/source/kpop-front-original.png \
QCUT_BEAUTY_LAB_OUTPUT=output/playwright/beauty-lab-next-verification \
bun x playwright test apps/web/src/test/e2e/beauty-lab.e2e.ts --reporter=line
```

每次复测使用新的输出目录，避免 ZIP 下载完成轮询误读上次文件。最终验收目录不要覆盖。

原生运行库不可用时该 E2E 不应当被假后端替代。常规无私有资产 CI 使用单元测试；真实原生验证需上述本机素材与运行时。Web 开发服务器目前为 `http://127.0.0.1:5173/`，浏览器只能看 UI/草稿，原生处理需 QCut Desktop。
