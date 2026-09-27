# 剪映美颜美体界面观察与 QCut 对照

日期：2026-09-27。QCut 分支：`beauty-kpop`，代码基线：`535a63572`。

## 观察范围

本文按阶段保留证据：第 1-6 节是最初的只读界面观察，第 7 节是真人照片实测，第 8 节是剪映单项五官滑杆对照，第 9 节是 QCut 同图运行、差异定位、代码修正与 E2E。前六节中的“未启用 / 未导出”仅描述第一阶段；下面的草稿状态也不是最新实验状态。

- 实际操作本机 `/Applications/VideoFusion-macOS.app`，Bundle ID 为 `com.lemon.lvpro`。
- 本次读取 `Info.plist`，`CFBundleShortVersionString` 与 `CFBundleVersion` 均为 `11.3.0`。不要套用旧研究文档的版本号。
- 当前草稿为“9月26日”，选中第一段视频，播放头保持 `00:00:01:16`。画面是机器人场景，不是合适的真人美颜测试素材。
- 仅选择片段、切换页签、滚动、展开手动精修和查看人脸模式菜单；未启用效果分组、调整数值、应用预设、涂抹、导出或主动触发云端任务。模式菜单重新选择原有“单人脸模式”关闭。
- 这是界面研究与静态代码对照，不是人脸识别、渲染效果、跨平台或离线能力验收。

## 1. 界面结构

入口：选中时间线视频片段，右侧 `画面 -> 美颜美体`。

```text
美颜美体
  美颜
    单人脸模式 / 多人脸模式
    皮肤管理
    脸型
    五官精修：眼睛 / 鼻子 / 嘴巴 / 眉毛
    美妆：按妆容部位分类的资源卡片
    手动精修
  美体
    智能美体
    手动美体
  美颜预设
  美体预设
```

主要交互不是一排滤镜：分组开关、折叠箭头、分组重置、滑杆与数值框、部位子页、资源卡片、预设和局部工具分别承担不同职责。当前未启用分组，因此多数参数与部位子页呈灰色；不能据此判定功能缺失、模型下载失败或未识别人脸。

## 2. 本次实际看到的功能

### 美颜

| 分组 | 可见项目 | 观察边界 |
| --- | --- | --- |
| 皮肤管理 | 磨皮、美白、匀肤、丰盈、祛斑祛痘、祛法令纹、祛黑眼圈、清晰、肤色色板 | 显示数值为 0；未测端点范围 |
| 脸型 | 流畅脸、小脸、瘦脸、窄脸、下颌线、下颌骨、颧骨、短脸、V 脸、下巴长短、下庭、中庭、上庭、发际线 | 本次滚动中可见的项目，不宣称是完整参数字典 |
| 五官精修 | 眼睛、鼻子、嘴巴、眉毛四个子页；眼睛页可见大眼、亮眼、眼距、开眼角、眼高低、眼倾斜 | 分组未开启，鼻子等子页未展开成功，不能用旧文档补成这次实测 |
| 美妆 | 套妆、口红、腮红、修容、卧蚕、眉毛、睫毛、眼线、眼影、美瞳、高光、雀斑 | 当前展示美瞳卡片，含“无”选项；未应用任何卡片 |
| 手动精修 | 瘦脸、磨皮、祛斑祛痘；画笔入口、大小、强度、五官保护 | 截图中大小为 20、强度为 50；这是当前显示值，不宣称是所有工具默认值 |

人脸模式下拉菜单实际显示“单人脸模式”和“多人脸模式”。本次未切换到多人，也未验证人物框、选择绑定或跨帧跟踪。

### 美体

智能美体当前可见 12 行：

1. 小头
2. 天鹅颈
3. 瘦手臂
4. 直角肩
5. 宽肩
6. 瘦身
7. 瘦腰
8. 长腿
9. 丰胸
10. 美胯
11. 磨皮
12. 美白

手动美体有“拉长 / 瘦身瘦腿 / 放大缩小”三种工具，当前拉长页显示强度数值 0。未启用工具，因此本次没有控制柄、作用区域、背景保护或运动跟踪的验证结果。

不能把美体页中的磨皮、美白自动解释成已经确认存在两个独立人体模型；还需要新版本效果包、参数和运行时证据。也不能把手动“瘦身瘦腿”当成自动美体的一个普通瘦腿滑杆。

### 预设

- 美颜预设：一张“无”和七张风格卡，包含“韩系清透”“蜜桃初妆”“自然柔光”等；有单人脸模式选择及总强度，当前显示 100。
- 抓图时风格卡缩略图区域为空，名称和会员标识可见。未确认是图片未加载、当前素材条件还是资源状态，不能拿这张图证明封面正常。
- 美体预设：当前显示“暂无预设”。这只表示当前环境状态，不代表剪映不支持美体预设。
- 本次未操作“保存预设”，也未验证保存、重命名、删除和重开。

## 3. QCut 现有代码，不需要从零重建

在当前分支直接导入目录常量统计得到：

| QCut 目录 | 实际数量 |
| --- | ---: |
| 数值控件总计 | 77 |
| 皮肤 | 8 |
| 脸型 | 17 |
| 五官 | 42 |
| 美体 | 10 |
| 静态登记美妆卡 | 15 |
| 美妆分类 | 12 |

这些数字来自当前代码，不是从 8 月文档照抄；它们表示目录规模，不表示 77 项本轮全部运行通过。

关键代码入口均相对 QCut 应用目录：

| 职责 | 文件 |
| --- | --- |
| 美颜、美体、两种预设页及折叠分组 | `apps/web/src/components/editor/properties-panel/media-portrait-properties.tsx` |
| 参数名称、范围、分类、运行时包映射 | `electron/jianying-portrait-adjustment-runtime/catalog.ts` |
| 美妆静态资源卡 | `electron/jianying-portrait-adjustment-runtime/makeup-catalog.ts` |
| 手动画笔 UI | `apps/web/src/components/editor/properties-panel/portrait-manual-retouch-controls.tsx` |
| 手动美体 UI | `apps/web/src/components/editor/properties-panel/portrait-manual-body-controls.tsx` |
| 预设管理 UI | `apps/web/src/components/editor/properties-panel/portrait-preset-controls.tsx` |
| 预设数据与导入导出 | `apps/web/src/lib/portrait/portrait-presets.ts` |
| 人像参数规范化 | `packages/editor-core/src/portrait-adjustments.ts` |

### 当前能明确指出的差别

1. **手动瘦脸入口缺失**：剪映手动精修显示三类；QCut 当前工具枚举在该控件中只展示 `smooth` 和 `acne`。不能拿自动瘦脸或手动美体代替局部人脸变形。
2. **美体皮肤项未在 body 目录体现**：剪映当前美体页有磨皮、美白；QCut body 目录只有 10 个形变参数。已有脸部磨皮、美白不能直接视为等价人体皮肤处理。
3. **预设产品形态不同**：剪映美颜页有风格卡与总强度；QCut 现有预设 UI 主要是用户预设选择、保存、应用、重命名、覆盖、删除、导入、导出。现有预设管理不等于已提供同等风格库与整体强度混合。
4. **参数归类不一致不等于能力缺失**：例如剪映将祛法令纹、祛黑眼圈放在皮肤管理，而 QCut 的模型参数目录有独立的眼部/五官分类。后续应按参数语义逐项对照，不能只比页面数量。
5. **运行时状态与创作控件混排**：QCut 面板顶部还有原生运行时状态、刷新及总开关；皮肤区域混入原有补光、通用美颜增强。它们与剪映分组开关的语义不同，后续 UI 需要清楚区分。

## 4. beauty-kpop 后续方向（建议，尚未实现）

这里的 K-pop 是计划中的产品风格，不是本次已发现的剪映同名模式。

- 在已有 `portraitAdjustments`、逐脸参数、美妆和预设结构上扩展，不再另建一套只改预览的状态。
- 风格预设应保存多个参数与美妆选择，并定义总强度如何混合；保留用户身份特征，默认避免极端脸型或体型变化。
- 优先补足预设卡的封面、选中态、无效果状态、总强度、逐项微调及可靠重置，而不是先堆更多滑杆。
- 将独立的手动瘦脸、人体皮肤处理列为需要单独验证的能力，不给未接通的功能放可用控件。
- 用得到授权的单人近景、双人同框、全身运动三个短片验证。重点检查转头、遮挡、人物交叉、离开再进入画面、背景直线，以及人物作用范围是否串人。
- 同一份参数要验证预览、暂停寻帧、导出、撤销/重做和项目重开；Windows/x86 与 macOS 的真实可用性另列验收，不能由本机截图推出。

## 5. 截图索引

共 11 张原始界面截图，按用户未指定位置时的桌面位置保存，未复制到仓库。以下是本机证据链接，不是随仓库分发的附件；换机器查看需要单独取得截图。

| 编号 | 内容 | 本机文件 |
| --- | --- | --- |
| 01 | 智能美体全貌 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-01-body-overview.jpg) |
| 02 | 美颜与皮肤管理 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-02-face-overview.jpg) |
| 03 | 眼部参数与美妆/美瞳 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-03-eye-makeup.jpg) |
| 04 | 脸型参数 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-04-face-shape.jpg) |
| 05 | 五官子页与眼睛参数 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-05-facial-features.jpg) |
| 06 | 美妆与手动精修入口 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-06-manual-face.jpg) |
| 07 | 展开的手动精修 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-07-manual-face-tools.jpg) |
| 08 | 美颜预设 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-08-face-presets.jpg) |
| 09 | 单人脸/多人脸菜单，弹窗局部截图 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-09-face-mode-menu.jpg) |
| 10 | 美体预设空状态 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-10-body-presets.jpg) |
| 11 | 手动美体三种工具 | [截图](/Users/peter/Desktop/jianying-beauty-2026-09-27-11-manual-body.jpg) |

## 6. 与已有研究的关系

- [美颜美体架构研究](./jianying-professional-retouch-architecture.zh.md)：旧版本的 UI、资源目录、效果包及模型链路证据。
- [QCut 差距审计](./qcut-retouch-gap-vs-jianying.zh.md)：旧版本的运行时、目录覆盖和 E2E 记录。
- [手动精修运行时研究](./manual-retouch-private-runtime-e2e.zh.md)。
- [手动美体运行时研究](./manual-body-private-runtime-e2e.zh.md)。

旧文档用于理解实现历史，不是当前 11.3.0 全部行为的复验。本轮没有抓包、反编译新二进制、校验模型精度、运行 QCut 编辑器或执行视频效果 E2E；也没有证据据此断言当前各功能全部本地或全部云端。

## 7. 真人面部与全身实测

### 环境与隔离

- 在同一剪映 11.3.0 中新建 `QCut-Beauty-RealPeople-20260927`，未修改原“9月26日”草稿的内容。
- 时间线 01 保持空白；时间线 02 为面部照片，时间线 03 为全身照片，各长 5 秒。
- 照片来自公开摄影作品，不是生成图；不能据此声称它们未经摄影后期。
- 测试目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/`。原图在 `sources/`，14 张原始界面截图在 `screenshots/`，不随仓库分发。
- 本轮验证的是剪映，不是 QCut 的运行时或跨平台验收。静态照片放入 5 秒时间线不等于真人运动视频。

### 素材来源

| 用途 | 来源与摄影师 | 本地文件 | 原始尺寸 |
| --- | --- | --- | --- |
| 真人面部近景 | [Pexels 2709386，Ike louie Natividad](https://www.pexels.com/photo/close-up-photography-of-woman-s-face-with-freckles-2709386/) | `sources/face-ike-louie-natividad.jpg` | 4000×6000 |
| 真人全身 | [Pexels 30500802，pedro furtado](https://www.pexels.com/photo/fit-woman-posing-in-activewear-on-white-background-30500802/) | `sources/body-pedro-furtado.jpg` | 2624×3936 |

来源页提供免费使用入口和许可链接；保留来源并在后续公开分发前复核适用条款。面部图保留了明显的雀斑和皮肤纹理，适合检查磨皮；全身图从头到鞋完整可见，适合检查身体形变和画面边缘。

另下载了一张 Joceline Painho 的面部局部摄影，但因裁切过紧未用于主测试，也未导入剪映：`sources/face-joceline-painho.jpg`。

源文件 SHA-256：

```text
cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2  face-ike-louie-natividad.jpg
75587671a7d96b815981150a10120c51b57ba509757d8cb27c599a495018d2aa  body-pedro-furtado.jpg
```

### 逐项结果与截图

每次单参数测试前先将上一个参数归零；表中数值以截图实际显示为准，不以自动化尝试输入的数值为准。没有使用全局撤销链恢复草稿。

| 编号 | 操作与实际值 | 观察结果 | 本机证据 |
| --- | --- | --- | --- |
| 01 | 面部原图，皮肤管理未开启 | 基线保留雀斑和纹理 | [原图](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/01-face-before.jpg) |
| 02 | 开启皮肤管理，单独磨皮 80 | 出现人脸框，皮肤纹理和雀斑明显减弱 | [磨皮](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/02-face-smooth-80.jpg) |
| 03 | 磨皮归零，单独美白 60 | 面部肤色可见提亮 | [美白](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/03-face-whiten-60.jpg) |
| 04 | 美白归零，选“韩系清透”，整体强度自动显示 80 | 肤色、纹理及五官外观发生组合变化 | [预设效果](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/04-face-korean-preset-80.jpg) |
| 05 | 从预设返回美颜页 | 皮肤参数被展开设置，脸型分组也开启 | [预设参数](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/05-face-korean-preset-expanded.jpg) |
| 06 | 预设选择“无” | 视觉恢复原图纹理；不是逐像素无损复位证明 | [面部复位](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/06-face-preset-none-reset.jpg) |
| 07 | 全身原图，智能美体未开启 | 基线包括头、双脚和背景 | [原图](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/07-body-before.jpg) |
| 08 | 开启智能美体，单独瘦身 73 | 躯干和身体轮廓发生可见收窄 | [瘦身](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/08-body-slim-73.jpg) |
| 09 | 瘦身归零，单独长腿 61 | 下半身伸长，鞋底接近画面底边 | [长腿](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/09-body-long-legs-61.jpg) |
| 10 | 长腿归零，进入美体预设 | 当前环境仍显示“暂无预设” | [空状态](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/10-body-presets-empty.jpg) |
| 11 | 关闭智能美体，开启手动美体，拉长 33 | 两条水平边界限定处理区域，身体局部比例改变 | [手动拉长](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/11-body-manual-stretch-33.jpg) |
| 12 | 手动分组重置并关闭 | 视觉恢复全身基线 | [美体复位](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/12-body-reset.jpg) |
| 13 | 再次仅启用智能瘦身 73，导出时间线 03 | MP4 / H.264 / 30fps；云备份关闭 | [导出设置](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/13-body-export-settings.jpg) |
| 14 | 完成导出 | 界面显示成功，随后验证磁盘文件和解码；未发布到抖音 | [成功页](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/screenshots/14-body-export-success.jpg) |

测试结束保留时间线 03 的智能瘦身 73，其他可见智能美体参数为 0，手动美体关闭，方便继续查看效果。时间线 02 已选择美颜预设“无”。

### 韩系清透并非仅叠加一张滤镜

应用预设后的皮肤页实际显示：磨皮 0、美白 40、匀肤 24、丰盈 40、祛斑祛痘 0、祛法令纹 32、祛黑眼圈 64、清晰 0；脸型分组同时开启。未逐项展开脸型、五官及美妆，因此这些值不是完整预设配方。

这直接支持 QCut 风格预设应是“多参数组合 + 总强度 + 可展开微调”的设计。当前只测了强度 80 的一个采样点，不能断言总强度采用线性混合，也不能由零磨皮数值推断没有其他平滑或修饰作用。

首次点击预设后的即时截图与稍后的稳定预览存在可见差异。自动化应等待效果稳定并确认实际参数，不应把点击返回视为已完成渲染。

### 导出验证

- 文件：[QCut-Beauty-RealPeople-20260927.mp4](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/QCut-Beauty-RealPeople-20260927.mp4)。只包含全身照片的瘦身 73，不包含面部测试。
- `ffprobe`：H.264、2160×3240、`yuv420p`、BT.709、30fps、150 帧、5.000 秒；另含 AAC 流。文件大小 5,296,109 字节。
- 剪映界面将该竖幅输出称为“4K”；报告以实际像素尺寸为准，不称为 3840×2160。
- `ffmpeg -v error -xerror -i <file> -f null -` 完整解码退出码为 0，无报错。
- [第 2 秒原始解码帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/body-export-frame-2s.png) 已肉眼检查，人物和画面完整可见，不是黑帧。未做严格的预览与导出像素对齐比较。
- 导出 SHA-256：`7f41d264996be874e689efc9db619f0eabdd836ecfcbd41e3af3b1394c443369`。
- 本次导出没有要求购买或接受协议；这不代表其他带会员标识的预设也可免费导出。未做购买、分享或发布操作。

### 已确认与未覆盖

已确认：真人照片的面部效果预览、组合预设参数展开、智能美体形变、手动拉长区域、视觉复位，以及单项瘦身的真实文件导出和完整解码。

未覆盖：真人运动视频的转头/遮挡/跟踪稳定性、多人逐脸绑定、所有参数端点、人体磨皮/美白、美体预设保存重开、手动区域拖动、复杂直线背景形变、面部效果导出、项目重开后的参数持久化、QCut 同素材对照、Windows/x86，以及离线/云端调用归属。此轮未抓包、断网或分析新二进制，不将响应快或没有进度窗口当作纯本地证据。

后续 QCut 验收应复用这两张基线照片，再补真人运动短片；将边缘裁切、分组复位、预设到逐项参数的一致性和预览/导出一致性列为独立断言。

## 8. 面向虚拟角色的五官滑杆对照

### 目标与采样协议

本轮目标从“有没有控件”推进到“实际改变哪里、朝哪个方向、幅度如何”。先固定剪映参照，再对齐 QCut；本节不是 QCut 效果通过报告，也不是三维捏脸能力证明。

- 沿用时间线 02 的同一张面部照片，停在第 0 帧，保持播放器尺寸、素材位置和缩放不变。
- 先清除前轮预设；每次只开一个非零参数，切换参数前归零，切换大分组时重置并关闭上一组。未使用全局撤销链。
- 读回界面实际数值，等待预览稳定后保存原始截图。99、-46、-48 是实际采样值，不写成没有测到的 100、-50。
- 22 张原始 JPEG 均为 1751×1114。统一面部裁切坐标为 `(780,210,300,360)`，局部观察另设固定眼、鼻、嘴区域，不逐张重新对齐。
- 人物轻微侧转且托腮，适合纹理与局部变化观察，但不是标准正面几何标定图。极端强度仅用于诊断，不是审美推荐。
- 最终将本轮面部参数分组归零并关闭，停留在时间线 02；没有修改时间线 03 保留的智能瘦身 73。

### 本机对照资料

目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/slider-comparison/`，不随仓库分发。

| 文件 | 内容及验证状态 |
| --- | --- |
| [index.html](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/slider-comparison/index.html) | 11 个参数组及复位组，提供面部/局部切换和完整截图链接；仅用 CSS 显示原始截图的固定区域，没有生成或修饰照片 |
| `screenshots/00-neutral.jpg` 至 `21-final-reset.jpg` | 22 张完整界面证据，包括参数值及原始预览；07 是切换鼻部后的额外零值检查 |
| [pixel-audit.json](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/slider-comparison/pixel-audit.json) | 每张截图 SHA-256、固定区域差异、部分纹理块位移及方法限制 |
| [verify_evidence.py](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/slider-comparison/verify_evidence.py) | 只读检查脚本，依赖 Pillow 与 NumPy；输出 JSON，不改截图 |

对照页的脚本语法、21 个被引用截图文件、裁切边界已静态检查通过。浏览器自动化拒绝打开本地 `file:` 页面，因此**没有完成对照页的浏览器渲染与交互验收**，未绕过该限制；下表视觉结论来自直接查看原始截图，不来自未验证的页面显示。

### 单项视觉结果

文件编号对应 `screenshots/` 中的文件名前缀；00 是共同基线，07 也是鼻部零值基线。

| 剪映名称 | 实际采样值 | 截图编号 | 本图可确认的视觉行为 | 判断边界 |
| --- | --- | --- | --- | --- |
| 大眼 | 0 / 50 / 100 | 00 / 01 / 02 | 眼部轮廓扩大，100 比 50 变化更明显，不是全图缩放或单纯提亮 | 单张侧转照片，不判断左右对称性或动态眨眼 |
| 开眼角 | 0 / 50 / 99 | 00 / 03 / 04 | 眼角及眼裂轮廓改变，作用不同于大眼 | 变化较细，需局部观察；没有测 100 |
| 眼距 | -46 / 0 / +50 | 05 / 00 / 06 | 负值更分开，正值更靠近，与“正数代表距离增加”的直觉相反 | 不是对称端点，也不是三维眼距测量 |
| 鼻高低 | -48 / 0 / +50 | 08 / 07 / 09 | 鼻部位置及鼻尖到上唇的关系改变 | 不能直接当作独立鼻长控制 |
| 鼻大小 | -48 / 0 / +50 | 11 / 07 / 12 | 负值鼻部更大，正值更紧凑 | 形变不只发生在鼻翼一条线上，需核对周围纹理 |
| 瘦鼻 | 0 / 99 | 07 / 10 | 鼻部横向轮廓收窄 | 不等于鼻大小的等比例缩放 |
| 鼻梁 | -48 / 0 / +50 | 13 / 07 / 14 | 鼻梁附近有细微轮廓、纹理变化 | 暂不足以判断是否符合期望的“立体鼻梁”；需正面和侧面样本 |
| 嘴大小 | -48 / 0 / +50 | 15 / 00 / 16 | 负值嘴唇范围更大，正值更紧凑，唇周也随形变移动 | 幅度较小，未测说话、露齿和张嘴 |
| 瘦脸 | 0 / 99 | 00 / 17 | 脸颊和下颌轮廓显著收窄，整体面部观感变化强 | 99 不宜直接作为虚拟角色自然默认值 |
| 下巴长短 | -48 / 0 / +50 | 18 / 00 / 19 | 下巴、下庭比例改变 | 手遮挡下巴底缘，遮挡边界保护未验收 |
| 磨皮 | 0 / 80 | 00 / 20 | 雀斑及皮肤细节减弱，主要五官轮廓仍保留 | 纹理减少不等于审美通过，不证明动态稳定 |

当前鼻子页实际列出瘦鼻、鼻梁、鼻高低、鼻大小、立体鼻、小翘鼻、驼峰鼻、山根，**没有直接标注“鼻子长短”**。本次只采样其中四项，不能把用户口语中的鼻长短硬对应到鼻高低。

总体视觉判断：本轮主变化与所标注的部位基本一致，磨皮、器官大小、器官位置、脸部轮廓应作为不同效果验收；不是一个通用“美颜强度”可以代表全部。鼻梁的细微效果、侧转透视、托腮遮挡和极端值的自然度仍未通过独立验收。

### 差异与方向复核

对解码后的 RGB 像素进行只读比较。面部区域为 `x=[780,1080), y=[210,570)`，背景对照区域为 `x=[780,1080), y=[82,140)`；避开人脸框叠层。MAE 是平均绝对通道差，取值范围 0–255，不是画质分数。

| 样本 | 面部 MAE | 平均通道差大于 8 的面部像素比例 |
| --- | ---: | ---: |
| 大眼 50 / 100 | 0.896 / 1.466 | 2.62% / 4.50% |
| 开眼角 50 / 99 | 0.300 / 0.464 | 0.96% / 1.44% |
| 瘦脸 99 | 12.023 | 36.49% |
| 磨皮 80 | 2.750 | 9.01% |
| 鼻部零值检查 07 | 0 | 0% |
| 最终复位 21 | 0 | 0% |

22 张图的背景对照区域 MAE 均为 0；这只证明所选背景区域未变化，不能推出全部背景未被形变。鼻部零值检查与最终复位的面部区域逐像素一致，证明本次测量区域回到基线，不声称整个界面截图或项目状态相同。

眼距方向另外用两个 11×11 纹理块检查，基线中心分别为 `(822,366)` 与 `(922,347)`。在各方向 ±10 像素范围内搜索最小均方误差，-46 时水平位移约为 `(-3,+3)`，+50 时为 `(+3,-3)`，支持负值分开、正值靠近的视觉判断。鼻翼及嘴角纹理块也支持本图负值变大、正值收紧；它们不是语义关键点检测，也不能精确量化实际器官尺寸。

复核命令：

```sh
python3 /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/slider-comparison/verify_evidence.py
```

### QCut 对齐入口与风险

下表来自当前代码只读核对，是下一轮候选映射，**不是相同数值会产生相同画面的证明**。

| 剪映参照 | QCut 当前候选参数 |
| --- | --- |
| 磨皮 | `face_adjust_Smooth` |
| 大眼 / 开眼角 / 眼距 | `face_adjust_EnlargeEye` / `face_adjust_CornerEye` / `face_adjust_EyeSpacing` |
| 鼻高低 | `face_adjust_MoveNose`，另有 `face_adjust_nose_position` |
| 瘦鼻 | `face_adjust_Nose` |
| 鼻大小 / 鼻梁 | 初轮候选为 `face_adjust_nose` / `face_adjust_nose_bridge`；后续已证实前者不是当前剪映“鼻大小”，应为独立 `face_adjust_3DNose_Big`，见[根因与探针](beauty-nose-routing-root-cause-2026-09-27.zh.md) |
| 嘴大小 | `face_adjust_ZoomMouth`，另有 `face_adjust_mouse` |
| 瘦脸 / 下巴长短 | `face_adjust_TotalFace` / `face_adjust_Chin` |

入口为 `electron/jianying-portrait-adjustment-runtime/catalog.ts` 与 `advanced-controls.ts`。注意 `face_adjust_Nose` 与 `face_adjust_nose` 大小写不同、目录标题也不同，不能统一转小写后去重。近义的基础项与高级项应分别测试，不预先视为别名，也不同时开启来凑效果。

下一轮按以下顺序复用参照：

1. **相同输入与基线**：QCut 导入同一源照片，固定原始分辨率、裁切、帧、颜色与缩放；先保留 QCut 全关基线，验证应用内复位一致。
2. **单项扫描**：每个候选参数分别跑零值、中值、端点，记录 UI 值、规范化值、运行时键及效果包版本。先验证作用区域与方向，再拟合强度，不要求不同产品相同数字天然等价。
3. **同条件对照**：输出原图、剪映、QCut 三列及局部裁切；优先用同规格导出帧比较。不同 UI 播放器截图不能直接作逐像素精度门槛。
4. **创作观感**：为虚拟角色检查自然强度、身份特征保留、左右眼/鼻翼一致性、头发与手遮挡边界；极端形变可用于定位错误，但不作为风格默认。
5. **动态与状态**：补无遮挡正面、侧面、眨眼、说话、转头短片，以及多人样本。单独验证跟踪抖动、串脸、撤销重做、预设保存重开、暂停寻帧与导出一致性。

截至第 8 节采样时，尚未执行 QCut 对照；第 9 节补充本轮真实运行与修正。前节的全身瘦身导出结果不能替代面部验证。二维图像滑杆形变也不能自动等同于稳定的三维角色骨骼或可跨姿态保持的身份参数。

## 9. QCut 同图对照、差异定位与兼容修正

### 本轮范围和结论

2026-09-27，`beauty-kpop`，基础提交 `535a63572416ed1f0727a7d2f26dfa105b764b95`。先实际操作已安装的 QCut，再构建当前分支，用隔离的 Electron 配置目录进行真实 UI、IPC、本机运行库和导出测试。以下修改尚未发布到安装版。

**此前确实接通了本机运行库，不是空滑杆；差距发生在控制项身份、参数语义、输入规格和尚未完成的视觉校准，而非简单缺少一个神经网络。** 本轮只修正有证据支持的入口混淆，没有随意修改全部强度或替换模型。

- 仍使用第 8 节的同一张照片，源 SHA-256 为 `cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。
- 安装版创建独立项目 `QCut-Beauty-Compare-20260927`，ID `777c260a-b66b-4cc8-8621-3ed093a5a5c6`；其他已有项目未修改。
- 该项目默认横屏 `1920×1080`、图片 cover 会裁掉部分人脸。对照前改成 `1080×1620`，保留完整 2:3 照片。这是测试条件纠正，不宣称本轮修改了全产品的默认裁切逻辑。
- UI 显示“剪映本机二进制 / 离线就绪”；原生探针 provider 为 `jianying-local-swing-v1`，没有调用云端美颜。
- 本机拥有 77 个目录控制项不代表 77 项均已与剪映对齐。本轮围绕 11 个参照参数及近义候选做 30 组原生渲染，输入 `600×900`；另外做零值和鼻高低的 `1080×1620` 导出尺寸复核。

### 可直接查看的对比图

| 资料 | 看什么 |
| --- | --- |
| [鼻高低：基线、剪映、QCut 旧项、新入口](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-position-before-after.png) | 同为 -48/+50，旧基础项与高级位置项不是同一视觉操作；后者变化更接近参照 |
| [大眼、开眼角、磨皮三列对照](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/eyes-skin-reference.png) | 大眼方向接近；开眼角幅度和作用区域仍有差别；磨皮同值并不等强 |
| [鼻大小、下巴和瘦脸三列对照](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/nose-chin-reference.png) | 鼻大小负向差异明显；下巴受托腮遮挡干扰；瘦脸方向一致但极值不宜作自然默认 |
| [修改后 QCut 鼻高低 -48 完整界面](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-after/02-nose-minus48-ui.png) | 确认新入口、数值和真正的编辑器预览 |
| [仍保留的基础位移界面](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-after/05-classic-minus48-ui.png) | 旧控制项仍可使用，没有静默迁移旧项目 |
| [QCut 导出首帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/qcut-comparison/editor-after/export-frame.png) | 实际 H.264 视频解码所得，不是界面截图 |

三张并排图均由真实证据拼接，没有生成或修饰人脸。剪映列来自 `1751×1114` JPEG 截图，固定播放器矩形 `(731,79,396,592)`；QCut 列来自 `600×900` 原生 PNG，统一缩放到 `396×592` 后取面部区域 `(49,131,300,360)`。没有做非刚性配准、美化或差异抹除。原始文件哈希与裁切参数见 `qcut-comparison/contact-sheets-manifest.json`。

**这些图适合观察部位、方向和相对幅度，不是同规格导出逐像素验收。** 两端截图/缩放/编码不同，零值基线也不完全相同，不能把像素相似度解释为“完成百分比”。

### 已找到的差异及原因

| 项目 | 观察 | 已确认原因或边界 |
| --- | --- | --- |
| 鼻高低 | 原 `face_adjust_MoveNose` 与剪映参照变化不一致；另一个 `face_adjust_nose_position` 明显更接近 | 两项分别走基础 face 和 features 包，使用不同的变形器，不是中文名称的同义别名 |
| 开眼角 | QCut `CornerEye=99` 改变范围比剪映参照更大；`inner_corner=50` 候选更接近部分变化 | 两套算子不同，尚未验证剪映实际入口、范围和曲线；没有把候选直接替换为生产映射 |
| 鼻大小 | 正负端点均有差距，简单减半强度不能同时解决 | 已做 -24/+25 试验，不能用一个全局乘数解释，具体根因仍未定 |
| 嘴大小 | 基础 `ZoomMouth` 比近义的 `mouse` 候选更接近本图参照 | 保留现有项，未为了名称统一而替换 |
| 大眼、眼距、瘦鼻、鼻梁、瘦脸 | 本图主要方向和作用区域接近，幅度仍非严格相等 | 同名滑杆不保证等同的参数曲线和关键点结果 |
| 磨皮 | 两端都降低雀斑/纹理，但同为 80 时观感不完全相同 | 缩放及处理分辨率会影响细节；尚未隔离是哪一步造成差距 |
| 输入与预览 | QCut 当前预览按容器尺寸处理，本次 E2E 实测 `407×611`，导出 `1080×1620` | `color-preview-canvas.tsx` 使用父容器尺寸；这是已确认的输入条件差异，不据此断言剪映内部必用更高分辨率 |
| 状态残留 | 26 组共有案例，暖进程与每组清理后的冷进程 PNG 哈希全部相同 | 本次静态输入没有发现前一个控制项污染下一个；不扩展为动态跟踪无状态问题的证明 |

只读核对本地包发现，基础 face 与 features 的参数名、内部增益和算子名称不同。例如基础包的眼距、嘴大小、下巴各有不同倍率；features 的大多数形变项有自己的倍率。QCut 入口传入 `value/100`，不能再根据一个包的倍率去统一修正所有控制项。

本次解析到的私有运行包身份：

| 包 | resourceId | version |
| --- | --- | --- |
| face | `7408077448513998114` | `aa4932200616e291a252039a3aac7232` |
| features | `7408077472211668276` | `f662ff9c955ee319f1ae03b2aa27df76` |
| smooth | `7408077820116667700` | `b000f31572be3e5f9fd195d7bba37968` |

缓存另有一个 features 目录 `07466e73caa1d4a19a91d290413cd5e6`，其控制 Lua 与当前包相同，但部分材质和资源文件不同。本轮没有证据证明它是剪映当前使用的“更新包”，因此没有盲目切版本。未修改剪映安装目录、私有资源包或模型，也未把它们加入仓库。

### 本轮代码修正

1. `catalog.ts`：大眼、眼距、开眼角等归“眼睛”，瘦鼻归“鼻子”，嘴部项归“嘴巴”，不再把常见项分散在“常用”和解剖分组之间。
2. 将旧 `face_adjust_MoveNose` 改名为“鼻部位移（基础）”，移到“精修”；保留参数键、范围、归一化方式及 face 包路由。
3. `advanced-controls.ts`：将现有 `face_adjust_nose_position` 的中文入口统一为“鼻高低”，保留 features 包路由。新用户按剪映名称选择时，会进入本图更接近的控制项。
4. **这是控制项身份和 UI 入口修正，不是修改底层算法。** 老项目、预设中的 `MoveNose` 不迁移，不会因为升级而自动变成另一个鼻子；不能宣称旧项目的画面已经变成剪映等效结果。

### 验证记录

| 验证层 | 实际结果 |
| --- | --- |
| 原生单项扫描 | 30 组 `600×900`；非零参数均有像素变化；00、07、21 三个零值帧一致 |
| 冷暖进程复核 | 26 组共有样本 PNG SHA-256 全部一致 |
| 单元测试 | 新增 8 项控制身份/分类/大小写键/符号兼容测试，连同现有 16 项，共 24/24 通过 |
| UI 组件回归 | 既有分组折叠测试 2/2 通过；当前 web TypeScript 检查、7 个代码文件的 Biome 检查及 `git diff --check` 通过 |
| 构建 | `bun run build:electron` 与 `apps/web` 的 `bun run build` 通过；Vite 有既有的大 chunk、混合动态导入等警告 |
| 真实 Electron E2E | 独立 user-data-dir，新建项目；真实 UI 设置大眼、鼻高低 -48/+50、基础位移、重置、重新应用、导出；没有 mock native renderer |
| UI 状态 | “鼻高低”写入 `face_adjust_nose_position`，基础项写入 `face_adjust_MoveNose`；不会同时偷偷开启另一个鼻部算子 |
| 预览恢复 | 鼻高低 -48 首次与重置后再次应用的 PNG 哈希相同；界面基线和重置截图内固定画面区域 `(799,121)-(1196,725)` 逐像素相同 |
| 导出 | 1 秒 H.264，1080×1620，yuv420p，30fps/30 帧；FFmpeg 全片解码通过，首帧已人工查看 |
| 错误与截图 | 测试 report 的 renderer page errors 为 0；8 张完整界面图、5 张预览 PNG、导出首帧和报告保留在 `editor-after/` |

单独以相同 `1080×1620` 输入渲染鼻高低 -48，与实际视频解码首帧复核：固定鼻部 ROI `x=[170,460), y=[740,1020)`，导出对已处理原生帧的 MAE 约 4.06，对未处理基线约 10.65。这支持效果进入了导出，但仍有解码、缩放和颜色转换差异，**不是无损或逐像素一致的结论**。本轮导出来自静态照片，不是动态真人视频。

### 复现入口

```sh
# 源图与证据根目录仅在本机，不随仓库分发。
export QCUT_PORTRAIT_REFERENCE_SOURCE="/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg"
export QCUT_PORTRAIT_REFERENCE_OUTPUT="$PWD/output/portrait-slider-reference"
QCUT_PORTRAIT_REFERENCE_COLD=1 bun scripts/audit-portrait-slider-reference.ts

QCUT_PORTRAIT_REFERENCE_ROOT="/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27" \
  bun scripts/create-portrait-reference-contact-sheets.ts

bunx vitest run electron/__tests__/portrait-slider-reference-catalog.test.ts electron/__tests__/jianying-portrait-adjustment.test.ts

# 先构建 electron 和 apps/web；8899 应为空闲端口。
QCUT_API_PORT=8899 \
QCUT_REAL_PORTRAIT_IMAGE_PATH="$QCUT_PORTRAIT_REFERENCE_SOURCE" \
  bunx playwright test portrait-slider-reference.e2e.ts --reporter=line
```

原生探针还支持 `QCUT_PORTRAIT_REFERENCE_WIDTH=1080`、`QCUT_PORTRAIT_REFERENCE_FILTER='22-alt-nose-position'`。结果 JSON 包含源哈希、包路径、参数、耗时和 PNG 哈希。E2E 是需本机真实素材/运行库的 opt-in 测试；没有素材时跳过，不能把跳过当成功。运行库未就绪时应失败，不用 mock 绕过。

### 仍需缩小的差距

后续进展见 [第二轮：紧凑 UI、固定预览尺寸与开眼角导出校准](beauty-ui-result-parity-2026-09-27.zh.md)。下面是第一轮结束时的待办快照，其中开眼角与处理尺寸已在第二轮继续验证。

1. **优先对齐开眼角、鼻大小。** 先拿剪映同规格导出零值及多个强度的帧，确认实际包、算子及范围；正负方向分别拟合，不凭一个极值定全局系数。
2. **统一比较条件。** 固定人脸目标、输入尺寸、取帧时刻、fit 与色彩路径；测 `407×611 / 600×900 / 1080×1620` 的分辨率敏感性，再决定是否给预览固定处理尺寸。不要先提高分辨率而忽略拖动性能。
3. **补动态身份稳定性。** 用正面、侧转、眨眼、说话、手遮挡及多人短片，逐帧检查关键点抖动、边缘拉扯、串脸；再覆盖撤销/重做、预设保存重开与寻帧。
4. **美体另做。** 本轮未重跑全身滑杆或 Windows/x86，不以人脸测试代替身体骨骼、腿长、瘦腰及跨平台验收。
5. **虚拟角色不是“最大美颜”。** 先建立自然范围和身份约束，区分皮肤纹理、局部器官大小、位置、轮廓；当前二维变形能力不能当作跨姿态一致的三维角色参数系统。
