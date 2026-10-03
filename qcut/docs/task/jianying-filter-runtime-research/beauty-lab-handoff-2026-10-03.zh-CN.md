# 美颜实验室交接与下一步

更新：2026-10-03。分支：`codex/kpop-beauty-v6`。继续使用 PR #483：
https://github.com/Quriosity-agent/qcut/pull/483 。不新建分支，不合并、不发布。

工作目录：`/Users/peter/Desktop/code/qcut/qcut`，Git 根目录是其上一级。先阅读此文档，不再继续旧 agent；本轮子任务已经收尾。

最新检查点见下面“自有采样到实际渲染检查点”。新生成的 160/120 输入已贯通 ONNX、seed、平滑、坐标回映和实际 renderer，固定七帧最终 RGBA 零差。实时驱动仍未注册；不能把固定序列研究验收等同于任意画面产品后端接通。

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

**新链路尚未接任意画面的实时推理。回放不是独立产品后端。** 完整画面形成 algorithm RGBA、检测/几何/路由和最终效果渲染仍依赖原生。最新研究链不再使用捕获的 160 tensor 或 native smoothing seed 生产点位，但这不代表 detector/身份/跟踪已独立。旧失败的 direct-affine 候选仍未启用。

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

上一检查点的 160 调查见 [actual 160 preprocessing](../../../research/local-model-pytorch/face-160-preprocess-next-probe-2026-10-03.zh-CN.md)。静态调用关系是 BGR 转换/旋转 → CropObjectRegion → resize → forward/inverse matrix → 160 predictor；矩阵在像素预处理之后构造，不是直接采样定义。当时仅定位 call site、Rect、target、分支、expansion 和返回 Mat，尚未捕获实际值。

该调查另跑 60 项 CPU 回归，旧 50 个 source 哈希仍匹配。两个旧 direct-affine 候选仍各有 67,068/76,800 个 int8 值不同，最大差 177，继续拒绝替换。该旧方案及原审计没有修改；新捕获与自有采样见下面。

## 实际 160 采样检查点

详细证据、参数、边界和复现命令：[actual preprocessing parity](../../../research/local-model-pytorch/face-160-actual-preprocess-parity-2026-10-03.zh-CN.md)。本轮只新增 research 采集/重放源文件和测试，不改旧 50 source、模型、运行库、效果包或产品 candidate 能力声明。

- `face_preprocess_memory.py`：有界 Mat/Rect/实际 caller 栈与字段读取。
- `face_preprocess_lldb.py`：最多四个同时启用的硬件点，采集 source、crop-after、resize-return、Predict 前像素；只读，不用软件断点或目标函数求值。
- `face_preprocess_probe.py`：旧源码/报告哈希锁定、两台串行 fresh host、七帧最终 RGBA 中立性、prediction/face-ID/network/window 关联。
- `face_preprocess_replay.py`：实际 algorithm RGBA + pre-crop Rect/flags/expansion → 自有 BGR/crop/resize/int8。捕获像素只在生产之后做比较，不能输入生产函数。
- 最终采集为 `.local/jianying-model-pytorch/face-160-preprocess-host-20261003-r6/`：26 predictions、34 callbacks、最大 4 个活动硬件点；七帧 `changed_pixels=0,max_delta=0`。
- 最终自有重放为 `face-160-preprocess-replay-20261003-r5/`：prediction 0/20 的 source（921,600 值）、crop（230,187 值）、resize/int8（各 76,800 值）全部零差。两次是同一图和几何的冷启动/重获，非两个不同姿态样本。
- 实际 pre-crop `[221,81,204,277]`、flags `[1,0,0]`、expansion `1.0` → post-crop `[185,81,277,277]` → nearest 160×160。不是通过 matrix 反解 ROI 来采样。
- 本轮 CPU 回归 242 项通过（146 新测试 + 96 已有回归），没有重新跑产品 E2E/全仓库/CI；旧产品 E2E 不算新 driver 验收。三个子任务均已关闭，原生探针进程均已退出。
- R5 采集曾 unexpected stop，被拒绝并保留失败记录；具体原因未定位。探针增加停止原因诊断，不自动继续、不退回软件断点；R6 完整通过。实验探针偶发停止仍是残余风险。
- 该采样检查点当时尚未连接 ONNX/seed/时序/回映/renderer 的完整审计；后续对拍见下面。native algorithm RGBA 生成、人脸框与 caller 参数仍需原生，任意画面驱动继续 `not-connected`。

## 自有采样到实际渲染检查点

详细流程、指标、SHA、复现和依赖：[owned chain parity](../../../research/local-model-pytorch/face-preprocess-owned-chain-parity-2026-10-03.zh-CN.md)。本轮四个新模块分别负责采集证据、独立 160 输入、模型/点位 replay 和实际 renderer，复用旧算法而不修改旧 50 source 或精度门槛。

- 原始 neutral capture 仍是 `face-160-preprocess-host-20261003-r6/`；新最终 replay 为 `face-preprocess-chain-replay-20261003-r4/`，新最终 renderer 为 `face-preprocess-chain-render-20261003-r4/`，均在 `.local/jianying-model-pytorch/`。
- 160 两次输入与 120 全部输入都由自有采样生成，并且 ONNX 真正消费 replacement inputs；不是重复喂捕获 tensor。ORT 1.22.1、Torch-free，私有环境补 Pillow 12.2.0，未改产品依赖。
- 120 模型 25 次 + 160 模型 2 次，共 135 个输出头比较通过原门槛；27 个 landmark head 精确相同。初始化 0/20、decode/tracked/temporal/normalized 点位均零差，没有 native final-point 校正。
- 实际渲染外部点 24 次，恢复 24 次；七帧基准→候选 `changed_pixels=0,max_delta=0`。非零效果确实改动原图；无脸和零效果控制不变化。保存四列对比 PNG 和七张统一 gain8 灰度差分，已人工查看。
- 新关联拒绝测试发现 size/inference/record_index 的 bool/float 类型和 marker-window 缺口；收尾测试另发现最终文件 guard 失败未撤销像素通过/完成标记。两者均已修复，空模型 SHA 必须拒绝，再跑实际模型及 renderer；最终证据以 R4 为准，不修改旧报告。
- 最终 CPU 回归 611 项通过：155 新测试（输入桥 36、采集证据 44、replay 44、renderer 31）+ 456 已有相关回归。三个子任务已关闭，本轮实际模型/宿主进程已退出。
- 仍是同一正脸的 0–0.2 秒固定序列；不能宣称多人、侧脸、分钟级、其他格式/旋转或 Windows/x86 已通过。native algorithm RGBA、detector/Rect/flags/matrix/表/identity/reset、其余效果数据/渲染和模型/效果资产仍有依赖。
- 本轮没有改前端，没有重新跑产品 Electron E2E、全仓库/CI 或发布。产品 candidate provider 的 `not-connected` 和禁用状态保留；新离线记录未冒充实时驱动。

## 代码入口

- `apps/web/src/components/editor/properties-panel/beauty-lab-dialog.tsx`：弹窗与工具栏。
- `beauty-lab-controls.tsx` / `beauty-lab-presets.tsx`：草稿控件、只读浏览、隔离预设。
- `apps/web/src/lib/portrait/use-beauty-lab.ts`：输入、状态、原生请求、请求过期保护。
- `beauty-lab-catalog.ts` / `beauty-lab-difference.ts` / `beauty-lab-export.ts`：目录、差分、ZIP。
- `electron/beauty-lab-contract.ts` / `beauty-lab-handler.ts`：类型、IPC 来源与参数校验。
- `beauty-lab-research.ts` / `beauty-lab-research-files.ts` / `beauty-lab-research-evidence.ts`：固定记录编排、安全文件读取、证据结构。
- `apps/web/src/test/e2e/beauty-lab.e2e.ts`：真实运行时的可复现桌面测试。

## 下一步顺序

1. 先看最新 neutral capture R6、owned chain replay R4 / render R4 的 `report.json`、前一产品 E2E `output/playwright/beauty-lab-candidate-protocol-20261003-r3/e2e-report.json` 和 Git 状态。核对本地 HEAD 与远端 PR HEAD；每个文件单独 commit 后 push，不改精度门槛。
2. 下一卡点是完整画面到 algorithm RGBA：确认缩放、格式、stride、旋转和真实解码 PTS，逐阶段捕获并独立重放。已打通的采样/ONNX/seed/平滑/坐标回映/renderer 保持回归；旧 50 source 及旧审计不变。
3. 将 native detector/Rect/flags/matrix/identity/reset 等剩余依赖做成显式实时输入契约，再扩展新的格式/旋转/caller profile。当前两次相同几何的零差不能推广到任意画面。
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
