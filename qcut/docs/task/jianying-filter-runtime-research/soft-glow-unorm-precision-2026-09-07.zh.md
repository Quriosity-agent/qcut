# 柔光：UNORM8 转换与宿主末端混合精度

2026-09-07，在[逐阶段原生捕获](soft-glow-pass-precision-2026-09-07.zh.md)基础上修正两个明确的运算合同：GPU 目标量化前的乘法不能先按 float 舍入；QCut CGL provider 的最终强度混合在字节域使用 double。原创 C++、可选 CGL 诊断和回归测试已经写入 [independent-soft-glow](../../../research/independent-soft-glow/README.zh.md)。完整柔光仍有数值残差。

## 已验证的量化环节

旧实现计算 `round(float(c * 255))`。二进制 float `0x3f0a0a0a` 的真实值乘 255 略小于 137.5；中间 float 乘法把它舍入到 137.5，随后输出 138，而本机 CGL 输出 137。

新 `quantize_unorm8` 对有限输入先钳位至 0..1，然后执行 `round(double(c) * 255)`，最后转成字节。binary32 的有效尾数乘 255 可在 binary64 内精确表示，避免了中间一次舍入；内部 shader 等效计算仍保留 float，不把整个算法改成 double。`rgba8` 和文件输出共用这一转换。NaN/Inf 拒绝是独立实现的保护策略，不声称模拟驱动的非有限输入。

`native_quantization.cpp` 在自建 CGL 上下文中，将自产 RGBA32F 纹理通过最近邻 blit 写入 RGBA8，再读回。关闭 dither、blend、framebuffer sRGB；不加载厂商库。覆盖 255 个输出半整数阈值各 ±32 ULP、按固定步长扫描指数范围、131,072 个固定种子随机值及有限越界值。

- 实际比较 **666,580 个通道**；纹理补齐后为 667,648，补齐项不计比较数。
- 新实现 **0 差异**；保留旧 float 乘法作为负控，**127 个边界值不同**。
- 每进程重复两次，两次新进程结果相同；有效通道输出 FNV-1a64 为 `8d11c6337f6ff831`。
- 本机 Apple M4 Pro，CGL `4.1 Metal - 90.5`。这是该后端的转换原语实验，不证明任意 GPU、所有 shader 中间运算或完整滤镜逐位一致。

标准 C++ 测试另用 binary32 位型还原精确有理数，以整数运算计算期望值；不拿新 double 实现生成自己的期望。可选诊断构建：

```sh
cmake -S research/independent-soft-glow -B /tmp/soft-glow-precision \
  -DCMAKE_BUILD_TYPE=Release -DSOFT_GLOW_NATIVE_PROBE=ON
cmake --build /tmp/soft-glow-precision --parallel 4
ctest --test-dir /tmp/soft-glow-precision --output-on-failure
/tmp/soft-glow-precision/soft-glow-native-quantization
```

## 宿主强度混合

已核对自有 `electron/jianying-filter-local-runtime/render.ts` 的 `blendNativeEffectOutput`：输入是字节，`amount = intensity / 100`，RGB 为 `Math.round(sourceByte + (renderedByte - sourceByte) * amount)`；非满强度保留 source alpha，满强度直接返回 rendered。

新的 `output_mix.cpp` 保留这个操作顺序和 binary64 强度，独立于 GPU 的 Q8 转换。乘法与加法禁止合并成 FMA；在非负范围用 `std::round`。不能改写成 `floor(value + 0.5)`，因为加法本身也可能把略低于半整数的值推过边界。两个 CLI 使用 `std::stod`，在缩窄 UI 场景参数前校验 double 范围。

测试遍历 65,536 对输入/目标字节与 0、25、50、75、100% 五档，使用整数权重期望；另测 37%、5% 前后相邻 double、两种 alpha 来源、NaN/Inf、微小负数和略大于 1。Python 测试实际调用单帧及流 CLI，独立计算字节域期望，验证解析精度和越界拒绝。

另将上述自有 TypeScript helper 原样提取到私有脚本，用真实原生满强度结果作为输入，与独立 C++ `mix_output` 比较三张图的 0/5/25/37/50/75/100% 共 21 例、4,283,048 字节，全部相同；三个 37% 结果也与历史 provider 参考逐字节一致。证据为 `provider-output-mix.json`，并记录 helper 来源文件 SHA。

## 固定原生参考回归

没有重写旧参考文件。仍使用原 D634 身份、同一私有 LUT、三图样 × 100%/37%，新 C++ 每例两个进程结果相同。表中 RGB MAE 单位为字节（满量程 255）。

| 输入 / 强度 | 旧实现 MAE | 新实现 MAE | 新最大误差 |
| --- | ---: | ---: | ---: |
| chart 320×180 / 100% | 0.054485 | 0.050648 | 6 |
| chart 320×180 / 37% | 0.021360 | 0.019850 | 2 |
| offaxis 257×145 / 100% | 0.040959 | 0.040959 | 5 |
| offaxis 257×145 / 37% | 0.014974 | 0.014974 | 2 |
| ramp 321×181 / 100% | 0.020631 | 0.020619 | 4 |
| ramp 321×181 / 37% | 0.006540 | 0.006529 | 2 |

Alpha 全部零差异。此修正有意改变旧 C++ 的边界像素，旧文档中的六组输出 SHA 兼容性只属于当时构建，不再作为当前实现声明。

再次给 13 个阶段分别输入原生上游图像，chart downsample 不同字节从 **237→0**，upsample 从 **13,572→7,239**；offaxis downsample 仍 14，ramp 从 320→160。三图样 Normal 独立重放仍零差异。采样坐标/插值、Glow packed 与 dither、LUT 的残差未完全解决，没有为减小误差拟合采样权重。

## 已有 UI 导出帧的复测

用新程序重放既有 1280×720 的 ProRes 4444 第 75 帧参考，不重新启动 UI 或声称新增视频验收。按 0/37/80/81/100% 顺序：

| 输入合同 | 旧 RGB MAE | 新 RGB MAE |
| --- | --- | --- |
| 原 PNG 对应 RGBA | 0.340657 / 0.545537 / 0.701910 / 0.705149 / 0.711324 | 0.343205 / 0.548014 / 0.704223 / 0.707313 / 0.713515 |
| 已解码无滤镜基线 | 0.106239 / 0.380563 / 0.553789 / 0.555211 / 0.565888 | 0.104929 / 0.379136 / 0.552799 / 0.554261 / 0.564960 |

两种输入结果都保留：原 PNG 指标略增，解码基线指标略降。修正来自独立转换和实际宿主公式证据，不来自选择更低的 UI 误差。UI 编码、颜色转换与整个 shader 数学链的等价性仍未闭合。

## 证据与剩余任务

私有目录 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/softglow-resize/`：`native-quantization.json`、`final-pipeline/metrics.json`、三份 `*-stages/metrics.json`、`ui-snapshot-regression.json`。源码哈希和整体构建见上级 `precision-verification.json`。旧参考与旧误差报告保持历史身份；`verify_reference.py --output` 可为不同源码版本指定独立目标目录。

共享 CGL 上下文管理已提取为 `cgl-diagnostic-context.hpp`，恢复调用前 context 并清理异常分支。捕获器重新通过两个正控和 MRT/非 RGBA8 两个预期拒绝；量化探针使用同一上下文工具。CI 的 macOS job 运行这些自产测试，仓库不包含厂商二进制、着色器、LUT 或原生像素。

后续仍需解释缩放采样精度、dither/packed 插值、GPU 算术重排以及 LUT 的残差，补透明/HDR、完整事件与真实视频路径。当前关闭的是量化和自有 provider 末端混合这两个局部问题。
