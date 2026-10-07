# beauty-8-kpop：复合处理、批量对照与连续帧推进

2026-10-08。继续在 QCut `beauty-8-kpop` 工作，PR #487。此记录分别报告执行成功、样本像素阈值、视频时序和安装可用性，不能互相替代。

## 实现与来源

- 固定独立版基线 `24d3dcf179d6c6871d1566725c341358661d98ca` 的工作区快照：261 个导入文件、1,211,533 字节，另有生成的 `src/runtime.ts`，合计 262 个源码哈希固定项。快照包含当时未提交源码，不能称为该 commit 的完整内容。
- 清单 SHA-256：`27728858fe1687c540657977bc31a570146dbdd0e789448f142a10569b9a2750`。保留源文件 `sourceSha256`、安装字节哈希及适配理由：12 个格式适配、同架构 FlowGAN JSON 的哈希重固定、软链接路径归一化和 GPU 测试 fixture 的既有 pigment 顺序更新。
- 32 个数值控制，新增 MouthCorner／CornerEye；仍有 28 张美妆卡。导入六项局部几何组合的共享坐标链、共享 pigment 阶段及它们的实际依赖闭包。22 张 pigment 卡跨七类可以在一次感知后组合；特殊美妆仍走各自已有阶段。
- 原生入口仍返回 `jianying-local-swing-v1`，独立入口仍返回 `qcut-independent-photo-v1`，未把原生操作改为自研，也没有原生兜底。
- `scripts/beauty-lab-matrix*.ts` 保存两路 PNG、差异 ×8、参数、哈希、源清单和逐项结果；支持同源断点续跑。续跑会重新解码两路图片，验证参数、尺寸、输入／输出哈希、独立 PNG 回执并重算指标，不能仅信任旧成功字段。
- `electron/beauty-lab-independent-sequence.ts` 提供最多 300 帧的有界处理、输出回调背压、稳定尺寸、递增时间戳、参数冻结及取消／过期返回检查。尚未接入 QCut 自研视频 UI、时间线或视频导出。

## 照片矩阵实测

本机目录 `.local/jianying-parity/beauty-8-gap-matrix-r2/`。`matrix.json` 为完整结果，`run.json` 保留完整配置、源输入路径和配置哈希，`index.html` 提供筛选和图片对照，`matrix-screenshot.png` 为浏览器实际截图。

四张真实肖像 + 六张合成成年脸样本，最长边 320。首张执行完整边界／美妆／组合矩阵，其余真实肖像执行 stress 组合，合成样本执行 shape 组合。圆、方、长、心形、菱形、椭圆是视觉假设标签，未经人工标注，不能用作脸型识别准确率验收。文件名不证明人物身份或姿态标签。

| 指标 | 实测 |
| --- | --- |
| 计划／完成／两路出图 | 124／124／124 |
| 最大 RGB 差 ≤1 且 alpha 无差异 | 105 |
| 超阈值 | 19 |
| 出图失败 | 0 |
| 非零控制自研完全不改图 | 0 |
| 零参数原图像素恒等 | 10／10 |
| 单张全矩阵肖像的单项美妆 | 28／28 在 ≤1 范围 |

数值边界共 46 例（35 接近、11 超阈值）；复合共 40 例（32 接近、8 超阈值）。MouthCorner、CornerEye 极值在本轮首张肖像上最大 RGB 差 0。合成样本的 shape-features 和 local-six 组合均接近。阈值结果只适用于此次固定输入、参数、分辨率和运行库版本。

### 仍超阈值的 19 项

| 案例 | 最大 RGB 差 | RGB MAE |
| --- | --- | --- |
| portrait-01--control-underjaw-50 | 18 | 0.0147909 |
| portrait-01--control-pointy_chin--50 | 2 | 0.0016259 |
| portrait-01--control-pointy_chin-50 | 2 | 0.0017220 |
| portrait-01--control-cheekbone--50 | 10 | 0.0140029 |
| portrait-01--control-cheekbone-50 | 21 | 0.0128306 |
| portrait-01--control-upper_atrium--50 | 117 | 0.0340329 |
| portrait-01--control-upper_atrium-50 | 93 | 0.0490852 |
| portrait-01--control-mid_atrium--50 | 11 | 0.0140952 |
| portrait-01--control-mid_atrium-50 | 12 | 0.0125154 |
| portrait-01--control-lower_atrium--50 | 14 | 0.0291398 |
| portrait-01--control-lower_atrium-50 | 15 | 0.0207142 |
| portrait-01--face-local | 5 | 0.0086524 |
| portrait-01--skin-shape-lip | 18 | 0.0232818 |
| portrait-01--skin-gan-shape | 9 | 0.0654443 |
| synthetic-square--face-local | 2 | 0.0104655 |
| synthetic-long--face-local | 3 | 0.0115299 |
| synthetic-heart--face-local | 5 | 0.0192839 |
| synthetic-diamond--face-local | 3 | 0.0109505 |
| synthetic-oval--face-local | 2 | 0.0065951 |

最高差异为上庭极值 117。即使全图 MAE 小，也不能据此忽略局部边界偏差。下一轮应先定位 upper_atrium 极值的坐标／采样边界，再处理 face-local 跨阶段重新感知与采样累积；本轮没有降低阈值把这些项改记为通过。

## 连续帧与实际视频

输入为既有真实视频 `output/real-video-native-20261007-r1/media/preview-all-60.mp4`：原始 640×360、60 帧、30000/1001 fps。抽取 24 帧、320×180、12000/1001 fps，使用美白 45 + TotalFace 25 + Nose 15；通过真实独立 provider 连续处理，每帧与真实原生 provider 对比。

输出 `.local/jianying-parity/beauty-8-video-sequence-r1/`：`sequence.json`、`frames.json`、每帧 PNG／原始回执及 `comparison.mp4`。24／24 成功，最大 RGB 差 9，平均每帧 RGB MAE 0.0627358218，alpha 全部无差异。对照视频左原图、中原生、右自研，960×180，24 解码帧，FFmpeg 完整解码无错误。

这验证逐帧执行、顺序、输出与编码；不验证长视频人脸跟踪、遮挡恢复、多人目标锁定、实时速度、音画同步或 QCut 时间线／最终导出的一致性。回执保留 `independentTrackingVerified: false`、`nativeProductParityVerified: false`。

## 签名 macOS 包：通过项与真实失败

构建 `.local/beauty-gap-packaged/mac-arm64/QCut AI Video Editor.app`，约 1.6 GiB。arm64 directory build 完成，使用现有 Developer ID 签名，本轮关闭 notarize、没有发布。依赖检查发现 ASAR 内 639 个包、45 个必需依赖全部存在。

包内 independent provider 在包内 Electron Node 模式加载成功；读取 `resources/independent-beauty` 并验证 262 个固定源码哈希；使用本机外部 Python／模型／资产完成零参数恒等和美白 + 瘦脸 + 鼻子 + 唇妆组合，非零参数确实改图。证据 `.local/jianying-parity/beauty-8-packaged-photo-r2/independent-receipt.json`、`independent.json`、`independent.png`。这里没有使用开发目录的 provider 模块替代包内模块。

原生签名宿主实测失败：`libcccreator.dylib` 的 `@rpath/libAGFX.dylib` 无可用 `LC_RPATH`，出图错误已保留在 `/tmp/qcut-beauty-gap-packaged-photo-r2.log`。同机 Node 开发矩阵可以运行，不能据此宣称签名包的原生入口可用。应用窗口自动化三次超时；进程采样停在启动模态提示，未完成包内 UI 验收。独立序列研究工具晚于此包构建加入，未声称该包包含它。

尚缺：签名宿主的确定性动态库加载方案、包内实际 UI 进出图和导出、新机器外部 payload／Python 安装、notarization。未放宽签名安全权限来掩盖失败。

## 验证与复现

- Python 486 项全部通过，无跳过；Bun 规划器／纯界面模型 17 项通过。
- QCut provider／IPC／hook／取消／导出／结果组件、矩阵及连续帧 307 项通过，共 11 个文件。
- Electron／Web TypeScript 检查通过，完整 Web + Electron 构建通过，矩阵／视频探针构建通过。
- 全库 `bun run lint:clean` 无错误；仍有既有 warning／info。Biome 遵守 Git ignore，并显式排除环境／模型输出、参考仓库及 Git 子模块，避免跨软链接检查外部资源。
- 新断点校验已经对 124 个真实已保存案例执行续跑，所有输出、参数和指标重验证成功。

完整命令和配置接口见 `research/independent-beauty/README.md`。本机原始日志 `/tmp/qcut-beauty-gap-*`，截图、视频和私有 runtime 保留在 `.local/`，不推送原生私有库、模型或肖像媒体。复制 `run.json` 中的 `config` 到 JSON 文件后：

```sh
bunx esbuild scripts/beauty-lab-matrix.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-matrix.cjs
node dist/electron-audits/beauty-lab-matrix.cjs <config.json> <new-output-directory>
bunx esbuild scripts/beauty-lab-sequence-probe.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-sequence-probe.cjs
node dist/electron-audits/beauty-lab-sequence-probe.cjs <numbered-PNG-directory> <new-output-directory> <fps>
```

Node 25 用于原生 provider 的 `node:sqlite`；Bun 1.3.9 用于 planner。一次目录格式修复曾沿本机 symlink 改到外部资产，已从现有验证源、原始 archive／wheel 和原序列化格式恢复；Python／真实矩阵重新执行通过。恢复记录 `/tmp/qcut-beauty-format-recovery/receipt.json` 包含全部 253 个恢复项。此后格式修复仅传入明确源码文件，运行环境不纳入格式扫描。
