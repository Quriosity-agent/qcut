# AGFX CoreVideo 平面格式解析合同（2026-09-10）

本轮恢复 libAGFX 里「CoreVideo 四字符码 + 平面下标 + BGRA 开关 → 三套设备格式」的整数判定树：GLES 的四个出参、`AMGPixelFormat`、`MTLPixelFormat`。三个平面入口全部是导出的自由函数，`dlsym` 取到函数指针直调，唯一的指针参数是调用方自己的 `uint32_t` 出参，全程没有构造、伪造或借用任何 SDK 对象；次要入口用的 `CVPixelBufferRef` 也来自 `CVPixelBufferCreate` 这个真工厂。全部 2^32 个源码值 × 2 个平面类 × 2 个开关共 17,179,869,184 组，与原生逐位零差异。另有一个域更窄的 `CVPixelBufferRef` 入口单列交付。

本批**没有**关闭滤镜逐 Pass 像素残差归因，也**没有**把既有「AGFX 是 M4 Pro 硬件实测 profile」的口径改掉——这个单元是与 GPU 无关的确定性控制流，两者不能混为一谈。返回 true 或非零 Metal 值同样不证明设备能分配该纹理，沿用既有 `pixel_format` 单元的免责口径。

源码入口是 [cv_plane_format.hpp](../../../research/independent-agfx-contract/cv_plane_format.hpp)，实现 [cv_plane_format.cpp](../../../research/independent-agfx-contract/cv_plane_format.cpp)，固定语料 [cv_plane_format_fixtures.hpp](../../../research/independent-agfx-contract/cv_plane_format_fixtures.hpp)，故意改错的变体 [cv_plane_format_mutations.hpp](../../../research/independent-agfx-contract/cv_plane_format_mutations.hpp)。默认 CTest 是 [cv_plane_format_tests.cpp](../../../research/independent-agfx-contract/cv_plane_format_tests.cpp)，可选原生对照是 [cv_plane_format_native_oracle.mm](../../../research/independent-agfx-contract/cv_plane_format_native_oracle.mm)。

工作树 `qcut-binary-cpp-scaleup-wt/qcut`，分支 `codex/jianying-binary-cpp-batch4-20260910`，基于 master `97cf30a83`。全部原始证据在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/agfx/`：反汇编在 `recon/`，本轮原生 JSON 与构建产物在 `cv-plane/`。厂商 dylib、抽出的 arm64 切片、反汇编文本和原生 JSON 一律不进仓库。

## 1. 库身份与静态定位

本机剪映 11.3.0，Apple M4 Pro，macOS 26.6.2 ARM64。

| 项目 | 值 |
| --- | --- |
| `libAGFX.dylib` universal SHA-256 | `4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa` |
| arm64 UUID | `408EB610-AD47-3846-9595-14B6A3ABF537` |
| 编译器 | Apple Clang 21.0.0，warnings-as-errors |

对照程序复用本线既有的 [agfx-library.hpp](../../../research/jianying-runtime-probe/agfx-library.hpp) 门禁：`dlopen` 前查请求文件 SHA-256，`dlsym` 后再查实际加载镜像的文件 SHA、`MH_MAGIC_64`、`CPU_TYPE_ARM64` 和 `LC_UUID`。本单元在其上再加一层地址 pin：六个符号必须逐个落在 `base + 偏移`，任一不符抛错拒跑，不写任何输出。

| 符号 | 偏移 | 角色 |
| --- | --- | --- |
| `AmazingEngine::getPlanePixelFormatGLES(uint32,size_t,uint32&,uint32&,uint32&,uint32&,bool)` | `0xc03c4` | 主入口 |
| `AmazingEngine::getPlanePixelFormatMetal(uint32,size_t,bool)` | `0xc02dc` | 主入口 |
| `AmazingEngine::AGFXUtils::Internal::getPlanePixelFormatGLES(uint32,size_t,AMGPixelFormat&)` | `0x160e0` | 主入口 |
| `AmazingEngine::getPixelFormat(__CVBuffer*,bool)` | `0x85a9c` | 次要入口，域窄 |
| `AmazingEngine::AELogSystem::instance()` | `0xc623c` | 真单例工厂，用于静音 |
| `AmazingEngine::AELogSystem::SetLogLevel(int,int)` | `0xc74c8` | 真 setter，用于静音 |

静态解码保存在 `recon/getPlanePixelFormatGLES_0xc03c4.asm`、`recon/getPlanePixelFormatMetal_0xc02dc.asm`、`recon/agfxutils_getPlanePixelFormatGLES_0x160e0.asm`、`recon/getPixelFormat_CVBuffer_0x85a9c.asm`，均从 `lipo -thin arm64` 抽出的切片反汇编而来。

## 2. 三个平面入口的精确语义

GLES 与 `AMGPixelFormat` 两个入口是逐指令同构的同一棵树，只有终点不同；Metal 入口是**另一棵结构不同的树**。

判定顺序（GLES / AMG）：

1. `w8 = src & 0xffffffef`，只清 bit 0x10。满足 `w8 == '420f'` 的源恰好只有 `'420f'` 与 `'420v'` 两个。
2. `cmp x1, #0`——平面下标用**完整 64 位**比较，零为亮度，任意非零为色度。「任意非零」来自指令编码本身，不是抽样推广；动态侧实际跑过的平面值是 `0`、`1`、`2`、`0xffffffff`、`0x100000000`、`0x100000001`、`SIZE_MAX-1`、`SIZE_MAX` 八个，其中 `0x100000000` 的低 32 位全零，正是区分 64 位与 32 位比较的那一个。
3. 命中折叠时把键换成平面键（亮度 `'L008'`，色度 `'2C08'`）；**不命中时退回未掩码的原值**，不是掩码后的值。
4. 以 `'L007'` 为枢轴做一次二分（`b.le`，有符号）。`'L007'` 本身不是任何被接受的格式。

出参写入是分支相关的，拒绝路径一个都不写：

| 源（或折叠后的平面键） | GLES format / type / internalFormat / 第四出参 | AMGPixelFormat | MTLPixelFormat |
| --- | --- | ---: | ---: |
| `'L008'`（含 `'420f'`/`'420v'` 亮度平面） | `GL_RED` / `GL_UNSIGNED_BYTE` / `GL_R8` / `0x4000` | 2 | 见下 |
| `'2C08'`（含 `'420f'`/`'420v'` 色度平面） | `GL_RG` / `GL_UNSIGNED_BYTE` / `GL_RG8` / `0x1000` | 22 | 见下 |
| `'BGRA'` | `GL_BGRA` 或 `GL_RGBA` / `GL_UNSIGNED_BYTE` / `GL_RGBA` / **保留** | 43 | 70 或 80 |
| `'RGhA'` | `GL_RGBA` / `GL_HALF_FLOAT` / `GL_RGBA16F` / **保留** | 103 | 115 |
| `'fdep'` | `GL_RED` / `GL_FLOAT` / `GL_R32F` / **保留** | 106 | 55 |
| 其余全部 2^32 值 | 四个出参**全部保留** + 返回 false | 保留 + false | 0 |

只有 `'BGRA'` 的 format 跟随开关（`GL_BGRA` / `GL_RGBA`），internalFormat 两侧都是 `GL_RGBA`。第四个出参只有单通道和双通道两条分支会写，两个值的含义没有恢复出来，按不透明观测值原样搬运，没有映射到任何具名常量。

Metal 入口的结构差异必须原样保留，不能「顺手对齐」：

- **没有** `and #0xffffffef`，`'420f'` 和 `'420v'` 是两次独立的相等比较。
- **没有**平面键替换；`'420f'`/`'420v'` 直接按平面选 `R8Unorm`(10) 或 `RG8Unorm`(30)。
- `'L008'` 返回 **1 = `A8Unorm`**，不是 10；与同一格式在 GLES 侧拿到 `GL_RED`/`GL_R8`、在 AMG 侧拿到 2 形成不对称。
- **`'2C08'` 在 Metal 侧根本没有分支**，落到日志 + `mov x0, #0`。
- 返回值写的是 `x0`（64 位 NSUInteger）；0 就是 `MTLPixelFormatInvalid`，属带内失败信号，调用方除「非零」外没有别的判据。

拒绝路径调 `AmazingEngine::g_aeLogT`，字面池带着原厂源码路径与行号：GLES 是 `SharedResourceManagerApple.mm:393`，Metal 是同文件 `:367`，AMG 是 `AGFXUtils/ImageKernels/YUV/YUVConvertor.mm:17`——但 AMG 打印的字符串仍是 `SharedResourceManager::getPlanePixelFormatGLES(): unsupported format!`，两个函数共享同一字面量，是原厂复制粘贴痕迹。

`bool` 参数在 ABI 层是 32 位非零测试：传 `0x100`（低字节为 0）仍走 BGRA 分支；`x0` 的高 32 位被忽略。这两条**只是 ABI 观察**，C++ 声明域是 `{false,true}`，不写进合同，也没有拿来当负控的通过项。

## 3. 次要入口：`getPixelFormat(__CVBuffer*, bool)`

这个入口来自 Metal V2 渲染器而不是共享资源管理器，没有平面参数，先 `CVPixelBufferGetPixelFormatType` 取码再走三层有符号枢轴（`'RGhA'-1`、`'BGRA'-1`、`'hdis'-1`）。它比平面入口多认四个码，并且对 `'L008'` 给出**不同的** AMGPixelFormat：

| 源 | AMGPixelFormat | 备注 |
| --- | ---: | --- |
| `'&BGA'` Lossless_32BGRA | 43 / 50 | 跟随开关 |
| `'-BGA'` Lossy_32BGRA | 43 / 50 | 跟随开关 |
| `'BGRA'` | 43 / 50 | 跟随开关 |
| `'L008'` | 15 | 平面入口给的是 2 |
| `'RGhA'` | 103 | 与平面入口一致 |
| `'fdep'` | 106 | 与平面入口一致 |
| `'hdis'` DisparityFloat16 | 82 | 平面入口不认 |
| `'l64r'` 64RGBALE | 97 | 平面入口不认 |
| `'420f'` / `'420v'` / `'2C08'` 等 | 0 | 本入口不认 |

它需要真的 `CVPixelBufferRef`，只能用 `CVPixelBufferCreate` 这个真工厂造，因此**输入域受限于 CoreVideo 自己肯创建的格式，不能穷举**。本轮 16 个候选码里 CoreVideo 创建成功 14 个，28 次比较全部一致：8 个被接受的码 × 2 个开关共 16 次非零，`'420f'`/`'420v'`/`'2C08'`/`'RGfA'`/`'L016'`/`'y420'` 共 12 次实测返回 0。`'ARGB'` 与 `'v008'` 被 CoreVideo 拒绝创建，它们属于拒绝集这一条只能来自反汇编，没有动态证据。这条线的计数与 2^32 穷举结论分开报，不得混用。

## 4. 跨单元交叉验证

本单元输出的 AMGPixelFormat 全部落进仓库已交付的 `pixel_format.cpp` 表，把「CoreVideo 四字符码 → AMGPixelFormat → MTLPixelFormat」这条链的前端接上：

| AMGPixelFormat | 已交付表给出的 Metal | 本单元 Metal 入口对同一源直接给出 |
| ---: | ---: | --- |
| 43 / 50（`'BGRA'`） | 70 / 80 | 70 / 80，一致 |
| 22（色度平面） | 30 | 30，一致 |
| 103（`'RGhA'`） | 115 | 115，一致 |
| 106（`'fdep'`） | 55 | 55，一致 |
| 2（`'L008'`，平面入口） | 10 | **1**，两条路线不一致 |
| 15（`'L008'`，buffer 入口） | 10 | 同上 |
| 82 / 97（buffer 入口独有） | 25 / 110 | 平面入口不认这两个码 |

`'L008'` 的分歧是原生真实行为：直接问 Metal 拿到 `A8Unorm`，经 AMGPixelFormat 中转拿到 `R8Unorm`。两个单通道 AMG 码 2 与 15 在已交付表里都收敛到 10。这些交叉断言在默认 CTest 里直接跑，不需要厂商库。

## 5. 原生对照的实际计数

对照程序按阶段跑，每组比较 8 个值：GLES 返回值 + 四个出参、AMG 返回值 + 出参、Metal 的 64 位返回值。出参在调用前一律填 `0xAAAAAAAA` 哨兵，所以「没写」和「写了同样的值」是可区分的。

| 阶段 | 组合数 | 逐位比较值 | 差异 | GLES / AMG / Metal 接受 |
| --- | ---: | ---: | ---: | --- |
| 边界（宽平面下标、符号位源、拒绝邻居） | 160 | 1,280 | 0 | 112 / 112 / 96 |
| 定点（常量邻域、逐位翻转、定种 LCG） | 807,852 | 6,462,816 | 0 | 84 / 84 / 76 |
| 全 2^32 穷举 | 17,179,869,184 | 137,438,953,472 | 0 | 28 / 28 / 24 |
| CVBuffer 次要入口 | 28 | 28 | 0 | 16 |

穷举接受集正好 28 组 = 7 个被接受的码 × 2 个平面类 × 2 个开关；Metal 少掉 `'2C08'` 的 4 组，得 24。两次独立进程除计时字段外整份 JSON 逐字节相同（296.1 秒与 301.2 秒）。两次都用同一个由交付源码链接出的 oracle 可执行文件，其 SHA-256 记在 `verification.json` 的 `oracle_binary` 里；更早还有两次 `prewrap-run-*.json`，用的是仅注释换行不同的一版源码，同样保留在证据目录；manifest 记录这两次在全部四个阶段和全部变体结论上与交付源码的两次逐字段一致。

日志静音是穷举的前提：没有 `AELogSystem::SetLogLevel(0,0)`，2^32 里几乎全是拒绝路径，每次都要格式化打印。对照程序把这一条也做成负控——先不静音跑 20,000 次拒绝，记到 11,480,000 字节输出；再用真单例静音后同样跑 20,000 次，记到 0 字节；整个差分阶段结束时厂商向标准描述符写入 0 字节。厂商日志走的是描述符 1 而不是 2，只盯 stderr 会得到一个假的零。

默认 CTest 不加载任何厂商库，秒级完成：28 条原生金样例（含哨兵保留位）、边界与定点两个域的原生指纹、64 位平面语义、折叠语义、拒绝保留语义、buffer 入口表、跨单元闭合、以及全部变体分离。全 2^32 的独立复算另有 `agfx-cv-plane-sweep`，只用标准库、约 80 秒，挂在 `AGFX_CONTRACT_EXHAUSTIVE` 下，默认不进 CTest。

| 验证层 | 本批之前 | 本批之后 |
| --- | --- | --- |
| Release CTest | 6/6 | **7/7** |
| Debug + ASan/UBSan CTest（`-fno-sanitize-recover=all`） | 6/6 | **7/7** |
| 独立全域复算 `agfx-cv-plane-sweep`（不加载厂商库） | 无 | 通过，Release 约 76 s；共 9 次 Release 执行结论一致 |
| 同一全域复算在 ASan/UBSan 下 | 无 | 通过，699.1 s，`-fno-sanitize-recover=all` 无任何报告 |

两套构建都是空目录重新 configure，`-Wall -Wextra -Wpedantic -Werror` 下零警告零错误；两套构建的第 7 组即 `agfx-cv-plane-format-contract`。CI 的统一入口 `independent-binary-contract` 用 `add_subdirectory` 收本工程，新目标自动进三平台矩阵；本工作树同时有其它线在改，所以统一入口的最终结果以 PR head 为准，不能把本地一次通过沿用为跨线结论。

## 6. 负控与检不出的变体

11 个故意改错的变体，每个都是一处局部错误。原生对照按 边界 → 定点 → 穷举 的顺序跑，命中即报出证人输入。

| 变体 | 说明 | 结果 |
| --- | --- | --- |
| `full_mask` | 掩码改成 `0xffffffff`，不清 bit 0x10 | 边界阶段第 17 组检出 |
| `truncated_plane` | 平面下标截成 32 位 | 边界阶段第 9 组检出 |
| `masked_plane_fallback` | 不命中折叠时退回掩码后的值 | 边界阶段第 33 组检出 |
| `swapped_plane_key` | 亮度／色度平面键对调 | 边界阶段第 1 组检出 |
| `metal_l008_r8unorm` | Metal `'L008'` 从 1 改成 10「顺手对齐」 | 边界阶段第 81 组检出 |
| `metal_accepts_2c08` | 让 Metal 也接受 `'2C08'` | 边界阶段第 33 组检出 |
| `metal_bgra_swapped` | Metal BGRA 通道顺序反转 | 边界阶段第 49 组检出 |
| `amg_bgra_follows_bgra` | 给 AMG 平面入口加上它没有的开关输出 | 边界阶段第 50 组检出 |
| `bgra_writes_flag` | `'BGRA'` 分支也写第四个出参 | 边界阶段第 49 组检出 |
| `reject_writes_defaults` | 拒绝路径写 0 而不是保留出参 | 边界阶段第 65 组检出 |
| `unsigned_pivot` | `'L007'` 枢轴改成无符号比较 | **检不出**：走完全部 17,179,869,184 组仍无证人 |

`unsigned_pivot` 检不出，必须单列：三棵树里被比较的每一个常量（含枢轴本身）都小于 2^31，高位置 1 的源值在有符号和无符号两种比较下都落到拒绝路径，输出完全相同。反汇编写的是 `b.le`（GLES/AMG）与 `b.gt`（Metal），本实现按有符号写，但**穷举 2^32 也证不了这一位**。默认 CTest 把这一点写成断言：`unsigned_pivot` 必须在全部固定语料上与交付实现完全相同，一旦变得可分离就说明这份说明需要改。

「不静音也没有输出」同样是负控的一部分：如果不静音的那 20,000 次拒绝写了 0 字节，对照程序会直接判定这个控制是空的并退出。

身份门禁本身也做了拒绝实测，记录在 `identity-gate.log`：相对路径、`liblens.dylib`、`libVECreator.dylib`、不存在的路径、缺参数和未知参数全部以退出码 2 拒绝，没有任何一次进入调用；六条错误信息分别是「路径必须绝对」「SHA-256 未知，拒绝私有 ABI」和「无法读取库文件」。

## 7. 明确不覆盖

- **滤镜逐 Pass 像素残差没有关闭。** 本批交付的是格式码到设备格式的整数映射合同，不是残差归因，也不是从 dylib 还原通用 GPU 算术。工作包 04 的残差子项不受影响。
- 只验证本机 arm64 切片（M4 Pro / macOS 26.6.2）。universal 里的 x86_64 切片、其他设备与系统没有验证。本单元是纯整数控制流，理论上与 GPU 无关，因此**不能**把它包装成又一个硬件 profile。
- 返回 true / 非零不等于设备能分配纹理。
- 第四个 GLES 出参（`0x4000` / `0x1000`）的语义没有恢复。
- `RenderTarget::Hash` @ `0x1098c` 与 `YUVConvertorInternal::getGPUBufferConvertType` @ `0x172d0` 的反汇编已存档在 `recon/`，本批**不做**：前者要 `DeviceTexture`/`TextureDescription`，后者要 `YUVRawBuffer`，手搓这些结构体触碰「不伪造 SDK 对象」的红线。后者与导出色彩空间那条线（601/709 标注）直接相关，是下一批的高价值目标。
- 本单元没有浮点输入或输出，全部是整数逐位比较；关于 NaN 分类、±0 和舍入的验收条款在这里没有对象，没有假装做过。
- 没有启动剪映 UI、没有修改剪映应用、用户草稿或任何运行中的服务。没有跑 QCut 全应用回归或逐帧 UI 比较。

## 8. 复现命令

```sh
AGFX_EVIDENCE=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/agfx/cv-plane
AGFX_BUILD=/tmp/claude-501/batch4-agfx/oracle
AGFX_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
cmake -S research/independent-agfx-contract -B "$AGFX_BUILD" \
  -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_NATIVE_ORACLE=ON
cmake --build "$AGFX_BUILD" --target agfx-cv-plane-native-oracle --parallel 8
DYLD_LIBRARY_PATH="$AGFX_FRAMEWORKS" "$AGFX_BUILD/agfx-cv-plane-native-oracle" \
  "$AGFX_FRAMEWORKS/libAGFX.dylib" --mutations > "$AGFX_EVIDENCE/differential-run-1.json"
```

默认（不加载厂商库）：

```sh
cmake -S research/independent-agfx-contract -B /tmp/qcut-agfx-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-agfx-contract --parallel 8
ctest --test-dir /tmp/qcut-agfx-contract --output-on-failure
```

全域独立复算（仍不加载厂商库，约 80 秒）加 `-DAGFX_CONTRACT_EXHAUSTIVE=ON`；ASan/UBSan 用 `-DCMAKE_BUILD_TYPE=Debug -DAGFX_CONTRACT_SANITIZERS=ON`。本轮的 `differential-run-1.json`、`differential-run-2.json`、`ctest-release.log`、`ctest-sanitizers.log`、`sweep-release.log` 和固定源码/证据 SHA-256 的 `verification.json` 都在 `$AGFX_EVIDENCE` 下。
