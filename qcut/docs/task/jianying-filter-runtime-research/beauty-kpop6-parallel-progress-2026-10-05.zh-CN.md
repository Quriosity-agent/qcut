# beauty-6-kpop：三线并行推进记录

日期：2026-10-05。分支：`beauty-6-kpop`。
起点：`ce2aeb1371d102e0ea5d19dd87b7d17f3b056c2f`。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。
前置：[Extra 精修与三张口红零差异](beauty-kpop6-extra-refinement-2026-10-05.zh-CN.md)。

## 范围

本轮将美妆覆盖、真实视频入口、内层裁剪几何取证拆给三个独立 agent，主线程集成和串行原生验证。
不是三套独立产品后端；产品候选入口仍保留开发版、macOS arm64、静态图门槛。
不提交人物素材、模型、权重、效果包、原始反汇编或原生进程日志。

**首批结果：新增 9 组美妆零差异；8 个真实连续帧的有限链路通过；四份内层裁剪边界快照通过。
小脸/下颌线 6 例仍缺消费接管，24 帧仍遇调试器停止，完整独立几何没有实现。**

| 方向 | 实现责任 | 验收边界 |
| --- | --- | --- |
| 美妆/脸型 | `beauty_dual_isolated_matrix.py` | 每个控制项、人物使用独立冷启动；继续普通失败，遇到不明清理状态或依赖变化立即停止 |
| 视频 | `face_live_video_probe.py` | 真实视频的 2-24 个连续帧；验证源 PTS、解码 RGBA、候选回调和最终输出，不等同分钟级或产品验收 |
| 几何 | `face_extra_crop_trace.py` / `face_extra_crop_geometry.py` | 只读记录裁剪前后状态并列出仍缺的证据，不把原生输出矩阵标记为自主重建 |
| 集成 | `face_live_extra_trace.py` | 只在显式 `--trace-extra-model` 时记录两侧 crop_geometry；候选不读取这些诊断文件 |

源码各自独占修改。原生 GPU/LLDB 串行占用明确 lease；测试期间冻结所有非 `_test.py` 研究源码。
单文件提交、逐次 push，不把多文件一起提交。

## 已确认的路径差异

本机效果包的静态检查表明：

- 小脸 `face_adjust_YouTaiFace` 使用 `FaceReshape` 和 `FaceReshapeLiquefy`。
- 下颌线 `face_adjust_XiaHeXian` 包含 `FaceWarpXRenderer` 和额外阴影美妆组件。
- 此前柔和粉口红的消费证明针对 `FaceMakeupSystemV2`，不能直接推广到以上控制项。

因此批量入口必须显式选择 `face` 或 `makeup` 消费路径，不根据中文标签猜测。
静态脚本/组件名称只说明应当调查的路由，不构成候选已被该渲染器消费的证明。

## 数据与防误报

- 矩阵保存不可覆盖的计划、逐项 checkpoint、catalog/参数/人物/源码 hash 和独立 audit。
- 缺结果保留为失败，不使用原生输出充当候选输出；不放宽逐像素零容差。
- 视频从 ffprobe JSON 取得实际 PTS/time_base，保留源时间，仅为现有桥接入口减去第一帧 PTS。
- ffmpeg 不补帧、不缩放、不自动旋转；PNG 解码成 RGBA 后与独立 framehash 收据逐帧核对。
- 六次 warmup 只是宿主预热，不算新增视频帧，也不用于声称测试时长。
- 几何快照只在已停止的目标上读取固定范围，不新设软件断点，不写目标内存，不执行目标函数。
- 最终效果对原图的变化必须另算，候选与原生相等不代表效果确实生效。

## 本轮实测

以下目录均在 `.local/jianying-model-pytorch/`，不会上传到 Git。

### 内层裁剪诊断

`beauty-kpop6-parallel-geometry-20261005-r4` 完整原生执行通过，仍是微笑正脸柔和粉口红 +80。
候选/原生输出保持零 RGBA 差异，完整消费证明、清理和依赖校验通过。
两次 prediction 的 before/after 共四份 `crop_geometry` 快照采集成功。

| prediction / 边界 | inner filter first | current / previous / delta 个数 | 几何缓存 ready |
| --- | --- | --- | --- |
| 0 / before | true | 212 / 0 / 0 | false |
| 0 / after | true | 212 / 0 / 0 | true |
| 1 / before | true | 212 / 0 / 0 | true |
| 1 / after | false | 212 / 212 / 106 | true |

该样本 inner filter count=106、alpha≈0.2、scale≈2.6666667；仅是观测值，不硬编码成通用默认参数。
每份快照读取 10,313-13,705 bytes、68-73 次，低于 32 KiB/128 次边界。
`face_extra_crop_geometry.py --observer <r4>/live/observer.json` 确认两次均
`boundary_copies_available=true`、`missing=[]`，但 `reconstruction_ready=false`、
`owned_geometry_enabled=false`、`geometry_parity_verified=false`。
这里的 missing 只统计本探针约定的边界字段，不表示所有独立实现所需证据已经齐全。
还需直接绑定内层滤波/computeTransform 的实际调用参数、缓存分支和浮点指令顺序。

真实环境发现并修复两处探针集成问题：

1. r1：LLDB 自带 Python 无 NumPy，探针间接导入数值分析模块导致失败。
   将共享 ABI 常量拆到纯标准库 `face_filter_abi.py`，目标读取与离线 NumPy 审计分离；
   新增 `python -I -S` 无 site-packages 导入回归，未向 LLDB 安装依赖。
2. r2/r3：内联 NewAlign AutoVector 的有效容量实际可为 212，不只合成测试中的 264。
   加入真实容量分支及“只读 212 个 float，不读剩余存储”的测试；指针、计数和上限仍严格校验。

三个失败目录保留，不计为通过，也不以原生最终点作为候选输入。

### 真实视频入口

`beauty-kpop6-parallel-video-prepare-20261005-r1` 的 CPU 解码验证通过：
AV1、854x480、30000/1001，24 个不同帧，23 次相邻变化，实际 PTS 跨度约 0.767433 秒。
源文件为 `output/qcut-ytdlp-news-transcribe-20260517-010630/news.mp4`。
首帧为新闻片中的正脸近景；帧像素不同不等于已经覆盖明显转头、眨眼或遮挡动作。

首轮真实候选 `beauty-kpop6-parallel-video-20261005-r1` 未通过：
在 45 次预测回调时，宿主停于 `poll` 栈中的 `EXC_BREAKPOINT`，worker 随后收到截断连接。
保留了前 16 个非预热帧的输出，但不能把这些部分结果计为完整视频验收。
清理和依赖校验通过；没有忽略调试器停止或开启候选产品后端。

相同 24 帧的 r2 也未完成，10 次预测时停在 `FsNew_DoPredict` 的 `EXC_BREAKPOINT`，
未据此声称调试器不稳定已修复。随后 8 帧定位运行 `beauty-kpop6-parallel-video8-20261005-r1`
完成 28 次预测、26 次转换/恢复，无意外停止，却被效果活性验收拒绝：
视频入口使用旧参数名 `face_adjust_eye`，当前固定大眼包实际需要 `face_adjust_EnlargeEye`。
已按此前大眼 +40 原生用例修正并添加独立的 manifest 参数键测试；仍要求效果确实改变原图。
这次拒绝避免了“双方都无效果而像素相等”的假通过。

修正后的 24 帧 r3 在第 59 次已记录预测附近再次因 `FsNew_DoPredict` 的 `EXC_BREAKPOINT` 停止，
仍不通过。没有通过忽略异常、放宽完整性或减少预定用例数把这次失败改成成功。

另开有限范围的 `beauty-kpop6-parallel-video8-20261005-r2`，**8/8 帧完整通过**：

- 源 PTS 跨度 `7007/30000` 秒，约 **0.233567 秒**；8 个不同帧、7 次相邻变化。
- 6 次宿主预热另计，共 28 次预测、26 次转换和恢复，完整回调/所有权/清理检查通过。
- 八帧候选对原生 RGBA 全部零差异；效果对原图变化像素分别为
  7640、7738、7761、7792、7951、7924、7867、7980。
- 比较页 `beauty-kpop6-parallel-video8-report-20261005-r1/index.html`：8 行、48 张 PNG，`EXACT=8`。
  已目视核对最后一帧：变化位于眼部，原生/候选差分全黑。
- 这是新鲜短序列的有限通过，不能覆盖或取消三个 24 帧失败；
  `temporal_sequence_acceptance=false`、`product_parity_verified=false` 保持不变。

### 美妆/脸型矩阵

首批为珊瑚裸口红、毛流眉、猫眼眼线各三个人像，以及小脸、下颌线各三个人像。
每例独立冷启动。`beauty-kpop6-parallel-makeup-20261005-r1/matrix.json` 的 **9/9 通过**，
均有 Extra 审计、渲染器消费证明、正确清理和依赖校验，最终 RGBA 零差异。

| 人像 | 珊瑚裸口红 +80 | 毛流眉 +80 | 猫眼眼线 +80 |
| --- | ---: | ---: | ---: |
| 微笑正脸 | 3793 | 3250 | 747 |
| K-pop 正脸 | 11447 | 18190 | 6096 |
| 户外人像 | 7152 | 10178 | 2560 |

表内为效果对原图的变化像素数；每格的候选/原生差异像素数和最大通道差均为 **0**。
不是关掉效果得到的相等。比较页 `beauty-kpop6-parallel-makeup-report-20261005-r1/index.html`：
9 行、54 张 PNG，`EXACT=9`、所有 `issues=[]`。已目视核对 K-pop 眉妆及差分，
效果变化集中眉毛，候选/原生差分全黑；灰度增益仍为固定 8，Alpha 单独核对。

连同前一轮柔和粉口红三例，目前这个严格 Extra 冷启动路径覆盖 **4 张卡 × 3 人像 = 12/84**。
剩余 72 组未在本路径验收，不能称为 72 个故障；也未验收这些卡的全部强度、动态视频或产品 UI。
baseline 是研究宿主调用固定原生库，不冒充本轮剪映 GUI 新导出。

`beauty-kpop6-parallel-face-20261005-r1/matrix.json` 的 **6/6 未通过**，六例均实际独立执行：
`live prediction missing or not consumed by renderer`。
读取探针可以观察原生 getter 调用，但记录没有所需的候选消费证明；不会把 getter 命中当成接管成功。
所有失败均正确清理、依赖未变，其他用例没有被首项失败阻断。
失败比较页：`beauty-kpop6-parallel-face-report-20261005-r1/index.html`，`MISSING=6`。

下一步对脸型应定位并接入它们各自真实的消费入口，完成候选发布、点读取、GPU 完成后恢复的闭环，
之后再比较点位和像素；当前没有依据把这六例归因于 ONNX 精度。

## 回归与复跑

最终完整 CPU 回归 **555 项通过，0 skip**。包含前置文档列出的 406 项，以及
`beauty_dual_isolated_matrix_test`、`face_live_video_probe_test`、`face_extra_crop_trace_test`、
`face_extra_crop_geometry_test`、`face_live_extra_crop_integration_test`、`face_temporal_smoothing_test`。
真实模型使用前置文档的环境变量；原生运行独立计数，不混入单元测试数量。

批量入口要求绝对路径，默认只准备数据。`--execute-native --lease <parent-lease>` 才启动原生：

```bash
python -B research/local-model-pytorch/beauty_dual_isolated_matrix.py \
  --catalog <absolute-catalog.json> --portraits <absolute-portraits.json> \
  --runtime <private-runtime> --models <base-models> --extra-root <extra-models> \
  --route makeup --case makeup-lip-coral-nude-p80 \
  --case makeup-brows-fluffy-p80 --case makeup-eyeliner-cat-p80 \
  --out <new-absolute-directory> --execute-native --lease <parent-lease>

python -B research/local-model-pytorch/face_live_video_probe.py \
  --source <news.mp4> --ffmpeg /opt/homebrew/bin/ffmpeg --ffprobe /opt/homebrew/bin/ffprobe \
  --frames 24 --runtime <private-runtime> --package <base-eye-package> --root <base-models> \
  --stable-host --out <new-directory> --execute-native --lease <parent-lease>
```

上面的 python 指 `.local/jianying-model-pytorch/face-heads-runtime122/bin/python`。
具体模型/素材/包路径见本地 `matrix.json` 的 `probe_args` 和视频报告，不在命令中猜测资源版本。
复跑必须使用新输出目录；不得覆盖旧失败、并发启动 GPU 或在运行时改研究源码。

## 尚未完成

三条线都有原生依赖。即使有限静态或连续帧通过，也不自动开放产品时间线后端。
后续还需全部美妆卡和强度、多脸/遮挡/消失重入、seek/reset、真实取消清理、分钟级吞吐、
预览/导出一致性和跨平台验收。独立检测、内层几何、附加点/遮罩、效果渲染仍需分别替换和验证。

下一批三线仍可并行：

1. 美妆继续其余 24 张卡；脸型单独定位 `FaceReshape` / `FaceWarpXRenderer` 的消费、克隆和恢复接口。
2. 视频先定位 LLDB 未分派为正常回调的硬件断点停止；不得盲目 continue 或豁免失败。
   固定 24 帧稳定复测后，再扩明显转头、遮挡和更长序列，不直接跳到分钟级。
3. 几何利用 r4 的双侧状态，捕获内层实际调用输入输出，再实现滤波和仿射，逐 float32 位比较。
   完成前继续把 forward/inverse 列为原生依赖，不用拟合原生输出矩阵替代独立计算。

本轮未运行 Electron 产品 UI E2E、全量产品 CI、跨平台验收，也未创建/合并 PR 或触发发布。
