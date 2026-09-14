# 剪映「智能镜头分割」研究（可脱离剪映使用）

> 研究日期：2026-09-14 · 剪映专业版 macOS 11.3.0（`com.lemon.lvpro`）· 只做静态取证与本机私有快照，不解密草稿、不分发任何剪映文件。

这个目录让镜头分割的研究不再依赖装着剪映的机器状态：`snapshot-private-runtime.sh` 把 23 个运行库、4 个镜头检测模型和 2 份算法图配置复制到 QCut 的私有运行时目录（`~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current`，SHA-256 清单，`localOnly`），之后 `extract-symbols.sh`、`tools/` 里的反汇编与虚表工具全部只读这份快照。快照、导出符号、反汇编产物都在仓库之外或 `.local/jianying-shot-split/`（已 git-ignore）。

> **接手请先读 [HANDOVER.zh-CN.md](./HANDOVER.zh-CN.md)**：现状、怎么跑、模型结构、权重进展、已走死的路,都在那一份。

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
| `shot-split-bridge.mm` / `build-bridge.sh` / `detect-cuts.sh` | 脱离剪映跑真模型的桥接与命令行封装（第 4 节）；`.mm` 也是 QCut `analyze shots` 按需编译的源码 |
| `bytenn-probe.mm` | 只用 ByteNN 自己导出的接口加载 `.bytenn`(`IESNN::Net::CreateNetFromFile` 已实测可用),各尝试放 fork 子进程,崩溃不影响其余 |
| `weight-dump.mm` | 加载后在进程内按引擎虚表定位对象,走 `GetNetwork`/`GetLayers`/`GetLayerName` 导出网络结构;权重数值尚未导出,见交接文档第 5 节 |
| `extract-weights.py` | 早期的离线权重提取(按「浮点看起来合理」扫描切段)。**已被 `arena_weights.py` 取代**:那套扫描会在大权重处断开,切出来的层是错的,只留作历史记录 |
| `feature-dump.mm` | 加载后喂帧,用 `Thrustor::Extract` 取引擎**自己算出来的**逐层张量、用 `ThrustorGetInput` 取网络真正看到的输入;复现对拍的基准就来自这里(注意内存池复用,只有形状唯一的缓冲区可信,见交接文档 5.1) |
| `arena_weights.py` | 按已验证的布局从 `.bytenn` 直接切权重:起点 16069、576896 个 float、逐层「权重(OHWI)+ 偏置」 |
| `torch_backbone.py` / `torch_compare.py` / `torch_check.py` | PyTorch 复现主干、与引擎张量对拍、在已知切点的素材上做行为验证 |
| `compare-cutpoints.mjs` / `.test.mjs` | 两份切点列表按容差比对（精确率/召回率/平均偏差），吃 QCut `analyze/:pid/scenes` 的返回或纯数组 |
| `watch-shot-split.sh` | 用户在剪映里点一次「智能镜头分割」时，在旁边抓 90 秒：打开的模型/缓存文件、CPU、网络字节、CoreML/AlgorithmCache 目录变化 |

复现：

```bash
cd research/jianying-shot-split-probe
npm run snapshot     # 一次性；之后可卸载剪映或升级也不影响研究
npm run symbols      # 从快照重新生成符号与反汇编证据
npm test             # 切点比对工具的单元测试
```

## 4. 脱离剪映跑真模型：已跑通（2026-09-14）

`shot-split-bridge.mm` 用快照里的运行库直接驱动 Bach 的 `COMPRESS_SHOT_DETECT`，不启动剪映：

```bash
cd research/jianying-shot-split-probe
npm run snapshot            # 一次性
npm run build-bridge        # clang++，rpath 指向快照 Frameworks
./detect-cuts.sh some.mp4 24   # → {"fps":24,"frames":288,"cutFrames":[71,143,215],"cutPoints":[3.0,6.0,9.0]}
```

QCut CLI 已接入同一条链路（`electron/jianying-shot-split/`，命令 `analyze-shots`）：校验快照清单与逐文件 SHA-256、
按需把本桥编译到 `~/Library/Caches/QCut/JianyingShotSplitBridge/`、ffmpeg 经命名管道流式喂帧（不落盘），桥在
`sandbox-exec` 断网沙箱里跑：

```bash
qcut analyze shots -i some.mp4 --json          # cut_points / cut_frames / shots
qcut analyze shots --check --json              # 快照与桥是否就绪
```

五个里程碑逐一实机验证：

| 里程碑 | 做法 | 结果 |
|---|---|---|
| M1 加载闭包 | `dlopen` 快照 `Frameworks/libcccreator.dylib`（`@rpath` 依赖靠 `-Wl,-rpath`） | OK |
| M2 建系统 | 导出符号 `Bach::BachAlgorithmFactory::CreateAlgorithmSystem()` | OK，Bach SDK 22.1.0 |
| M3 init | 自写资源查找器（虚表 7 槽：2 = `findResource(BachAlgorithmModel&)` 读文件填 `data/length/path`，6 = `findResourcePath(const char*)`，其余空实现）+ `BachInitConfig{finder, appName, ""}` → 虚表槽 2 | OK |
| M4 图与模型 | 槽 3 `initGraph(config.json 路径)` → 槽 32 `loadModel()`；查找器按裸名 `jy_compressShotDetectBackbone_new` 解析成 `<name>_v1.0_size0.bytenn` | 两个模型加载成功，**ByteNN CPU 后端**（"Run ByteNN with CPU forward type"，backend 0），Metal 只给 blit 节点 |
| M5 喂帧 / 读结果 | 输入对象照 `TEBachVideoAutoSplit::executeFrame` 的布局复刻（下表），逐帧槽 5 `execute`；EOF = 1×1 四字节零缓冲、`count=0` 的一帧；槽 6 `getResult(182)` → 结果容器 `[+0x18,+0x20)` 首项 → `+0x10` 的 `unordered_map<string,…>` 里 `frame_received`（BachObject type 31，值 1）和 `predict_result`（type 14，payload 指向 `PrimitiveVector<int>` 实现，元素在 `[+0x10,+0x18)`） | 288 帧 149 ms（≈0.5 ms/帧），`predict_result=[71,143,215]` |

输入契约（`Bach::BachAlgorithmInput`，`+0x08` 类型必须是 **1**；0/2/3 分别是别的缓冲类型，会走纹理路径或崩溃）：

```
input  +0x00 vptr(复用 TE 的 0x36c5d58，只有虚析构)  +0x08 int type=1  +0x10 ImageBuffer*  +0x18 const void* pixels  +0x20 int count(1；EOF 为 0)
image  +0x00 vptr(0x36c4840)  +0x0c int width  +0x10 int height  +0x18 pixels  +0x20 rotation=0  +0x24 pixel format(<4；RGBA 用 0)  +0x30 double timestamp 秒
```

`predict_result` 的每个整数是**镜头最后一帧的索引**（切点在它和下一帧之间），Bach 日志里那句 `src resolution 1x1` 是 type 1 分支把 `count` 当高度打的，不影响推理。

### 用它测出来的模型行为

| 实验（合成夹具，24 fps） | 结果 |
|---|---|
| 3 个硬切（3/6/9 s） | 71/143/215 → 3.000/6.000/9.000 s，全中 |
| 同一夹具降到 12 fps | 35/71/107 → 3.0/6.0/9.0 s，仍全中 |
| 降到 6 fps | 17/36/53 → 3.0/6.17/9.0 s，开始抖动（7 帧滑窗在低帧率下变粗） |
| 1 s 叠化（xfade fade） | **没有**报边界：阈值 0.35 下渐变转场漏检 |
| 0.25 s 短镜头（6 帧） | 报了前后两个切点，模型层**不合并**短镜头 |
| 3 帧闪白 | 报了闪白进出两个切点，模型层**不抑制**闪光 |

所以剪映产品里若有最短镜头合并或闪光抑制，是在 VESDK/UI 层做的，不在模型里；抽帧采样率仍需实机抓取（模型对 12 fps 已足够，估计产品在 10–24 fps 之间）。

### 还没做的

- 抽帧采样率、最短镜头合并规则：`watch-shot-split.sh` 在剪映里点一次即可确认（两次窗口内用户未触发）。
- 结果对象是直接按内存偏移读的，换剪映版本要用 `extract-symbols.sh` 重新核对 `SYMBOLS.md` 里的地址（bridge 里 `k*FileAddr` 常量）。
- 产品化仍走 TransNetV2 复刻路线（`.bytenn` 权重不可分发）；本桥接只做参照/校准。

## 5. 红线

- 快照目录、`.local/jianying-shot-split/` 里的导出符号与反汇编都是剪映衍生物：不进 Git、不上传、不进产品分发。
- 不解密加密草稿；结果比对只用 UI 导出或 `inspect` 得到的数据。
- QCut 现有的「智能镜头分割」入口（右键 → `analyze.scenes` → FFmpeg `select='gt(scene,0.3)'`）与本研究无关，是帧差分数方案。
