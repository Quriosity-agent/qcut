# 美颜实验室交接与下一步

更新：2026-10-03。分支：`codex/kpop-beauty-v6`。继续使用 PR #483：
https://github.com/Quriosity-agent/qcut/pull/483 。不新建分支，不合并、不发布。

工作目录：`/Users/peter/Desktop/code/qcut/qcut`，Git 根目录是其上一级。先阅读此文档，不再继续旧 agent；本轮子任务已经收尾。

网络恢复后继续的最新检查点见下面“候选协议检查点”。实时驱动仍未注册；本次没有把未过门槛的采样器启用为产品后端。

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

## 上一轮证据

- 前端聚焦测试及相关旧美颜回归：294 passed；原生目录/请求/就绪回归：39 passed；研究记录和 IPC：123 passed，共 456。
- Electron、Web 构建与 TypeScript 检查已通过。最后的弹窗层级修复及桌面/窄屏九点命中复测也已通过；前端 294 项在最后提交前再次全部通过。
- 最终真实 Electron E2E 通过（16.6 秒），不是浏览器假 API。包含原始帧、真实人脸检测、原生处理、预设、离线记录、帧切换、ZIP 保存/PNG 解码、390×844 窄屏和时间线不变验证。窄屏弹窗宽 358、scrollWidth/clientWidth 均 356，没有水平溢出，pageErrors 为空。
- 实时测试：640×480，`face_adjust_eye=40`，原图→原生变化 7,900 像素，RGB MAE 0.183674，最大差 78，Alpha 差 0。
- 时序记录帧 0：1,572,528 像素中，原图→原生变化 43,893；原生→候选变化 0，RGB/Alpha 最大差均 0。
- QCut 导出记录帧 0：原图→原生变化 41,141；原生→候选变化 0。此素材不是多人或分钟级运动视频，不扩大到这些场景。
- 截图人工检查发现时间线栏 z200 挡住默认弹窗 z150，已按现有封面编辑器模式改为遮罩 z1000、实验室 z1001、菜单 z1100，并增加九点命中检查，防止仅功能通过却视觉遮挡。viewport 改变后使用轮询等待实际布局刷新，不在 dvh 更新前读取旧尺寸；最终桌面和窄屏截图均已人工确认。

上一轮本地证据位于 `output/playwright/beauty-lab-handoff-verified/`：7 张 UI 截图、`native-comparison.zip`、`verified-replay-comparison.zip`、`e2e-report.json`。`beauty-lab-final/` 是更早功能通过结果；`beauty-lab-release-ready/` 是 resize 布局尚未刷新的测试失败记录，不当作最终验收。最新目录见下面检查点。证据和私有运行时保留本地，不加入 Git。

## 候选协议检查点

2026-10-03，网络恢复后完成候选协议、IPC、实验室及导出接入；三个独立子任务负责主进程边界测试、前端状态/导出测试、160 预处理调查，写入范围互不重叠。

```text
实验室 RGBA + 参数快照 + 独立 sourceKey + 显式帧号/源时间 + 后端版本
  → trusted main-window IPC
  → 复用正式美颜参数校验，复制输入；SHA-256 绑定像素及规范化请求
  → 候选 provider：完整十阶段、验收状态、单个在途推理
  → 注册的候选 driver（当前没有注册）
  → 输出校验：live-candidate、请求身份、版本、尺寸、依赖、十阶段耗时
  → 实验室原生/候选对照；ZIP 附完整请求出处，不附原始 RGBA 数组
```

- 新代码：`electron/beauty-lab-candidate-contract.ts`、`beauty-lab-candidate-request.ts`、`beauty-lab-candidate-provider.ts`。
- API：`beautyLab.inspectCandidate()` / `renderCandidate(request)`。后者的版本必须与前者一致；缺失/未验收阶段、过期版本、回放来源、错源/错帧/错时间/错哈希、错尺寸、稀疏/重复阶段、非有限耗时、谎报原生依赖均拒绝。输入/输出持有独立字节，SharedArrayBuffer 拒绝。
- 当前实际能力：`state=not-connected`、`available=false`、`backendVersion=null`，阻塞项是 `arbitrary-frame-backend-not-connected` 与 `independent-160-sampling-unverified`。真实 Electron 调用确实拒绝；不会改走旧回放或原生 provider 来伪造成功。“候选处理”按钮保持禁用。
- 后端十阶段为 detection、geometry、sampling-160、inference-160、sampling-120、inference-120、decode、temporal-smoothing、coordinate-mapping、effect-rendering。`nativeDependencies` 是仍由原生执行的阶段列表，不是模型/效果资产的版权或来源证明。
- 后端声明 `parity=accepted` 与请求 fingerprint 只是接口验收/关联条件，不会自行证明算法运行或模型精度。将来注册真实 driver 前仍须锁定源码/模型/运行库/效果包版本，并通过中间张量及最终像素门槛。单元测试的接受路径使用明确标注的测试桩，不算实时模型接通。
- 导入图片用静态源帧 0/时间 0；捕获视频使用媒体元素自己的 currentTime，而不是猜 fps 或使用时间线位置。currentTime 是媒体时钟，不是已验证的解码帧 PTS；seek 后时钟与实际像素的对应关系及分钟级视频仍须后续验收。捕获来源时间未知时不允许候选推理。参数/输入/seek/unmount 使旧候选失效，渲染候选保留同输入的原生基准。
- live-candidate ZIP 必须有与候选像素一致的报告，且报告 inputSha256 等于实际导出输入的 WebCrypto SHA-256。记录模式仍是 `verified-offline-replay`、`candidateProvenance=null`、`arbitraryFrameCandidateReady=false`，不混用实时出处。
- 本检查点：前端 381 项、主进程/原生回归 537 项，共 918 项通过。其中新增候选请求/结果边界 373 项、前端新增 87 项。Electron/Web 构建、TypeScript 与 Biome 通过。
- 最终真实 Electron E2E 在 `output/playwright/beauty-lab-candidate-protocol-20261003-r3/` 通过（17.6 秒）：真实候选 IPC 不可用拒绝、原生处理、离线记录、ZIP/PNG、窄屏布局、时间线不变。原生大眼 40 仍改变 7,900 像素；时序记录原生→候选仍为 0 差，未引入像素误差。该目录保留 7 张截图和两个 ZIP；桌面与窄屏截图已人工查看。

160 调查见 [actual 160 preprocessing](../../../research/local-model-pytorch/face-160-preprocess-next-probe-2026-10-03.zh-CN.md)。静态调用关系是 BGR 转换/旋转 → CropObjectRegion → resize → forward/inverse matrix → 160 predictor；矩阵在像素预处理之后构造，不是直接采样定义。已定位真实 call site、可变 Rect、target 字段、布尔分支、expansion 和返回 Mat；实际参数/中间像素尚未捕获。

该调查另跑 60 项 CPU 回归，旧 50 个 source 哈希仍匹配。两个 direct-affine 候选仍各有 67,068/76,800 个 int8 值不同，最大差 177，继续拒绝替换。新文档的硬件断点 sidecar 是待实现/待运行方案，不是已有 CLI 或新运行时验收。

## 代码入口

- `apps/web/src/components/editor/properties-panel/beauty-lab-dialog.tsx`：弹窗与工具栏。
- `beauty-lab-controls.tsx` / `beauty-lab-presets.tsx`：草稿控件、只读浏览、隔离预设。
- `apps/web/src/lib/portrait/use-beauty-lab.ts`：输入、状态、原生请求、请求过期保护。
- `beauty-lab-catalog.ts` / `beauty-lab-difference.ts` / `beauty-lab-export.ts`：目录、差分、ZIP。
- `electron/beauty-lab-contract.ts` / `beauty-lab-handler.ts`：类型、IPC 来源与参数校验。
- `beauty-lab-research.ts` / `beauty-lab-research-files.ts` / `beauty-lab-research-evidence.ts`：固定记录编排、安全文件读取、证据结构。
- `apps/web/src/test/e2e/beauty-lab.e2e.ts`：真实运行时的可复现桌面测试。

## 下一步顺序

1. 先看最新 `output/playwright/beauty-lab-candidate-protocol-20261003-r3/e2e-report.json` 和 Git 状态。网络恢复后检查本地 HEAD 与远端 PR HEAD 一致；每个文件单独 commit 后 push，不改精度门槛。
2. 候选接口已完成，driver 未注册。下一步按 160 调查文档新建只读 sidecar，在独占 native/GPU 时段捕获真实 source、裁剪前/后 Rect、flags、expansion、crop 像素、resize 返回像素及匹配的 predictor/NN window。库内直接 bl 不能只靠同名 DYLD_INTERPOSE；硬件断点不可用就记录阻塞，不改代码页。
3. 逐阶段复现 BGR/旋转、裁剪扩框/截断/padding、resize、int8 输入转换；实际 160 tensor 必须全部 76,800 值相同，再接已验收 ONNX/seed/平滑/坐标回映。捕获值只作 oracle，不喂给候选。
4. 对两个固定时序案例重验中间张量和最终像素，且观察中立性必须零差；然后将真实 driver 接到候选 provider，声明准确原生依赖并锁定 backendVersion。不要重新注入原生最终点以制造精度通过。
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
