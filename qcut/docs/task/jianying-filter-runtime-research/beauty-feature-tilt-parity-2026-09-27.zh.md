# 嘴倾斜、眼倾斜：发现差距后先修复

日期：2026-09-27。分支：`beauty-kpop`。

本轮按用户要求暂停全脸逐项采集，先解决已经发现的两项缺口。不把未测试的嘴部、眉毛、皮肤或动态视频一起标为完成。前置工作见[美颜界面与输出对齐](beauty-ui-result-parity-2026-09-27.zh.md)和[鼻大小路由修复](beauty-nose-routing-root-cause-2026-09-27.zh.md)。

## 结论

- 原因不是滑杆倍率偏小，而是 QCut 原先没有接入嘴倾斜、眼倾斜这两个独立参数及其效果包。
- 已接入正式 catalog、参数校验、项目持久化、预览和导出。UI 在嘴巴、眼睛分组中分别显示同名控件，范围 `-100..100`、步长 1、零点居中，可输入数值、键盘调整、单项重置。
- 单人静态照片实测：正负方向和改动部位接近剪映；统一增益灰度图仍能看到边缘和强度差异，不能宣称像素一致。
- 这是本机已有原生运行时的接入，不是 QCut 自研复刻。效果包当前来自剪映缓存，`offlineReady=false`；没有把剪映二进制、Lua 或模型提交进仓库。

## 根因证据

本地只读检查来源：

```text
/Users/peter/Movies/JianyingPro/User Data/Cache/ressdk_db/515395108782262524/rp.db
http_cache: eyes row 24331, mouth row 24333

/Users/peter/Movies/JianyingPro/User Data/Cache/effect/
7406181636397616419/73eaa893dad063f175650f9fcf144f0a/
```

| 项目 | 眼倾斜 | 嘴倾斜 |
| --- | --- | --- |
| catalog resource ID | `7406174970293849344` | `7406181636397616419` |
| `extra.intensity_key` | `face_adjust_EyeTilted` | `face_adjust_MouthTilted` |
| UI 范围 | -100 到 100 | -100 到 100 |
| 包版本 | `73eaa893dad063f175650f9fcf144f0a` | 相同 |
| QCut runtime package | `feature-tilt` | 同一个 stage |

两张卡对应同版本包，本机嘴倾斜目录内的场景和控制器同时实现这两个键，因此复用一次 stage，不重复运行同包。不能用旧 `face_adjust_MouthCorner` 或眼角扩张替代。

`AmazingFeature/lua/FaceReshapeControlSystem.lua` 的关键行为：

1. `nameMap` 接收上述 `face_adjust_*` 键。包内 `config.json` 中的 `eye_adjust_*` / `mouth_adjust_*` 名称不能直接当事件参数。
2. 输入为 `[{id, intensity}]`，支持全局 `id=-1` 和按 freid 匹配的人物项。
3. 正负值分别选择不同的 `FaceReshapeLiquefy` 实体；零值不显示这两条分支。
4. 脚本第 133-136、171-174 行再将所选分支的值变换为 `(val + 1) / 2`。QCut 只发送 `UI 值 / 100`，不能提前变换一次，更不能取绝对值后丢掉方向。

包声明涉及 blit/face/freid，以及 `tt_face`、`tt_face_extra`、`tt_fsnew_base_jianying`、`tt_freid`。声明存在不等于运行通过；下述真实 provider 和编辑器测试才是本机可运行证据。

## 实现范围

| 文件 | 本轮变化 |
| --- | --- |
| `electron/jianying-portrait-adjustment-contract.ts` | 新增两项 key 和 `feature-tilt` 包类型 |
| `packages/editor-core/src/portrait-adjustments.ts` | 两项纳入规范化、非零检测、项目序列化 |
| `electron/jianying-portrait-adjustment-runtime/catalog.ts` | 新包身份、运行顺序、双向范围、中文名称和解剖分组 |
| `electron/jianying-portrait-adjustment-runtime/package-resolver.ts` | 检查 algorithmConfig、config、main.scene 和专用 Lua；缺失不假装可用 |
| `electron/__tests__/jianying-feature-tilt.test.ts` | 14 项参数、stage、持久化、缺包与缓存禁用测试 |
| `apps/web/src/components/editor/properties-panel/__tests__/portrait-tilt-controls.test.tsx` | 真实 catalog 驱动的 UI 范围、相互独立、归零、缺包禁用测试 |
| `apps/web/src/test/e2e/portrait-slider-reference.e2e.ts` | 两项四档数值、重置、与 3D 鼻组合、完整重开和导出 |
| `scripts/audit-portrait-slider-reference.ts` | 新增八个倾斜样本及归零样本 |
| `scripts/compare-portrait-tilt-reference.py` | 复用既有差分方法生成两张五列对照图、原始幅度和可追溯报告 |

已有紧凑滑杆组件按 catalog 呈现新项，没有复制一套 UI。两项进入同一 `feature-tilt` stage；每次显式发送两个参数，未使用项也发送零，避免原生状态残留。旧嘴角、旧眼角和旧项目参数不改名迁移、不偷换算法。

目前顺序是已有 face/features 后运行 feature-tilt，再到 3D nose。这是 QCut 本轮测试过的组合顺序，不宣称已经证明剪映所有组合都用这个顺序。

## 真实对照与差分

素材沿用同一张 Pexels 2709386 / Ike louie Natividad 照片：

```text
/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg
SHA-256: cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2
```

剪映测试草稿 `QCut-Beauty-RealPeople-20260927`，时间线 02。逐项开关、其余参数归零，截取 -100、+100 与各自零值；结束后归零并关闭五官组。没有改动身体时间线。

- [嘴倾斜：原图、剪映、灰度差分、QCut、灰度差分](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/comparison/mouth.png)
- [眼倾斜：相同五列](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/comparison/eyes.png)
- [完整指标及来源哈希](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/comparison/report.json)

方法固定：剪映原始截图 1751×1114，播放器裁切 `(731,79)-(1127,671)`；QCut 原生输出 600×900。统一为 600×900，Gaussian sigma=0.6，脸部 ROI `(70,195)-(535,750)`。两边分别减自己的零值基线，RGB 绝对差取通道均值，显示增益固定 ×6，255 封顶。不做逐图自动归一化、几何配准或生成式修饰。

第一列显示剪映零值，并不是声称两端基线逐像素相同。每个案例单独保存两份零值图、结果图、差分 PNG 和未乘显示增益的 `.npy` 幅度。

| 参数值 | 有符号 RGB 差分方向余弦 | 差分 MAE | 剪映变化幅度均值 | QCut 变化幅度均值 |
| --- | ---: | ---: | ---: | ---: |
| 嘴倾斜 -100 | 0.7334 | 1.5256 | 1.8280 | 1.7130 |
| 嘴倾斜 +100 | 0.6970 | 1.2245 | 1.3428 | 1.2323 |
| 眼倾斜 -100 | 0.7960 | 1.2388 | 1.7073 | 1.6345 |
| 眼倾斜 +100 | 0.7196 | 0.9798 | 1.1400 | 1.0695 |

这些是单张照片、截图与 native PNG 之间的诊断量，**不是还原百分比或美观评分**。报告中的 `missingRouteDeltaMae` 是“完全无效果”假设的数学参照，不是伪造的旧 QCut 输出。灰度图只能显示像素变化幅度，不能显示位移方向或算法内部蒙版。

视觉检查：主要亮区分别集中在唇部、眼周，正负方向合理，未见整张脸一起变形。QCut 幅度略弱，但截图缩放、输入尺寸、检测条件与采样都可能影响这一差异。先补同规格导出，不能据此直接乘一个补偿系数。

## 验证记录

| 层级 | 结果 |
| --- | --- |
| TS/React 回归 | 22 个文件、148 项通过，覆盖 catalog、参数校验、持久化、人物作用域、UI、预览尺寸与旧鼻子路由 |
| 差分数学测试 | 11 项通过，包含固定增益、局部变化、符号不抵消及指标边界 |
| 构建 | Electron 构建与 Web TypeScript/Vite 构建通过；Vite 既有警告未作为本轮问题处理 |
| 静态检查 | 本轮 9 个 TS/TSX 文件 Biome 通过 |
| 冷启动 native 探针 | 全零、两项各 -100/-50/+50/+100、归零共 10 个样本，均产出 PNG |
| 归零 | native 零值与最后复位 PNG SHA-256 相同：`9ed19f11fa409f1394adb931ff6e0df9cb2cd7e9fa164c1f137ff1909bc67600` |
| 真实编辑器 | 滑杆 Home/End、数值输入、单项与整组归零、旧项兼容、保存和整个应用关闭后重开、真实 native 导出通过 |
| 组合持久化 | 嘴倾斜 +50、眼倾斜 -50、3D 鼻大小 -48；重开后的三个参数完全保留，组合 PNG 哈希与重开前一致 |
| 导出 | 1080×1620，30 帧完整 FFmpeg 解码通过，已查看导出首帧；不是只判断文件存在 |
| 错误 | 成功 E2E 报告 renderer page errors 为 0 |

E2E 使用隔离 user-data-dir，真实 native 预览和编码不 mock，只由测试指定保存对话框路径。没有替换 `/Applications` 内的安装版，没有发布版本。

本机证据根目录是 `/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/`。`native/` 是探针，`comparison/` 是剪映对照；`editor/` 为第一次成功 E2E，`editor-final/` 为整理组合截图命名后的复跑结果。

- [QCut 嘴倾斜面板](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final/tilt-face_adjust_MouthTilted--100-ui.png)
- [QCut 眼倾斜面板](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final/tilt-face_adjust_EyeTilted-100-ui.png)
- [组合后保存重开](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final/15-combined-reopened-ui.png)
- [导出首帧](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final/export-frame.png)
- [最终 E2E 报告](/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final/report.json)

## 复测

在仓库根目录运行；需要本机已可用的原生运行时和上述本地效果包。Python 分析脚本使用 Pillow 与 NumPy。

```sh
QCUT_PORTRAIT_REFERENCE_SOURCE=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_REFERENCE_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/native \
QCUT_PORTRAIT_REFERENCE_COLD=1 QCUT_PORTRAIT_REFERENCE_FILTER=tilt \
  bun scripts/audit-portrait-slider-reference.ts

python3 scripts/compare-portrait-tilt-reference.py \
  /Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27

python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait_*.py'

# 先完成 bun run build:electron，以及在 apps/web 内 bun run build。
QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg \
QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT=/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/tilt-fix/editor-final \
  bunx playwright test apps/web/src/test/e2e/portrait-slider-reference.e2e.ts \
    --workers=1 --reporter=line
```

## 剩余边界

1. 补剪映与 QCut 同源、同尺寸导出后，再定位剩余差分是否由输入尺寸、检测点或组合顺序引起。当前只有 QCut 导出链通过，不能替代双方导出精度验收。
2. 动态眨眼、说话、侧脸、遮挡和多人仍未实际验收；单测的 trackId 路由不等于多人画面质量通过。
3. 当前依赖本机剪映缓存，不声称 Windows 或独立离线安装已可用。
4. 面板依然存在基础项与高级项并列、眼睛分组较长的问题，本轮只补这两个明确缺口，不声称整个 UI 已与剪映一致。
5. 下一项仍按“发现差距、查参数与运行路径、修 UI 和结果、留同源对照”推进，不等全脸审计结束才修复。
