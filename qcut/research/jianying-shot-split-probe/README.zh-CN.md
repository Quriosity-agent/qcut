# 剪映「智能镜头分割」研究（可脱离剪映使用）

> 研究日期：2026-09-14 · 剪映专业版 macOS 11.3.0（`com.lemon.lvpro`）· 只做静态取证与本机私有快照，不解密草稿、不分发任何剪映文件。

这个目录让镜头分割的研究不再依赖装着剪映的机器状态：`snapshot-private-runtime.sh` 把 23 个运行库、4 个镜头检测模型和 2 份算法图配置复制到 QCut 的私有运行时目录（`~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current`，SHA-256 清单，`localOnly`），之后 `extract-symbols.sh`、`tools/` 里的反汇编与虚表工具全部只读这份快照。快照、导出符号、反汇编产物都在仓库之外或 `.local/jianying-shot-split/`（已 git-ignore）。

## 1. 结论

剪映的智能镜头分割 = **端侧 ByteNN 两段神经网络镜头边界检测器**，不联网推理。

| 参数（`Contents/Resources/SceneEditDetection/config.json`） | 现行值 | 上一代 `config_prev.json` |
|---|---|---|
| 输入帧缩放（`blit` 节点） | 96 × 96 | 128 × 128 |
| 主干网 `compress_shot_detect_backbone_model_name` | `jy_compressShotDetectBackbone_new`（2.3 MB `.bytenn`） | `jy_compressShotDetectBackbone`（4.1 MB） |
| 预测头 `compress_shot_detect_predhead_model_name` | `jy_compressShotDetectPredHead_new`（1.2 MB） | `jy_compressShotDetectPredHead`（4.7 MB） |
| 帧特征维度 `compress_shot_detect_img_feat_dims` | 128 | 未显式给出 |
| 滑动窗口 `compress_shot_detect_sliding_window_size` | 7 帧 | 11 帧 |
| 后处理阈值 `compress_shot_detect_post_process_threshold` | 0.35 | 0.35 |

图结构：`input_0`（blit，缩放）和 `input_1`（`array_buffer_producer`）两路进 `compress_shot_detect_0` 节点（`"mode": 2`）。
推理形状：每帧缩到 96×96 → 主干 CNN 输出 128 维向量 → 连续 7 帧向量进预测头 → 该帧为切点的概率 → 大于 0.35 判为镜头边界 → 结果里 `frame_received` / `predict_result` 两个键 → 按帧计数映射回媒体时间 → (start, end) 区间列表。这是 TransNet 一族的结构。"compress" 指小输入小模型，不是压缩域。

## 2. 调用链（符号细节见 [SYMBOLS.md](./SYMBOLS.md)）

1. 右键菜单 `split_by_clip_point`（文案「智能镜头分割」）→ 剪辑流程 agent 节点 `SmartShotVideomixNode`。
2. `cutpoint::CutPointDetection::Run(路径, 起点, 终点)`，带阻塞进度窗；回调 `(progress, done, LvVideoAutoSplitResult)`。
3. `lvve::MediaAlgorithmWin::videoAutoSplit` → VESDK `VEVideoAutoSplitImpl` 建图：抽帧 → `TEVideoAutoSplitUnit` → `TEBachVideoAutoSplit`（`Bach::BachAlgorithmFactory::CreateAlgorithmSystem()` → `init` → `initGraph(config.json)`；逐帧 `execute`；末帧 `getResult` → `predict_result`）→ `mapFrameCnt2MediaTime`。
4. 时间线片段走 `ApplyCutOnSegment` 逐段切；素材面板走 `CreateSubClipMedia`。
5. 网络只拉该工具的远端描述配置（`SmartShotVideomixTool missing descriptor config from remote tool config`）；AB 开关 `ve_enable_cut_point_fps_opt`（本机 true）、`smart_cut_frame_enable_interval`。

## 3. 目录内容

| 文件 | 作用 |
|---|---|
| `snapshot-private-runtime.sh` | 从 `/Applications/VideoFusion-macOS.app` 复制运行库、模型、配置到私有运行时目录并写 `manifest.json`（幂等；无剪映时拒绝运行） |
| `extract-symbols.sh` | 只读快照：`lipo` 出 arm64 切片，导出 `exports.sorted`、全量 `strings`、镜头检测相关字符串、`Bach::BachAlgorithmSystemGE` 虚表、`TEBachVideoAutoSplit` 与两个 `bef_bach_*` C 入口的注释反汇编 → `.local/jianying-shot-split/` |
| `tools/disasm.py` | 区间反汇编 + 字符串字面量/导出符号/虚表槽注释（`llvm-objdump`，arm64 thin 切片） |
| `tools/vtable.py` | 按虚表地址列出每个槽的符号名 |
| `compare-cutpoints.mjs` / `.test.mjs` | 两份切点列表按容差比对（精确率/召回率/平均偏差），吃 QCut `analyze/:pid/scenes` 的返回或纯数组 |
| `watch-shot-split.sh` | 用户在剪映里点一次「智能镜头分割」时，在旁边抓 90 秒：打开的模型/缓存文件、CPU、网络字节、CoreML/AlgorithmCache 目录变化 |

复现：

```bash
cd research/jianying-shot-split-probe
npm run snapshot     # 一次性；之后可卸载剪映或升级也不影响研究
npm run symbols      # 从快照重新生成符号与反汇编证据
npm test             # 切点比对工具的单元测试
```

## 4. 还没定下的、以及下一步

**未知**（都在代码常量里，字符串抓不到，需要实机一次或继续反汇编）：抽帧采样率（`input_to_bach_frame_num`、fps 优化开关）、最短镜头合并规则、Mac 上 ByteNN 是走 CPU 还是转成 CoreML/神经引擎（`ve_enable_bach_npu_model`；若转换会在 `~/Library/Containers/com.lemon.lvpro/Data/Library/Caches/com.lemon.lvpro/bach_private_cache/coremlModels_*/` 留下带 `model.espresso.net` 层图的 `.mlmodelc`）。运行 `watch-shot-split.sh` 同时在剪映里点一次即可全部拿到。

**脱离剪映跑真模型（桥接）的路线**，按取证可行性排序：

1. **VESDK C++ 路线**（已摸清的部分最多）：`dlopen` 快照里的 23 库 → `Bach::BachAlgorithmFactory::CreateAlgorithmSystem()`（导出）→ 通过虚表槽 2/3 调 `init(BachInitConfig)`、`initGraph(config.json)`（`BachInitConfig` ≈ `{资源查找器指针, string, string}`，查找器由 `TEEffectFinderClient::getResourceFinder` 或 `bef_bach_resource_finder_create` 提供）→ 槽 5 `execute(BachAlgorithmInput)` 逐帧喂 96×96 之前的原始像素（executeFrame 里是 `{buffer, count=1}` 的单元素输入，像素格式枚举 <4，pts 秒）→ 末帧前 `setParams(compress_shot_detect_is_last_frame)` → 槽 6 `getResult(COMPRESS_SHOT_DETECT)` → `predict_result`（`PrimitiveVector<int>`）。还缺：`BachInitConfig` / `BachAlgorithmInput` / 图像缓冲的精确内存布局（要继续读 `disasm-executeFrame.txt` 0x203ce68–0x203cf50 和 Impl 侧实现）。
2. **EffectSDK C 路线**：`bef_effect_create` + `bef_effect_init_with_resource_finder`（查找器签名 `char* (*)(void*, const char* dir, const char* name)`，与 `research/jianying-runtime-probe/effect-probe.mm` 相同）→ `bef_bach_get_graph(handle, config.json, view_w, view_h, …)` → `bef_effect_algorithm_buffer` 逐帧 → `bef_effect_algorithm_cap_get_algorithm_result_serialize`。参数语义只从字符串推断，未验证。
3. **不依赖剪映权重的复刻**：同样的管线形状（小图嵌入 → 滑窗分类 → 阈值 → 合并）用 TransNetV2 的开源权重（ONNX）实现，再用 `compare-cutpoints.mjs` 对着剪映导出的切点校准阈值。这是能进产品的路线；`.bytenn` 权重不可分发。

## 5. 红线

- 快照目录、`.local/jianying-shot-split/` 里的导出符号与反汇编都是剪映衍生物：不进 Git、不上传、不进产品分发。
- 不解密加密草稿；结果比对只用 UI 导出或 `inspect` 得到的数据。
- QCut 现有的「智能镜头分割」入口（右键 → `analyze.scenes` → FFmpeg `select='gt(scene,0.3)'`）与本研究无关，是帧差分数方案。
