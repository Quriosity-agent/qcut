# 美妆效果与 UI 继续对齐

日期：2026-10-01。分支：`codex/beauty-kpop-v3`。

这是上一份 `beauty-features-makeup-parity-2026-10-01.zh.md` 的后续，不将前一轮的执行数量冒充本轮结果。

## 本轮改动

1. 美妆程度标签由“强度”改为剪映实际使用的“程度”，同步输入、滑杆和重置按钮的无障碍名称。英文仍为 Intensity。
2. 四列卡片限制为最大 292px 网格，正方形缩略图约 64px；增加列间距和分类间距，标签改为 11px，长标题截断但保留完整 tooltip 和 accessible name。
3. 美妆眉毛由一款真正的眉妆补到六款：标准眉、绒绒眉、野生眉、侠客眉、古韵眉、淡颜眉，顺序与本机剪映一致。
4. 旧“流畅眉”是几何眉形操作，不属于这六款眉妆。标准五官精修中的流畅眉继续保留；旧 `brows-flow` 美妆映射仅为旧项目兼容，不作为新选项。

当前共 20 个美妆定义：19 个新选择项、1 个旧项目兼容项，覆盖 12 个分类。这不是剪映完整美妆素材库。

## 眉妆资源依据

在真实剪映界面逐款选择并确认“程度 80”。同时只读解析本机资源数据库：

```text
~/Movies/JianyingPro/User Data/Cache/ressdk_db/515395108782262524/rp.db
http_cache.id = 24645
JSON.parse(JSON.parse(common_attr.extra).beautify).items[0]
```

不以卡片颜色、缩略图相似度或目录名称猜测参数。六款均为动态 `makeup.prefab`，不是五官形变包。

| 名称 | QCut ID | Resource ID | 版本 MD5 | 参数 Key |
| --- | --- | --- | --- | --- |
| 标准眉 | brows-standard | 7406180431730707727 | 1826bb4815f127fb3168b67ed4e0fc71 | face_adjust_brow_biaozhunmei |
| 绒绒眉 | brows-fluffy | 7406174643247123746 | a983387e6a01d830b4c4f9cbc6607628 | face_adjust_brow_rongrongmei |
| 野生眉 | brows-wild | 7406181254669929763 | 2041638b555e988c0b6f13839b112659 | face_adjust_brow_yeshengmeiii |
| 侠客眉 | brows-warrior | 7406174539454909730 | 8feebde948245fa77c49ead859794fb1 | face_adjust_brow_xiakemei |
| 古韵眉 | brows-classical | 7406175039264951592 | 212083cfb14f276308e23a3ee39a9034 | face_adjust_brow_guyunmeifree |
| 淡颜眉 | brows-soft | 7406174445548719394 | ed8ca9399d3ef88ea59931f6f57885a1 | face_adjust_brow_danyanmei |

默认值均为 80，范围 0–100，宿主仅下发一次 `intensity / 100`。资源解析、封面读取与运行路径沿用已有实现，不新增一套模型或绘制替代效果。

只提交映射与测试，不提交供应商效果包、模型、Lua、封面图片、签名 URL 或二进制。资源缺失时仍按已有 readiness 门控，不伪装成可用。

## 旧项目兼容

目录和运行状态新增可选 `legacyOnly` 标记，UI 不硬编码资源 ID。

- 新选择只显示非旧项。
- 当前人脸已经选中的旧项仍显示并可调程度；重复点击不重置它。
- 归零保留旧选择但不运行效果；“无”清除后旧卡片不再出现。
- 根据当前编辑的人脸投影判断旧选择，不因全局层或另一人脸的旧值泄漏到当前选择列表。
- 旧 Resource ID、版本、参数 key、保存强度和原生阶段路由不变，不将旧项目静默迁移到标准眉或新版几何包。

## 真实配对证据

```text
/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v3-20260930/makeup-parity-20261001/
```

- `jianying-front-smile/manifest.json`：最先采集的 14 款同款同值参考。
- `jianying-front-smile/manifest-final.json`：追加五款眉妆后的 19 款参考。
- `paired-before/`：最初 14 款对照，使用前一轮已完成的 QCut 报告，不冒充新 UI 截图。
- `paired-final/index.html`：本轮通过的 QCut 报告与 19 款真实剪映参考配对；7 张 `overview-*.png` 已逐页检查。最终 19 款参考前后零值漂移为 0。
- 原始剪映 UI 和结果截图保存完整窗口及 SHA-256；切到基础页再采集结果，避免人脸检测角标混入差分。

来源为同一张真实人物照片 `front-smile-original.jpg`，SHA-256：

```text
80b6d2c570b249571767409d7e9792c2d83a6ae02fa01dde7a16fa3ff7fd8138
```

剪映画面停止在 00:00:00:15。关闭皮肤管理，数值五官/脸型项保持零，每次仅一个美妆分类生效。剪映截图为 1956×1247 JPEG，播放器裁剪为 `[735,81,1311,657]`，即 576×576。展示脸部裁剪为 `[185,15,415,300]`。

对照按各端自己的零值计算 RGB 绝对差均值，统一灰度增益 ×6，模糊 σ=0.6。不逐张自动增强，不做几何配准。14 款初始参考前后零值漂移为 0。

19 款包含：氧气感、柔和粉、珊瑚裸粉、婴儿粉、混血修容、自然卧蚕、六款眉妆、妈生感 II、自然眼线、小野猫、少女粉眼影、原生美瞳、美式甜心高光、晒伤雀斑。除高光 70、雀斑 50，其余为 80。

## 视觉判断边界

14 款初始配对中，眉毛、嘴唇、面颊、鼻梁、眼线、虹膜等主要作用区域相近；卧蚕、睫毛和眼线的细部轮廓仍有差异。灰度图里的剪映 JPEG 噪声比 QCut PNG 更明显，不能把总亮度当成效果强弱评分。

最终 19 款对照追加检查了五款新眉妆，六款眉毛样式的作用位置和弧形接近剪映参考，贴图细节、局部强度及眼部轮廓仍有残差。新增样式是真实渲染、独立且不同的输出，不是替换缩略图后复用同一种效果。

这批是剪映界面截图与 QCut 编辑器画布对照，不是同规格双端导出的像素一致性证明。必须分别记录素材覆盖、UI 对齐、实际渲染、保存/重开、导出解码和视觉验收，不能用其中一项替代其余项。

### 尺寸与编码排查

`resolution-investigation/` 保存了 5 款独立效果在 4 种输入条件下的 20 组实验、100 个原生帧和自己的零值，详情为 `findings.json`。

- 输入为原图等比 576、640、1080，以及实际编辑器 1080 输入；原生运行日志中的算法帧均为 640×640。
- 原图 640 到 1080 的眼部 signed-delta 相似度为 0.961–0.983。尺寸会改变细节，但这张脸上并非整体作用区域差异的主要来源。
- 用实际编辑器输入重跑，卧蚕、睫毛、两款眼线、珊瑚裸粉的全尺寸 RGBA 输出与保存的编辑器结果逐像素相同。
- 控制变量 JPEG 4:2:0 编码实验基本复现了截图的差分平均幅度偏差；空间轮廓与 signed-delta 残差仍未解决。不能把编码模拟当成剪映算法复现。
- 本机 QCut 私有 `libcccreator.dylib` 与剪映 11.3.0 安装版本的 arm64 UUID 不同，版本不一致已确认，但这不是运行库导致残差的因果证明。

本轮没有改强度乘数、插值算法或强制降到 576。后续先取同规格、无损的剪映 1080 零值与效果导出，再单独验证运行库/模型版本与 ABI，不能让现有桥接直接调用未经验证的新库。

## 测试流程

完整 E2E 遍历 27 个标准五官项的两个非零档位，再遍历所有非旧美妆卡片。每张卡检查真实封面解码、独立应用、0 档保留、恢复同哈希和“无”清除。

新增 UI 几何检查在 1280×800、1800×1100 两种窗口运行：卡片不横向溢出，按钮位于面板内，缩略图为稳定正方形且不超过约 64px；窗口缩放后仍为同一暂停画面。

最后将柔和粉 50 与小翘鼻 50 组合，检查窗口缩放、保存退出再打开、H.264 BT.709 导出并解码 30 帧。不是分钟级运动视频或多人遮挡测试。

### 本轮测试排查

- 第一次完整运行在新增眉妆封面解码检查处失败。随后以 Electron Node 24.13.1、独立冷缓存重测五款封面，全部 HTTP 200、3.3–4.1 秒完成；将共享缓存中的五张新封面移到临时备份后，再跑真实编辑器，六款眉妆全部显示真实封面。首次失败没有稳定复现，不声称已修复网络波动；网络失败仍可能显示占位图。
- 冷缓存编辑器运行又在组合效果缩放后的哈希检查处失败。诊断发现缩放前保存的“鼻形＋口红”帧与“仅口红”帧具有同一 SHA-256；缩放前后输入为逐像素相同的 1080×1080 RGBA，后续结果与旧帧有 20,577 个像素不同。
- 原因是测试的稳定帧判定可以接受上一项效果的旧帧，异步鼻形尚未提交。组合采集现在明确排除先前口红哈希，再验证缩放及重开不改变新结果；不降低比较标准、不改强度。新增 `combined-resized.json`、结果帧和输入帧，即使断言失败也保存诊断。
- `editor-front-smile-final/`、`editor-front-smile-verified/`、`editor-front-smile-diagnostic/` 是失败或诊断证据，不作为最终通过报告。

```bash
QCUT_API_PORT=8899 \
QCUT_REQUIRE_PORTRAIT_COVERS=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH='/absolute/path/to/front-smile-original.jpg' \
QCUT_PORTRAIT_FEATURE_E2E_OUTPUT='/absolute/path/to/evidence' \
bunx --no-install playwright test \
  apps/web/src/test/e2e/portrait-feature-makeup-reference.e2e.ts \
  --project=electron --workers=1 --reporter=line
```

其余两张真人设置 `QCUT_PORTRAIT_MAKEUP_ONLY=1`，分别使用自己的照片和新输出目录，不重复计算第一张的五官覆盖。

## 本轮最终结果

| 报告目录 | 模式 | 五官档位 | 美妆应用 | 解码帧 | 导出规格 | E2E |
| --- | --- | ---: | ---: | ---: | --- | --- |
| editor-front-smile-final-pass | features-and-makeup | 54 | 19 | 30 | 1080×1080 | 3.4 分钟，通过 |
| editor-koch-final-pass | makeup-only | 0 | 19 | 30 | 1080×1350 | 1.8 分钟，通过 |
| editor-glover-final-pass | makeup-only | 0 | 19 | 30 | 1080×1350 | 2.2 分钟，通过 |

合计 54 个五官非零档位、57 次独立美妆应用、3 次组合效果保存退出重开及真实导出，90 帧全部解码。三个报告中 19 张卡片封面均正常解码，页面错误均为空；归零、恢复同哈希、“无”清除及两种窗口尺寸检查全部通过。

三次导出均为 H.264、yuv420p、TV range、BT.709 色彩三项、30 fps、1 秒。三个 `export-frame.png` 已目视检查，没有黑帧、明显错位或裁掉主体；不是剪映对照精度达标的宣称。

窗口 1280×800 的缩略图约 47.14px，1800×1100 为 64px，均为正方形、不横向溢出；不是在窄面板强制保持 64px。

其他本地检查：

- `bunx --no-install vitest run portrait jianying-nose --reporter=dot`：51 个文件、378 个测试通过，33.42 秒。
- Python 对照脚本单测：9 个通过。
- `bun run build`（apps/web）与 `bun run build:electron`：通过；原有路由/分块告警仍存在。
- 类型检查、改动文件 Biome 检查及 `git diff --check`：通过。

剪映配对仍只有 `front-smile` 的 19 款；另两张是 QCut 跨人物功能复测，不能写成三个人都与剪映同款同值对比完成。

## PR #482 复查与回归

### 分类切换时的数值草稿

实际鼠标点击分类时，Radix 在 `mouse-down` 切换面板，比数值输入框的原生 `blur` 更早。尚未提交的程度草稿可能丢失，或落到新分类；旧、新分类程度相同时，复用输入组件还可能留下旧草稿。

修复为切换分类前提交当前面板内已聚焦控件，并按分类重新挂载数值控件。四个先失败后通过的单测覆盖全部人脸、单独人脸，以及两分类程度相同、不同的组合；检查旧分类提交、新分类不变及交互事务结束。

真人 Electron E2E 通过实际点击验证：套装「氧气感」输入 `42`，不按 Tab 而直接点口红分类；时间线保留 `look-oxygen:42`、`lip-soft-pink:80`，显示口红程度 `80`，切回套装仍为 `42`。分类截图等待非黑、稳定的实际渲染帧。

最新复测目录：`output/beauty-kpop-v3-20260930/pr-482/makeup-category-draft-final/`。

- `report.json`：`completed:true`、`categoryDraftVerified:true`、19 个美妆样本、无页面错误。
- `makeup-category-draft-ui.png`、`makeup-category-draft-frame.png`：分类切换后的真实 UI 与渲染像素。
- 两种窗口尺寸无溢出；保存退出重开后组合哈希一致；真实导出 1080×1080 H.264、BT.709、30 fps、1 秒，30 帧全部解码。
- 本轮只复测第一张真人；前述另外两张的历史结果不算新代码的新增复测，也不算剪映双端导出精度证明。

### 失败取证与 CI 环境

E2E 改为在 `finally` 写报告，保留部分样本与原始异常，失败时保存 `failure-ui.png`；报告写入失败仍会关闭 Electron，成功路径不能吞掉写报告异常。

在 `QCUT_JIANYING_DISABLE_USER_CACHE=1` 下实际运行资源缺失测试：标准眉卡片因缺少安装缓存被禁用，原断言失败、进程退出码为 `1`。`makeup-missing-resource-diagnostic/` 中保留截图、6 个已完成美妆样本及错误，`completed:false`，无组合导出结果。此为负向取证验证，不计作正常 E2E 通过。

首轮 Linux CI 的唯一失败套件为 `person-cutout-model-router.test.ts`：浏览器测试环境沿 provider → makeup resolver → 封面数据库导入链打包 `node:sqlite` 失败。相同错误本地复现后，为该纯后端套件明确指定 Node 环境；未改生产逻辑、未跳过断言，覆盖率模式下 13 个测试通过。

本轮本地检查：52 个文件、395 个 Vitest 测试通过；12 个类型检查目标、四个改动代码文件的 Biome 检查通过。CI 结果须以 PR 最新提交的三平台检查为准，不以旧提交或本地结果替代。

## 尚未完成

- 其他分类完整素材库、下载管理和套装叠加的完整规则。
- 连续运动、侧脸、遮挡、多人物及身体效果叠加后的视觉稳定性。
- 同规格剪映/QCut 双端导出的精度判定及局部残差修复。
- Windows/Linux 和全新安装机资源缺失路径的独立验收。
