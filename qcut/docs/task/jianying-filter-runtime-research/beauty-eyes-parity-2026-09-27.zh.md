# 眼部六项：界面对齐、状态修复与真实对照

日期：2026-09-27。分支：`beauty-kpop`。本轮接续[嘴部验证](beauty-mouth-parity-2026-09-27.zh.md)，只处理眼睛，不把下颌、眉毛、皮肤算作完成。

## 本轮结论

- 修复 UI：眼睛主面板改为剪映同顺序的六项，亮眼不再藏在精修中；九项额外眼部参数移入精修，旧 key、范围、算法和项目数据保留。
- 修复结果：大眼与亮眼组合受原生跟踪历史影响，调节顺序、重复静帧、保存重开会产生不同像素。正式 provider 对 `face`、`eye-details` 启用已有静帧状态合同，未改变强度曲线。
- 六项均取得剪映真实滑杆截图和 QCut 原生输出，生成 13 档、六张固定增益灰度对照。主要变化位置对应，但不是同规格无损导出的像素平价结论。
- 大眼独立包与当前组合包输出不完全相同，但对照误差几乎不变，本轮没有凭包版本差异更换算法。

## 剪映界面与本地路径

测试草稿：`QCut-Beauty-RealPeople-20260927`，时间线 02，同一张真人照片，播放头为 0。每项之前重置五官组，拍照时确认全部六个数值；完成后全部归零并关闭五官组。没有上传素材、调用云端或下载新包。

本机只读目录证据来自 `rp.db` 的 `http_cache` 第 24331 行、`data.effect_item_list[].common_attr`，并检查已缓存包的参数接收代码。目录条目不等于已经捕获剪映进程的实际调用栈。

| 顺序 | 剪映控件与范围 | QCut 存储 key | 正式 runtime package |
| --- | --- | --- | --- |
| 1 | 大眼 0..100 | `face_adjust_EnlargeEye` | `face` |
| 2 | 亮眼 0..100 | `face_adjust_BrightEye` | `eye-details` |
| 3 | 眼距 -50..50 | `face_adjust_EyeSpacing` | `face` |
| 4 | 开眼角 0..100 | `face_adjust_inner_corner` | `features` |
| 5 | 眼高低 -50..50 | `face_adjust_MoveEye` | `face` |
| 6 | 眼倾斜 -100..100 | `face_adjust_EyeTilted` | `feature-tilt` |

剪映目录标识：

| 控件 | resourceId | 版本 |
| --- | --- | --- |
| 大眼 | `7408077108586515746` | `75aa40a65cb0319757d31415f62e2658` |
| 亮眼 | `7407779333319724340` | `a5ff2cc5d18c0f1ba8803b2550be679d` |
| 眼距 | `7408076875517480227` | `aa4932200616e291a252039a3aac7232` |
| 开眼角 | `7408077213100166400` | `a56ec77b7f225d51a77b2df6e51d7be6` |
| 眼高低 | `7408076872455654708` | `aa4932200616e291a252039a3aac7232` |
| 眼倾斜 | `7406174970293849344` | `73eaa893dad063f175650f9fcf144f0a` |

本机根目录为 `~/Movies/JianyingPro/User Data/Cache/effect/`。包资源、数据库、模型、二进制、Lua 和原始截图都不提交 Git，也不代表获得再分发许可。

### 为什么暂不换大眼包

目录独立包接收 `face_adjust`，组合包接收 `face_adjust_EnlargeEye`；二者读取的控制不同，但大眼增量均为归一化强度乘以 0.14。QCut 只发送 UI 值除以 100，不重复应用包内系数。

600×900、0/50/100、每个独立包样本重复三帧稳定。与剪映截图各减各自零值后的面部 RGB delta MAE：

| 值 | 当前组合包 | 独立包 |
| --- | --- | --- |
| 50 | 0.641094 | 0.641231 |
| 100 | 1.057647 | 1.057662 |

独立包并未改善当前测量。保留已接通的正式路径；这些数字不是美观评分，也不是算法质量百分比。眼距和眼高低的组合包本身已做相应缩放，不能因为 UI 是 -50..50 再额外乘倍数。

## 已修复：组合结果依赖历史

首次真实 Electron E2E 中，13 档滑杆、复位与小窗口通过，但退出/重开后的组合 PNG 哈希不同，断言失败。参数 `EnlargeEye=50, BrightEye=100` 已正确持久化，不是存储丢值。

独立探针使用 E2E 导出的同一份 1080×1620 输入图、时间戳 0：

| 路径 | 修复前 RGBA SHA-256 |
| --- | --- |
| 先大眼50，再叠加亮眼100 | `578f7328b8579484fa494150d6d78067a50f3c6767235f224d1cbefa16545907` |
| 相同输入下一静帧 | `abb6c63176e763015a3572d5c2c48417d59d1ae397c7d52a7863e4aa1f708cb6` |
| 冷启动直接应用组合 | `0cd33f8b2689e315b89314cf9d56fe159bb6547b5eefc86eb0203851e83b4fed` |
| 先亮眼50，再应用组合 | `5ae9abdcf04d74d61ecceba2c879b831254202274fcf98d7641715c451266f99` |

`eye-details` 在 `face` 前运行。亮眼改变送入 face stage 的像素，原先 face host 沿用暂停帧的检测/跟踪状态；亮眼包自身也会保留历史。原因与嘴部组合的历史依赖同类，不能用改变 slider gain 修复。

复用 `fitting-frame-state.ts`，只扩展 `face` 和 `eye-details` 两个包：同输入同参数复用输出；暂停时输入变化、参数变化重建对应 host；连续前进且输入变化的视频帧仍保留跟踪；倒退或大时间跳变遵循已有清理规则。零值和禁用继续旁路。它影响 face 包中的其它控件，因此包含嘴部与鼻部回归。

修复后表中四条路径全部为 `0cd33f8b...83b4fed`，探针不放宽 SHA-256 断言。证据：`state-before/report.json` 与 `state-after/report.json`。

## 回归中补齐的保存与取帧保护

鼻部回归曾在关闭重开后回到空项目。检查隔离测试目录，原项目 JSON 为 0 字节，而不是鼻部参数反序列化失败。原 `storage:save` 直接写最终文件，另一次自动保存被退出打断时会先截断已保存文件。

新增 `storage-json.ts`：先序列化，通过同路径队列顺序保存，写入同目录唯一临时文件后原子 rename 发布。写入/rename 失败保留上次已发布文件，正常失败路径清理临时文件。五项真实文件系统测试覆盖发布前旧文件可读、部分写入失败、rename 失败、12 次并发保存顺序和非法序列化。没有改项目格式或扩大到删除/清空事务，也不声称具备断电 fsync 保证；强制退出可能留下不参与项目列表的 `.tmp` 文件。

另一次嘴部回归保存了全透明 PNG，但对应 UI 截图中的人像正常。旧测试在稳定性轮询后再次读取画布，且稳定性阶段未复核非空像素，重绘清空可被误收为最终结果。共享测试助手改为仅接受已提交、有可见 RGB 像素、连续稳定的帧，并直接保存这一帧，保留严格哈希断言。失败证据仍在 `mouth-regression-final/15-mouth-combined-frame.png`，不能将该轮旧 `report.json` 当作最终通过结果。

## 六张统一灰度对照

证据根目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/`。

- [大眼 50/100](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/enlarge.png)
- [亮眼 50/100](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/bright.png)
- [眼距 -50/+50](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/spacing.png)
- [开眼角 50/100](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/corner.png)
- [眼高低 -50/+50](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/position.png)
- [眼倾斜 -100/+50/+100](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/comparison/tilt.png)

每张五列：原图零值参考、剪映改后、剪映差分、QCut 改后、QCut 差分。各减各自零值，固定增益 ×6、sigma=0.6、600×900、面部 ROI `(70,195)-(535,750)`；不自动归一化、不配准、不生成式修图。灰度代表 RGB 变化幅度，不代表几何位移、内部蒙版或美观。

人工检查：大眼改变眼周轮廓，开眼角集中于内眼角；眼距/高低/倾斜改变眼部及邻近纹理。亮眼在两端都很轻，QCut 主要影响眼白与眼球附近，没有把磨皮/祛眼袋一并开启。本次截图测量中亮眼幅度较小且有低幅噪声差异，不能据此盲目乘倍数；同规格无损导出校准仍待做。

一次早期冷启动正式探针出现 `EyeTilted=50` 原样返回。第二次正式全组运行已有变化；随后五次独立 native host、每次四帧全部一致，再做十次正式 provider 独立冷启动，均改变 27,343 像素，PNG SHA-256 都为 `3f0ad7c14baad0b494ec42ba06564f690c6bf666a79076134d51ccedf812710b`，记录位于 `tilt-provider-cold-1` 至 `tilt-provider-cold-10`。不能把偶发原样输出解释为算法中值死区，也不能声称根因已修复。本次组合历史修复针对的是已独立复现的另一个问题。

## 测试状态

| 项目 | 结果 |
| --- | --- |
| Electron 构建 / 类型检查 | 通过 |
| 单元与组件回归 | 31 文件、189 项通过；含六项范围/顺序、旧项目参数、缺包隔离、状态复用与连续运动帧、原子保存、CLI 输入校验 |
| Python 差分算法 | 11 项通过 |
| 组合原生冷/热/重复静帧 | 修复后严格 RGBA 哈希一致 |
| 真实 Electron 眼睛 / 嘴部 / 鼻部回归 | 三组全部通过，4.6 分钟；包含复位、旧控件兼容、保存重开、真实导出解码 |

最终眼部链条覆盖六项控件共 13 档值、Home/End、单项/整组复位、组合、1280×800 与 1800×1100 两种窗口。大眼50 + 亮眼100 的保存前/重开后 PNG SHA-256 均为 `d868025c2e94d3d673f4fe50b8ec765b5bfdabeca1cf1035033123f173ca2405`，`pageerror=[]`。MP4 全部 30 帧解码通过，另逐帧缩小到 64×96 检查 RGB：最低均值 96.02235、最低标准差 76.48569，无空白帧；已人工检查重开 UI、窄窗口和导出首帧。

- [六项 UI 与保存重开结果](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/editor-verified/17-eyes-reopened-ui.png)
- [窄窗口截图](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/editor-verified/16-eyes-compact-ui.png)
- [真实导出首帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/editor-verified/export-frame.png)

E2E 使用隔离用户目录，不 mock native renderer、保存或编码；只替换导出文件选择对话框。初次眼部失败现场保留于 `editor/failure-ui.png`。修正保存与取帧后的三组最终证据分开写入 `editor-verified/`、`mouth-regression-verified/`、`nose-regression-verified/`，不要和之前复跑目录混淆。

## 复现与边界

```bash
QCUT_PORTRAIT_REFERENCE_SOURCE=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_REFERENCE_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/native \
QCUT_PORTRAIT_REFERENCE_WIDTH=600 QCUT_PORTRAIT_REFERENCE_COLD=1 \
QCUT_PORTRAIT_REFERENCE_FILTER='^(01|02|06|26|38|39|40|41|54|55|56|57|58|59|60)-' \
  bun scripts/audit-portrait-slider-reference.ts
python3 scripts/compare-portrait-tilt-reference.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27 --region eyes
bun scripts/audit-portrait-eye-state.ts \
  --source /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/editor/15-eyes-combined-input.png \
  --output /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/state-after

# 先构建 Electron；web 沿用前轮已构建版本，本轮未改前端组件实现。
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_EYE_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/editor-verified \
QCUT_PORTRAIT_MOUTH_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/mouth-regression-verified \
QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/eyes-fix/nose-regression-verified \
  bunx playwright test portrait-eye-reference portrait-mouth-reference portrait-slider-reference --workers=1 --reporter=line
```

这是 macOS 本机单张静态人像验证；剪映参照为 UI 截图，QCut 对照列为正式 provider PNG，不是两端同规格导出。多人、眨眼、转头、遮挡、动态视频、Windows/其它 GPU、分发安装和云端均未在本轮验收。下一部位仍按“先查差距、先修 UI、再修结果”的顺序独立推进。
