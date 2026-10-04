# Beauty Lab v7：真实链路、逐项对照与剩余卡点

日期：2026-10-04。分支：`codex/beauty-live-hybrid-v7`。
从最新获取的 master `48ef89e546ee3964c9101f773cbb3dce3cb5832f` 建立。
PR：[484](https://github.com/Quriosity-agent/qcut/pull/484)。采用一文件、一提交、逐个 push。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。

## 第四阶段：授权后实跑、遮挡恢复与验收边界

本节是最新状态；以下第二、三阶段保留为历史失败记录。
**命令行授权后实跑成功，但 Electron 新建的 live-host 又单独触发桌面访问授权，真实候选按钮验收仍未完成。**
本轮没有修改系统授权数据库、迁移宿主绕过权限或把旧失败报告改成通过。

### 原图链与实时交接

- 最小 LLDB 程序重新启动、退出和清理均成功。真实宿主随后进入模型回调，原先的桌面授权等待不再阻塞这次实测。
- 首次新 live 运行暴露的是 LLDB Python 环境没有 NumPy。worker 协议层已改为纯标准库，
  并用 `python -S` 验证调试器模块的导入；仍严格拒绝重复 JSON 键、非有限数、溢出及非 UTF-8 输入。
- 新 live 报告 `face-live-bridge-native-20261004-r2/report.json`：26 次预测、61 次观察回调、
  24 次克隆点交接与恢复；7 帧与独立新运行的原生基线逐字节一致。130 项是 head **哈希收据**，不是原生 head 数值比较。
- 完整原图链 r4 从原始 RGBA 自产算法画面、120/160 网络输入，执行 ONNX、解码、初始化、平滑及归一化。
  135 项 head 数值比较、24 次点转换和 7 帧最终 RGBA 对照通过；没有消费原生算法 RGBA 作为生产输入。
  证据目录：`face-full-frame-owned-{capture,replay,render,audit}-20261004-r4`。
- 原图链导入 Beauty Lab 后，真实 Electron E2E 的 2 项测试通过：逐一查看 7 帧、统一增益 x8 灰度差分、
  ZIP 内容、移动视口、只读参数和时间线隔离。截图/报告：`output/playwright/beauty-original-owned-ui-20261004-r1`。
  第 0 帧原图到效果改变 41,872 像素，候选到原生差异为 0；第 3 帧为有意的空白对照，不是丢图。

上述 `face-*` 简写目录在 `.local/jianying-model-pytorch/`。
这仍是固定单脸 profile：检测、调用几何、路由/表数据与效果渲染保留原生依赖。
原图离线全链通过与 live 桥通过是两套不同证据；live 桥仍使用原生全帧预处理，不把两者拼成未实测的实时独立后端。

### 五项遮挡冷启动恢复

产品链增加显式 `needsSourcePreRoll`：检测不到脸且输出未变化时，读取同一视频实际历史帧，
上限 16 帧、0.5 秒、64 MiB。退役旧跟踪器后按时间顺序回放，再处理原来的目标帧。
不能拿当前帧重复冒充历史，不能跨 source，也不对逐脸身份、手动画笔或稳定源假装恢复成功。
预览和导出都接入原始媒体解码入口；有取消、输入/参数快照和缓存约束。

`output/playwright/beauty-portrait-acquisition-20261004-r2/report.json` 的五项均恢复：
相对原图分别改变 719、753、753、868、868 像素，与正常顺序播放参考的像素差均为 0。
同样目标帧的独立冷启动对照仍无效果，证明恢复来自真实历史而不是降低通过门槛。
输入、冷启动、恢复、顺播及 x8 差分共 25 张 PNG 保留在该目录。来源和进程清理复核通过。
注意 `portrait-motion-70.mkv` 是 **70 帧、约 2.33 秒**，不是 70 秒；不能拿它作分钟验收。

真实产品 E2E：`output/playwright/portrait-source-preroll-20261004-r4/report.json` 通过。
从原始 MKV 转为浏览器可解码的 MP4 后，走 Electron 时间线、真实媒体历史帧解码、IPC、原生渲染及 renderer-muxer 导出。
没有注入预制历史帧或伪造 native 回包。预览改变 731 像素，导出编码前改变 747 像素，
二者各自与对应解码路径的顺播参考差异均为 0；两条解码路径的输入不完全相同，不跨路径强行比较哈希。
暂缓一份真实回包后跳到其它位置，旧请求没有补发历史恢复、没有覆盖新画面；该测试验证过期交付隔离，不声称取消原生算法执行。
导出 854x480、30fps 的单帧 MP4 可解码；有损编码后的灰度平均差约 2.049、阈值 3，
编码差异与原生恢复的零 RGBA 门限分开报告。来源/bundle 哈希复核未变，无 page error。
截图：`cancelled-target-ui.png`、`recovered-target-ui.png`；原图/恢复/顺播/灰度 PNG 和 `recovered-target.mp4` 同目录。

### 分钟与跨平台

- 真实 `news.mp4` 长 103.994 秒，测试连续处理 1,800 帧、跨度 60.026633 秒，没有循环、补帧或抽样冒充连续运行。
  独立第二遍的 1,800 帧全部一致，三项跳转/暂停/换源检查通过。
  `.local/portrait-minute-plan-20261004-r1/native-r1/minute/report.json` 保留首轮结果。
  这是原生产品链离线验收，不是 ONNX 候选的 30fps 实时性能证据。
- r2 新运行再次通过上述分钟对照：1,336 帧有可见效果、464 帧无像素变化，重跑 1,800 帧无差异。
  无效果帧全部计数，仅采样点做独立检测分类，未检测的无效果帧不擅自归因为无脸。
  两遍加跳转等检查约 350 秒、worker 峰值 RSS 452,624,384 字节；不是实时帧率报告。
- 首轮双脸测试的变化区域落在计算出的检测框外，失败报告 `native-r1/multiface/report.json` 保留。
  原生 FaceBuffer 框以左下角为原点，RGBA 行以左上角为原点；测试 oracle 显式换算 y 后重新 native 运行，
  没有扩大 ROI 或降低零误差门限。`native-r2/multiface/report.json` 的 A、B、A 重访、全脸、换源 A、零值对照均通过。
  选 A 改变 6,461 像素，选 B 改变 2,833 像素；未选人脸和脸外变化均为 0。
  这是双脸静态素材，不是自然多人视频，不证明遮挡/交叉后的动态身份稳定。
  r2 目录仍位于 `.local/portrait-minute-plan-20261004-r1/`。
- r2 总报告没有改成通过：分钟、静态多脸及 lifecycle 成功，但后续进程取消遇到 `EPERM`。
  诊断补丁记录 PID/进程组/信号/操作/errno，并保留最初错误，避免 finally 的清理错误覆盖真正原因。
  新的 `.local/portrait-cancellation-20261004-r2/attempt-{1,2,3}/report.json` 三次独立取消均通过：
  原生 face 预热生效后排队 3 项再发 SIGTERM，worker 退出、进程组消失、临时目录删除、来源复核通过。
  `EPERM` 未复现，因此不声称已确定其系统原因；旧 r2 失败不被新小范围试验改写。
  这验证外部 worker/进程组取消，不是一个新增的原生 SDK abort API。
- 公开 CPU/合成 ONNX 合同在 Windows x64、Linux x64、macOS ARM64 CI 均通过。
  例如运行 [37173459821](https://github.com/Quriosity-agent/qcut/actions/runs/37173459821)。
  Windows 明确不运行 Unix socket 与 libm 专用项；这不等于私有模型在三个平台已完成效果验收，
  更不等于 Windows 原生美颜渲染已经可用。

### 候选启用策略

新增开发版显式选择的单帧核验入口：`QCUT_BEAUTY_LAB_LIVE_CANDIDATE=1`。
每次使用当前原图和参数新建隔离任务，执行独立原生基线与 ONNX live 交接，只有本次零 RGBA 差异且来源/清理检查通过才返回候选像素。
不读取旧报告代替本次处理，也不把 baseline 像素当 candidate 返回。
门限为非打包版、macOS ARM64、开发/测试模式；全局 features 精修参数范围内使用。
标记 `audited-single-static-frame`，不授权多脸、时间线、分钟候选或跨平台产品启用。
原生阶段耗时未测得时返回 null 和原因；自有 worker 的耗时是包含 warmup 的累计值，不伪装成单帧延迟。

真实候选按钮首轮失败记录：`beauty-live-candidate-jobs/static-gGYHAf/audit/report.json`。
独立原生基线已完成；live-host PID 74869 在 2026-10-04 14:22:29（本地时间）被系统记录为
`AUTHREQ_PROMPTING service=kTCCServiceSystemPolicyDesktopFolder`，调用栈停在 dyld `__open`，worker 尚未预测。
它与之前命令行通过的宿主不是同一次调用，不能沿用授权成功的结论。
取消后报告保守标记后代身份变化导致的清理不确定；后续进程检查确认该次 LLDB/debugserver/host/worker 已退出，
但不把失败报告的 `cleanup.completed=false` 改写为 true。已请用户自行处理系统权限，未自动授权。
UI 截图见 `docs/completed/test-results-raw/beauty-lab-live-candidate.-43fac-d-stale-result-invalidation-electron/test-failed-1.png`。
候选没有显示旧图片，没有把原生结果回填为通过；目前仍不得宣称真实候选 UI E2E 成功。

交叉审查后的防误报/清理补强：逐次读取并核验 baseline RGBA 本体；绑定 worker 收据与源码/ONNX 文件摘要；
只接受固定私有运行时内的 features 包；任务启动后的任何失败令候选进入必须重启的 blocked 状态。
前端失败后重新检查就绪状态；导出将单帧核验与任意帧就绪分开。退出应用会先取消并等待候选任务清理。
相关 46 个测试文件、1,245 项 Vitest 全过；整个仓库类型检查与 Electron 构建通过。
这些验证不代替尚待授权后的新 UI native 实跑。

授权后的明确复测入口（使用新的输出目录，不覆盖 r1）：

```sh
QCUT_BEAUTY_LAB_LIVE_CANDIDATE=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH="$PWD/.local/jianying-model-pytorch/face-live-validation-20261004-r1/fixtures/front-smile/eye/face.png" \
QCUT_BEAUTY_LIVE_OUTPUT=output/playwright/beauty-live-candidate-ui-20261004-r2 \
bunx playwright test beauty-lab-live-candidate.e2e.ts --project=electron --workers=1 --reporter=line
```

通过条件包括本次实时推理、新原生基线、实际 UI 图片、ZIP 身份、原生/候选零 RGBA 差异、
修改参数后旧结果失效和时间线未变。失败后须结束并重启测试应用，不能在被锁定的旧后端上反复点击。
仍未完成的验收不能自动放开：ONNX 分钟序列、自然多人运动/遮挡后的身份稳定、Windows/x86 原生渲染与私有模型整链。
公开三平台合成 CPU 测试不包含这些私有资源，也没有对应原生硬件结果可供推定。

## 第三阶段：收尾验证与真实阻塞（历史）

本节覆盖第二阶段的当前状态。**尚不能称为完整独立美颜后端，也没有启用产品候选按钮。**
下列代码均在同一 PR，按单文件提交、逐次 push；私有模型、库、效果包、人物素材与大型报告不入 Git。

### 已接上的代码

1. `face_preprocess_chain_replay.py --original-frames` 从固定的原始 RGBA 生成算法画面与 120/160 输入，
   再交 ONNX、自有解码/初始化/时序/归一化。原生算法画面只做相等性对照，不做输入生产者。
   `render` 与 `audit` 同样增加显式 `--original-frames`，重算输入证明、检查模型消费哈希与逐字节渲染。
   交叉审查补上启动渲染前的 head 文件哈希与关键点重算，缺失 head 或直接复制 oracle 点会先被拒绝。
   默认旧模式不变；失败不会退回原生 tensor 或最后关键点。当前仍是固定单脸 profile，
   检测框、调用几何、路由、表数据及效果渲染仍依赖原生。
2. `face_live_bridge_probe.py` 串起新输入、独立原生 baseline、常驻 ONNX worker、
   LLDB 入口观察、宿主回调、克隆关键点交接与 GPU 完成后的恢复审计。
   默认只准备输入和编译；真正执行必须显式 `--execute-native --lease ...`。
   逐帧 RGBA 容差为 0；只记 head 哈希并不等于 head 数值已和原生对齐。
3. `face_live_bridge_response.h` 在原生访问前校验字典/数组/数字类型，区分 JSON 布尔与数字，
   检查 token、PID、预测序号、时间戳、来源声明、106 个有限归一化 XY 点，拒绝错帧/错会话结果。
   原生 Foundation 合同测试 58 项通过；完整 live host 也已编译。
4. `face_native_process.py` 按 PID、启动时间和可执行路径跟踪 LLDB 后代。
   debugserver 的目标可能另建进程组，旧 `killpg(lldbPID)` 不能保证清理它；
   新实现同时处理脱离/重新挂到 PID 1 的已观察后代、PID 重用、超时与正常退出。
   已用真正脱离父进程的 CPU 子进程回归，不是只 mock `kill`。
   交叉审查还覆盖 xcrun -> LLDB 的根进程 exec；身份有歧义的后代不误杀，也不把未清理报告成成功。
5. 六功能预检支持显式 `--effect-cache-root`，私有包优先、缓存只能使用同一资源 ID 与固定版本。
   拒绝符号链接逃逸、根目录被替换及内容哈希漂移。下颌线从指定剪映缓存找到，
   其余仍取私有运行时；没有自动复制或上传任何资源。

### LLDB 启动阻塞的明确原因

新的无参数宿主、旧的已成功宿主、最小 hello 程序在调试器下都停在启动阶段。
系统日志在 `2026-10-04 11:27:45.775` 对诊断宿主 PID `33015` 给出：

```text
AUTHREQ_PROMPTING: service=kTCCServiceSystemPolicyDesktopFolder
accessing identifier=host, pid=33015
```

这是 macOS 桌面文件夹授权等待，和之前采样到的 dyld `__open` 相符。
尚未进入模型回调，不能把它记为 ONNX、裁剪或关键点数值失败。
已请求用户亲自处理系统弹窗；不修改 TCC、不迁移程序绕过授权、不关闭系统保护。
新的完整原图链与实时桥仍需要授权后的新采集，旧报告没有被改写成通过。
等待期间的诊断宿主 PID 33015 已核验启动时间与路径后终止，复查不存在；没有留下等待授权的孤儿进程。

CPU 准备记录：`.local/jianying-model-pytorch/face-live-bridge-prepared-20261004-r4/report.json`。
其 `prepared=true, completed=true, passed=false`；`passed=false` 是因为没有执行 native，
不是“编译通过所以实时通过”。报告保存三个编译命令、来源清单及精确重跑命令。
零效果对照还必须相对原图零像素变化，不能因为 baseline/candidate 同样错误就算通过。

六功能资源记录：

- 私有目录缺下颌线：`face-feature-campaign-six-private-preflight-20261004-r1/report.json`。
- 最终源码冻结后的显式缓存预检：`face-feature-campaign-six-cache-plan-20261004-r2/preflight-report.json`，六项通过，重新加载计划的 guards 通过。
- 计划 SHA-256：`4999b74b2b4aeac8bb4fca6339e104180a70a1532e59b4a6c251a912f5f02edc`。
- 预检报告 SHA-256：`22c5b1f6f08b3d6836f2920fba8dbcf17348934c357cfe5de0ab9b985e9d6a18`。
- 锁定 282 份研究源码、7 份产品源码、5 个不同效果包目录；这只是资源可用性，不是效果 parity。
- 旧 r1 计划与报告保持原样，不代表后续源码的验收。

上述简写路径均在 `.local/jianying-model-pytorch/`。再改源码必须重建计划，不能给旧计划换哈希。

### 产品缓存跳转修复

真实视频序列发现：向前命中帧缓存再往回跳，缓存早退绕过了原生跟踪状态重置。
首轮 `backward-after-cache-hit` 相对独立冷启动差 752 像素，最大通道差 8。
现在每个 scope 保存最后实际渲染的 cache key；只有相同帧/参数的暂停重读保留状态，
读取其它缓存结果时退役旧跟踪器。缓存像素不能伪装成跟踪器已经处理过该帧。
同时覆盖同时间戳换参数、不同 source 交错、暂停复用及返回缓存后的逆向跳转。
逐脸历史缓存不直接返回，而是走现有会话重映射，避免 A -> B -> 缓存 A 丢失人物绑定；
完全相同的暂停请求仍可复用。多阶段渲染开始前使缓存状态标记失效，任何阶段失败都退役整个 scope，
并等待失败宿主退出，避免上游已前进、下游失败后继续混用旧状态。两项问题均先用失败测试复现再修复。

首轮与修复后记录分别在：
`output/playwright/beauty-portrait-session-native-20261004-r1`、`...-r2`。
修复后上述状态差异为 0，但该帧冷启动与原图相同，因此仍被标记 `effect-no-op`，没有算通过。
这批源视频抽取帧 60--69，共 8 张不同画面、时间跨度 0.30 秒；不是分钟级验证。
部分帧含手遮眼及背向人物，仍需将冷启动检测边界与跟踪状态问题分开验收。

最终重跑绑定了 350 份源码、bundle、宿主、运行库、模型与效果包文件，结束时复核未改变：

| 最终产品原生序列 | 结果 | 边界 |
| --- | --- | --- |
| `beauty-portrait-session-native-20261004-r4-pre-occlusion` | 52/52 | 源帧 52--61，3 张不同画面，跨度 0.30 秒 |
| `beauty-portrait-session-native-20261004-r4` | 47/52 | 源帧 60--69，8 张不同画面，5 项冷启动无效果仍失败；重置基准差异全为 0 |

目录均在 `output/playwright/`。两组均通过独立 worker 取消、进程组退出和临时目录清理。
`clear()` 验证的是排空队列，不是产品 UI 取消或原生 abort API；时序诊断允许与独立冷启动不同，
因此“52 项通过”不能改写成“52 帧全部与独立冷启动逐像素一致”。

单独诊断见 `output/playwright/beauty-portrait-noop-diagnosis-20261004-r1/diagnosis.json`：
源帧 60/69 的新识别各有 1 张脸；65/66/68 各为 0，67 与 66 的 RGBA 相同。
绕过 provider 缓存直接调用 host，每帧 6 次命令、共 12 次 render pass，重复时间戳与递增时间戳都不能让
65/66/68 生效；从 60 连续跟踪过来则能在这些帧持续改变像素。
这支持“遮挡下冷启动获取不到脸”的解释，不是普通缓存命中或少一次预热造成。
仍未证明渲染器内部全部检测条件，也没有通过调低检测阈值掩盖失败；下一步需研究前滚/轨迹恢复并实测，
不能直接把当前无效果计作成功。

缓存修复后的桌面矩阵也重新执行，而非只复用第二阶段截图：
`output/playwright/beauty-v7-palette-kpop-r5`（20 项，39.8 秒），
`output/playwright/beauty-v7-palette-smile-r2`（20 项，34.6 秒），
`output/playwright/beauty-v7-palette-mature-r2`（20 项，34.8 秒），共 60 项。
均真实点击、处理、导出 ZIP、逐像素校验统一 8 倍灰度、alpha 不变、时间线不变；没有新的剪映 UI 导出对照。
已目视检查最新鼻子 UI 中差异集中于鼻部，以及 390px 组合效果灰度图。

### 当前回归与继续条件

- Torch-free 主环境 1,590 项通过，启用了本地 ONNX 模型的 smoke/state 测试，无跳过。
- Torch/ONNX 依赖环境 72 项、OpenCV 环境 22 项通过；与主环境有重叠，不相加成唯一数量。
- 产品定向 Vitest 46 文件、650 项通过；Electron 再次重建通过。
- `bun run check-types` 全部工作区通过；定向 Biome 与 `git diff --check` 通过。
- 收尾发现远端 Ubuntu/Windows 的来源门禁在 `git ls-files` 触发 `ENOBUFS`：
  15,029 个路径共 1,049,197 字节，超过原默认 1 MiB。已改为无 shell 的 Git 调用、
  NUL 分隔和 64 MiB 有界缓冲，保留全仓库扫描及所有来源规则；超限/命令失败仍拒绝通过。
  15 项测试通过，包括真实临时 Git 的超限清单、末尾违规项和中文/空格/换行路径。
  Windows 不运行其文件系统不支持的 POSIX 名称用例，其余案例加入三平台 CI。
  实际全仓库来源检查和脚本 TypeScript 检查通过；远端新 HEAD 仍需完成，不能据本地结果称 CI 全绿。
- 初次混跑的两项 ONNX 缺依赖与两项源码数量断言失败已修复/在正确环境补跑。
  导出证据清单由 62 增为 63，并明确验证新进程清理模块的哈希，没有放宽原始 50 源码 guard。

授权后顺序：冻结源码 -> 新 temporal/capture baseline -> 新 preprocessing capture ->
`replay --original-frames` -> `render --original-frames` -> `audit --original-frames` ->
新 live bridge 执行。所有阶段必须写入新目录，不复用失败或源码已变的记录。
之后再扩展实际分钟级连续视频、多人/遮挡、预览/导出、跨平台与候选后端注册。
旧 UI 导出器仍只接受旧固定 profile；原图模式未完成真实验收前不能借旧 schema 对外宣称通过。

### 完整完成的验收门槛

| 未闭合项 | 下一步 | 通过条件 |
| --- | --- | --- |
| 新原图链 | 用户处理系统授权后重新采集、回放、渲染、审计 | 当次源码/素材绑定；输入、模型输出、关键点、RGBA 各层独立证明通过 |
| 实时 ONNX 接管 | 显式启动 baseline/live 宿主与常驻 worker | 真实回调收到当前帧；消费/恢复收据完整；RGBA 零差；零效果对照也保持原图 |
| 遮挡下冷启动 | 用独立参考验证源帧前滚/轨迹恢复，覆盖正反 seek | 不串人物、不复用过期状态；此前 5 项有明确修复证据，而非移除或降阈值 |
| 产品候选接入 | 前三项通过后扩展证据 schema 并注册后端 | 编辑器预览/导出同链；缺资源或失败明确报错，不伪装候选通过 |
| 广泛可用性 | 分钟级、多脸、遮挡、连续滑杆、取消/恢复及跨平台 | 独立记录正确性、资源清理和性能，不由短序列/静态图推断 |

系统授权只解除第一处外部阻塞，并不自动满足其余验收；目前不能对外标为“彻底完成”。

## 第二阶段：当前状态

本节更新第一阶段的结论；后面的第一阶段记录保留历史复现信息，不能把旧报告当作当前源码验收。

| 部分 | 已完成与证据 | 尚未完成 |
| --- | --- | --- |
| 五种肤色 | 真实资源 ID、包解析、全局参数、预设/项目保存、缓存键和色块 UI 已连接；最新构建三种人物各 20 项，共 60 组真实 Electron 用例通过 | 四种 LUT 仍来自本机剪映缓存，不是全部已收进 QCut 私有运行时；未重新操作剪映 UI 做基准 |
| 笑脸多次 160 推理 | 依调用顺序和生命周期选择初始化；新眼睛/鼻子采集、ONNX、渲染、审计全部通过，共 300 heads、14 帧零像素差 | 这些序列仍使用原生 160 tensor；完整自有 160 裁剪探针仍是较窄的固定 profile |
| 逐项验证驱动 | 产品 catalog 生成眼、鼻、下颌线、嘴、磨皮、口红用例；冻结来源、参数、运行库、模型、包、输入；保存失败阶段和统一增益 PNG | 六项全量 preflight 因所选私有运行时缺少 jawline 包而拒绝，不能声称六项全链已通过 |
| 原图到 ONNX | 原始 RGBA -> staged-q11 -> 自有 120/160 输入 -> ONNX 的入口及严格来源检查已写好；93 项相关 CPU 测试通过 | 新真实 preprocessing 采集在 LLDB 启动阶段超时，完整新链验收尚未完成 |
| 持续进程桥接 | 有限长度 Unix socket、会话/进程/预测绑定、调用入口参数观察、持续 ONNX、克隆结果交接原型；宿主/dylib 编译通过，65 项核心/协议测试通过 | 尚未完成真实宿主回调 -> worker -> 消费者渲染验收；没有注册产品实时 backend |

### 两处初始化问题和修复

笑脸 prediction 0、20 实际存在 `160 -> 120 -> 160`；prediction 24 又有一次后置 160 检测。
旧代码把每次出现 160 都当成初始化，且审计器把每次预测限制为最多两次网络调用。

现在仅当新的人脸身份确实需要 seed 时，选取同一网络、同一预测窗口中唯一位于 120 之前的 160。
后置检测不重置现有人脸时序；不按坐标误差挑选结果，不从原生最后关键点生成候选。
审计器允许第三次推理的条件限定为单活动人脸的 `160 -> 120 -> 160`，仍拒绝重复记录、
重复 inference、错误 owner、两个前置候选和两个后置候选。采样和坐标容差仍为 0。

实际重新采集的结果：

| 新采集 | Heads | 最终 RGBA | 证据根目录 |
| --- | --- | --- | --- |
| K-pop 眼睛，原生 160 输入 | 135 | 7/7 完全一致 | `.local/jianying-model-pytorch/face-feature-campaign-kpop-20261004-r2/portrait-00-eye/temporal/campaign-00` |
| 笑脸眼睛，原生 160 输入 | 150 | 7/7 完全一致 | `.local/jianying-model-pytorch/face-feature-campaign-smile-temporal-20261004-r2/campaign-00` |
| 笑脸鼻子，原生 160 输入 | 150 | 7/7 完全一致 | `.local/jianying-model-pytorch/face-feature-campaign-smile-temporal-20261004-r2/campaign-01` |

当前新验收共 21 帧、435 heads；不是 21 位人物，也不是所有功能已独立替代。
笑脸两组共 48 次候选消费/恢复，四阶段各通过；源代码哈希和原始证据重新校验通过。
两组完整耗时 47.26 秒包含研究采集/回放/审计，不能换算成产品预览帧率。
原图/原生/候选/固定 8 倍灰度差分见 `face-feature-campaign-smile-comparison-20261004-r2/report.json`。

### 肤色实际接线和回归

`skinToneResourceId` 的五个允许值对应后文列出的真实 LUT 包。
缺省字段保留历史粉白路径；`null` 表示明确的“无”，即使残留冷暖值也不重新激活效果。
色块只作用于全局；不能伪装成逐人脸资源。选取色块会清理冲突的逐脸肤色值，但保留其它五官和美妆。
单脸编辑中应用含全局肤色的预设时，肤色留在全局，其它参数仍写入所选人脸。
全局应用预设也走同一清理逻辑：已用失败测试复现旧逐脸肤色残留造成冲突，再修复；其它逐脸五官保留。
缺包时禁用对应色块，缓存键包含资源 ID。粉白优先保留旧包版本，避免旧项目静默换效果。
首次启用使用目录默认强度 60，这是 QCut 的明确行为，不声称已验证剪映点击色块时的默认动作。

新增桌面测试从 12 项扩展为 20 项：五种资源、None、选中但零强度、肤色与磨皮/大眼/口红组合，
以及原有零效果、皮肤、脸型、眼鼻嘴眉和口红。每项实际点击 UI、处理、下载 ZIP 并独立解码校验。
五种输出各不相同；显式粉白与旧粉白输出相同；None/零强度与原图相同；alpha 不变。
灰度统一为 `min(255, 8 * max(abs(delta RGB)))`；这些原图差值是效果影响量，不是剪映/QCut 误差。

最终预设修复后重新构建 web，重新执行三组桌面矩阵：

| 素材 | 当前结果目录 | 结果 |
| --- | --- | --- |
| 正面 K-pop 肖像 | `output/playwright/beauty-v7-palette-kpop-r4` | 20/20，36.5s |
| 正面笑脸 | `output/playwright/beauty-v7-palette-smile-r1` | 20/20，38.9s |
| 户外男性人物帧 | `output/playwright/beauty-v7-palette-mature-r1` | 20/20，37.5s |

每组包含 `report.json`、原图/结果/灰度 PNG、逐项 UI 截图和 ZIP，以及 390px 窄屏截图。
三组均 `sourcePixelsVerified=true`、`pageErrors=[]`、`jianyingUiComparisonPerformed=false`。
已目视检查笑脸暖白 UI、K-pop 窄屏和笑脸鼻子三方对照，后者原生/候选差分全黑。
这里的 60 组是原生功能/导出验收，不是 60 组独立候选后端验收。

### 仍保留的失败

1. 第一轮笑脸渲染已完成，但旧的“两次推理”审计限制拒绝；保留 `face-feature-campaign-smile-20261004-r1`，没有改写为成功。
2. 修复后的 K-pop temporal 四阶段通过，但后续 `preprocess` 的 LLDB 启动 300 秒超时，
   没有生成 host 输出或裁剪 trace；其 aggregate `passed=false`，后四阶段 skipped。
   路径：`face-feature-campaign-kpop-20261004-r2/portrait-00-eye/preprocess/report.json`。
   独占 GPU 再试 `face-full-frame-owned-capture-20261004-r3` 仍在 300 秒超时，进程已清理。
   新采样显示目标停在 dyld 的 `getOnDiskBinarySliceOffset -> mapFileReadOnly -> __open`，
   debugserver 在等待进程事件；尚未进入宿主主函数/推理回调。这定位到启动文件打开阶段，
   当时尚不能区分文件系统、系统安全检查或调试器；第三阶段已用系统日志定位为桌面文件夹授权等待。
   样本保存在该目录，未生成新 trace。旧进程组清理方式的局限也已在第三阶段修正。
3. 完整任意画面、多人、真实分钟级视频、跨平台实时桥和效果渲染器独立替代仍未验收。
4. worker 的真实 CPU ONNX 测试使用合成依赖，不能替代原生调用方对照；研究回调仍需要原生检测、
   裁剪调用参数/逆矩阵、路由状态和渲染器。换素材/seek 要重启 host 和 worker，不是在旧时序状态上接着算。

### 第二阶段复现入口

- `research/local-model-pytorch/face_feature_campaign.md`：逐功能计划、冻结与执行方法。
- `face_full_frame_owned_probe.py --capture NEW_PREPROCESS --root ONNX_ROOT --out NEW_OUTPUT`：只接受严格校验的新采集；CPU-only，不会渲染。
- `face_live_worker_test.py`、`face_live_worker_protocol_test.py`：状态、取消、错序、超时、截断、JSON/像素上限测试。
- `electron/__tests__/jianying-portrait-skin-tone-native.ts`：可选直接原生探针；不能替代真实桌面矩阵。

广泛回归按依赖拆分执行：最终 Torch-free 主环境 1,469 项通过；ONNX/Torch 导出环境补跑 52 项、OpenCV 环境补跑 22 项。
最初混跑有四个模块因缺依赖加载失败，已经在对应环境补跑，不计为忽略或通过。
之后新增三推理审计测试 71 项定向回归、worker/core 65 项通过。这些运行有重叠，不叠加成唯一测试总数。
最终产品侧定向 Vitest 共 42 文件、1,142 项通过，web 重建、先前 Electron 构建及 scoped Biome 通过。

### 直接原生肤色探针

当前 Bun 1.3.9 不支持此依赖链的 `node:sqlite`。使用 Node CommonJS bundle，不通过 ESM 执行含 `__dirname` 的宿主解析器：

```sh
bunx esbuild electron/__tests__/jianying-portrait-skin-tone-native.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/jianying-portrait-skin-tone-native.cjs
node dist/electron-audits/jianying-portrait-skin-tone-native.cjs INPUT_IMAGE FRESH_OUTPUT_DIRECTORY
```

探针记录源图/LUT/结果 SHA-256，五种 LUT 各自结果、相对原图/粉白的固定 8 倍差分，
并验证显式粉白与 legacy 相同、None/零强度不变、仅冷暖仍有作用、原图/LUT 未被修改。
1448x1086 原图实测 9/9 通过：`output/beauty-v7-skin-tone-native-20261004-r3/report.json`。
None 和 zero 的 `changedPixels=0`；仅冷暖 25 时改变 334,140 像素，最大通道差 7。
初次 Bun 运行失败和 ESM 试运行失败未算入通过数；最终 CommonJS/Node 入口已实际跑通。

接下来优先顺序：诊断/重试 LLDB preprocessing -> 原图输入链真实 ONNX 验收 -> 真实 live worker 渲染交接 ->
逐项扩展独立采样 profile -> 真实动态长视频、多脸、seek/取消及预览/导出一致性。
没有取消、修改或重标旧报告来源来放行；模型、包、私有素材、原生库和大体积结果不入 Git。

## 第一阶段快照

本轮推进了真实计算核心、当前源码取证、实验室接线和逐项 E2E；没有把离线回放注册成实时后端。

| 部分 | 本轮结果 | 不能据此声称什么 |
| --- | --- | --- |
| 原始 RGBA 到算法 RGBA | 找到 staged-q11 整数双线性规则；新采集的 26 次观察全部逐字节相同 | 尚未证明原生调用路径；没有串入完整实时链路 |
| 持续 ONNX 核心 | 两个模型只加载一次；依赖包校验、独立采样、推理、解码、初始化、时序、归一化接通 | 输入几何等仍由调用方提供；宿主实时回调未接通 |
| 自有 160/120 完整离线链 | 新采集、新 ONNX 推理、新原生渲染、重新审计；7 帧 RGBA 完全一致 | 仅固定 K-pop profile；仍依赖原生检测、几何、模型/效果资源和渲染器 |
| 扩展人物/参数 | 接受的 4 组序列共 28 帧一致；另加上述自有采样 7 帧，共 35 帧 | 不是 35 张不同人物，也不是所有功能已独立替代 |
| 实验室原生功能 | 3 种人物素材 x 12 个用例，共 36 组通过 | 只验证原生处理和导出；本轮没有重新操作剪映 UI 做独立基准 |
| UI | 已验收记录可浏览美妆分类，不能修改记录；桌面/390px 窄屏验证 | 肤色五资源切换、手动笔刷和美体辅助线尚未补齐 |

## 当前两条链路

产品原生链路：

```text
QCut 原图/滑杆 -> QCut 宿主 -> 原生库 + 模型 + 效果包
  -> 检测/关键点/跟踪/形变/皮肤/美妆 -> QCut 预览或导出
```

本轮新增、仍处于研究阶段的核心：

```text
算法 RGBA + 显式依赖包（几何/身份/接受状态/重置/滤波参数）
  -> QCut 自有 160/120 采样
  -> 持续 ONNX Runtime 1.22.1 CPU 会话
  -> 自有解码/映射/160 初始化/时序平滑/归一化
  -> 候选关键点 + 耗时/哈希/依赖声明
  -> [尚缺实时宿主回调与渲染交接]
```

`face_live_candidate.py` 的 NDJSON 是内部逐次预测协议，不是显示帧协议。
首次 prediction 必须是 0，后续必须连续；换素材或 seek 需要新实例。
只接受已观察的单脸、普通非缓存 Base 路由、orientation=0、紧密 RGBA。
失败不推进状态；无脸清空状态；不接受重新激活的旧人脸 ID。
调用方不能提供原生最终关键点或旧时序状态。审计器只能接受/拒绝，不能修改候选坐标。
当前返回 `native_callback_connected=false`、`renderer_connected=false`、
`arbitrary_frame_backend_connected=false`，产品候选按钮仍如实显示未接入。

## 差异逐层验证

### 1. 全帧缩放的 1 灰度级差异

之前普通浮点双线性会残留最大 1 级差异。本轮比较 73 个规则，只有 `staged-q11` 全部匹配：
半像素坐标、float32 坐标运算、11 bit 最近偶数权重、分阶段整数截断。
横向加权和先右移 4 bit；两个纵向乘积分别右移 16 bit，求和加 2 后右移 2 bit。
去掉横向截断时，首帧就有 2,114 个通道值不同。

证据：`.local/jianying-model-pytorch/face-full-frame-quantization-fresh-20261004-r1/report.json`。
26 次观察、7 个帧槽、4 张不同输入、31,948,800 个 RGBA 字节全部相等。
报告 SHA-256：`a813c8b3ce97e065f936f1e9a920af99dddf9ac0083a87ffd00a7c7cb52be504`。
采样器只读原图，没有按图拟合或用 oracle 修正输出。
该结果是独立采样诊断，不替代完整 pipeline 的重新验收。

### 2. 持续 ONNX 核心

实际模型 smoke/state 测试已启用，不是全部 mock 或 skip。
记录依赖上的新推理报告位于：
`.local/jianying-model-pytorch/face-live-candidate-runtime-evidence-20261004-r1/`。

- `fresh120-report.json`：25 个自有输入完全相同；125 项 head 比较通过；48 组 stage1/映射坐标完全相同。
- `owned-core-report.json`：2 次 160、24 次 120；26 个输入完全相同；130 项 head 比较通过；24 组归一化坐标及滤波状态完全相同。
- 两次 160 seed 对应 prediction 0、20；无脸 prediction 18、19 清空状态。
- prediction 18 的被拒绝推理单独诊断，不发布为有效人脸；加上它才是 135 项 head 比较。
- 最大 head 绝对差约 `2.3841858e-6`，使用原有输出门槛；采样/坐标容差仍为 0。

报告分别保存完整 `rerun_command`、输入/模型/源码哈希和逐项结果。
这两份报告没有再调用渲染器，不能与渲染帧数重复相加。
CPU 推理耗时不是包含传输、检测、渲染的端到端实时性能结论。

### 3. 当前源码完整采集与桌面显示

原来硬编码的旧 report 路径会因源码变化正确触发拒绝。
本轮增加显式路径，但要求原审计中的 SHA 完全匹配；保留严格的 50-source union。
新的自有采样 UI 包验证 62 个当前源码身份及 9 份原始报告，不改写旧报告。

完整运行清单和命令见：
`research/local-model-pytorch/face_live_validation_20261004.md`。
新包：`.local/jianying-model-pytorch/face-live-validation-owned-ui-20261004-r1/`。
包 index SHA-256：`bb865486018174734f170b0a1a496e1842927cc525ceff3d06a8abb4bf33ce93`。

QCut 实际 Electron E2E：7 帧加载、三方对照、全黑的原生/候选差分、只读分类切换、
ZIP 图片相同、时间线不变、390x844 不横向溢出均通过。
截图：`output/playwright/beauty-v7-owned-r1/read-only-makeup.png`。
实测报告 SHA-256：`9d96ab4f0365d9e68b8381a22ed8c213636bf437904691e11e9b01e8db5d3aba`。

### 4. 逐部位原生 E2E

每张素材分别运行：零效果、磨皮、祛斑祛痘、肤色/冷暖、下颌骨、下巴、眼睛、鼻子、嘴巴、眉毛、口红、组合效果。
每项通过真实 UI 设值、真实 IPC/原生处理、真实下载 ZIP。
独立解码素材绑定导出原图；独立逐像素重算 MAE/max/changed pixels；
灰度统一采用 `min(255, 8 * max(abs(delta RGB)))`，没有逐图拉伸对比度。
零效果必须完全不变，非零用例必须有变化，alpha 不变，无页面错误，不能改变项目时间线。

| 素材 | 最终结果目录 | 结果 |
| --- | --- | --- |
| 正面 K-pop 测试肖像 | `output/playwright/beauty-v7-matrix-kpop-r2` | 12/12，24.1s |
| 正面笑脸 | `output/playwright/beauty-v7-matrix-smile-r2` | 12/12，26.3s |
| 户外男性人物帧 | `output/playwright/beauty-v7-matrix-mature-r3` | 12/12，29.3s |

目录中有每项 `original.png`、`native.png`、灰度图、UI 截图及 ZIP，文件名前缀是用例名。
`report.json` 的 `sourcePixelsVerified=true`；`jianyingUiComparisonPerformed=false`。
有像素变化不等于语义效果已经和剪映 UI 完全一致；这些不是所有部位的独立 ONNX 替代结果。

## 失败与未覆盖

1. 笑脸扩展序列在 prediction 0、20 各有 2 次实际 160 推理，prediction 24 又有 1 次。
   现有初始化关联只允许唯一一次，故明确拒绝；不能选择第一个结果凑通过。
2. 一次鼻子测试在源码并发变化时被 TreeGuard 拒绝；冻结后重跑男性鼻子序列通过，
   后续笑脸鼻子仍被上述初始化门槛拒绝，整个 aggregate campaign 仍是失败。
3. 43MP 原始照片被 40MP 导入上限正确拒绝；随后使用已知尺寸的人物帧。
   没有放宽保护，超大照片不能计为成功素材。
4. 未验证多人、任意角度、真实长视频时序、Windows/x86 原生宿主、任意输入实时性能。
5. 这批测试不证明完全摆脱剪映二进制，也不证明模型与效果包可以重新分发。

## 肤色资源的真实结构

本机 `~/Movies/JianyingPro/User Data/Config/Modules/beauty_panels.ini` 与已缓存效果包显示：

| 色块 | 资源 ID | 元数据颜色 |
| --- | --- | --- |
| 美黑 | `7408757645705743616` | `#A9775D` |
| 粉白 | `7408757645705760000` | `#fad1c0` |
| 冷白 | `7408757645705776384` | `#fdebe2` |
| 暖白 | `7408757645705792768` | `#ffdcba` |
| 小麦色 | `7408757645705809152` | `#d6a273` |

五个选择是不同皮肤 LUT 包，属于 `face_adjust_skin` 互斥组、仅全局应用；不是虚构的 palette-index 参数。
各包共同暴露 `face_adjust_skin_Intensity` 和 `face_adjust_skin_ColdWarm`；QCut 当前固定资源对应粉白。
目录默认值 60 不代表实际选择时一定写入 60。
下一步需观察真实 draft 字段、资源切换、无/重置、强度和冷暖是否保留，以及保存重开。

## 复现与测试

从工作目录执行；原生/GPU 测试串行运行，源码变化后重新采集，不能修改报告哈希来解锁。

```sh
env QCUT_E2E_OFFSCREEN=1 \
  QCUT_REAL_PORTRAIT_IMAGE_PATH="$PWD/output/beauty-kpop-v6-20261002/source/kpop-front-original.png" \
  QCUT_BEAUTY_LAB_RESEARCH_RUN=face-live-validation-temporal-20261004-r1 \
  QCUT_BEAUTY_LAB_OWNED_RUN=face-live-validation-owned-ui-20261004-r1 \
  QCUT_BEAUTY_OWNED_CHAIN_OUTPUT=output/playwright/beauty-v7-owned-rerun \
  bunx playwright test beauty-lab-owned-chain.e2e.ts --project=electron --workers=1 --reporter=line

env QCUT_E2E_OFFSCREEN=1 \
  QCUT_REAL_PORTRAIT_IMAGE_PATH="$PWD/output/beauty-kpop-v6-20261002/source/kpop-front-original.png" \
  QCUT_BEAUTY_MATRIX_OUTPUT=output/playwright/beauty-v7-matrix-rerun \
  bunx playwright test beauty-lab-native-matrix.e2e.ts --project=electron --workers=1 --reporter=line

env QCUT_FACE_LIVE_MODEL_ROOT=.local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest face_live_candidate_test

bunx vitest run electron/__tests__/beauty-lab- apps/web/src/lib/portrait/__tests__ \
  apps/web/src/components/editor/properties-panel/__tests__/beauty-lab- \
  apps/web/src/components/editor/properties-panel/__tests__/portrait-
```

最终本地验证：445 项 Python 测试（无 skip，包括真实 ONNX）；37 个 Vitest 文件、1,061 项通过；
原有 Beauty Lab E2E 2 项通过；owned-chain 1 项通过；native-matrix 三次各 12 组通过。
Electron 构建、web 构建、web TypeScript、改动 TS 文件的 Biome 和 `git diff --check` 通过。
这些不是远程 CI 已绿的声明；PR 仍保留 draft，未合并、未触发发布。

## 下一步顺序

1. 对多次 160 初始化建立 prediction/network/inference/caller/face 唯一关联，先修笑脸失败样本；保持原阈值。
2. 给原生宿主加逐预测依赖回调，使用本轮契约传算法 RGBA/几何/身份/重置，加入超时、取消和 seek 清理。
3. 将持续核心输出交给真实渲染消费端，先逐帧验证输入、heads、关键点与 RGBA，再注册产品候选 backend。
4. 将 staged-q11 接入新链并重新验收完整 provenance；扩展非整比例、边界尺寸、方向及 alpha 测试。
5. 肤色真实资源切换验证后补色块 UI；手动笔刷/美体覆盖层另外隔离推进。
6. 使用中英文真实分钟级口播、多脸、侧脸、遮挡、丢脸恢复和连续 seek，验证预览/导出一致性及 p50/p95 耗时。

源码和文档入 Git；模型、原生运行库、效果包、私人素材和大体积输出不入 Git。
