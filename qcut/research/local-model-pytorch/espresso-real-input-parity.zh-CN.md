# 真实渲染输入上的对拍与前处理复现

日期：2026-09-20。分支：`codex/local-neural-model-tail-20260920`（PR #479）。
此前所有 espresso 网络的对拍都用合成随机输入，绕过了产品前处理。本轮把无头人像宿主真实渲染一帧时
网络**实际消费的输入张量**和 **SDK 实际取走的输出**录下来，用同一套解释器复算。

## 结论

- 三个特效包、**23 次真实推理、7 张不同网络**全部通过：整数输出逐位一致，浮点输出最大 `3.4e-5`，
  没有任何一层需要"无法比较"的豁免——合成噪声下会溢出的 dense 头在真实输入上不出现（本轮涉及的网络里没有）。
- 人脸检测器的**产品前处理被完整复现**：从 1280×720 原帧出发，按拟合出的配方生成的 int8 张量与 SDK 喂入的
  张量**逐字节相同**（184,320 像素全部一致），再经解释器得到的 6 个检测头输出与 SDK 取走的**逐位相同**。
  这条链证明了"原始像素 → 网络输出"在 QCut 自己的代码里可以逐位重现，不再依赖厂商运行库。
- 对齐网（160、120）与 freid（112）的输入是按检测结果裁出的人脸块，本轮验证了"给定这块输入，输出一致"，
  但裁剪几何（框解码、仿射）尚未从原帧推导，见"仍未覆盖"。

## 怎么录的

`bytenn_model_capture.mm` 新增 `QCUT_BYTENN_CAPTURE_IO=1`：

- 在 `espresso::Thrustor::CreateNet` 记下该网络对象的输入名（图里的 `DataV2` / 旧格式 `data` 行）；
- 在 `Inference()` 入口，对每个输入名调用运行库自己的 `Extract` 取到 blob 视图，按 `dims`（n,w,h,c）与
  存储类型复制字节——这是网络真正读到的内容，不是调用方的暂存缓冲；
- 之后调用方每一次 `Extract` 都被记录，带上该对象已完成的推理序号，输入与输出因此能按（对象，序号）配对。

一个事实：SDK **从不调用 `SetInput`**。它在推理前 `Extract("data")` 拿到输入 blob 的视图，把前处理好的像素直接写进
引擎的缓冲区（记录里 `inference=-1` 的那条 `data` 输出就是这个动作）。这也是为什么早先按 `SetInput` 拦截什么都拦不到。

`espresso_real_parity.py` 按图文本的 SHA-256 在各批次的 `collected/` 里找到已验证的 arena，
用 `espresso_fixed.run` 在录下的输入上复算，逐个比较录下的输出（推理前取走的输入 blob 不参与比较）。

## 结果

| 特效包 | 网络 | 真实输入 | 推理次数 | 输出 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 贴纸（fsnew + extra + freid） | `3a3fc3c584289096` 检测器 | 320×576 int8 | 1 | 6 | 逐位一致 |
| | `af10da6a6a376270` 对齐 160 | 160×160 int8 | 2 | 5 | 浮点 ≤ `3.4e-5` |
| | `2b13415220a208e7` 对齐 120（`B`） | 120×120 int16 | 4 | 5 | 浮点 ≤ `4.8e-6` |
| | `561c62426cd40bbc` freid | 112×112 | 2 | 1 | 浮点 ≤ `1.5e-7` |
| 皮肤分割（tt_face v11） | `e96283032a6db00a` 检测器 128 | 128×224 int8 | 1 | 6 | 逐位一致 |
| | `b91158956cb941c1` 对齐 120-58 | 120×120 | 2 | 4 | 浮点 ≤ `7.6e-6` |
| | `16e18b7bf21646ed` 对齐 120-79 | 120×120 | 4 | 4 | 浮点 ≤ `1.3e-5` |
| 人体（squat） | 同贴纸的检测器与两张对齐网 | | 7 | | 全部一致 |

检测器在皮肤分割包里以 128×224 运行、在贴纸包里以 320×576 运行——都是产品实际用的动态尺寸，
对应此前用 `ReInferShape` 探到的规则。

## 检测器前处理配方（逐像素复现）

`espresso_preprocess_probe.py` 把原帧按若干候选路线重采样到张量分辨率，对每条路线按通道拟合
`q = round(a·p + b)`（通道顺序自由），再在最优骨架上枚举取整方式、权重位宽和趟序。结果：

1. **1280×720 → 640×360**：2×2 均值，**.5 进位**到 8 位（`floor(mean + 0.5)`）。
   这是 SDK 的 `AlgorithmImageProducer` 在 GPU 上做的 2 倍缩小（日志 `dst resolution changed 0x0 --> 640x360`）。
2. **640×360 → 576×320**：可分离双线性，半像素中心 `(x + 0.5)·scale − 0.5`（越界钳到边缘），
   **先横后纵**，权重量化到 **7 位**，每一趟**截断**（`>> 7`）。
3. 通道顺序 **BGR**；张量值 = 像素 − 128，存 int8、6 位小数（即代表 `(p − 128) / 64`，值域正好是 −128…127）。

拟合过程中被排除的写法及其残差：PIL 抗锯齿双线性直接缩放（47% 一致、最大差 38）；两级但第二级四舍五入或
11 位权重（90–99% 一致、最大差 1–2）；先纵后横（95%）。只有上面这组是 **100% 一致、最大差 0**。
`face_detector_tensor()` 把它固化成代码，`espresso_test.py` 用小张量测截断与取整方向。

## 仍未覆盖

- **对齐网与 freid 的裁剪几何**：需要 SDK 的框解码（anchor、NMS）和按关键点的仿射变换，本轮只验证了裁剪块之后的部分。
- **引擎路径的网络**：皮肤分割、人体关键点、C3、抠像等走 `ByteNNEngine` 而不是 `espresso::Thrustor`，
  它们的推理入口尚未挂钩（Init 已通过复制虚表挂上，SetInput/Inference/GetOutput 可以同法处理）。
- 只录了一帧（`face-1280x720.rgba`）；配方在其他分辨率下是否仍是"先 GPU 2 倍缩小"未验证。
- 没有任何产品或编辑器接入。

## 证据目录（全部在 `.local/`，不进 Git）

`tail-20260920/`：`iocap-sticker`、`iocap-skinseg`、`iocap-squat`（录制的输入/输出与日志）、
`real-parity-sticker/skinseg/squat`（`report.json`）、`preprocess-detector`（各路线拟合、`tensor-preview.png`）。

## 复现

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
env -i PATH="$PATH" HOME="$HOME" DYLD_LIBRARY_PATH="$R/Frameworks" DYLD_INSERT_LIBRARIES=<capture.dylib> \
  QCUT_BYTENN_CAPTURE_DIR=<dir> QCUT_BYTENN_CAPTURE_IO=1 QCUT_FRAME_WIDTH=1280 QCUT_FRAME_HEIGHT=720 \
  electron/resources/bin/jianying-portrait-adjustment-host "$R" "$R/Models" <effect-package> < commands.tsv
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_real_parity.py --capture <dir> \
  --collected <collected...> --out <out>
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_preprocess_probe.py --frame <frame.rgba> \
  --tensor <dir>/NNN-espresso-input.bin --dims 1,576,320,3 --raw 1,6 --intermediate 640x360 --out <out>
```
