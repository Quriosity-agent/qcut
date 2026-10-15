# 1080p 动态美体预览／导出验收

日期：2026-10-15。分支：`codex/body-beauty-research`。基于 `e00c51052e60bce55b3f7a0d8ffceb54715493fa`，实跑使用本分支未提交代码的重新构建产物。

## 本轮改动

手动美体原来被 native source-window 策略排除，即使 `manualBody` 只是保留零值区域几何。这使手动、智能＋手动无法进入与导出共用的精确暂停合成路径。现允许它们进入源帧历史重放；每张历史原帧完整执行 `manual-stretch → manual-slim → manual-zoom → body` 后，再处理目标帧。

智能 body 包冷启动得到原样输出时，现在与需要跟踪的 face 包一样允许请求历史恢复。手动网格的合法原样输出不触发骨骼恢复。历史帧禁用缓存读写，目标帧禁用旧缓存读取，跳转或失败后重建 scope，避免沿用不同播放顺序的状态。

固定参数的手动工具在历史帧上沿用相同区域几何。本轮没有新增美体强度／区域关键帧；场景中的关键帧属于媒体缩放与裁剪。取消请求会丢弃迟到结果，下一次请求重新建立历史；IPC 尚不能中途打断正在执行的原生 GPU 工作。

## 实际场景与验收方法

- 真实 1080×1920 单人走动、转身视频，原始 24000/1001 fps、13.179833 秒、316 帧、无音轨。
- 测试取前 6 秒，1080×1920、30 fps 时间线，预期每路 180 帧。源帧率转换会重复部分帧，不增加运动细节。
- 两个剪辑片段，缩放与 cropLeft 关键帧，其他裁剪值及 1 秒居中叠化转场；各路保持相同时间线构图。
- 四路：无美体基线、智能、手动、智能＋手动。智能为瘦身 40／瘦腰 35／长腿 35；手动同时启用拉长 20／瘦身 25／缩放 15。
- 暂停预览取帧 `0,15,45,75,90,105,135,179`，操作顺序为 `0→179→135→105→90→75→45→15`，覆盖倒序跳转和转场前、中、后；交替选择和取消选择片段。
- 捕获真实 `exportLocalVideo` / muxer 导出编码前 Canvas；分别与实际 UI 的 1:1 截图、实际提交的 composition PNG 对比，RGB 最大差 ≤1、Alpha 差 0，不缩放、不对齐、不调色。
- 各效果必须与无美体基线存在采样 RGB 差异；叠加还必须分别区别于仅智能及仅手动，防止遗漏一条效果链。
- MP4 独立完整解码，并核对实际帧数、尺寸、帧率和全部 PTS；有损编码差异另记，不宣称 MP4 与 PNG 逐字节相同。

素材来源：[Mixkit 1221](https://mixkit.co/free-stock-video/a-young-womans-portrait-at-the-beach-1221/)。本地原文件 SHA-256：`d1f6593f61723b2a838c8bc962533d192f3071b92f0035a71fa601ca63b471f4`，与保存的来源记录一致。白裙遮挡自然腰胯轮廓，不能由此验收所有体型或瘦腰审美。

## 验证入口

```sh
QCUT_BODY_COMPOSITE_SOURCE=/absolute/path/to/1080x1920-source.mp4 \
QCUT_BODY_COMPOSITE_OUTPUT=/absolute/path/to/fresh-evidence-directory \
bun run test:e2e:bg apps/web/src/test/e2e/body-composite-consistency.e2e.ts \
  --project=electron --reporter=line

python scripts/compare-body-timeline-evidence.py /absolute/path/to/evidence-directory
```

需要已构建 Electron/Web、可用的本机原生美体运行库，以及安装 Pillow、NumPy 的 Python 和 FFmpeg/FFprobe。不得将缺少源视频而跳过的 E2E 当作通过。输出目录须新建；既有 MP4 不覆盖。

2 秒 smoke 可额外设置 `QCUT_BODY_COMPOSITE_SECONDS=2`、`QCUT_BODY_COMPOSITE_SAMPLES=0,15,30,59`、`QCUT_BODY_COMPOSITE_PASSES=smart,manual`。正式分析器始终要求四路完整证据；`--png-only` 仅生成诊断，不能声明视频完整通过。

本机证据根目录：`.local/jianying-parity/body-video-consistency-20261015-r1/`。来源、原生运行库、MP4 和 PNG 均保持在私有本机目录，不纳入 Git。

## 结果

正式四路 E2E 已完成，流水线退出码为 0，采集状态为 `captured`，分析器结果为 `PASS`／`overall_verified: true`。本次通过的是 **1080p 暂停定位采样预览与编码前导出的一致性**，不包含连续实时预览验收。

| 路径 | UI／导出最大 RGB 差 | 合成画布／导出最大 RGB 差 | 最大 Alpha 差 | MP4 完整解码帧数 | 本次导出耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 无美体基线 `original` | 0 | 0 | 0 | 180 | 3.474 秒 |
| 智能 `smart` | 1 | 1 | 0 | 180 | 926.621 秒 |
| 手动 `manual` | 1 | 1 | 0 | 180 | 2253.509 秒 |
| 智能＋手动 `combined` | 1 | 1 | 0 | 180 | 3185.696 秒 |

共 4 路 × 8 个采样帧 × 2 种预览 = **64 组 PNG 比较全部通过**。三个效果路径的每个采样帧均与无美体基线存在 RGB 差异；叠加路径的 8 个采样帧也分别区别于仅智能、仅手动。该检查排除了整条效果链没有输出变化的情况，但不证明每个滑杆的独立作用或形体审美正确。

四路 MP4 均完整解码为 1080×1920、30 fps、6 秒、180 帧；全部 PTS 严格递增且四路完全一致，从 0 到 5.966667 秒。表中耗时为此机器上实际导出请求的墙钟时间，包含 native source-window 历史重放；该路径明显缓慢，不能作为实时性能验收或连续播放速度结论。

编码前 PNG 与 H.264 MP4 解码后的同编号采样帧另做诊断，未缩放或对齐。以下范围取各路径的 8 个采样帧；RGB 值按 0–255 量级，PSNR 单位为 dB。

| 路径 | 每帧平均绝对 RGB 差范围 | 每帧最大 RGB 差范围 | 每帧 RGB 差 P99 范围 | PSNR 范围 |
| --- | ---: | ---: | ---: | ---: |
| `original` | 2.223–2.767 | 42–68 | 8–12 | 36.447–38.745 |
| `smart` | 2.170–2.668 | 42–66 | 8–11 | 36.810–38.995 |
| `manual` | 2.070–2.479 | 34–60 | 7–10 | 37.643–39.523 |
| `combined` | 2.043–2.461 | 31–54 | 7–10 | 37.718–39.668 |

这些是有损编码／色彩转换差异，不能与前表的预览／导出渲染误差混为一谈，也不构成 MP4 像素相同的结论。

实跑记录中 `pageErrors` 为 0、`beautyWarnings` 为 0；另有 **132 条 console error**，内容均为 `Failed to load resource: the server responded with a status of 401 ()`。现有记录未标明请求来源，保留为未归因的 HTTP 401 资源错误，不宣称控制台无错误。

已完成的代码检查共 **160 项**：原生时序与前端 adapter 7 套件 107 项、场景／原生请求契约 18 项、Python 新旧分析器 35 项全部通过。覆盖历史帧实际 stage 输入、冷启动、合法零差、失败恢复、回跳、取消后的结果丢弃、旧人脸场景兼容，以及不完整／遗漏组合效果的假阳性拒绝。

Web 与 Electron 构建、两侧应用类型检查及修改文件 Biome 通过。单独对 E2E helpers 做严格类型检查仍有未修改 `electron-helpers.ts` 的 8 条既有诊断；与仅编译旧 helper 的基线逐字一致，新 harness 没有新增诊断。完整命令、日志、源码 hash 与基线比较保存在 `verification/`。

本机对照页：[原图／效果／差分与四路视频](http://127.0.0.1:58738/review/index.html)。该页面依赖本机服务；其中“原图”保留相同时间线构图，展示的效果差分与预览／导出差分分别标注。

最终收据确认 6714 个记录的构建文件保持不变，4 个本轮生产源码文件与构建记录匹配，素材 SHA-256 再次核对一致，E2E Electron 已退出；清单保存了 302 个证据文件的哈希。对照页另完成 9 张 1080×1920 图片加载、4 路 6 秒导出视频加载／播放／暂停及 135／45 帧选择检查；页面视频播放检查不代替 QCut 连续预览验收。

私有验收文件：

- [四路 PNG 与完整解码指标](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/body-comparison/metrics.json)
- [E2E 原始记录、导出耗时与控制台错误](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/e2e-evidence.json)
- [MP4 编码差异诊断](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/encoded-sample-deltas.json)
- [本地对照页文件](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/review/index.html)
- [最终验收收据](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/acceptance-receipt.json)
- [证据文件哈希清单](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/manifest.json)
- [对照页浏览器检查记录](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/main-6s-r1/review/browser-qa.json)
- [测试、类型检查与构建验证记录目录](/Users/peter/Desktop/code/qcut/qcut/.local/jianying-parity/body-video-consistency-20261015-r1/verification/)

## 范围

本轮验证 QCut 调用本机原生运行库的智能／手动美体，并非剪映 UI 独立导出对照，也没有自研美体输出。像素验收仅覆盖上述采样暂停画面；完整视频解码不等于全部帧预览像素验收。

连续播放是独立路径：`preview-panel.tsx` 在播放中关闭精确合成，`ColorPreviewCanvas` 使用 RAF 与串行异步绘制，忙时合并后续请求。该路径没有传 `source-window` 模式，采用 recovery 跟踪；失败时可能降级到原图。因此本轮不能推广为连续播放和导出逐帧一致，仍需效果更新 FPS、延迟、跳帧、播放／暂停切换、转场双层同步和降级检查。播放层的 `applied` 状态也不足以证明实际输出了效果。

多人、遮挡后恢复、不同体型与服装、长时抖动／内存增长、复杂背景保护、音画同步、连续播放实时性能仍需独立验收。素材没有音轨，因此这轮不能验收音画同步。
