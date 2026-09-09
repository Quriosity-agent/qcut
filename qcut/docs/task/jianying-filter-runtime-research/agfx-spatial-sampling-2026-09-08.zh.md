# AGFX / Apple M4 Pro 二维空间采样精度合同

2026-09-08，接续同一 [PR #469](https://github.com/Quriosity-agent/qcut/pull/469)。本批交付原创标准 C++20 二维纹理采样器，恢复已验证的空间权重、寻址顺序和最终幅值量化，默认编译和调用无需剪映或 Metal。它是**实际 AGFX 创建的 Metal sampler 在指定设备上的行为 profile**，不是从 dylib 中找到了 GPU 内部 C++ 算术，也不是整个 AGFX 引擎恢复。

源码：[m4_texture.hpp](../../../research/independent-agfx-contract/m4_texture.hpp)、[实现](../../../research/independent-agfx-contract/m4_texture.cpp)、[测试](../../../research/independent-agfx-contract/m4_texture_tests.cpp)、[原创夹具](../../../research/independent-agfx-contract/m4_texture_fixtures.hpp)。共同纹素寻址提取为 [texture_address.hpp](../../../research/independent-agfx-contract/texture_address.hpp)，旧浮点参考与新 profile 共用边界/通道读取，保持不同精度语义。

## 实际语义与明确输入域

沿用上一批[显式 mip profile](agfx-mip-sampling-2026-09-08.zh.md)的 binary16 LOD 与 1/64 跨层权重。本批增加：

1. Repeat 先在归一化坐标域执行 `u -= floor(u)`。Mirror 先作有符号周期二规约 `u -= floor(u/2)*2`，不能替换成先取绝对值或先反射到 `[0,1]`。
2. 坐标乘纹理尺寸使用 binary32 舍入；线性采样随后减去 0.5，取 floor 得基准纹素。使用 double 乘法会改变部分临界采样。
3. 空间 fraction 量化为 8 位权重，`floor(fraction*256+0.5)`；半步向上，允许权重 256 表示完全选择相邻纹素。
4. 四个字节纹素按两轴权重作整数加权，中间不先舍入横向结果。保留全部四 tap 后，最终舍入到字节的 1/16，再输出 `float(integer)/4080.0F`。跨 mip 的最近点采样复用此前 1/64 权重，仍保持最终一次舍入。
5. 最大累计分子含 mip 权重低于 2^32；地址和尺寸先验证再索引。禁止 fast-math，要求 FE_TONEAREST。MSVC `/fp:strict`，其他编译器禁隐式 contraction。

| 项目 | 此精确 API 接受范围 |
| --- | --- |
| 像素 | RGBA8 / BGRA8 UNORM，自有 byte buffer；允许合法 row padding |
| 纹理 | 2D，w=0.5，完整合法 mip 链，维度沿用验证器上限16384 |
| 每个 u/v | 有限，signed zero 或绝对值位于 `[2^-24,8]`；区间两端包含 |
| 空间 nearest | mip none / nearest / linear |
| 空间 linear | mip none / nearest；单层纹理也可 mip linear |
| border / sampler | 透明黑，min=mag，各向异性1；S/T分别支持四种已知寻址 |
| 浮点环境 | IEEE binary32、最近舍入；LOD有限，选择/夹取沿用已有profile |

坐标域是本实现依据实测设定的保守范围，**不是解释硬件异常行为的推导结论**。所有 levels 和 queries 在输出前验证，包括未选中的 mip、空 query 列表。越界/截断、未知枚举、非透明 border、未验证的多层双线性组合抛出 `invalid_argument`，不返回近似成功。单点和 batch API 共用同一计算核。

## 原生对照

[agfx-spatial-probe.mm](../../../research/jianying-runtime-probe/agfx-spatial-probe.mm)复用真实 AGFX renderer、texture 工厂和 sampler setter；原创 Metal shader 分别以真实 sampler 和独立配置 sampler 读取同一纹理，再与独立 C++ 逐通道比较 float bits。

固定环境为剪映 11.3.0、Apple M4 Pro、macOS 26.6.2 (25G83)：

- `libAGFX.dylib` SHA-256：`4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`。
- arm64 UUID：`408EB610-AD47-3846-9595-14B6A3ABF537`。
- 调用前核验文件及实际加载镜像身份，探针另明确要求 Apple M4 Pro；其他机器拒绝套用原生比较。

| 检查 | 结果 |
| --- | --- |
| 纹理尺寸 | 1×1、2×2、3×5、17×9、128×65、257×129、16384×1、1×16384，RGBA/BGRA两种格式 |
| sampler / 格式 / 尺寸配置 | 1,312 |
| C++ 对真实 sampler | 72,474,112 通道，0 bit 差异 |
| 独立 GPU sampler 对真实 sampler | 72,474,112 通道，0 bit 差异；这是另一条同输出对照，不算新增唯一输入 |
| 实际输出完整指纹 | `e3e9c7c939019631` |
| 跨平台 CTest 原生金指纹 | 3×5 RGBA 全部夹具及80组配置：`8305e9f8bc561478` |
| 连续浮点近似模型负控 | 受测子集32,504个像素与原生不等，证明不能用普通float插值声称逐位一致 |

每个尺寸包含8192个固定种子随机 query、地址边界笛卡尔组合、空间1/256半步上下相邻float、纹素边界相邻float和LOD层边界。显式加入±2^-24及向外 nextafter，signed ±0；零旁不可接受的小非零坐标由独立拒绝测试覆盖，不投入此精确输出矩阵。夹具图样和 shader 均原创，不包含厂商滤镜资源。

最终Release、独立进程repeat及ASan/UBSan三份解析JSON完全相同；原有格式、纹理和mip三份原生报告与前批相同。5个编译变体（向下空间权重、丢失repeat规约、mirror先abs、丢失byte/16舍入、放行极小坐标）均被测试拒绝。前三项寻址/精度负控中，初版256-query指纹未检出mirror变体；改为3×5全部夹具的实际原生指纹后检出，单独保留该覆盖边界。另有缺参、相对路径、错误身份3项拒绝检查。

## 失败实验与尚未闭合项

- 多 mip 的空间 linear + mip linear：尝试整体8 tap量化、层内先量化和多种中间位数，都留下差异；当前 API 明确拒绝。单层情形不涉及跨层组合，已独立覆盖。
- 宽坐标±65536：最大16384维纹理出现寻址差异；例如repeat的负大整数。私有 `wide-domain-*` 和 `native-1/2/3.json` 保留原代码/失败计数。普通尺寸未复现不能证明大尺寸也成立。
- 极小非零坐标：最小normal/subnormal在不同尺寸和wrap下表现不统一；静默flush-to-zero或把repeat结果夹到nextafter(1,0)均不能统一解释。`tiny-domain-*`、`native-micro.json`、`native-micro-2.json` 保留失败。最终实现删除这些猜测，拒绝 `0<abs(coord)<2^-24`。
- 其他GPU/OS、3D、sRGB/HDR、各向异性、不同min/mag、真实柔光/迷雾中间Pass、QCut预览/导出仍未验证。旧通用 float 参考继续按其原有语义提供，不被本profile覆盖。

源码、原生JSON、失败实验、构建与负控均保存在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/agfx-spatial/`；最终证据以 `verification.json` 列出的文件为准，早期名为 `native-final.json` 的报告只是限域前一次阶段性成功，不能代替加入微小坐标边界后的最终报告。

## 复现

```sh
cmake -S research/independent-agfx-contract -B /tmp/qcut-agfx-spatial -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-agfx-spatial --parallel 4
ctest --test-dir /tmp/qcut-agfx-spatial --output-on-failure
AGFX_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
DYLD_LIBRARY_PATH="$AGFX_FRAMEWORKS" /tmp/qcut-agfx-spatial/agfx-spatial-probe "$AGFX_FRAMEWORKS/libAGFX.dylib" > /tmp/agfx-spatial.json
```

默认省略 native 选项即可仅构建独立 C++。本目录现有5组CTest；本批六工程统一构建、sanitizer及当前head云端结果见[第二批总验收](binary-cpp-batch2-2026-09-08.zh.md)。原生sanitizer仅检查自有代码和调用侧，厂商库本身没有插桩。

## 第三批后续

本文记录的多层 spatial linear + mip linear 拒绝状态已由
[第三批联合采样](agfx-trilinear-sampling-2026-09-08.zh.md)在同一有界 M4 Pro profile 内关闭。
本文原始失败实验和旧 72,474,112 通道矩阵保留为历史证据；其他设备及域外坐标仍未覆盖。
