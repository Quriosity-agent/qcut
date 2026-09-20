# 人脸家族 espresso 网络：捕获、精确 arena 与定点逐位对拍

日期：2026-09-20。分支：`codex/local-neural-model-remaining-20260919`（PR #478）。
对象：盘点表里"载荷不是明文 bytenn 图"的四个人脸容器 `tt_fsnew_base_jianying_v2.0`、`tt_face_v11.2`、
`tt_face_extra_v15.0`、`tt_freid_v2.0`，顺带捕获的 `tt_facefitting_3d_v6.2`，以及同一方法拿到的
`tt_skin_seg_v5.1`（N12）与 `tt_skeletonsquat_v10.0`（N13）。

## 结论

- 19 张网络的图文本与 arena 已**逐字节**取得并被运行库验证（缩短 8 字节即报 `weight not match net`；
  老格式网络用护页二分，少 1 字节即 SIGBUS）。清单在 `.local/jianying-model-pytorch/face-capture-20260920/collected/manifest.json`。
- 定点解释器 `espresso_fixed.py` 对 18 张定点网络在三个随机种子（17/41/509）下**所有整数中间层与输出逐位一致**；
  人脸检测器在产品实际使用的动态尺寸 320×576 下同样逐位一致。
- 浮点层按来源分开统计：全连接 → softmax/sigmoid 的尾部最大绝对误差 `2.3e-5`；定点输入的多类 softmax 逐位一致；定点输入的
  **两类** softmax 按通道 0 相对指数复现后，mask 网络两路概率逐位一致，extra 网络的 `prob2` 只剩并列点差 `9.8e-4`；
  `facefitting_3d` 的 fp32 MLP 绝对误差 `≤4.2e-4`（相对 `≤2.6e-4`）。全表浮点层的真实最大绝对误差为 `0.00098`（extra 的 `prob2`）。
- 没有任何产品或编辑器接入；真实素材经产品前处理后的输出未验证。

## 容器为什么打不开，以及怎么拿到明文

这四个文件是带名字记录的加密包，磁盘上没有明文图。人脸算法（SMASH，编译在 `libcccreator` / `liblens` 里）
自己解包，然后**跨库**调用 ByteNN 的老接口 `espresso::Thrustor::CreateNet(图文本, arena 指针, 输出名)`
（`nm -u libcccreator.dylib` 可见），而不是走 `EngineFactory`。因此在 QCut 自己的无头人像宿主
`electron/resources/bin/jianying-portrait-adjustment-host` 里用 `DYLD_INSERT_LIBRARIES` 注入
`research/local-model-pytorch/bytenn_model_capture.mm`，在调用入口把文本和 arena 所在的可读内存段整段落盘。
`tt_face_extra` 的 `mask` 子模型走的是 `EngineFactory::Create` → `Init(ConfigExt)` 的 BM v2 密文容器路径，
库内部解密后再调 `CreateNet`，dyld 插桩看不到库内调用；改为给引擎对象换一份复制的 vtable 截获 `Init`，
并在 `Init` 返回后扫描进程可读内存找图文本与图戳，在戳之前的窗口里按图的字节数切出 arena。

arena 长度不在调用参数里：带戳的图（`D`/`B`/无字母三段头）以小端 uint32 图戳结尾，按戳截断后用运行库验证；
老格式（`1 57` 两段头、`data …` 输入行）无戳，用 `espresso_probe.mm` 的护页模式二分出运行库真正读到的字节数。
`espresso_graph.py` 的逐层字节核算与全部 19 个精确长度相符（`B` 头的 type-2 卷积核按每对 3 字节计）。

哪个特效包能触发哪些模型：`Cache/effect/7406174746829737231/b6c830…`（贴纸）加载 fsnew + extra + freid；
`7456626609332687397/4375…` 加载 `tt_face_v11.2` + extra + facefitting_3d + freid；`7408757645705760000/c362…` 与
`7408077820116667700/b000…` 加载 `tt_skin_seg`；`7408076932065152296/9c89…` 加载 `tt_skeletonsquat`；
`facefitting1256` 的三个包在该宿主里没有加载任何模型；`tt_faceverify`、`tt_face_attribute_*`、
`facefitting1220/845` 在缓存里没有对应的特效包，本轮未捕获。

## 网络清单

| id | 角色 | 头 | 层数 | arena 字节 | 截断方法 | 输入 (h×w×c, [type, frac]) | 输出 | 三种子对拍（17/41/509） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `2b13415220a208e7` | fsnew/align-120-B-int16 | `B` | 81 | 411,512 | stamp | 120×120×3 `[2, 6]` | `fc_landmark_s1`, `prob`, `fc_pitch`, `fc_yaw` … | 整数层 87/87 逐位一致；浮点层 9 层最大 `7.6e-06` |
| `af10da6a6a376270` | fsnew/align-160-int8 | `plain` | 81 | 335,528 | stamp | 160×160×3 `[1, 6]` | `fc_landmark_s1`, `prob`, `fc_pitch`, `fc_yaw` … | 整数层 87/87 逐位一致；浮点层 9 层最大 `4.6e-05` |
| `3a3fc3c584289096` | fsnew/detector-320-D-int8 | `D` | 109 | 64,312 | stamp | 320×320×3 `[1, 6]` | `bbox_head.reg_convs.0.conv`, `bbox_head.reg_convs.1.conv`, `bbox_head.reg_convs.2.conv`, `bbox_head.cls_convs.0.conv` … | 整数层 112/112 逐位一致；浮点层 0 层最大 `0` |
| `f6067b1f6bb270ef` | fsnew+ttface/align-120-legacy-int16 | `plain` | 57 | 151,168 | guard-bisection | 120×120×3 `[2, 6]` | `fc_landmark_s1`, `prob`, `fc_pitch`, `fc_yaw` | 整数层 51/51 逐位一致；浮点层 6 层最大 `7.6e-06` |
| `0456b5561c935d14` | fsnew+ttface/cls-40-int8 | `plain` | 10 | 6,488 | guard-bisection | 40×40×3 `[1, 6]` | `prob` | 整数层 7/7 逐位一致；浮点层 3 层最大 `2.4e-07` |
| `bc29e7cfcbb2f2ee` | fsnew+ttface/cls-56-int8 | `plain` | 10 | 6,488 | guard-bisection | 56×56×3 `[1, 6]` | `prob` | 整数层 7/7 逐位一致；浮点层 3 层最大 `1.2e-07` |
| `b91158956cb941c1` | ttface/align-120-B-int16-58 | `B` | 58 | 128,892 | stamp | 120×120×3 `[2, 6]` | `fc_landmark_s1`, `prob`, `fc_pitch`, `fc_yaw` | 整数层 51/51 逐位一致；浮点层 7 层最大 `2.3e-05` |
| `16e18b7bf21646ed` | ttface/align-120-B-int16-79 | `B` | 79 | 356,816 | stamp | 120×120×3 `[2, 6]` | `fc_landmark_s1`, `prob`, `fc_pitch`, `fc_yaw` | 整数层 87/87 逐位一致；浮点层 7 层最大 `5.7e-06` |
| `e96283032a6db00a` | ttface/detector-128-legacy-int8 | `plain` | 53 | 14,448 | guard-bisection | 128×128×3 `[1, 6]` | `rpn_bbox_pred/8s`, `rpn_bbox_pred/16s`, `rpn_bbox_pred/32s`, `rpn_cls_score/8s` … | 整数层 53/53 逐位一致；浮点层 0 层最大 `0` |
| `7938cfc3abdb0934` | face_extra/extra-160-B-int16 | `B` | 154 | 372,984 | stamp | 160×160×3 `[2, 6]` | `fc`, `prob`, `prob2` | 整数层 152/152 逐位一致；浮点层 4 层最大 `0.00098` |
| `d3d65bdc1ad0358d` | face_extra/iris-48-legacy-int16 | `plain` | 41 | 22,320 | guard-bisection | 48×48×3 `[2, 6]` | `pred_landmark` | 整数层 39/39 逐位一致；浮点层 2 层最大 `2.9e-06` |
| `404585f86fe7f67e` | face_extra/mask-160-B-int16 | `B` | 120 | 231,444 | heap-window-stamp+bm-section-length | 160×160×3 `[2, 6]` | `prob`, `prob2` | 整数层 120/120 逐位一致；浮点层 2 层最大 `0` |
| `561c62426cd40bbc` | freid/a-112-B-int16 | `B` | 122 | 6,178,008 | stamp | 112×112×3 `[2, 7]` |  | 整数层 118/118 逐位一致；浮点层 4 层最大 `2.5e-07` |
| `1fb696f5a079c76e` | freid/b-112-B-int16 | `B` | 122 | 6,178,008 | stamp | 112×112×3 `[2, 7]` |  | 整数层 118/118 逐位一致；浮点层 4 层最大 `1.1e-05` |
| `e6c415d78641d3d6` | facefitting_3d/mlp-212-fp32 | `plain` | 6 | 2,393,840 | heap-stamp-window+graph-accounting | 1×1×212 `[4, 0]` | `Mul_9` | 整数层 0/0 逐位一致；浮点层 6 层最大 `0.00042` |
| `27808bb64ee2ff1d` | skin_seg/seg-224x128-B-int16 | `B` | 127 | 332,592 | heap-stamp-window+graph-accounting | 224×128×3 `[2, 7]` | `prob` | 整数层 126/126 逐位一致；浮点层 1 层最大 `1.5e-11` |
| `615cd22f5bbe3fca` | skeletonsquat/heatmap-192x144-int8 | `plain` | 215 | 227,672 | heap-stamp-window+graph-accounting | 192×144×3 `[1, 6]` | `output.0` | 整数层 218/218 逐位一致；浮点层 0 层最大 `0` |
| `c3388ac4a17502f3` | skeletonsquat/output-192x144-B-int16 | `B` | 225 | 338,272 | heap-stamp-window+graph-accounting | 192×144×3 `[2, 6]` | `output_0` | 整数层 226/226 逐位一致；浮点层 3 层最大 `3e-08` |
| `811519c5c6501093` | skeletonsquat/vectormap-224-B-int16 | `B` | 233 | 343,120 | heap-stamp-window+graph-accounting | 224×224×3 `[2, 6]` | `vectormap_output_0` | 整数层 239/239 逐位一致；浮点层 0 层最大 `0` |

`fsnew` 与 `tt_face` 共用 3 张（120 老格式对齐、40/56 分类）；SDK 加载顺序见各目录 `stdout.log` 的
`begin to load model` 行。`freid` 两张 112 网络分别以 `Reshape`（576 维）和 `fc 1280→512` 收尾。
`tt_skin_seg` 是 224×128 的 `B` 图，`Sigmoid` 输出单通道皮肤掩膜；`tt_skeletonsquat` 包含 224×224 的
vectormap 网络（28×28×38）、192×144 的 int8 热图网络（18×24×17）与 192×144 的 `B` 网络（18×24×34），
三者都走 `EngineFactory` → `Init(Config)` 的密文容器路径，图与 arena 全部靠堆扫描 + 戳窗口切出（宿主在
该特效包渲染结束时 SIGBUS 退出，但捕获在此之前已落盘）。

## 定点规则

全部规则由单层探针图测得（运行库只校验图戳，可以随意构造图与 arena），记录在
[espresso-fixed-point.zh-CN.md](espresso-fixed-point.zh-CN.md)。要点：卷积核 `(co,kh,kw,ci)`、深度可分离 `(kh,kw,c)`；
`B` 头的 type-2 核是 12 位打包（每对 3 字节，大端半字节，值 = raw − 2047），无字母头的 type-2 核才是 int16；
偏置紧跟核之后、int32、位于累加器标度；累加器按 int32 回绕；重量化为加半向上取整的算术右移；
int8 饱和到 −128..127，type-2 饱和到 ±2047；Eltwise 先对齐到较细的输入标度再一次重量化；Concat/Slice/ShuffleNet
逐通道重量化；平均池化四舍五入；`UpSampling LINEAR` ×2 是零填充的 `(9a+3b+3c+d)>>4`；`Upsample f linear 0 1`
是边缘钳制的双线性并向下取整；Reshape 按 NCHW 逻辑序；定点输入的 softmax = float `exp` × 硬件倒数估计 `FRECPE`（不牛顿修正）。

## 验证范围与不能宣称的

- 输入为合成随机整数（在声明的小数位下覆盖 ±1.0 的范围）；三个种子；`espresso_parity.py` 逐层比较运行库
  `Extract` 出的每个中间 blob。
- 两类定点 softmax（`extra` 与 `mask` 的 `prob2`）：`p0 = FRECPE(1 + exp(x1 − x0))`、`p1 = 1 − p0`（指数相对通道 0 而非最大值），
  4095 点探针曲线 99.7% 逐位一致；只有 `x0 == x1` 的并列点上运行库自己的 `exp(0)` 略小于 1，与 libm 差 `9.8e-4`。
- fp32 全连接的累加顺序未固定（相对 `1e-5` 量级）；未做 ONNX 导出；未做产品前处理（人脸框、对齐仿射、归一化）。
- 未能覆盖：`tt_faceverify`、`tt_face_attribute_age/exp/extra`、`facefitting1220/845/1256`。

## 证据目录（全部在 `.local/`，不进 Git）

`face-capture-20260920/`：`captures-r2`（espresso 捕获 + 区段落盘）、`captures-r3`（含堆扫描）、
`pkg-face-fitting3d(-r2)`、`pkg-skinseg-a/b`、`pkg-squat`（戳窗口）、`collected/`（19 张网络 + `manifest.json`）、
`micro`…`micro12`（探针图）、`parity-final2-seed17`、`parity-final2-seed41`、`parity-final2-seed509`（本表数据，三个种子各一目录）、
`parity-final-seed41/509` 与 `parity-seed41/509`（早期轮次）、
`parity-r5-reinfer`（320×576）、`parity-fitting3d`。

## 复现

```sh
# 捕获（需要 QCut 的私有运行时与无头人像宿主）
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
clang++ -std=c++17 -O1 -dynamiclib -fobjc-arc -framework Foundation -L"$R/Frameworks" -lbytenn \
  -Wl,-rpath,"$R/Frameworks" research/local-model-pytorch/bytenn_model_capture.mm -o /tmp/capture.dylib
env -i PATH="$PATH" HOME="$HOME" DYLD_LIBRARY_PATH="$R/Frameworks" DYLD_INSERT_LIBRARIES=/tmp/capture.dylib \
  QCUT_BYTENN_CAPTURE_DIR=.local/jianying-model-pytorch/new-capture QCUT_FRAME_WIDTH=1280 QCUT_FRAME_HEIGHT=720 \
  electron/resources/bin/jianying-portrait-adjustment-host "$R" "$R/Models" "$R/Cache/effect/<pkg>" < commands.tsv
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_capture_collect.py --capture .local/jianying-model-pytorch/new-capture --out .local/jianying-model-pytorch/new-collected
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_parity.py .local/jianying-model-pytorch/new-collected/*/ --out .local/jianying-model-pytorch/new-parity --seed 41
cd research/local-model-pytorch && /opt/homebrew/bin/python3 -m unittest espresso_test
```
