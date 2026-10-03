# 自有 160 采样到实际渲染：完整新 profile 对拍

日期：2026-10-03。分支 `codex/kpop-beauty-v6`，继续 PR #483。

接续 [实际 160 预处理零差](face-160-actual-preprocess-parity-2026-10-03.zh-CN.md)。本轮把该采样结果接进已有模型和后处理，不修改旧 50 source、旧报告、模型、原生运行库或效果包。

## 打通的链路

```text
原生 algorithm RGBA + 实际检测/裁剪参数
  → 自有 BGR / crop / resize / int8 160 输入
  → ONNX 160 五个头 → 自有检测坐标回映 → 初始化 seed
原生 algorithm RGBA + 实际 tracking warp
  → 自有 120 输入 → ONNX 120 五个头
  → 自有 decode / tracked points / temporal smoothing
  → 自有 normalized 106 点 / 真实 face ID / 时间戳
  → 外部 replay.bin → QCut 自写研究宿主的 owned FaceBuffer
  → 相同原生效果渲染器 → 最终 RGBA
```

生产函数不使用捕获的 NN 输入、native smoothing seed 或 native 最终点进行校正。捕获值仅在生成之后作为 oracle；不通过就拒绝，不退回原生 tensor，不放宽原有门槛。

这是**固定序列的独立采样、模型、后处理和实际消费验证**。原生分析在实际渲染时仍运行，没有 bypass；离线候选点替换副本中的 106 点，之后恢复原结果。不是任意画面实时 driver，也不是整个后端已脱离原生运行库。

## 新代码

- `face_preprocess_chain_capture.py`：重新验证旧 50 source、真实采集、像素中立性、硬件 trace、模型/face/prediction 关联及 owned 协议；不拼改旧报告来通过接口。
- `face_preprocess_chain_inputs.py`：实际 caller 参数与 algorithm RGBA 生成 160 tensor，阶段对拍后返回独立只读数组；关联类型、marker window、每个 inference 的完整覆盖均严格检查。
- `face_preprocess_chain_replay.py`：120/160 都向 ONNX 提供新生成的 replacement inputs；执行 seed、平滑、坐标回映。锁定模型 summary/artifact、实际 ONNX 报告、生成的头部和 replay，结束后重新验证。
- `face_preprocess_chain_render.py`：读取新 profile、绑定 capture/replay SHA、源码和全部输入哈希；重新验证时间戳、身份、normalized points。实际 renderer 消费外部点，输出原图/基准/候选/统一 gain8 灰度差分。
- 四个对应测试文件：合成 CPU 正例、拒绝条件和失败报告，不运行私有模型或 GPU。

所有新源码只负责一项工作，旧采样/模型/解码/平滑/渲染验证函数复用，不复制或修改其精度策略。

## 实际结果

原始 neutral capture：`face-160-preprocess-host-20261003-r6/`。

本轮最终 replay：`face-preprocess-chain-replay-20261003-r4/`；最终 renderer：`face-preprocess-chain-render-20261003-r4/`。全部位于 `.local/jianying-model-pytorch/`，不覆盖旧证据。

| 阶段 | 结果 |
| --- | --- |
| 160 独立输入 | prediction 0 / 20，两次 76,800 个 int8 值精确相同 |
| ONNX | 120 模型 25 次 + 160 模型 2 次，共 135 个输出头比较全部通过原门槛 |
| raw landmark head | 27 次 `fc_landmark_s1` 都 `exact=true,max_abs=0` |
| 初始化 seed | prediction 0 / 20 精确相同，未使用 native point seed |
| 解码、tracked、temporal | 26 次 prediction 的已有阶段零差；无脸窗口 18 / 19 不发布旧点 |
| normalized / face routing | 24 次 conversion 与实际消费点零差，重获使用 face ID 1 |
| 外部点实际消费 | 24 次 conversion、24 次 restoration，13 请求按顺序成功 |
| 最终 7 帧 RGBA | 全部 `changed_pixels=0,max_delta=0,bbox=null` |

实际 CPU 环境：Torch 未安装/未导入，ONNX Runtime 1.22.1、NumPy 2.5.3、Pillow 12.2.0。只给原私有 ORT 环境补了 Pillow，没有改变产品依赖或 ONNX 版本。浮点策略及点位/像素零差门槛均保持原值。

两个 160 调用仍是同一图、同一裁剪几何的冷启动/无脸后重获，不能计作两个人或两种姿态。七帧为正脸、轻微移动、镜像、无脸、重获、零效果、半强度，时间范围 0–0.2 秒；不是分钟级真实运动覆盖。

研究参数为 `face_adjust_eye` 原始 intensity 1 / 0 / 0.5；按 `/100` 展示规则对应 100 / 0 / 50。100 超过普通产品精修滑杆最大值 50，仅保留固定探针控制值，不改变产品参数范围，也不把该测试等同于产品滑杆 50。

非零效果控制不是空跑：原图到候选的变化像素分别为 43,893、43,565、44,022、0、43,698、0、42,469。无脸、零效果为 0。对基准的七张 `frame-XX-diff-gain8.png` 均全黑；已人工查看四列对比图。

证据 SHA-256：

```text
replay/report.json   d56c1f51c4e22ac1e60c80f85b553a524c6be739500cf8542dedb80d7fc89b6e
render/report.json   5392992411e60a1bb5510907ed23e444046c59a7a56fc58f60fbb38e95a90bf0
comparison-sheet    de344e164d3a8c816cd928c87fe04024aee50700390892d36a30c849f8644e01
replay.json          bc7b33cfa535b27bf3939a7ceebcd4be79e618a85571f39edf55d0dc342fe7ae
```

本轮早期 R1/R2 新链已通过；随后补关联拒绝条件、模型/报告哈希锁定、renderer normalized-point gate、最终 guard 验收标记撤销和空模型哈希拒绝，再执行模型和 renderer，最终以 R4 为准。旧 direct-affine 失败及旧 R5 debugger unexpected stop 的未定位风险仍保留，不被本轮成功消除。

## 回归与边界

最终 CPU 回归 **611 tests passed**：新输入桥 36、采集证据 44、replay 44、renderer 31，共 155 新测试；已有预处理/采样/几何 242 和模型/初始化/时序/消费 214，共 456 回归。三个子任务均已关闭，本轮模型与原生宿主进程均已退出。真实 ONNX 与真实 renderer 的上述验收独立记录，不以合成单元测试替代。

新增测试实际发现并修复两类缺口：bool/float 伪装的 inference 和 marker window 关联；最后文件 guard 失败但报告保留像素通过/完成标记。空模型 SHA 也必须拒绝，不能把 `None` 当无须校验。guard 失败撤销完成、几何/最终点、外部消费和像素验收字段，保留原异常与 guard 失败记录。

新 155 项可独立复现：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/tflite/venv/bin/python -B -m unittest \
  face_preprocess_chain_inputs_test face_preprocess_chain_capture_test \
  face_preprocess_chain_replay_test face_preprocess_chain_render_test
```

没有修改前端，没有重新运行产品 Electron E2E、全仓库测试、CI 或发布。之前产品 E2E 的成功不算本轮实时 driver 验收。

| 仍需原生提供 | 本轮已用 QCut 自有实现 |
| --- | --- |
| 完整输入画面到 algorithm RGBA | algorithm RGBA 到 BGR/crop/resize/int8 |
| 检测框、裁剪分支、tracking/detection matrix、表和路由信号 | 120/160 ONNX 执行、解码、seed、平滑公式和归一化 |
| 人脸检测/身份/跟踪、接受/重置状态 | 使用实际身份的精确 replay payload，未独立生成身份 |
| 效果包、遮罩/网格等其余数据及效果渲染器 | owned buffer 交接、外部点实际消费与恢复验证 |

模型和效果资产仍是原转换/私有资产。运行库依赖、模型资产来源/授权和跨平台能力是三个不同问题；本轮像素一致不证明可再分发或 Windows/x86 可用。

## 下一步

1. 明确完整编辑画面到 algorithm RGBA 的格式、缩放、stride、旋转和 decoded frame PTS，逐阶段捕获并独立重放；不要把算法图当任意输入驱动已经接通。
2. 将 native detector/Rect/flags/matrix/identity/reset 等剩余依赖形成显式实时契约，再扩展不同脸、姿态、尺寸/旋转和连续帧 profile。
3. 无软件断点/内存写入的观察中立性仍需零差；修改采集源后必须 fresh capture。旧 50 source 及旧证据继续锁定。
4. 只有真实任意输入 driver 完成后才注册 candidate provider，并申报准确 `nativeDependencies`、source/frame/time/backendVersion；保持模型/最终像素门槛。
5. 再做新的真实 QCut preview/export E2E、分钟级视频、多脸和跨平台验收。当前 candidate provider 仍 `not-connected`，未启用产品替换。

## 复现

在 `qcut/` 目录，使用新的输出目录：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_preprocess_chain_replay.py \
  --capture .local/jianying-model-pytorch/face-160-preprocess-host-20261003-r6 \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out .local/jianying-model-pytorch/face-preprocess-chain-replay-next

env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_preprocess_chain_render.py \
  --capture .local/jianying-model-pytorch/face-160-preprocess-host-20261003-r6 \
  --candidate .local/jianying-model-pytorch/face-preprocess-chain-replay-next/replay.json \
  --out .local/jianying-model-pytorch/face-preprocess-chain-render-next
```

变更新链 source 后必须重新运行 replay，再运行 renderer；不跳过 candidate source/hash guard。私有 capture/tensor/model/runtime/effect/原始素材与 PNG 只留本地，不提交 Git。
