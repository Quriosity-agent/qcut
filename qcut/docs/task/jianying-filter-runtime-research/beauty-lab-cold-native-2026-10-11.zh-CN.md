# 美颜实验室：原生冷启动对照与残差更正

日期：2026-10-11。分支：`beauty-lab-review`，起点 `b56db3053`（v2026.10.11.1）。
工作目录：仓库内的 `qcut/`（本文其余路径均以它为基准）。
前置记录：[复合处理、批量对照与连续帧推进](beauty-kpop8-gap-expansion-2026-10-08.zh-CN.md)。

## 结论

10 月 8 日照片矩阵的 19 项残差已全部消除：18 项是测试方式造成的；剩下 1 项是自研磨皮与原生有 4 个像素差 1 级，经后续阶段放大所致，已通过回移上游修正解决。最终 **124/124 组最大 RGB 差 ≤1**，其中 95 组逐像素一致。

- 同一张输入的所有用例共用一个 `sourceKey`，时间戳都是 0。原生 provider 因此把后一个用例当作同一来源的继续渲染，沿用了上一次的人脸跟踪状态。自研每次都独立处理。
- 每个用例改用独立的 `sourceKey` 后，用同一份配置重跑 124 组：**123 组最大 RGB 差 ≤1**，其中原 18 项里 17 项逐像素一致，`skin-gan-shape` 最大差 1。
- 124 组的自研输出哈希与此前完全相同。只有这 19 项的原生输出变了。
- 唯一的真实残差仍是 `portrait-01--skin-shape-lip`：最大 RGB 差 18，RGB MAE 0.0232818，与此前一致。

| 指标 | 10 月 8 日（共用 key） | 本次（每组冷启动） |
| --- | ---: | ---: |
| 计划／完成／两路出图 | 124／124／124 | 124／124／124 |
| 最大 RGB 差 ≤1 且 alpha 无差异 | 105 | 123 |
| 超阈值 | 19 | 1 |
| 出图失败 | 0 | 0 |

## 根因

provider 里有一份稳定帧名单 `portraitPackageNeedsStableFrame`：鼻部 3D、`smile`、`face`、`eye-details`、`small-face`、`jawline`、`skin-gan`、`makeup`、`brow-shape`。这些包在暂停帧上参数变化时会重置会话，注释写明原因是「每次滑块变化都重新拟合会推进原生平滑」。名单外的包会沿用上一次渲染的跟踪状态。

在 `portrait-01`（271×320）上，同一 `sourceKey` 先渲染 A、再渲染 B，与冷启动渲染 B 对比：

| 效果包（参数 A→B） | 最大 RGB 差 | 不同像素 |
| --- | ---: | ---: |
| `features`（upper_atrium 25→50） | 56 | 1,664 |
| `features`（cheekbone 25→50） | 8 | 754 |
| `feature-tilt`（EyeTilted 30→60） | 9 | 309 |
| `smooth`（Smooth 30→60） | 7 | 3,735 |
| `whiten`（Whiten 45→35） | 4 | 5,293 |
| `spot-acne`（SpotAcne 50→100） | 3 | 3,869 |
| `clarity`（Clarity 40→80） | 1 | 483 |
| `teeth`（WhiteTeeth 40→80） | 0 | 0 |
| `face`（TotalFace 20→35，名单内对照） | 0 | 0 |

漂移与图片有关：在 `portrait-02`（240×320）上做同样的测试，以上各包均为 0。两次冷启动渲染之间逐字节一致。

## 修复

- **矩阵**：`scripts/beauty-lab-matrix.ts` 中每个用例的 `sourceKey` 改为 `matrix-<输入>-<用例>`。`run.json` 记录 `nativeTracking: "cold-per-case"`，续跑时拒绝方法不同的旧目录，防止共用 key 的结果与冷启动结果混在一起。
- **美颜实验室**：原生渲染请求新增可选的 `freshTracking`。provider 收到后先回收该来源的跟踪作用域再渲染。美颜实验室的每次原生处理都带上它，结果不再依赖之前处理过什么。
  - 用真实 provider 验证：上表 7 个漂移的包带上开关后，「先 A 后 B」与冷启动 B 全部 0 像素差异。
  - 单元测试：用会随渲染次数变化输出的假宿主，证明默认复用热会话，而开关强制冷启动。去掉回收那一行，测试即失败。hook 测试断言美颜实验室发出了这个开关。
- **编辑器未改**：如果把上述包加入稳定帧名单，编辑器暂停画面时的预览也会变得确定，但每次参数变化都要重启宿主。在 542×640 人像上实测：

| 参数 | 热启动 | 冷启动 |
| --- | ---: | ---: |
| Smooth | 82 ms | 372 ms |
| Whiten | 73 ms | 321 ms |
| upper_atrium | 71 ms | 433 ms |
| TotalFace（已在名单内） | 335 ms | 376 ms |

暂停时拖动这些滑块会慢 4–5 倍。这是编辑器的体验取舍，等产品决定后再改。

## skin-shape-lip：磨皮回移

`portrait-01--skin-shape-lip` 包含美白 45、磨皮 30、瘦脸 35、瘦鼻 25 和珊瑚裸粉口红 40。两路都冷启动后拆解：

| 组合 | 最大 RGB 差 |
| --- | ---: |
| 只开磨皮 / 磨皮 + 美白 | 1 |
| 完整组合去掉磨皮 | 1 |
| 磨皮 + 瘦脸 / 磨皮 + 瘦鼻 / 磨皮 + 口红 | 7 / 6 / 4 |
| 完整组合 | 18 |

原因是一条放大链：

1. 自研磨皮与原生只差 4 个像素，每个像素一个通道差 1 级。
2. 后续阶段在磨皮后的图上重新检测人脸，两边都是如此。实验证实：用原生磨皮结果作输入时，自研瘦脸与原生逐像素一致。
3. 量化检测网络把这 4 个像素的差异放大：106 个关键点全部移动，平均 0.54、最大 1.36 像素。
4. 依赖关键点的瘦脸、瘦鼻、口红又把它放大到 18 级。

独立版仓库在快照基线 `24d3dcf` 之后修正过 `research/smooth_metal.swift`：

- `e028391`：固定平滑邻域图；
- `65c1044`：对齐原生输出的光栅方向；
- `b56477d`：在插值前而不是插值后翻转皮肤坐标。

这三个提交回移到 QCut 快照后，同一照片的磨皮与原生逐像素一致。`b56477d` 的回执字符串一段因上下文不同改为手工应用。`source-manifest.json` 更新了该文件的哈希，并在 `importPatches` 记录来源。外置运行库清单的 `sourceManifestSha256` 绑定到新的 manifest，资源本身没有变化。

回移后重跑 124 组：

- 只有 2 组自研输出改变：`control-Smooth-100` 最大差从 1 降为 0；`skin-shape-lip` 从 18 降为 1，只剩 58 个像素差 1 级。
- 原生输出全部不变。
- 验证：独立引擎 Python 486 项与 Bun 17 项通过，美颜实验室 Electron 测试通过，本机外置运行库在新绑定下预检通过（358 个文件）。

## 端到端验证

用包含本修复的构建跑美颜实验室 E2E，输入是 240×320 真人照片，后台模式：

- `beauty-lab-independent.e2e.ts` 通过：零参数恒等；组合参数原生与自研最大差 1、Alpha 差 0；ZIP 带引擎原样 PNG。
- `beauty-lab.e2e.ts` 的「ZIP 替换旧证据」通过。
- 「真实原生渲染…」一项修正了两处 PR #487 改名后过时的文案：「候选处理」改为「混合候选核验」，「任意画面推理未接入」改为「混合候选核验：未启用」。修正后，原生渲染、差异图、原生对照 ZIP、美颜预设保存全部通过。之后的离线回放步骤仍失败，原因是本机研究记录 `face-temporal-campaign-20261003-r1` 绑定的源码哈希已过期：PR #485 修改了 `research/jianying-runtime-probe/filter-probe.mm`，provider 报 `SHA mismatch` 并按设计不再列出该记录。这需要用当前源码重新采集研究记录，与本修复无关。
- `beauty-lab-live-candidate*.e2e.ts` 仍使用旧按钮名「候选处理」。它们需要签名身份和候选后端才能运行，本轮未修改、未验证。

## 证据与复现

本机证据目录 `.local/jianying-parity/beauty-lab-cold-native-20261011-r1/`（冷启动）和 `.local/jianying-parity/beauty-lab-smooth-backport-20261011-r1/`（冷启动加磨皮回移）：`matrix.json`、`run.json`、`index.html` 及逐组两路图片。私有运行库、模型和肖像不提交。配置取自 `.local/jianying-parity/beauty-8-gap-matrix-r2/run.json` 的 `config`。

```sh
bunx esbuild scripts/beauty-lab-matrix.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-matrix.cjs
node dist/electron-audits/beauty-lab-matrix.cjs <config.json> <new-output-directory>
```

使用 Node 25（原生 provider 需要 `node:sqlite`）。

## 仍未完成

- 编辑器暂停预览的确定性（见上文取舍）。
- 独立视频接入时间线／导出、干净 Mac 安装与 notarization、研究项 P1–P3，状态不变。
