# AGFX 第三批：M4 Pro 多层 linear 空间与 mip 联合采样

本轮闭合上一批明确拒绝的多层 `linear spatial + linear mip` 组合，接入原创 C++20 [sample_m4_texture](../../../research/independent-agfx-contract/m4_texture.hpp)。[联合权重实现](../../../research/independent-agfx-contract/m4_spatial.cpp)共享寻址和权重计算，旧格式、纹理、mip 和空间原生矩阵保持原值。

这是固定 GPU/系统的实测数值 profile，不能称为 GPU 内部源码还原或所有平台通用保证。固定参考为 Apple M4 Pro、macOS 26.6.2 (25G83)，AGFX universal SHA256 `4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`，arm64 UUID `408EB610-AD47-3846-9595-14B6A3ABF537`。

## 联合权重语义

空间坐标延续 [第二批 profile](agfx-spatial-sampling-2026-09-08.zh.md)：repeat 先归约到单位周期，mirror 使用有符号两周期；binary32 乘纹理尺寸再减半纹素，空间权重按 8 位半向上量化。mip 权重沿用已验证的 6 位 LOD profile。

先求实际邻居地址，再规约 footprint：两个地址相同就把该轴权重归零，包含 extent=1 的 repeat；mirror 地址倒序时交换两个地址并把权重改为 `256-weight`。两侧都越界的透明 border 不贡献颜色。

每层四个 tap 的空间权重为 `x_weight*y_weight`，乘该层 `mip_weight` 后转换到 16 位联合权重：

```text
joint = x_weight * y_weight * mip_weight
coefficient = (joint + (top_row ? 32 : 31)) / 64
sum = sum_over_both_levels(byte * coefficient)
result = float((sum + 2048) / 4096) / 4080F
```

整数除法截断；上行中点向上、下行中点向下。最后按字节的 1/16 单位量化，再转归一化 float。不能先量化两个空间采样结果再进行 mip 混合。非 border 情况联合系数和为 65536；中间乘积与字节累加在 uint32 范围内。已有单层/nearest 模式复用该计算且旧原生结果不变。

## 验证域

RGBA8/BGRA8、2D、`w=.5`，透明黑 border，min=mag，anisotropy=1；每轴为 signed zero 或绝对值在 `[2^-24,8]`，LOD 有限。覆盖 repeat/clamp/mirror/border 的 16 组混合 S/T 寻址、完整和部分 mip 链。通用接口继续在无效尺寸、跨度、截断存储和未验证输入域时拒绝。

尺寸包括 1×1、2×2、3×5、8×4、17×9、128×65、257×129、16384×1、1×16384。查询结合上一批边界、固定种子随机、另 32,768 条随机与 257² 联合权重/mip 相位网格。实际 mip 层字节由自有图样生成，不携带厂商资源。

| 验证 | 结果 |
| --- | --- |
| 最终原生矩阵 | 512 配置，每条对照路线 230,661,120 个通道 |
| 独立 C++ / 真实 AGFX 输出 | 0 差异，逐 float bit 相同 |
| 自有 Metal GPU / 真实 AGFX 输出 | 0 差异；相同输入的第二条路线，不重复计样本 |
| Release / ASan+UBSan 原生与独立复跑 | 最终 JSON 相同；厂商库未插桩 |
| 完整原生指纹 | `a39c859576b1f5fd` |
| 跨平台 CTest 原生子集指纹 | `bbfdad0c20dff23a`，另含镜像联合中点金样例 |
| 独立 Release / ASan+UBSan | 各 6/6 CTest |
| 旧格式/texture/mip/spatial 原生回归 | 原报告不变，旧空间 72,474,112 通道不算新增 |
| 已编译错误变体 | 7 个均被独立测试和原生对照检出 |
| 身份门禁 | 缺参、相对路径和错误 SHA 均拒绝 |

七个变体分别截断联合权重、上下行都半向上、使用 ties-to-even、取消重复地址合并、仅取消 repeat 合并、取消 mirror 倒序归约、截断最终幅值。原生差异分别为 7,142,628 / 669,492 / 259,578 / 79,398 / 22,618 / 3,548 / 86,257,898；独立 GPU 对照均保持 0 差异。初版稀疏 portable 子集没有检出 mirror 变体，随后加入真实原生中点金样例并重跑全部七个变体。

## 失败实验与证据

最初 480,000 通道 tap 试验中，未量化八 tap 模型有 1,588 差异；16 位 ties-to-even 仍有 440 差异；上下行不对称中点模型尚有 154 个边界差异。规约 clamp/mirror 后小矩阵闭合，扩大配置又发现 repeat extent=1 的 22,618 差异。最终对所有相同地址合并后大矩阵才归零。

这些失败模型、采集数据、命令、负控及原生 JSON 留在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch3/agfx-trilinear/`，不入 Git。`verification.json` 与源码 SHA 清单关联最终结果，`negative-controls/initial-verification.json` 保留初次 portable 漏检。

```sh
cmake -S research/independent-agfx-contract -B /tmp/agfx-trilinear -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/agfx-trilinear --parallel 4
ctest --test-dir /tmp/agfx-trilinear --output-on-failure
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/agfx-trilinear/agfx-trilinear-probe /Applications/VideoFusion-macOS.app/Contents/Frameworks/libAGFX.dylib
```

默认可移植构建省略原生选项；ASan/UBSan 单独配置 `-DAGFX_CONTRACT_SANITIZERS=ON`。其他 GPU/系统、极小或很大坐标、3D、sRGB/HDR、各向异性、真实滤镜逐 Pass 残差和产品 Preview/Export 均未由本轮关闭。
