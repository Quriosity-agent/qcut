# AGFX：纹理上传、真实 sampler 与像素差分

2026-09-08 续篇：[新分支四线推进与当前验证](binary-cpp-scaleup-2026-09-08.zh.md)。本文保留09-07的历史结果；本轮 mip 边界、非空 graph、记录恢复、时序裁切的新状态以续篇为准。

2026-09-07。本轮交付 RGBA8/BGRA8 的独立 C++ 空间采样参考，以及调用真实 AGFX 对象的受控 GPU 差分探针。已验证上传适配、通道顺序、Alpha、边界、三维 R 轴和显式 mip 层。**这不是实际滤镜 Pass、整套 AGFX 引擎或剪映 UI 像素一致性证明。**

源码：[独立采样接口](../../../research/independent-agfx-contract/texture_sample.hpp)、[实现](../../../research/independent-agfx-contract/texture_sample.cpp)、[测试](../../../research/independent-agfx-contract/texture_sample_tests.cpp)、[原生探针](../../../research/jianying-runtime-probe/agfx-texture-probe.mm)。统一构建见[四工程入口](../../../research/independent-binary-contract/README.zh.md)。

## 固定身份和比较路径

剪映 11.3.0；Universal SHA-256 `4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`；ARM64 UUID `408EB610-AD47-3846-9595-14B6A3ABF537`。Apple M4 Pro / macOS 26.6.2 / Apple Clang 21。公共诊断加载器在调用前核验请求文件与加载镜像身份；不接受未知版本的偏移。

1. 真实 `GPDevice` 创建 Metal renderer，经 AGFX `createTexture2D/3D` 上传自有非对称字节图案。
2. 真实 `setTextureFilterMode` / `setTextureWrapMode` 设置纹理，核验六个原生字段、默认 anisotropy=1，并取得真实 native sampler。
3. 同一原生纹理、同一自有 Metal compute shader，分别使用原生 sampler 和独立转换的 Apple sampler，比较每个 float4 的全部字节。
4. 另用独立 CPU 从原始图案计算空间采样及受限 mip 参考，不用 GPU 输出反推期望值。2D 的 CPU reference 固定 `w=0.5`；CPU 接口本身按三维纹理建模，depth=1 时仍有 R 轴。
5. 四张 2D 纹理再通过 AGFX `readImage` 分别读出 RGBA 与 BGRA，与原始紧凑字节比较；三维纹理只有 shader sample 对照，没有声称通过该 2D readImage 接口。

`DeviceTexture` 保留已核验的非平凡复制 ABI；纹理析构前保证所有自有命令完成。上传结束先 `finish()`，自有 compute command 再 `waitUntilCompleted` 并检查错误后读取 CPU buffer。不能用仅等待 scheduled 的 `commitCommandBuffer(true)` 替代完成边界。

## 这轮恢复出的两个上传分支

**普通纹理的 `int*` 不是 row stride。** `GraphicResource::createTexture2D` 把它放入创建记录 `+0x20`；Metal 路径仅在压缩分支读取该数组。RGBA/BGRA 行字节由宽度、像素大小与记录 `+0x18` 决定，而 convenience wrapper 把 `+0x18` 清零。直接把 padded 输入与 stride 数组传给该入口，5×3 图案在第二行 byte 20 首次失败。现在自有适配器逐行去掉 padding，保持原始通道顺序，再上传紧凑数据；没有把适配器行为写成 AGFX 支持任意 stride。

**非零 creation mip mode 会开启自动生成。** wrapper 在 `0x7b580–0x7b588` 设置记录 `+0x31`；Metal 上传路径因此只消费 level 0，随后生成其他层。手工提供的非零层不会按预期保留。显式上传测试用 creation mip mode=0 和明确 level count，上传全部层，再通过 setter 改 sampler mip mode。此前自动生成结果与手工 level 1 图案不同的失败报告保留在私有证据中。

静态范围：wrapper `0x7b328–0x7b5dc`；Metal 创建 `0x906bc–0x916c4`，尤其 `0x90f34–0x90fbc` 行字节与 `0x90ffc–0x91154` 自动生成分支。原始反汇编不进入仓库。

## 像素结果

| 自有输入 | 原输入 row stride | 实际验证 |
| --- | ---: | --- |
| 1×1 RGBA | 8 | 单 texel、边界与透明 Alpha |
| 5×3 RGBA | 32 | 奇数尺寸、padding、方向、非对称四通道 |
| 7×5 BGRA | 48 | 通道交换、padding、原生 RGBA/BGRA 读回 |
| 3×2×3 RGBA | 16 | 三维空间插值和 S/T/R 独立寻址 |
| 8×4 RGBA，4 层 mip | 40（level 0） | 显式层内容、LOD、三种 mip filter |

每张遍历全部 **768** 个合法 sampler 组合，UV 取 9×9 个内外边界点，LOD 取 `-1,0,0.49,0.5,0.51,0.75,1.49,1.5,1.51,2.5,3,8`，共 **972 queries/组合**。

- 每进程 **3,732,480 个 GPU float4**，原生与独立 sampler 输出全部逐位一致。两次独立进程报告相同。
- 四张 2D 纹理的 **8 次 RGBA/BGRA readImage** 全部字节一致，输出前后 32-byte guard 未被写坏。
- 独立 CPU 参考比较 **7,008,768 个通道**，最大绝对误差 `0.00012260675430297852`；预设门限 `1/255`，没有为失败放宽门限。理想 float 插值并非 GPU 位级实现。
- 每张图另有错误 wrap 的负控：故意将 border 改 clamp，全部检出差异。错误 padding 和自动 mip 造成的失败另行保留。
- CPU 空间单元 **384 项检查**，覆盖已知颜色、半 texel、三维插值、负坐标、三轴 wrap、BGRA 与 row/slice padding、截断/溢出/非有限参数。Release 与立即失败的 ASan/UBSan 通过。

## 明确未关闭的精度边界

CPU 对照只在 mag=min 时进行，未恢复自动导数和 mag/min 转换点。所有 mag/min 组合仍参加 GPU 与 GPU 的逐位比较。

显式 mip 的连续 CPU 模型在 `LOD=0.51` 等任意小数及 nearest 半层点与本机硬件不同。例如 nearest 在 `0.51` 仍取 level 0、`0.75` 取 level 1，linear 的 `0.51` 也不能直接等同连续线性权重。本轮没有确定硬件的完整 LOD 量化公式。因此 CPU mip 对照限定为精确四分之一层且 nearest 无半层歧义，另 **456,192 个通道**明确排除出 CPU 门禁；这些查询仍全部通过原生/独立 sampler GPU 对照。不能把排除项写成算法精度已完成。

仍需推进：真实柔光逐 Pass 的目标格式/颜色空间/量化，HDR 与浮点纹理，anisotropy≠1，任意 LOD 舍入及完整 GPU 资源状态机。三维空间 trilinear 与跨 mip 层插值是两个概念。整库还原和产品预览/导出本轮不验收。

## 复现

从 QCut 包目录运行，厂商库仅由本地运行者提供：

```sh
AGFX_PIXELS=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/agfx-texture
AGFX_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
cmake -S research/independent-binary-contract -B "$AGFX_PIXELS/build" \
  -DCMAKE_BUILD_TYPE=Release -DBINARY_CONTRACT_NATIVE_PROBES=ON
cmake --build "$AGFX_PIXELS/build" --parallel 4
DYLD_LIBRARY_PATH="$AGFX_FRAMEWORKS" "$AGFX_PIXELS/build/agfx/agfx-texture-probe" \
  "$AGFX_FRAMEWORKS/libAGFX.dylib" "$AGFX_PIXELS/report.json" \
  > "$AGFX_PIXELS/stdout.log" 2> "$AGFX_PIXELS/stderr.log"
```

机器 JSON 仅在全部声明范围检查通过后原子写入；stdout 可能包含原生诊断日志，必须留在私有目录。新运行应使用新的报告路径，非零退出不得将旧报告视为新结果。

证据目录 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/agfx-texture/` 保存两份 `native-run-*.json`、失败试验、源码哈希与 `verification.json`。独立代码和原创 shader 是仓库内容；厂商库、反汇编、运行日志和截图不提交。
