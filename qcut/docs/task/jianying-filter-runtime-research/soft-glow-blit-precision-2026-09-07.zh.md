# 柔光 framebuffer 缩放：独立 C++ 精度合同

2026-09-07；在已有 UNORM 修正基础上，恢复 Apple M4 Pro / CGL `4.1 Metal - 90.5` 的 RGBA8 双线性 blit 精度。交付是标准 C++20 的 `blit_resize`，已接入 Gaussian 的降采样与升采样及单阶段重放。原生诊断完全使用自有输入，无需剪映库。

## 恢复的语义

目标像素中心映射到源坐标 `((x+0.5)*sourceWidth/width−0.5)`。实现用整数分子、分母计算下邻点与余数，避免坐标浮点误差。邻点 clamp 到边缘；插值权重取最近的 `k/256`，半值朝较高源坐标取整。

对字节邻点 `a,b,c,d` 和整数权重 `wx,wy`，先计算完整四点合并整数：

```text
N = (a*(256-wx)+b*wx)*(256-wy)
  + (c*(256-wx)+d*wx)*wy
subbyte = floor((N+2048)/4096)
sample = float(subbyte)/4080.0F
```

结果分辨率是 1/16 字节。横向、纵向不能分别舍入；RGBA32F 目标保存上述 float，RGBA8 目标再执行已验证的精确 `round(double(sample)*255)`。不能直接对字节域结果舍入：归一化 float 可能落在半值下方。

反向源 Y 在计算坐标时处理。恰落半权重时，先翻转输入和源矩形并不保证与正向输出相同；独立 API 显式提供 `reverse_source_y`。当前柔光重放使用规范化的正向坐标。该规则没有推广为所有 GPU、shader draw、格式或源子矩形的通用规范。

## 证据与负控

- 最初 134 组独立随机尺寸、边缘、细长和半值输入，共 **32,214,852 个浮点通道**；编译后的 C++ 与实际 RGBA32F 读回逐位零差异。
- 仓库内原生诊断固定 **111 组 / 444 次 blit**，覆盖正反源 Y、RGBA8/RGBA32F、随机 RGBA（含 Alpha）、奇数尺寸、单像素、最大 4096 的细长目标及精确半权重。每进程 **58,017,272 个 float 通道 + 58,017,272 个字节通道，全部零差异**。两次独立 Release 进程报告一致，ASan/UBSan 原生进程报告也完全一致。
- 原先通用浮点 resize 在相同正向字节结果上有 **4,810,068 个通道差异**；它仍作为通用 API 保留，不再用于这两个特定 framebuffer blit。
- 黑白两点缩放至 512：权重 ties-up 与原生一致，ties-even / floor 分别留下 128 / 256 项浮点差异。四点组合的一次舍入与逐轴舍入也被单独区分。
- 三个错误变体（丢弃权重半值、丢弃子字节半值、以浮点倒数乘法替代除法）先成功编译，再被金样例明确拒绝。四张自有 LCG 图样的原生浮点 FNV-1a64 金样例进入跨平台 CTest；另有权重/子字节半值、四点合并、方向、Alpha、尺寸/形状/非法值保护测试。非法输入拒绝和内存预算是独立实现策略。

共享 `cgl-image-target.hpp` 验证实际通道位宽、FBO 完整性及 GL 错误，统一原生量化与缩放探针的资源清理。量化原有 M4 与 Apple Software Renderer 两种明确配置各 666,580 通道回归通过；软件渲染器的差异配置保留，不当成 M4 精度一致。

## 对实际柔光的影响

复用已固定的 D634 原生捕获，不重录或替换参考。三个图样的两个缩放阶段，使用各自原生上游重放后均 **0 字节差异**；Normal 也继续 0。Gaussian 卷积、SoftLight、Glow packed/dither 和 LUT 仍有局部残差，整链也不是逐字节一致。

| 输入 / 强度 | v3 RGB MAE | v4 RGB MAE | v4 最大误差 |
| --- | ---: | ---: | ---: |
| chart 320×180 / 100% | 0.050648 | 0.046024 | 6 |
| chart / 37% | 0.019850 | 0.017870 | 2 |
| offaxis 257×145 / 100% | 0.040959 | 0.040628 | 5 |
| offaxis / 37% | 0.014974 | 0.014875 | 2 |
| ramp 321×181 / 100% | 0.020619 | 0.020114 | 4 |
| ramp / 37% | 0.006529 | 0.006380 | 2 |

同样重放已有 1280×720、frame 75、五档 ProRes UI 参考，分别以原 PNG 和已解码无滤镜基线作输入。解码基线的 MAE 均下降（例如 100%：0.564960→0.563906）；原 PNG 的 MAE 均略升（100%：0.713515→0.714934）。最大误差和 Alpha 指标不变。不能用局部缩放零差异宣称 UI 整链改进或所有编码等价；本轮没有新导出或新视频 E2E。

## 复现与文件

在 QCut 包目录构建标准库和七组 Soft Glow 测试：

```sh
cmake -S research/independent-soft-glow -B /tmp/soft-glow-blit -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/soft-glow-blit --parallel 4
ctest --test-dir /tmp/soft-glow-blit --output-on-failure
```

本机 macOS 加 `-DSOFT_GLOW_NATIVE_PROBE=ON` 后运行 `soft-glow-native-blit`。探针只接受已验证的 `Apple M4 Pro` renderer，未知配置明确失败；云端 CI 编译此诊断，执行其可移植金样例，不能把云端软件渲染器结果算成本机 M4 实测。

源码：[blit.cpp](../../../research/independent-soft-glow/blit.cpp)、[测试](../../../research/independent-soft-glow/blit_tests.cpp)、[自有原生诊断](../../../research/independent-soft-glow/native_blit.cpp)。机器合同升级至 [v4](../../../research/independent-soft-glow/semantic-contract.json)，历史 v2/v3 报告保持原样。

私有证据目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/softglow-blit/`。其中 `cpp-broad-results.json`、`native-blit-{a,b}.json`、`{chart,offaxis,ramp}-stages/metrics.json`、`final-pipeline-current/metrics.json`、`ui-snapshot-regression.json` 分别记录广覆盖、重复原生诊断、阶段与整链结果。首次 UI 回归误选了混合编码集合，保留为 `ui-snapshot-regression-invalid-mixed-codecs.json`，不作为结论；最终只使用五个明确命名的 ProRes 参考且输出路径唯一。原始 dylib、反汇编、LUT 和厂商像素不进入仓库。
