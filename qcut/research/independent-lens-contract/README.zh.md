# 独立 Lens 数值算法

这里是 QCut 自行编写的 C++20 库、命令行工具和测试。默认构建只依赖 C++ 标准库，不加载剪映、OpenCV、模型或 GPU 程序。当前恢复的是 `liblens` 中 `LENS::ALGORITHM::MoveSys::Util` 的六个 CPU 数值原语：3×3 矩阵乘法、求逆、点旋转、刚性点变换、高斯核、轨迹高斯平滑。

它们有当前版本二进制静态证据和隔离进程的原生数值对照。这里尚不提供完整 VAS 防抖、Deflicker、UMVFI、VMB，也没有图像重采样器或成片导出。特别是点变换 `warp_points` 只处理坐标，不能把它当成像素 warp 已完成。

详细语义、身份、验证数字与未完成项见 [研究记录](../../docs/task/jianying-filter-runtime-research/lens-cpp-contract-2026-09-07.zh.md)。

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

编译启用警告即错误，并关闭浮点乘加收缩与 fast-math。Sanitizer 编译和链接使用 `-fno-sanitize-recover=all`，MSVC 请求这个未配置的组合时直接拒绝。源码保留独立 `pow`、`cosf`、`sinf` 调用；把它们改成乘法或合并 `sincos` 会破坏已测的逐位一致性。数值逐位对照目前只在 Apple Silicon/macOS 上验证；其他平台的 libm 舍入需要另外验收。

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

## 可选原生诊断

只有显式开启 `LENS_CONTRACT_NATIVE_ORACLE=ON` 才编译 [native_oracle.cpp](native_oracle.cpp)。该工具限 macOS arm64；在装载前检查完整文件 SHA256，解析每个导出符号后检查已加载 Mach-O UUID，不匹配即退出。

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-native -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-independent-lens-native -j4
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

工具只调用被固定身份验证的数值函数，不启动或注入剪映、不读取项目。原生依赖的诊断信息写入标准错误；JSON 验证统计写入标准输出。默认库与 CLI 都不会链接这个诊断工具，也不会包含私有运行库。
