# 2026-09-08 第二批：曲线时间、图快照、取景与空间采样

本批接续 [PR #469](https://github.com/Quriosity-agent/qcut/pull/469) 的 `7f44e4a11fb5fe1469a9316daf3f6446e2ace894`，继续在 `codex/jianying-binary-cpp-scaleup-20260908` 与 `/Users/peter/Desktop/code/qcut-binary-cpp-scaleup-wt/qcut` 推进。前批46项CTest及该head四平台C++绿灯为起点，本轮扩至52项。分支最初从 master `513a1c67d` 创建，不混入其他worktree改动。

## 四线交付

| 线 | 新增可独立编译 C++ | 实际原生证据 | 边界 |
| --- | --- | --- | --- |
| [Editor](videoeditor-variable-time-2026-09-08.zh.md) | 连续正向变速曲线归一化、三段速度积分/二次逆求值、Video时间与控制记录转换、无graph属性组合 | 384配置；628,308映射、46,080记录、7,872次实际property；944,020个非NaN/整数位一致、7,076个NaN分类一致；192源快照 | graph与变速组合、完整dispatch、反向曲线、seek仍缺 |
| [Creator](creator-graph-snapshot-2026-09-08.zh.md) | Graph/GraphPoint子树恢复、ID map数组副本、含图frame/group、两级历史stash选择 | 4,738案例、692,606项比较零差异；旧3,842案例/440,390项回归一致；8个编译mutant检出 | Graph整树stash/diff、Session选择与完整undo仍缺 |
| [Lens](lens-crop-selection-2026-09-08.zh.md) | 已选bbox/空输入 → CenterFocus历史跟随 → RectCropper目标矩形 → 既有RectSmoother/warp，附CLI | 65,744次CenterFocus、4,096次Cropper；3,208,960个SDK字段/输出位一致；128组合、2,632,192像素字节零差异 | 另65,744个ready门禁为派生检查；多候选检测、MergeUtil、完整VAS仍缺 |
| [AGFX](agfx-spatial-sampling-2026-09-08.zh.md) | M4 Pro二维8位空间权重、寻址规约和最终字节/16量化，接入既有LOD profile | 1,312配置，72,474,112通道逐位一致；独立GPU/native为第二条对照；普通float模型负控出现32,504个不同像素 | 每轴signed zero或abs∈[2^-24,8]；多层空间linear+miplinear、极小/极大坐标、其他设备仍缺 |

Creator的这些记录实现实际位于videoeditor，曲线速度底层实现位于cccreator，按功能调用链归组。AGFX是硬件实测profile，不宣称反编译了GPU芯片里的源码。每条线均保留已核验的真实SDK工厂与对象生命周期，输入保护和未验证范围独立说明。

## 验收

六工程保持不变，CTest由46增加至52：AGFX、Editor、Creator各+1；Lens数值/CLI/协议共+3。Soft Glow/Fog既有算法和CLI全部保留。

| 验证 | 本批结果 |
| --- | --- |
| 本机Release，包含全部macOS arm64原生探针编译 | 52/52 CTest |
| Debug ASan/UBSan，禁止恢复 | 52/52 CTest |
| 新原生差分 | 四线零差异；NaN只按明确分类合同统计，不扩大为payload一致 |
| 原生重复/消毒器构建 | 各线最终报告一致；厂商库本身未插桩 |
| 旧功能回归 | Editor graph/nonlinear、Creator记录、Lens五个原生矩阵、AGFX格式/纹理/mip分别与原证据比较 |
| 错误算法验证 | Editor6、Creator8、Lens7、AGFX5个编译成功的变体被检出；身份和未验证输入拒绝单列 |
| 交叉审查 | 四线只读检查边界、整数/浮点行为及对象/内存生命周期，未发现未处理的可行动缺陷 |
| 新head云端CI | 推送后按当前head验收，结果记录在PR；不能沿用7f44e4a11的绿灯 |

负控中曾出现未被初版语料检出的stash-null、镜像寻址和某个FMA变体。前两者补充实际分支/完整native金指纹后重验；FMA探索未检出明确保留为测试能力边界，不计成功负控。AGFX极小坐标与未闭合的多层双线性采样保留失败证据并在精确API拒绝。所有验证都不是新UI像素一致、预览/导出或产品集成证明。

统一入口：[independent-binary-contract](../../../research/independent-binary-contract/README.zh.md)。原始ASM/数值、构建、诊断JSON和source SHA清单位于 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/` 的四个模块目录及 `unified/`，最终总清单为 `verification.json`。所有厂商二进制、模型、Shader/LUT等资源均在仓库外。该诊断只在自有隔离进程内调用已核验版本，没有修改应用或用户草稿。

## 还剩什么与下一批

**两条完整标准C++滤镜链、六个独立工程、整库0/6、八个未完整关闭的大工作包**的统计不变。详见[剩余台账](binary-cpp-reconstruction-backlog-2026-09-06.zh.md)。本批关闭四个具体算法子项，不能以CTest数量或对照字段数推导整库完成百分比。

1. 把graph展开记录与新曲线时钟组合，验证每通道control，再扩完整property dispatch；避免重新实现已有积分/cubic。
2. 恢复Graph整树stash/diff与Session记录选择/事务应用，连接已有子树restore到真实undo/redo。
3. 沿Lens上游多候选选择与下游MergeUtil继续；Deflicker/VAS/UMVFI/VMB分别恢复时序核心和GPU数值，不用裁切代替完整算法。
4. AGFX继续闭合多层双线性组合及真实滤镜逐Pass残差，再接通用图、迷雾CPU产品出口。其他设备的profile另实测。
5. ByteNN与cccreator分割/降噪明确张量和模型资产合同，独立交付运行时算法和获授权模型路径。

本批仍在PR #469推进，不合并、不发版；源码交付、原生合同、UI对标和产品集成分别验收。

## 第三批后续

本页为第二批历史快照。graph 与曲线时间组合、Graph 整树 stash/diff、MergeUtil 的 border=11 Move 数值核以及有界 M4 多层联合线性采样已在[第三批收尾记录](binary-cpp-batch3-2026-09-08.zh.md)继续交付；统一本机测试增至 58/58。完整 Session undo、整个 MergeUtil、其他 GPU 和产品集成仍缺。
