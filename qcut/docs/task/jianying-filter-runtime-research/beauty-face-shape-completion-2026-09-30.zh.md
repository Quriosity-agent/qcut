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

第一阶段只有校准原图有同源剪映参照，因此当时只对它生成剪映五列图。
使用历史 UI 截图、两端自身零值基线、600×900 归一化尺寸及既有面部 ROI。
固定增益 6、sigma 0.6，无几何配准或逐图亮度拉伸，不是两端同规格导出精度验收。

| 下颌线档位 | 旧基础算子 delta MAE | 独立下颌线包 delta MAE | 误差下降 | 新 delta cosine |
| --- | --- | --- | --- | --- |
| 50 | 3.6774 | 0.6700 | 81.78% | 0.9586 |
| 100 | 5.6232 | 0.7788 | 86.15% | 0.9778 |

小脸从缺少入口变为可配对，50/100 delta cosine 为 0.9745/0.9852；没有伪造“修复前误差下降”。
流畅脸 50/100 delta MAE 为 2.0618/2.1432，仍有残差，不把拟合稳定当成视觉完全一致。

第一阶段其他人像用新 `create-portrait-face-shape-gallery.py` 生成原图、QCut、灰度差分三列图。
原尺寸 PNG 与复制的原始源图保留，全画幅计算差分，展示时等比留边。
这些旧三列图没有配套剪映结果，报告显式 `jianyingCompared: false`，不改写旧报告为已配对。
灰度显示改动幅度，不是位移方向、语义分割或美观评分。

视觉检查覆盖小脸、下颌线五列图，三种新增人物高档位总览，窄窗口 UI 与真实导出解码首帧。
小脸是多器官联合变形，不是仅缩小外轮廓。头盔素材的下颌线变化主要位于下颌附近，
但流畅脸与小脸的差分也显示头盔边缘发生变化，不能保证遮挡物完全不受影响。
没有同人物剪映导出参照前，不擅自加一层 mask 来冒充视觉对齐；同规格导出仍是针对性验收项。

另保存两套面部放大图：Koch 固定裁切 `(440,90,810,460)`，Glover 为 `(250,220,850,950)`，
坐标以 1080 宽编辑器画布为准。三列同裁切，仅改变展示，不改变全画幅差分、原始源图或原尺寸输出。

### 第二阶段：三个人物真实剪映配对

本轮实际操作剪映专业版，创建独立测试草稿 `9月30日`，不修改用户的 `9月26日` 草稿。
时间线 04 为 Glover、05 为 Koch、06 为微笑 fixture；每条只放同源静止照片，时长五秒。
13 项各两个档位，三个不同人物合计 **78 组**。这不是 QCut 三列图再贴上剪映名称。
QCut 一侧复用上文已完成的真实编辑器 E2E 输出，本轮没有重复宣称新跑了 78 次 QCut E2E。

每例保存两张剪映原始截图：美颜面板实际数值证据，以及切回“基础”页后的无青色选脸框效果图。
原始截图是 CUA 返回的 JPEG 字节，按 `.jpg` 保存，不冒充无损 PNG；派生图为 PNG。
每个人物记录源 SHA-256、全部截图 SHA-256、截图尺寸、播放器裁切、面部裁切、归零前后截图。
源照片、参数隔离和哈希匹配后才配对；播放器边缘保留的白色素材选中框不进入面部 ROI。

| 人物 | 剪映播放器尺寸 | 配对数 | 归零前后 RGB 平均差 | 面部 delta cosine 均值 | 面部 delta MAE 中位数 |
| --- | --- | --- | --- | --- | --- |
| 微笑 fixture | 579×579 | 26 | 0.0000 | 0.8607 | 0.8058 |
| Koch | 463×579 | 26 | 0.0000 | 0.6897 | 0.8668 |
| Glover | 463×579 | 26 | 0.0000 | 0.6911 | 2.5222 |

QCut 原尺寸画布等比缩到剪映播放器原生裁切尺寸，再计算两边各自相对零值的变化。
五列为“原图/剪映零值、剪映效果、剪映改动×6、QCut 效果、QCut 改动×6”。
同一人物各列使用同一面部 ROI，同时提供全画幅版和复制的未经修饰原始照片。
固定增益 6、sigma 0.6；不做几何配准，不逐张拉伸灰度，不混用别人的脸。
delta 指标只测变化场残差，不是美观分数或相似度百分比，也不设为导出验收通过门槛。

采集中特别修正了三类假结果：

- 非负滑杆中点实际为 51；负向点实际为 -49。用数值微调到精确的 50 / -50，再保存面板证据。
- 切换时间线后可能沿用旧选脸状态：参数数值正确，但效果图完全等于零值。
  头盔组出现过此问题，重新激活正确的脸并重拍；最终 78 例均有实际非零像素变化。
- 切“基础”再回美颜会重置面板滚动位置；直接复用三庭坐标会点错控件。
  每例重新定位下庭/中庭/上庭，且播放头停在素材内部，排除片尾黑屏。

`compare-portrait-face-shape-people.py` 拒绝源图不一致、未完成的编辑器报告、缺档位、
重复档位、混合参数、错误实际值声明、哈希变化、尺寸/裁切异常、宽高比失真、黑屏、
归零漂移和非零档位完全无像素变化。最后一项是要求复查选脸/预览，不自动判成算法失败。
数值证据仍需目视核对；文件名和 manifest 声明不能代替面板数值、实际变化区域的复核。
本轮 Python 脸型图册及对照测试 **33 项通过**，另实际运行三份完整图册生成命令通过。
扩展到全部 `test_portrait*.py` 后 **69 项通过**；三套图册共 567 张 PNG 均可解码，HTML 本地链接无缺失。

目视检查了三人物全部 13 项高档位总览及参数证据。轮廓变化的位置、方向整体接近；
下颌线/下颌骨与短脸、三庭没有观察到明显串项。头盔边缘在两边的小脸、窄脸、上庭中均会变化，
因此不能仅因 QCut 影响了头盔就追加遮罩并称作剪映对齐。
仍有细节差异：剪映界面 JPEG 更软，QCut 画布更锐；Koch 的 QCut 差分有弱背景残差；
流畅脸及 Glover 颧骨的变化场一致性相对较低。残差根因尚未用同规格导出隔离，不能全部归于算法。

每人物提供 13 张双档位面部图、13 张全画幅图、5 张总览，以及数值证据和逐例原尺寸派生图。
原始剪映采集清单位于 `face-controls/jianying-multi-people/<person>/manifest.json`；
新图册为 `paired-front-smile/`、`paired-koch/`、`paired-glover/`，不覆盖旧 QCut-only 图册。

## 本地证据入口

- [微笑人像：真实剪映/QCut 13 项对照](../../../output/beauty-kpop-v3-20260930/face-controls/paired-front-smile/index.html)
- [Koch：真实剪映/QCut 13 项对照](../../../output/beauty-kpop-v3-20260930/face-controls/paired-koch/index.html)
- [Glover：真实剪映/QCut 13 项对照](../../../output/beauty-kpop-v3-20260930/face-controls/paired-glover/index.html)
- [微笑人像剪映实际数值](../../../output/beauty-kpop-v3-20260930/face-controls/paired-front-smile/parameter-proof.png)
- [Koch 剪映实际数值](../../../output/beauty-kpop-v3-20260930/face-controls/paired-koch/parameter-proof.png)
- [Glover 剪映实际数值](../../../output/beauty-kpop-v3-20260930/face-controls/paired-glover/parameter-proof.png)
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

python3 scripts/compare-portrait-face-shape-people.py \
  output/beauty-kpop-v3-20260930/face-controls/editor-glover \
  output/beauty-kpop-v3-20260930/face-controls/jianying-multi-people/glover/manifest.json \
  output/face-shape-paired-repro --title '头盔人像：剪映/QCut'

python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait_face_shape*.py'

bun scripts/audit-portrait-face-shape-state.ts \
  --source output/face-shape-repro/smooth-contour-50-input.png \
  --output output/face-shape-state
```

剩余：两端同规格多人物导出精度、带真实运动的动态拟合、多脸选择、性能量化、干净机器依赖和 Windows/x86。
五种肤色色板、美体与独立 PyTorch 实现不在本轮范围。13 个主控件接齐不等于以上边界全部完成。
