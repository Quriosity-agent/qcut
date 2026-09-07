# 2026-09-08：从 master 继续独立 C++ 还原

本批从远端默认分支 `master` 的 `513a1c67d06fbdbb2a3b89bd27c6e37d3153eaf7` 新建 `codex/jianying-binary-cpp-scaleup-20260908`。工作树为 `/Users/peter/Desktop/code/qcut-binary-cpp-scaleup-wt/qcut`。上一批 [PR #468](https://github.com/Quriosity-agent/qcut/pull/468) 已于 2026-09-07 合并，合并点 `c577078ab132e4c45b8908c001f8f647e47b5e89` 已包含在本批起点中。

继承六个独立 C++ 工程、两条完整滤镜算法链和 40 项 CTest。前一批的原生对照、适用域和未解决问题保留在[执行队列](binary-cpp-execution-2026-09-07.zh.md)及[剩余台账](binary-cpp-reconstruction-backlog-2026-09-06.zh.md)。起点已有代码不是本批新增结果；整库恢复仍没有完成。

## 四条并行交付

| 工作线 | 本批新增独立 C++ | 实际原生比较 | 状态与边界 |
| --- | --- | --- | --- |
| videoeditor | 非空 graph 转换/展开、单/双控制点、通道控制、恒速 property | 1,673配置；43,880次实际property；475,154个非NaN double位一致，21,182个NaN分类一致；128,527整数检查 | [子域交付](videoeditor-graph-contract-2026-09-08.zh.md)；完整dispatch/变速/seek仍缺 |
| Creator → videoeditor | point/frame/group-list快照恢复、ID复用、retained与values共享/分离 | 3,842案例、440,390项比较零差异；6个算法错误变体被检出 | [局部记录恢复交付](creator-undo-record-2026-09-08.zh.md)；上层Session选择记录、stash/diff与完整undo仍缺 |
| Lens | RectSmoother首帧/reset、历史权重、整数裁切输出、持续帧CLI | 65,536连续帧；855,335状态字段及131,072插值float位一致；128帧组合2,632,192字节零差异 | [时序裁切交付](lens-temporal-contract-2026-09-08.zh.md)；真实调用点是CenterFocus，完整VAS/Deflicker仍缺 |
| AGFX | M4显式LOD选择、RGBA8精确跨层混合、组合采样参考 | 98,390,896通道/路逐位一致；旧456,192个排除通道全部重新纳入并通过原1/255门槛 | [设备profile交付](agfx-mip-sampling-2026-09-08.zh.md)；任意空间/跨层幅值组合仍是float近似，其他硬件未实测 |

Creator 的记录恢复函数实际位于 videoeditor，沿 Creator 请求链归组，不冒称本轮又完成了一套不同的库。Lens 经定点分析后选择有完整可调用数值核的 RectSmoother，未将 Deflicker 的 Metal 调度包装列为独立算法。AGFX 的精度是硬件实测 profile，不能宣称是从 dylib 恢复的通用 C++ 算术。

## 统一验收

六工程保持不变，CTest 从40增至46：AGFX +1、Editor +1、Creator +1、Lens +3。Soft Glow/Fog 的既有算法与CLI测试全部保留。

| 检查 | 本机结果 |
| --- | --- |
| Release，包含全部可选macOS arm64原生探针编译 | 46/46 CTest，8.32秒 |
| Debug ASan/UBSan，禁止错误恢复 | 46/46 CTest，34.37秒 |
| Editor旧5个原生探针 | JSON与上批对应结果一致 |
| Lens旧4个原生探针 | 数值/原图像/后端/矩阵结果与对应上批结果一致 |
| 新原生矩阵与负控 | 各线独立报告及源码哈希见文档；原始证据均在仓库外 |
| 新head跨平台CI | 提交后在新PR验收；本机结果不代替云端结果，旧PR #468绿灯不沿用 |

统一构建入口为 [independent-binary-contract](../../../research/independent-binary-contract/README.zh.md)，本机日志在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/unified/` 的 `release-final.log`、`san-final.log`。真实厂商库没有进行sanitizer插桩；内存检查覆盖原创代码与诊断调用侧，不证明整个SDK无缺陷。

## 工程和证据规则

- 各线只修改自己的独立 C++ 目录及对应中文报告；公共构建、CI 和总台账统一整合。
- 新源码保持可独立编译，默认测试不加载厂商库。实际差分只在自有隔离进程内调用已核验版本的原生函数和真实工厂对象。
- 不修改剪映应用、用户草稿或运行中的服务；不伪造 SDK 虚表/控制块来模拟成功调用。
- 原始二进制、反汇编、厂商资源和运行输出保存在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/` 下的 `editor-graph/`、`creator-undo/`、`lens-temporal/`、`agfx-mip/`，不覆盖 09-07 证据。
- 单文件单提交；本机 Release、ASan/UBSan、原生差分、负控及新 head 的跨平台 CI 分别验收。没有测试结果时不提前标绿。

## 尚未完成的整体范围

完整 property dispatch/曲线变速/seek、Session undo、通用滤镜图、迷雾 CPU 产品出口、Deflicker/VAS/UMVFI/VMB 完整视频链和模型替代均保留。各线完成一个严格单元只关闭对应子项，不自动关闭前一批 04–11 的八个大工作包。

## 下一批执行顺序

1. **05–06**：把已恢复的 graph 与 graph-free restore 连接到真实 Session 记录管理；先核对记录源、ID map、stash/diff及graph子树恢复，再推进完整dispatch/曲线变速。
2. **10 / 08**：追 RectSmoother 输入矩形的实际选择与运动来源；Deflicker 分别恢复连续帧状态和GPU数值核，不能用本次裁切替代。
3. **04 / 07**：闭合柔光/迷雾逐Pass残差，复用两条算法建立通用图及迷雾CPU产品出口。
4. **09 / 11**：明确ByteNN模型与张量合同后，逐个推进分割/降噪/UMVFI/VMB；模型资产与运行时代码分别计进度。

这些是后续队列，不是本次已经交付的产品功能。本批没有合并或发版，也没有新的剪映UI、QCut预览/导出/撤销验收。
