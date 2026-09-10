# 2026-09-10：自研视频防抖（OpenCV 运动估计 + 已还原的 lens C++）

「让 QCut 的滤镜能打」路线的第二批产品工作。此前 `视频防抖` 一栏只是把 `enhancements.stabilization` 量化成 FFmpeg `deshake` 的搜索半径：单遍块匹配、只补平移、预览靠 FFmpeg 代理视频、导出只在 CLI 引擎生效。本批把它换成一条自研链路，预览与画布导出用同一套逐帧校正。

## 一、算法

1. **运动估计（OpenCV.js，Worker 内）** `apps/web/src/lib/stabilization/opencv-motion-estimator.ts`
   - 每对相邻帧：上一帧 GFTT 角点（≤300）→ 金字塔 LK 正向 + 反向（往返误差 > 1.5 px 丢弃）→ `estimateAffine2D` RANSAC 取内点 → 内点上闭式最小二乘拟合 4 自由度相似变换（平移、旋转、等比缩放）。
   - 分析分辨率 ≤ 640×360，帧由 mediabunny（WebCodecs）在主线程解码为灰度，与平面追踪共用 `MediabunnyPlanarFrameSource`。
   - 匹配失败的帧对记为恒等且 `inliers = 0`，不编造运动。
   - 打包的 `@techstark/opencv-js 5.0.0-release.1` 运行时**没有** `goodFeaturesToTrack` / `estimateAffinePartial2D`，所以用 `GFTTDetector` + `estimateAffine2D` + 自己的相似拟合。
2. **轨迹平滑（lens 移植）** `lens-gaussian.ts` ← `research/independent-lens-contract/gaussian.cpp`
   - 逐帧运动累加为轨迹（中心平移、角度、log 缩放），用 lens 的高斯核平滑：核在 ±3σ 上等距采样，长度决定形状，double 权重、边缘钳位、binary32 输出。
   - 单测钉在 C++ 测试里的原生 fixture：长度 3 权重 `0.0870493554…/0.8259012891…`、脉冲响应、边界复制。
3. **运动约束（lens 移植）** `lens-motion-constraint.ts` ← `motion_constraint.cpp`（Move::Run，border mode 11）
   - 每帧校正 = 平滑轨迹 − 实测轨迹；把输出矩形按 `cropScale` 缩小、反向旋转、平移回源图得到采样窗口，交给约束：缩放钳到 `[0.2, 1]`、二分收缩旋转直到窗口落在画幅内、平移裁到 `[0, extent − 1]`。窗口永远不出源图，因此**没有黑边也不需要补边**。
   - 全程 `Math.fround` 模拟 binary32；单测复现 C++ 的 goldens（含 16.61317444° / 14.19368362° 两个旋转 fixture，容差 1e-4，因 libm sin/cos 位级不可移植）。
4. **等级 → 参数** `apps/web/src/lib/video/stabilization-levels.ts`
   | 等级 | 平滑窗口 | cropScale（保留比例） |
   |---|---|---|
   | 低 | 0.6 s | 0.94 |
   | 推荐 | 1.2 s | 0.90 |
   | 高 | 2.0 s | 0.86 |
   | 最强 | 3.0 s | 0.80 |
   存储值仍是 0–100，老项目不用迁移。CLI/API 的 FFmpeg 引擎仍按同一值量化 `deshake` 半径。

## 二、产品接入

- **分析缓存** `stabilization-store.ts` + `stabilization-analysis-storage.ts`：按源文件 SHA-256 + 分析版本存 IndexedDB（`qcut-stabilization`），同一素材的所有片段共用；plan（分析 × 等级）内存记忆化。
- **预览** `stabilized-video-canvas.tsx`：读 `<video>`（暂停时若有本机增强帧则读那张 `<img>`），按 `currentTime + 代理偏移` 查 plan，把校正后的整帧画进与源同尺寸的 canvas，再由 CSS object-fit 摆到片段位置；原 `<video>` 置透明。调色 / Filter Lab 的 `ColorPreviewCanvas` 改为从该 canvas 取源（`data-stabilized-source-id`），通过 `qcut-frame` 事件逐帧重绘，所以「先防抖再调色」的顺序与导出一致。
- **代理**：`useVideoEnhancementProxy` / `useNativeVideoEnhancementPreview` 的快照把 `stabilization` 置 0——防抖不再触发 FFmpeg deshake 代理，也不会叠加两次。
- **导出** `export-stabilization.ts`：`ExportEngine.export()` 与 `ExportEngineMuxer.export()` 在渲染第一帧前 `ensureAnalysis`（进度提示「Analysing camera motion…」）；`renderVideoAttempt` 在拿到解码帧后先 `stabilizeExportFrame` 预扭曲成同尺寸 canvas，再走原有 bounds / crop / 调色 / 转场。plan 缺失直接抛错，不回退到抖动源。
- **引擎策略**：时间线含防抖片段时强制 canvas muxer（`export-engine-factory.ts`），原因文本说明与预览同源。
- **属性面板**：`视频防抖` 分组新增分析状态行（读取素材 / 分析中 xx% / 已就绪 / 失败 + 重新分析）。

## 三、验证

- 单测（`apps/web/src/lib/stabilization/__tests__`、`export/__tests__/export-stabilization.test.ts`、代理 hook 测试）：高斯 fixture、约束 goldens、相似拟合、plan（抵消高频抖动、窗口不出画幅、半分辨率换算、最近帧查找）、worker client、analyzer、导出拒绝无 plan、仅防抖不建代理。
- **闭环脚本** `bun scripts/validate-stabilizer.ts`（真 OpenCV 运行时，无浏览器）：合成 60 帧随机游走抖动（±3 px、±0.4°、±0.6%），估计器恢复误差 **平移 ≤ 0.013 px、旋转 ≤ 0.004°、缩放 ≤ 8e-5**，0 帧丢失；套用 plan 后输出残余抖动 **0.65 px RMS vs 输入 2.47 px（去除 73.7%）**，黑边像素 0。
- **端到端** `apps/web/src/test/e2e/stabilization-export.e2e.ts`（隔离 Electron 实例，离屏）：静态分形上摇晃裁切窗口生成 6 s 片段 → 导入 → 开防抖 → 等预览 canvas 出现且未建 FFmpeg 代理 → muxer 导出 → 用同一估计器量输入/输出的逐帧运动。结果见下节。

## 四、端到端结果（2026-09-10，M4 Pro，隔离 Electron 实例）

`bun run test:e2e:bg -- --grep "in-house stabilization"`，1 passed (19.7 s)。证据写在 `output/playwright/stabilization/evidence.json`（gitignored）。

| 指标 | 输入（合成抖动） | 导出（推荐等级） | 比值 |
|---|---|---|---|
| 逐帧平移 RMS（640 px 宽分析尺度） | 9.55 px | 2.46 px | **0.257** |
| 逐帧旋转 RMS | 0.189° | 0.0084° | **0.044** |
| 匹配丢帧 | 0 / 179 | 0 / 179 | — |
| 平均内点 | 258 | 286 | — |
| 边带亮度 / 内部亮度 | — | 1.24 | 无黑边 |

- 导出 180 帧 1280×720，6.000 s，muxer 引擎耗时 1.09 s（分析已在预览阶段完成并命中内存缓存）。
- 预览：`stabilized-video-canvas` 在分析完成后挂载并带 `data-source-time`；`data-video-enhancement-proxy-status` 保持 `idle`——仅开防抖不再生成 FFmpeg deshake 代理（第一次运行暴露了 `hasEnhancements` 把自动画质推到「清晰/强制代理」预设的问题，已把 stabilization 从该判断里排除）。
- 残余 2.46 px 主要是平滑后的低频轨迹（1.2 s 窗口跟随缓慢漂移），不是估计误差；闭环脚本里估计误差 ≤ 0.013 px。

## 四b、真机测试（2026-09-10，可见的隔离 QCut 实例，副屏）

用 `QCUT_WINDOW_DISPLAY=secondary QCUT_API_PORT=8791 … bun run electron -- --user-data-dir=<临时目录>` 起本分支构建的第二个 QCut（与用户正在跑的 QCut 共存），全部操作走编辑器 HTTP API（建项目 → 导入 → 上时间线 → PATCH `enhancements.stabilization=50` → 选中 → 导出），截图在 `docs/task/recordly/screenshots/stabilization-2026-09-10/`（该目录被 .gitignore 忽略，只在本机保留）。

1. **真实手机素材 `~/Movies/6月21日.mov`（1920×1080 @30，143 s，4298 帧）**：整段分析完成（面板显示「运动分析已就绪」，见 `04-analysis-ready.png`），muxer 导出 143 s 用时 22 s（4299 帧，bt709）。但用同一估计器量输入本身，逐帧运动只有 **0.02 px RMS**——这段是架着拍屏幕的，几乎没有抖动，所以输出只体现裁切放大（`05-before-after-10s.png`），比值无意义（噪声地板）。**这段素材证明的是链路能跑通，不能证明去抖效果。**
2. **同一素材 10–40 s 叠加合成手持抖动**（多频正弦平移 ±77 px、旋转 ±1°，真实纹理，`handheld-shake-30s.mp4`）：导入 → 分析 → 导出 30 s 用时 6 s。同一估计器测量：

   | 指标 | 输入 | 导出 | 比值 |
   |---|---|---|---|
   | 逐帧平移 RMS（640 px 分析尺度） | 9.27 px | 1.74 px | **0.187** |
   | 逐帧平移 P95 | 16.1 px | 4.7 px | 0.29 |
   | 逐帧旋转 RMS | 0.317° | 0.0125° | **0.039** |
   | 匹配丢帧 | 1 / 899 | 1 / 899 | — |

   `07-shake-motion-trail-12s.png` 是 8 帧叠加：左边原片糊成重影，右边导出清晰；`09-shaky-clip-status.png` 是面板里的「运动分析已就绪」。
3. 没量到的：分析耗时没有埋点（30 s 片段的分析在 5 分钟轮询窗内完成，导出前置检查命中缓存，所以导出只要 6 s）；真实手持抖动（含视差、滚动快门）还没测——需要一段真正手持拍摄的素材。

## 五、明确没做 / 已知限制

- 相似变换只有 4 自由度，滚动快门与视差不建模；纯平移 + 小角度场景效果最好。
- 分析按整段素材做一次（长素材首次开启需等待），未做按需分段。
- 预览的 `EffectCompositeCanvas` 等特效画布仍直接读原 `<video>`，特效 + 防抖同开时预览层叠是近似；导出正确。
- CLI / Claude API 导出仍是 FFmpeg `deshake`（不同算法，效果弱），这是既有行为，本批未替换。
