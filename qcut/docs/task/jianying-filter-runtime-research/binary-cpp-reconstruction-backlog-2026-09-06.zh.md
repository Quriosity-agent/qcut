# 剪映二进制分析与独立 C++ 还原：剩余工作台账

初始盘点日期：2026-09-06。当时工作分支：`timeline-fixed-prfix`；源码基线：`c8ac87f132eb963cc9fa7805c8530f5325e1755d`。
09-06 盘点只核对已有代码、研究报告和本机安装清单，没有新增反编译或算法实现。下述安装文件与资源卡库存仍保留该日期的历史快照。

2026-09-07 更新：从 master `29d4700a5` 新建 `codex/jianying-binary-cpp-next`，AGFX、videoeditor、VECreator、Lens 四线持续推进，统一构建现含柔光和迷雾，共六个 C++ 工程。本批新增迷雾完整四段算法和真实 Segment 非线性属性子域；本机 Release 与禁止恢复的 ASan/UBSan 均 40/40，实际数值与像素已有原生对照；新提交的远端 CI 待推送后检查。逐项状态见[执行记录](binary-cpp-execution-2026-09-07.zh.md)。**完整标准 C++ 滤镜链为柔光、迷雾 2 条；仍有 8 个未完整关闭的工作包，整库仍 0/6。**

2026-09-08 更新：从最新 master `513a1c67d` 新建 `codex/jianying-binary-cpp-scaleup-20260908`，四线新增非空graph、局部记录恢复、连续帧裁切和M4 mip精度profile。六工程本机 Release/ASanUBSan各46/46，详见[本批交付与验收](binary-cpp-scaleup-2026-09-08.zh.md)。两条完整滤镜链、8个未完整关闭的大工作包、整库0/6的口径均不变。

## 现在到底还剩多少

| 统计口径 | 已有结果 | 还剩什么 |
| --- | --- | --- |
| 当前优先队列的核心库 | **6 个**：cccreator、AGFX、videoeditor、VECreator、lens、bytenn | **6/6 都没有完成整库源码还原**；不能把局部函数分析记为一个库完成 |
| 定点二进制分析 | 09-06 已记录 AGFX、videoeditor、VECreator 的报告及历史 cccreator 证据；09-07 深入 Lens 数值函数，当前这 **5 个库均有明确的定点反汇编证据** | 各库仍有大量未覆盖路径；bytenn 已有模型输入边界证据，也不属于“完全没碰过” |
| 可单独交付的完整标准 C++ 效果算法链 | **2 条：电影柔光、迷雾**。两者都有不加载厂商库的源码、编译入口、像素 CLI、算法测试和原生对照；柔光另有持续帧 CLI 和既有 QCut 接入 | 迷雾的通用图、CPU 产品 adapter、Preview/Export、新 UI E2E 尚未完成；两条算法都有精度、透明/HDR、实时性能等限定 |
| 09-07 独立 C++ 工程 | **6 个**：AGFX、videoeditor、Creator、Lens、Soft Glow、Fog；包含局部语义、图像原语与两条完整滤镜算法链 | 工程数不是完整引擎数，也不对应六库完成数；原生参考 Python runner 不另算一个 C++ 工程 |
| 09-06 安装包的 `.dylib` 历史库存 | 剪映 11.3.0 的 `Contents/Frameworks` 下递归找到 **85 个实际文件**，其中顶层 **82 个**、嵌套 **3 个** | 除上面六个优先目标外，另外 **79 个文件不纳入这张核心还原表**；没有逐库完成率，不能直接说“还剩 81 个没反编译” |

因此，后续任务应表述为：**继续完成 6 个核心库涉及的目标算法/合同，其中目前明确交付了两条独立 C++ 滤镜算法链；整库级恢复完成数为 0。** 算法链数、工程数和库数不能互相做减法。

85 是 09-06 文件系统盘点值，不是剪映全部 Mach-O 镜像数，本次局部源码更新没有重算该库存：没有把应用主程序、无 `.dylib` 后缀的 Framework 可执行文件、系统依赖或其他私有运行时快照混入。很多依赖是通用基础库，也不需要逐个重写。旧文档的 **23 个 dylib** 是某份私有运行时的依赖闭包，不能替代安装包库存。

## 六个核心库逐项状态

| 核心库 | 已经知道/已经做过 | 独立 C++ 现状 | 尚需分析与实现 |
| --- | --- | --- | --- |
| `libcccreator.dylib` | Effect/Swing/FeatureSegment 宿主、序列化资源及部分文本/人像/跟踪合同；电影柔光和迷雾固定资源图与强度语义 | 两条滤镜链已提炼为独立 C++20；迷雾使用未修改原包的 Swing JSON 数值事件参考，30 进程/210 帧稳定。大量 `.mm/.cpp` 仍只是原生探针或桥 | 通用多 Pass 图、迷雾 CPU 产品接入与 UI 验收、其他复杂滤镜/文本/转场；Bach/GRU/跟踪核心和模型仍有私有依赖 |
| `libAGFX.dylib` | 格式转换含 113 项映射、28 项平台条件，每次 208,911 次原生差分；采样器 768 种组合；新增 5 个纹素夹具 × 768 sampler 的真实像素对照，全部逐位相同，RGBA/BGRA 读回及 3D 空间采样也已通过 | [独立 C++20 合同与纹素原语](../../../research/independent-agfx-contract/README.zh.md)已有可运行源码及测试；详见[AGFX 像素验证](agfx-texture-pixels-2026-09-07.zh.md)。这是格式/采样/读回单元，未恢复通用 AGFX 引擎 | 09-08 M4显式mip的选择/字节混合已实测闭合，旧456,192排除通道已纳入；任意空间/跨层幅值组合及其他设备仍未逐位闭合；D634 柔光逐 Pass 格式/采样已实测；666,580 通道验证修正 UNORM 转换，两次 blit 新增权重与舍入实测，三个图样独立阶段零差异；整链仍有残差，还需颜色/Alpha、资源寿命、同步及多 Pass 图整合 |
| `libvideoeditor.dylib` | 保留状态、JSON、合并重采样、实际 Bézier、窗口与恒速 Segment 对照；本批新增非线性属性 117,515 次调用/784,545 个值，729,127 个非 NaN 值逐位一致、55,418 个 NaN 分类一致 | [独立 C++](../../../research/independent-editor-contract/README.md)已连接恒速时间适配、控制记录及预选两帧的非线性属性求值；见[非线性属性报告](videoeditor-nonlinear-property-2026-09-07.zh.md) | 09-08已新增非空graph展开与逐通道property，限Video、至少一侧curve非零、raw midpoint非命中且映射/记录不降序。完整分派、exact-hit 与该新分支的整合、变速曲线、其他 Segment、seek/export/undo 及效果事件传播仍缺 |
| `libVECreator.dylib` | 既有选择/请求/回调基础上，跨入 videoeditor 的真实 update/reset 注册表和处理器；确认 reset 字面量 1.0、全 common 组移走、已有 ID graph 清空/values 替换 | [独立 C++](../../../research/independent-creator-contract/README.md)1143 项检查通过；10,008 原生单值 vector 位型一致，完整 handler 状态仍为静态证据；见[事件报告](creator-editor-events-2026-09-07.zh.md) | 已解析时间的新建/插入/碰撞更新及 control 修复已有独立实现和局部原生对照；新增 2244 组 dirty/retained 生命周期原生对照；09-08已交付graph-free point/frame/group-list restore，3,842案例/440,390比较零差异；当前时间完整定位、Session选择记录与完整request→SDK→effect/undo/UI回放仍未闭合 |
| `liblens.dylib` | 六个数值原语 4,441 案例/139,213 值逐位一致；新增 base RGBA 图像仿射/BGR，3,892 案例/161,540,260 字节零差异 | [独立 C++ 库、图像 CLI 与测试](../../../research/independent-lens-contract/README.zh.md)已编译，split 量化/signed16 回绕/透明边界有原生证据；见[图像 warp 报告](lens-image-warp-2026-09-07.zh.md) | 已恢复预处理器两后端分派及 NEON 真正 SIMD 条件，各 10,998 案例零差异；仍缺上游产品/VAS 实际选择、运动估计/时序链；crop 四锚点规划及真实 ImageTransform→warp 已局部闭合；09-08新增RectSmoother连续帧裁切及128帧warp组合，但检测器/VAS上游、Deflicker独立时序/GPU核心、UMVFI模型/补帧、VMB光流/融合仍未完成 |
| `libbytenn.dylib` | ByteNN 模型加载、`SetInput` 张量元数据与输入预处理边界，部分模型路由 | **尚无 ByteNN 推理引擎及相关降噪/分割模型的完整独立 C++ 替代** | 张量布局、算子/后端、输出协议、时序状态与模型依赖。恢复推理调用合同不等于取得模型训练源码或权重的独立替代 |

上述证据来自不同时间与不同二进制版本。当前已安装 11.3.0 与柔光历史 D634 CGL 参考分开记录，地址/ABI/像素结论不能跨版本直接套用。

### 下一批候选库（4 个，尚未纳入当前六库优先队列）

| 库 | 目前证据 | 待推进 |
| --- | --- | --- |
| `libLumiGeneRuntime.dylib` | 已识别为脚本转场运行时桥和依赖 | 内部调度/执行合同；现有文档未记录完整独立替换 |
| `libfastcv.dylib` | 已记录视觉处理依赖和版本身份 | 按具体效果定位需要的光流/warp/图像算子；现有文档未记录库内核心完整恢复 |
| `libsamicore.dylib` | 已出现在私有运行时依赖闭包 | 先建立音频功能→符号→输入输出的定向台账，再决定需要的自有算法 |
| `libspeechsdk.dylib` | 已识别 ASR/字幕后处理入口和模型供给 | 拆分本地/云端路由，先取得可复现输入输出，再考虑独立语音算法 |

加上这四个候选，**本台账点名跟进的是 10 个库，当前执行优先队列仍为 6 个**；没有把候选识别写成已完成反编译。依据为[运行时依赖说明](../../../research/jianying-runtime-probe/README.md)、[依赖闭包](video-object-bach-host-boundary-2026-08-28.zh.md)和[字幕研究](../jianying-subtitle-reference/README.zh-CN.md)。

`libTracking.dylib` 已确认是埋点/遥测库，不是视觉跟踪算法；Bingo 原生跟踪桥已有真实轨迹输出，但独立 tracker 仍未完成，现有自有视频基线使用 Python/OpenCV。见[跟踪研究的原生桥与自研阶段](../../../research/jianying-tracking-probe/README.md)。

## 已经写好的 C++ 不要重复做

电影柔光源码位于 [`research/independent-soft-glow`](../../../research/independent-soft-glow/README.zh.md)：

- 算法主体：`image.cpp`、`gaussian.cpp`、`glow.cpp`、`layer.cpp`、`lut.cpp`、`pipeline.cpp`。
- 已有 Gaussian、SoftLight、RG/BA 打包 Glow、LUT、Normal 合成和固定场景连接；`output-mix` 与 `ui-snapshot` 两种强度合同分开。
- 已有 CMake、静态库、raw/PPM 输入输出、持续 RGBA 帧协议、异常输入和算法测试；编译与渲染不加载剪映库。
- 已有五档剪映 UI 导出对照、70 帧运动序列重复/乱序验证、实际 QCut 预览和导出 E2E。具体范围见[最终验证报告](soft-glow-ui-video-verification-2026-09-06.zh.md)。本次文档盘点没有重跑这些实验。
- 精确色调仍需要外部 LUT；透明/HDR/高位深、通用事件状态机、逐 Pass 原生精度、GPU/SIMD 实时化及跨设备原生像素实测尚未完成。普通工程 CI 通过不能替代这些验证。

迷雾源码位于 [`research/independent-fog-contract`](../../../research/independent-fog-contract/)：

- 复用自有 Image/IO/LUT，新增采样后亮度阈值、横纵 17 taps、遮罩 Screen 合成和四段强度管线；有库、raw/PPM CLI、阶段输出和边界测试。
- 原始包数值事件与默认材质分开；三图、四档、不同时间/逆序/跨进程及强度切换合计 30 进程/210 个原生输出请求，四档输出各异、零档直通。原始 PNG/LUT 和运行库仍在仓库外。
- 12 组固定原生参考的 C++ 对照本机 RGB MAE 为 0–0.017425，最大通道误差 2；按明确容差验收，**不宣称逐字节完全一致**。实际中间 Pass 捕获没有成功，剩余误差归因仍待做。
- 算法交付不等于产品交付：通用图、CPU 产品 adapter、预览、导出及新 UI E2E 未完成。历史迷雾 Metal 产品证据不能替代新 CPU 路径验收。详见[语义报告](second-complex-filter-semantics-2026-09-07.zh.md)和[最终 C++ 验证](fog-cpp-verification-2026-09-07.zh.md)。

两条算法均来自**二进制宿主行为、资源图、脚本/Shader 语义及实际输出的共同证据**，并非把一个完整 dylib 自动翻译回了原始 C++ 项目。

09-07 新增的四个独立目录也应直接复用，不要重新从枚举表、空包装器或通用近似开始：

| 目录 | 已交付内容 | 复用边界 |
| --- | --- | --- |
| [independent-agfx-contract](../../../research/independent-agfx-contract/README.zh.md) | 格式、sampler 和 CPU 纹素算法；隔离原生纹理上传、采样与读回验证 | M4显式mip受限精度已闭合；其他设备、任意空间幅值和完整多Pass图仍待闭合 |
| [independent-editor-contract](../../../research/independent-editor-contract/README.md) | 值状态、时间端点、元数据、实际 Bézier/重采样、窗口选帧及恒速 Segment 的线性/非线性属性子域 | 完整分派、变速曲线、对象生命周期和动作链未恢复；NaN 分类一致不代表 payload 一致 |
| [independent-creator-contract](../../../research/independent-creator-contract/README.md) | 选择/请求/回调、材质/reset、已解析时间的关键帧创建/插入/control 和 dirty/retained 生命周期 | 常量、向量、局部SDK模型变更和graph-free记录恢复有原生对照；完整时间转换与Session undo未闭合 |
| [independent-lens-contract](../../../research/independent-lens-contract/README.zh.md) | 六个 CPU 数值原语、base/NEON/ImageTransform warp、crop 变换计划及 CLI | 有实际图像字节对照；尚未连接为完整防抖/防闪烁/补帧算法 |

仓库另外已有独立 Metal 滤镜及人像后处理代码，例如 [`host.mm`](../../../electron/qcut-independent-filter/host.mm)、[`alpha-refinement.cpp`](../../../electron/jianying-person-cutout/native/alpha-refinement.cpp)、[`alpha-temporal-stabilizer.cpp`](../../../electron/jianying-person-cutout/native/alpha-temporal-stabilizer.cpp)。它们应保留和复用；两条标准 C++ 滤镜链不是整个仓库自有 C++ 的总量。

## 下一步按什么顺序做

| 优先级 | 可执行任务 | 完成门槛 |
| --- | --- | --- |
| P0 | 复用已完成的柔光/迷雾算法，建立通用图执行与迷雾 CPU 产品 adapter | 预览、导出、强度切换、禁原生回退和新 UI E2E 分别验收；已有 CLI 像素差分不替代产品闭环 |
| P0 | 在已验证AGFX上传/空间采样/读回及M4 mip profile基础上，补其他精度域、柔光实际逐Pass证据和GPU/SIMD路径 | 数值差异有归因；CPU/GPU 对照、尺寸/强度切换、预览/导出和性能数据均有证据 |
| P1 | 复用 Lens 已恢复数值原语，连接运动矩阵生成、裁切与像素 warp；并继续恢复 Deflicker、防抖/补帧/VMB 的各自核心 | 先恢复帧输入输出、时序状态和 UI 参数合同，再交付不加载该库的完整算法与视频对照；坐标或轨迹通过不替代帧验证 |
| P1 | `libbytenn` 与 cccreator 的分割/降噪链 | 明确哪些是通用推理代码、哪些是模型资产；独立/已授权后端产出真实张量和像素，不以 model-loaded 计完成 |
| P2 | 在 creator 请求计划和 editor 状态/元数据单元之间补齐真实类型、对象生命周期与事件链，再连接 cccreator | reset、多选、关键帧、seek、重开和导出合同被测试覆盖；需要的语义接入 QCut，不重复实现整套原 UI |

已关闭的算法子项：迷雾真实卡语义契约、标准 C++ 四段实现及本机原生像素差分。后续八个完整工作包：

- [ ] 04：扩展已闭合的M4 mip受限profile，完成柔光/迷雾逐Pass采样与舍入归因，并补 GPU/SIMD 性能和跨平台原生像素验证。
- [ ] 05：videoeditor 完整类型/属性分派、变速时间适配、seek/export 与效果事件传播。
- [ ] 06：复用已完成的局部记录恢复，补Creator当前时间定位、Session记录选择/完整undo与UI生命周期。
- [ ] 07：通用多 Pass 图与迷雾 CPU 产品 adapter、Preview/Export、新 UI E2E。
- [ ] 08：Deflicker 从私有运行时桥推进到独立连续帧算法。
- [ ] 09：ByteNN 相关降噪/分割明确模型替代与独立推理路径。
- [ ] 10：复用crop/warp与RectSmoother时序裁切，补上游实际产品选择、运动估计与完整VAS。
- [ ] 11：UMVFI 与 VMB 分别补齐帧合同、模型边界和独立补帧/融合实现。

这八条与执行队列 04–11 一一对应；03 受控空间采样之外的 CPU mip 余项归入 04，性能与跨平台像素验证也在该包。此前按主题拆分的八条重新按队列归组，并不表示余项全部完成。07 的迷雾算法子项已关闭，但通用图和产品出口仍未完成，因此工作包数保持 8。没有函数级覆盖率，不估算“还差百分之多少”或全部完成工时。

## 不同库存数字不要混算

[第三批混合滤镜报告](hybrid-dual-3dl-batch3-2026-09-06.zh.md) 的快照是：892 张资源卡，713 张完全独立 Metal、117 张自有 Metal 加私有模型、62 张未迁移到 Metal（含 4 张缺包）；另有一张 CPU 卡。这里数的是**资源卡与后端支持**，不是 dylib，也不是 713 份独立 C++ 算法。

[转场解构报告](../../../research/jianying-runtime-probe/DECOMPILATION.md) 已恢复 13 个代表性转场的公式/结构，部分数学代码在 TypeScript；其原生差分通过不代表 13 套完整独立 C++ 渲染器已经交付。`.ausl`、`graph.dat` 等资源文件也不并入本表的动态库数量。

## 证据入口与盘点方法

- [09-08新分支四线交付和当前测试](binary-cpp-scaleup-2026-09-08.zh.md)

- [二进制第一轮总报告](binary-priority-research-2026-09-06.zh.md)
- [AGFX 纹理契约](agfx-texture-contract-2026-09-06.zh.md)
- [09-07 AGFX 实际纹素与原生采样/读回](agfx-texture-pixels-2026-09-07.zh.md)
- [09-07 videoeditor 独立状态/时间/元数据](videoeditor-cpp-contract-2026-09-07.zh.md)
- [09-07 VECreator 独立选择/请求/回调](vecreator-cpp-contract-2026-09-07.zh.md)
- [09-07 Lens 六个独立 CPU 数值原语](lens-cpp-contract-2026-09-07.zh.md)
- [videoeditor 调用链](videoeditor-filter-chain-2026-09-06.zh.md)
- [VECreator 参数与提交](vecreator-filter-params-2026-09-06.zh.md)
- [基础视频探针与验证等级](../jianying-video-basic-panel-reference/PROBES.zh-CN.md)
- [Deflicker 私有运行时现状及缺口](../jianying-video-basic-panel-reference/PRIVATE_RUNTIME_DEFLICKER.zh-CN.md)
- [ByteNN 模型输入边界](model-input-boundary.zh.md)
- [09-07 真实 SDK 窗口选帧](videoeditor-window-selection-2026-09-07.zh.md)
- [09-07 新建关键帧与控制点](creator-keyframe-insertion-2026-09-07.zh.md)
- [09-07 Lens 实际 warp 后端](lens-warp-backends-2026-09-07.zh.md)
- [09-07 柔光 UNORM 与末端混合](soft-glow-unorm-precision-2026-09-07.zh.md)
- [09-07 第二条复杂滤镜：迷雾语义](second-complex-filter-semantics-2026-09-07.zh.md)
- [09-07 迷雾 C++ 最终验证](fog-cpp-verification-2026-09-07.zh.md)
- [09-07 videoeditor 非线性属性子域](videoeditor-nonlinear-property-2026-09-07.zh.md)
- [柔光算法语义契约](../../../research/independent-soft-glow/semantic-contract.zh.md)

安装文件库存可用以下只读命令重算；升级应用后应更新日期和计数：

```sh
python3 - <<'PY'
from pathlib import Path
import plistlib

app = Path('/Applications/VideoFusion-macOS.app')
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
root = app / 'Contents/Frameworks'
files = {p.resolve() for p in root.rglob('*.dylib') if p.is_file()}
top = {p.resolve() for p in root.glob('*.dylib') if p.is_file()}
print(info['CFBundleShortVersionString'])
print({'dylib_files': len(files), 'top_level': len(top), 'nested': len(files - top)})
PY
```

本台账只保存原创说明和定位信息；原始库、模型、资源包与原生证据保持在仓库外。
