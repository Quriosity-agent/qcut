# AGFX GL 片元算术 profile 与两个真实高斯 Pass 的逐 Pass 残差归因

2026-09-10 第五批，分支 `codex/jianying-binary-cpp-batch4-20260910`，工作包 04 的一个子项。

本单元做两件事：把真实柔光高斯 Pass 用到的四个片元算术点在已核验的 GL 渲染器上**实测**下来，
再用这些实测值判定这两个 Pass 的逐 Pass 残差到底来自哪里。

结论先写清楚：**残差不来自 pow / exp，也不来自默认精度或 mediump 取样。**
残差来自采样器模型。把采样换成已闭合的 M4 双线性 profile 之后，
六份钉住捕获的 `gaussian.x` 与 `gaussian.y` 共 12 个真实 draw、608,256 字节，
用纯标准库模型就已经逐字节零差异。实测的 GPU 算术 profile 没有让这个数字变好，
也没有让它变坏——这一点同样如实列出，它是本单元最重要的否定结论。

源码入口 [gl_fragment_profile.hpp](../../../research/independent-agfx-contract/gl_fragment_profile.hpp)，
实现 [gl_fragment_profile.cpp](../../../research/independent-agfx-contract/gl_fragment_profile.cpp)，
固定语料 [gl_fragment_profile_fixtures.hpp](../../../research/independent-agfx-contract/gl_fragment_profile_fixtures.hpp)，
故意改错的变体 [gl_fragment_profile_mutations.hpp](../../../research/independent-agfx-contract/gl_fragment_profile_mutations.hpp)。
默认 CTest 是 [gl_fragment_profile_tests.cpp](../../../research/independent-agfx-contract/gl_fragment_profile_tests.cpp)，
可选原生对照是 [gl_fragment_native_oracle.cpp](../../../research/independent-agfx-contract/gl_fragment_native_oracle.cpp)
加 [gl_fragment_native_support.hpp](../../../research/independent-agfx-contract/gl_fragment_native_support.hpp)。
默认 CTest 由 7 组增加到 8 组。

## 1. 恢复了什么

### 1.1 取样值落在 4081 点格上

已闭合的 M4 双线性 profile 把 byte×权重的定点和整除 4096、再乘 1/4080，
所以 RGBA8 双线性取样的输出**只可能**是 `k / 4080`，`k` 是 0..4080 的整数。
这一条不是估计，是 `m4_spatial.cpp` / `m4_texture.cpp` 的算术直接给出的，
并且在本批被 GL 片元阶段实测复核（见 1.4）。

它的直接后果是：`pow(取样值, u_gamma)` 这个站点的**输入域是封闭的 4081 个值**，
可以整表实测，不需要任何插值或近似。侦察阶段写的「256 个 k/255」只在采样点恰好对齐时成立；
真实 tap 落在纹素之间，域是 4081 而不是 256。本批按 4081 处理。

`sampled_lattice_index()` 对非格点抛异常，不做就近吸附——一旦采样器换代，
表查询会当场失败而不是悄悄退化成最近邻近似。

### 1.2 逐 Pass 控制流

本节的判定顺序**读自钉住的柔光特效包（`tree_sha256` 819180c0…）里的明文 GLES2
片元源码** `AmazingFeature/shaders/gaussianBlurY-0-c9ab/gles2/*.frag`，不是从 dylib
反汇编逆出来的；反汇编只用于 1.3 的默认精度问题。在一个整体叫「二进制 C++ 重建」
的项目里这一句必须写明：有明文源码对照比只有反汇编更强，但来源不能含糊。

`run_axis_pass()` 复刻的判定顺序（每一条都能在钉住捕获的 uniform 上验证）：

- tap 计数：`for (i = 1; i <= 1024; ++i)`，先把 `i` 转 float 再与 `u_sampleX` 比大小，
  超过就 break。`u_sampleX = 7.46030283` 给出 7 个 tap；`7.0` 也给 7 个，
  `6.999999` 给 6 个。1024 是循环硬上限，不是缓冲区大小。
- 中心项是**乘法**不是累加：`sum = centre * w0`，`total = w0`，
  其中 `w0 = exp(-0.0 / σ²)` 恰好等于 1.0（见 4.3）。
- 每个 tap 先走减向（`u - nΔ`），再走加向（`u + nΔ`）。
- `u_borderType == 0` 时越界 tap 走空：三条分支比较的是 1、2、3，0 一条都不匹配，
  **既不取样也不计权重**。这是重归一化，不是补零。
- 收尾是 `sum /= total`（四个通道都除，包括 alpha），再对 xyz 做 `pow(., 1/gamma)`。
  次序不能换（见 5.1）。
- `u_blurAlpha == 0` 时 alpha 用中心 tap 的原值覆盖；gamma 往返从不碰 alpha。

`u_spaceDither != 0` 一律拒绝——钉住的 draw 全是 0，本单元不假装覆盖 dither 分支。
`PassBorder` 的另外三个模式（clamp / weight_only / reflect）按静态控制流实现并有独立单测，
但**没有原生像素证据**，文中不把它们算作已验证。

### 1.3 静态证据证伪的一条假设

`ShaderPatcherV2::addDefaultPrecisionQualifier`（11.3.0 arm64 `0x676e8`，唯一 xref 来自
`patchInputTextures` `0x6a138`）只在 `AMGShaderType == 2` 时把 `float` 播种进集合，
再经 `PatcherUtils::find_token_and_process`（`0x49b94`）扫描 `precision` token。
真实 GLES2 片元源码开头已经是 `precision highp float; precision highp int;`，
扫描会命中已有声明，**不会**注入 mediump 默认精度。
「逐 Pass 残差源自 fp16 默认精度」这一假设当场被证伪，本批没有再花代价去测它。
反汇编留在仓库外 `batch5/agfx/recon/`。

### 1.4 mediump sampler2D 不引入更窄的取样算术

真实 Pass 把输入声明为 `uniform mediump sampler2D`。片元阶段自己的双线性结果与
已闭合的 `sample_m4_texture` 在 **56,368 个通道**上逐位一致，**0 差异**。
桌面 GL 忽略精度限定符这件事在这里是被测出来的，不是假设的。

## 2. 实测到的 GPU 算术 profile

以下全部是 `Apple M4 Pro` / `4.1 Metal - 90.5` / GLSL `4.10` / vendor `Apple` 上的实测值。
它们是**观测数据**，不是从 dylib 还原出来的算法；换驱动、换设备就要重测。
探针输入一律经 `texelFetch` 喂入，绝不写成字面量（原因见 2.4）。

| 站点 | 域 | 与标准库不同的个数 | 最大 ULP |
| --- | --- | --- | --- |
| `pow(x, 2.2)` | 4081 点格全域 | **2,860 / 4,081** | 18 |
| `exp((((-0.5)t)t)/(σσ))` | 每个 draw 的 8 个 tap（含中心） | 12 个 draw 中 10 个报 3，2 个报 5 | 未逐点统计 |
| `c + a*b` | 4,096 个定种子操作数 | 未收缩形式 **296**；`std::fma` **0** | — |
| `a / b` | 同上 4,096 组 | IEEE 除法 **1,141**；`a * (1/b)` **371** | — |

四条读法：

1. **GPU 的 `pow` 不是 libm 的 `powf`。** 4081 个格点里 2,860 个不同，最大 18 ULP。
2. **GPU 把 `c + a*b` 收缩成一次 FMA。** 4,096 组操作数里，`std::fma` 逐位命中全部 4,096 组，
   未收缩的 `c + a*b` 有 296 组不同。这是本批唯一实测确认可以用 `std::fma` 的位置，
   `gl_fragment_profile.cpp` 也只在累加站点、且只在显式打开 `fused_accumulate` 时用它。
3. **GPU 的除法是「倒数再乘」。** 片元阶段自己算的 `a/b` 与 `a*(1.0/b)` 逐位相同（0 差异），
   与 IEEE 除法有 1,141 组不同。但 CPU 上正确舍入的 `a * (1.0f/b)` 仍有 371 组对不上，
   说明硬件倒数本身不是正确舍入的——**这个站点无法用标准库精确建模**，如实记录，不硬凑。
4. **构成这两个 gamma 站点和权重站点的初等函数，无一能用标准库复现。**
   同一条 4,081 点扫描上（oracle 的 `elementary` 段）：

   | 函数 | 与标准库不同 | 最大 ULP |
   | --- | --- | --- |
   | `log2` | 1,972 / 4,081 | 3 |
   | `exp2` | 1,362 / 4,081 | 1 |
   | `exp` | 2,897 / 4,081 | 8 |
   | `1/x` | 324 / 4,081 | 1 |

   并且片元阶段的 `pow(x,y)` 与它**自己**的 `exp2(y*log2(x))` 逐位相同（差异 **0**），
   而用标准库的 `exp2f`/`log2f` 照抄同一个分解仍有 **2,336** 个点对不上。
   所以「照抄分解就能得到可移植公式」这条路是被实测堵死的。

### 2.4 常量折叠对照

同一个 `pow` 调用写成字面量时被着色器编译器折叠，
**3 / 3** 个对照点落在标准库的值上；同一批调用改从 `texelFetch` 取输入后，
**0 / 3** 与折叠结果相同。没有这个对照，探针量到的会是编译器而不是片元阶段。

## 3. 逐 Pass 残差归因

六份钉住捕获（`chart-final-a/b`、`offaxis-final-a/b`、`ramp-final-a/b`）
各两个真实高斯 draw，共 12 个 draw、608,256 字节。
每个 draw 都用**原生上游**做输入：`gaussian.x` 读 `0.rgba` 比 `1.rgba`，
`gaussian.y` 读 `1.rgba` 比 `2.rgba`。

三档模型全部列出，不挑好看的：

| 模型 | 说明 | 不同字节 |
| --- | --- | --- |
| （a）标准库 | `std::pow` / `std::exp`，逐次舍入的乘加，IEEE 除法 | **0 / 608,256** |
| （b）实测表 | 换成实测 tap 权重表与 4081 项 gamma 表，累加改 `std::fma` | **0 / 608,256** |
| （c）实测表 + 仪器化收尾 | 再把收尾的除法与 `pow(., 1/2.2)` 交给同一个片元阶段算 | **0 / 608,256** |

同一批捕获的上游与下游本身相差 125,898 字节（单图最大 167），所以这不是「输入等于输出」的平凡零。

结论：**这两个 Pass 的残差已经是 0，pow/exp 与 FMA 的实测差异全部被 unorm8 量化吸收。**
第 2 节量到的 GPU 与标准库的分歧真实存在（2,860 个格点、最大 18 ULP），
但传到 8 位输出时一个字节都没动。这是一个否定结论，不是「实测 profile 修好了残差」。

### 3.1 2026-09-07 记录的 51 / 139 是采样器造成的

`generic_bilinear` 变体——把 M4 定点采样器换成朴素浮点双线性，其余完全不动——
在 `chart-final-a` 的 `gaussian.x` 上产生 **51** 个不同字节，
与 2026-09-07 `metrics.json` 记录的 `gaussian.x` isolated 51 完全吻合。
也就是说旧记录里的逐 Pass 残差，成因是采样器模型而不是超越函数。
同一变体在 `gaussian.y` 上产生 **139** 个不同字节，与 `metrics.json` 记录的
`gaussian.y` isolated 139 同样吻合，因此 51 和 139 两个数都已交叉验证。
旧的 237 / 13,572 属于其他 stage 与 unorm8/blit 两次修正之前的口径，
**本文不引用、不向前套用**，需要时应重测。

### 3.2 行/列可分性

默认 CTest 里放的是一行和一列的真实原生像素，不是整帧。
这样做合法的原因是采样器的行足迹会塌缩：输出行取 `v = (y+0.5)/height`，
纵向足迹恰好落在纹素 `y` 上、小数权重为 0，足迹的第二行贡献为零。
所以横向 Pass 只吃那一行，纵向 Pass 只吃那一列。
这条不是在 fixture 里断言的，而是在 oracle 里对整幅捕获的
**90 行 / 160 列**逐一重算过：**0 差异 / 0 差异**。

## 4. 负控

14 个变体（含 `faithful`）全部编译通过并实际跑完，再判定被拒与否。
分类如实报告，未检出项一个没删。

### 4.1 被原生差分检出（5 个）

| 变体 | 12 个 draw 上的不同字节 | 命中 draw 数 |
| --- | --- | --- |
| `encode_before_divide` gamma 编码提到归一化之前 | 447,488 | 12 / 12 |
| `border_credits_weight` 走空的 tap 仍计权重 | 51,384 | 12 / 12 |
| `tap_count_rounds_up` 循环上界把样本数向上取整 | 41,248 | 10 / 12 |
| `lattice_byte_scale` 把取样格当成 1/255 | 8,628 | 12 / 12 |
| `generic_bilinear` 朴素浮点双线性 | 1,358 | 10 / 12 |

因为模型与原生逐字节相同，「被原生拒绝」与「被合同拒绝」在这批数据上是同一个数字；
两个口径都记在 JSON 里，没有只留好看的那个。

### 4.2 算术确实变了、但 8 位输出看不见（5 个）

这些变体在量化前的浮点值上确有差异，量化后一个字节都没动。它们**不是**无效变体，
是「本输出位宽不可观测」，保留在列表里并写明数字。

| 变体 | 量化前不同的浮点值个数 | 不同字节 |
| --- | --- | --- |
| `plus_side_first` 每个 tap 先走加向再走减向 | 26,494 | 0 |
| `weight_ratio_first` 把 σ 除法挪进平方里 | 35,756 | 0 |
| `fused_accumulate` 累加改用 FMA | 34,736 | 0 |
| `reciprocal_divide` 收尾除法改倒数乘 | 15,712 | 0 |
| `weight_via_exp2` `exp` 改写成 `exp2(x·log2 e)` | 14,376 | 0 |

### 4.3 根本不是变异（3 个）

| 变体 | 为什么 |
| --- | --- |
| `centre_weight_literal` 中心权重写成字面量 1.0 | `(-0.5·0)·0 = -0.0`，`-0.0/σ² = -0.0`，`exp(-0.0)` 恰好是 1.0。改写前后逐位相同。 |
| `ties_to_even` 量化改成四舍六入五成双 | float 乘 255 在 double 里是精确的，要落在 tie 上必须 `v = (2k+1)/510`，而它只有在 255 整除 `2k+1` 时才是二进制小数。`[0,1]` 里只剩 `v = 0.5` 一个点，两条规则在那里都答 128。整批 608,256 个量化输入里 **tie 数 = 0**。 |
| `gamma_skips_alpha_read` alpha 也走 gamma 往返 | 六份捕获的 alpha 只有 **1 个**不同的格点（全不透明），`pow(1, 2.2)` 恰好是 1。 |

后两条的理由在默认 CTest 里是**被检查**的（穷举 `[0,1]` 内可表示的 tie，
以及统计固定语料的 alpha），不是文档里的说法。

### 4.4 身份门禁负控

把 `kVerifiedRenderer` / `kVerifiedVersion` / `kVerifiedShadingLanguage` 三个常量分别改错重编，
oracle 三次都拒绝运行并 **退出码 2**，输出实际读到的三元组。
另外：缺参、多参、相对路径、不存在的路径、指向文件而非目录，全部退出码 2；
指向一个不含捕获的目录退出码 1（这是运行期读文件失败，不是门禁）。
记录在 `batch5/agfx/identity-gate.log`。

## 5. 默认 CTest 守住了什么

第 8 组 `agfx-gl-fragment-contract` 不加载任何厂商库、不需要 GPU，检查：

1. 4081 点格的双向往返全域一致；非格点（半个格步、1/3 之类）被拒；
   256 个 byte 值全部是格点（4080 = 255 × 16），反向不成立。
2. tap 权重的边界：零距离恰好 1.0、对距离和 σ 都是偶函数、远 tap 下溢到 0、
   NaN/∞ 被拒、**σ 的平方下溢**（≈1e-22 以下）被拒——这是真正的边界，不是 σ 本身为 0。
3. 两种结合方式在真实 tap 上给出不同的 binary32（防止有人「顺手化简」表达式）。
4. unorm8 的饱和、NaN、±∞、256 个 byte 往返，以及 4.3 里 tie 的穷举论证。
5. tap 计划的 7 / 7 / 6 / 0 / 1024 边界。
6. 全部非法 uniform（gamma ≤ 0、∞ gamma、σ ≤ 0、σ² 下溢、dither ≠ 0、NaN step、
   未知 border、未知 axis、残缺的实测表、空平面）被拒。
7. **真实原生像素**：`ramp-final-a` 的一整行（160 像素全不相同）与一整列，
   横向/纵向 Pass 逐字节复现原生输出；同时检查这段语料确实被模糊过、输出不是常数。
8. 把实测 tap 权重表（与标准库有 3 个不同）装回去重跑，仍然逐字节复现同一行。
9. 5 个应被拒的变体确被拒、5 个不可观测变体确实改了浮点、3 个非变异确实逐位相同。
10. 第 2、3 节记录的计数本身（608,256 字节、2,860 项、18 ULP、FMA 0 / 未收缩 296、
    折叠 3/3 与 0/3、采样器 0 差异）。

## 6. 复现

默认套件（无需 GPU、无需剪映）：

```sh
cmake -S research/independent-agfx-contract -B /tmp/qcut-agfx-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-agfx-contract --parallel 8
ctest --test-dir /tmp/qcut-agfx-contract --build-config Release --output-on-failure
```

原生对照（只在已核验的 macOS ARM64 + Apple M4 Pro 上）：

```sh
AGFX_EVIDENCE=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/batch5/agfx
AGFX_CAPTURES=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/softglow-passes
cmake -S research/independent-agfx-contract -B "$AGFX_EVIDENCE/build-release" \
  -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_GL_FRAGMENT=ON
cmake --build "$AGFX_EVIDENCE/build-release" --parallel 8
"$AGFX_EVIDENCE/build-release/agfx-gl-fragment-oracle" "$AGFX_CAPTURES" \
  > "$AGFX_EVIDENCE/gl-fragment-run-1.json"
```

oracle 不加载任何厂商 dylib：它的身份门禁是 GL 渲染器与驱动版本串，不是 dylib 哈希。
捕获目录必须是绝对路径。

## 7. 验证层与限制

| 验证层 | 结果 |
| --- | --- |
| 默认独立库 / 测试 | Release CTest **8 / 8** |
| 内存与未定义行为 | Debug + ASan/UBSan（`-fno-sanitize-recover=all`）CTest **8 / 8** |
| 原生 profile 可重现 | 两个独立 Release 进程 JSON **逐字节相同**；ASan/UBSan 进程（74 秒）JSON 与之**逐字节相同**、无报告 |
| 逐 Pass 归因 | 12 个真实 draw、**608,256** 字节，三档模型均 **0** 不同字节 |
| 采样器归属 | mediump sampler2D 对已闭合 M4 profile **56,368** 通道 **0** 差异 |
| 行/列可分性 | 整幅捕获 **90 行 / 160 列**逐一重算，**0 / 0** 差异 |
| 负控 | 13 个非 faithful 变体：**5** 个被检出、**5** 个改了浮点但 8 位不可观测、**3** 个在本域根本不是变异 |
| 身份门禁 | 三个身份常量各改错一次均退出 2；参数与路径门禁 6 项全部按预期 |
| 本线既有原生 oracle 回归 | `agfx-cv-plane-native-oracle --mutations` 跑两次，两份 JSON 与第四批 `differential-run-1/2` 除挂钟 `seconds`（301.198 / 298.947 对 301.19）外逐字段相同；`agfx-native-probe`、`agfx-texture-probe`、`agfx-mip-probe`、`agfx-spatial-probe`、`agfx-trilinear-probe` 五个 JSON 与历史记录逐字段相同 |

### 明确没有关闭什么

- **工作包 04 没有关闭。** 本单元只关闭了柔光链里的两个高斯 Pass。
  Glow mask、Glow 的 packed RG/BA 横纵模糊（255 进位类）、Glow composite、LUT pass、
  Normal 与两个 blit 都不在域内；迷雾整链不在域内。
- `u_spaceDither > 0` 的 dither 分支没有测，钉住的 draw 全是 0，不假装覆盖。
- `PassBorder` 的 clamp / weight_only / reflect 三个模式只有静态恢复与独立单测，
  **没有原生像素证据**。
- profile 只对 `Apple M4 Pro` / `4.1 Metal - 90.5` / GLSL `4.10` 成立。
  其他设备、Apple 软件渲染器、Metal 后端、HDR、透明输入、mip 链都不在域内。
- 像素证据全部来自 D634 私有运行时（libAGFX `1b949394…`、libcccreator `0c39324e…`、
  资源树 `819180c0…`），与安装版 11.3.0（`4fa8758d…`）**不可合并计数**。
  静态反汇编来自安装版，两者代码同构但数值证据不互换。
- GPU 的除法/倒数**没有**被建模成标准库表达式；实测说明硬件倒数不是正确舍入的，
  这个站点只有实测值，没有闭式。
- 没有跑 QCut 全应用回归，没有逐帧 UI 比较，没有新的 Preview/Export 对齐结论。
