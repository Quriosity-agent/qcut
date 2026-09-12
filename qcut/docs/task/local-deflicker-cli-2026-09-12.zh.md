# 独立本地防闪烁 CLI（2026-09-12）

## 本轮交付

`qcut edit deflicker` 默认通过本地 FFmpeg 处理完整视频，不再要求安装剪映或准备私有运行时缓存。它复用 QCut 实验室预览／导出已有的 `deflicker` 算法及参数映射；本轮新增的是独立命令行交付链，不是新恢复的剪映算法，也没有剪映画质等价声明。

```sh
qcut edit deflicker -i source.mp4 --strength 70 --output source-deflicker.mp4 --json
qcut edit deflicker -i source.mp4 --backend ffmpeg --strength 40
qcut edit deflicker -i source.mp4 --backend jianying --strength 70
```

- 省略输出路径时，写入源文件同目录的 `<原文件名>-deflicker.mp4`。
- 默认后端是 `ffmpeg`；`jianying` 保留原本的私有运行时路径，需显式选择。未知后端直接报错，不静默切换。
- JSON 输出包含 `backend`、`provider`、`route`、实际输出帧数、帧率、尺寸、音轨存在状态及处理强度。独立路径的 route 是 `qcut-ffmpeg-deflicker-v1`。
- UI 现有私有处理按钮、预览和项目状态没有在本轮改动；独立结果可作为普通视频导入 QCut。

## 参数与适用范围

`--strength` 为 1–100 的整数，默认 70。它控制时间窗，不是结果与原图的线性混合百分比：`window = 3 + 2 × round(strength / 100 × 14)`，对应 3–31 帧；70 对应 23 帧。算法使用算术平均亮度。参数合同与现有 [video-lab-filter.ts](../../electron/ffmpeg/video-lab-filter.ts) 相同；算法定义见 [FFmpeg 官方源代码](https://www.ffmpeg.org/doxygen/7.1/vf__deflicker_8c_source.html)。

适合单个镜头的整体亮度闪烁、曝光跳动。当前后端不识别剪辑点，不处理局部滚动条纹，也不区分故意闪光与曝光错误。**多镜头视频应先按镜头拆分后处理。** 场景切换对照实测确认，23 帧窗会跨切点平滑亮度，不能宣称场景切换安全。

输入边界：本地可解码视频、至少两帧、有效视频流时长或容器时长、最高 240fps、偶数尺寸、最大 4096×4096 且最多 8847360 像素。支持明确识别的 8 位 YUV／灰度 SDR 格式；HDR、未知或高位深像素格式、透明视频、隔行视频明确拒绝，避免隐式丢失这些语义。

输出为 H.264、CRF 18、8 位 YUV420P 的 MP4，因此视频是有损重编码。处理第一个视频流，并复制全部音频流的压缩数据；音频不重编码。不兼容 MP4 的音频编码会失败，保留原文件。字幕、附加视频流、附件不包含在输出中。音频流数量自动验证，逐包内容和时间戳比较属于本轮测试证据，不是每次处理都会执行的全量校验。

## 完整性与取消

- FFmpeg 使用 `-fps_mode passthrough`，不指定新的帧率，不用 `-shortest` 截断视频或音频。
- 处理前后通过 FFprobe 解码计数，核对显示尺寸、帧数、音轨数量及时长；时长容差为 50ms 与一帧时长中的较大值。优先核对视频流时长；流时长缺失、为 `N/A` 或无效时使用容器时长，并对输出使用同一容器口径，输入有有效容器时长时还会额外验证容器总时长，防止截短比视频更长的音频尾段。容器回退不等于逐帧时间戳校验。
- 源文件不被修改。两种 CLI 后端共用真实路径身份检查；目标与源文件相同、通过文件／目录符号链接指向源文件，或大小写别名指向同一文件时，即使 `--force` 也拒绝。
- 临时输出放在目标目录旁，验证完成后发布；默认使用同文件系统硬链接原子创建，避免并发写入绕过“不覆盖”检查。文件系统不支持硬链接会明确失败，不退化为可能覆盖的复制。
- `--force` 使用重命名替换完整输出；目标已有文件在取消或处理失败时保留。硬链接目标替换不会改变源文件字节。
- 子进程支持取消，每次 FFmpeg／FFprobe 调用最多 30 分钟，失败或取消后清理本次临时目录。私有后端复制缓存期间也可取消，复制完成后、发布前再次检查取消信号；回归测试实际暂停复制 Promise，验证取消后原目标保留。

## 本轮验证

共 78 项测试通过，包括 8 项真实 FFmpeg 视频测试：受控闪烁移动图形、稳定移动图形、场景切换、覆盖保护、取消清理、源文件链接保护、短于滤镜窗的两帧无声视频，以及音频长于画面的 Matroska（缺少流时长）与 MP4（有流时长）视频。测试路径：

- [参数与校验测试](../../electron/__tests__/deflicker-video-contract.test.ts)
- [真实视频测试](../../electron/__tests__/deflicker-video-native.test.ts)
- [命令分派测试](../../electron/native-pipeline/cli/__tests__/cli-handlers-video-lab.test.ts)
- [参数解析测试](../../electron/native-pipeline/cli/__tests__/cli-parse-video-lab.test.ts)
- [已有滤镜映射回归测试](../../electron/__tests__/video-lab-filter.test.ts)

```sh
QCUT_DEFLICKER_NATIVE=1 bunx vitest run \
  electron/__tests__/deflicker-video-contract.test.ts \
  electron/__tests__/deflicker-video-native.test.ts \
  electron/__tests__/video-lab-filter.test.ts \
  electron/native-pipeline/cli/__tests__/cli-handlers-video-lab.test.ts \
  electron/native-pipeline/cli/__tests__/cli-parse-video-lab.test.ts
```

另外通过真实 CLI 处理 3 组自建 320×180、30fps、4 秒／120 帧视频。以下亮度为解码后的 8 位 Y 通道均值，闪烁指标取第 24–95 帧的相邻帧均值绝对差：

| 输入 | 原相邻帧亮度差 | 处理后 | 结论 |
| --- | ---: | ---: | --- |
| 移动图形、交替 0.8／1.2 曝光 | 36.75 | 1.12455 | 此受控样本降低 96.94% |
| 相同移动图形、稳定曝光 | 0 | 0 | 单帧均值改变量最大 0.000244 |
| 稳定曝光、2 秒处切换明暗场景 | 0.985915 | 0.985915 | 切点附近单帧均值最大改变量 66.375，验证了跨切点不适用的边界 |

三组结果均为 120 帧、4.000 秒，视频包时间戳、音频包时间戳、复制 AAC 音频包的 SHA256 与输入一致。这是可重现的合成视频功能验收，不代表真实摄影素材的普遍改善率、跨平台实机验收或 GPU 加速。

`EVIDENCE_ROOT` 表示自行选定的仓库外证据目录。本机可重放证据：`$EVIDENCE_ROOT/enhancement/`，包含 `verify_cli.py`、`verification.json`、源／结果 MP4、CLI JSON 和测试日志。没有剪映二进制、模型、私有缓存或素材被新增到仓库。
