# 剪映二进制 → 独立 C++：顺序执行记录

2026-09-08 续篇：[新分支四线推进与当前验证](binary-cpp-scaleup-2026-09-08.zh.md)。本文保留09-07的历史结果；本轮 mip 边界、非空 graph、记录恢复、时序裁切的新状态以续篇为准。

记录日期：2026-09-07。工作区：`/Users/peter/Desktop/code/qcut-binary-cpp-wt/qcut`；分支：`codex/jianying-binary-cpp-next`；起点：`29d4700a5bdd4e1ae88299e0beeecbd31ec34b5b`。

本轮按可独立验收的函数合同、渲染原语和算法链逐项推进。**统一入口已有六个标准 C++ 工程，完整滤镜算法链为电影柔光与迷雾两条；AGFX、videoeditor、VECreator、lens 另有受限局部语义与数值交付。六个核心库的整库还原完成数仍为 0/6。** 本文是执行队列，不把算法、产品接入与整库完成混算。

已有电影柔光 C++20 算法、持续帧协议和 QCut 接入继续复用。迷雾新 C++ 链只完成算法、CLI 与本机原生差分；其 CPU 产品 adapter、Preview/Export 和新 UI E2E 尚未完成。完整库存与历史范围见[剩余工作台账](binary-cpp-reconstruction-backlog-2026-09-06.zh.md)。以下顺序保留完整工作包与局部验收的区别。

## 顺序队列

| 顺序 / 状态 | 具体单元 | 前置证据与验收出口 |
| --- | --- | --- |
| 01 / **已完成** | AGFX：格式转换器 `0x8b6e4–0x8bd24` 的独立 C++ 合同 | 113 项映射、85/28/92 分类与平台条件；每次 208,911 次原生差分零差异，两进程报告一致。旧 macOS 条件来自静态恢复与单测，未实机调用。 |
| 02 / **已完成（枚举合同）** | AGFX：`setTexFilterWrapMode` 的枚举映射 | 六字段独立转换；768 合法组合与加载镜像表一致，Apple sampler 分配成功；24 非法字段用例通过。拒绝非法输入是自有保护策略；真实 setter 和像素验证已由 03 补齐。 |
| 03 / **已完成受控像素单元** | AGFX：自有纹理上传 → 原生 sampler → 自有 shader → 读回 | 5 张 RGBA/BGRA/3D/mip 图案 × 768 sampler；每进程 3,732,480 个 GPU float4 逐位一致、7,008,768 个 CPU 通道通过。8 次原生 RGBA/BGRA 读回字节一致。CPU 任意 LOD 量化/nearest 半层点仍未解，排除项单列；见[像素报告](agfx-texture-pixels-2026-09-07.zh.md)。 |
| 04 / **两个缩放阶段已闭合，整链精度未闭合** | AGFX + 柔光/迷雾：逐 Pass 格式、量化、采样与性能 | M4 blit 的 111 组/444 次调用、58,017,272 float 通道及同数量字节通道零差异，三图两次缩放独立重放均 0 差异。柔光卷积/Glow/LUT、迷雾采样和舍入仍有残差；03 排除的 CPU mip、GPU/SIMD 性能与跨平台像素验证归此包。见[缩放报告](soft-glow-blit-precision-2026-09-07.zh.md)。 |
| 05 / **恒速时间及线性/非线性子域已交付，完整分派/seek/事件待补** | videoeditor：窗口选帧 → Segment trim/speed → 属性值 | 本批真实 Video 对象的非线性属性 117,515 次调用/784,545 值对照通过；限预选两帧、无 graph、至少一侧 curve 非零、raw midpoint 非命中、正有限恒速且映射/记录不降序。729,127 非 NaN 值逐位一致，55,418 NaN 只比较分类。完整分派、变速、其他 Segment、seek/export 待补；见[非线性报告](videoeditor-nonlinear-property-2026-09-07.zh.md)。 |
| 06 / **插入与 dirty/retained 生命周期已交付，完整 undo 待补** | VECreator → videoeditor：请求、材质、公共关键帧与 reset | 新增真实对象的 active/retained 清理、递归 dirty、别名与释放；2244 组原生生命周期零差异。删除后保留的对象不被当成 active 子节点重置。完整 record rollback/undo、会话及 UI 仍待补，见[生命周期报告](creator-record-contract-2026-09-07.zh.md)。 |
| 07 / **第二条算法链已完成，通用图和产品出口待做** | cccreator：迷雾标准 C++ 链 → 通用图 / CPU 产品 adapter | 固定 `7160594413847203085/e745e131cff1db913aea07f4098ec8de`，采样阈值、两次 17 taps、遮罩 Screen、LUT 四段独立执行。未修改原包的 Swing 数值事件参考 30 进程/210 帧稳定；12 组 C++ 对照 MAE 0–0.017425、最大误差 2，按容差验收。通用图、Preview/Export、禁原生回退和新 UI E2E 未完成；见[语义报告](second-complex-filter-semantics-2026-09-07.zh.md)与[最终验证](fog-cpp-verification-2026-09-07.zh.md)。 |
| 08 / 待做 | lens：Deflicker 的连续帧合同与独立算法 | 从已有原生连续帧桥取得固定输入、强度、历史窗口、首尾帧、reset/seek 的输出证据，再实现并比较自有算法。测试稳定亮度、周期闪烁与运动序列；仅加载模型或调用私有库不计独立实现。 |
| 09 / 待做 | bytenn：一个已选模型的张量合同与独立后端 | 先点名模型及上游功能，恢复布局、dtype、归一化、输出及历史状态；用可独立使用的模型/后端验证真实张量和像素。模型资产来源与运行时源码分别记录；模型依赖未解决时不宣布算法独立。此项可成为 08 或后续补帧的必要前置，届时显式调整队列。 |
| 10 / **crop 变换计划到真实 warp 已交付，VAS 链待补** | lens：坐标端点 → 变换矩阵 → warp | 新增四锚点 LU、前/逆矩阵与 crop 端点合同：30,307 组/363,684 float，306 次真实对象 warp/1,324,512 RGBA 字节零差异。上游 crop 端点调用是静态证据，完整人脸检测/VAS/运动估计仍未运行；见[变换计划报告](lens-transform-planning-2026-09-07.zh.md)。 |
| 11 / 待做 | lens：UMVFI 补帧；随后单独做 VMB 光流/帧融合 | 两者各自建立帧对、时间参数、历史状态和输出合同。模型相关前置接 09；每个单元分别编译、差分和视频验收，不能用一个宿主调用覆盖两项完成状态。 |

`libTracking.dylib` 是遥测库，不排进视觉 tracker 队列。LumiGeneRuntime、fastcv、samicore、speechsdk 仍是台账候选；未解决上表依赖前不扩大为逐库扫描任务。

## 01：本轮必须交付的可复核结果

目标身份沿用[AGFX 纹理契约](agfx-texture-contract-2026-09-06.zh.md)的安装版样本：剪映 11.3.0，Universal SHA-256 `4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`，ARM64 UUID `408EB610-AD47-3846-9595-14B6A3ABF537`。每次原生差分重新检查身份；未知版本拒绝作为该合同的参考。

1. **独立实现。** 纯标准 C++ 构建和测试不链接、不加载厂商库，不依赖私有 ABI 偏移；原生探针单独运行，输出作为差分证据。实现、输入域、平台条件和复现命令可单独阅读。
2. **比较完整结果。** 对每个输入比较返回布尔值、调用前后完整 64 位输出槽，以及输出是否被写入。至少使用两个不同哨兵；不将返回布尔值直接命名为“支持”或“可分配”。
3. **扩大覆盖。** 扫描 `0..206`，再加入 `uint32` 边界和固定种子的较宽非法值集合；种子、样本数、域、原生/独立差异和失败输入写入机器报告。保留 `43/50/97/128` 及 `0/127/206` 等旧例作回归，不以旧 `7/7` 代替本轮结果。
4. **平台分支独立建模。** 已确认 `164..191` 先设置返回值，再判断 macOS ≥11.0，可出现“返回 true、输出未改写”；C++ 用显式环境条件保留此行为。helper 与版本检查已静态复核；旧系统分支仅有静态证据及单测，不能写成旧系统动态验证通过。
5. **精确判定。** 对已固定的二进制及平台条件，返回值和输出槽要求逐项完全一致；至少两个独立进程重复。未知平台条件应显式留空或拒绝，不能悄悄当作当前系统。
6. **分开设备能力。** 可额外检查 Apple Metal 纹理创建，但应单列“转换结果”“驱动能否分配”“实际像素结果”；压缩/深度等格式不能要求当前设备一律可分配。此单元不声称已通过 AGFX 创建纹理或恢复 GPU 渲染器。

完成记录与复现入口：[独立工程及语义说明](../../../research/independent-agfx-contract/README.zh.md)。Release CTest **2/2**、ASan/UBSan CTest **2/2**；格式输入条目 **69,637 × 3 个哨兵 = 208,911 次/进程**，两次报告完全一致。macOS 26.6.2 / ARM64 / Apple Clang 21.0.0 / M4 Pro。四种 Apple 纹理分配及旧七用例回归通过；没有把其他压缩/深度格式的映射当作 GPU 可用性。

私有证据：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/agfx/`，含两次差分 JSON、完整输入生成参数、构建/测试产物及 `verification.json` 源码哈希清单。最初两个单元的三平台 CI 及 Linux sanitizer 已通过；当前扩为六工程，新的远端结果以当前 PR head 为准，不沿用旧 head 绿灯。

## 并行批次结果与下一步

此前批次分别交付 12、23、29、34 组 CTest。本批新增非线性属性 1 组与 Fog 5 组（blur、pipeline、CLI、原生采集协议、参考验证器），统一入口 [independent-binary-contract](../../../research/independent-binary-contract/README.zh.md) 现为 **六工程、40 组 CTest**；本机 Release 与 ASan/UBSan 均 40/40。默认测试不加载厂商库；原生采集协议/验证器测试使用自产临时数据和负控，实际厂商差分仍在隔离进程中运行。

队列仍是 **3 个已交付的受限 AGFX 单元，04–11 共 8 个尚未完整关闭的工作包**。07 的第二张滤镜算法子项已经关闭，但通用图与 CPU 产品出口保留；04、05、06、10 也有局部完成。台账已按相同编号归组，不把算法子项完成直接减去整个工作包。完整标准 C++ 滤镜链为 2 条、整库 0/6，且不宣称两链所有像素完全一致。

上一批本机 AppleClang/macOS arm64 的 Release 与 ASan/UBSan 各 34/34、CGL 捕获器及转换/缩放诊断通过，历史汇总保留在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/segment-blit-verification.json`。本批迷雾已有 Release/sanitized 两套实际像素对照；非线性属性已有真实对象差分。本批最终统一 Release 启用全部可选 native probes，构建成功并通过 40/40 CTest（34.58 秒）；ASan/UBSan 禁止恢复配置通过 40/40（42.18 秒）。原生日志位于 `nonlinear-fog-builds/release-2.log`、`san-2.log` 及对应 LastTest 日志。新提交的远端 CI 待推送后检查，不把本机通过写成当前 head 全绿。

本批迷雾最终严格门禁为 `fog-cpp/native-comparison-final/metrics.json`，三图×四档全部通过。私有证据分别位于 `fog-cpp/`、`second-filter-native/matrix-final/`、`second-filter-semantics/`、`editor-nonlinear-property/`（均在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/` 下）。原生采集加强了四档输出各异门禁，并对已有 210 帧重新读取/哈希；实际采集源码与后续验证源码 hash 分开记录，未伪称重新渲染。CGL composer 的无效字符串事件和中间 draw 未捕获结果仍保留为失败证据。

接下来优先解释 04 的卷积/draw 采样、Glow dither/packed、LUT 与迷雾残差；05–06 向完整分派、变速、当前时间定位和 request/record rollback/undo 推进；07 进入通用图与迷雾 CPU 产品 adapter/Preview/Export/UI E2E；10 继续实际人脸检测或 VAS 的上游选择与运动估计。08/09/11 时序算法与模型合同仍未完成。本批继续更新 PR #468，合并、发版及当前提交 CI 均不在本页提前宣布。

## 证据边界

格式差分、单 Pass 像素差分、真实卡输出和产品 E2E 是不同验收层级。已有柔光终点接近不能证明其每个原生 Pass 的状态已恢复；安装版 11.3.0 的 Metal 合同也不能直接替代旧 D634 CGL 宿主的精度结论。

新增仓库文件仅包含自有 C++、测试、输入生成逻辑和原创说明。原始 dylib、反汇编、模型、LUT、包内 shader、私有运行输出留在仓库外。完成一个单元只关闭对应条目，不产生任何“整库还原百分比”。
