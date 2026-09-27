# 鼻大小差异根因：2D 液化入口与 3D 鼻子入口不是同一功能

日期：2026-09-27。分支：`beauty-kpop`。先完成只读研究与独立原生探针，随后按用户确认接入 QCut 产品代码。**最新状态：3D 鼻大小已接入，真实编辑器保存重开与导出已通过。** 下文保留研究阶段数据；产品接入结果见末尾。没有修改剪映安装包、草稿或私有运行库快照，没有提交供应商二进制、模型或包内容。

## 结论

之前把 QCut 的 `face_adjust_nose` 当作剪映当前“鼻大小”，这个映射是错的。

| 项目 | QCut 原入口（现保留为 2D 基础） | 剪映当前目录的“鼻大小” |
| --- | --- | --- |
| 参数 | `face_adjust_nose` | `face_adjust_3DNose_Big` |
| 资源 ID | `7408077472211668276`，通用 features 包 | `7408077058544323874`，独立鼻子包 |
| 包版本 | `f662ff9c955ee319f1ae03b2aa27df76` | `d7c908c833ac8ffc0de910ec579ba339` |
| 控制脚本 | `FaceReshapeControlSystem.lua` | `Face3DSystem.lua` |
| 形变方式 | `NoseSize`，`FaceReshapeLiquefy` 的二维局部形变 | 人脸 3D 拟合、网格 blendshape、姿态相关权重、FXAA |
| 本图表现 | 改动更大；负值明显带动眼周 | 改动集中于鼻部，与剪映导出高度接近 |

**已接通私有原生运行库，不代表每个中文 UI 名称都已经映射到当前剪映的同一个效果。** 本次不是靠调低一个倍率解决，而是修正“UI 名称 → 资源 → 参数 → 算法”的对应关系。

## 证据链

### 1. 当前目录给出了不同的参数与包

只读查询当前用户 `Cache/ressdk_db/515395108782262524/rp.db` 的 `http_cache`：

- 行 `24340`：`get_resources_by_category_id` 的 `facial_features` 响应，服务端时间 `1790380816`。
- 行 `24304`：`get_panel_info` 的鼻子分类 `5913949`，给出相同卡片。
- 卡片标题“鼻大小”，`intensity_key=face_adjust_3DNose_Big`，范围 `-50..50`。
- 要求 `face_fitting`，模型列表包含 `tt_facefitting1220`、`tt_face`、`tt_face_extra`、`tt_fsnew_base_jianying`、`tt_freid`。

这不是依据目录名或文件修改时间猜测。没有导出带签名的资源 URL、帐号信息或整份数据库；没有为此访问云端接口。

### 2. 本地包内控制逻辑与目录吻合

包目录：`~/Movies/JianyingPro/User Data/Cache/effect/7408077058544323874/d7c908c833ac8ffc0de910ec579ba339/`。

按本机包的可读配置与 Lua，调用关系为：

```text
鼻大小 -50..50
  -> face_adjust_3DNose_Big: [{id, intensity: value / 100}]
  -> SetEffectIntensity -> Face3DSystem
  -> blit / face / freid / face_fitting
  -> 每张脸的 vertexes、normals、modelMatrix、MVP
  -> MorpherComponent 的鼻部 blendshape 权重
  -> MeshRenderer + FXAA
```

关键细节：

- `Face3DSystem.lua:19` 定义鼻大小的 3D 参数；`:230` 附近取得 `MorpherComponent`、网格渲染器与 FXAA 实体。
- `updateMesh` 检查至少 1220 个顶点，使用拟合网格与姿态矩阵，而非把鼻子周围当作平面圆形区域缩放。
- `processOneFace` 按 pitch/yaw 与包内表调整 blendshape 权重。因此侧脸行为不能由正脸单点强度推断。
- `parseChannelWeights` 先匹配具体 face id，再用 `id=-1` 作为全脸回退；输入强度乘 2。
- **鼻大小的负向映射到 `_big`，正向映射到 `_small`**。不能看变量名便擅自反转正负号。
- 旧包的 `face_adjust_nose` 也乘 2，但走 `NoseSize_Pos/Neg` 与液化形变半径。相同强度乘数不意味着相同算法。

以上是包配置/脚本的静态事实；没有注入剪映进程或直接捕获其调用 payload。下一节的同图原生输出用于补足运行证据。

### 3. 同图实测排除了“换一版 features 包即可”

新增 [原生包诊断脚本](../../../scripts/audit-portrait-package-reference.ts)，复用 QCut 自己的宿主，以显式 package path 运行，不修改生产 resolver。

- 输入仍是 Pexels 2709386 的同一张照片，源 SHA-256：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。
- 全部输入/输出 `2160×3240`；每个 case 都新建、销毁独立 host；时间戳固定为 0。
- 两版 features 包分别测零值、鼻大小 -48/+50、开眼角 99。每个 case 连续请求两次，结果均逐字节稳定。
- `f662...` 与 `07466e73caa1d4a19a91d290413cd5e6` 的 Lua 相同，负向 NoseSize GLSL 相同；场景、材质和着色器封装有差别，但最终鼻部指标几乎不变。
- `f662...` 直接 host 的四张 PNG 哈希与先前 provider 输出一致，说明此次差异不是 provider 组合阶段偷偷叠加了其它参数。
- 正确 3D 包另测零值、-48/+50；不再经过旧 features catalog，直接发送已确认的 3D 参数。

## 对照结果

先把所有帧归一到 `600×900`，各自减去零值，固定脸部 ROI `[70,195,535,750]`，指标高斯预滤波 `sigma=0.8`。余弦是改动方向相似度，**不是复刻完成率或美观评分**。

| 鼻大小 | 旧 features 包余弦 | 3D 包第 2 请求余弦 | 3D 包第 12 请求余弦 | 旧差分 MAE | 3D 第 12 请求差分 MAE |
| --- | --- | --- | --- | --- | --- |
| -48 | 0.45894 | 0.99409 | 0.99444 | 2.27199 | 0.16065 |
| +50 | 0.58040 | 0.98938 | 0.98945 | 1.11778 | 0.15234 |

另一版 features 包分别为 0.45893 / 0.58040，没有改善。3D 包的差分 MAE 相比旧入口约降低 93% / 86%；只适用于这张照片和这两点，不据此设产品精度门槛。

![剪映、QCut 旧入口与正确 3D 探针对照](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/nose-routing-3d-nose-12.png)

图中灰度按各自零值计算、统一增强 6 倍，显示预滤波 `sigma=0.6`。它显示 RGB 变化幅度，不是位移场或模型内部蒙版。人工查看：旧负向入口扩到眼周，正确 3D 包亮区集中在鼻部，与剪映参考更接近。

完整本地证据：

- [指标和所有输入 PNG 哈希](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/metrics-3d-nose-12.json)
- [旧 f662 包报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/f662/report.json)
- [另一版 0746 包报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/0746/report.json)
- [3D 包两请求报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-nose/report.json)
- [3D 包十二请求报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-nose-12/report.json)

## 研究阶段的边界（接入前）

1. **还不是编辑器修复。** 产品 catalog、contract、resolver 和 stages 中尚无该 3D 鼻子控制项。本轮只证明正确路径能由原生宿主执行且输出更接近参考。
2. **静帧重复不逐字节稳定。** 3D 包的第 2、第 12 请求均未与前一次完全相等；第 2 与第 12 输出的全图 RGB MAE：零值 0.00390、-48 为 0.03064、+50 为 0.01592，最大通道差分别为 15/48/30。包启用了拟合平滑，但尚不能把所有微小变化归因于它；需区分拟合历史、渲染与抗锯齿状态。不要把“有输出”当“已收敛”，也不要将 12 次重复当成产品策略。
3. **零值也有微小重采样残差。** 3D 第 2 请求零值相对原始输入，在上述 ROI/预滤波后的 MAE 约 0.03363。产品应继续在全部调整为零时旁路原图，独立测试开关/重置，不能强制所有帧无条件通过 3D 包。
4. **运行库构建不同。** QCut 私有快照创建于 `2026-08-26T08:52:36.730Z`，arm64 core UUID 为 `D6342ECD-5432-33F0-A2AD-0C28F5699994`；当前剪映为 `100726E3-FCB0-31BC-98EE-1B196A1714A3`。此次正确包在旧宿主上已大幅改善，所以构建差异不是原大幅偏差的必要解释；它仍是剩余精度研究的独立变量，不能直接绕过 ABI 白名单加载新库。
5. 仅一张带角度、手托下巴的人像。尚无正侧脸、遮挡、多脸目标、连续运动、seek、反向播放、与其它美颜叠加和 Windows 验收。

## 产品接入顺序

1. 给独立 3D 包增加专用 runtime package 与 `face_adjust_3DNose_Big` 控制项；“鼻大小”指向新控制项。旧 `face_adjust_nose` 保留为“鼻子大小（2D 基础）”，**不静默改旧项目的 key、值或渲染语义**。
2. 包解析固定 resource/version，检查 3D 拟合所需模型并明确报告缺失；不能因现有通用 features 包存在就宣称这个功能可用。私有包与模型保持本地，不提交 Git。
3. 验证 3D stage 与 face/features 的叠加顺序，逐脸 id 映射，重置与零值旁路；不得用同值同时开启 2D、3D 两项。
4. 给拟合状态规定帧序列、seek 与 session 清理合同，再测预览/导出一致性；不要盲目增加固定 warmup 次数掩盖问题。
5. 先做 contract/catalog/resolver/stages 单测，再做专用隔离草稿真实 E2E：-50/-25/0/+25/+50、输入框与键盘、单项/整组重置、保存重开、导出、前后差分图。补多角度/多人/运动片后才声称鼻部对齐完成。

## 复现与验证

在仓库根目录执行；路径均指向用户已有的本地私有资源：

```sh
bun scripts/audit-portrait-package-reference.ts \
  --source "$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg" \
  --output "$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-nose-12" \
  --package "$HOME/Movies/JianyingPro/User Data/Cache/effect/7408077058544323874/d7c908c833ac8ffc0de910ec579ba339" \
  --key face_adjust_3DNose_Big --frames 12

python3 scripts/compare-portrait-nose-reference.py \
  "$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison" --candidate 3d-nose-12

python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait*.py' -v
```

对照脚本依赖前述 `f662/0746/3d-nose` 已有探针结果与真实剪映导出帧。研究阶段完成 14 个独立 host case、灰度/指标单测 11 项；当时未执行产品 E2E。下面记录后续正式接入与验收，不用研究探针冒充编辑器结果。

本地 3D 包指纹，仅记录哈希，不复制供应商内容：

| 文件 | SHA-256 |
| --- | --- |
| `algorithmConfig.json` | `eaea057857d9e5ce39874ac4b6fd912d126b0b5c60518a9afe6b3425fa8045ef` |
| `AmazingFeature/main.scene` | `3bf0ca84fdf61ce64a449f4aa6f478670ac4ffe2ea8881c36aace4b6409d2e77` |
| `AmazingFeature/lua/Face3DSystem.lua` | `4b5055d7fc9b573d9d5a95b6efe8bc1b68d1046099657feeb0185e6d5359034f` |

## 正式接入结果

### 代码与兼容合同

- `advanced-controls.ts` 新增“鼻大小”，key 为 `face_adjust_3DNose_Big`，范围 `-50..50`，专属 `nose-3d` stage。旧 `face_adjust_nose` 保留原包、原数值与原渲染方式，标签明确为“鼻子大小（2D 基础）”。没有静默迁移旧项目，也不会自动同时开启两项。
- Electron contract 与 `packages/editor-core/src/portrait-adjustments.ts` 同步增加 key，保存/加载及逐脸参数不会把它当未知字段过滤掉。逐脸数值到 native vector 的序列化已做单测，尚非多人实际视频验收。
- resolver 固定独立 resource/version，并检查 `algorithmConfig.json`、`config.json`、`AmazingFeature/main.scene`、`AmazingFeature/lua/Face3DSystem.lua`。五个模型族要求存在非空 `.model`，缺失时只禁用对应控制项并报告缺失项；不把通用 features 包存在当成 3D 已就绪。
- QCut 的 stage 顺序为 `face -> features -> nose-3d -> makeup`（仅列相关部分）。这是本项目的组合策略，不声称已反向证实剪映所有效果的执行顺序。
- 同尺寸/素材 scope 内，同一输入像素与相同参数复用 3D 输出，避免静帧因反复拟合推进平滑。改参数、暂停时换像素、后退或超过 1 秒的时间跳变会重建对应拟合状态；相邻运动帧保留跟踪。全零/禁用旁路原像素，不让零值引入网格重采样。未增加任意固定 warmup 次数。

### E2E 发现并修复的输入漂移

前三次真实测试在应用重开后失败：参数 `-48` 正确保留，但预览 PNG 哈希不同。保留失败证据于 `editor-nose-3d`、`editor-nose-3d-r2`、`editor-nose-3d-r3`。

对 r3 输入画布逐像素分析，**进入美颜前**的 RGB MAE 为 `0.27416`，最大通道差 6，约 53.3% 像素变化；美颜输出 MAE 为 `0.32474`。所以不能全部归因于 3D 拟合。`ColorPreviewCanvas` 的输入拟合画布原本使用默认 2D context，现仅在美颜启用时显式要求 `willReadFrequently: true`，固定像素读回路径。修正后未放宽测试：重开前后完整 PNG 哈希严格相等。

### 真实编辑器验收

通过测试 `portrait-slider-reference.e2e.ts`，约 1.1 分钟。使用独立临时 user-data，关闭整个 Electron 主进程后以同一数据目录重开，不是只刷新页面或重用 native cache。真实导入、原生美颜、持久化及导出均未 mock；仅保存路径对话框被替换，避免写入用户其它项目。

| 验证 | 结果 |
| --- | --- |
| 鼻大小 -50 / -25 / 0 / +25 / +50，另测 -48 | 通过；参数落在新 key，非零档位都有不同输出 |
| 输入框、Home/End、单项及分组重置 | 通过；全零恢复原图旁路 |
| 旧 2D 鼻大小 -48 | 通过；保留旧 key，输出与 3D 不同 |
| 旧项切换后恢复 3D -48 | PNG 哈希完全还原 |
| 保存、退出应用、重新打开项目 | 新 key/数值保留，预览 PNG 与退出前逐字节相同 |
| 大眼、开眼角、鼻高低回归；1800×1100 / 1280×800 窗口 | 通过；缩放窗口不改变逻辑渲染尺寸与像素 |
| 真实 MP4 导出 | `1080×1620`，1 秒，30 帧完整解码，导出截图/抽帧均已人工查看 |
| 页面异常 | 0 |

3D -48 的首次预览、恢复、重开后哈希均为 `ef7142c96aa85dfa735f6ec0dc21335956a64bec19acdead105d449f8397b46a`。

导出并非仅验证“文件存在”：对导出首帧与预览/原图/旧 2D 的鼻部 ROI 做补充检查。归一到 `600×900`、`sigma=0.8`、ROI `[150,435,330,590]`，导出与 3D 预览 MAE 为 `2.5574`，与原图为 `8.7946`，与旧 2D 为 `8.2156`；导出改动与 3D 预览改动的余弦为 `0.98318`。这支持导出确实保留了新效果，**不宣称有损视频与 PNG 像素完全一致**。

本地证据：

- [E2E 参数、哈希、重开与导出报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-r4/report.json)
- [重开后 UI](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-r4/12-nose3d-reopened-ui.png)
- [全零 UI](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-r4/09-nose3d-zero-ui.png)
- [导出帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-r4/export-frame.png)
- [导出视频](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-r4/nose-3d-1790497624714.mp4)

### 正式 Provider 对照

重新通过正式 catalog/resolver/stages/provider 生成 `2160×3240` 零值及 -48/+50，不再用显式包路径绕过生产路由。每次参数变化按新状态规则冷启一次宿主；零值直接旁路，因此与上方“3D 第 2/12 请求”不是完全相同的实验条件。

| 鼻大小 | 旧入口差分余弦 | 正式新入口差分余弦 | 旧差分 MAE | 新差分 MAE | 误差降低 |
| --- | --- | --- | --- | --- | --- |
| -48 | 0.45894 | 0.99272 | 2.27199 | 0.17656 | 约 92.2% |
| +50 | 0.58040 | 0.99018 | 1.11778 | 0.15103 | 约 86.5% |

![正式新入口与剪映、旧入口灰度差分](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/nose-routing-3d-integrated.png)

[指标及输入哈希](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/metrics-3d-integrated.json)，[正式 provider 报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-integrated/report.json)。同一照片、固定尺度/ROI、灰度统一增益；以上百分比仅为这两个测点的差分误差改善，不是整体复刻完成率。

### 复现命令与剩余边界

```sh
bun run build:electron
bun run --cwd apps/web build
bunx --no-install vitest run portrait color-preview-canvas color-preview-resolution jianying-nose
python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait*.py' -v

QCUT_REAL_PORTRAIT_IMAGE_PATH="$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg" \
QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT="$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-nose-3d-verify" \
bunx --no-install playwright test apps/web/src/test/e2e/portrait-slider-reference.e2e.ts \
  --project=electron --workers=1 --reporter=line --output=output/playwright/nose-3d-verify

QCUT_PORTRAIT_REFERENCE_SOURCE="$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg" \
QCUT_PORTRAIT_REFERENCE_OUTPUT="$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-integrated" \
QCUT_PORTRAIT_REFERENCE_WIDTH=2160 QCUT_PORTRAIT_REFERENCE_FILTER=nose3d \
bun scripts/audit-portrait-slider-reference.ts

python3 scripts/compare-portrait-nose-reference.py \
  "$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison" \
  --provider-output "$HOME/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-investigation/3d-integrated"
```

已通过 37 个 Vitest 文件/223 项测试、11 项 Python 指标测试、Electron 与 Web 构建；输入画布修复后又单独复跑其 4 项单测及上述真实 E2E。最终 Biome 与 `git diff --check` 均通过。

仍需区分：

1. 本机 runtime 和五个模型来自 QCut 私有目录，但 **3D 效果包目前仍解析到剪映用户缓存**，`offlineReady=false`。没有做断开剪映缓存后的冷启动验收，未把包擅自塞进既有私有快照；缺失时控件会禁用。代码可解析以后由既有私有资源流程安装的同版本包。
2. 单人静态照片及其 1 秒导出已验收；多人绑定、侧脸/遮挡/动态连续片、反向播放、与多个美颜项真实叠加、Windows 均未完成视觉验收。状态/序列化单测不能替代这些实际场景。
3. 当前修复仅在此分支构建中验证，没有替换系统安装的 QCut，没有发布，也没有替换 ABI 白名单运行库。
