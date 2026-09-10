# 2026-09-10：让滤镜与转场「能打」——GLSL 转场进时间线、RIFE 神经补帧进导出

本批是「让 QCut 的滤镜能打」路线的第一批产品工作。之前对剪映二进制的八条还原线做过按**新增用户可见收益**的评估，结论是全部 low/none——二进制从来不是墙，墙是权重、素材授权、云端凭证和工程量（见 `binary-cpp-batch5-2026-09-10.zh.md` 后的评估）。本批因此不再攻 dylib，而是把两件用户真正拿不到的能力做进产品：

1. **GLSL 转场进时间线**：把 MIT 授权的 gl-transitions 集合接进转场实验室，并让 shader 转场真正能放上时间线、能预览、能导出（此前实验室的 GLSL 只用于实验室预览，时间线和导出都是 Canvas2D）。
2. **RIFE 神经补帧进导出**：变速面板新增「神经补帧（RIFE，导出时生效）」，导出时用 rife-ncnn-vulkan 对源片段窗口补帧，替代 `minterpolate`。

同批还纠正了一个前提：滤镜货架「打不动」的真实原因是素材只从本机剪映缓存读（`electron/qcut-independent-filter/assets.ts:79`），与二进制无关；素材策略另议，本批不碰。

## 一、GLSL 转场

### 来源与授权

- 上游：<https://github.com/gl-transitions/gl-transitions>，MIT，pin 在 commit `902218a1b63773ac0d0d9f491951da3392365bfe`。
- 125 个 `.glsl` 中 vendored 123 个到 `electron/native-pipeline/transitions/gl-transitions/transitions/`，连同 `LICENSE` 和带每文件 sha256/作者的 `manifest.json`。排除 `displacement.glsl`、`luma.glsl`（各需一张额外纹理，超出 from/to 契约）。
- 生成：`bun scripts/import-gl-transitions.ts --from <checkout> --commit <sha>` vendor + 生成；不带参数只从 vendored 副本重新生成。产物 `gl-transitions-recipes-*.ts`（每块 ≤ 800 行）与索引 `gl-transitions-recipes.ts` 已提交，构建不需要网络。

### 适配规则（`gl-transition-adapter.ts`）

上游契约是 `vec4 transition(vec2 uv)` + `progress` / `ratio` / `getFromColor()` / `getToColor()`，tunable 写成 `uniform T name; // = default`。适配器：

- 把每个 tunable 冻结为 `const T name = default;`；float 的裸整数默认值补 `.0`，bool 的 `0/1` 改 `false/true`（GLSL ES 1.0 没有隐式转换）。
- `progress`、`ratio` 是 **uniform 宏**（`#define progress uProgress`、`#define ratio uRatio`），不是 main 里赋值的全局变量——circle-crop 等 shader 在全局初始化里就读它们，赋值式全局在那一刻还是 0，实测两端全黑。
- 与宿主同名的 tunable（dissolve 的 `uIntensity`）改名 `…Param` 并同步替换引用；重复的 `precision` 声明剥掉。
- 没有默认值的 uniform、额外 sampler、缺少入口函数一律拒绝。

### 校验

- `bun scripts/validate-gl-transitions.ts`：headless Chromium 真 WebGL1 编译、链接每个 recipe，并用纯色帧检查 progress 0 只出 from、progress 1 只出 to。**123/123 通过。** `glslc` 不能校验 ESSL 1.00（SPIR-V 要求 ES ≥ 3.10），所以必须走真浏览器。
- `bun scripts/validate-shader-compositor.ts`：打包真正的 `ShaderTransitionCompositor` 模块跑同一两端检查，覆盖纹理上传、Y 翻转、uniform 绑定。
- `electron/__tests__/gl-transition-adapter.test.ts`：适配规则、改名、bool/float 字面量、拒绝路径、生成物与 manifest 一一对应、全目录 id 唯一。

### 产品接入

- **实验室**：新增来源「开源 Shader」（123），与「QCut Shader」（6，clean-room）和「本机剪映」（520）分开计数、分开筛选；preset 带 `labOrigin` 与作者 tag。
- **类型**：`ClipTransitionType` / `TransitionType` / `TransitionLabClipType` 新增 `"shader"`；表现层对 `"shader"` 返回恒等（两段各自的图层不动，由合成器画）。
- **时间线预览**：`ShaderTimelineTransitionOverlay` 盖在舞台上，按 `data-timeline-element-id` 取两段的 `<video>`/`<img>`/调色 canvas，用导出同一套 `calculateElementBounds` + `drawWithMediaTransform` 画进离屏，再由 `ShaderTransitionCompositor` 合成。**这是预览近似**：不采样每段的遮罩和滤镜；无 WebGL 时不渲染（表现为硬切）并 warn 一次。
- **导出**：`export-shader-transitions.ts` 在 `beginMediaTransitionLayer` 前拦截 shader 状态：from 段画进离屏 A 并寄存，to 段画进离屏 B 后合成并画回主画布。**不回退**：缺 recipe、缺 WebGL、to 先于 from 都直接抛错，不会悄悄变成硬切。
- **引擎策略**：时间线含 shader 转场时强制 canvas muxer 引擎（CLI FFmpeg 跑不了 GLSL）。compose CLI 的 `transition-lab apply` 会把 `clip.type: "shader"` 写进时间线，随后走同一条预览/导出路径。
- **FFmpeg 路径明确拒绝**：`transition-filter.ts` 收到 shader 类型时抛出指向 canvas 引擎的错误；compose 运行时（`compose-lab-resource-resolver.ts`）把 shader recipe 判为 `unsupported/transition-lab`，compose 资源清单不列出它们；`transition-lab list` 的公开元数据带 `author` / `sourceFile` 用于署名。

### 明确没做

- 没有把实验室预览组件 `shader-transition-preview.tsx` 重构到共享合成器上（WebGL 样板有重复）。
- 没有 shader 转场的端到端导出 E2E；现有证据是真 WebGL 的 GLSL 校验、合成器校验、导出层单测和 jsdom 组件测试。
- 转场默认时长统一 0.8 s，`localizedName` 等于英文名——没有中文译名，不假装有。

## 二、RIFE 神经补帧

### 来源与授权

- <https://github.com/nihui/rife-ncnn-vulkan>，MIT，release `20221029`，只带 `rife-v4.6` 一个模型（flownet.bin 10.1 MB）。三平台 zip 与包内可执行/模型文件的 sha256 全部 pin 在 `electron/rife/rife-binaries.json`。
- 上游 release 停在 2022-10；本机 macOS 26.6.2 / M4 Pro 经 MoltenVK 实测可用，Windows/Linux 只有 hash 校验、没有运行验证。

### 打包

- `bun scripts/stage-rife-binaries.ts`（默认当前平台，`--target` / `--all`）下载、校验、解出到 `electron/resources/rife/<platform>/`，已挂进 `stage:all-binaries` 和各 `dist:*`；`electron/resources/rife/` 已 gitignore。
- `bun scripts/verify-packaged-rife.ts` 校验打包产物的 hash 并实际运行 `-h`，已挂在各 `verify:packaged-ffmpeg` 之后。
- `package.json` extraResources 新增 `electron/resources/rife → rife`。

### 运行时

- `electron/rife/rife-bridge.ts`：定位 staged/打包的可执行与模型，`interpolateFrameDirectory` 跑 `-i/-o/-m/-n/-f`，输出帧数不等于目标直接报错；找不到程序时报错，不替代。
- `electron/ffmpeg/neural-frame-interpolation.ts`：三步预处理——按源的 matrix/range 把读取窗口解成 RGB PNG（`-fps_mode passthrough`，不增不减帧）→ RIFE 补到导出需要的帧数 → 用同一 matrix/range 回编成无损 `libx264 -qp 0 yuv444p` 中间片并带回颜色标签。**源帧数已足够时返回 null**，调用方保留原文件，不硬补。
- 两条导出引擎都接了：UI 导出（`ffmpeg-export-handler.ts` → `neural-video-sources.ts`，支持恒速与曲线变速，freeze 时间随入点平移）和 Claude/API 导出（`export-engine.ts` → `export-neural-segment.ts`，恒速）。`buildDurationPreservingFrameInterpolationFilter` 收到未解析的 `"neural"` 会抛错，防止静默降级。
- UI：变速面板的开关改为三档下拉（关闭 / 运动补偿（FFmpeg） / 神经补帧（RIFE，导出时生效））。预览不补帧，与原有行为一致。

### 验证

- 本机真跑：1 s @10 fps 的 BT.709 合成片，窗口 0.2–0.8 s（6 帧）→ 18 帧 @30 fps，中间片 `yuv444p`、`color_space=bt709`、`color_range=tv`、`nb_read_frames=18`。同一流程写成 `electron/__tests__/neural-frame-interpolation.integration.test.ts`（没有 staged 二进制的机器自动跳过）。
- 单测覆盖参数校验、非 neural 段直通、未解析时抛错、bridge 的参数与帧数校验。

### 明确没做

- 分割模型（BiRefNet）不做：+115 MB 且做不了实时，代价与收益不匹配。
- 防抖自研方案（OpenCV 运动估计 + 已还原的 lens C++）尚未开始，是下一项。

## 复现

```sh
bun scripts/import-gl-transitions.ts          # 从 vendored 副本重新生成 recipes
bun scripts/validate-gl-transitions.ts        # 真 WebGL1 编译 + 两端契约
bun scripts/validate-shader-compositor.ts     # 真合成器模块两端检查
bun scripts/stage-rife-binaries.ts            # 下载并校验当前平台的 RIFE
bunx vitest run electron/__tests__/gl-transition-adapter.test.ts electron/__tests__/rife-bridge.test.ts electron/__tests__/neural-frame-interpolation.test.ts electron/__tests__/neural-frame-interpolation.integration.test.ts
```
