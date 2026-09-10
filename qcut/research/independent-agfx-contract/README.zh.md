# AGFX 格式、采样器与纹理：独立 C++20 合同

2026-09-10 第五批新增[GL 片元算术 profile 与逐 Pass 残差归因](../../docs/task/jianying-filter-runtime-research/agfx-gl-fragment-arithmetic-2026-09-10-batch5.zh.md)：`gl_fragment_profile` 恢复真实柔光两个高斯 Pass 的片元控制流（4081 点取样格、tap 计划、`borderType==0` 走空语义、除法与 gamma 编码的次序、unorm8 规则），并在已核验的 `Apple M4 Pro` / `4.1 Metal - 90.5` 上实测 `pow`、`exp`、乘加收缩与除法降级。归因结论是**否定的**：六份钉住捕获的 12 个真实 draw、608,256 字节，纯标准库模型就已经逐字节零差异，实测 GPU profile 没有改变这个数字；2026-09-07 记录的 51 个不同字节由采样器模型而非超越函数造成。默认 CTest 为 8 组。本单元**没有**关闭工作包 04，只关闭了柔光链里的两个高斯 Pass。

2026-09-10 第四批新增[CoreVideo 平面格式解析](../../docs/task/jianying-filter-runtime-research/agfx-cv-plane-format-2026-09-10.zh.md)：`cv_plane_format` 恢复「四字符码 + 平面下标 + BGRA 开关 → GLES 四出参 / AMGPixelFormat / MTLPixelFormat」三棵判定树，加一个域更窄的 `CVPixelBufferRef` 入口。全 2^32 源码值 × 2 平面类 × 2 开关 = 17,179,869,184 组，逐位零差异；接受集 28 / 28 / 24。三个主入口都是自由函数，`dlsym` 直调，没有构造任何 SDK 对象。当前默认 CTest 为 7 组。本单元是确定性整数控制流，**不是**又一个硬件 profile，也**没有**关闭滤镜逐 Pass 残差。

2026-09-08 第二批新增[二维空间精度profile](../../docs/task/jianying-filter-runtime-research/agfx-spatial-sampling-2026-09-08.zh.md)：M4 Pro空间8位权重、寻址顺序和最终字节/16量化，72,474,112通道逐位零差异；每轴坐标只接受signed zero或abs∈[2^-24,8]，多层linear+linear仍拒绝。当前5组CTest，[本批验收](../../docs/task/jianying-filter-runtime-research/binary-cpp-batch2-2026-09-08.zh.md)取代下方历史测试计数。

2026-09-08 新增第四单元：[Apple M4 显式 mip profile](../../docs/task/jianying-filter-runtime-research/agfx-mip-sampling-2026-09-08.zh.md)，含 LOD 选择、精确字节域跨层混合和有界组合参考。当前独立 CTest 为4组；旧 mip 排除项456,192通道已纳入验证。下文09-07计数保留为历史记录，当前验证见[新批次](../../docs/task/jianying-filter-runtime-research/binary-cpp-scaleup-2026-09-08.zh.md)。

2026-09-07，分支 `codex/jianying-binary-cpp-next`，从 master `29d4700a5` 开始。

本工程交付三个可独立编译的单元：**113 个 AGFX→Metal 格式映射及平台条件、六个采样器字段映射、RGBA/BGRA 的 2D/3D 空间采样参考**。源码是根据静态控制流与原生输入输出重新组织的原创 C++；没有包含厂商头文件、机器码或反编译代码。

格式与枚举单元不读取像素；新增 `texture_sample` 负责最近点/双线性/三维插值、四种寻址与 row/slice padding。它是标准 C++ CPU 参考，不是整个 AGFX 渲染引擎。实际原生 sampler 与原创 Metal shader 的像素差分见[像素报告](../../docs/task/jianying-filter-runtime-research/agfx-texture-pixels-2026-09-07.zh.md)。后续逐项工作见[执行队列](../../docs/task/jianying-filter-runtime-research/binary-cpp-execution-2026-09-07.zh.md)。

## 独立构建与使用

默认只需要 CMake 和 C++20 标准库，Linux / Windows 构建无需 Metal SDK，也无需剪映。静态库没有私有 ABI 地址；这些地址只存在于可选诊断探针中。

从 QCut 包目录运行：

```sh
cmake -S research/independent-agfx-contract -B /tmp/qcut-agfx-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-agfx-contract --config Release --parallel 4
ctest --test-dir /tmp/qcut-agfx-contract --build-config Release --output-on-failure
```

产物包括 `agfx_contract` 静态库、八个测试程序和全域复算程序 `agfx-cv-plane-sweep`（构建但默认不进 CTest）。上面的 `/tmp` 路径是 Unix 示例，Windows 可换成本地构建目录。

```cpp
#include "pixel_format.hpp"
#include "sampler.hpp"

std::uint64_t metal_format = 0;
bool recognized = agfx_contract::convert_pixel_format({43, true}, metal_format);
// recognized=true, metal_format=70 (RGBA8Unorm).

agfx_contract::MetalSampler sampler{};
bool valid = agfx_contract::convert_sampler({1, 1, 0, 1, 1, 3}, sampler);
// Linear min/mag, no mip, clamp S/T, mirror-repeat R.
```

`FormatRequest::macos_11_or_newer` 是显式的**参考运行环境条件**，不表示当前 C++ 所在机器的 GPU 支持程度。调用者必须提供这个条件；在 Linux 上离线解释此格式合同同样可以提供 `true`。

## 1. 格式转换的精确语义

源输入为 `uint32_t`；输出为一个有效的 `uint64_t&`。函数返回是否识别此格式，输出规则如下：

| 输入 / 条件 | 返回 | 输出 |
| --- | --- | --- |
| 85 个无平台门控的合法值 | true | 写入完整 64 位 Metal 格式值 |
| `164..191`，macOS ≥11 条件成立 | true | 写入对应压缩格式值 |
| `164..191`，macOS ≥11 条件不成立 | **true** | **保持调用前的输出** |
| `1..205` 内其余 92 个空洞 | false | 保持输出 |
| `0` 或 `>205`，包括最高位为 1 的输入 | false | 保持输出 |

返回 true 不能独自证明输出有效，也不能证明 Apple 驱动能分配某种纹理。API 保留了原生“识别成功但不写出”的行为，不能把这个分支改成 false 或默认 RGBA8。空指针不属于此引用 API 的合法输入。

`pixel_format.cpp` 用有序行为表和显式平台条件实现这个合同。别名与数值空洞必须保留，例如 `29/43→70`、`131/132→252`，以及 `149→151`、`150→150`。不能对相邻输入或 Metal 枚举做未经验证的算术推导。

静态入口 `0x8b6e4–0x8bd24` 用无符号 `source-1 <= 204` 限制跳表。`164..191` 先设置返回值，再调用平台版本 helper；helper 在 `0x648e3c` 处理 `(platform=1, major=11, minor=0, patch=0)`，最终查 `_availability_version_check`，并有系统版本回退路径。该切片最低系统版本本身就是 macOS 11.0，因此旧系统分支仅做了静态恢复及独立单测，**没有旧 macOS 原生运行证据**。

## 2. 采样器的精确语义

六项输入分别保存，不能合并 mag/min 或 S/T/R：

| 字段 | 源值 → Metal 值 | 行为 |
| --- | --- | --- |
| mag、min | `0→0`、`1→1` | nearest、linear |
| mip | `0→0`、`1→1`、`2→2` | none、nearest、linear |
| wrap_s / wrap_t / wrap_r | `0→2`、`1→0`、`2→5`、`3→3` | repeat、clamp-to-edge、clamp-to-border-color、mirror-repeat |

Metal 值 `5` 不是 clamp-to-zero (`4`)；mirror-repeat (`3`) 也不是 mirror-clamp-to-edge (`1`)。名称对照本机 Metal SDK。

原生 `setTexFilterWrapMode`（`0x8e0c4–0x8e1fc`）是带 renderer/texture 对象的状态方法，先保存六个 int32，再通过有符号索引读取表，**没有边界检查**。本工程对任何非法字段返回 false，并保持整个输出结构不变，这是 **QCut 自有的输入保护策略**，不是从原生恢复出的错误处理协议。

原生各向异性值来自 texture 已有字段。新增纹理探针已核验本次创建路径的默认值为 1、透明黑 border、真实 setter/对象及像素；这不扩展为任意各向异性或完整资源状态机。mip 生成分支与尚未解出的 LOD 舍入见像素报告。

## 3. 已完成验证

参考为当前安装版剪映 11.3.0，Apple M4 Pro，macOS 26.6.2 ARM64：

- Universal SHA-256：`4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`。
- ARM64 UUID：`408EB610-AD47-3846-9595-14B6A3ABF537`。
- 编译器：Apple Clang 21.0.0；warnings-as-errors。

| 验证层 | 结果与限制 |
| --- | --- |
| 默认独立库 / 测试 | Release CTest **8/8**（2026-09-10 第五批起）；不需要加载厂商库 |
| 内存与未定义行为检查 | Debug + ASan/UBSan CTest **8/8**（2026-09-10 第五批起） |
| CoreVideo 平面格式穷举 | 全 2^32 源码 × 2 平面类 × 2 开关 = **17,179,869,184** 组、**137,438,953,472** 个值逐位比较，0 差异；接受集 28 / 28 / 24；两次独立进程 JSON 相同 |
| CoreVideo 平面格式定点与边界 | 定点 807,852 组、边界 160 组，0 差异；两个域的原生指纹 pin 进默认 CTest |
| CVBuffer 次要入口 | CoreVideo 实际创建 14 / 16 个候选码，28 次比较 0 差异；域受 `CVPixelBufferCreate` 限制，**不能**与 2^32 穷举结论混报 |
| 平面格式负控 | 11 个故意改错的变体，10 个被检出；`unsigned_pivot`（`'L007'` 枢轴有符号↔无符号）在全域不可观测，单列 |
| 平面格式全域独立复算 | `agfx-cv-plane-sweep` 不加载厂商库重算全 2^32，Release 约 77 秒共跑 9 次结论一致；同一程序在 ASan/UBSan 下 699 秒通过，`-fno-sanitize-recover=all` 无报告 |
| 平面格式失败门禁 | 相对路径、`liblens.dylib`、`libVECreator.dylib`、缺失路径、缺参与未知参数全部拒绝（退出码 2）；未静音的 20,000 次拒绝写出 11,480,000 字节，静音后 0 字节 |
| 全枚举域单测 | `1..205` × 两个平台条件；85/28/92 分类；完整行为指纹 `e87db91f1384326f`；别名、空洞、输出复用与四种哨兵 |
| 原生格式差分 | 每次 **69,637 个输入 × 3 个哨兵 = 208,911 次**；返回值、64 位输出及相邻保护值全部一致；两个独立进程报告逐字节相同 |
| 采样器独立单测 | **768** 个合法组合、**24** 个单字段越界值、重复调用和拒绝后恢复全部通过 |
| 采样器参考检查 | 768 个组合与已核验 AGFX 加载镜像中的表一致，并成功创建 768 个 Apple sampler state；初始表检查不涉及 setter；新增像素探针已对真实 setter 的全部 768 组合做逐像素验证 |
| 旧探针回归 | 7/7；仅 `43/50/97/128` 另有 Apple 4×3 纹理分配验证 |
| GL 片元算术 profile | `Apple M4 Pro` / `4.1 Metal - 90.5`：`pow` 在 4081 点格上 **2,860** 个与标准库不同（最大 18 ULP）；乘加实测为 FMA（`std::fma` 命中 4,096/4,096，未收缩形式差 296）；除法降级为倒数乘（IEEE 除法差 1,141，正确舍入的倒数乘仍差 371，故**无闭式**）；常量折叠对照 3/3 落在标准库、0/3 落在运行期值 |
| 逐 Pass 残差归因 | 12 个真实高斯 draw、**608,256** 字节：标准库模型 / 实测表模型 / 仪器化收尾三档均 **0** 不同字节；上游与下游本身差 125,898 字节 |
| mediump 取样归属 | 片元阶段双线性对已闭合 M4 profile **56,368** 通道 **0** 差异；行/列可分性在整幅捕获的 90 行 160 列上重算，**0/0** |
| 片元负控 | 13 个非 faithful 变体：**5** 个被检出、**5** 个改了浮点但 8 位输出不可观测、**3** 个在本域根本不是变异（理由在默认 CTest 里被检查）|
| 失败门禁 | 缺参、相对路径、未知库均拒绝；私有临时实现故意将 `43→70` 改为 `43→71` 后，原生差分正确失败；实际 CMake sanitizer flags 下的故意溢出用例非零退出 |

差分输入包括 `0..65535`、5 个额外边界、4,096 个固定种子 LCG 值；可能重合，因此 69,637 是输入条目数，不是唯一值数。种子 `0x51435554`，每步 `state = state * 1664525 + 1013904223 (mod 2^32)`，先更新再发出。哨兵为 `0x123456789abcdef0`、`0`、`UINT64_MAX`。原生报告记录完整枚举域结果及可重建全部样本的参数。

完整域测试指纹来自独立原生观察；编码为 source `LE u32`、return `u8`、written `u8`、output `LE u64`。原生完整域的行为表不是从 C++ 实现重新生成的期望值。

仓库新增[三平台 CMake CI](../../../.github/workflows/agfx-contract.yml)，另有 Linux sanitizer 配置和 macOS ARM64 探针仅编译检查。Sanitizer 配置使用 `-fno-sanitize-recover=all`，错误会令测试失败。初始两单元的云端三平台及 Linux sanitizer 已通过；本次四工程扩展须查看当前 PR head，不能把旧 head 状态沿用为新结果。本轮没有运行 QCut 全应用回归或逐帧 UI 比较。

## 4. 可选原生差分复现

只在已核验的 macOS ARM64 环境打开探针选项。`dlopen` 前检查请求文件 SHA；调用前再检查加载镜像 SHA、架构和 UUID，未知版本拒绝运行。该选项只构建自有诊断程序，厂商库路径由运行者显式传入。

```sh
AGFX_EVIDENCE=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/agfx
AGFX_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
cmake -S research/independent-agfx-contract -B "$AGFX_EVIDENCE/build-release" \
  -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_NATIVE_PROBE=ON
cmake --build "$AGFX_EVIDENCE/build-release" --parallel 4
DYLD_LIBRARY_PATH="$AGFX_FRAMEWORKS" "$AGFX_EVIDENCE/build-release/agfx-native-probe" \
  "$AGFX_FRAMEWORKS/libAGFX.dylib" > "$AGFX_EVIDENCE/differential.json"
```

原始二进制、反汇编和原生 JSON 保存在仓库外。此次私有证据根目录为上述 `AGFX_EVIDENCE`，含 `differential-run-1.json`、`differential-run-2.json`、构建/CTest 产物和 `verification.json`。这份报告与旧 D634 CGL 柔光宿主分属不同版本，不能将映射验证升级为柔光逐 Pass 精度验证。

纹理扩展已完成 384 项独立测试、8 次原生 RGBA/BGRA 字节读回和两次完整 GPU 复跑。CPU 空间参考接受有限坐标并校验尺寸、跨度、溢出及截断；depth=1 仍按三维接口处理 R 轴，2D 使用 w=0.5。具体计数、排除的 LOD 域、失败实验和复现命令见像素报告。下一项是真实柔光中间 Pass 的误差归因。

## 2026-09-08 第三批：多层联合线性采样

`sample_m4_texture` 已闭合 M4 Pro 有界二维域内的多层 spatial linear + mip linear。
联合 16 位 tap 系数、行相关中点舍入、重复地址合并与镜像方向规约有真实输出证据。
512 配置、230,661,120 通道逐 bit 一致；独立 GPU 路线也为零差异。
独立 Release/ASanUBSan 各 6/6，七个已编译错误变体均被两套测试检出，旧原生矩阵不变。
完整/部分 mip 链和 RGBA/BGRA 已覆盖；其他设备、极小/大坐标、HDR、实际滤镜逐 Pass 和产品接入仍缺。
详见[联合采样研究](../../docs/task/jianying-filter-runtime-research/agfx-trilinear-sampling-2026-09-08.zh.md)。

## 2026-09-10 第四批：CoreVideo 平面格式解析

`cv_plane_format` 把滤镜输入链最前端的格式解析闭合：CoreVideo 四字符码加平面下标解析成 GLES 的四个出参、`AMGPixelFormat` 和 `MTLPixelFormat`。

```cpp
#include "cv_plane_format.hpp"

agfx_contract::GlesPlaneFormat gles{0xaaaaaaaa, 0xaaaaaaaa, 0xaaaaaaaa, 0xaaaaaaaa};
// '420v' 的色度平面；平面下标按完整 64 位与零比较。
bool ok = agfx_contract::resolve_gles_plane_format({0x34323076, 1, false}, gles);
// ok=true，gles={GL_RG, GL_UNSIGNED_BYTE, GL_RG8, 0x1000}。

std::uint64_t metal = agfx_contract::resolve_metal_plane_format({0x4c303038, 0, false});
// metal=1 (A8Unorm)。经 AMGPixelFormat 中转的同一个源会走到 10 (R8Unorm)——这是原生真实分歧。
```

GLES 与 AMG 两个入口的接受集是同一批 7 个码（`'420f'`、`'420v'`、`'2C08'`、`'BGRA'`、`'L008'`、`'RGhA'`、`'fdep'`）；Metal 入口少一个 `'2C08'`，只认 6 个。被拒绝的源**保留全部出参**，`'BGRA'`/`'RGhA'`/`'fdep'` 三条分支也不写第四个出参；这两条保留语义都在默认 CTest 里用哨兵守着，不能改成写默认值。`resolve_buffer_pixel_format` 是另一棵更窄的树，多认 `'&BGA'`、`'-BGA'`、`'hdis'`、`'l64r'`，且对 `'L008'` 给 15 而不是 2。

本单元没有浮点，全部是整数逐位比较。全域复算程序 `agfx-cv-plane-sweep` 只用标准库，挂在 `AGFX_CONTRACT_EXHAUSTIVE` 选项下（默认关闭，运行约 77 秒）；原生对照挂在 `AGFX_CONTRACT_NATIVE_ORACLE` 下。计数、负控与明确不覆盖的范围见[平面格式合同](../../docs/task/jianying-filter-runtime-research/agfx-cv-plane-format-2026-09-10.zh.md)。

## 2026-09-10 第五批：GL 片元算术与两个高斯 Pass

`gl_fragment_profile` 把真实柔光的 `gaussian.x` / `gaussian.y` 两个 draw 逐字节闭合。

```cpp
#include "gl_fragment_profile.hpp"

// 双线性 RGBA8 取样只落在 4081 点格上，所以 gamma 解码站点的输入域是封闭的。
const std::uint32_t index = agfx_contract::sampled_lattice_index(sampled_value);

agfx_contract::AxisPassUniforms uniforms{};
uniforms.sample_count = 7.46030283F;   // 恰好 7 个 tap
uniforms.step = 0.00527793588F;
uniforms.sigma = 0.0157500003F;
uniforms.gamma = 2.2F;
uniforms.border = agfx_contract::PassBorder::drop;  // 越界 tap 既不取样也不计权重
const auto result = agfx_contract::run_axis_pass({source, uniforms, agfx_contract::PassAxis::horizontal});
```

`shader_tap_weight` 的两种结合方式在真实 tap 上给出不同的 binary32，
`-0.5F * (t / sigma) * (t / sigma)` 不是它的等价写法，默认 CTest 守着这一条。
`std::fma` 只在实测确认的累加站点、且只在显式打开 `fused_accumulate` 时使用。
原生对照挂在 `AGFX_CONTRACT_GL_FRAGMENT` 选项下，身份门禁是 GL 渲染器与驱动版本串，
不加载任何厂商 dylib。计数、负控分类与明确不覆盖的范围见
[片元算术合同](../../docs/task/jianying-filter-runtime-research/agfx-gl-fragment-arithmetic-2026-09-10-batch5.zh.md)。
