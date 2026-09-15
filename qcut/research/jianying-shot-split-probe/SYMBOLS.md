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

## 6. Bach::BachAlgorithmSystemGE::Impl 虚表（0x3614ea8，槽位与 GE 相同）

| 槽 | 地址 | 说明 |
|---|---|---|
| 5 | 0xc6bdd4 | `Impl::execute(const BachAlgorithmInput&)`：读 `input+0x08` 类型；3 = 已是内部列表；1/2 = 单缓冲，按 `src_array_0`/`src_data_0` 键包成内部列表后尾跳到 `_execute`（0xc6bedc） |
| — | 0xc6bedc | `_execute`：按类型 0..7 跳表分派；type 1 分支读 `+0x18` 数据、`+0x20` count（日志 `src resolution … 1xcount`），随后进图执行 |

键字符串：`Bach::_SRC_DATA_KEY_0_ = "src_data_0"`，`Bach::_SRC_ARRAY_KEY_0_ = "src_array_0"`。
结果读取：`getResult(AlgorithmType 182)` → 容器 `[+0x18,+0x20)` → 首项 `+0x10` 是 `unordered_map<std::string, {…, BachObject @+0x28}>`（libc++ 节点：值在节点 `+0x28`）；`BachObject` 标量值在 `+0`、类型标记在 `+0x80`（31 = 整数，14 = 向量，向量 payload 指向 `AmazingEngine::PrimitiveVector<int>` 实现，元素区间 `[+0x10,+0x18)`）。

## 7. ByteNN（libbytenn.dylib，未剥符号，2026-09-15 补）

推理引擎在 `libbytenn.dylib`，**符号完整导出**，不需要逆向就能调用。文件地址即 vmaddr（`__TEXT` vmaddr = fileoff = 0）。
`dlsym` 时要去掉 `nm` 显示的前导下划线。

| 符号 | 文件地址 | 说明 |
|---|---|---|
| `IESNN::Net::CreateNetFromFile(const char*)` | 0x7ff94 | 给路径即可独立加载 `.bytenn`，返回 `Net*`（已实测可用） |
| `IESNN::Net::GetIESNet() const` | — | 取内部网络对象（内部布局未导出） |
| `BYTENN::EngineFactory::Create()` | — | libcccreator 实际用的入口，返回 `shared_ptr<ByteNNEngine>`（sret 走 x8） |
| `BYTENN::ByteNNEngineImpl::GetNetwork()` | 0xfbf8 | 引擎 → `LabNetWork*` |
| `BYTENN::LabNetWork::GetLayers()` | 0x2eb00 | 层数；实现是 `ldr x0,[x0,#0x40]` 后尾调 `Thrustor::getLayers` |
| `BYTENN::LabNetWork::GetLayerName(int)` | 0x2eaf8 | 层名，返回 `std::string`（sret） |
| `BYTENN::LabNetWork::GetWeight(const std::string&, Tensor*)` | 0x29868 | 按名取权重；**推理态对所有层名都返回 5 且 data 为空** |
| `BYTENN::LabNetWork::SaveModel(void*)` | 0x29838 | 返回 0 但不按传入路径落盘，参数含义未知 |
| `bytenn_cpu::Thrustor::GetWeightLen()` | 0x13a73c | 权重区总长（backbone 2,307,592；predhead 1,212,940） |
| `bytenn_cpu::Thrustor::GetWeight(const std::string&)` | 0x13a804 | 返回 32 字节 Tensor：`+0x00` data，`+0x08..0x17` 四维（源 `+0x24` 经 `st2.2s` 交错为 a,c,b,d），`+0x18/+0x1c` 两个 int |
| `vtable for BYTENN::ByteNNEngineImpl` | 0x4a8190 | 用于在内存里按 `vtable+16` 认出引擎对象 |
| `bytenn_cpu::Thrustor::Extract(const std::string&)` | 0x13a974 | **按 blob 名取该层算出来的张量**(sret)。推理后只有形状唯一的缓冲区还是真值,内存池会复用 |
| `bytenn_cpu::ThrustorGetInput(Thrustor*)` | 0x13b6f8 | 取网络真正看到的输入张量(sret);实现就是取输入名后尾调 `Extract` |
| `bytenn_cpu::Thrustor::SetSubNet(vector<TextureLayerOutput>*, vector<TextureLayerOutput>*)` | 0x13ac1c | 可把网络截断到指定 blob 做输出 —— 逐层拿真值的下一步,`TextureLayerOutput` 布局待查 |
| `bytenn_cpu::Thrustor::getOutput()` | 0x13afb0 | 网络输出(sret) |
| 层表构造函数（内部） | 0x1fedec | `fn(out, impl+0x80)` 产出 `{begin,end}`；元素 16 字节，首字是层指针 |

层对象字段（`Thrustor` 在 `LabNetWork+0x40`，其 impl 在 `Thrustor+0x08`）：

| 偏移 | 内容 |
|---|---|
| +0x00 | 虚表指针（libbytenn 内） |
| +0x18 | 层名 `std::string` |
| +0x30 | 层类型 `std::string`：`Convolution` / `DepthwiseSeparableConvolution` / `GRU` / `Concat` / `Transpose` 等 |
| +0x118 | 卷积核 (kh, kw) |
| +0x140 | 通道 (in, out) |
| +0x158 | 输入尺寸（首层 96×96） |

调用约定:`Extract` / `ThrustorGetInput` / `getOutput` 都用 sret(隐藏指针走 x8)。在 C 里把返回类型声明成
一个大于 16 字节的 POD(比如 `struct { unsigned char raw[256]; }`),编译器就会自动按同一套 ABI 传,
实际 `Tensor` 只有 32 字节:`+0x00` data,`+0x08..0x17` 四维(NHWC),后面两个 int。
`Tensor::GetByteSize()` 对 `Extract` 返回的张量给 0(它读的 dtype 字段在推理态没填),按四维自己乘。

模型文件头(未加密,图定义区加密):`+0x04` 文件总长,`+0x0c`/`+0x10` 图定义区长度/偏移,
`+0x14`/`+0x18` **权重区长度/偏移**。权重区开头 8 字节是它自己的头,之后是明文小端 float32,
逐层「权重(OHWI:cout,kh,kw,cin)+ 偏置」。

### 7.1 逐层真值:虚表钩子(`layer-trace.mm`)

卷积层虚表(所有卷积类层共用一张,含深度卷积)上,**槽位 18、19、5 每层每帧各调用一次,顺序 18 → 19 → 5**;
在这三个槽都挂钩、每次返回后 `Thrustor::Extract(层名)`,后调用的覆盖先调用的,留下的就是 forward 完成后的输出。
其余层类型的虚表在同样槽位挂同样的钩子即可(10 种层类型)。虚表所在页用 `vm_protect(... VM_PROT_COPY)` 改成可写。

blob 名不总等于层名。预测头 GRU 相关的 blob(从层对象里扫字符串得到):

| blob | 形状(NHWC) | 含义 |
|---|---|---|
| `GRU_8.out` / `GRU_11.out` | 1,1,7,128 | 两个 GRU 的输出 (T, H) |
| `GRU_8_Transpose_to_BHT.out` | 1,1,7,128 | GRU 输入的内部布局 |
| `GRU_11_Reshape_to_BDHT.out` / `GRU_11_0` | 1,7,128,1 / 7,128,1,1 | 输出回到 ONNX 布局的中间态 |
| `GRU_*_concat_blob` `_rz_blob` `_z_blob` `_r_blob` `_n_blob` `_trn_in_blob` `_trn_out_blob` | 未导出 | 内核结构:r、z 门对 `[x|h]` 拼接输入做一次融合 GEMM,n 门单独算(linear_before_reset) |

### 7.2 后处理函数(libcccreator,0xcc7844 ~ 0xcc79b4)

`compress_shot_detect_post_process_threshold` 的字符串在 0x300cd16,被 0xcc7ec0 读入算法对象 `+0x408`(float);唯一读取处 `0xcc78f4: ldr s3, [x20, #0x408]`。

| 算法对象偏移 | 内容 |
|---|---|
| `+0x400` | 滑窗大小(7);半宽 `(7+1)/2 = 4` |
| `+0x408` | 后处理阈值(0.35) |
| `+0x440` / `+0x448` | `vector<float>` P:每帧切点概率(喂入第 7 帧起,每帧一个) |
| `+0x458` | `vector<float>` Q:当前帧与前一帧 96x96 RGB uint8 缩放图的逐字节平均绝对差(0xcc73f0~0xcc7450 计算,`fabd` 累加 / `3·w·h`;第一帧不推) |
| `+0x478` | 首帧标志 |
| `+0x480` | 上一帧 96x96 RGB uint8 缓冲 |

常数 `0x2c46c40`(double)= 0.1,用于判断极值两侧概率是否"平"。规则本身见交接文档 5.4。结果通过 `frame_received` / `predict_result`(0x301b0a2 / 0x301b0b1)写出,读取端是 `TEBachVideoAutoSplit::getBachResult`(0x203bc24)。

配置键 `compress_shot_detect_model_forward_type` 在 0xcc7a00 被读进 w23（intParam 在算法对象 `+0x88`，unordered_map，值在节点 `+0x28`），
但 w23 直到函数收尾都未被使用 —— **死代码**，改它不会切到 CoreML 后端。
