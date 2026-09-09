# 2026-09-08 第三批：组合语义、图差量、运动约束与联合采样

本批接续 [PR #469](https://github.com/Quriosity-agent/qcut/pull/469) 的 `68dda55478f454ffd2c61e4faf0686ed6877d656`，继续使用 `codex/jianying-binary-cpp-scaleup-20260908` 与 `/Users/peter/Desktop/code/qcut-binary-cpp-scaleup-wt/qcut`。分支最初从 master `513a1c67d` 创建。本次按用户要求停止扩展范围，收尾现有四线算法、证据、文档与测试，保持 PR 开放，不合并、不发版。

## 本批交付

| 线 | 新增独立 C++ | 原生验收 | 未完成范围 |
| --- | --- | --- | --- |
| [Editor](videoeditor-variable-graph-2026-09-08.zh.md) | 非空 graph 展开、正向曲线时间转换和实际每通道 property 组合；提取共享解析层 | 1,330 配置、10,764 记录、95,372 次 property 调用；173,380 整数、829,812 非 NaN double 逐 bit 相同；19,286 NaN 分类相同；2,660 源快照 | 完整属性分派、其他 Segment、反向曲线、seek/undo/产品传播 |
| [Creator](creator-graph-diff-2026-09-08.zh.md) | Graph 整树/数组历史 stash、suppression、共享 owner 和逐字段 diff 应用 | 5,890 案例、8,123,755 比较，0 差异 | Session 历史选择、完整事务提交/回滚和应用 undo/redo |
| [Lens](lens-crop-merge-2026-09-08.zh.md) | MergeUtil 使用的 border=11 Move 缩放、增量旋转搜索、平移限制及 CLI | 249,411 Move 调用、997,644 float 逐 bit 相同；另 2,048 次 CenterFocus / 8,192 bbox 值后接约束 | SettingInfo 配置与两侧坐标转换、整个 MergeUtil、多候选/VAS/Deflicker；本轮无新增像素闭环 |
| [AGFX](agfx-trilinear-sampling-2026-09-08.zh.md) | M4 Pro 多层 spatial linear + mip linear 联合权重、寻址规约及行相关舍入 | 512 配置，每路线 230,661,120 通道；C++/实际 AGFX、自有 GPU/实际 AGFX 均逐 bit 0 差异 | 其他设备/系统、极小/大坐标、HDR/3D/各向异性、真实滤镜逐 Pass 残差 |

Creator 记录入口实际位于 videoeditor，曲线时间底层来自 cccreator，按功能链归组。AGFX 是硬件实测 profile，不能升级为 GPU 内部源码还原。两个对照路线使用相同样本，不把 GPU 和 CPU 计数相加。NaN 分类不宣称 payload 位一致。

## 验证与证据

| 项目 | 本批结果 |
| --- | --- |
| 统一 Release | 58/58 CTest，包含全部可选 macOS arm64 原生探针编译 |
| 统一 Debug ASan/UBSan | 58/58 CTest，禁止错误恢复，原生探针全部编译 |
| 四模块实际原生对照 | 最终报告零差异，重复/消毒器构建结果一致；厂商 dylib 自身未插桩 |
| 旧原生回归 | Editor graph/nonlinear/variable time、Creator graph/record、Lens 六个诊断、AGFX format/texture/mip/spatial 保持原报告 |
| 编译成功的错误变体 | Editor 6、Creator 8、Lens 7、AGFX 7 被实际比较检出；Lens 第八个单位复裁删除变体未检出，单列保留 |
| AGFX 测试覆盖修正 | 初版 portable 子集漏检 mirror 变体，加入实际原生金样例后七个变体全部被独立与原生测试检出 |
| 远端 CI | 按推送后的精确 head 验收，结果见 PR；不能沿用上一批绿灯 |

六个工程和两条完整滤镜链保持不变，测试从 52 增到 58：Editor/Creator/AGFX 各增加一组，Lens 增加三组。统一入口见 [README](../../../research/independent-binary-contract/README.zh.md)。

原始 ASM、厂商数据、原生 JSON、负控、源码 hash、构建与日志全部在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch3/`。模块目录为 `editor-variable-graph`、`creator-graph-diff`、`lens-crop-merge`、`agfx-trilinear`，统一构建为 `unified/`。根 `verification.json`、`source-manifest.json` 和 `commit-audit.json` 分别记录验收、最终文件 hash 和单文件提交审计。Git 只交付自有源码、测试、诊断程序和结论文档。

## 仍未关闭的工作

**六个独立工程、两条完整标准 C++ 滤镜链、整库 0/6、八个未完整关闭的大工作包**的口径不变，详见[剩余台账](binary-cpp-reconstruction-backlog-2026-09-06.zh.md)。本批关闭四个具体子项，不按测试或对照字段数量推导整库完成百分比。

后续顺序：Editor 完整属性分派与时间/效果事件衔接；Creator Session 记录选择和事务应用；Lens 安全配置与 MergeUtil 两侧转换后整链对照；AGFX 回到真实滤镜中间 Pass 残差。之后再推进通用效果图、迷雾 CPU 产品出口、ByteNN 张量/模型合同及其他时序算法。当前不把局部数值合同写成 QCut Preview/Export、撤销重做或 UI 像素验收。
