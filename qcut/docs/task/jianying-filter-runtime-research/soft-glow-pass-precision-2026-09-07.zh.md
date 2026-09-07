# 柔光：原生逐阶段读回与独立 C++ 重放

日期：2026-09-07。本轮把柔光的“最终画面接近”推进到真实中间目标的读回与误差分解：固定资源每帧有 **12 次 draw、2 次 blit，14 个输出全部为 GL_RGBA8**。新增 C++ 阶段 API 和独立命令行，将每一阶段的原生上游输入送入对应自有算法，测量该阶段自身的残差。

**格式、次序、方向及逐阶段残差已有实测，精度归因仍未全部闭合。** 三种图样的最后 Normal 合成在使用原生上游时完全一致；Gaussian resize、Glow mask/打包模糊、LUT 仍有残差。本轮没有调整容差或靠参数微调追最终 MAE，也没有改变既有六组完整 C++ 输出的任何字节。

## 固定身份

本实验使用已有私有 D634 CGL 宿主，不是安装版 11.3.0 的 AGFX Metal 实验。两种后端的数值证据不能互换。

| 对象 | SHA-256 / 身份 |
| --- | --- |
| libcccreator universal | `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9` |
| libcccreator arm64 UUID | `D6342ECD-5432-33F0-A2AD-0C28F5699994` |
| libAGFX universal | `1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee` |
| libAGFX arm64 UUID | `57ECC10F-8BB8-319C-BA46-AF286E2EBD43` |
| 资源 ID / 版本 | `7447126702137904420` / `9673f80b8e2f5a07f02f9ce1130b784a` |
| 资源树，121 文件 | `819180c07dfbf979de6ec584af19e99ae0829ce6e8d8b9a8c6e51e56db0e9822` |
| 本地 Map2 RGBA atlas | `f9f142849b99e77d5b9174b054c7634d0945f6fd731c4133def07900d0bd9239` |

树 hash 的算法是按完整 POSIX 相对路径字符串排序，依次加入 `路径 UTF-8 + NUL + 文件字节 + NUL`。早期私有试验按 Python Path 的组件排序得到 `9db29742…`，排序口径不同，未改变资源内容。提交的启动器与分析器均使用上表的完整字符串排序口径。

原始图样、原生中间 RGBA、uniform JSON、编译产物和失败试验仅保存在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/softglow-passes/`。仓库不包含厂商库、shader 源码、LUT 或资源包。

## 捕获的方法和有效性

[capture-soft-glow-passes.ts](../../../research/jianying-runtime-probe/capture-soft-glow-passes.ts) 先验证两库及资源树身份，在仓库外创建新输出目录。它只为本次自行启动的 QCut CGL 诊断子进程设置 interposer；不附加或修改剪映进程。宿主 ready 后才建立文件门控，排除初始化和 warmup；同一不透明输入在时间 0 连续渲染三次。

[cgl-pass-capture.cpp](../../../research/jianying-runtime-probe/cgl-pass-capture.cpp) 在实际 draw/blit 后读回目标。它保存并恢复 active texture、read FBO 及两个 FBO 各自的 read buffer、PBO 和 pack 参数；要求唯一 attachment0 输出、RGBA8、完整目标及限定尺寸，限制到 256 次和 512 MiB。格式、GL error、写盘失败或不支持的目标直接使诊断失败。

原生使用 **sampler object**。记录的 min/mag/wrap 来自绑定的 sampler；只有未绑定 sampler 时才查纹理参数。仅查看纹理对象会遗漏实际采样状态，这一点已由审查修正并重跑。最早使用 `dlsym(RTLD_NEXT)` 的试验发生递归崩溃，改为 dyld interpose 的本库原始引用；失败试验不计入验收。

测试输入为 chart 320×180、offaxis 257×145、ramp 321×181，每种两个独立捕获进程和一个关闭捕获的控制进程，各三帧。捕获合计 **252 个阶段目标**。同帧次序的中间图在重复帧和独立进程中逐字节一致；开启/关闭捕获后的最终输出均等于原有对应原生参考。原生证据仍限定本机 Apple Silicon/macOS 和上述资源、图样、100% 强度。

## 实际阶段拓扑与方向

下表尺寸以 320×180 为例，所有目标为 RGBA8。

| 序号 | 实际操作 / 独立阶段 | 尺寸 | 有效采样 |
| --- | --- | --- | --- |
| 0 | blit / Gaussian downsample | 160×90 | GL_LINEAR，源 Y 反向 |
| 1、2 | draw / Gaussian X、Y | 160×90 | linear / clamp |
| 3 | blit / Gaussian output | 320×180 | GL_LINEAR，源 Y 反向 |
| 4 | draw / SoftLight | 320×180 | linear / clamp |
| 5 | draw / Glow mask | 240×135 | linear / clamp |
| 6、7 | draw / packed RG 横、纵模糊 | 240×135 | linear / mirror |
| 8、9 | draw / packed BA 横、纵模糊 | 240×135 | linear / mirror |
| 10 | draw / Glow composite | 320×180 | packed 输入 mirror，底图 clamp |
| 11 | draw / LUT | 320×180 | linear / clamp |
| 12 | draw / Normal | 320×180 | linear / clamp |
| 13 | draw / 最终复制 | 320×180 | linear / clamp |

同一 texture ID 会在后续阶段复用；分析按绘制序号即时保存，不能以最后一次纹理内容代替前面阶段。两个 blit 是真正的缩放步骤，仅拦截 draw 会漏掉它们。

规范化坐标后，序号 3、12、13 需翻转行；依据是捕获的反向 blit 矩形、Layer 的 Y/texture-flip 参数及最终复制方向，不以最小误差猜方向。最终复制规范化后严格等于宿主返回字节，分析器会验证该条件。

## 每阶段自身残差

`soft-glow-stage-replay` 对 13 个阶段分别使用对应的**原生上游**，不把前一步自有输出串入下一步。原有完整 C++ 管线同时运行，单独报告累积误差。[analyze_native_passes.py](../../../research/independent-soft-glow/analyze_native_passes.py) 校验身份、42 次事件、格式、尺寸、采样及关键参数、重复帧和最终方向，随后调用两个独立 CLI。

下表为 chart 的独立阶段残差。普通目标统计 RGBA 字节误差；packed 模糊同时按 `(高字节 + 低字节/255)` 解码为八位强度单位。原始 packed 字节的进位可产生 255 的差异，不能把它直接当作亮度误差。

| 阶段 | RGBA MAE / 最大差 | 解码后 MAE / 最大差 |
| --- | --- | --- |
| Gaussian downsample | 0.004115 / 1 | — |
| Gaussian X | 0.000885 / 1 | — |
| Gaussian Y | 0.002413 / 1 | — |
| Gaussian output | 0.058906 / 1 | — |
| SoftLight | 0.002044 / 1 | — |
| Glow mask | 0.007292 / 3 | — |
| Glow horizontal RG | 2.695463 / 255 | 0.020656 / 8.917647 |
| Glow vertical RG | 4.838588 / 255 | 0.032549 / 5.725490 |
| Glow horizontal BA | 2.984630 / 255 | 0.023125 / 9.074510 |
| Glow vertical BA | 7.416512 / 255 | 0.060005 / 5.796078 |
| Glow composite | 0.007530 / 1 | — |
| LUT | 0.008212 / 1 | — |
| Normal | **0 / 0** | — |

三种图样分别得到 Normal 全零残差。首个差异都在 Gaussian downsample，最大仅 1；它不能解释全部后续差异，因为给定原生上游后，mask、packed blur、LUT 仍各自有残差。offaxis/ramp 的各阶段详情保存在对应 `*-final-analysis/metrics.json`；本表不把这些数值套用到全部输入。

当前可以排除“中间目标其实是半浮点”这一假设，也已经分开上游误差与当前阶段误差。GPU 插值精度、Glow dither 算术次序和打包量化的精确贡献仍须受控试验；未证明的原因不写成结论。最后 Normal 的一致性不代表整个效果已 bit-exact。

## 原创 C++ 与验证边界

新增 `gaussian_axis`、`glow_plan`、`glow_mask`、`glow_blur_pass`、`glow_composite` 以及共享 `pipeline_parameters`，各自复用原有算法。Glow 尺寸与半径统一计划，避免 CLI 重复公式。新 CLI 在读全上游并验证字节数后才建立输出目录，拒绝覆盖旧目录。

新增 180 项纯 C++ 阶段断言，包括手算 mask/alpha、RG/BA 打包、边界权重、五种合成模式、Gaussian、维度/半径，以及 NaN/通道/非法 enum 拒绝。Release 和 ASan/UBSan 均通过。六组原有完整管线 fixture（3 图样 × 100%/37%）重新输出，与上一轮已记录的 C++ SHA-256 全部相同。

整个独立 Soft Glow 工程现加入统一跨平台 CMake/CI；原生库仍只在本机可选诊断中加载。复现命令见[工程 README](../../../research/independent-soft-glow/README.zh.md)。下一步应优先隔离 blit 亚像素舍入与 Glow dither/packed 插值，不扩大完整效果链完成数。
