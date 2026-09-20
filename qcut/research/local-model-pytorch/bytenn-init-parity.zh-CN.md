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

## 剩余包装文件：数量与证据边界

2026-09-20 只读复核 `JianyingFilter/current/manifest.json` 与实际文件：以下为 **10 个文件、10 个不同 SHA-256**，
不是 8 个。逐项大小及完整 SHA-256 均与 manifest 相符；表中只列哈希前 12 位便于核对。这是文件计数，
不能当作已经确认的网络数，一个包可能包含多个子网或非神经数据。

| 文件前缀（省略 size/md5 后缀） | 字节 | SHA-256 前缀 |
| --- | ---: | --- |
| `tt_face_attribute_age_v3.2` | 158986 | `d216c4bdc932` |
| `tt_face_attribute_exp_v1.1` | 362214 | `24912bd55308` |
| `tt_face_attribute_extra_v3.0` | 308420 | `159674b9daed` |
| `tt_faceverify_v7.0` | 4340706 | `49607a3043fc` |
| `tt_face_extra_fast_v14.0` | 462799 | `e172e7c7b2b7` |
| `tt_skeleton_v9.2` | 400587 | `dc5fcb6aa7f2` |
| `tt_skeletonlockon_v1.0` | 545732 | `52d1779c7790` |
| `tt_body_detection_lockon_v1.0` | 1530202 | `3be4cb922547` |
| `tt_after_effect_v6.0` | 2116055 | `b64b3ce59e9e` |
| `tt_matting_video_v1.2` | 5913922 | `dc59e384c70b` |

这批文件在现有研究中归为 SMASH 的 `versioned-model-wrapper`，记录名带 `$`，例如 `detect$`、`agenet$`、
`verify$`、`multi$`。相关库存在 `smash::AES_DecryptWrapper` 导出，但本次没有获得这 10 个包逐一经过该函数的
成功调用证据，也没有新增明文图、arena、PyTorch/ONNX 或原生对拍结果。

### 失败记录能说明什么

- 历史记录称对 libcccreator 的 88,063 个 8–64 字节字符串及三种载荷起点尝试均未命中。本次未重跑，且未在
  `tail-20260920/` 的日志/JSON/脚本中找到该批尝试的完整记录。即使该结果成立，也只能排除已测试的组合，
  不能写成“密钥不在库里”，或证明每个文件都使用同一种 AES 路径。
- `sk-tt_skeleton_v9.2/host.log` 中 create 返回 0；type 0 的 path/buffer 均为 -3，type 1–5 的 path 为 -1、
  buffer 为 -5，并有 `buf data len is far less`。这证明该探针调用没有成功，不证明模型损坏或整个 SMASH 运行库不支持。
- `sk-tt_skeletonlockon_v1.0/host.log` 只完整记录到 type 0 的 path/buffer 为 -3，随后日志中断；未见完整 JSON
  和退出码。本次不把它升级为已确认的崩溃信号或崩溃枚举值，先前“type 1 段错误”保留为未复核的历史描述。
- `smash_sk_host.mm` 没有 SDK 头文件：函数签名靠强制转换、模型类型靠枚举，并在同一 handle 上连续尝试路径与
  buffer。ABI、参数顺序、枚举、外包装/内层载荷以及失败后的 handle 状态均未排除，不能据此断定“不是这个接口的包”。
- 先前缓存搜索没有找到可触发这些文件的对应特效包，只是当时搜索范围内的结果；不能推导为产品不存在调用路径。

上述限定也适用于 [定点规则笔记](espresso-fixed-point.zh-CN.md) 中较早的“只剩一条路”描述。
目前应标记为 **未找到已验证的加载路径**，而不是“不可解密”或“所有运行库均拒绝”。

### 下一步：先确认一个正确加载入口

1. 只选 `tt_skeleton_v9.2`，沿现有调用方确认 `SK_*` 的 ABI、模型枚举、输入是完整文件还是子记录、所需初始化顺序，
   固定运行库及输入 SHA。先核对静态调用关系或已有成功路径，不继续猜密钥和穷举未知枚举。
2. 再改最小探针：每个已确认的配置使用独立子进程和新 handle；create 失败即停止，失败不复用对象；记录参数类型、
   输入范围、返回码、退出码/信号及超时。用该接口已知可加载的匹配样本作阳性对照，否则仍不能区分宿主错误和包不兼容。
3. 有成功初始化证据后，再复用已有 ByteNN 捕获器观察是否实际建立网络。图、arena 边界和算子均验证后才能做同输入原生对拍；
   只返回 0、只出现 AES 符号或只捕获内存片段都不计作恢复成功。
4. 骨骼路径的结论不外推到人脸属性、faceverify、after_effect 或旧视频抠像；这些包分别核对自己的调用方。
   产品前处理、连续帧状态、ONNX 和编辑器接入仍是后续独立验收。

本次只核对文件、源码和既有日志，没有加载运行库、重跑解密尝试、修改产品、操作用户项目或进行云端请求。
音频容器（`aed40_*`、`audio_metrics`、`jianying_snr_mobile`、`bt_espresso_mobile_offline`）、`lens_ii_auto_color_*`、
`tt_colorparse`、`tt_facefitting1220/1256/845` 与脚本/小数据文件不在本轮范围；以上 10 个并非全库未知资产总数。

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
