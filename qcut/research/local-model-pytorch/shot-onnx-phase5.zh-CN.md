# Phase 5：可部署的 ONNX 本地分镜链路

日期：2026-09-19。此文件记录 ONNX 视频入口；整体进度与其他网络分别见本目录 Phase 5 文档。

## 做了什么

- `qcut analyze shots --engine onnx`：显式选择本地 ONNX，不启动剪映，不导入 PyTorch，不调用云端。
- `--engine onnx --check`：独立检查 Python、NumPy、ORT、模型契约和模型文件，不要求 Apple Silicon 原生 runtime。
- 默认 `bridge`、已有 `torch` 和 `both` 行为不变。ONNX 失败时不自动回退。
- `package.json` 只分发五个脚本/依赖清单，不分发私有 ONNX、字表、厂商库，也没有自动下载或安装 Python。
- 时间线编辑器的显式 ONNX 菜单复用场景检测接口和拆分/撤销逻辑。编辑器实测记录另列，不能用本文件 CLI 测试冒充 UI E2E。

## 部署约定

纯运行依赖 `requirements-onnx-runtime.txt`。本次实际使用 Python 3.12.12、NumPy 2.5.3、ORT 1.30.0、CPU provider、关闭 ORT 图优化。

```sh
export QCUT_JIANYING_SHOT_SPLIT_ONNX_PYTHON="/absolute/path/to/python"
export QCUT_JIANYING_SHOT_SPLIT_ONNX_CONTRACT="/absolute/path/to/shot/contract.json"
bun run qcut analyze shots --engine onnx --check --json
bun run qcut analyze shots --engine onnx --input /absolute/path/video.mp4 --output /absolute/path/shots.json --json
```

启动桌面编辑器的进程也要继承这两个环境变量。环境变量缺失会显示配置错误，不会上传视频。

允许的源 bundle SHA256：`98da44a79ddbeeb25ea73a087074fc10bc81d12c7c109c6920f12cd317acdaf2`。

允许的 ONNX SHA256：`6cb814bb30d7dcaf12af5de4a8d09506bca52731e2523862e22c26a364400a96`。

契约必须是已通过的 `qcut-private-shot-pytorch` 导出，输入 `frames: float32[7,3,96,96]`，输出 `features: float32[7,128]` 与标量 `probability`。实际图的名称、形状、dtype、provider 和文件摘要都重新验证。篡改元数据不能替代文件摘要校验。

## 从视频到切点

1. FFprobe 验证视频与时长，采样尺寸沿用默认 320×180，默认 24 fps。
2. FFmpeg 逐帧输出 RGB24，按整帧精确读取；残缺帧、空视频和非零退出码都失败。
3. NumPy FP32 half-pixel 双线性缩放到 96×96，round-to-even，再转换为 `RGB / 127.5 - 1`。
4. 仅保留最近七个模型输入；从源帧索引 7 开始预测，概率归到 `f - 3`。首个预测窗口是 1…7，不是 0…6。
5. 复用 `shot_postprocess.py`：严格大于 0.35 的局部峰值、平台尾部选择、相邻像素差的一帧修正。
6. 切点帧代表前一镜头最后一帧；新镜头时间为 `(cutFrame + 1) / fps`，不是 `cutFrame / fps`。

最大 86400 个采样帧；JSON 输出最多 8 MiB；解码错误尾部最多 64 KiB；进程最多 30 分钟。保留七帧图像不意味着完全恒定内存，概率和相邻帧差仍按帧数增长，但受 86400 帧上限约束。

取消采用 AbortSignal。POSIX 先发送 SIGTERM，让 Python 回收 FFmpeg，必要时升级 SIGKILL；Windows 使用 `taskkill /T /F` 回收进程树。Windows 的实现存在不代表已经做过真实视频取消验收。

## 已执行的真实视频测试

私有证据目录：`.local/jianying-model-pytorch/phase5-shot/`。

| 输入 | 采样 | 实际帧数 | 切点 | ONNX 时间 | 与原 PyTorch 视频路径切点一致 |
| --- | --- | ---: | ---: | ---: | --- |
| 6 秒人物/人脸交替剪辑 | 12 fps | 72 | 3 | 0.51 s | 是 |
| 同上 | 24 fps | 144 | 3 | 1.03 s | 是 |
| 6 秒人脸参考片 | 12 fps | 72 | 2 | 0.53 s | 是 |
| 同上 | 24 fps | 144 | 2 | 1.04 s | 是 |
| 循环拼接的约一分钟片段 | 12 fps | 721 | 39 | 5.15 s | 是 |
| 同上 | 24 fps | 1442 | 39 | 10.93 s | 是 |

一分钟片段通过 stream-copy 截取后实际为 60.083333 秒，不虚报为精确 60 秒。它是循环内容压力测试，不是 60 秒独立真实内容。两个原素材是本地人物/人脸参考片；本轮不是人工标注分镜质量评测。

`e2e-report.json` 保存逐 case 输入 SHA、切点、概率误差、像素差与取消结果。POSIX 取消测试观察到 FFmpeg 子进程，Python 退出 130，退出后该子进程已不存在，未输出成功 JSON。

另用不含 torch 的独立虚拟环境运行真实 `bun run qcut analyze shots`：一分钟片段 1442 帧、39 切点、11.685 秒，结果为 `cli-60s-no-torch.json`。此时间包括 QCut 主进程准备、FFprobe、Python 启动及推理，不与纯张量耗时混用。

## 必须保留的精度边界

新预处理命名为 `numpy-fp32-half-pixel-round-even-v1`，**不是 PyTorch 插值的逐位复刻**。6 组测试出现少量 round 边界差，最大单通道差 1；人脸 case 概率最大绝对差约 `4.12e-4`，超过单张量门槛 `1e-4`。

因此本轮结论是：这些视频的完整切点和帧数一致；不能据此声称全链路概率精度全部过门槛，更不能声称剪映任意视频效果等价。模型同输入张量的 ORT/PyTorch 验证沿用 Phase 4，和含预处理的测试是两件事。默认引擎没有改为 ONNX。

## 回归与复现

```sh
$PY -m unittest discover -s research/local-model-pytorch -p shot_onnx_test.py -v
bunx vitest run electron/__tests__/jianying-shot-split-onnx.test.ts electron/native-pipeline/cli/__tests__/cli-handlers-analyze-shots.test.ts
$PY research/local-model-pytorch/shot_onnx_e2e.py \
  --contract /absolute/path/shot/contract.json \
  --model /absolute/path/shot-split.pt \
  --video /absolute/path/montage.mp4 --video /absolute/path/montage-60s.mp4 \
  --ffmpeg /absolute/path/ffmpeg \
  --out .local/jianying-model-pytorch/phase5-shot/new-report.json
```

最后一个对拍工具需要 torch，因为它在同一机器运行参考路径；部署用的 `shot_onnx.py` 不需要。公共测试不含私有模型或视频，私有对拍需本机已有的通过验证的产物。

仍需：更多独立且人工标注的剪辑、淡入淡出/快速摇镜/闪光边界，真实 Windows 桌面与安装包测试、模型安装管理，以及能证明更强概率一致性的预处理实现。严禁仅依据上述六组视频将默认引擎替换。
