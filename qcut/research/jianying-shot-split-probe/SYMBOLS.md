# 智能镜头分割符号地图（剪映专业版 11.3.0，libcccreator arm64 UUID 100726E3-FCB0-31BC-98EE-1B196A1714A3）

地址是 `libcccreator.dylib` arm64 切片内的虚拟地址（该切片 `__TEXT` 的 vmaddr 与文件偏移相同）。
换版本后先用 `extract-symbols.sh` 重新生成，再对照本表；UUID 不同则地址作废，名字仍可用于 `nm`。

## 1. 三层调用链

| 层 | 符号 | 说明 |
|---|---|---|
| UI / agent 节点（libVECreator） | `clipflow::shell::SmartShotVideomixNode` / `SmartShotVideomixNodeImpl::RunDetectionWithBlockingUI(path, start, end, QWindow*, cb(vector<pair<int64,int64>>), …)` | 右键菜单 `split_by_clip_point`，阻塞进度窗 |
| 切点模块（libVECreator） | `cutpoint::CutPointDetection::Run(path, start, end)` → 回调 `(float progress, bool done, shared_ptr<lvve::LvVideoAutoSplitResult>)`；`CreateSubClipMedia`（素材面板）、`ApplyCutOnSegment`（时间线）；`DELETE_ADJOIN_CUT_POINT`、`prevCutPoint/nextCutPoint` | 结果是 (start,end) 区间列表 |
| LV 封装（libvideoeditor） | `lvve::MediaAlgorithmWin::videoAutoSplit(const VECommonParam&, cb, errCb)`；日志 `videoAutoSplit failed: VESDKModule not initialized / createAlgorithm returned null` | |
| VESDK（libcccreator） | `createAlgVideoAutoSplit` → `vesdk::VEVideoAutoSplitImpl`（`correctParameters`、`configExtractFrameBinParam`、`alg_video_auto_split`）→ 图：抽帧 bin → `TEVideoAutoSplitUnit`（`video_auto_split_process_255`）→ `TEBachVideoAutoSplit` | `bach_config_path` = SceneEditDetection/config.json |
| Bach 算法（libcccreator） | `AlgorithmCompressShotDetct`（源码路径 `bach/Algorithm/CompressShotDetct/src/BachAlgorithmCompressShotDetct.cpp`），类型 `COMPRESS_SHOT_DETECT`，结果类型 `COMPRESS_SHOT_DETECT_RESULT` | 两个引擎 `m_engine_backbone` / `m_engine_pred_head`（ByteNN） |

## 2. TEBachVideoAutoSplit（导出的 C++ 方法）

| 地址 | 方法 | 作用（来自注释反汇编 `.local/jianying-shot-split/disasm-*.txt`） |
|---|---|---|
| 0x203b7e8 | `initBachSystem(TEBachAlgorithmParam&, std::string)` | `Bach::BachAlgorithmFactory::CreateAlgorithmSystem()` → `TEEffectFinderClient::getResourceFinder` 包成资源查找器 → 栈上构造 `BachInitConfig{finder, string, string}`（两个字符串来自 param+0x8 / +0x20）→ 虚表槽 2 `init(config)` → 槽 3 `initGraph(第二个参数字符串)`；失败日志 `processor create bach system failed / bach system initialize failed / initialize graph failed / finder is nullptr` |
| 0x203bc24 | `getBachResult(Bach::BachAlgorithmSystem*, bool)` | 从结果缓冲取 `frame_received` 与 `predict_result`（`Bach::BachObject → PrimitiveVector<int>`），`postProcessMediaTime`、`mapFrameCnt2MediaTime`（按帧计数查媒体时间表），日志 `VAS processor R algorithm result / pair result / mapped result` |
| 0x203cbb4 | `executeFrame(shared_ptr<ITEVideoFrame>)` | `TECVPixelBufferGetRawData` 取原始像素 → 帧虚表槽 16 取像素格式（要求 <4）、槽 28 取 pts（÷1e6 成秒）→ 组装单元素输入（栈上 {buffer, count=1}）→ 系统 `execute`；`teRotateMode2bachRotateMode`；把 (帧计数, pts) 记进哈希表供结果映射 |
| 0x203d2b8 | `processFrame(shared_ptr<ITEVideoFrame>*, unsigned)` | 逐帧调 `executeFrame`，末帧后 `getBachResult`；日志 `REOF total cost` |
| 0x203d510 | `getAlgoResult(const std::string&, TEAny&)` | 对外取结果 |

## 3. Bach::BachAlgorithmSystemGE 虚表（`__ZTVN4Bach21BachAlgorithmSystemGEE` @ 0x3615128）

| 槽 | 方法 |
|---|---|
| 2 | `init(const Bach::BachInitConfig&)` |
| 3 | `initGraph(const std::string&)` |
| 4 | `removeGraph()` |
| 5 | `execute(const Bach::BachAlgorithmInput&)` |
| 6 | `getResult(const Bach::AlgorithmType&)` |
| 7 / 8 | `enable(AlgorithmType, bool)` / `enable(string, bool)` |
| 9–14 | `setParams(...)`（按类型或节点名，int/float/string 三种映射） |
| 15 | `getResult(const std::string&)` |
| 16–18 | `setParams(unordered_map …)` |
| 19 | `clearResults()` |
| 20–22 | `getParam(...)` |
| 23 | `getAlgorithmConfigName(...)` |
| 24 | `getModelNames()` |
| 25 | `initGraphWithRootPath(string, …)`（读 `<root>/algorithmConfig.json` 或 `.json` 路径，`AmazingEngine::FileUtils::readFile`） |
| 26 / 27 | `setCacheFolder(string)` / `setBachCacheEnable(bool)` |
| 28 | `getErrors(vector<BachSystemExeError>&)` |
| 29 | `getInfo(string, …)` |
| 30 / 31 | `registerCallback` / `unregisterCallback` |
| 32 | `loadModel()` |
| 33 | `sendMessage(string, …)` |

导出的工厂：`Bach::BachAlgorithmFactory::CreateAlgorithmSystem()` / `DestroyAlgorithmSystem(BachAlgorithmSystem*)`。
`GE` 类的每个方法都是转发到 pimpl（`ldr x8,[x0,#8]; ldr x0,[x8]; … br`），真正实现在 `Impl` 里（未导出）。

## 4. EffectSDK C 入口（bef_effect_bach_api.cpp，"EffectSDK-2200"）

| 符号 | 地址 | 观察 |
|---|---|---|
| `bef_bach_resource_finder_create` | 0x1655d40 | 检查 `invalid effect handle`、`finder_handle or helper_handle is not null` → 需要先有 effect handle |
| `bef_bach_resource_finder_destroy` | | |
| `bef_bach_get_graph` | 0x1655f0c | 6 个入参；读 json（`/algorithmConfig.json` 或 `.json` 路径），校验 `view_width / view_height`，解析 `nodes[].type`（识别 `blit` / `texture_blit`），日志 `bef_bach_get_graph algorithmJson json is %s` |
| `bef_effect_add_bach_algorithm_config` | 0x16507c4 | 3 个入参（handle, x1, x2） |
| `bef_effect_algorithm_buffer` | 0x164bc3c | 6 个入参（handle, buf, fmt, w, h, stride…） |
| `bef_effect_algorithm_cap_get_algorithm_result_serialize` 等 `algorithm_cap_*` | | 结果序列化读取 |
| `bef_algorithms_pure_execute_algorithm_by_name` | | 按名执行"纯算法"，尚未验证是否覆盖 compress_shot_detect |

## 5. 配置键（libcccreator 字符串，含义见 README）

`compress_shot_detect_backbone_model_name`, `compress_shot_detect_predhead_model_name`,
`compress_shot_detect_post_process_threshold`, `compress_shot_detect_sliding_window_size`,
`compress_shot_detect_img_feat_dims`, `compress_shot_detect_model_thread_count`,
`compress_shot_detect_model_forward_type`, `compress_shot_detect_is_last_frame`,
`compress_shot_detect_debug_data_save_path`；AB 开关 `ve_enable_cut_point_fps_opt`（本机 true）、
`smart_cut_frame_enable_interval`、`ve_enable_bach_npu_model`。
