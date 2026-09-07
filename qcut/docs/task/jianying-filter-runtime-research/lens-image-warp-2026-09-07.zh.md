# liblens：独立 RGBA 仿射像素算法（2026-09-07）

本轮从上一轮的六个数值原语推进到实际像素处理，新增独立 C++20 仿射采样器。已恢复并验证的是 `smash::module::fsnew::base::WarpAffineForRgbaCvtColor` 的 RGBA 最近邻采样和 BGR 转换：**3,892 组测试、161,540,260 个输出字节，独立实现与原生函数逐字节一致**。

该结论限定于当前固定的 `base` 后端与本文输入域。尚未证明剪映产品选择它；它不是 VAS 全流程，不增加“完整效果算法链”或“整库恢复”的计数。上一轮 `warp_points` 仍是单独的点集接口，不与本轮图像算法混计。

## 身份与入口

2026-09-07 复核当前安装的 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`：

| 项目 | 固定值 |
| --- | --- |
| 完整 universal 文件 SHA256 | `8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf` |
| arm64 UUID | `248872F2-7736-32A9-A48B-DC5DFEE20C99` |
| 私有 arm64 切片 SHA256 | `fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4` |
| 导出入口 VM | `0x2f4054` |
| 矩阵反转、坐标表与调度 | `0x2f40d8..0x2f4698`，末端地址不包含在内 |
| 像素访问器 | `base::TT_Affine_Invoker2::operator()`，`0x2f3c04..0x2f3d7c` |
| 整数舍入叶函数 | `0x2f4748..0x2f4770` |
| native Mat 构造 / 析构入口 | `0x220f0c` / `0x21e9ec` |

旧 Deflicker 记录中的其他 SHA/偏移不是本次入口。原生诊断在 `dlopen` 前检查完整文件 SHA，在解析导出后核对 Mach-O UUID，还核对导出锚点确实位于固定 VM 后才使用 Mat 内部入口。未知身份直接拒绝。

静态原始材料仅保存在私有目录：

`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/lens-next/`

其中 `static-evidence.json` 记录函数窗口 hash 和直接调用位置；四个关键窗口的 SHA256 如下：

| 窗口 | SHA256 |
| --- | --- |
| 导出 `0x2f4054..0x2f40d8` | `5baf8327a5b6d9bbb10e8ce16d31ce9a7fe85bb95f9c41d276ae7db4cab14383` |
| 坐标表 `0x2f40d8..0x2f4698` | `5e7d632f0f1243ce244166e2e35ef82a7231d7a870b35c7c855ba31d3fa00891` |
| 像素访问器 `0x2f3c04..0x2f3d7c` | `cc96e66db5099b14af2624f9b52f2341592002dee92c77891ac978251f6589ab` |
| 舍入叶函数 `0x2f4748..0x2f4770` | `435d384c072a55e6c0f109e0c6294f6d5f774a119d8a2de3a9e8dca7cb8fc79b` |

直接 `BL` 扫描发现导出在 `0x2f4084` 调用坐标表函数；导出本身未发现直接 `BL` 调用点。后者不能排除导出表、函数指针或其他库调用，也不能作为产品当前选择该后端的证据。

## 可直接指导实现的语义

输入图像为 RGBA8，四通道按原字节处理。输入矩阵是 2×3 float，按行排列：

```text
F = [a b tx
     c d ty]
```

它表示源到目标的正向变换。函数内部求逆，目标像素索引用整数 `x=0..W-1`、`y=0..H-1`；没有归一化 UV、Y 翻转或像素中心 `+0.5` 操作。正平移的原生测试把源 `(0,0)` 移到目标 `(tx,ty)`，缩放/剪切与矩阵窗口共同确认了方向和坐标约定。

### 1. float 仿射逆矩阵

普通运算保持 float 精度；仅计算倒数时先扩为 double，完成 `1/det` 后再窄回 float：

```text
det = float(a*d - b*c)
r   = float(1.0 / double(det))
A = d*r       B = b*(-r)
C = c*(-r)    D = a*r
TX = (-A)*tx - B*ty
TY = (-C)*tx - D*ty
```

对应静态窗口为 `0x2f4214..0x2f4320`。各乘法与加减分开执行，独立编译关闭 FMA 收缩和 fast-math。原生 `det==0` 分支把倒数置零；独立 API 拒绝零行列式，而不把这一退化输入算作有效的仿射变换。

### 2. 先分别量化列与行，再相加

定义 `Q(v)`：

1. float 计算 `v*1024`。
2. 按当前浮点舍入模式舍入到整数。已验证环境为 `FE_TONEAREST`，半整数 ties-to-even。
3. 加 `512`，算术右移 `10` 位，即对除以 `1024` 的结果向负无穷取整。
4. 写入 16 位，再作为有符号 16 位读取；保留这一窄化回绕。

坐标表为：

```text
columnX[x] = Q(A*float(x) + TX)
columnY[x] = Q(C*float(x) + TY)
rowX[y]    = Q(B*float(y))
rowY[y]    = Q(D*float(y))

sourceX = int(columnX[x]) + int(rowX[y])
sourceY = int(columnY[x]) + int(rowY[y])
```

列映射证据为 `0x2f43f8..0x2f447c`，行映射为 `0x2f4504..0x2f4578`。整数舍入叶函数使用 `frintx`，因此独立 API 在浮点环境不是 `FE_TONEAREST` 时拒绝执行。

这不是将完整坐标相加后舍入。例如正向矩阵 `[4,-1,0,0,1,0]` 的逆向 x 为 `0.25*x+0.25*y`：目标 `(2,2)` 的两个分量各舍入成 `1`，最终采样源 x=`2`；完整坐标一次舍入会得到 `1`。这一差异有原生像素与独立断言共同验证。

量化的半步也已测试：`511.5/1024` 先变成偶整数 `512`，再加偏置得到采样坐标 `1`；紧邻其下的 float 得到 `0`。负半步 `-512.5/1024` 舍入成 `-512`，最终为 `0`，紧邻其下则落到 `-1`。有符号 16 位的回绕同样真实存在：坐标项 `65536` 写入后读回为 `0`，`32768` 读回为 `-32768`。

### 3. 像素、边界与 BGR

目标 RGBA 先置零。仅当 `0<=sourceX<srcWidth` 且 `0<=sourceY<srcHeight` 时复制源的四个字节；输入行地址使用实际 `row_stride`。访问器 `0x2f3cd0..0x2f3d3c` 的无符号边界比较同时排除负数。

越界保留 `[0,0,0,0]`，不重复边缘、不插值。Alpha 为 `0` 或部分透明时，RGB 仍按原始字节复制；不预乘、不除 alpha、不与背景合成。之后输出 BGR 为 `[B,G,R]`，直接丢弃 alpha。外层在 `0x2f40b0..0x2f40b8` 以颜色转换码 `3` 调用内部转换；不对该数字跨版本推断，仅以本版本静态调用与像素颜色哨兵验证通道顺序。

## 独立源码与调用方式

源码位于 [research/independent-lens-contract](../../../research/independent-lens-contract/README.zh.md)：

| 文件 | 用途 |
| --- | --- |
| [image_warp.hpp](../../../research/independent-lens-contract/image_warp.hpp) | RGBA view、正向矩阵请求、双输出 API |
| [image_warp.cpp](../../../research/independent-lens-contract/image_warp.cpp) | 自产逆矩阵、量化、像素访问和通道转换 |
| [image_warp_tests.cpp](../../../research/independent-lens-contract/image_warp_tests.cpp) | 几何、精确量化、透明度、越界、拒绝与 alias 测试 |
| [image_warp_main.cpp](../../../research/independent-lens-contract/image_warp_main.cpp) | 独立原始 RGBA 命令行程序 |
| [image_warp_native_oracle.cpp](../../../research/independent-lens-contract/image_warp_native_oracle.cpp) | 可选的原生像素差分诊断 |
| [native_identity.hpp](../../../research/independent-lens-contract/native_identity.hpp) | 数值/像素诊断共用的 SHA、UUID 和锚点验证 |

从 QCut 包目录构建：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-lens-image -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-lens-image -j4
ctest --test-dir /tmp/qcut-lens-image --output-on-failure
/tmp/qcut-lens-image/lens-image-warp 320 180 320 180 1 0 0 0 1 0 < input.rgba > output.rgba
```

CLI 输入仅接受紧密排列的 RGBA，要求字节数完全匹配，拒绝短输入或尾随字节；输出仅含 RGBA 字节。Windows 下切换 stdin/stdout 为 binary 模式。BGR 输出通过库 API 获得。默认构建不加载剪映，已检查可执行文件仅依赖 `libc++` 和 `libSystem`。

所有 API 返回 `false` 时保留原输出；允许输入引用原输出的 RGBA 缓冲区。尺寸域为单边 `1..8192`、总像素至多 `16,777,216`。拒绝非有限系数/中间值、零行列式、缓冲区不足、行跨度无效和超出安全 int32 量化域的值。这些是 QCut 安全边界，不能声称原生库也会拒绝相同输入。

本轮没有接入 QCut 预览、导出或视频流；命令行只处理一帧原始像素。

## 原生诊断方式与结果

原生参考是完整导出函数，而不是调用独立实现生成期望值。诊断使用已恢复签名的真实 `mobilecv2::Mat` 构造、析构和 96 字节存储；不填造 VAS/Qt 对象。每次调用检查 Mat 前后 guard、RGBA/BGR 缓冲区 guard、输出存储未重分配、源图/行 padding/输入矩阵未改变。默认库与 CLI 均不依赖此诊断。

278 个矩阵夹具包含恒等、正负平移、镜像、90 度旋转、缩放、split-round 剪切、量化边界相邻 float、有符号 16 位窄化边界，以及确定性生成的 240 个非退化仿射矩阵。七个源尺寸是 `1×1`、`2×3`、`7×5`、`17×9`、`31×33`、`65×37`、`257×145`；每种同时测试 packed 与每行额外 7 字节 padding。输出尺寸还按矩阵序号变化，包含与源宽高不同的情况。

| 验证 | 结果 |
| --- | --- |
| 单次原生像素差分 | 3,892 cases；161,540,260 字节；差异 0 |
| 非零输出字节 | 35,088,427，排除全黑输出假通过 |
| 部分透明 RGBA 像素 | 4,994,464 |
| 整体输出 FNV-1a 64 | `29b16d3c8de4c21c` |
| 两次独立 Release 进程 + 一次 ASan/UBSan 进程 | 三份结果 JSON 完全相同 |
| 结果 JSON SHA256 | `3637354221756317e985d605e2593be9badfff544421f7eb628b6b6b6d5408ca` |
| 独立像素断言 | 857 项通过 |
| Release / Debug ASan+UBSan CTest | 各 4/4 通过 |
| 图像 CLI | 两种构建各 20 项通过，含 3 个有效像素输出及 17 个拒绝输入 |
| 原有六原语回归 | 4,441 cases / 139,213 数值仍逐位相同，结果 JSON 与上一轮完全相同 |
| 未知库身份 | 在 native 调用前拒绝；标准输出为空 |

Sanitizer 的编译和链接均包含 `-fno-sanitize-recover=all`，运行设置 `ASAN_OPTIONS=halt_on_error=1`、`UBSAN_OPTIONS=halt_on_error=1`；未配置的 MSVC 组合会在 CMake 配置时失败。厂商二进制本身没有被 sanitizer 重编译；原生缓冲区检查与自有代码 sanitizer 不能扩展成厂商内部内存安全证明。

私有证据包括 `native-image.run1.json`、`native-image.run2.json`、`native-image.sanitized.json`、`native-six.run1.json`、`native-six.sanitized.json`、`ctest-sanitized.log`、`cli-release.json`、`cli-sanitized.json`、`standalone-image-dependencies.txt`、`verification.json`。仓库只保留自产源码、测试和语义说明；原始二进制、反汇编、构建产物、输出和 fixture 不进入仓库。

## 尚未完成的断口

- `fsnew::neon::WarpAffineForRgbaCvtColor`、`ImageTransform` 和 VAS `GlobalAlign::WarpImage` 是不同入口，本轮没有把它们的行为等同于已测 `base` 后端。
- 未恢复 VAS 的运动估计、网格生成、轨迹到 crop 的实际策略、画面尺寸/方向转换和时序缓存；没有完整 VAS 像素对照。
- 模型相关 Deflicker/UMVFI/VMB 的权重、图和推理流程未因本轮完成而解除阻塞。
- Windows/Linux 仅提供可移植的独立 C++ 与 binary CLI；本轮原生逐字节证据属于 Apple Silicon/macOS。其他架构的 float 与厂商实现需要单独验收。

本轮计为 **1 个新增、有原生像素证据的图像算法单元**，与已有六个数值原语并列。完整 liblens 恢复、完整 VAS/Deflicker 和新增完整效果链仍不计完成。
