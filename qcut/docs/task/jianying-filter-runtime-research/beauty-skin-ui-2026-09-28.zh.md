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
