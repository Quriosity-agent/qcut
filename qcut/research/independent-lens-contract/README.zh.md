# 独立 Lens 数值与图像算法

这里是 QCut 自行编写的 C++20 库、命令行工具和测试。默认构建只依赖 C++ 标准库，不加载剪映、OpenCV、模型或 GPU 程序。当前恢复了 `liblens` 中 `LENS::ALGORITHM::MoveSys::Util` 的六个 CPU 数值原语、`fsnew` 的 RGBA 仿射图像采样与 BGR 转换，以及 `ImageTransform` 的另一种仿射坐标计算顺序。六个数值原语是 3×3 矩阵乘法、求逆、点旋转、刚性点变换、高斯核、轨迹高斯平滑。

这些单元有当前版本二进制静态证据和隔离进程的原生对照。新增像素单元在 3,892 组矩阵、尺寸和布局组合中，RGBA/BGR 共 161,540,260 字节逐字节一致；与原有点变换 `warp_points` 是不同接口。这里尚不提供完整 VAS 防抖、Deflicker、UMVFI、VMB 或成片导出，也未证明剪映当前界面选择这个 `base` 后端。

本轮新增 NEON 导出与 `ImageTransform` 内部像素入口原生对照，各 10,998 组；NEON 在已验证域复用原 `fsnew` 算法，`ImageTransform` 有 60 组结果与该算法不同。实际调用链追到人脸对齐的 `PreProcessor`，没有据此宣称完整防抖或剪映界面已经对齐。详细语义、身份、验证数字与未完成项见 [数值原语研究记录](../../docs/task/jianying-filter-runtime-research/lens-cpp-contract-2026-09-07.zh.md)、[图像仿射研究记录](../../docs/task/jianying-filter-runtime-research/lens-image-warp-2026-09-07.zh.md) 和 [后端分派与浮点边界](../../docs/task/jianying-filter-runtime-research/lens-warp-backends-2026-09-07.zh.md)。

## 构建与测试

从 QCut 包目录运行：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-independent-lens -j4
ctest --test-dir /tmp/qcut-independent-lens --output-on-failure
```

开启地址和未定义行为消毒器：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-asan -DLENS_CONTRACT_SANITIZERS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/qcut-independent-lens-asan -j4
ctest --test-dir /tmp/qcut-independent-lens-asan --output-on-failure
```

编译启用警告即错误，并关闭隐式浮点乘加收缩与 fast-math。`ImageTransform` 中经过原生验证的融合运算使用显式 `std::fma`，不能拆成普通乘加。Sanitizer 编译和链接使用 `-fno-sanitize-recover=all`，MSVC 请求这个未配置的组合时直接拒绝。源码保留独立 `pow`、`cosf`、`sinf` 调用；把它们改成乘法或合并 `sincos` 会破坏已测的逐位一致性。数值逐位对照目前只在 Apple Silicon/macOS 上验证；其他平台的 libm 舍入需要另外验收。

## CLI 数字输入

`lens-contract MODE` 从标准输入读取数字，成功时写出结果，失败时返回 `1` 并只向标准错误写原因。矩阵按行排列，角度单位是度；输入不允许多余内容。

| 模式 | 输入顺序 |
| --- | --- |
| `multiply` | 左矩阵 9 个 double，右矩阵 9 个 double |
| `inverse` | 矩阵 9 个 double |
| `kernel` | 长度、sigma |
| `smooth` | 奇数窗口长度、sigma、样本数、各 float 样本 |
| `rotate` | 角度、中心 x、中心 y、点数、各点 x/y |
| `warp` | 平移 x、平移 y、角度、缩放、点数、各点 x/y |

示例先从点 `(5,8)` 减去平移 `(2,3)`，再零角旋转和二倍缩放，输出 `(6,10)`：

```sh
/tmp/qcut-independent-lens/lens-contract warp <<'EOF'
2 3 0 2 1
5 8
EOF
```

## API 与安全域

[lens_contract.hpp](lens_contract.hpp) 定义公开接口；所有 API 失败都保留调用前的输出。输入/输出可引用相同的自有容器。

- 矩阵只接受有限数值；求逆拒绝零行列式和产生非有限结果的输入。
- 核长度 `1..4095`，sigma 必须为正，且中间平方值非零、有限。
- 平滑只接受奇数窗口；边缘重复最近端点，允许空输入或窗口宽于输入。
- 点集和轨迹最多 `1,048,576` 个样本，拒绝非有限输入或非有限结果。

这些拒绝规则是 QCut 的安全策略。原生求逆没有零行列式保护；原生偶数窗口平滑会走到核长度之外。我们保留安全域内的算法，不复现不安全读取。

## RGBA 图像仿射

[image_warp.hpp](image_warp.hpp) 的 `warp_affine_rgba` 接收带行跨度的 RGBA8 输入、按行排列的六个 float 正向仿射系数、目标宽高，返回紧密排列的 RGBA 和 BGR 两个缓冲区。算法先求逆，再分别量化行、列坐标，最近邻复制四个通道；越界像素四通道全零，BGR 输出交换红蓝并丢弃 alpha。它不做颜色空间转换或透明度合成。

CLI 只输出 RGBA8；标准输入必须恰好是 `W*H*4` 字节，标准输出不含文本。例如恒等变换：

```sh
/tmp/qcut-independent-lens/lens-image-warp 320 180 320 180 1 0 0 0 1 0 < input.rgba > output.rgba
```

`AffineWarpRequest.backend` 默认 `AffineWarpBackend::fsnew`，保留原调用行为。选择 `image_transform` 可重现该后端的显式 FMA 与平移运算顺序；CLI 对应在十个位置参数后添加 `--backend image-transform`，也可显式传 `--backend fsnew`。未知后端拒绝，不会回退。两种模式共享像素复制和 BGR 派生实现；`ImageTransform` 的原生对照直接验证 RGBA，BGR 是本库派生输出。

矩阵排列为 `[a,b,tx,c,d,ty]`，表示源到目标。对应的概念正向坐标是 `x'=a*x+b*y+tx`、`y'=c*x+d*y+ty`；实际采样须使用已恢复的分项舍入规则，不能替换成普通一次舍入或双线性采样。输入像素中心用整数索引表示。

图像 API 要求 `FE_TONEAREST`，单边 `1..8192`、总像素不超过 `16,777,216`，拒绝零行列式、非有限中间值、缓冲区不足和超出安全 int32 量化范围的坐标。返回 `false` 时保留原输出，允许输入引用原输出的 RGBA 容器。原生的有限零行列式分支会使用零逆矩阵；独立接口主动拒绝该输入。边界与依据见图像研究记录。

## 可选原生诊断

只有显式开启 `LENS_CONTRACT_NATIVE_ORACLE=ON` 才编译 [数值诊断](native_oracle.cpp)、[原 base 图像诊断](image_warp_native_oracle.cpp) 和 [后端诊断](image_warp_backend_native_oracle.cpp)。工具限 macOS arm64；共用 [身份校验](native_identity.hpp)，在装载前检查完整文件 SHA256，解析每个导出符号后检查已加载 Mach-O UUID，不匹配即退出。图像诊断调用真实 `Mat` 构造和析构，额外检查导出锚点地址后才使用固定版本的内部入口。[共享诊断支持](image_warp_native_support.hpp) 避免重复 Mat ABI 和旧图像样本。

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-native -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-independent-lens-native -j4
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-image-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-warp-backend-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

工具只在隔离进程中调用被固定身份验证的函数，不启动或注入剪映、不读取项目。原生依赖的诊断信息写入标准错误；JSON 验证统计写入标准输出。默认库与 CLI 都不会链接这个诊断工具，也不会包含私有运行库。
