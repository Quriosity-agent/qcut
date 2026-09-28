# 皮肤管理八项 UI 对齐与编辑器验证

日期：2026-09-28。分支：`beauty-kpop-v2`，基于 `origin/master` 的 `703d0acf3`。

## 改动范围

按用户提供的剪映皮肤管理截图调整 QCut 的名称、顺序与分组，不修改效果增益、原生包、stage 顺序、模型或项目数据格式。

| 顺序 | 界面名称 | 保留的项目 key | 原生包 |
| --- | --- | --- | --- |
| 1 | 磨皮 | `face_adjust_Smooth` | `smooth` |
| 2 | 美白 | `face_adjust_Whiten` | `whiten` |
| 3 | 匀肤 | `face_adjust_yunfu` | `skin-gan` |
| 4 | 丰盈 | `face_adjust_fuling` | `skin-gan` |
| 5 | 祛斑祛痘 | `face_adjust_SpotAcne` | `spot-acne` |
| 6 | 祛法令纹 | `face_adjust_NasolabialFolds` | `eye-details` |
| 7 | 祛黑眼圈 | `face_adjust_Pouch` | `eye-details` |
| 8 | 清晰 | `face_adjust_Clarity` | `clarity` |

八项均保留 QCut 既有 `0..100`、步长 1。肤色、冷暖继续保留在八项后；原有补光与通用美颜移至它们下方，不再占据八项之前的位置。没有复制剪映会员或限免标识。

法令纹、黑眼圈原来在“五官精修 → 精修”，分别叫“淡化法令纹”和“淡化眼袋”。本机剪映 `rp.db` 的 `http_cache` 第 24334 行明确将“祛黑眼圈”映射到 `face_adjust_Pouch`、“祛法令纹”映射到 `face_adjust_NasolabialFolds`，因此不是猜测名称近似。没有导出完整数据库或签名资源地址。

两项仍使用原 key：旧项目和预设无须迁移。重置皮肤组现在清除这两项，重置五官组则保留它们；单项复位继续只影响对应参数。移动 UI 不改变 `eye-details` 与亮眼的共包关系，缺包时单独禁用对应控件。

## 验证

- 前端 `tsc && vite build` 与 Electron 构建通过。前端仍有既有路由测试文件、模块拆包及大 chunk 提示，不作为本次新增问题处理。
- 15 个单元/组件测试文件、97 项通过，包含既有预设与旧参数兼容回归。其中新增八项验证：顺序/范围、旧值回显、越界钳制与单项复位、皮肤组复位、五官组复位隔离、缺包隔离、整体禁用、英文文案。
- 真实 Electron E2E：皮肤与眼部两组通过，耗时 3.0 分钟；修正初始截图取景后，皮肤组再次通过，耗时 1.6 分钟。
- 八项各 50/100 共 16 档均输出 1080×1620 非空预览，参数值与对应 key 一致，页面异常为零。复位、键盘 Home/End、1280×800 小窗口与 1800×1100 重开布局通过。
- 法令纹32 + 黑眼圈64组合在缩放窗口和保存重开后保持相同预览 PNG SHA-256：`3e021b1052fd05ac25b162a24ba9c61629a52d67d080345dc1293eb34cffa5d2`。
- 真实 MP4 导出成功，FFmpeg 解码 30 帧通过。另将全部帧缩至 64×96 检查非空，RGB 均值最低 96.07、标准差最低 76.52；已人工查看导出首帧和大小窗口截图。

E2E 使用隔离用户目录、真实照片及本地原生运行库，不 mock 像素渲染、项目保存或编码，只替换导出文件选择对话框。皮肤测试覆盖八项各 50/100、Home/End、单项/整组复位，以及法令纹32 + 黑眼圈64的组合、小窗口、保存重开与 30 帧 MP4 导出。每档与同尺寸原图比较 RGB，要求非空且存在大于 1 的通道变化；这不是与剪映的视觉平价门槛。

最终运行的变化像素数如下，阈值为任一 RGB 通道变化大于 1。像素数只用于排除无响应，不能证明处理范围或效果正确。

| 控件 | 50 档变化像素 | 100 档变化像素 |
| --- | ---: | ---: |
| 磨皮 | 412596 | 513881 |
| 美白 | 743826 | 757312 |
| 匀肤 | 231747 | 258432 |
| 丰盈 | 333524 | 395685 |
| 祛斑祛痘 | 185669 | 247420 |
| 祛法令纹 | 31139 | 41992 |
| 祛黑眼圈 | 20824 | 29826 |
| 清晰 | 754393 | 1096186 |

## 本地证据

目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/`。

- `editor-verified/00-skin-ui.png`：八项初始布局，首末控件均完整可见。
- `editor-verified/face_adjust_*-50/100-ui.png`、`*-frame.png` 与 `*-input.png`：各档 UI、正式预览帧和同尺寸原图。
- `editor-verified/19-skin-compact-ui.png`：1280×800 窗口。
- `editor-verified/20-skin-reopened-ui.png`：重开后 1800×1100 窗口及旧参数 key 回显。
- `editor-verified/export-frame.png`、`editor-verified/report.json`：导出画面与结构化结果。
- `editor/`：首轮通过的原始证据；其初始面板截图裁掉底部两项，最终布局以 `editor-verified/` 为准。
- `eye-regression/`：眼部独立回归，确认移动两个共包参数没有影响眼部六项。

截图、真人素材、私有包与原生模型均不提交 Git。

## 复现

```bash
bun run build:electron
cd apps/web && bun run build:electron && cd ../..
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_SKIN_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/editor-verified \
QCUT_PORTRAIT_EYE_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/eye-regression \
  bunx playwright test portrait-skin-reference portrait-eye-reference --workers=1 --reporter=line
```

本轮是 UI 对齐和 macOS 静态单人功能验证，不是八项效果强度与剪映逐项同值平价，也未覆盖连续运动、多人、Windows 或独立分发。下一步结果对标仍需同输入、同数值、统一增益灰度差分及同规格导出。

## 后续实测：八项统一灰度差分

同日继续完成八项各 50/100 的剪映 UI 实测与 QCut 五列对照。灰度差分已完成；两端同规格无损导出校准仍未完成。本节不改变前述 UI 改动范围，也没有修改算法或强度曲线。

剪映草稿 `QCut-Beauty-RealPeople-20260927`，人脸时间线 02，使用同一张 `face-ike-louie-natividad.jpg`。原文件 SHA-256：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。原始照片另复制到对照目录，原文件不修改。

采集时只启用皮肤管理，每项先整组归零，再设置 50、100；保留数值框与完整界面证据。脸型、五官精修、美妆未启用，肤色为“无”。完成后归零并关闭皮肤组。清晰100采集时播放头曾移动，已回到0并重拍；输入为静态照片，没有用其它时间画面替换参照。

### 文件与读图

根目录仍为 `/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/`：

- `jianying/`：真实剪映完整界面 JPEG、逐项零值、结束状态和 `manifest.json`。截图工具返回 JPEG 字节，保留原字节，不改名伪装成无损 PNG。
- `editor-verified/`：前述真实 QCut 编辑器原尺寸输入、效果 PNG、UI 截图及 E2E 报告，没有拿独立探针代替编辑器结果。
- `comparison/`：最终八张逐项 50/100 五列对照、两张100档总览，以及各案例完整画面图、浮点差分和源文件哈希。入口：[全部对照索引](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/README.md)。
- `qcut-difference/`：采集剪映前先生成的 QCut 三列自检图，明确标注“剪映待采集”；最终双端结论以 `comparison/` 为准。

五列从左到右是 **原图/剪映零值、剪映效果、剪映灰度差分、QCut效果、QCut灰度差分**。两端各自零值图均单独保存，不直接把 QCut 图减剪映原图。

| 项目 | 50/100 对照图 | 100 档面部平均 RGB 变化：剪映 / QCut |
| --- | --- | ---: |
| 磨皮 | [smooth.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/smooth.png) | 2.514 / 1.794 |
| 美白 | [whiten.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/whiten.png) | 8.100 / 8.040 |
| 匀肤 | [even.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/even.png) | 2.040 / 1.771 |
| 丰盈 | [plump.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/plump.png) | 4.383 / 4.072 |
| 祛斑祛痘 | [blemish.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/blemish.png) | 3.663 / 2.591 |
| 祛法令纹 | [folds.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/folds.png) | 0.327 / 0.284 |
| 祛黑眼圈 | [circles.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/circles.png) | 0.231 / 0.183 |
| 清晰 | [clarity.png](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison/clarity.png) | 3.839 / 1.982 |

上述数字是 0..255 RGB 单位的变化均值，不是质量分数、相似度百分比或可直接应用的 slider 增益。

### 方法与限制

剪映完整截图为 2034×1178，播放器裁切 `(867,79)-(1291,715)`，即424×636；QCut输入/效果为1080×1620。两端先统一为600×900，固定面部ROI为 `(70,195)-(535,750)`。

灰度为 `mean(abs(Gaussian(result, 0.6) - Gaussian(ownZero, 0.6)), RGB) * 6`，超过255截断。不做几何配准，不逐图自动归一化；原始浮点幅度另存NPY。黑表示未变或变化很小，白表示变化较大，不表示“更好”、几何位移方向或算法内部蒙版。

剪映重复归零图在面部ROI的平均RGB差小于0.001，未见明显零值漂移。完整画面灰度可能包含选脸框位置变化，五列图的固定面部ROI避开框线；不能拿完整图的框线当美颜影响范围。

人工检查两张总览及局部图后的观察：

1. 八项的主要变化位置基本对应：美白覆盖皮肤，匀肤/丰盈影响局部纹理，法令纹集中鼻翼至嘴角附近，黑眼圈集中下眼睑，清晰影响高频细节。
2. 美白的范围与幅度较接近；磨皮、祛斑祛痘、清晰在当前截图测量中差异较明显。法令纹和黑眼圈的局部纹理分布仍不同，不能仅因“区域大致对上”判定平价。
3. 祛斑祛痘在两端都大面积改变这张雀斑照片，靠近画面左侧眼睛/发丝处均可见局部青紫色异常。本例只能说明路径有响应和差异位置，不作为视觉质量验收。
4. 截图缩放、JPEG压缩、预览采样分辨率与拟合状态仍可能影响差分。下一步先做同规格导出与原生输入/检测尺度核对，再定位算法强度差异；不按上表比值盲乘增益。

### 复现与测试

脚本复用既有灰度算法，校验16个独立参数档位、来源文件哈希、QCut输出哈希、截图尺寸与裁切边界；缺少完整剪映参照时只允许生成明确标注的QCut单端图。新增7项保护测试，连同既有差分/鼻部数学测试共18项通过。

```bash
python3 scripts/compare-portrait-skin-reference.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/editor-verified \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/comparison \
  --references /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/skin-ui/jianying/manifest.json
python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait_*.py'
```

本节只提交生成脚本、测试和记录，不提交真人图、剪映界面截图、私有资源、模型或二进制。
