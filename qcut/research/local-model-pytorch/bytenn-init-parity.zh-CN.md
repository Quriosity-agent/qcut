# 密文 BM 容器：用 ByteNN 自己解密再逐位对拍

日期：2026-09-20。分支：`codex/local-neural-model-tail-20260920`（从 v2026.09.20.1 的 master 开出）。
对象：Filter 运行时里 `BM\0` 段为密文、此前全部判为 `unsupported` 的四个神经文件：`nodehub_c3_300_ilasdk_v1.0`、
`tt_matting_large_v3.0`、`tt_matting_relight_v1.0`、`tt_matting_v15.0`。

## 结论

- 四张网络的图文本与 arena 逐字节取得并被运行库验证（arena 长度与容器第二段长度完全相等，说明密文保长）。
- 三张定点网络（C3 分类 `B` 图 174 层、matting large `B` 图 140 层、matting v15 int8 图 99 层）在两个种子下
  **所有整数中间层与输出逐位一致**；relight 是 fp32 图，136 层全部在 `1.3e-5` 以内，256×256 的两类 softmax 头逐位一致。
- 本轮新增运行库语义：`DilationSeparableConvolution`（膨胀深度可分离卷积，探针确认字段序）、float 图的算子路径、
  softmax 按 SIMD 4 像素分块与标量尾像素走不同归一化（见 [espresso-fixed-point.zh-CN.md](espresso-fixed-point.zh-CN.md)）。
- 面部/皮肤/人体 19 张网络用最终解释器重跑（种子 41）仍全部通过，无回归。
- 没有任何产品或编辑器接入；产品前处理未验证。

## 方法

这些文件的 BM 容器（v2/v4）第一段是密文图文本、第二段是密文 arena，`container_scan` 只能判为不可读。
ByteNN 运行库在 `EngineFactory::Create()` → `Init(Config)` 时自行解密（日志 "This model has NOT been inserted validation information"）。
`bytenn_init_host.mm` 用捕获到的 `Init` 参数块布局（int32 forwardType、int32 threads、模型指针、uint32 长度、int32 缓冲标志，其余清零）
把容器直接喂给公开接口；`bytenn_model_capture.mm` 注入后在 `Init` 返回时扫描堆得到明文图文本与图戳窗口，
`espresso_heap_carve.py` 按 `espresso_graph.py` 的字节核算从戳窗口切出 arena 并用 `espresso_probe.mm` 验证。
四个容器 `Init` 全部返回 0。

## 网络清单

| id | 文件 / 角色 | 头 | 层数 | arena 字节 | 输入 (h×w×c, [type, frac]) | 输出 | 两种子对拍（41/509） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ccaa585ac8859cbe` | nodehub_c3_300/cls-224-B-int16 | `B` | 174 | 3,083,224 | 224×224×3 `[2, 6]` | `output` | 整数层 174/174 逐位一致；浮点层 0 层最大 `0` |
| `911dd5ebd7634637` | tt_matting_large/seg-448x256-B-int16 | `B` | 140 | 1,078,696 | 448×256×3 `[2, 7]` | `prob_cls` | 整数层 135/135 逐位一致；浮点层 5 层最大 `0` |
| `86f5707b3c00ac2a` | tt_matting_relight/seg-256-fp32 | `plain` | 136 | 10,989,388 | 256×256×3 `[4, 0]` | `nn_3` | 全部 136 层浮点，最大绝对误差 `1.3e-05` |
| `d5056fed71dde378` | tt_matting_v15/seg-224x128-int8 | `plain` | 99 | 198,468 | 224×128×3 `[1, 6]` | `prob_cls` | 整数层 113/113 逐位一致；浮点层 4 层最大 `1.2e-07` |

## 走不通的路（剩余文件）

- `tt_face_attribute_age/exp/extra`、`tt_faceverify`、`tt_face_extra_fast`、`tt_skeleton_v9.2`、`tt_skeletonlockon`、
  `tt_body_detection_lockon`、`tt_after_effect`、`tt_matting_video_v1.2` 是 SMASH 的 `versioned-model-wrapper`（记录名带 `$`，
  如 `detect$`、`agenet$`、`verify$`、`multi$`），载荷用 AES 加密：`smash::AES_DecryptWrapper` 有导出，但拿 libcccreator 全部
  88,063 个 8–64 字节字符串当密钥、三种载荷起点各试一遍都无命中；导出的 `SK_InitModel/SK_InitModelFromBuf` 对两个骨骼文件报
  "buf data len is far less"（不是这个接口的包），枚举模型类型 1 还会段错误。它们只剩"由能加载它们的产品路径触发后堆扫描"一条路，
  而缓存里没有对应的特效包。
- 音频容器（`aed40_*`、`audio_metrics`、`jianying_snr_mobile`、`bt_espresso_mobile_offline`）、`lens_ii_auto_color_*`、
  `tt_colorparse`、`tt_facefitting1220/1256/845` 与脚本/小数据文件不在本轮范围。

## 证据目录（全部在 `.local/`，不进 Git）

`tail-20260920/`：`bm/`（切出的四个容器）、`init-*`（宿主日志、堆图、戳窗口）、`collected/`（四张网络 + `manifest.json`）、
`parity-final-seed41`、`parity-final-seed509`、`micro-dil`、`micro-sm`、`micro-sm2`（探针图）、`sk-*`（骨骼接口失败记录）。
面部回归：`face-capture-20260920/parity-final3-seed41`。

## 复现

```sh
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current"
clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation -L"$R/Frameworks" -lbytenn -Wl,-rpath,"$R/Frameworks" \
  research/local-model-pytorch/bytenn_init_host.mm -o /tmp/bytenn-init-host
env -i PATH="$PATH" HOME="$HOME" DYLD_LIBRARY_PATH="$R/Frameworks" DYLD_INSERT_LIBRARIES=/tmp/capture.dylib \
  QCUT_BYTENN_CAPTURE_DIR=.local/jianying-model-pytorch/new-init /tmp/bytenn-init-host container.bm
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_heap_carve.py --capture .local/jianying-model-pytorch/new-init --out .local/jianying-model-pytorch/new-collected
/opt/homebrew/bin/python3 research/local-model-pytorch/espresso_parity.py .local/jianying-model-pytorch/new-collected/*/ --out .local/jianying-model-pytorch/new-parity --seed 41
```
