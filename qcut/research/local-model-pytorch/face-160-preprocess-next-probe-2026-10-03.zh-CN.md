# actual 160 preprocessing：矩阵之前的路径与下一轮捕获

日期：2026-10-03。范围：`codex/kpop-beauty-v6` 的独立调查；Beauty Lab candidate backend / IPC / UI 由 parent 负责。

## 结论与证据边界

**本轮新增的是静态定位，不是新的运行时捕获。** 没有启动 native host、GPU、Jianying 或 renderer，没有调用 SDK，没有修改现有捕获、50 个 provenance source、app / binary / resources、Git 或 branch。只新增本文。

锁定 arm64 库的可达路径是：

```text
PureDetect
  ConvertToBGR(input Mat, InputParameter.format, owner + 0x7ea8)
  RotateFront(owner + 0x7ea8, InputParameter.orientation, ...)
  FaceAlignmentDet(owner + 0x7ea8, ...)
    ProcessDetectionImage(source Mat, mutable Rect, target W/H, flags, expansion)
      CropObjectRegion -> expanded / padded crop Mat
      resize -> PreProcessor + 0x80 的 output Mat
    从 crop 回写后的 Rect 构造 forward / inverse matrix
    doCnnAlignmentNewPhase2 -> BasePredictDet -> BasePredictor.Predict(output Mat)
    inverse matrix 将网络点映射回 original-image 坐标
```

因此，`forward` 是 **crop 完成之后的端点坐标映射**，不是从原始 RGBA 直接获得 160 tensor 的充分采样定义。下一步优先捕获 `ProcessDetectionImage` 的真实入参、crop 回写及返回像素；不要继续只从 post-predict matrix 猜 ROI。

已有 120 自有采样、160 captured input 上的 ONNX / seed decode、自有 temporal smoothing 和 renderer parity 仍然成立于原先锁定 profile。`independent_160_sampling_input_used=false`、`native_160_sampling_input_required=true`、`product_parity_verified=false` 不变。

## 锁定二进制与符号

本轮检查路径：

```text
/Users/peter/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks/liblens.dylib
SHA-256: fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161
arm64 UUID: 248872F2-7736-32A9-A48B-DC5DFEE20C99
x86_64 UUID: D4523AEB-6699-3937-B560-6BC53782ABB1
```

下表地址均为 **arm64 unslid file address**，不是下一轮进程的绝对地址。运行时必须按同 UUID 模块解析 ASLR；不可沿用 R12 pointer 值。

| 地址 | 符号 / 用途 |
| --- | --- |
| `0x2c4dac` | `FsNew_DoPredict`，原 geometry observer 的 prediction 边界 |
| `0x332830` | `FsNewAlignAlgo::PureDetect` |
| `0x3ed1ac` | `ConvertToBGR` |
| `0x335af8` | `ImgRotate::RotateFront` |
| `0x2d5e18` | `FsNewAlignAlgo::FaceAlignmentDet(Mat const&, InputParameter const&, RunningConfigs const&, FaceConfig const&, RunningTimeInfo&, bool)` |
| `0x2ca3bc` | `PreProcessor::ProcessDetectionImage(Mat const&, Rect_<float>&, int, int, bool, bool, float, bool)` |
| `0x380ff8` | `FsNewUtils::CropObjectRegion(Mat const&, Rect_<float>&, Mat&, MemAllocator&, bool, float, bool)` |
| `0x3b2420` / `0x3b2dd4` | `ImageTransform::setCanonicalAnchors` / `computeTransformForResize` |
| `0x2d5064` / `0x36d0e4` | `doCnnAlignmentNewPhase2` / `PredictorContainer::BasePredictDet` |
| `0x36b280` / `0x36b43c` | `BasePredictorHelperFunc` / 其中调用 `BasePredictor::Predict` 的指令 |
| `0x2ca600` | `ProcessWarpImage`；不要把已验证的 120 路径直接套到 detection crop |

可用于 symbol lookup 的无 Mach-O 额外前缀名称：

```text
_ZN5smash6module5fsnew12PreProcessor21ProcessDetectionImageERKN9mobilecv23MatERNS3_5Rect_IfEEiibbfb
_ZN5smash6module5fsnew10FsNewUtils16CropObjectRegionERKN9mobilecv23MatERNS3_5Rect_IfEERS4_RNS1_12MemAllocatorEbfb
```

**拦截限制：** `FaceAlignmentDet` 的两个 call site 是库内直接 `bl 0x2ca3bc`，不是 dyld symbol stub。给现有 observer 增加同名 `DYLD_INTERPOSE` 并不能证明抓到了这两个调用。下一轮采用只读硬件断点方案；本轮尚未验证 launch 权限、硬件断点能力或 callback。

## 真实 caller 的静态参数来源

令 `A=FaceAlignmentDet.this`、`C=RunningConfigs*`、`F=FaceConfig*`、`T=RunningTimeInfo*`。入口 ABI 为 `x0=A, x1=source Mat, x2=InputParameter*, x3=C, x4=F, x5=T, w6=bool`。

两个 detection-preprocessor 调用共有参数：

| 寄存器 | 来源 | 下一轮必须记录的值 |
| --- | --- | --- |
| `x0` | `A + 0x7800` | preprocessor identity |
| `x1` | 同一个 `FaceAlignmentDet` source Mat | 实际已转换 / 旋转后的三通道像素与 stride |
| `x2` | `T + 0x18` | **可变** Rect 的进入值和返回值 |
| `w3` / `w4` | `i32[A + 0x95c]` / `i32[A + 0x960]` | actual target width / height |
| `w7` | `byte[C + 0xb] & 1` | 最后一个 bool，不擅自命名成 rotation / interpolation |

`0x2d5ed8` 检查 `T+0x110` 的 bit 0，选择下列分支：

| call site | 条件 | `w5` | `w6` | `s0` expansion |
| --- | --- | --- | --- | --- |
| `0x2d5f2c` | `T+0x110` bit 0 为 1 | `true` | `false` | `1.5f` |
| `0x2d5fd0` | 上述 bit 为 0，且 `F+0x39` bit 0 为 1 | `F+0x24` bit 0 | `true` | bits `0x3fb33333`，约 `1.399999976158142f` |
| `0x2d5fd0` | 两个 bit 均为 0 | `F+0x24` bit 0 | `false` | `BasicCfg::ScaleEnlarge` |

本轮用静态 `memory read` 读到 `BasicCfg::ScaleEnlarge` 在 `__TEXT.__const` 的 `0x498f24` 为 **`1.0f`**。这不是实际 R12 分支已走该值的证据。受控 probe 的默认 `1.5f` 不能当作真实 host 的通用默认值。

`w5` 对应受控 probe 的 `allow_upscale`：它只在 crop height 小于 target height 时选择 linear；`w6` 被传入 crop 的 legacy bool。末尾 `w7` 至少传到 crop 内的 allocator allocation flag（`0x3814b4..0x3814c4`）；不据此断言其所有作用。

现有 geometry snapshot 的 `base_size` 来自 `A+0x954/+0x958`，tracking size 来自 `A+0x94c/+0x950`。它们 **不是这里的 `A+0x95c/+0x960`**。NN tensor 是 160×160 的证据，不等于 caller target fields 已被捕获。

## crop、resize、matrix 的具体顺序

1. `ProcessDetectionImage` 在 `0x2ca418..0x2ca424` 检查 `channels()==3`。不等于 3 时跳过正常 crop / resize，返回持有的 output Mat；不能将可能遗留的 output 当作本次成功预处理。该函数不负责 RGBA -> BGR。
2. `0x2ca45c` 调 `CropObjectRegion`：`x0=source Mat, x1=mutable Rect, x2=local crop Mat, x3=MemAllocator*, w4=legacy, s0=expansion, w5=last bool`。
3. crop 在 `0x381374..0x3813c8` 回写扩框 Rect：截断后的 origin、`right-left+1` / `bottom-top+1`。随后才开始 frame 边界 clamp（`0x3813cc` 起）。因此回写 Rect 保留可能越界的 padded extent，不能替换成 clamp 后的可见 ROI。越界黑色 padding 有既有受控证据。
4. `0x2ca498..0x2ca4b0` 检查 `allow_upscale && crop.rows < target_height`：真分支在 `0x2ca504` 向 resize entry `0x1eb450` 传 `w3=1`；否则 `0x2ca568` 传 `w3=0`。二者与 linear / nearest 的对应由既有 196-case probe 支持。返回 output Mat 是 preprocessor `+0x80`，即 `A+0x7880`。
5. `FaceAlignmentDet` 在 `0x2d5f38` 或 `0x2d5fdc` 接收 returned Mat；`0x2d5fe4..0x2d6024` 校验 cols / rows 与 target fields。
6. **之后** `0x2d6030..0x2d6068` 设 canonical anchors `[0,0,W-1,H-1]`；`0x2d607c..0x2d60c8` 读已回写的 Rect，形成 `[x,y,x+w-1,y+h-1]`；`0x2d60d4` 才计算 resize transform（对象 `A+0xfe8`，inverse 在其 `+96`）。该计算写坐标矩阵，不采样 image pixels。
7. `0x2d61c0` 将已经准备好的 Mat 交给 `doCnnAlignmentNewPhase2`（`w3=true`）；`0x2d5124` 进入 `BasePredictDet`；最终 `0x36b43c` 调 `BasePredictor::Predict(x0=predictor, x1=prepared Mat, w2=mode)`。随后 inverse 被用于 seed / output 点映射。

例：277-pixel crop 到 160，端点 forward scale 是 `159/276`；nearest resize 的源位置规则按 `277/160` 的尺寸比例处理，不能用 inverse 的 `276/159` 直接取代。120 的 split-quantized affine sampler 也不是这条 crop + resize 路径。正确的点 back-map 不证明正确的 tensor pixels。

### crop 之前还有一段真实上游

`PureDetect` 内静态 call site：

| 地址 | 调用与数据 |
| --- | --- |
| `0x3328bc` | `ConvertToBGR(source Mat, InputParameter+0x18 format, owner+0x7ea8)` |
| `0x332944` | `RotateFront(owner+0x7ea8, InputParameter+0x1c orientation, owner+0x7ea8, byte[owner+0x7a79]&1)` |
| `0x3336a8` | `FaceAlignmentDet` 的 `x1=owner+0x7ea8, C=owner+0x7e58, F=owner+0x7a40` |

这定位到了 matrix 之前应查的 source stage。R12 没有 `owner+0x7ea8` 像素快照、这些 flags 或 crop-enter / exit Rect，因此 **不能宣称 R12 已动态验证该 caller、旋转为 identity 或 source 只是原始 RGBA 去 alpha**。request orientation 为 0 也不代替阶段像素比较。

## 现有锁定数据能证明什么

路径均相对 repo 根目录的 `.local/jianying-model-pytorch/`，不提交其像素、模型或反汇编。

| artifact | 本轮只读核验 / 既有结论 |
| --- | --- |
| `face-host-geometry-sequence-20261003-r12/report.json` | captured host profile；2 次 160 inference，prediction 0 / 20 |
| `face-host-geometry-sequence-replay-20261003-r9/report.json` | captured 160 input 上的 own seed / temporal replay |
| `face-host-geometry-sequence-render-20261003-r7/report.json` | 引用前两者的 renderer parity |
| `face-temporal-capture-audit-20261003-r7/report.json` | 三个 report SHA 关联匹配，source union 的 **50 文件当前哈希全部匹配**；不是 capture 单独有 50 文件 |
| `face-alignment-input-20261002-r2/summary.json` | 既有受控 196 cases：60 linear / 136 nearest，不是 actual host auto-route capture |
| `face-alignment-entry-20261002-r1/entry-summary.json` | 既有受控 8 cases；不填补真实 caller 参数缺口 |

R12 的两次 160 对照：

| 项目 | prediction 0 | prediction 20 |
| --- | --- | --- |
| NN association window | `[0,140]` | `[567,611]` |
| 160 inference / marker `record_index` | `0 / 108` | `1 / 579` |
| 120 inference / marker | `0 / 121` | `19 / 592` |
| 160 tensor file | `capture/107-espresso-input.bin` | `capture/578-espresso-input.bin` |
| face ID | 0 | 1 |

两次复用了 alignment slot 0 的地址 `41521954816`、handle `41506144256`。160 network 为 `41488456784`、predictor `41501529088`、provider `41515815936`。这些只是旧 capture 的关联证据：slot / pointer 可复用，下一轮必须同时绑定 prediction、generation、face ID、network、inference marker。

两份 algorithm frame 的 request 都为 `[0,640,480,2560,0]`，RGBA 1,228,800 bytes，SHA 都为 `235cf505397caa288b9bc6164c8c288cf43306abb0e95d47463adeb0a9ce521d`。post-geometry 的 `frame_size=[480,640]` 本身不证明发生了哪个旋转。

两份 native 160 input 均为 NHWC `[1,160,160,3]`、signed int8、`raw=[1,6]`、76,800 bytes，SHA 为 `dd260011e481c0270c15cb2a3aa9863fc3e28f11cb1caddf960a43768c9110ef`。存储的 fraction descriptor 不应被误解成另做一次 `/64` 的 pixels normalization。

两次 post-snapshot matrix 相同：

```text
forward = [[0.5760869383811951, 0, -106.57608795166016],
           [0, 0.5760869383811951, -46.66304397583008]]
inverse = [[1.735849142074585, 0, 185.00001525878906],
           [0, 1.735849142074585, 81.00000762939453]]
```

`(185,81,277,277)` 只是按端点模型反解的 **待证假说**，不是 captured crop Rect；不得把它作为 independent producer 的 crop 输入。

本轮纯 CPU 再执行 `face_host_sampling_160_inputs.build_inputs`，按原锁定来源和 association 得到预期 `SamplingMismatch`：**两个 case 均为 67,068 / 76,800 不同值，max difference 177**；direct-affine candidate SHA 均为 `1624404ff541becd7ea32a322ad2c5569028510f7e65bb651fbd57ec17a2d626`，未返回 replacement。

逐段复核确认：既有 `face-owned-sampling-temporal-parity-2026-10-03.zh-CN.md` 当前也记为两个 case 各 67,068，与本轮重算及 `face-host-sampling-160-20261003-r1/report.json` 一致。`face-host-geometry-sequence-replay-160-rejected-20261003-r1/report.json` 的空 `cases` 不能代替 mismatch case 证据；不得降低失败等级。

## 下一轮：独占时段的硬件断点 sidecar

**尚未实现 / 尚未执行。** 先由 parent 确认 native / GPU 空闲时段；当前并行实现不等待此调查。下面是下一轮独立 runner / callback 的具体规格，不是已存在的新 CLI。只新增 diagnostic 文件及新 capture 目录；不修改旧 probe、observer、host、50 个 source 或其阈值。

### 1. 固定请求与运行边界

- 新目录：`.local/jianying-model-pytorch/face-160-preprocess-host-20261003-r1/`，存在则拒绝覆盖。启动前后重验旧 50 文件与三个 report SHA；新 sidecar 源码、二进制、manifest、输入及输出哈希独立记录。
- 复用 R12 的锁定 host：`.local/jianying-model-pytorch/face-render-model-capture-20261003-r5/control/clone-audit/host`。runtime 使用实际版本目录 `.../JianyingFilter/D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397`，启动前核验 liblens SHA / UUID，不盲信 `current`。
- host argv：`[host, runtime, runtime/Models, runtime/Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76]`。复用 manifest `face-sequence-fixture-20261003-r1/manifest.json` 及 R12 `input-00.rgba` 到 `input-06.rgba`，逐一比 `frames[].input_rgba_sha256`；不要重新压缩 / 重采样输入。
- 原样使用 manifest parameters / timestamp：6 次第一帧 timestamp 0 的 warmup，随后 7 帧（0 到 6/30 秒）。保留每个请求内部两个 seek。期望同 profile 26 个 prediction、160 出现在 prediction 0 / 20、无脸在 18 / 19、face ID 从 0 到 1；发生变化即不按 R12 勉强关联。
- baseline 与 observed 为两个 **串行** fresh host。两者保持 `QCUT_FRAME_WIDTH=1448`、`QCUT_FRAME_HEIGHT=1086`、`DYLD_LIBRARY_PATH=runtime/Frameworks`、`QCUT_TRACE_UPDATES=1`、`QCUT_FACE_POINT_SHIFT=0`、`QCUT_CONSUMER_RECORD=<各自新目录>/records.jsonl`。移除 `QCUT_FACE_BIND_REPLAY` 和 `LD_PRELOAD`，不注入 candidate points。
- observed 才使用已锁定的 R5 `observer.dylib` 和 R12 `geometry-observer.dylib`；设置 `QCUT_BYTENN_CAPTURE_IO=1`、`QCUT_BYTENN_CAPTURE_TERMINALS=1`、`QCUT_BYTENN_CAPTURE_DIR=<新目录>/capture`、`QCUT_FACE_GEOMETRY_DIR=<新目录>/geometry`。输入、输出、日志均不得落入旧 capture 目录。

stdin 文件的每行严格沿用现有协议（TAB / LF，不是文字 `\\t`）：

```text
render<TAB>warmup-N 或 frame-NN<TAB>timestamp<TAB>绝对 input.rgba 路径<TAB>绝对新 output.rgba 路径<TAB>原 parameters JSON<LF>
...
exit<LF>
```

生成新 stdin 文件的 runner 需按现有 `parameters_json` 校验，限制为 13 个请求；核验 `QCUT\tREADY\t1` 和 13 个 ordered `QCUT\tRESULT\t<id>\t0`。现有 `BoundedHost` 60/65 秒的 timeout 不适合人工停在 LLDB：不要修改它。新 sidecar 自带最多 300 秒 wall-clock watchdog、64 predictions、128 次断点回调、每 blob 16 MiB、总 trace 128 MiB，超限终止；禁用 debugger 任意函数求值。

### 2. 最多四个硬件断点的单次滚动捕获

仅新建 research host 子进程；不 attach 正在工作的 app。只用硬件 breakpoint，禁止软件 breakpoint、`expression`、额外 SDK 调用、补跑推理或二进制 patch。若硬件 breakpoint / launch 不可用，fail closed，报告环境阻塞，不退回会修改代码页的方案。

第一阶段的 LLDB 命令模板（**仅未来独占运行时使用**；需先实现新的 read-only callback 和 stdin runner）：

```text
target create --arch arm64 <锁定 host 的绝对路径>
settings set target.disable-aslr false
breakpoint set --hardware -K false -s liblens.dylib -a 0x2c4dac
breakpoint set --hardware -K false -s liblens.dylib -a 0x2ca3bc
process launch -i <新 requests.tsv> -o <新 host.stdout> -e <新 host.stderr> -E <上述每个环境变量> -- <runtime> <runtime/Models> <package>
```

`-E` 每个变量重复一次。callback 必须验证加载模块 UUID / slide 和 breakpoint 实际 hardware-resolved 状态；pending symbol 不等于已拦截。不要用 `process launch --stop-at-entry` 或临时 main breakpoint 去绕过硬件限制。

捕获状态机：

| 点位 | 必须复制 / 关联 | 断点生命周期 |
| --- | --- | --- |
| `FsNew_DoPredict` entry `0x2c4dac` | owner、单调 prediction ordinal、request / seek / thread；沿用既有 algorithm-frame / NN window observer | 常驻 1 |
| `ProcessDetectionImage` entry `0x2ca3bc`，prologue 之前 | `x0..x2,w3..w7,s0,lr`、source Mat、pre-crop Rect、caller fields | 常驻 2；只对实际 target 160×160 arm 后两点 |
| crop 返回之后 `0x2ca460` | local crop Mat、post-crop Rect、packed crop pixels | 临时 3，命中后禁用 |
| output 返回前 `0x2ca5bc` | `x0` returned Mat、packed resized pixels；必须已有本次 crop event | 临时 4，命中后禁用，改 arm predictor 点 |
| 实际 `Predict` 调用前 `0x36b43c` | `x0=predictor,x1=Mat,w2=mode`、predictor / provider / network identity、prepared pixels | 替代已禁用点；匹配并记录后禁用 |

`lr` 归一到同模块后应是 `0x2d5f30` 或 `0x2d5fd4`（两个 `bl` 的下一条指令），否则单列未知 caller，不混入这条证据。对 PAC 的处理必须使用已验证的平台规则，不能猜 mask。

在 preprocessor entry 尚未建立自身 frame 时，`x29` 为 caller `FaceAlignmentDet` frame。锁定 prologue 对应保存槽为 `A=x29-0x20`、source pointer `-0x28`、InputParameter `-0x30`、`C=-0x38`、`F=-0x40`、`T=-0x48`。读取指针后检查 `x0==A+0x7800`、`x2==T+0x18`，记录 `T+0x110`、`C+0xb`、`F+0x24/+0x39`、InputParameter `+0x18/+0x1c`、target fields 及原始字节；这是验证分支的依据，不用 probe 默认值代填。

在 crop-after 点，`x29` 已为 preprocessor frame：crop Mat 位于 `x29-0xb0`（data pointer `x29-0xa0`），保存的 Rect pointer 位于 `x29-0x30`。在 return 点，`x0` 已载入 output Mat，而 frame 尚未 unwind。

沿用已锁定 Mat 布局读取 96-byte header（data `+16`、steps `+80/+88`），校验 finite / bounded dimensions、三通道 uint8、有效 row stride，再按 row packed-copy；不将 padding / pointer 当像素，也不触发 `clone()` 或任何目标内函数。每 blob 上限 16 MiB，乘法 / 指针范围先验检查失败即拒绝。actual predictor 的 provider 位于 `+0x110`，network 为 provider `+0x48`，尺寸字段为 predictor `+0x3c/+0x40`；这些布局也必须核对锁定版本。

顺序必须为同一次 prediction 的 entry -> crop-after -> return -> matching predictor call -> 160 NN input marker。用真实 provider / network 和 window 关联，不按最近文件名或相同 SHA 猜；pool slot 复用尤其不能仅按 pointer 关联。多线程、重入、多脸导致歧义时先拒绝，另开新 profile，不串线。callback 只读寄存器 / 内存并写 sidecar，不改变返回值、Rect、points、时间、flags 或 native state。

### 3. 若 source 像素仍不匹配，再独立串行定位转换 / 旋转

第二个 serial observed host 中轮换不超过四个硬件点：`0x3328bc/0x3328c0`（ConvertToBGR 前 / 后）、`0x332944/0x332948`（RotateFront 前 / 后）、`0x3336a8`（FaceAlignmentDet 前）。按阶段 disable / arm，不一次设置五个点。记录实际 Mat / format / orientation / flip flag 及 source bytes，比较每一步输出；仍复用同样 baseline 和新 trace namespace。

第一轮 preprocessor entry 已能获得转换 / 旋转后的 source；第二轮是解释 source 差异，不能用它替代第一轮的 actual crop 参数。这两轮均须检查观察中立性。

## 验收门槛：逐级推进，不反解拟合

| Gate | 必须满足 | 失败后的边界 |
| --- | --- | --- |
| 0：出处 / 观察中立性 | 旧 50 source / report SHA 不变；新 source / lib UUID / input hashes 锁定；baseline 与 observed 7 帧 RGBA **逐 byte 0 difference**；protocol、seek、prediction / face-ID 序列符合 profile | 不得将改变 native 行为的 trace 当真值 |
| 1：actual caller | 捕获 target 160×160、真实三个 bool 和 float bits、caller / generation / face ID；source 为三通道、本次 crop 确实执行，全部关联无缺失 / 歧义 | 不从 matrix / post-snapshot / probe defaults 代填 |
| 2：自有 source / crop / resize | 独立实现 source conversion / rotation、Rect expansion / truncation / padding / resize；各阶段对对应 captured bytes **0 difference**，post-crop Rect / dimensions 精确一致 | 差异留在对应 stage；不同时改模型 / decode 掩盖 |
| 3：actual 160 tensor | 在已验证 predictor-input normalization 下，自有 tensor 与两个实际 input 的 **全部 76,800 个 int8 值相等**，shape / raw descriptor 一致；uint8 -> signed offset 的实现也须与实际 predictor / captured tensor 对照 | 任何 mismatch 不返回 replacement；captured bytes 只作 oracle，不能作为 candidate 输入 |
| 4：模型 / seed / temporal | 保留现有五头 / 中间 blob comparator；160 的 106 点 absolute ordering，不能套 120 mean-shape decode；seed float32、stage1 / tracked / normalized 按既有 sequence 的零差值门槛；reset / 无脸 / reacquire 均通过 | 不调整阈值、拟合坐标或偷用 captured seed |
| 5：消费链 / 产品 | 仍需同一 renderer 的 geometry / normalized points 与 RGBA parity，以及 parent 的真实 QCut IPC / preview / export 验收 | research host 成功不等于 product parity |

保留 `face_alignment_heads_parity.FLOAT_LIMITS`：PoolingDown / OnnxOp1 `atol=rtol=0`；InnerProduct `atol=1e-4, rtol=1e-5`；Sigmoid / Softmax `atol=1e-6, rtol=1e-5, max-relative=0.001`，integer blobs 全部精确。不要把普通单帧 back-map 的容差用于已有 sequence 的零差值门槛。

通过两个现有 case 只证明这个 profile，不证明所有姿态、多脸、padding 或 linear 分支。后续新增独立 profile 覆盖 legacy on/off、1.0 / 1.4 / 1.5 expansion、crop 小于 / 等于 / 大于 target、四边越界、非整数 Rect、非紧凑 stride、格式 / 旋转、无脸重入和多脸关联；受控输入覆盖不代替 actual caller trace。

现有 temporal audit 明确要求 captured 160 input，且拒绝尚未验证的独立替换。即使新 probe 达标，也先新增独立 capture / audit profile 和测试；本任务不修改旧 audit 来让它接受新的声明。

## 本轮可复现的只读命令与结果

以下命令已执行或对应本轮执行的同一 bounded window；只有静态读取 / CPU 检查，不包含上面的未来 live launch。运行位置为 repo root，使用既有工具与 venv，不安装依赖。

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
shasum -a 256 "$R/Frameworks/liblens.dylib"
xcrun dwarfdump --uuid "$R/Frameworks/liblens.dylib"
xcrun lldb --batch --no-lldbinit \
  -o "target create --arch arm64 \"$R/Frameworks/liblens.dylib\"" \
  -o 'image lookup -r -n "ProcessDetectionImage|CropObjectRegion|FaceAlignmentDet|computeTransformForResize"' \
  -o 'disassemble -s 0x2d5e18 -e 0x2d60d8' \
  -o 'disassemble -s 0x2ca3bc -e 0x2ca5cc' \
  -o 'image lookup -r -s "ScaleEnlarge"' \
  -o 'memory read -f f -c 1 0x498f24' -o quit
```

补充 bounded windows：`0x332830..0x33294c`、`0x333650..0x3336b0`（上游）；`0x381374..0x381414`（Rect 回写与 clamp）；`0x2d6078..0x2d6234`、`0x2d5064..0x2d51ec`、`0x36b3e0..0x36b448`（matrix / predict 消费顺序）。同样用 unloaded `target create` + `disassemble -s ... -e ...`；不运行或求值目标。

纯 CPU synthetic tests（未实例化 native renderer）：

```sh
cd research/local-model-pytorch
../../.local/jianying-model-pytorch/tflite/venv/bin/python -B -m unittest \
  face_host_sampling_160_inputs_test face_alignment_input_test face_alignment_sampling_test -v
```

结果：**60 tests passed，0.281 秒**。它们验证已有 sampler 的 synthetic / fail-closed 行为，不证明 actual 160 路径。

只读 source / report / input 哈希检查，可在 repo root 重跑，不写新的 audit 文件：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B - <<'PY'
import json
from pathlib import Path
from face_alignment_replay import LockedFiles
from face_temporal_capture_audit import source_hashes
base = Path('.local/jianying-model-pytorch')
names = {'capture': 'face-host-geometry-sequence-20261003-r12',
         'sequence_replay': 'face-host-geometry-sequence-replay-20261003-r9',
         'sequence_render': 'face-host-geometry-sequence-render-20261003-r7'}
locked = LockedFiles()
audit = locked.json(path=base / 'face-temporal-capture-audit-20261003-r7/report.json')
reports = {}
for key, name in names.items():
    path = (base / name / 'report.json').resolve(strict=True)
    reports[key] = json.loads(locked.read(path=path, maximum=32*1024**2,
                                        expected=audit['report_sha256'][key]))
sources = source_hashes(reports=tuple(reports.values()))
assert len(sources) == audit['source_count'] == 50
for name, sha in sources.items():
    locked.read(path=Path('research') / name, maximum=16*1024**2, expected=sha)
capture = reports['capture']
network = str(capture['geometry_snapshots'][0]['predictors'][1]['network'])
for row in capture['captures']['networks'][network]['inputs']:
    data = locked.read(path=Path(row['path']), maximum=76800, expected=row['sha256'])
    assert len(data) == 76800 and row['raw'] == [1, 6]
for index in (0, 20):
    row = capture['algorithm_frames'][index]
    path = (base / names['capture'] / 'geometry' / row['file']).resolve(strict=True)
    locked.read(path=path, maximum=1228800, expected=row['sha256'])
locked.verify()
print(json.dumps({'reports_linked': 3, 'sources_current_and_unchanged': len(sources),
                  'actual_160_inputs_hashed': 2, 'algorithm_frames_hashed': 2,
                  'preprocess_runtime_trace_added': False}))
PY
```

本轮结果：`reports_linked=3, sources_current_and_unchanged=50, actual_160_inputs_hashed=2, algorithm_frames_hashed=2, preprocess_runtime_trace_added=false`。

纯 CPU 重现 rejected direct-affine candidate（退出 0 表示**观察到预期拒绝**，不是 candidate pass）：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B - <<'PY'
import json
from pathlib import Path
from face_alignment_replay import LockedFiles
from face_host_sampling_160_inputs import build_inputs, SamplingMismatch, lock_sources
root = Path('.local/jianying-model-pytorch/face-host-geometry-sequence-20261003-r12').resolve(strict=True)
locked = LockedFiles()
evidence = locked.json(path=root / 'report.json')
lock_sources(sources=evidence['source_sha256'], locked=locked)
try:
    build_inputs(root=root, evidence=evidence,
                 associations=evidence['prediction_inferences'], locked=locked)
except SamplingMismatch as error:
    locked.verify()
    print(json.dumps({'diagnostic_only': True, 'native_called': False,
                      'replacement_returned': False,
                      'cases': [dict(prediction=c['prediction'], inference=c['inference'],
                                     different_values=c['different_values'],
                                     maximum_difference=c['maximum_difference'])
                                for c in error.cases]}))
else:
    raise RuntimeError('unexpectedly accepted unresolved 160 sampler')
PY
```

本轮结果：prediction 0 / 20 均 `different_values=67068, maximum_difference=177`，没有 replacement、没有 native 调用。当前进度是定位了更早的真实候选 stage 与可验证的 capture 设计；**actual host preprocessing 的独立替换仍未完成**。
