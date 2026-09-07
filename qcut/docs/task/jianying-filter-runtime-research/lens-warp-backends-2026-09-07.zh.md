# Lens 图像 warp 后端分派与浮点边界还原（2026-09-07）

本轮在原独立 RGBA 仿射像素算法上，恢复了真实库内调用链、NEON 分派条件，以及 `ImageTransform` 与 `fsnew` 不同的浮点运算顺序。交付是可独立编译运行的 C++20 像素算法及测试；没有把防抖、人脸模型或整库包装器计作已恢复算法。

## 结果与范围

| 原生入口 | 本轮组合 | 对照字节 | 差异 | 独立实现 |
| --- | ---: | ---: | ---: | --- |
| `fsnew::neon::WarpAffineForRgbaCvtColor` 导出 | 10,998 | 283,721,319 RGBA+BGR | 0 | 复用已有 `fsnew` 坐标与像素核心 |
| `ImageTransform` / `NewAlign` 共用内部像素入口 | 10,998 | 162,126,468 RGBA | 0 | 显式 FMA 与平移顺序，共用像素核心 |
| 专门区分两个后端的固定矩阵 | 4 | 38,480 RGBA | 0 | 完整输出摘要固定为原生 golden |

本轮共对照 22,000 次调用、445,886,267 字节。`ImageTransform` 广域样本中有 60 组与 `fsnew` 结果不同；四个固定边界样本全部不同。两种后端不能在任意矩阵上无条件互换。NEON 与 `fsnew::base` 的相同结论限本轮矩阵、尺寸、布局与边界域，不是所有原生对象、输入格式及架构的等价证明。

原有六个数值原语 4,441 组、139,213 个值及 base 图像 3,892 组、161,540,260 字节重新运行，结果摘要保持原样。旧证明参见 [数值原语](lens-cpp-contract-2026-09-07.zh.md) 与 [base 图像采样](lens-image-warp-2026-09-07.zh.md)。

## 固定身份与静态入口

本轮重新读取 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`：

- 完整文件 SHA256：`8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf`。
- arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
- 私有 arm64 薄文件 SHA256：`fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4`。

以下都是该 arm64 镜像的 VM 地址。旧 Deflicker 记录中的另一 SHA 不适用于这些偏移。

| 入口 / 位置 | 本轮确认 |
| --- | --- |
| `PreProcessor::ProcessWarpImage`，`0x2ca600` | 四通道、像素格式枚举 0、布尔参数 true 选择 NEON；false 选择 `ImageTransformNewAlign` 再做颜色转换 |
| `0x2ca904` wrapper，调用点 `0x2ca938` | 直接调用 NEON 导出 `0x36a648`，这一条 wrapper 没有运行时 CPU 函数表选择 |
| `ImageTransform::warpImage`，`0x3b30f4` | `0x3b3120` 调用内部像素入口 `0x28917c` |
| `ImageTransformNewAlign::warpImage`，`0x3b3980` | `0x3b39ac` 调用同一内部像素入口 |
| `ImageTransformNewAlign::getTranformMatrix2WarpedImageRef`，`0x2ca8f0` | 返回对象起始处的矩阵引用 |
| `FsNewAlignAlgo::FaceAlignmentTracking`，调用点 `0x2d9448` | 传入源图、`InputParameter+0x18` 像素格式、对齐对象 `+0x11d8` 矩阵、目标尺寸及 `RunningConfigs+0xb` 布尔低位 |
| `FaceAlignmentTrackingOpt`，调用点 `0x2dc094` | 同样从 `RunningConfigs+0xb` 取分派布尔低位 |

普通人脸对齐入口的 prologue `0x2d84f4..0x2d8508` 保存各参数；配合 `0x2d940c..0x2d9448` 可以确认布尔来自 `RunningConfigs`，不是该函数末尾的另一个 bool 参数。尚未恢复这个字段的正式名称及产品配置取值。

这里追到的是人脸对齐预处理调用链。没有调用真实人脸模型，没有运行剪映 UI，也没有把这一链路当作 VAS 防抖的最终像素入口。其他像素格式分支和灰度/三通道输出仅静态看到，本轮独立 API 仍只接受 RGBA8。

## NEON 真分支与临时零像素

NEON 外层先按原 `fsnew` 顺序生成分离的行、列 int16 坐标，再根据 Mat 连续标志和临时零像素地址选择执行器。内部关键区间是 `0x36ab80..0x36aeac`；像素执行器 `0x3689d8..0x36a648` 将列 int16 符号扩展为 int32，再与行 int32 相加。它没有在相加之后再次窄化为 int16。

当源和目标都是由外部缓冲区构造的 Mat（`u == nullptr`）时，临时地址取矩阵数据的第一个 32 位字。源图连续，并且该地址与源像素起点的绝对字距离小于 `0x1fffffff`，才能进入向量执行器。函数暂存原字、写入零，处理图像，随后恢复该字。不连续或地址过远会走 base 标量回退。

因此，把旧 oracle 中的函数名换成 `neon` 并保留栈上矩阵，可能只验证到距离回退。本轮用一个自有 `vector<float>` 分配块，前部容纳对齐可写矩阵，后部通过字节视图放源像素；两者在同一分配块内。它避免修改剪映内存，也不需要伪造 Mat 字段。每组都通过真正的 Mat 构造函数检查连续位、外部所有权、矩阵距离、缓冲区指针与保护区。

另外两组布局分别是带 7 字节行填充、以及独立 mmap 页内的远地址矩阵。mmap 只使用地址提示，未使用 MAP_FIXED，分配完成后仍检查实际距离，不会替换已有映射。每个后端分别覆盖：

- 3,948 组满足连续与近地址条件，其中 3,008 组目标宽度至少 8，可运行向量块。
- 3,384 组因行跨度不连续而回退。
- 3,666 组连续源因矩阵距离而回退。

单行图像即使给定较大 stride，Mat 仍标记为连续，所以统计根据实际 Mat 标志计算。上述“分支”是静态控制流与每次调用时真实参数共同证明的分支条件，不是逐指令 PC trace。每次 native 返回后都逐字节核对源、行填充、保护区及矩阵恢复，并检查舍入模式仍为 `FE_TONEAREST`。没有声称所有浮点异常标志不变。

原生自有分配的 Mat 还存在选择源或目标末尾地址的分支；这里只做静态记录，没有构造原生分配器对象来验证它。独立 C++ 实现完全不需要这种临时写入，输入与矩阵可只读。

## ImageTransform 算法语义

图像矩阵仍是源到目标的 `[a,b,tx,c,d,ty]`，整数索引表示像素中心。内部入口 `0x28917c` 的矩阵求逆与坐标生成主要位于 `0x289250..0x2893d4`。最近邻复制、越界四通道零、分离行列量化、int16 窄化与 base 一致；区别集中在浮点求值顺序。

以下所有乘、减以及 FMA 的结果是 float32；`fma` 表示乘加只舍入一次。行列式先计算 `cross=b*c`，然后：

```text
det = fma(a, d, -cross)
r = float32(1.0 / float64(det))
u = d*r, v = b*(-r), w = c*(-r), z = a*r
columnX[x] = Q(fma(u, float32(x)-tx, -(v*ty)))
columnY[x] = Q(fma(w, float32(x)-tx, -(z*ty)))
rowX[y] = QS((float32(y)*1024)*v)
rowY[y] = QS((float32(y)*1024)*z)
sourceX = int32(columnX[x]) + int32(rowX[y])
sourceY = int32(columnY[x]) + int32(rowY[y])
```

`Q(t)=QS(float32(t*1024))`。`QS` 在 `FE_TONEAREST` 下 round-to-even，转有符号整数，加 512，右移 10 位后取低 16 位，再作为 int16 使用。独立实现用有界 int64 除法与显式低位转换表达负值，避免依赖旧标准的负数右移规则。原生 `lsr` 与后续截断的组合在此保留域与这一表达等价。

`fsnew` 则分别计算 `a*d-b*c`，提前算逆平移，再用 `u*x+inverseTx`；这些实数等价写法在 float32 量化边界可能选中不同像素。源码保持全局禁用隐式 FMA 收缩，仅在 `ImageTransform` 经证实的运算处显式调用 `std::fma`。

四个自产边界矩阵以十六进制浮点字面量存入 [边界样本](../../../research/independent-lens-contract/image_warp_backend_fixtures.hpp)，避免十进制再解析漂移。65×37 的确定性 RGBA 输入中，两后端分别有 4、20、48、68 个不同字节，首个不同字节偏移为 6004、3148、144、4968。四个 `ImageTransform` 原生输出连接后的 FNV-1a64 为 `2dc540dc66fd345e`，测试校验完整输出摘要。这个摘要是回归指纹，不是密码学完整性证明；证据文件完整性另用 SHA256。

## 自有接口与测试

[image_warp.hpp](../../../research/independent-lens-contract/image_warp.hpp) 在请求末尾增加 `AffineWarpBackend backend = fsnew`，旧三字段聚合初始化及 CLI 行为保持默认 base 语义。选择 `image_transform` 使用新计算顺序，未知枚举返回 false。核心 [image_warp.cpp](../../../research/independent-lens-contract/image_warp.cpp) 复用像素循环，没有复制第二套整图算法。

CLI 的十个位置参数之后可指定 `--backend fsnew` 或 `--backend image-transform`。RGBA 为两后端的直接对照输出；BGR 在 ImageTransform 模式是独立库按既有通道规则生成的便利输出，没有计入该入口的原生字节对照。默认库和 CLI 仅依赖标准库。

安全域沿用旧接口：RGBA8、单边 1..8192、总像素不超过 16,777,216、足够的 stride 与输入缓冲区、有限矩阵及中间值、非零行列式、有限且安全的 int32 量化范围、`FE_TONEAREST`。任一不满足时保留旧输出。检查逆平移有限性也沿用旧接口，可能主动拒绝原生某些额外可计算的大系数情形；没有宣称接受全部 native 输入域。原生零行列式使用零 reciprocal，独立接口明确拒绝。

Release 与 ASan/UBSan 的 CTest 均为 5/5；新增 [后端测试](../../../research/independent-lens-contract/image_warp_backend_tests.cpp) 有 8,027 项断言，原图像测试仍 857 项。覆盖完整原生边界 golden、不同宽度的整图像素、透明边缘与 straight alpha、BGR 通道、行填充、别名输入、非有限数、奇异矩阵、缓冲区不足、无效后端及不支持的舍入模式。命令行另验证旧 20 项，并补新后端参数与四组原生 golden，合计 31 项。

编译保持警告即错误与严格浮点，Sanitizer 编译/链接均带 `-fno-sanitize-recover=all`。原生厂商二进制本身没有重新插桩；ASan/UBSan 的通过只覆盖自有代码和诊断程序，不能作为厂商库全无越界的证明。

## 原生诊断与证据

[后端诊断](../../../research/independent-lens-contract/image_warp_backend_native_oracle.cpp) 通过 SHA256、已加载 UUID、导出锚点 VM 三重匹配后才调用固定内部入口。`neon` 是真实导出；`ImageTransform` 直接调用它们共用的内部 Mat 像素 helper，未伪造完整 ImageTransform、人脸算法或模型对象。Mat 均调用真实构造/析构。完整二进制、原始反汇编、日志及私有脚本均留在：

`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/lens-backends/`

关键证据为 `verification.json`、`identity.json`、`native-backends.final.json`、`native-backends.sanitized.json`、`native-old-image.json`、`native-old-six.json`、`ctest-release.log`、`ctest-sanitized.log`、`cli-release.json`、`cli-sanitized.json`。静态窗口对应 `preprocessor.txt`、`caller-align-prologue.txt`、`caller-align.txt`、`caller-align2.txt`、`image-transform.txt`、`image-transform-new.txt`、`transform-helper.txt`、`neon-pixels.txt`；各文件 SHA256 由私有 manifest 固定。

最初使用栈上矩阵构造远地址负控；ASan 的 fake-stack 分配使该指针靠近堆源，诊断程序按预期拒绝了不满足条件的夹具。修正仅将该夹具改为自有 mmap，未关闭 fake-stack 或降低 sanitizer 检测。最终重复 Release 与 sanitizer 运行的像素统计和摘要一致。未知库 SHA 的负控在 dlopen 前失败且 stdout 为空；把 base 算法错误用于 ImageTransform 边界样本的独立负控实际报出像素不同。仓库只增加自有 C++、测试和说明，不包含供应商库、原始反汇编、脚本、图片或 LUT。

未完成的是产品实际配置取值、原生自有 Mat 分配器路径、其他通道/像素格式、完整人脸矩阵生成、实际 VAS warp/crop 链路，以及 UI 或成片逐帧一致性。当前交付是经原生对照的两个像素后端语义与一条静态分派链。
