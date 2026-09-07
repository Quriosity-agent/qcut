# AGFX 显式 mip：Apple M4 的 LOD 与字节混合精度

日期：2026-09-08。新分支 `codex/jianying-binary-cpp-scaleup-20260908`，从 master `513a1c67d06fbdbb2a3b89bd27c6e37d3153eaf7` 开始。

本轮解释并关闭前次排除的 456,192 个 CPU mip 边界通道，新增独立 C++20 的 LOD 选择和 RGBA8 跨层幅值原语。正式原生矩阵对每路 98,390,896 个通道做 float 位比较，CPU profile 与实际 AGFX sampler 输出一致，独立 Metal sampler 与实际 AGFX sampler 输出也一致。这里恢复的是**固定 GPU 上实测的采样 profile**：格式和 setter 来自 AGFX 的既有静态分析，精度量化发生在硬件采样，不能称为从 dylib 反编译得到了这段 GPU C++，也不是任意 Metal 设备的通用保证。

## 代码与输入域

- [mip_sample.hpp](../../../research/independent-agfx-contract/mip_sample.hpp)：公开 API。
- [mip_sample.cpp](../../../research/independent-agfx-contract/mip_sample.cpp)：原创标准 C++ 实现；默认构建不加载厂商库。
- [mip_sample_tests.cpp](../../../research/independent-agfx-contract/mip_sample_tests.cpp)：边界、负控、全字节对算术及独立原生指纹。
- [agfx-mip-probe.mm](../../../research/jianying-runtime-probe/agfx-mip-probe.mm)、[原创夹具](../../../research/jianying-runtime-probe/agfx-mip-fixtures.hpp)：真实上传、sampler 与 Metal compute 差分。

`select_m4_mip` 接受有限 binary32 LOD、1–15 层与 none/nearest/linear 模式。`blend_m4_mip_texels` 接受两组 RGBA8 及 0–64 的整数权重，要求 `FE_TONEAREST`。未知模式、非有限 LOD、越界层数/权重或不符合要求的浮点环境主动拒绝；这是独立 API 的保护政策。

`sample_m4_mip_texture` 组合已有空间采样与新 LOD 选择，支持 RGBA/BGRA、标准逐层减半的 2D 链、最大边长 16384、w=0.5，验证所有层的尺寸、顺序、字节跨度和截断，包括未选中的层。其空间与跨层**幅值仍采用 float 参考**，没有调用精确字节域混合原语；因此不是任意坐标上的 GPU 逐位复刻。精确原语和这个近似组合 API 的保证分别验收。

## 从实测恢复的顺序

给定有限 LOD，先限制到 `[0,last_level]`，再按 binary16 的最近偶数舍入，随后向下截断到 `1/64` 层：

```text
units = floor(round_binary16(clamp(lod, 0, last_level)) * 64)
low = units / 64
fraction = units % 64
```

- none 恒取第0层。
- nearest 仅当 `fraction > 32` 才取上层；半层点取下层。
- linear 取 low 和 min(low+1,last)，权重为 fraction/64。

不能直接按原始 float 的小数部分判断半层。例如 0.51 仍取下层，0.515380859375 是第一个转向上层的 binary32 输入；1.51513671875 和 2.5146484375 也分别是对应边界。不同层级的阈值变化由 binary16 舍入解释。实现使用明确的 binary32 位操作完成这一受限域舍入，避免依赖编译器半精度扩展。

两层各取一个 RGBA8 纹素时，对每个通道的源字节 a、b 和权重 w：

```text
numerator = a * (64-w) + b*w
fixed_byte16 = (numerator + 2) / 4    # 整数除法
result = float(fixed_byte16) / 4080.0F
```

这是 byte/16 网格，半步向上，包括下降颜色对。例如 a=0、b=85、w=2，42.5 个 byte/16 单位舍入到43；不是一般的浮点线性插值，也不是最近偶数的幅值舍入。LOD 的舍入与颜色幅值的舍入是两套规则。

## 固定原生环境与独立验收

剪映 11.3.0，Apple M4 Pro，macOS 26.6.2 (25G83)，Apple Clang 21。`libAGFX.dylib` 的完整 SHA256 为 `4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa`，arm64 UUID 为 `408EB610-AD47-3846-9595-14B6A3ABF537`。沿用文件和实际加载镜像双重身份门禁，未知版本拒绝；原生诊断还检查 M4 设备名。其他 M4 型号和其他系统版本没有因此自动获得实测证明。

所有参考对象由真实 AGFX 上传/工厂/setter 创建；原创 Metal shader 显式传入 float LOD，未人为转 half。每次采样前完成上传，每个 compute command 等待完成并检查错误。原生 sampler 与独立 sampler 使用同一真实纹理和相同原创 shader，这一路证明 setter 参数；另外的标准 C++ 输出比较才证明所列精度 profile。

| 实验 | 输入与比较量 | 结果 |
| --- | --- | --- |
| 初步测量 | 四层常色、20,868 LOD ×3模式；250,416通道 | 位一致，仅用于提出模型 |
| 正式保留域 | 1–15层、RGBA/BGRA、2种空间filter×3种mip；16,078,044查询、64,312,176通道/路 | CPU与GPU两路各零差异 |
| 全字节对 | 65,536对×65权重×2格式×4通道；34,078,720通道/路 | CPU与GPU两路各零差异 |
| 原旧纹理矩阵扩展 | 5纹理×768sampler；3,732,480个GPU float4；7,464,960个CPU通道 | GPU位一致；CPU最大误差0.00012260675430297852，小于原有1/255门槛；mip排除数0 |
| 连续LOD错误模型 | 原始float直接选层/插值 | 16,518,392通道差异，被检出 |
| 未量化幅值错误模型 | 直接除16320 | 16,777,216通道差异，被检出 |
| 错误向下幅值舍入 | 分子直接除4 | 12,582,912通道差异，被检出 |

正式 LOD corpus 包含密集网格、所有正半精度舍入中点两侧的相邻 float、每个1/64边界邻居、固定种子的随机有限 float 位型、正负最大值、负零和极小值。各层使用一行纹理，最高16384×1，避免构造无必要的大方图。全字节对通过512×512与256×256两层布置，一次dispatch至多65,536点。两套数据和查询生成器均为原创，不携带原厂纹理资源。

常量层矩阵的原生 FNV-1a64 为 `c8eec4b94bfdf745`；全部字节对的原生指纹为 `9e65ecff738408a5`。后者进入无需 GPU 的可移植回归测试：按 RGBA/BGRA、weight、第二字节、第一字节、RGBA通道及每个float的LE字节顺序计算。期望值来自实际采样输出，不能在修改实现后自行重新生成期望。

## 复现与余项

```sh
AGFX_MIP_EVIDENCE=/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/agfx-mip
AGFX_MIP_FRAMEWORKS=/Applications/VideoFusion-macOS.app/Contents/Frameworks
cmake -S research/independent-agfx-contract -B "$AGFX_MIP_EVIDENCE/build-native" \
  -DCMAKE_BUILD_TYPE=Release -DAGFX_CONTRACT_NATIVE_PROBE=ON
cmake --build "$AGFX_MIP_EVIDENCE/build-native" --parallel 4
ctest --test-dir "$AGFX_MIP_EVIDENCE/build-native" --output-on-failure
DYLD_LIBRARY_PATH="$AGFX_MIP_FRAMEWORKS" "$AGFX_MIP_EVIDENCE/build-native/agfx-mip-probe" \
  "$AGFX_MIP_FRAMEWORKS/libAGFX.dylib" > "$AGFX_MIP_EVIDENCE/native.json"
```

原生 JSON、运行日志、构建和源码哈希全部在上述仓库外目录，统一验证见[本批记录](binary-cpp-scaleup-2026-09-08.zh.md)。前次7,008,768个CPU通道与456,192个排除项之和就是本次7,464,960；没有通过放宽旧容差或隐藏新差异来扩大覆盖。

完整工作包04仍未关闭：任意空间坐标的逐位幅值、mag/min切换、其他设备精度、真实滤镜各Pass残差、GPU/SIMD性能和多Pass图整合仍有工作。这里没有新的 UI/Preview/Export 对齐结论，没有把旧 D634 CGL 精度与本次安装版 Metal 混算。
