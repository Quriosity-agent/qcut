# 自研美体接入视频片段（2026-10-18）

> 本文保留 2026-10-18 桌面接入及当时验收记录。后续[单人动态美体闭环验收](body-video-closure-2026-10-18.zh-CN.md)补齐计算中 worker 意外退出后的单次重提交、检查点重放，以及工程重开／素材重链接的会话身份修复。这些桌面修复保留；该文档的固定 mode 1、播种后同帧 refine、首个身体帧更新 8 次和 180 帧像素结果属于当时的 `93a9a99d…` 引擎快照，不作为当前合并代码的原生规则或完整 E2E 结论。

> 当前原生内核以[缺体帧与位移历史](independent-body-loss-2026-10-19.zh-CN.md)、[跳时与 RESET_PARAMS](independent-body-reset-2026-10-19.zh-CN.md)、[尺寸变化、默认多人选择与显式宽肩蒙版](independent-body-multi-mask-2026-10-19.zh-CN.md)为准：按原包时间门控选择输入类型，逐提交帧推进状态；不额外插入同帧 refine 或 8 次几何更新。本文历史结果中的“人体消失输出原图”及“初检多人直接原图”不再代表当前规则。

> [多个成功脸槽与原生重复合并](independent-body-face-slots-2026-10-18.zh-CN.md)还原了五槽分配、去重和 ID 输出顺序；其 v2 检查点是历史版本，当前检查点为 v5，包含后续原生时钟、尺寸及蒙版状态。人体默认仍只追踪一个目标，不能把五个人脸槽解释为五个人体同时处理。

[上一轮](independent-body-temporal-2026-10-18.zh-CN.md)把连续视频内核做成了显式离线 API。本轮把它接进编辑器：时间线上使用自研引擎、带智能美体数值的视频片段，暂停预览和导出都按片段自身的历史渲染，不再把每一帧当照片处理八次。手动美体、人脸项和照片路径不变。

## 会话模型

- **会话**：一个片段的帧序列，从片段第一帧开始。第 j 帧是片段本地时间 `j / fps` 的帧，与片段在时间线上的位置无关。帧 k 必须在 0..k-1 之后渲染。
- **会话身份**：`sha256(引擎构建, 片段身份, 处理尺寸)`。片段身份由渲染进程计算：时间线元素 id、素材 id、素材字节数与完整文件内容的 SHA-256（不取 `File` 对象的文件名／修改时间：工程重开后存储层按素材 id 重建 `File`，修改时间变为 OPFS 写入时间，旧身份曾因此在重启后作废，见闭环验收 §3.6）、`trimStart`／`trimEnd`、倍速与速度关键帧、倒放、定格、项目帧率，以及按加载器规则规范化后的 `portraitAdjustments`（含将来可能的关键帧曲线）。移动片段不改变身份；两段剪自同一文件的片段各有会话，历史不会交错。每帧实际使用的数值只进帧缓存键。身份 schema 为 4；复用 `sha256Blob` 按最多 4 MiB 的分块读取完整文件，按 `File` 对象用 `WeakMap` 共享并发和重复摘要，读取失败不保留被拒绝的缓存。只改文件中段也会改变内容身份，旧首尾采样的碰撞缺口已由回归覆盖。
- **帧缓存**：沿用 `independent-beauty-frames` 磁盘缓存，键在原有基础上加 `(会话, 帧号)`。暂停预览和导出都用 `SequentialVideoFrameSource` 自己解码片段帧，再绘制到处理尺寸，因此提交给引擎的是同一份字节，键相同，缓存互通。
- **检查点**：`body_sequence_checkpoint.capture/restore` 把骨架跟踪、视频人脸跟踪／恢复窗口／roll、十部位持久几何、位移历史、时钟及锁存蒙版序列化（当前 v5；新几何配置已记录的无显式蒙版活动快照约 244–250 KB，本文早期约 50 KB 的测量属于旧配置），不含模型句柄；读回时只允许 numpy 数组件和引擎自己定义的类。worker 每 12 帧写一份到 `<userData>/Cache/independent-beauty-sessions/<会话>/<帧号>.snapshot`，内存里另保留一份；切换会话时保存离开会话的最新状态。超过 2 GiB 时按最近使用时间删除整个会话目录（当前会话除外）。
- **跳帧协议**：worker 请求带 `sequence {session, frame, timestamp, checkpoints}`。帧号等于当前会话的下一帧则继续；为 0 则重启（模型不重载）；有恰好对应的检查点则恢复；否则回复 `{ok:false, gap:{restartFrom}}`，`restartFrom` 是不大于目标帧的最近检查点（或活动会话的下一帧，或 0），worker 进程保留。主进程把它变成 `{status:"replay", from}`，渲染进程解码并按序提交 `from..k-1`（`replay: true`，跳过缓存读取但写入缓存），再请求 k。
- **worker 故障恢复**：计算中的 worker 意外退出会抛出 `IndependentWorkerExitedError`，主进程仅重提交一次。写入 stdin 的 `EPIPE`／`ERR_STREAM_DESTROYED` 即使先于进程 exit 事件到达，也按该类型处理，避免通用管道错误绕过恢复。新 worker 没有内存历史时按上述 gap 协议从检查点重放；已有取消、超时或无效响应原因保留，任意其它管道错误不归为可重试退出，连续第二次退出仍向上报错。管道事件竞态有回归测试覆盖，不属于新增产品 E2E 验收。原有 180 帧 E2E 证明的是[旧引擎快照下的桌面恢复](body-video-closure-2026-10-18.zh-CN.md)（§4.4），合并后的原生内核仍须用当前代码复跑该产品场景。
- **取消**：会话帧不在中途杀进程——帧一旦开始，引擎历史已前进，结果写入缓存后再返回；渲染进程在帧与帧之间检查取消信号。普通照片帧的取消语义不变。
- **多人**：当前按原包默认单目标配置，从 coarse 解码候选中保留首个满足有效关节规则的候选；已有目标继续 refine，不因新人物入画重新选人。目标丢失后先 coarse 播种，下一帧 refine 成功才发布身体。候选选择、身份复用与交叉遮挡的验证边界见[默认多人规则](independent-body-multi-mask-2026-10-19.zh-CN.md#原包默认多人选择与追踪)。
- **能力位**：`inspectIndependent().bodyVideo` 为真当且仅当运行时里有引擎钉住的 `research/body-face-video-policy-v1.json`（sha256 与 `body_face_policy.py` 一致，有镜像测试）。没有它、帧率不在 10–240、素材不是视频或没有非零美体值时，走原来的逐帧照片路径。

## 代码位置

| 层 | 文件 |
| --- | --- |
| 引擎 | `research/body_sequence_checkpoint.py`、`research/independent_sequence_sessions.py`、`research/body_smart_sequence.py`（`restart()`、原生逐帧生命周期）、`research/independent_worker.py`（`sequence` 请求、gap 回复、计划缓存）、`research/independent_pipeline.py`（`cached_canonical_plan`） |
| 主进程 | `electron/beauty-lab/beauty-lab-independent-body-video.ts`（会话身份、能力位、序列渲染器、目录清理）、`beauty-lab-independent-worker.ts`（gap 回复不杀进程）、`beauty-lab-independent.ts`（`sequence` 透传、`bodyVideo`）、`beauty-lab-independent-frame-cache.ts`（键）、handler／services／preload |
| 渲染进程 | `apps/web/src/lib/portrait/independent-body-video.ts`（适用判定、帧号映射、片段身份、解码器、重放驱动）、`independent-portrait-frame.ts`、`browser-color-rendering.ts`、`export-engine-renderer.ts`、`color-preview-canvas.tsx`、`preview-element-renderer.tsx` |
| 测试 | Python：`tests/test_body_sequence_checkpoint.py`（含真实模型逐字节恢复）、`tests/test_independent_sequence_sessions.py`、`tests/test_independent_worker.py`、`tests/test_body_sequence_scenarios.py`；Vitest：`electron/__tests__/beauty-lab-independent-body-video.test.ts`、`apps/web/src/lib/portrait/__tests__/independent-body-video.test.ts`；E2E：`apps/web/src/test/e2e/portrait-independent-body-video.e2e.ts` |

## 验收

以下是本次桌面接入时的历史测量；后续引擎规则已替换，不能把表中像素、快照大小和性能直接归于当前合并版本。worker 计算中退出、跨工程身份与 180 帧产品复跑另见[闭环记录](body-video-closure-2026-10-18.zh-CN.md)。

证据：E2E 输出 `output/playwright/portrait-independent-body-video/`（不入库），素材为本地 1080×1920、23.976 fps 的全身短片，项目 30 fps，片段裁到 0.5 s（15 帧）。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 快照恢复逐字节 | 真实模型：0..7 连续 vs 0..3 → 快照 → 新会话恢复 → 4..7，以及同会话回跳后恢复，输出逐字节一致 | 单人全身素材；快照约 47 KB |
| 新进程从磁盘检查点续算 | 真实 worker 两个进程：A 算 0..13（落 12 号检查点）；B 请求 13 → gap(12) → 12 恢复 → 13 继续，12、13 两帧 PNG 与 A 逐字节一致 | 12 帧素材循环，内容跳变不影响会话逻辑 |
| 暂停预览 = 导出 | E2E：先暂停在第 3 帧（自动重放 0..2，缓存 4 条）；冷导出 15 帧后缓存恰好 15 条——预览提交的 4 帧被导出原样复用，键相同 | 画布 1080×1920，导出 1080p 同尺寸 |
| 回跳／前跳 | 第 7、14 帧暂停全部命中缓存，worker 进程不变 | — |
| 重复导出 | 热导出 15 帧逐帧 framemd5 与冷导出一致，缓存不增；15.6 s → 3.6 s | 冷导出含 11 帧引擎计算 |
| 杀 worker + 清空帧缓存 | 跳到第 13 帧：新进程从 12 号检查点恢复，只新增 12、13 两条，rgba 哈希与导出时一致 | 快照反序列化会按需导入引擎模块（首版在新进程里拒绝快照并删掉它，E2E 抓到） |
| 无检查点回跳 | 跳到第 5 帧：从第 0 帧重放，新增 0..5 六条，哈希与导出时一致 | — |
| 改数值 | 新会话、新缓存键（3 条），旧会话检查点保留 | — |
| 多人／入画／消失 | 此次历史测量：初检两人 → 原图、会话继续；第二人入画不改变已跟踪人体网格；人体消失 2 帧保持原图后重新初检 | 同人镜像与天空平铺合成。人脸已改为[五槽生命周期](independent-body-face-slots-2026-10-18.zh-CN.md)，此旧结果不代表当前人脸槽、人体候选选择或缺体残余渲染行为；人体仍为默认单目标跟踪 |
| 长会话 | worker 内 240 帧（12 帧循环 20 次）：中位 0.607 s/帧（引擎阶段 414 ms），RSS 335→396 MB，20 份检查点，无失败 | 此次历史测量使用丢弃保留脸策略；后续已按[原生恢复规则](independent-body-retained-face-2026-10-18.zh-CN.md)替换，不能沿用该计时声称新路径性能 |
| 渲染进程无错误 | E2E 全程 pageerror 与 console error 为空 | — |

该轮单元测试：Python 全套 752+ 用例；Vitest 新增主进程 13 项、渲染进程 9 项；worker／provider／handler／payload 既有用例同步更新。

当时性能观测：引擎阶段约 0.41 s/帧（1080×1920，骨架精细网络 + 两次人脸网络 + 几何 + Metal 子进程绘制），流水线层（PNG 编解码、哈希链、隔离检查）再加约 0.19 s；应用内导出每帧约 1.4 s，差额来自 IPC 的 8 MB RGBA、主进程 PNG 编解码、每帧重新校验 425 个引擎源文件与 363 个运行时文件的哈希。未达到实时；按用户要求只记录观测值。美体强度关键帧未做：会话身份已按元素存储的编辑定义计算、每帧数值进缓存键，引擎接受逐帧 controls，缺的是时间线上的关键帧 UI 与解析。

## 边界

- 导出分辨率与项目画布不同会得到另一处理尺寸，即另一会话；预览与导出互通的前提是两者尺寸一致（默认如此）。
- 片段内部若有镜头切换，会话不会自动重置；应先用智能分镜切开片段。
- 同时带皮肤／人脸项的片段，重放时每帧都要跑整条流水线，会慢得多。
- 空闲 60 s 后 worker 退出，内存快照随之丢失；磁盘检查点保留，最多重放 11 帧。
- 自研权重仍来自原版提取的六项私有资产；替换为完全自有权重需要另立目标。
