# 脸型主控件补齐与多人物验证

日期：2026-09-30。分支：`codex/beauty-kpop-v3`。
接续：[流畅脸 GAN 路由修正](beauty-contour-gan-routing-2026-09-30.zh.md)。
本轮完成截图中的 13 个脸型主控件，不将五色色板、美体、Windows 或动态跟踪算入完成范围。

## 控件与兼容性

主面板按剪映截图顺序排列，沿用现有数值输入、滑杆、单项及整组复位。
原有的额外脸型项保留在后面，不删项目参数。

| 顺序 | UI | key | 范围 | runtime package |
| --- | --- | --- | --- | --- |
| 1 | 流畅脸 | `face_adjust_lunkuopinghua` | 0..100 | skin-gan |
| 2 | 小脸 | `face_adjust_YouTaiFace` | 0..100 | small-face，新接入 |
| 3 | 瘦脸 | `face_adjust_TotalFace` | 0..100 | face |
| 4 | 窄脸 | `face_adjust_CutFace` | -50..50 | face |
| 5 | 下颌线 | `face_adjust_XiaHeXian` | 0..100 | jawline，新接入 |
| 6 | 下颌骨 | `face_adjust_ZoomJawbone` | 0..100 | face |
| 7 | 颧骨 | `face_adjust_ZoomCheekbone` | 0..100 | face |
| 8 | 短脸 | `face_adjust_SmallFace` | 0..100 | face |
| 9 | V脸 | `face_adjust_VFace` | 0..100 | face |
| 10 | 下巴长短 | `face_adjust_Chin` | -50..50 | face |
| 11 | 下庭 | `face_adjust_lower_atrium` | -50..50 | features |
| 12 | 中庭 | `face_adjust_mid_atrium` | -50..50 | features |
| 13 | 上庭 | `face_adjust_upper_atrium` | -50..50 | features |

小脸不是短脸。旧 `face_adjust_SmallFace` 的 key、范围和包不变。
旧 `face_adjust_jaw` 是 features 包的基础下巴轮廓，不是新版下颌线。
保留旧值及渲染语义，改名“下巴轮廓（基础）”，放到五官精修的精修分类；不自动迁移。

editor-core 持久化白名单与 Electron 契约同步新增两个独立 key。
逐脸参数沿用已有绑定协议。新控件缺包时单独禁用，不伪装成 ready 或回退到旧算子。
目录总数为 84 项（脸 74、体 10），不是新增了 84 项。

## 包身份与执行内容

本机目录和包内配置、控制器提供以下身份依据。静态分析不冒充捕获了剪映的实际调用栈。

| UI | resource ID | 版本 | 内容 |
| --- | --- | --- | --- |
| 小脸 | `7406181120506678580` | `51c8fe396e4ba74acdb7bf73058a7fbe` | `AmazingFeature/lua/reshape.lua`；V5 多器官参数与 V6 液化联合调整 |
| 下颌线 | `7493863675460160807` | `e234219f691efcb6bcdbf9c60d2c58ea` | `AmazingFeature_shadow` 阴影层 z8010，再 `AmazingFeature` FaceWarpX 轮廓层 z8011 |

下颌线不能只加载边界变形层：其 shadow/main 两个场景和控制器都纳入完整性校验。
两包的 algorithmConfig、config、场景、控制器逐文件缺失测试均覆盖。
0/50/100 原生冷宿主探针各重复三遍；最后两遍稳定，零值 RGBA 与输入逐字节相同。

实际解析来源：GAN 为 `qcut-private`；本轮新增小脸、下颌线为 `jianying-installation` 缓存。
因此本机能运行不等于所有新包已经进入私有离线快照，更不等于干净机器或跨平台可直接用。
第三方模型、Lua、场景、数据库、二进制和人物照片不提交仓库。

## 实测发现的组合问题

第一次真实运行的 28 个单项档位和独立导出完成，但五项组合缩小窗口后预览哈希变化。
新增 small-face、jawline 是有状态拟合包，却未进入已有拟合帧管理：
同一静止输入反复渲染会推进原生状态，上游改动后也可能继续使用旧拟合。

修复：两包接入现有 `portraitFittingFrameAction`。
相同输入和参数复用输出；参数改动、同帧上游像素变化、反向 seek 重建对应宿主；前进的运动帧仍保留历史。
新增四条测试先失败，再验证修复通过。

第二次真实运行通过缩放，但重开后冷启动与连续编辑不一致。
原生探针证实 skin-gan 第一遍可见输出不等于拟合已经稳定，第二遍才得到更新后的结果。
修复：skin-gan 同样接入拟合管理，真实提交前至少渲染两遍；后续静止帧复用稳定结果。
有限的空帧重试仍受原有上限约束，没有改成无限重试或放宽哈希断言。

组合原生探针的连续编辑、相邻静止帧、清理后冷启动 RGBA SHA-256 均为：
`6ada4642c6b6089dd7e269dd47a3a2d75aa77da6f6455fc751ae7342f92bd5a3`。
该哈希属于指定校准输入，不适用于所有人物。
第一次、第二次失败证据和修复前探针全部保留，只有第三次完整运行记作通过。

## 多人物与素材来源

证据根目录：`/Users/peter/Desktop/code/qcut/qcut/output/beauty-kpop-v3-20260930/face-controls/`。
原始照片不重画、不修饰；画布宽 1080，高度按原图宽高比取最近偶数，避免将方图拉成竖图。

| 目录 | 人像特征与来源 | 原始尺寸 | 画布 | 验证状态 |
| --- | --- | --- | --- | --- |
| editor-original-r3 | 原校准真人，轻微转头、手和头发遮挡；[Pexels 原页](https://www.pexels.com/photo/close-up-photography-of-woman-s-face-with-freckles-2709386/) | 4000×6000 | 1080×1620 | 完整通过 |
| editor-front-smile | 既有正面微笑人像 fixture；README 声称 Unsplash 来源，但无摄影者和原始 URL，不作为来源完整的人像素材 | 640×640 | 1080×1080 | 完整通过 |
| editor-koch-r2 | 较长轮廓、正面；[NASA Christina Koch 官方人像](https://www.nasa.gov/image-article/nasa-astronaut-christina-koch/)，ID jsc2018e095073_alt | 5873×7342 | 1080×1350 | 完整通过 |
| editor-glover | 男性正面、头盔遮挡、较明显下颌；[NASA 图集元数据](https://images-api.nasa.gov/search?nasa_id=jsc2019e021787&media_type=image)，摄影署名 SpaceX | 10800×13500 | 1080×1350 | 完整通过 |

三张可追溯真人来源，加一张来源不完整的既有人像 fixture。
没有宣称完整覆盖圆脸、方脸、心形脸等正式分类。
仓库另一张带 StyleGAN2 标识的合成人脸未纳入真人测试。
NASA 图集中的第三方署名不自动等于公有领域；素材只作本地技术诊断，不发布或用于代言。

源 SHA-256：

- 校准原图：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。
- 微笑 fixture：`80b6d2c570b249571767409d7e9792c2d83a6ae02fa01dde7a16fa3ff7fd8138`。
- Koch：`c9d1054dd50010477099b093e73aaff95759ab19099c143f5c18cb0b298ae96a`。
- Glover：`898436df779cc29c84daed42a7933763912d161dd5665850410503002eef635b`。

## 测试链条

每个人像复用同一 JSON 参数矩阵，包含 13 项脸型各两个隔离档位，另加已有肤色强度两档，共 28 例。
真实 Electron 导入、数值输入、逐项与整组复位、五项组合、1280×800 窄窗口、保存及完整应用重开。
五项组合为窄脸 -25、下巴长短 25、流畅脸 50、小脸 25、下颌线 50；缩放和重开要求同一预览哈希。

每个人像真实导出 9 次：零值、流畅脸 50/100、小脸 50/100、下颌线 50/100、归零、重开后的组合。
每次五秒、30 fps、H.264 / yuv420p / BT.709 limited-range；完整解码 150 帧。
各新包 0/50/100 首帧必须各不相同，前后零值解码首帧哈希必须相同。
不 mock 模型或编码，只给保存对话框指定测试路径。

- 单元与组件：45 文件、295 项通过。
- Python 对照及图册：55 项通过。
- Electron 构建、web TypeScript 及 Vite 构建：通过，保留既有 Vite 警告。
- 脸型真实 E2E：4 项完整通过；112 个隔离档位、36 次五秒导出、5,400 帧完整解码。
- 皮肤真实 E2E：1 项通过；八个皮肤控件 50/100、复位、组合、保存重开及 30 帧完整解码导出，证据在 `skin-regression-r2/`。
- 全仓 boundary 检查报告 47 个既有大文件超限，全部在未修改文件中；不将此写成全仓检查通过。
- filter provenance 检查通过。新增图册拒绝失败、不完整、混合参数、哈希篡改及尺寸不符的输入。

Koch 首次运行完成单项、复位、缩放及重开，但最后组合导出未落盘；保留 `editor-koch/` 失败报告。
该次与 web 构建重叠；构建结束后在 `editor-koch-r2/` 完整重跑通过，未改超时或导出断言。
不能仅凭重跑就断言构建重叠是唯一根因。后续 E2E 额外记录 console error、请求失败及 renderer crash。
Glover 成功报告的 `errors` 为空，diagnostics 仍记录字体及 app 资源的取消请求；它不是“没有任何日志”的证明。
构建与真实 E2E 应分阶段执行，不在正在使用的 dist 目录上并发构建。

## 与剪映对照

只有校准原图有同源剪映参照，因此只对它生成剪映五列图。
使用历史 UI 截图、两端自身零值基线、600×900 归一化尺寸及既有面部 ROI。
固定增益 6、sigma 0.6，无几何配准或逐图亮度拉伸，不是两端同规格导出精度验收。

| 下颌线档位 | 旧基础算子 delta MAE | 独立下颌线包 delta MAE | 误差下降 | 新 delta cosine |
| --- | --- | --- | --- | --- |
| 50 | 3.6774 | 0.6700 | 81.78% | 0.9586 |
| 100 | 5.6232 | 0.7788 | 86.15% | 0.9778 |

小脸从缺少入口变为可配对，50/100 delta cosine 为 0.9745/0.9852；没有伪造“修复前误差下降”。
流畅脸 50/100 delta MAE 为 2.0618/2.1432，仍有残差，不把拟合稳定当成视觉完全一致。

其他人像用新 `create-portrait-face-shape-gallery.py` 生成原图、QCut、灰度差分三列图。
原尺寸 PNG 与复制的原始源图保留，全画幅计算差分，展示时等比留边。
它们没有配套剪映结果，报告显式 `jianyingCompared: false`，不将相似脸型或 AI 图片当作参照。
灰度显示改动幅度，不是位移方向、语义分割或美观评分。

视觉检查覆盖小脸、下颌线五列图，三种新增人物高档位总览，窄窗口 UI 与真实导出解码首帧。
小脸是多器官联合变形，不是仅缩小外轮廓。头盔素材的下颌线变化主要位于下颌附近，
但流畅脸与小脸的差分也显示头盔边缘发生变化，不能保证遮挡物完全不受影响。
没有同人物剪映导出参照前，不擅自加一层 mask 来冒充视觉对齐；这仍是下一轮的针对性验收项。

另保存两套面部放大图：Koch 固定裁切 `(440,90,810,460)`，Glover 为 `(250,220,850,950)`，
坐标以 1080 宽编辑器画布为准。三列同裁切，仅改变展示，不改变全画幅差分、原始源图或原尺寸输出。

## 本地证据入口

- [校准原图剪映对照图册](../../../output/beauty-kpop-v3-20260930/face-controls/comparison/index.html)
- [小脸五列图](../../../output/beauty-kpop-v3-20260930/face-controls/comparison/small-face.png)
- [下颌线五列图](../../../output/beauty-kpop-v3-20260930/face-controls/comparison/jawline.png)
- [正面微笑全控件图册](../../../output/beauty-kpop-v3-20260930/face-controls/gallery-front-smile/index.html)
- [Koch 全控件图册](../../../output/beauty-kpop-v3-20260930/face-controls/gallery-koch/index.html)
- [Glover 全控件图册](../../../output/beauty-kpop-v3-20260930/face-controls/gallery-glover/index.html)
- [Koch 面部放大图册](../../../output/beauty-kpop-v3-20260930/face-controls/gallery-koch-face/index.html)
- [Glover 面部放大图册](../../../output/beauty-kpop-v3-20260930/face-controls/gallery-glover-face/index.html)
- [1280×800 UI](../../../output/beauty-kpop-v3-20260930/face-controls/editor-original-r3/compact-ui.png)
- [原生组合修复后探针](../../../output/beauty-kpop-v3-20260930/face-controls/state-after-gan-fix/report.json)

这些链接依赖本地忽略目录；仓库保存实现、测试和文档，不上传人物或第三方运行时。

## 复现与剩余边界

从应用根目录执行；给每次复现使用新的输出目录，避免覆盖既有成功或失败证据。

```sh
QCUT_API_PORT=8899 \
QCUT_REAL_PORTRAIT_IMAGE_PATH=/absolute/path/to/portrait.jpg \
QCUT_PORTRAIT_FACE_SHAPE_OUTPUT="$PWD/output/face-shape-repro" \
  bunx playwright test portrait-face-shape-reference.e2e.ts --reporter=line

python3 scripts/create-portrait-face-shape-gallery.py \
  output/face-shape-repro output/face-shape-gallery --title '真人脸型调节'

bun scripts/audit-portrait-face-shape-state.ts \
  --source output/face-shape-repro/smooth-contour-50-input.png \
  --output output/face-shape-state
```

剩余：两端同规格多人物导出精度、带真实运动的动态拟合、多脸选择、性能量化、干净机器依赖和 Windows/x86。
五种肤色色板、美体与独立 PyTorch 实现不在本轮范围。13 个主控件接齐不等于以上边界全部完成。
