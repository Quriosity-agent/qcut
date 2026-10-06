# beauty-7-kpop：P4 取消与重试、P5 视频会话协议

日期：2026-10-05。分支：`beauty-7-kpop`，基于 master `a2c6ab625`。
前置：[接手顺序与验收门槛](beauty-kpop6-priority-handoff-2026-10-05.zh-CN.md)。
工作目录为 Git 仓库内 `qcut/`；下文路径均相对此目录。

## 结论边界

- 本轮只改 QCut 自己的 Electron 主进程、渲染进程和 CPU 合约，没有新的原生实跑。
  没有启用产品候选后端，没有放宽任何核验门槛。
- P1–P3（小脸消费、三维接管、独立几何）需要分析剪映闭源库的内部实现，本轮没有继续，
  交接表中这三项的状态不变。
- 新增的交互 e2e 已写好并能被 Playwright 识别，但**尚未实跑**，原因见下文。

## P4：取消与失败后重试

### 改动

- 新 IPC 通道 `beauty-lab:cancel-candidate`，只取消与当前 `requestId` 相同的任务。
  请求已过期、属于别的请求或后端空闲时返回 `{ cancelled: false }`，不会中止任何任务。
- 进程失败分为：未启动、取消、超时、输出超限、进程错误、退出码、信号退出，并记录是否动用了 SIGKILL。
  抛出的仍是原来的 `Error`，文案不变；分类信息放在模块内的登记表里。
- “失败后必须重启”改为按证据判定，见下表。
- 渲染进程：主进程尚未结束的请求一直记为在途。在途期间“候选处理”禁用，并显示“取消核验”。
  用户主动取消不当作错误；被取消的请求即使主进程先完成，也不显示像素。
  任何没有成功的结束都会重新读取后端状态，所以失效请求触发的重启阻断也能及时显示。
- 状态栏区分“上一次核验仍在运行”和“上次核验未能确认清理，需重启 QCut”。

### 免重启重试的条件

以下条件全部满足才放行，否则保持 `live-static-audit-failed-restart-required`：

| 条件 | 要求 |
| --- | --- |
| 失败类型 | 任务从未启动；或用户取消、任务自报失败（退出码），且没有动用 SIGKILL |
| 清理回执 | 本任务目录下的 `audit/report.json`：`passed=false`，`native_launch_lease` 等于本任务租约，`dependencies_unchanged=true`，`cleanup.completed=true`，`cleanup.failures` 为空，所有 `roots` 均 `reaped=true` |
| 读取方式 | 钉住任务目录，拒绝符号链接，读取期间校验文件未变，上限 8 MiB |
| 复核 | Electron 侧的请求依赖清单和源码快照再次校验通过 |

超时、信号退出、输出超限、进程错误、强杀、无回执、租约不符、任务成功但事后结果校验失败、
依赖变化，一律仍需重启。取消发生在研究探针安装信号处理器之前或写报告期间时，
拿不到回执，同样按需重启处理。

### 差距清单：研究能力是否穿过 IPC/job/result

`research/local-model-pytorch/face_live_candidate_job.py` 调用研究探针时只传基础单帧参数：

| 研究能力 | UI 任务是否使用 | 影响 |
| --- | --- | --- |
| Extra 精修 `--extra-root` | 否 | UI 结果不含 Extra 精修 |
| 小脸 reshape 发布 `--publish-reshape-candidate` | 否 | UI 里的小脸结果不覆盖 P1 验收；P1 闭环前不能当作候选消费证据 |
| 美妆发布、轮换、消费（`--publish-makeup-candidate`、`--rotate-makeup-points`、`--consume-makeup-candidate`） | 否 | UI 走基础单帧审计路径 |
| 诊断追踪（stages、face readers、mesh、Extra trace） | 否 | 只在研究命令行使用 |

请求范围由 `electron/beauty-lab-live-selection.ts` 决定：一次只允许一个非零阶段，
即一项脸部全局参数或一张美妆卡；美妆强度必须大于 0；不支持多卡、指定人脸、手动修饰和身体参数。
参数全部为 0 时，请求在任何原生工作之前就被拒绝，不会触发重启阻断；改参时旧结果立即清空，不残留。

### 交互 e2e

新增 `apps/web/src/test/e2e/beauty-lab-live-candidate-interactions.e2e.ts`，依次覆盖：

1. 口红“柔和粉”核验；
2. 切换到“珊瑚裸粉”，旧图清空后重新核验，同一输入、不同 `requestFingerprint`；
3. 强度恢复为 0，旧图清空，候选请求在原生工作前被拒绝，后端仍可用；
4. 切换第二张人像，`sourceKey` 和 `inputSha256` 都变化后重新核验；
5. 运行中取消：不报错、不显示像素；之后要么直接重试成功，要么明确显示重启阻断，结果写入报告。

每一步都核对原生与候选零差异，最后确认时间线没有被改动、页面没有报错。

**未实跑的原因**：实跑需要选择一个 Apple 开发签名身份（`QCUT_BEAUTY_LAB_SIGNING_IDENTITY`），
新身份第一次访问还可能弹出系统授权窗口，这两件事都必须由用户决定。运行命令：

```sh
export QCUT_BEAUTY_LAB_SIGNING_IDENTITY='<Apple Development certificate SHA-1>'
bun run build:electron
(cd apps/web && bun run build:electron)
QCUT_BEAUTY_LAB_LIVE_CANDIDATE=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH="$PWD/output/beauty-kpop-v3-20260930/face-controls/sources/front-smile-original.jpg" \
QCUT_REAL_PORTRAIT_IMAGE_PATH_2="$PWD/output/beauty-kpop-v6-20261002/source/kpop-front-original.png" \
QCUT_BEAUTY_LIVE_INTERACTIONS_OUTPUT=output/playwright/beauty-live-interactions-20261005-r1 \
bunx playwright test beauty-lab-live-candidate-interactions.e2e.ts --project=electron --workers=1 --reporter=line
```

## P5：有界持续会话协议（未接入产品）

`electron/beauty-lab-video-session.ts` 是纯状态机，不含计时器、worker 或像素，调用方传入当前时间：

- **代际**：跳转、换源、取消都会让代际加一；旧代际的结果一律作废，永远不能替换新画面。
- **预览**：在途已满时只保留最新的一个待处理帧，更旧的待处理帧在推理前丢弃并计数，
  时间状态不会在被丢弃的帧上推进。较早的结果晚到时也作废。
- **导出**：按计划范围逐帧、按顺序、只接收一次，不丢帧；容量满时返回背压；
  乱序完成的结果经重排缓冲按顺序交付；任意一帧失败或超时，整个导出失败，之后不再交付。
- **容量**：作废但仍在 worker 中的帧继续占用名额，直到返回或超时，跳转不会造成超额派发。
- **时间状态**：每个代际的第一帧、时间间隔超过阈值或时间倒退时，标记重置。
  预览中某帧失败后，下一帧也重置。连续失败达到上限时，整个会话失败。
- **结束**：取消后不再接收新帧；所有已派发的帧结束后才能关闭。
- **统计**：提交、派发、交付、丢弃、作废、失败、超时、代际数、最大在途数，延迟 p50/p95/p99 和吞吐。

`electron/beauty-lab-video-face-tracks.ts` 负责多脸稳定 ID：

- 按 IoU 贪心匹配，平局时依次按重叠度、较早的轨迹、较小的检测序号决定，结果确定。
- ID 只增不减、永不复用，时间状态不会从一个人转到另一个人。
- 短暂遮挡在宽限帧数内保留 ID，重新出现时重置时间状态；超过宽限即退役，再出现时分配新 ID。
- 新代际让所有轨迹退役；同一代际内帧号必须递增；超过人数上限的检测只计数，不建轨迹。

两组共 42 项 CPU 合约测试。

### 尚未完成

- 真实的流式解码、worker 接入，以及预览与导出的同帧对比。
- 性能目标：先与原生基线和产品要求确定，再实测，不能用实测值反推“合格”。
- 实测顺序：单脸 10 秒，单脸 60 秒，双人交叉和遮挡 60 秒，分别覆盖 BASE、Extra、美妆和形变。
- 报告字段中的时间误差、UI 响应、峰值内存和增长情况，要在接入实跑时补上；当前模块只提供计数、延迟分位和吞吐。

## 验证

- Beauty Lab 相关 Vitest：38 个文件，1,765 项全部通过，其中本轮新增 106 项。
- 全仓类型检查通过；改动文件全部通过 Biome 检查。
- 交接文档中的 108 项研究 CPU 冒烟在本分支通过，0 skip。
- 新增 e2e 能被 Playwright 识别，尚未实跑。

## 下一步

1. 用户确定签名身份后实跑交互 e2e，根据结果更新本文。
2. P5 接入真实 worker 前先定性能目标，从单脸 10 秒开始。
3. P6 平台层面：在其他平台上没有可用后端时明确拒绝，不能静默返回原图并标为成功。
