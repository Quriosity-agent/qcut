# 本地神经模型第六阶段：逐步实现与验收计划

日期：2026-09-19。代码基线：`c4343a392ce2e7cfe4040e6ab9a069458448c2e9`。
分支：`codex/local-neural-model-audit-20260919`；沿用 [PR #477](https://github.com/Quriosity-agent/qcut/pull/477)。

**当前已完成 S1 的普通桌面视频登记修复及定向回归；补齐完整 Electron 构建后，真实 UI 导入 → 原 ID 查找 → ONNX 推理 → 四段时间线的冒烟测试通过。重开与异常场景矩阵尚未验收，S1 尚未全部完成，不进入 S2。后续仍每次只推进一个步骤。**

## 1. 基线与边界

详细历史见 [第五阶段收尾](../../research/local-model-pytorch/PHASE5-20260919.zh-CN.md)。以下是该次运行记录，不是本次重新执行的测试结果：

| 范围 | 已有证据 | 仍缺什么 |
| --- | --- | --- |
| 单元测试与类型 | Python 604、Electron/CLI 109、前端 39 项通过；两侧类型检查通过 | 修改后重新运行受影响测试，不能继承旧结果冒充新结果 |
| 分镜 CLI | 无 Torch 的 ONNX 视频链可执行；六组视频切点一致；一分钟循环素材完成 | 编辑器全链路、更多独立视频、安装包验收 |
| 编辑器 | 已有显式 ONNX 菜单、IPC/HTTP 路由、过期结果保护 | 两项真实 E2E 因 `Media not found` 失败；根因尚未确定 |
| 取消 | 底层 ONNX 子进程支持 AbortSignal、POSIX 进程组及 Windows taskkill | 编辑器取消只丢弃结果，未接后台终止 |
| 平台 | 四平台公开合成图 CI；Linux x64 私有 19 图/76 组回放 | Windows 私有模型和媒体；macOS Intel 固定依赖不支持 |
| Bandou | 新 profile 原生 30/30，独立回放 30/30，ONNX 烟测 4/4 | 完整 ONNX 验证、压缩单测、共享注册 |
| GRU | 新 v3 完整输出 250 次/1,000 组过门槛，研究 infer 按包哈希注册 | 可移植数值 profile、ONNX、产品抠像接入 |
| OCR | 精确 10,537 类映射、CTC、11 张图完整 logits 过门槛 | 仅 4/11 文本全对，CER 5.0209%；检测、裁剪、方向、色彩及编辑器流程 |

保持这些约束：

- 编辑器默认 FFmpeg；CLI 默认 bridge。ONNX 继续显式选择，失败不静默回退，不自动上传视频。
- 模型转换、同输入数值一致、视频切点一致、编辑器成功、语义质量分别验收。
- 保留旧 GRU/Bandou 失败包的拒绝行为，不能只改 `passed` 标签或放宽容差。
- 私有权重、恢复图、字表、NPZ、视频和原生输出继续留在 `.local/`，不进入 Git 或公开 CI artifact。
- 不改用户项目，不启动收费云端请求。使用独立测试 profile、documents 和项目目录。

## 2. 推进顺序

| 步骤 | 本步唯一交付 | 状态 | 进入条件 |
| --- | --- | --- | --- |
| S1 | 修复并验证编辑器媒体身份/路径链 | 登记修复及真实冒烟通过，重开与异常矩阵待验收 | 文档就绪 |
| S2 | 两项真实分镜 E2E 通过及截图、导出证据 | 未开始 | S1 通过 |
| S3 | 编辑器取消真正终止后台推理 | 未开始 | S2 通过 |
| S4 | Windows 私有回放与桌面部署验收 | 未开始 | S3 通过且受控 Windows 环境可用 |
| S5 | Bandou 完整 ONNX 验证及研究入口注册 | 未开始 | S4 有验收结论 |
| S6 | GRU 可移植性结论与候选导出门槛 | 未开始 | S5 通过 |
| S7 | OCR 完整图片流程及中英文质量验收 | 未开始 | S6 有验收结论 |
| S8 | 发布前复核与能力清单 | 未开始 | 前述结果与未支持范围明确 |

若环境缺失或精度失败，记录阻塞原因和保留状态，停止该步；不得为了推进表格把它改成通过。需要跳步时先调整本文的顺序并说明原因，不自行恢复大规模并行。

## 3. S1：先接通真实媒体

### 已知与待确认

`claude-scene-handler.ts` 的 `resolveVideoForScene()` 调用 `getMediaInfo(projectId, mediaId)`。后者扫描项目 `media/` 与 `media/imported/`，生成文件型 ID，并兼容文件名匹配。前端传入时间线关联的 media ID。

现有 E2E 在 Electron 启动后切换测试 `documents` 目录，仍需通过一次完整运行核对其时序。本轮源码确认的独立缺口是：普通文件输入走 `processMediaFiles()`，视频只写入临时路径和浏览器存储，`addMediaItem()` 未调用项目媒体导入；而场景 API 只扫描项目目录。不能只通过文件名 fallback 修复这条缺失登记的链。

### 实现顺序

1. 在独立项目记录导入返回值、renderer media ID、时间线 media ID、project ID、主进程 documents、导入目标路径和 `getMediaInfo` 匹配结果。每一项必须来自同一次运行。
2. 区分四种失败：未实际落盘、测试根目录切换时机不一致、ID 映射不一致、符号链接/权限失败。
3. 只修正被证据确认的边界。导入完成应等待真实持久化结果，不能用固定 sleep 掩盖竞态；稳定媒体身份优先于文件名猜测。
4. 保持项目作用域和路径校验。不得通过接受 renderer 任意绝对路径、硬编码测试文件、绕过 `getMediaInfo` 或跨项目搜文件来消除报错。

首查文件：

- `electron/media-import-handler.ts`
- `electron/claude/handlers/claude-media-handler.ts`、`claude-scene-handler.ts`
- `electron/claude/utils/helpers.ts`
- `apps/web/src/stores/media/media-store.ts`
- `apps/web/src/test/e2e/onnx-shot-split.e2e.ts` 及 `helpers/electron-helpers.ts`

### 验收

- UI 导入后，使用原始 project ID/media ID 即可查到同一视频；重开项目仍可解析，不需要文件名替换。
- 覆盖中文/空格路径、重复文件名、符号链接与复制导入、无效/跨项目 ID、删除源文件和导入未完成状态。
- UI 操作实际到达 ONNX 推理，记录引擎和模型身份；缺配置仍明确报错，FFmpeg 原入口不回归。
- 至少留 `01-imported.png`、`02-media-resolved.png` 和脱敏的 `media-resolution.json`；截图不能代替路径和身份断言。
- 若只是测试隔离错误，修测试并说明生产路径未改；若是产品错误，新增能复现旧行为的回归测试。

**本步停止点：媒体解析与实际调用已证明，不在本步顺手重构全部媒体系统或引入新模型。**

## 4. S2：分镜完整 E2E

复用 [现有真实测试](../../apps/web/src/test/e2e/onnx-shot-split.e2e.ts)，不新建另一套模拟验收。允许测试夹具控制文件对话框和独立项目，不允许 mock 推理、切点或任务成功状态。

### 实现与验收

1. 用固定六秒四镜头 montage，右键选择 ONNX；确认 runtime 不含 Torch，任务输出 engine/route 正确，切分时间为 `0 / 1.5 / 3 / 4.5`，只增加一次 undo 历史。
2. 逐镜头 seek 检查实际预览，随后 undo、重新切分、保存并重开，比较元素媒体关联、source trim、start time、duration，而不只数片段个数。
3. 导出 H.264/24 fps，ffprobe 检查流与时长，FFmpeg 完整解码。对切点前后帧逐一检查，无新增黑帧、错序、重复或缺帧；编码有损，不要求 MP4/PNG 文件哈希相同。
4. 对齐导出与未切分基线的对应帧，记录像素差/SSIM；容差先用同编码器基线固定，不能看完失败样本后放宽。音轨如存在，还须比较保留与同步。
5. 推理期间移动、删除或 trim 源片段、切换项目；过期结果不得改写时间线。现有“移动片段”测试必须先证明推理确实启动，避免只测到 `Media not found`。
6. 补至少一段中文、一段英文、各 60–90 秒的独立授权素材，包含真实镜头变化。循环素材单独标记为压力测试，不计作独立内容；人工标注切点用于报告质量，不能把旧 Torch 当作人工真值。

六秒夹具原有两项 E2E 在干净 profile 连续两次通过；记录成功、失败和 skipped 数量。分钟级样本分别报告质量、耗时、峰值内存，不作未经测量的实时性能承诺。

截图至少包含 ONNX 菜单、切分后的时间线、各镜头预览、撤销、保存重开、导出完成和过期结果拒绝。保存 `evidence.json`、输出 MP4、解码日志、输入/模型 SHA；正常播放时非黑不等于切点附近没有黑帧。

## 5. S3：取消与任务生命周期

### 实现

优先沿用现有场景接口与任务展示：增加可跨 IPC 序列化的 request ID，主进程维护 request ID 到 AbortController 的有界映射；AbortSignal 不跨 IPC。保留现有调用返回值，不为这个功能另建通用云调度系统。

- 将取消从 `timeline-element.tsx` 的 runtime action 接到 preload/IPC、`detectScenes` 和 `detectShotsWithOnnxEngine`。
- 同步更新 `electron/types/claude-api.ts` 与 `packages/platform-core/src/types/claude-api.ts`。HTTP 取消使用同一主进程操作，校验项目与请求归属，不能取消其他项目的工作。
- 成功、失败、取消、超时均清除映射与事件监听；重复取消幂等，完成后的迟到取消不误伤新任务。
- 保持现有 stale-result 保护。取消要区分“请求已收到”和“子进程已关闭”，不能提前展示彻底清理完成。
- 默认 FFmpeg 路径同样覆盖取消；不用 ONNX 的成功掩盖另一个引擎仍在后台运行。

涉及现有入口：`electron/claude/handlers/claude-analyze-handler.ts`、`claude-scene-handler.ts`、`electron/preload-integrations.ts`、`electron/claude/http/claude-http-analysis-routes.ts`、`electron/jianying-shot-split/onnx-process.ts` 和前端任务操作。

### 验收

覆盖启动前、解码中、推理中、完成同刻取消；取消后重试保留引擎。检查本次创建的 Python/FFmpeg PID 和进程组，不用全局进程名匹配或杀其他实例。

普通终止与强制升级终止都应在现有 5 秒升级窗口及明确测试裕量内收敛；超时算失败。UI/磁盘不留下成功 JSON、不改时间线，重复执行后无遗留任务、事件监听和临时输出。Windows 行为在 S4 目标系统重复验证。

## 6. S4：Windows 与实际部署

先使用有授权的受控 Windows x64 环境；没有机器则记录“未执行”，不能用合成 CI、wheel 可安装或 Linux AMD64 容器替代。

1. 固定 Python/NumPy/ORT 及 CPU provider，在无 Torch 环境重放同一 19 图/76 组冻结输入，核对输入、模型和参考输出 SHA。
2. 保持既有浮点混合容差 `abs(actual-reference) <= 1e-4 + 1e-4*abs(reference)`；整数及已有 byte-exact 项按各自更严格合同，禁止整体放宽。
3. 用同一分镜素材走 Windows CLI 和编辑器，核验切点、保存重开、导出及 S3 的进程树取消。检查非 ASCII/空格路径、安装目录外启动、配置缺失/损坏、Python 缺失与 DLL 错误。
4. 检查打包脚本定位及五个运行文件完整性。默认不捆绑厂商模型，不偷偷安装/下载 Python，不把本机绝对路径写进产品。
5. 输出 OS/架构/provider/版本、耗时、峰值内存、通过/失败用例和截图。性能只作实测记录，不因跨平台速度不同改数值门槛。

代码复用 `onnx_replay.py`、`onnx_infer.py`、`onnx-engine.ts`、`onnx-process.ts` 和已有公开 workflow。私有报告不得进入 GitHub 公共 artifact。macOS Intel 单列不支持；要支持时必须新定可安装的 ORT 版本并重新验收，不能静默降级。

## 7. S5：Bandou 先完整验证，再注册

使用 [Bandou 记录](../../research/local-model-pytorch/bandou-phase5.zh-CN.md) 中的最终 `delivery-r2`，不重跑已知无效的旧候选。

1. 为 `bandou_phase5_onnx.py` 的 `compact_broadcasts()` 补合成图测试：常量确实重复才压缩、shape/dtype 保留、非重复不改、负零/非有限值边界、独立 ORT 前后对拍、重复处理不继续改图。
2. 重放完整 30 组原生/PT/ONNX 输出，包含旧失败随机输入、holdout 和视频帧；不把 4/4 smoke 提升为完整通过。报告新增压缩前后图大小、SHA 与差异。
3. 全部过门槛后，给共享 `infer.py` 增加新格式的严格加载入口；复用现有 loader 的图、状态、源/报告身份校验，必要时固定最终包哈希，不给调用者额外 bypass。
4. 再接共享 ONNX 导出/回放，验证不会误收旧格式、伪造报告或损坏包；旧三模型 54 组回归不能退步。

本步交付为“已验证研究入口”，不是“祛斑功能已在编辑器可用”。产品颜色、ROI、融合、预览与导出需另立验收，不通过一个滤镜名字直接启用。

## 8. S6：GRU 先明确可移植数值方案

现有 v3 依赖精确算术顺序；共享 ONNX 导出拒绝它是门槛，不是需要直接删除的障碍。详见 [GRU 记录](../../research/local-model-pytorch/matting_route.zh-CN.md)。

1. 先在目标 CPU 对有序卷积、激活尾部、四通道归约和 resize 原尺寸算子作独立回放，定位平台差异；不更改共享 OCR/tracking 数值实现来迁就本模型。
2. 只有标准 ONNX 能表达且保持原门槛时，新增独立 candidate adapter。需要自定义算子或不可控舍入时，本步结论应为暂不支持，而不是生成看似成功的合同。
3. 运行原 250 次/1,000 组完整输出集合和状态 reset/replay；两端只反馈各自状态，检查三路状态与概率，不能只看 mask 外观。
4. 新增未用于校准的连续人物视频，覆盖运动、遮挡、出入画、跳播和 reset；先固定输入清单、状态初值与门槛，再执行。
5. 独立进程、无厂商库回放通过后才允许新格式注册/导出。保留 v3 哈希保护与旧 v1/v2 拒绝测试，不宣称所有状态 bit-exact。

是否进入编辑器抠像另作决定：需要固定 resize/色彩/alpha 后处理与合成规则，再验证预览、seek/reset、保存重开及 alpha 导出。不能把本步张量通过当成这些步骤已完成。

## 9. S7：OCR 从字条走向完整画面

复用现有 detector、recognizer、`ocr_decode_ctc.py`、`ocr_decode_metrics.py`；字表不复制进产品或公共测试。精确映射与当前错误清单见 [OCR 记录](../../research/local-model-pytorch/ocr-alphabet-phase5.zh-CN.md)。

1. 用彩色文字/背景夹具确认 RGB/BGR、数值范围和 resize/padding。既有灰阶条图不能区分 RGB/BGR；不得从其成功推断完整预处理已复刻。
2. 补检测输出到四边形框、排序、裁剪和方向处理，保留原图坐标与来源。几何映射使用已有库/工具，异常框、空结果和越界应显式处理。
3. 固定“整图 → 检测 → crop → logits → CTC → 带框文本”结果合同；CTC 时间步不是视频时间戳，识别分数也不是已校准置信度。
4. 重跑既有 11 张条图，新结果不可比基线 12/239 字符错误更差；另冻结至少 50 个未参与调参的中英文文本区域，分别报告 exact match、CER、漏检与误检。
5. 从 S2 中英文分钟级素材抽取预先标注的帧，验证字幕区域、标点、空格、数字、低对比与遮挡。保留未归一化的原始指标，标点/Unicode 归一化只能另报辅助指标。
6. 在看 holdout 结果前书面确定新数据集的质量门槛。未达门槛保留研究状态，不靠词典纠错后文本掩盖模型错误，也不增加未授权云调用。

研究链通过后才设计编辑器入口；用户应能区分画面 OCR 与语音字幕识别。保存坐标、文本和来源，预览与导出一致后才能称编辑器 OCR 完成。

## 10. 统一测试与证据

所有命令从 QCut 工作区运行。`$PY` 指已有研究虚拟环境，ONNX 编辑器测试使用独立无 Torch 的 `$ORT_PY`；实际绝对路径和模型/媒体 SHA 写入私有报告，不提交机器配置。

日常只跑本步受影响测试；跨模块合同修改和发布前执行完整研究回归及类型检查：

```sh
"$PY" -m unittest discover -s research/local-model-pytorch -p '*test*.py'
bunx vitest run electron/__tests__/claude-scene-handler.test.ts electron/__tests__/claude-scene-routes.test.ts electron/__tests__/jianying-shot-split-onnx.test.ts electron/native-pipeline/cli/__tests__/cli-handlers-analyze-shots.test.ts
bunx tsc -p electron/tsconfig.json --noEmit --pretty false
bunx tsc -p apps/web/tsconfig.json --noEmit --pretty false
```

前端菜单/路由测试从 `apps/web` 目录运行：

```sh
bunx vitest run src/components/editor/timeline/__tests__/video-clip-context-menu.test.tsx src/components/editor/timeline/__tests__/timeline-scene-routing.test.ts
```

真实编辑器需要先构建 Electron 与前端，不依赖旧 `dist/`。下列命令是完整验收模板，实际执行范围以第 12 节为准：

```sh
bun run build:electron
bun run --cwd apps/web build:electron
export QCUT_JIANYING_SHOT_SPLIT_ONNX_PYTHON="$ORT_PY"
export QCUT_JIANYING_SHOT_SPLIT_ONNX_CONTRACT="$SHOT_CONTRACT"
export QCUT_ONNX_SHOT_E2E_SOURCE="$SIX_SECOND_MONTAGE"
bun run qcut analyze shots --engine onnx --check --json
bunx playwright test onnx-shot-split.e2e.ts --project=electron --workers=1 --retries=0 --reporter=line --output="$EVIDENCE_DIR/editor"
```

类型检查使用 `tsc --noEmit`。不要用单独输出文件的 `tsc -p electron/tsconfig.json` 代替 `bun run build:electron`：它会覆盖需要 esbuild 打包的 runtime 桥接产物，导致 Electron 从 `@qcut/editor-core` 的 TypeScript 源码解析不存在的 `.js` 模块。执行过该命令后须重新运行完整 Electron 构建。

`$SHOT_CONTRACT`、`$SIX_SECOND_MONTAGE` 必须是有效绝对路径，`$EVIDENCE_DIR` 必须是新的 `.local/jianying-model-pytorch/phase6-<step>-<run>/` 绝对目录。缺任意私有输入导致 skip，必须记为“未执行”，不能当通过。失败诊断追加 trace 时仍保存到该私有目录，不往公开 docs 输出报告。

每次至少记录：基线/结果 commit、step、命令、环境、输入与产物 SHA、成功/失败/skipped、完整日志、截图路径、未解决项。媒体测试再记录帧数/时长、切点或文本指标、进程退出和残留情况。

## 11. S8：提交与发布规则

- 维持同一分支/PR；不重写前五阶段结果，不顺手扩大到其他实验室或模型。
- 只暂存本步明确路径，每个文件独立 commit，检查 staged 与 committed tree 都只有该文件，再 push。中间单文件提交不必独立可构建，但一组依赖修改必须在组尾通过测试。
- 公开 CI 只含自编合成夹具；私有 E2E 结果以脱敏摘要记录，原始资产仍在本机。
- 安装包检查只验证声明支持的系统与显式能力；模型授权、运行依赖和错误提示未解决前，不改默认引擎、不默认自动下载、不宣称产品可用。
- 更新本文相应步骤的状态和证据后停止。最终报告列“已验证 / 失败 / 未执行”，不用统一完成百分比替代验收。

## 12. 当前执行记录

| 步骤 | 实现 commit | 验收证据 | 结论 |
| --- | --- | --- | --- |
| 文档 | `b0aaeaf5c` | 核对当前源码入口与第五阶段报告 | 初稿完成 |
| S1 | 登记 `c2b95f3ed` / `dbc312dbe`；用例 `f740f859e` | 下方首次推进与启动复验记录 | 定向回归及真实冒烟通过；重开与异常矩阵待验收 |
| S2–S8 | 无 | 无 | 未开始 |

### S1 首次推进记录

- 新增 `apps/web/src/lib/media/register-desktop-video.ts`，由 `addMediaItem()` 在对 UI 暴露条目前等待完成。沿用 project ID/media ID 和现有 `mediaImport.import`，不放宽场景检测的路径入口。
- 将已有临时视频复制到项目 `media/imported/`，持久化新的 `localPath`。不用指向临时目录的 symlink；对已在目标位置的媒体跳过重复导入，防止底层 unlink 删除源自身。Web、非视频与无 localPath 的导入行为不变。
- 本轮不自动迁移历史项目的未登记媒体，也未宣称完成重开、删除源文件及 Windows 权限矩阵；这些仍属于 S1 未验收项。
- 新 helper 10 项、media-store 10 项、场景路由 32 项，合计 **52/52 通过**。前端类型检查、Vite 构建、Electron TypeScript 编译、新 helper/test 的 Biome 检查通过。
- 追加一个 S1 真机冒烟用例：普通 UI 导入，按原 ID 查询项目媒体，检查落盘文件，再通过右键触发真实 ONNX。没有 mock 推理或成功状态。
- 真实运行 **1 failed**，失败在 `electron.launch`，未进入媒体导入。启动日志报告 `ERR_MODULE_NOT_FOUND: packages/editor-core/src/color-providers.js`，由 `packages/editor-core/src/index.ts` 引用。按本轮限额停止该测试进程，没有转入编辑器打包修复；本次没有生成成功截图，不能称 `Media not found` 已获真实 E2E 验证。
- 私有日志：`.local/jianying-model-pytorch/phase6-s1-{unit,types,build,electron-build,lint,e2e}.log`；E2E 目录 `phase6-s1-editor/`。本轮测试进程已结束，未操作用户项目。
- 当时的下一步是校正 Electron 启动产物并补媒体身份、重开和错误场景证据；启动复验结果见下方，仍未开启 S2。

### S1 启动复验（2026-09-19）

- 代码基线 `3adb6b00ae8f4ca10b44b495cd8656a720ac70ab`。本次只校正构建流程、运行已有 S1 用例并记录结果，没有修改产品源码。
- 上次只执行输出文件的 `tsc`，覆盖了 `editor-core-tracking-runtime.js` 和 `jianying-text-runtime/reference.js` 的 esbuild bundle，留下对 `@qcut/editor-core` 的直接 `require`。该包导出 TS 源码，其 `.js` 引用无法由 Electron 解析。这是上次验证流程遗漏，不是已证明需要修改包导出的产品缺陷。
- `bun run build:electron` 完成，两个 runtime 的 Node `require` 冒烟均通过。前端沿用同一源码基线的已构建产物；本次没有重跑前述 52 项单元测试。
- 在独立 Electron profile/documents 下执行现有 `S1 resolves an ordinary imported video and runs real ONNX inference`：**1 passed，0 failed，0 skipped，10.5 秒，无重试**。普通 UI 文件导入后，按原 renderer media ID 查到项目 `media/imported/${mediaId}.mp4`，实际文件存在且大小与输入一致（354852 字节）。查询结果的 API ID 仍采用现有文件型 ID，不代表两种 ID 已统一。
- 右键菜单实际触发本地 ONNX，任务返回 `engine: onnx`、`route: qcut-jianying-shot-split-onnx-v1`，状态 completed，时间线从一个片段变为四段；没有 mock 推理。已保存两张截图与 `media-resolution.json`，并目视检查切分后截图中的预览、四段时间线及成功提示。
- 本次用例只证明这条正常路径及片段数量，不证明绝对切点位置、逐帧预览、撤销、重开或导出。重开、删除源文件、中文/空格路径、重复文件名、无效/跨项目 ID、导入未完成及 Windows 行为仍待验收。S2–S8 未开始。

复验命令（三个输入环境变量均已指向本地真实文件）：

```sh
bunx playwright test onnx-shot-split.e2e.ts --grep 'S1 resolves' --project=electron --workers=1 --retries=0 --reporter=line --output=.local/jianying-model-pytorch/phase6-s1-startup-editor
```

私有证据均位于 `.local/jianying-model-pytorch/`，不提交 Git：

- 构建与测试日志：`phase6-s1-startup-build.log`、`phase6-s1-startup-e2e.log`。
- 证据目录：`phase6-s1-startup-editor/onnx-shot-split.e2e.ts-Pri-c5bd0-nd-runs-real-ONNX-inference-electron/`。
- 目录内文件：`01-imported.png`、`02-media-resolved.png`、`media-resolution.json`。

本次构建与测试进程均已正常退出，未操作用户项目。下一步仍只补 S1 尚缺的重开或一个异常场景，不启动大规模模型验证。
