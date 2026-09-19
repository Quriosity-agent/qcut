# QCut 本地神经网络与二进制模型依赖盘点

审计日期：2026-09-19。代码基线：`a0113abec1e602b995b08a6a6b8353dec8a4ec3e`，本轮 `fetch origin master` 后又以 `ls-remote` 核对远端。

分支：`codex/local-neural-model-audit-20260919`。
工作区：仓库的 `qcut/` 子目录；Git 根目录为其上一级。

本页首先记录只读审计时的初始分类；同日后续研究见下方更新。初次审计未修改产品执行路径；第五阶段新增显式 ONNX 分镜选项，默认引擎不变。没有调用收费云端接口。

**同日第二阶段更新**：已确认原 A04 `tt_facefitting_3d` 包含一个真实的全连接神经子网，不能继续整体归为非神经拟合数据。
核心依赖的分类应由保守 **15 个神经模型家族 + 5 个算法包** 修正为 **16 + 4**，合计仍为 20 项；Apple Vision 另计。
下文保留初次审计的证据与编号，A04 的“未证明”状态已由这项新证据取代，不代表所有美妆几何包均为神经模型。
第二阶段转换与测试快照见 [第二阶段记录](../../../research/local-model-pytorch/SCALEUP-20260919.zh-CN.md)：
10 个网络资产通过模型级对照，8 个独立 PyTorch 包，另有 1 个 GRU 候选数值失败；原始和派生权重仅在忽略目录。
这些数字含旧版本和非当前产品路径，不能等同于 16 个生产模型家族的完成率。

**最新进展**见[第五阶段收尾](../../../research/local-model-pytorch/PHASE5-20260919.zh-CN.md)：四平台公开合成 CI 实际通过，Linux x86_64 私有 19 图/76 组回放通过；Windows 私有模型仍未验收。GRU 新 v3 和 Bandou 新有序 profile 通过各自完整原生输出门槛，旧失败包仍拒绝。OCR 精确字表/CTC 已补齐，但 11 张图片仅 4 张全对。ONNX 分镜新增 CLI/编辑器显式入口，真实 CLI 完成分钟级验证；编辑器 E2E 两项因 `Media not found` 失败，不能称产品全链路完成。

[第四阶段记录](../../../research/local-model-pytorch/PHASE4-20260919.zh-CN.md) 的历史累计为 18 个源资产、21 个网络版本、16 个 PT 包、19 份 ONNX。新 profile 不作为新模型家族重复计数，也不改变下方初次审计的生产依赖口径。

## 1. 初次审计：“用了多少”

不能把缓存里的 `.model` 数量直接当作 QCut 已运行的神经网络数量。

| 统计口径 | 数量 | 含义 |
| --- | ---: | --- |
| 核心代码入口及固定美颜效果包明确依赖的本地模型/算法包 | **20 项** | 下表 N01-N15 加 A01-A05；包括可选、实验路径，不代表本机全部可运行 |
| 其中按功能与现有实现证据归类的神经推理模型家族 | **15 项** | 以逻辑模型家族去重，不是包内计算图数量；包含实验性 saliency 模型 |
| Apple Vision 系统人物分割能力 | **另 1 项** | 没有由 QCut 管理的权重文件，不能与上述 15 个文件型模型混为一种资产 |
| 脚本、拟合与未确认网络结构的跟踪依赖 | **5 项** | 纳入二进制依赖，不武断计为 5 个神经网络 |
| artistEffect 缓存还声明、但未逐项闭合产品执行链的额外逻辑名 | **7 项** | 另列候选，不计入核心 20 项 |
| `JianyingFilter/current/Models` 实存文件 | **53 份** | 本次逐文件大小及 SHA-256 校验通过；不是 53 个已接入网络 |
| 本次五套 current 清单的模型路径合计 | **69 个条目 / 64 个唯一 SHA-256** | 包括旧版本、脚本、辅助包及仅缓存资产；不含所有效果包内嵌资产 |

因此，适合工程沟通的说法是：**当前识别到 15 个文件型神经推理模型家族，加 1 项系统模型能力；其所在核心链路合计依赖 20 项本地模型/算法包。** 这不是“16 个网络全部已实测可用”的结论，更不是全部资源卡的穷尽网络数。

统计规则：

- 同一模型的 ByteNN、CoreML、PyTorch 后端不重复计数。
- 同一 SHA-256 的原文件、缓存副本、别名不重复计数。
- `flownet.bin` 和 `flownet.param` 是一个 RIFE 模型的权重与结构，不算两个。
- `.model` 可能封装脚本、几何拟合数据、多个推理后端或网络；文件数不等于网络数。
- 效果包声明、文件存在、成功加载、真实推理、预览/导出一致，是五种不同证据。
- 下文的“接入”指代码或固定效果包存在执行依赖，不表示本轮重新跑过该功能的真实素材 E2E。

## 2. 文件型神经推理模型家族

“神经推理”是基于用途、加载实现及仓库现有分析的分类；除镜头分割等已公开恢复的实现外，本轮没有逐包拆出全部算子与内部子网络。

| ID | 模型家族 / 物理版本 | 功能与调用入口 | 当前边界 |
| --- | --- | --- | --- |
| N01 | `person-segmentation.tflite` | 浏览器人物分割；`PersonCutoutClient` -> Worker -> MediaPipe `ImageSegmenter` | 仓库跟踪的模型文件；本轮校验存在，未重跑浏览器推理 |
| N02 | `rife-v4.6` | 神经补帧；FFmpeg 导出前调用 `rife-ncnn-vulkan` | 有三平台 staging 和校验清单；**当前源码工作区缺程序及模型** |
| N03 | `jy_compressShotDetectBackbone_new_v1.0_size0.bytenn` | 分镜特征主干，现有 PyTorch 实现为 GhostNet 风格 | 原始 bridge 与 torch 共用此模型资产 |
| N04 | `jy_compressShotDetectPredHead_new_v1.0_size0.bytenn` | 分镜时序预测头，现有实现含 GRU | N03/N04 组成一个分镜管线，但确实是两份网络资产 |
| N05 | `tt_matting_video_gru` v1.0 | 人像抠像 `portrait-gru` | 私有剪映模型与运行库；可再融合 Apple Vision |
| N06 | `video_saliency_seg_bce` v1.0 | 通用视频对象抠像 `video-object` | Bach、同模型 CoreML、实验宿主互操作都是同一模型的不同路径 |
| N07 | `saliency_matting` v1.0 | `saliency-script` 显著性抠像 | **实验路径**；resolver 同时要求 A01 及 N06 等资产 |
| N08 | `tt_fsnew_base_jianying` v2.0 | 基础人脸检测，供美颜及抠像自动路由采样 | 固定效果包动态加载；不是 QCut 自训模型 |
| N09 | `tt_face` v11.2 | 人脸/关键点相关输入，多个人像包共享 | 不把每个美颜滑条计为独立模型 |
| N10 | `tt_face_extra` v15.0 | 人脸细节与扩展关键点 | 逻辑名与物理文件版本可能不同，需保留 resolver 证据 |
| N11 | `tt_freid` v2.0 | 人脸跨帧 ID，逐人美颜参数绑定 | 不等于已经接入跨镜头身份识别 `tt_faceverify` |
| N12 | `tt_skin_seg` v5.1 | 皮肤掩膜、磨皮/肤色、模型驱动双 LUT 滤镜 | Metal 混合器独立，不意味着 skin mask 模型独立 |
| N13 | `tt_skeletonsquat` v10.0 | 美体关键点与形变输入 | `body` 固定包；不要从此推导所有骨骼模型都已接入 |
| N14 | `jypc_yunfuhua_gpucpu` v1.0 | 匀肤、丰盈 GAN | 两个控制共用 `skin-gan` 包，计一个模型家族；2026-09-19 已恢复为 PyTorch 并通过 CPU 原生对拍（[记录](../../../research/local-model-pytorch/yunfuhua-parity.zh-CN.md)），产品前处理、GPU 路径与接入未验证 |
| N15 | `newbandou` v1.0 | 祛斑祛痘神经修复 | `spot-acne` 包，另有 A02 脚本依赖 |

可追溯代码：

- N01：[客户端](../../../apps/web/src/lib/segmentation/person-cutout-client.ts)、[Worker](../../../apps/web/public/mediapipe/person-cutout-worker.js)、[导出调用](../../../apps/web/src/lib/segmentation/person-cutout-export.ts)。Worker 配置本地 WASM、模型 URL 和 CPU delegate。
- N02：[固定版本与哈希](../../../electron/rife/rife-binaries.json)、[运行桥](../../../electron/rife/rife-bridge.ts)、[staging](../../../scripts/stage-rife-binaries.ts)、[导出入口](../../../electron/ffmpeg-export-handler.ts)。
- N03/N04：[资产合同](../../../electron/jianying-shot-split/runtime-assets.ts)、[torch 入口](../../../electron/jianying-shot-split/torch-engine.ts)、[主干实现](../../../research/jianying-shot-split-probe/torch_backbone.py)、[预测头实现](../../../research/jianying-shot-split-probe/torch_predhead.py)。
- N05：[抠像运行时](../../../electron/jianying-person-cutout/runtime.ts)、[GRU 桥](../../../electron/jianying-person-cutout/native/matting-gru-bridge.cpp)。
- N06：[候选运行时](../../../electron/jianying-person-cutout/video-object-runtime.ts)、[CoreML 解包与 schema 校验](../../../electron/jianying-person-cutout/video-object-coreml-runtime.ts)。内部 `20440.3_sod_fp16.mlmodelc` 不再计一个新模型。
- N07/A01：[saliency resolver](../../../electron/jianying-person-cutout/saliency-runtime.ts)、[实验标记](../../../electron/jianying-person-cutout/pipeline-descriptor.ts)。
- N08-N15/A02-A04：[固定效果包身份](../../../electron/jianying-portrait-adjustment-runtime/catalog.ts)、[效果包解析](../../../electron/jianying-portrait-adjustment-runtime/package-resolver.ts)、[产品 provider](../../../electron/jianying-portrait-adjustment-runtime/provider.ts)、[模型解析规则](../../../research/jianying-runtime-probe/filter-host-support.mm)。

本次读取上述 catalog 指定的 **18 个固定效果包** 的 `config.json` 和 `algorithmConfig.json`，提取 `model_names` / `model_name`，去重得 **11 个逻辑依赖**：N08-N15 共 8 个，加 A02-A04 共 3 个。手动拉伸、手动瘦身、手动缩放三包在这两份配置中没有声明模型，不人为增加数量。

## 3. 系统模型与非纯网络依赖

| ID | 依赖 | 为什么单列 |
| --- | --- | --- |
| S01 | Apple `VNGeneratePersonSegmentationRequest` | 系统人物分割；GRU 默认可融合此结果，开关为 `QCUT_DISABLE_VISION_PERSON_FUSION`。QCut 没有单独管理它的权重版本或文件数 |
| A01 | `saliency_script_for_cc` v1.2 | 脚本编排包；不因扩展名是 `.model` 就计一个独立网络 |
| A02 | `newbandou_remove_script` v1.0 | 祛斑祛痘后处理/脚本依赖，与 N15 分开登记，但不增加神经网络计数 |
| A03 | `tt_facefitting1256` v2.0 | 美妆几何拟合包；本轮未拆内部网络与参数表，保守列为算法资产 |
| A04 | `tt_facefitting_3d` v6.2 | 手动磨皮、手动祛痘依赖；同样未证明它是一份独立神经网络 |
| A05 | `bingo_objectTracking_v1.0.dat` | 当前 Bingo 运动跟踪桥直接传入此文件；已接入二进制跟踪，但本轮没有确认其内部神经网络结构 |

S01 代码：[Vision 桥](../../../electron/jianying-person-cutout/native/vision-person-segmentation.mm)。
A05 代码：[Bingo 桥](../../../research/jianying-tracking-probe/bingo-tracking-bridge.cpp)、[跟踪资产清单](../../../electron/jianying-motion-tracking/runtime-assets.ts)。

**`single_object_tracking_v1.0.model` 不计入 A05，也不增加核心数量。** 跟踪 runtime 清单虽强制携带它，当前 `bingo-tracking-bridge.cpp` 实际初始化传的是 Bingo `.dat`。清单依赖不等于当前桥执行了另一条 single-object 网络。

## 4. 动态滤镜长尾，不能忽略也不能算已完成

扫描本机 `JianyingFilter/current/Cache/artistEffect` 清单中的 `config.json`、`algorithmConfig.json`，总计发现 11 个逻辑名。其中 `tt_skin_seg`、`tt_face`、`tt_face_extra`、`saliency_matting` 已包含在前面，以下 **7 个额外名字** 不直接并入“已使用”总数：

| 逻辑名 | 本轮证据与待办 |
| --- | --- |
| `tt_matting` | 缓存存在 v15.0；需确认具体滤镜调用和真实加载文件 |
| `tt_skin_seg_hypic_backlight` | 效果包声明；53 文件目录没有同名家族，resolver 可能走 skin 家族回退，不能当成独立模型已就绪 |
| `saliency_script_for_douyin` | 有声明，当前 53 文件目录没有同名包；不能与 `saliency_script_for_cc` 自动等同 |
| `tt_c1_small` | 有声明，当前 53 文件目录没有同名包 |
| `tt_skyseg` | 有声明，当前 53 文件目录没有同名包 |
| `bingo_scene_normal` | 有声明；不能仅凭名称把它与缓存的 `nh_normal_estimation_offline` 等同 |
| `tt_facefitting1220` | 缓存存在；需确认具体卡片、产品路由、真实加载与可见输出 |

这是**本机缓存配置扫描**，不是 QCut 已支持所有这些滤镜的证明，也不是剪映全量模型清单。未来新增资源卡会改变这个集合。

模型解析器支持 exact filename、stem match 和 family fallback。它有能力给动态名字返回文件，不代表每个返回值都是正确物理模型。后续审计必须记录 `requested logical name -> resolved path -> SHA-256 -> inference backend -> result`。

## 5. 不计入本地网络数量的项目

| 项目 | 原因 |
| --- | --- |
| Gemini、OpenRouter 模型、FAL SAM3、ElevenLabs | 目前相关执行是云端 API，不是随 QCut 安装的本地权重 |
| 字幕研究里的 `asr-model-encoder.onnx`、`asr-model-classifier.onnx`、`asr-punc.onnx` | [字幕探针](../../../research/jianying-subtitle-probe/probe.ts)里的观察目标；没有据此接入 QCut 本地 ASR |
| DeepFilter / Demucs / 本地变声 / 本地语音翻译 | [音频能力表](../../../electron/qcut-audio-runtime/capabilities.ts)明确返回 `model-required`，不能算已运行模型 |
| `nn_denoise.bytenn` | [基础视频探针](../../../research/jianying-basic-video-probe/native/runtime-probe.mm)目前该分支只证明解析模型，不能当成产品真实像素降噪 |
| `deflicker.metallib`、`umvfi.metallib` | GPU shader 二进制；变量即使叫 `modelPath`，也不能直接推断存在神经权重 |
| `lens_vfi`、`tt_eyegrad`、OCR、音频事件、其他缓存模型 | 本轮没有闭合到核心产品执行链；文件存在不增加接入数 |
| FFmpeg、AICP 可执行文件、`libbytenn`、`libcccreator`、Metal shader、LUT | 分别是工具、推理/效果运行库或数值渲染资产，不是模型计数单位 |

云端判断依据：[ElevenLabs/FAL](../../../electron/elevenlabs-transcribe-handler.ts)、[Gemini](../../../electron/gemini-transcribe-handler.ts)、[SAM3/FAL](../../../apps/web/src/lib/ai-clients/sam3-client.ts)。本轮未调用这些接口。

## 6. 当前机器的资产检查

范围限定为 `~/Library/Application Support/QCut/PrivateRuntimes` 下五套 `current` 清单：Filter 只取 `Models/`，其余取 `.model` / `.bytenn` / `.dat`。BasicVideo 清单路径相对其 `Models/` 目录。按实际文件读取，重新计算 SHA-256 并核对大小。

| runtime | 条目数 | 唯一哈希数 | 本轮校验通过 | 条目总字节数 |
| --- | ---: | ---: | ---: | ---: |
| JianyingFilter | 53 | 53 | 53 | 175,953,225 |
| JianyingMatting | 2 | 1 | 2 | 7,203,790 |
| JianyingShotSplit | 4 | 4 | 4 | 12,290,325 |
| JianyingTracking | 2 | 2 | 2 | 791,395 |
| JianyingBasicVideo | 8 | 8 | 8 | 16,522,451 |
| 合计 | **69** | **全局去重 64** | **69** | 不以总大小判断模型数量 |

边界说明：

- Filter 中已有 GRU、saliency 和 single-object 等资产；跨目录统计必须去重。
- ShotSplit 快照含新旧两对网络；当前 `SHOT_SPLIT_MODEL_RELATIVE_PATHS` 指定 `_new` 两份，不能按快照四份称为当前用了四个分镜网络。
- 53 是 Filter 模型目录的数量，不是全部私有目录总数。上表也没有枚举每个效果包的内嵌模型、所有历史快照和 CoreML 解包产物。
- `JianyingSaliency/current/manifest.json`、`JianyingTransition/current/manifest.json` 本次未找到，故没有作为完整清单加入上表；这不等于它们的所有目录或 fallback 资产都不存在。
- `person-segmentation.tflite` 为 **16,371,837 字节**，SHA-256 为 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`，另计，不在私有 64 个哈希中。
- `git ls-files` 检查 `.onnx/.tflite/.bytenn/.pt/.model/.bin/.param/.mlmodel*`，本代码基线只返回上述 TFLite。私有模型不应写入本次文档分支。

当前 readiness 调用结果：

| 检查 | 结果 | 不能推导什么 |
| --- | --- | --- |
| `resolveRifeHost()` | unavailable，当前工作区未找到固定程序和 `rife-v4.6` | 不代表其他 worktree 或已发布安装包也缺失 |
| `inspectTorchEngine()` | unavailable，缺少 `.local/jianying-shot-split/params2` 层表 | 在此处已短路，**没有据此判定机器未装 torch** |
| 模型文件 hash | 上表 69/69 匹配清单 | 不证明依赖库 ABI、GPU、输入输出和产品 E2E 可用 |
| 系统 Git | 默认入口报 Xcode license 未接受 | 本轮改用 Command Line Tools Git；没有接受许可，也没有尝试补编译所有原生桥 |

本分支的 torch 实现仍读取私有 `.bytenn` 和本地导出层表。其他项目即使已经生成可移植 `.pt` / ONNX，也不能说最新 QCut master 已合入该能力。

同日后续研究已增加 [批量 PyTorch 转换工具与验证记录](../../../research/local-model-pytorch/README.zh-CN.md)：
69 条资产记录、64 个唯一文件中，分镜两网络重新导出，另新增皮肤分割、骨骼、视频对象分割三网络，共 4 个本机 `.pt`。
三个新网络完成 22 组新运行的 CoreML CPU 同张量对照；分镜使用已有原生探针记录回归。
这是第一阶段快照；第二阶段已进一步降低未通过数量，见页首链接。
这不改变本节对生产链路的审计结论：新工具尚未接回 QCut 编辑器，私有权重不入 Git。

## 7. 本轮测试与后续真实验收

已运行 **9 个测试文件，60 个用例全部通过**：

```sh
bunx --no-install vitest run \
  electron/__tests__/rife-bridge.test.ts \
  electron/__tests__/jianying-shot-split-compare.test.ts \
  electron/__tests__/jianying-shot-split-torch-engine.test.ts \
  electron/__tests__/jianying-shot-split-runtime-assets.test.ts \
  electron/__tests__/jianying-shot-split-bridge-output.test.ts \
  electron/__tests__/person-cutout-model-router.test.ts \
  electron/__tests__/person-cutout-model-route-fallback.test.ts \
  electron/__tests__/person-cutout-video-object-coreml-runtime.test.ts \
  electron/__tests__/qcut-audio-runtime.test.ts
```

这些测试主要验证路径、合同、路由、哈希/schema 校验、结果解析和失败回退；**不是 15 个模型都做完真实推理的 E2E**。

后续按以下矩阵提升证据，不以 mocked 测试代替可见结果：

| 类别 | 最小真实验收 |
| --- | --- |
| MediaPipe | 真实人物、无人、多人、透明边缘；确认预览/导出 Alpha 与断网执行 |
| RIFE | 先 staging 固定版本；短片 24->48 fps，检查帧数、时长、音画同步及失败不伪装成功 |
| 分镜 | 准备层表或可移植资产；`bridge/torch/both` 同输入比较切点、概率和长视频内存；无切点、坏文件、取消也要覆盖 |
| GRU / VideoObject / Saliency | 分别强制路由，记录真实 backend 和 fallback；检查逐帧 alpha、预览/导出、重开及断网；实验路径单列结果 |
| 美颜 / 美体 | 18 包逐项覆盖，记录实际加载模型哈希；0/中/高强度、单人/多人/无人、素材切换和 seek 后重置；保存前后帧与差分 |
| Bingo | 双向跟踪、遮挡、丢失、重新获取；确认实际传入 `.dat`，不借缓存中的 single-object 模型冒充另一后端验收 |
| 动态滤镜 | 每个新增逻辑名必须闭合资源卡、resolver、推理输出、预览及导出；缺模型明确报告，不静默替换语义 |

## 8. 接下来应补什么

1. **统一模型依赖登记表**：为每个逻辑模型记录 `family / kind / physical asset / sha256 / provider / platform / consumers / readiness / evidence / distribution policy`。`kind` 区分 neural、script、geometry、shader、unknown、system-managed，避免再次把文件数当网络数。
2. **统一只读 doctor**：检查文件、固定哈希、runtime ABI、设备和必要层表；默认不编译、不下载、不访问云端。RIFE、torch 等 missing 原因保留到 UI/CLI。
3. **资源级动态依赖闭包**：从效果包 `model_names` / `model_name` 生成依赖，实际运行时补回 resolved hash，不能只检测一个 `tt_skin_seg*.model` 就称整组美颜 ready。
4. **独立性拆成三栏**：QCut 自有调用代码、可独立使用的推理后端、可分发权重。PyTorch 重写和 CoreML 解包都没有自动改变原权重来源；私有文件保持仓库外，不据此承诺公开分发权限。
5. **统一真实推理探针**：输出输入哈希、模型哈希、backend、设备、张量 shape、耗时、回退原因、输出哈希及代表帧。测试和 UI 可以共同消费这份证据。

最优先的工程缺口不是继续增加模型名，而是把现有依赖的“已接入、已安装、能推理、能导出、可分发”五种状态准确展示出来。
