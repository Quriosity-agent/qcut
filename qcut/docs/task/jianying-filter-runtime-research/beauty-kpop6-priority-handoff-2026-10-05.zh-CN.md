# beauty-6-kpop：接手顺序与验收门槛

状态快照：2026-10-05 07:22 UTC。本文是下一位 agent 的工作单，不是完成声明。
工作目录为 Git 仓库内 `qcut/`；下文代码路径除特别注明外均相对此目录。

## 先读结论

**先收尾 PR，再完成小脸消费；三维美妆和独立几何并行开发。**
已有真实结果足够定位下一步，不需要重新从模型转换或全部反编译开始。
所有原生 GPU/LLDB 验证仍由一个主 agent 串行执行。

| 顺序 | 工作 | 当前缺口 | 完成标准 |
| --- | --- | --- | --- |
| P0 | PR #485 审查及现场交接 | 6 条原审查已关闭，修复已推送，新 CI 运行中 | 新 HEAD 检查通过；核实新增意见；明确每个改动归属 |
| P1 | 小脸真实消费 | 已发布到 FaceReshapeSystem，未证明最终读点和渲染交接 | V5/V6 对实际使用点的读写、下游交接、GPU 后恢复及三图 RGBA 全部通过 |
| P2 | 高光/雀斑三维接管 | 6 个缺失结果；只有原生网格复制证据 | 明确拟合数据来源，证明候选驱动三维消费、矩阵与 GPU 交接，再补 6 项图像 |
| P3 | 独立裁剪几何与初始化 | 普通 inner 算术已对齐，Stage2 矩阵和初始化仍原生提供 | 逐阶段独立计算、真实输入替换和端到端对比通过 |
| P4 | 编辑器静态端到端回归 | 研究宿主通过不等于当前编辑器入口通过 | 原图导入、每项参数、图像/差分、取消及持久化完整实测 |
| P5 | 连续视频产品化 | 仅 BASE 两次 24 帧研究测试通过 | 持续会话、多人/遮挡、跳转/取消、预览/导出和性能完成验收 |
| P6 | 平台与发布门槛 | 跨平台 CPU 合约通过，不等于候选渲染跨平台通过 | 每个平台独立运行真实输入和产品路径，明确支持与拒绝范围 |
| P7 | 逐步摆脱原生库 | 检测、部分几何/拟合/遮罩和最终渲染仍依赖原生 | 每个模块可独立替换；在没有原生运行库的环境完成整链验证 |

P2/P3 可以和 P1 并行写代码及 CPU 测试；顺序表示主线验收优先级，不要求所有人串行等待。
P5 的协议和合成测试也可提前设计，但不能跳过实际运行证据直接开放产品后端。

## 当前基线

- 分支：`beauty-6-kpop`，目标：`master`；沿用 [PR #485](https://github.com/Quriosity-agent/qcut/pull/485)。
- 研究证据基线：`1c8ddb7b8c7535877ab53382709a78803f50c5f8`。
- 当前已推送实现 HEAD：`7613e679a530c870ff791f1b8c181ed2fc0b242a`，新增 11 个单文件审查修复提交。
- 旧证据基线的三平台构建、Espresso、Face CPU contracts 均成功；新 HEAD 的三平台
  Face CPU contracts 已成功，构建仍在运行，CodeRabbit pending，Claude job skipped。
  原 6 条 review threads 全部 resolved。新提交需要重查，不能沿用旧 SHA 的绿色结论。
- 美妆矩阵：28 卡 x 3 人物，**78 EXACT / 6 MISSING**，486 张 PNG。
  这是多次明确运行证据的汇总，不是单次固定配置跑完 84 项，也不是整体产品完成率。
- 下颌线：3 人物在显式 makeup 路由、+80 强度下通过；不要重新误判为小脸同一个问题。
- K-pop Baby pink 腮红：3 次独立冷启动通过；每次 106 个源点加载和 106 个变换后存储配对。
- 直接 inner 普通分支：2 人物各 848 个坐标/状态逐位相等，最终 RGBA 零差异。
- 小脸：发布、update 返回、源数据不变和 GPU 后恢复有证据，最终消费 audit 仍失败。
- 高光/雀斑：6/6 原生网格读取/复制诊断完成，实际均为 1463 顶点和 1463 法线；最终 audit 仍失败。
- 本轮之前记录的完整相关本地回归为 756 通过、0 skip；本文未重新执行这些测试。
- 参考是固定原生研究宿主，不是新导出的剪映 GUI。原生分钟级成绩不属于 ONNX 候选链。

依据与原始失败记录入口：

- [直接消费与内层输入验证](beauty-kpop6-direct-consumers-2026-10-05.zh-CN.md)
- [消费路由、下颌线和有界视频](beauty-kpop6-consumer-routing-2026-10-05.zh-CN.md)
- [Extra 精修](beauty-kpop6-extra-refinement-2026-10-05.zh-CN.md)

## P0：先接住正在进行的 PR 修复

起草时发现其他执行者正在修改研究文档、`research/jianying-runtime-probe/filter-probe.mm`、
`face_live_bridge_lldb_test.py` 和 `face_live_bridge_probe.py`。07:22 UTC 复查时，这批修改
及 Extra 路径回归已作为 11 个单文件提交推送，原 6 条审查全部 resolved。
当时除本文和私有 `.local/` 外工作区干净。接手仍以即时 `git status` 为准，
不要 reset、覆盖、批量 add，也不要替其他执行者重复提交。

已处理的 6 条审查主题如下，复核新测试和 CI，不要重新从头实现：

1. 最终帧仍被抑制时不能返回成功、增加完成帧计数或报告成功输出；中间帧抑制仍允许。
2. launcher 测试不能依赖新 checkout 不存在的私有目录。
3. 缺失 `--extra-root` 时仍须落盘失败 report，不能在构造 report 时直接异常退出。
4. probe/worker 对 Extra 根路径的规范化必须一致；同时保留根符号链接拒绝和来源校验。
5. 研究文档中的机器专属路径应可移植化。
6. checkpoint 文档中的工作目录及命令示例采用相同可移植规则。

关键测试：最终抑制/最终写出/写出失败/序列计数；全新 checkout；不存在路径；
包含 `..` 或父级符号链接的路径；禁止的根符号链接；失败 report 和清理回执。
原意见已关闭，但仍须核对后续 review 是否新增问题；bot 状态 success 不代表没有待处理意见。
本文只交接，不代替审查，不授权自动 merge 或 release。

## P1：小脸先闭环

入口：`research/local-model-pytorch/face_live_reshape_route.h`、
`face_live_reshape_hooks.h`、`face_live_bridge_host.mm`、`face_live_bridge_lldb.py`。
现有实验选项为 `--publish-reshape-candidate --single-frame --cold-frame`。

1. 先复现当前发布证据和严格失败，不能为了得到图像直接调用 `converted()`。
2. 为 V5、V6 分别实现有界点读取/写入探针。固定版本位置见直接消费文档；
   每次都绑定新的 publication、线程、预测、face ID、源/目的地址和索引。
3. V5 按实际索引和 float32 顺序核对；V6 是规则选点，不能强制凑成顺序 106 点。
4. 证明这些值进入最终形变输入；再生成消费回执，验证 GPU 完成后的原始状态恢复。
5. 对 front-smile、kpop-front、outdoor-male 各自独立冷启动，再测 0、中等和高强度。

通过标准：源点不变、目的区间不别名、实际读写与独立计算一致、最终效果确实改变原图、
候选/原生 RGBA 精确一致。强度 0 不要求效果活性，但必须正确恢复且不得残留上一项效果。
负例至少覆盖过期预测、错误 face ID、漏点、伪造回执、取消及 GPU 前恢复。
至少一个人物连续 3 次独立冷启动，保留每次结果，禁止自动重试直到通过。

这是建议下一位 agent 的第一个功能任务：发布已打通，缺口明确，范围比三维拟合小。

## P2：补齐高光和雀斑的 6 项

入口：`face_live_mesh_abi.py`、`face_live_mesh_capture.py`、`face_live_mesh_trace.py`，
均在 `research/local-model-pytorch/`。`--trace-mesh-points` 当前只用于读取诊断。

1. 先保持已通过的 6 个诊断基线，区分接口族名称和实际顶点数量。
2. 沿实际拟合生产者确认输入来自哪里，哪些是候选关键点，哪些仍是原生检测/姿态结果。
3. 建立三维专用消费契约：face ID、顶点、法线、model matrix、MVP、源/目的缓冲区、
   生命周期、最终渲染器读取和 GPU 完成后恢复。不能删除二维断言后直接宣布成功。
4. 分开验收两个里程碑：候选输入驱动原生拟合的混合交接；QCut 独立生成拟合结果。
   前一个即使通过，也不能把 `qcut_mesh_ownership_verified` 改成独立拟合已完成。
5. 接通后重新跑两种效果 x 三个人物，补候选输出与固定增益差分，再更新矩阵。

通过标准：每个必需阶段都有新鲜来源和真实消费证据，效果非空，RGBA 零差异，清理成功。
尚未独立的阶段逐项保留 native 标记；只有全部审计满足时才能移除 MISSING。
单纯复制原生的 1463 点网格、getter 命中或最终图像相同，都不足以证明候选接管。

## P3：去掉裁剪几何的隐性原生输入

入口：`face_extra_inner_trace.py`、`face_extra_crop_trace.py`、
`face_extra_crop_geometry.py`、`face_live_extra_refinement.py`、`face_extra_heads_onnx.py`。

1. 把 Stage2 forward/inverse、调用前初始化、裁剪/旋转和映射各自的输入列成依赖表。
2. 捕获原生调用前输入作为参考，独立实现一个子步骤，先比矩阵/像素/float32 位值，
   再将该子步骤输出接入候选。不要同时替换多个阶段后才比较最终图像。
3. 普通 inner 已通过的两个人物保持回归；补空历史、近零 scale、配置旁路和 reset。
4. 严格区分完整输入 280 点、普通分支实际使用/返回的前 106 点、调用者保留的尾部 174 点。
   空状态/近零分支不能直接套用普通分支长度，需实际捕获后分别实现和验收。
5. 覆盖旋转、边界裁剪、不同尺寸、消失后重新出现，再替换宿主几何输入。

通过标准：候选计算不读取原生返回后状态或最终矩阵作为修正；改变参考值只能使审计失败，
不能改变候选计算结果。逐阶段和最终 RGBA 均通过后，才可声明对应几何阶段已独立。
当前 `owned_geometry_enabled=false` / `geometry_parity_verified=false` 不得提前翻转。

## P4：让研究结果真正到达 Beauty Lab

入口：`electron/beauty-lab-live-candidate.ts`、同目录的 selection/result/provenance/process 模块、
`research/local-model-pytorch/face_live_candidate_job.py`，以及
`apps/web/src/test/e2e/beauty-lab-live-candidate.e2e.ts` 和 `beauty-lab-native-matrix.e2e.ts`。

先检查研究新增路由、Extra 模型及严格审计是否实际穿过 IPC/job/result 契约；
不得因为 Python 探针成功就假设 UI 也用了同一条路径。

通过标准：导入真实原图，逐项参数操作、恢复为零、切卡、切人物、取消、失败后重试，
每一步都获得与当前 requestFingerprint 对应的结果，不展示旧任务的图。
核对原图/原生/候选/固定增益 8 灰度差分，Alpha 独立比较；保存/重新打开/导出实测。
对照截图必须写明是“剪映 GUI”还是“原生研究宿主”，使用同一输入、参数和色彩条件。
保持现有开发版/macOS ARM64/静态图门槛；UI 接通不等于允许正式时间线后端。

## P5：视频产品化，最大工程量

当前 `face_live_video_probe.py` 明确限制最多 24 帧、跨度 2 秒，且仅 BASE。
已有两次通过各覆盖 0.767433 秒，不能累加成分钟级；也不能把 24 帧上限改为 1800 就算完成。

1. 先设计有界持续会话：流式解码、背压、最大在途帧数、状态复用、错误传播、超时和清理。
2. 定义 source/session/frame/generation 身份；seek、换源、取消后旧帧不得覆盖新画面。
3. 明确丢预览帧策略和状态推进规则；导出必须完整顺序处理，不得套用预览丢帧策略。
4. 定义多脸稳定 ID、各自时间状态、出入画面和遮挡恢复，避免人物之间复用状态。
5. 先单脸 10 秒，再单脸 60 秒，再双人交叉/遮挡 60 秒；分别覆盖 BASE、Extra、美妆和形变。
6. 实测连续拖滑杆、快速跳转、暂停恢复、取消/退出、预览与导出同帧对比。

报告必须包含计划/实际帧数、逐阶段失败、身份切换、时间误差、延迟 p50/p95/p99、
吞吐、UI 响应、峰值内存和持续增长情况，注明设备、分辨率、模型及线程配置。
性能目标先与原生基线和产品要求确定，不能跑完后用实测值反向定义“合格”。
研究 LLDB 可以定位问题，但产品入口不能靠调试器驻留才能运行。

## P6/P7：平台验收和原生依赖清单

跨平台测试必须分三层报告：CPU 合约、真实模型输出、真实预览/导出。
仓库根 `.github/workflows/face-cpu-platform.yml` 只证明第一层的合成合约。
Windows/x86、Linux 或 macOS x64 没有可用后端时明确拒绝，不能静默返回原图并标成功。
可先交付明确受支持的平台子集，未完成平台继续禁用，不伪称全平台完成。

独立化按可替换模块推进：检测/全帧预处理 -> 裁剪/关键点/跟踪 -> 姿态拟合/附加点/遮罩
-> 五官形变 -> 皮肤处理 -> 二维/三维美妆渲染。优先复用已经验证的 ONNX 和算术实现。
每个模块写清输入、输出、状态、许可证/分发条件、原生 fallback、离线验收和产品验收。
只有在未安装剪映、无私有原生 runtime 的环境跑通，才能称“不依赖剪映二进制”。
能本地使用模型或效果包，不自动代表可将它们随产品分发；不要向 Git 或 CI 上传私有资源。

## 并行分工与共同约束

| 执行者 | 独占范围 | 交付物 |
| --- | --- | --- |
| 主 agent | PR 收尾、共享 host/probe/LLDB 集成、原生 GPU lease、汇总报告 | 实际运行回执与最终集成结论 |
| Agent A | 独立 reshape 读写/消费模块及测试 | P1 补丁、负例、主线程复测说明 |
| Agent B | 独立 mesh/拟合契约模块及测试 | P2 分阶段来源/所有权证据，不能冒领原生拟合 |
| Agent C | inner/crop 几何与初始化模块及测试 | P3 独立算术与真实边界回放 |
| 可选 Agent D | 视频会话设计、CPU 合约或只读 UI 差距清单 | 不运行原生 GPU、不同时改共享入口 |

同一 checkout 的原生 campaign 会校验整个研究源码依赖树。运行期间冻结非测试研究源码，
不是“只不改本任务文件”。并行开发应放到隔离工作区，主 agent 在两次 campaign 之间集成。
正式原生验证一次只允许一个 lease；其他 agent 不抢 GPU、不改稳定宿主、不重置 TCC。
每项提交保持 single file / single commit / push；只 stage 自己文件，不提交私有 `.local/`。
所有失败保留；禁止放宽容差、去掉效果活性、伪造回执或自动忽略未知调试器停止。

## 接手首轮操作

从 Git 根目录检查，不直接执行任何旧原生命令：

```sh
git status --short --branch
git rev-parse HEAD origin/beauty-6-kpop
gh pr view 485 --json state,headRefOid,statusCheckRollup
git diff --stat
```

先确认是否仍有人编辑 P0 文件，再决定复核或继续，避免两位 agent 同时修相同意见。
测试入口为 `qcut/scripts/check_face_cpu_platform.py`；依赖版本与平台参数以 CI workflow 为准。
原生重跑命令从对应运行的 `report.json.command` 恢复，并审核新输出目录、输入版本、
模型路径、runtime、debugger、lease 和 timeout。不要复制上一会话的指针、token 或输出目录。
本机私有证据根仍为 `qcut/.local/jianying-model-pytorch/`；确切运行标识见上述直接消费文档。

一个不启动原生宿主的定向 CPU 冒烟示例，在 `qcut/` 下执行：

```sh
PYTHON="$PWD/.local/jianying-model-pytorch/face-heads-runtime122/bin/python"
cd research/local-model-pytorch
"$PYTHON" -B -m unittest \
  face_live_makeup_point_rotation_test \
  face_live_reshape_route_test face_live_reshape_launcher_test \
  face_live_mesh_abi_test face_live_mesh_capture_test face_live_mesh_trace_test \
  face_extra_inner_trace_test face_extra_inner_geometry_test
```

上述命令已在交接时实跑：108 项通过，0 skip，约 2.2 秒。
这只是定向冒烟，不等于 756 项完整回归，也不包含新原生或编辑器验收。
接手 agent 的第一次汇报应包含：当前 SHA/脏文件归属、P0 状态、P1 复现结果、
实际改动文件、测试数量及 skip、原生失败原因、下一项可验收的小目标。
