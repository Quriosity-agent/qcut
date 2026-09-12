# 独立 Metal 滤镜：连续帧传输性能与改进

日期：2026-09-12。目标：通过实际 QCut 自有 Metal 管线定位连续视频瓶颈，并以相同输出证明改动。未加载剪映动态库，未修改 Shader、滤镜参数、采样规则或 Pass 顺序。

## 结果

在 Apple M4 Pro、macOS Darwin 25.6.0、Node 22.22.3 上，瓶颈主要出现在宿主的 C++ 标准流读写。将逐帧协议改用完整块 `read` / `write` 循环，同时避免 JS 接收端对累积帧反复 `Buffer.concat`，显著降低宿主往返耗时。

| 连续帧场景 | 修改前 p50 / p95 | 修改后 p50 / p95 |
| --- | --- | --- |
| 1280×720，迷雾 → 清透美食，强度 100 | 118.087 / 125.838 ms | **6.995 / 7.862 ms** |
| 1920×1080，迷雾 → 清透美食，强度 100 | 269.135 / 292.511 ms | **14.796 / 15.837 ms** |
| 1280×720，同样两个宿主，强度 0 | 113.875 / 122.564 ms | 2.986 / 3.847 ms |
| 1920×1080，同样两个宿主，强度 0 | 261.374 / 267.693 ms | 7.350 / 8.307 ms |

每个尺寸、每个场景使用 3 次新建 session；每次先运行 6 帧，再记录 30 帧，共 90 个稳定样本。各轮使用同一段解码后的移动视频序列。修改前后 **360 个稳定输出帧的 RGBA SHA-256 全部相同**，每个场景的 3 轮输出也完全相同。强度 0 对照逐帧等于输入。

该数字是两个实际滤镜串联的 **Node → 原生宿主 → Node 往返**，包括快照、打包、管道、Metal 提交与等待、读回、接收组装和返回复制。它不包含视频解码、编码、Electron renderer IPC、编辑器合成与显示，不是独立 GPU 耗时，也不能直接宣称整个编辑器或导出提速相同比例。

初次 shader 编译、系统缓存和宿主启动单独记录；未将第一次启动的数据混入稳定样本，也不据此宣称冷启动改善。

## 如何确定改哪一处

1. 先保持原生二进制不变，仅更换 JS 接收组装。Bun 下 720p p50 变化约 2.7%，1080p 基本不变；这不足以宣称明显帧率提升。
2. 两种运行时均显示强度 0 的纯传输对照接近完整滤镜耗时。Node 720p 短测约为 109 ms 与 112 ms，排除了只由 Bun 引起的解释。
3. 私有原生变体只更换标准输入输出读写，Metal 代码不动。Node 720p 短测降至约 3.4 ms 与 7.5 ms，所有帧哈希相同。
4. 用最终实现重新做上述串行 Node 测量，结果见表。测试期间 QCut 界面保持暂停，未同时运行其他本次滤镜 benchmark。

这证明了原生流读写是该路径的主要可消除成本；尚未使用 Metal GPU 时间戳分别测量编码、执行、等待与读回，所以不能给它们分配精确占比。

## 实现范围

- `host.mm`：完整块 POSIX 输入输出；正确处理短读、短写与 `EINTR`。仅在帧与帧之间允许干净 EOF；LUT、头部或像素中途 EOF 仍报错。输出字节与协议 magic 不变。
- `response-buffer.ts`：保留接收分片，响应完整后一次组装。每个接收字节最多复制一次；保持原有最大响应字节限制。
- `session.ts`：使用新接收器；失败或释放时清空分片，忽略后到达的数据。队列、请求快照、身份校验和返回类型保持原有语义。
- `benchmark-independent-metal.ts`：同输入多阶段基准，输出启动、首帧、稳定 p50/p95、逐阶段往返、独立复制对照、逐帧哈希及可播放结果视频。

基准不引入第二套滤镜算法。迷雾 LUT 和清透美食 graph 都经过现有资源／控制文件哈希校验。它们仍是本机私有资源，不随代码分发。

## 仍然存在的成本

两个滤镜仍是两个独立宿主，中间结果仍返回 CPU 后送入下一宿主。1080p 每帧仅两次输入加两次输出就有约 **33.18 MB** RGBA 管道数据，不包含额外内存复制；纹理上传、GPU 读回和 `waitUntilCompleted` 也仍存在。

独立内存复制对照中，1080p 单次快照／打包／返回复制 p50 约为 0.13／0.13／0.18 ms；这是单独微基准，不能相加当作实际帧的精确耗时分解。下一阶段应针对真实多轨编辑、连续播放与导出测量剩余开销，再决定是否值得把多个滤镜合并到同一 GPU 会话。

本轮不扩大到 Windows 后端、零拷贝共享纹理或 GPU 调度重写。

## 重现

从 `qcut/` 包目录执行。准备自有输入素材和**新的输出目录**。下面用 FFmpeg 生成的移动测试画面，没有外部素材依赖：

```sh
ffmpeg -v error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=2.3 \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p /tmp/qcut-moving-720p.mp4

bunx esbuild scripts/benchmark-independent-metal.ts --bundle --platform=node \
  --packages=external --format=cjs --outfile=dist/scripts/benchmark-independent-metal.cjs

node dist/scripts/benchmark-independent-metal.cjs \
  --input /tmp/qcut-moving-720p.mp4 --output /tmp/qcut-metal-benchmark \
  --frames 30 --warmup 6 --repeats 3
```

将尺寸改为 `1920x1080` 即可测 1080p。基准拒绝静态重复帧、过短视频、超过宿主尺寸限制或超过 768 MiB 解码缓存的输入。视频按 FFmpeg 自动旋转后的宽高处理；另外验证了带 90° 显示矩阵的视频，解码与保存均为 720×1280，避免将相同字节数误解为相同排布。

纯 CLI/Bun 路径也可直接执行 `bun scripts/benchmark-independent-metal.ts ...`，报告中记录运行时；与 Node 的数据分开看。

比较已有基线：

```sh
node dist/scripts/benchmark-independent-metal.cjs \
  --input /tmp/qcut-moving-720p.mp4 --output /tmp/qcut-metal-after \
  --frames 30 --warmup 6 --repeats 3 \
  --compare /tmp/qcut-metal-before/report.json
```

默认必须是相同宿主二进制、LUT、graph、解码帧哈希、尺寸和采样配置。测量原生宿主代码改动时显式增加 `--allow-host-change`，报告保留两版宿主 SHA-256；其余条件与每个输出帧仍必须完全匹配。性能变化不设脆弱的 CI 数值阈值。

输出包括 `report.json` 和 `filtered.mp4`。保存视频发生在计时后，并用 ffprobe 检查实际宽高和帧数；编码文件哈希与算法输出 RGBA 哈希分别记录。

## 验证与证据

- 35 项相关测试通过，其中包含 4 项真实原生管道测试：LUT／帧头／像素分片、1080p 输出背压、帧间 EOF、头部与像素中途 EOF。
- 接收器测试覆盖分片握手、合并响应、跨响应偏移、数千分片、溢出、清理、失败后数据和取消未完成帧。
- 原有原生 session 测试覆盖透明像素、请求快照、八请求队列上限、尺寸变化与重复输出。
- Electron TypeScript 检查及本次 TypeScript 文件 Biome 检查通过。
- 最终两种尺寸的前后宿主分别为 `fd84b087a114e4737cf33f0b0dfab107e62aa3e20bc12b28515cbe0965e6108d` 与 `4311ea0e861b7702c71368865477509df4cc6995afdc09a99350dec6df93c893`。

私有证据目录：`/Users/peter/Downloads/QCut-Product-2026-09-12/performance/`。主要结果在 `final-before-720p/`、`final-after-720p/`、`final-before-1080p/`、`final-after-1080p/`，测试日志为 `final-tests.log`。原始素材、基线副本、二进制和完整报告不提交到 Git。早期并行探索结果与最终串行结果分开保存，不能混用来做性能结论。
