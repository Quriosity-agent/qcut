# 流畅脸：GAN 路由修正与真实编辑器验证

日期：2026-09-30。分支：`codex/beauty-kpop-v3`。
从已同步的 `origin/master` / `3ba289fa77eeed56844450e9c7166c6310add776` 开始。
前置：[脸型与肤色逐项对照](beauty-face-shape-skin-tone-2026-09-28.zh.md)。

## 根因

旧 QCut 将 `face_adjust_temple`（features 包的太阳穴变形）标为“流畅脸”。
上一轮照片中，剪映改动范围较广，而 QCut 集中在太阳穴和外眼侧；这不是同一个算子的强度差异。

本轮只读查询本机 `ressdk_db/515395108782262524/rp.db`：

| 缓存行 | 界面项目 | resource ID | 版本 | intensity key |
| --- | --- | --- | --- | --- |
| 24660、15405 | 流畅脸 | `7408077026705280256` | `74ded1bf06987b66866e6c2fc72a9e24` | `face_adjust_lunkuopinghua` |

它与匀肤、丰盈共用已经接通的 `skin-gan` 包，不是原来的 features 包。
本地包接收三个独立的人脸强度向量；轮廓强度控制 GAN flow 的合成，不能用太阳穴滑杆的整体倍率替代。
目录记录与包内参数处理提供路由依据，不冒充抓到了剪映进程的实际调用栈。
模型、第三方源文件、数据库和二进制均不提交仓库。

## 产品修改

- 在 editor-core 持久化键及 Electron 契约中新增 `face_adjust_lunkuopinghua`。
- “流畅脸”位于脸型主面板第一项，范围 0..100，走现有 `skin-gan` stage。
- 旧 `face_adjust_temple` 保持原包、范围和数据，显示为“太阳穴（基础）”，放入五官精修的“精修”分类。
- 不迁移旧项目或预设。仅有旧太阳穴参数的项目仍使用原变形器，不偷偷启用 GAN。
- 匀肤、丰盈、流畅脸分别下发自己的向量；未设置项显式为零。逐脸向量沿用既有绑定协议。
- 缺少 GAN 包时只禁用相应控件；其他脸型控件仍可使用。

这是本机原生参照路径的修复，不是独立 PyTorch 算法或 Windows 支持。

## 素材与证据

沿用同一张 4000×6000 真人照片。原目录目前不存在，使用此前保存的未修改副本：

`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/face-shape/comparison/source-original.jpg`

SHA-256：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。
已与剪映参照 manifest 的源指纹核对一致，未用新的或生成的人像替代。

本轮本地输出目录：

`/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v3-20260930/`

- `contour-native/`：0/50/100 冷宿主探针，每档重复三帧；原始输入与 RGBA、PNG、报告保留。
- `editor/`：首次实际运行的失败证据；中性导出完成，但导出页截图超时。
- `editor-r2/`：通过的真实 Electron 参数、预览、原图输入、导出、窄窗口和保存重开证据。
- `skin-regression/`：八个皮肤控件的 50/100 档、复位、组合、重开与真实导出回归。
- `comparison/`：复用既有剪映截图生成的新五列灰度对照；独立于旧证据目录。

原图、结果、导出和截图留在忽略的本地输出目录，不上传仓库。历史报告不回写新数值。

## 验证状态

| 层级 | 当前结果 |
| --- | --- |
| 原生探针 | 0/50/100 每档最后两帧哈希一致；零值 RGBA 与输入逐字节相同 |
| 单元及组件回归 | 42 文件、251 项通过，含路由、参数隔离、旧值保留、缺包 UI 和项目规范化 |
| Python 对照工具 | 45 项通过；新增拒绝将旧太阳穴结果标成新的流畅脸证据 |
| 构建 | Electron 构建、web TypeScript/Vite 构建通过；保留既有构建警告 |
| 脸型真实编辑器 E2E | 1 项通过，约 1.9 分钟；26 个隔离档位、复位、组合、窄窗口、完整重开与导出 |
| 皮肤真实编辑器 E2E | 1 项通过，约 1.1 分钟；16 个隔离档位及组合、重开、30 帧导出；报告无错误 |
| 视觉对照 | 19 页、24 个配对档位；已检查流畅脸五列图、控件截图、窄窗口和解码导出帧 |

E2E 扩展现有脸型矩阵，不另复制参数列表：26 个隔离档位、流畅脸 0/50/100/0 四次五秒导出、逐项与整组复位、组合参数、窄窗口、完整应用重开及组合导出。
模型和编码不 mock，仅导出路径选择对话框使用测试路径。四次独立导出绑定 MP4 与解码首帧哈希，检查色彩契约、150 帧完整解码和零值复位一致。

五次脸型导出均为 1080×1620、30 fps、五秒 H.264 / yuv420p / BT.709 limited-range。
每次完整解码 150 帧；独立 0/50/100/0 的零值首帧哈希一致，50 与 100 分别产生不同结果。
组合参数为窄脸 -25、下巴长短 25、流畅脸 50；1800×1100 和 1280×800 窗口及完整应用重开后，预览哈希均一致。
两份成功的真实编辑器报告均为 `errors: []`。

早期因旧素材路径缺失而 skip，不算通过。随后首次实际运行在导出页截图上超时，失败报告与导出保留在 `editor/`。
共享导出辅助函数在截图前显式调用 `page.bringToFront()`；重跑通过，未延长超时或放宽断言。
这是已验证的规避措施，不单凭一次恢复就断言所有截图卡住都是窗口焦点导致。
脸型 E2E 也补上失败记录及无论报告写入是否成功都关闭应用的清理逻辑。

## 灰度对照结果

使用与旧报告一致的原图、剪映 manifest、600×900 归一化尺寸、面部 ROI、固定增益 6、模糊 sigma 0.6。
没有几何配准，也没有逐图亮度拉伸。两端分别减去自己的零值基线，比较 RGB 变化向量；灰度图显示改动位置。

| 流畅脸档位 | 修复前变化向量 MAE | 修复后 MAE | 误差下降 | 修复前 cosine | 修复后 cosine |
| --- | --- | --- | --- | --- | --- |
| 50 | 3.4883 | 2.0505 | 41.22% | 0.3041 | 0.7671 |
| 100 | 4.5864 | 2.1432 | 53.27% | 0.2041 | 0.7990 |

这表示本样本的改动区域与方向更接近剪映，不是功能完成比例或完全一致的证明；轮廓位置和强度仍有残差。
剪映侧沿用历史 UI 截图，QCut 侧为本轮画布，因此不等同于两端同规格导出验收。

本地证据：

- [原图](../../../output/beauty-kpop-v3-20260930/comparison/source-original.jpg)
- [原图、剪映、QCut 及统一增益灰度差分](../../../output/beauty-kpop-v3-20260930/comparison/smooth-contour.png)
- [流畅脸 100 的 UI](../../../output/beauty-kpop-v3-20260930/editor-r2/smooth-contour-100-ui.png)
- [1280×800 窄窗口](../../../output/beauty-kpop-v3-20260930/editor-r2/compact-ui.png)
- [流畅脸 100 解码首帧](../../../output/beauty-kpop-v3-20260930/editor-r2/contour-exports/smooth-contour-100/export-frame.png)
- [真实编辑器报告](../../../output/beauty-kpop-v3-20260930/editor-r2/report.json)
- [灰度对照报告](../../../output/beauty-kpop-v3-20260930/comparison/report.json)

这些链接仅在本地输出目录存在时有效，仓库只保存验证说明和测试代码。

## 复现

在仓库应用根目录执行，先构建 Electron 和 web。8899 应为未占用端口；复现输出使用新目录，保留已验收的 `editor-r2/`：

```sh
bun run build:electron
(cd apps/web && bun run build)

QCUT_API_PORT=8899 \
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/face-shape/comparison/source-original.jpg \
QCUT_PORTRAIT_FACE_SHAPE_OUTPUT="$PWD/output/beauty-kpop-v3-20260930/editor-repro" \
  bunx playwright test portrait-face-shape-reference.e2e.ts --reporter=line

QCUT_API_PORT=8899 \
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/face-shape/comparison/source-original.jpg \
QCUT_PORTRAIT_SKIN_E2E_OUTPUT="$PWD/output/beauty-kpop-v3-20260930/skin-repro" \
  bunx playwright test portrait-skin-reference.e2e.ts --reporter=line

python3 scripts/compare-portrait-face-shape-reference.py \
  output/beauty-kpop-v3-20260930/editor-repro \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/face-shape/jianying/manifest.json \
  output/beauty-kpop-v3-20260930/comparison-repro
```

当前矩阵要求新的 GAN key，旧 `face_adjust_temple` 报告不能通过新矩阵校验。
上一轮历史图册仍是修复前证据，不应重新标注成修复后输出。

## 剩余边界

- 剪映参照沿用已保存的 UI 截图，不是本轮两端同规格导出的精度验收。
- 当前仍是一张轻微转头、带手部及头发遮挡的照片，不代表多脸型、动态跟踪、多人或性能验收。
- 流畅脸需要 GAN 推理，性能不能按旧太阳穴变形估计。
- 本机目录也找到了下颌线 `face_adjust_XiaHeXian` 和小脸 `face_adjust_YouTaiFace` 的独立资源身份；本轮不接入、不宣称修复，下一部位分别验证。
- 五种肤色色板、美体与 Windows/x86 不在本轮完成范围。
