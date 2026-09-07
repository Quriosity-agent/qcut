# Lens：锚点、裁切端点与图像变换矩阵

日期：2026-09-07。接续 [后端分派研究](lens-warp-backends-2026-09-07.zh.md)。本轮独立源码位于 [independent-lens-contract](../../../research/independent-lens-contract/README.zh.md)。源码为本项目自行编写；厂商二进制、反汇编和原生输出均保存在私有证据目录。

本轮恢复一个实际用于 `FsNewAlignAlgo` 人脸检测流程的 CPU 几何单元：两对锚点生成缩放、平移及逆向矩阵；并恢复调用端把已处理矩形转换为锚点的规则。原创 C++ 与真实 `ImageTransform` 对象对照，363,684 个矩阵 float 逐位一致；随后调用该对象的 `warpImage`，1,324,512 个 RGBA 字节逐字节一致。这是有界矩阵与图像采样组合，不是完整人脸检测、VAS、防抖或模型算法。

## 身份和证据位置

固定本机 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`：

- 完整文件 SHA256：`8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf`。
- arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
- arm64 薄片 SHA256：`fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4`。
- 私有目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/lens-planning/`。
- `static-evidence.json` 记录每段 VM 范围、原始证据文件及 SHA256；`verification.json` 固定交付源码、文档和本轮验证结果。

诊断在 `dlopen` 前校验完整 SHA，在解析导出后校验加载映像 UUID；使用内部入口前，还校验构造函数导出地址是否恰为 image base + `0x3b23f4`。未知版本拒绝，未启动或注入剪映，未读取项目或加载人脸模型执行推理。

## 实际调用边界

静态观察到两处相同规则：

| 调用位置 | 已证实行为 |
| --- | --- |
| `FsNewAlignAlgo::FaceAlignmentDet`，`0x2d6028–0x2d60d8` | 给 `ImageTransform` 设置目标锚点 `(0,0,W-1,H-1)`，从矩形构造源锚点，调用 `computeTransformForResize` |
| `FsNewAlignAlgo::RecoverFromTrackingFailed`，`0x2da468–0x2da514` | 相同目标和源端点规则 |
| `ImageTransform::setCanonicalAnchors`，`0x3b2420–0x3b2538` | 将四个 float 按顺序写入 4×1 目标矩阵 |
| `updateXForResize`，`0x3b2c68–0x3b2dd4` | 由源两点设置 4×4 设计矩阵的左两列 |
| `computeTransformForResize`，`0x3b2dd4–0x3b30f4` | 选择方法 0 调用求解器，写入前、逆矩阵 |
| `ImageTransform::warpImage`，`0x3b30f4–0x3b3130` | 把对象的前向矩阵交给已验证像素入口 `0x28917c` |

两个父流程都先调用 `ProcessDetectionImage`，其矩形参数是可修改引用。本轮 `CropResizeRequest` 表示该步骤之后、传给矩阵生成之前的矩形；尚未恢复 `ProcessDetectionImage` 如何从初始矩形裁切、扩边、调整尺寸或重采样。因此没有把这条静态父流程描述为已经完整原生运行。原生像素验证直接使用真实 `ImageTransform` 的 setter、计算和 warp 方法，未伪造 `FsNewAlignAlgo`、运行配置或模型对象。

## 可直接实现的数值语义

源锚点是 `p=(x0,y0,x1,y1)`，目标锚点是 `q=(u0,v0,u1,v1)`。它们是两个点，不是 `xywh`。

设计矩阵和待解向量为：

```text
A = [x0  0  1  0]       b = [u0]
    [ 0 y0  0  1]           [v0]
    [x1  0  1  0]           [u1]
    [ 0 y1  0  1]           [v1]

A * [sx,sy,tx,ty]^T = b
forward = [sx,0,tx, 0,sy,ty]
```

所有矩阵和向量元素都是 float。数学上可以按端点差求比例，但厂商的实际浮点求解顺序不同。30,000 组锚点语料中，直接 float 闭式比例与平移公式在有效输出中产生 **73,580 个前向分量的位模式差异**；这个数不是像素误差，也不包含被拒绝的原生零解。

方法 0 的 float 路径从 `solve` 的 `0x200188–0x20019c` 转入 `0x23d2bc`，主体为 `0x23d2c0–0x23d55c`：

1. 按列向前消元。选择本列剩余行中绝对值最大的主元；仅 `>` 更新，因此相等时保留较早行。
2. 若主元绝对值 `< 0x1.4p-20F`，即 `10*FLT_EPSILON`，求解失败。等于阈值仍继续。阈值针对实际消元主元，不只是源点差或矩形宽度。
3. 交换该列起的剩余矩阵列，并交换右侧值。`reciprocal = float(1.0F / pivot)`；对后续行计算 `factor = float((-A[row][column]) * reciprocal)`。
4. 后续列和右侧值使用 float FMA：`A[row][j] = fma(A[column][j], factor, A[row][j])`，右侧相同。
5. 从最后一行回代。按递增列次序执行 `value = fma(-solution[j], A[row][j], value)`，最后 float 除以对角项。

写逆矩阵时没有再调用通用仿射求逆：

```text
ix = float(1.0 / double(sx))
iy = float(1.0 / double(sy))
inverse = [ix,0,float((-ix)*tx), 0,iy,float((-iy)*ty)]
```

显式 `std::fma` 保留融合运算，其余乘加编译时关闭自动收缩。源码不依赖 OpenCV 或厂商求解器。此处是恢复实际函数的计算顺序，并未宣称实现通用 LU 库。

裁切入口按实际调用者规则生成：

```text
source = [x, y, float(float(x+width)-1), float(float(y+height)-1)]
target = [0, 0, float(W-1), float(H-1)]
```

`W/H` 先做整数减一，再转 float。不能省略 `-1`，不能改成半像素偏移；对 float 加法先舍入再减一也属于契约。生成的正向矩阵可接入既有 `AffineWarpBackend::image_transform`；后者仍执行逆映射、分项量化、最近邻复制和四通道透明越界填充。

## 原生对象与独立拒绝策略

原生诊断分配有前后哨兵的 `0x1f0` 字节存储，调用真实导出构造函数。构造过程创建五个真实 Mat，偏移为 `0/0x60/0xc0/0x120/0x180`，尾部是四个标量；内存分配器中下一个对象的偏移也确认其长度。没有自行写入指针、矩阵头或对象字段。

析构使用父对象实际调用的内部完整析构入口 `0x340bf8`，其主体 `0x342994–0x3429f0` 按逆序析构五个 Mat。读取前、逆矩阵时先验证 type 5、2×3、12 字节行跨度；图像 Mat 也由真实构造、析构产生。输入锚点、像素、跨度填充和对象/缓冲区哨兵均核对。ASan/UBSan 作用于自有代码和诊断，厂商二进制本身未插桩，哨兵不能证明其所有内部访问。

原生 `computeTransformForResize` 忽略求解器失败返回值。在四个有界负例中，求解结果被置零，前向矩阵全零，逆矩阵比例为非有限值；诊断只读取矩阵，没有把它们送入原生 warp。这四例包括两个略低于阈值的主元，以及 `(1000000,1000001)` 和 `(-1000000,-999999)` 这样的窄坐标区间。后者几何跨度非零，仍因消元后的主元过小失败。

独立 API 要求 `FE_TONEAREST`、有限输入和中间值、非零缩放、有限逆矩阵；失败返回 `false` 且不改输出。裁切入口另外限制矩形宽高大于 1，目标两边 `2..8192`、总像素不超过 `16,777,216`，不自动裁到输入边界。一般锚点入口允许负缩放/反射。后续 warp 保留原先的跨度与 int32 量化安全边界。这些明确的拒绝属于独立接口策略，不宣称厂商也有同样的校验。

## 验证结果

| 检查 | 本轮结果 |
| --- | --- |
| Release / ASan+UBSan CTest | 各 6/6；新增测试 2,295 条断言 |
| 原生矩阵序列 | 30,000 组，其中 4 组零解拒绝；另加 5 组新对象/复用对象对照、306 组裁切计划 |
| 有效矩阵对照 | 30,307 组、363,684 个 float，逐位 0 差异 |
| 真实对象 RGBA 对照 | 306 组、1,324,512 字节，逐字节 0 差异 |
| 非全黑/透明输入 | 输出非零字节 856,347；非端点 alpha 像素 213,545 |
| CLI 与身份/参数负控 | Release 与 sanitizer 共 48 项通过 |
| 错误实现负控 | 移除消元 FMA、拒绝等于主元阈值、去掉裁切 `-1`，3/3 均被测试拒绝 |

矩阵测试包括交换主元、主元绝对值相等、反射、负坐标、随机非整数锚点、阈值两侧、较大偏移和窄区间。纯 C++ 测试固定 2,048 组语料的接受状态和完整前/逆矩阵原生位模式摘要，FNV-1a 为 `d5ea9f600f6bffff`。像素测试覆盖 7 个输入尺寸（含 1×1、7/8 宽边界、奇数 257×145）、紧密/带 7 字节填充的跨度、整数/半像素/分数裁切、不同目标尺寸及越界。RGBA 摘要为 `3fd6eb3fa6321db7`；BGR 是独立库派生输出，仅由自有测试校验，未称作 ImageTransform 原生 BGR 对照。

Release 和 sanitizer 的本轮原生 JSON 相同，文件为 `planning.final.json` / `planning.final.sanitized.json`。旧六原语、base 像素和两个后端的完整原生回归均重新运行，Release/sanitizer 输出与上一批摘要逐字相同：

- 六原语 JSON SHA256：`9d4839dc8e57aab391bc91f973673affeb58cf7cff717b511fa72bef4509aff6`。
- base 像素 JSON SHA256：`3637354221756317e985d605e2593be9badfff544421f7eb628b6b6d5408ca`。
- 两个后端 JSON SHA256：`90622f2658e664244525193da29253df3e0c0b540f5cc941291d99516b7fafd9`，保留上轮 445,886,267 字节的回归范围。

## 交付入口与下一处断口

| 文件 | 职责 |
| --- | --- |
| [transform_plan.hpp](../../../research/independent-lens-contract/transform_plan.hpp) / [transform_plan.cpp](../../../research/independent-lens-contract/transform_plan.cpp) | 锚点求解、裁切端点转换、接入现有 RGBA warp |
| [transform_plan_tests.cpp](../../../research/independent-lens-contract/transform_plan_tests.cpp) / [fixtures](../../../research/independent-lens-contract/transform_plan_fixtures.hpp) | 完整位模式摘要、几何/像素断言、原生语料和拒绝边界 |
| [native support](../../../research/independent-lens-contract/transform_plan_native_support.hpp) / [native oracle](../../../research/independent-lens-contract/transform_plan_native_oracle.cpp) | 身份固定的真实对象生命周期、矩阵和像素差分 |
| [README](../../../research/independent-lens-contract/README.zh.md) | 构建、CLI、API 和安全范围 |

`lens-contract resize-plan` / `crop-plan` 输出前、逆矩阵；`lens-image-warp W H OUT_W OUT_H --crop x y width height` 直接输出 RGBA。旧 CLI 参数形式和默认 `fsnew` 后端保持可用。

尚未完成：`ProcessDetectionImage` 的矩形修整与实际 resize、旋转/相似变换矩阵生成、`ImageTransformNewAlign` 的地标到对齐锚点、模型推理、`FsNewAlignAlgo` 整体状态和真实剪映 UI/视频管线追踪。没有证据把这些人脸几何单元计作 VAS 或完整效果算法链。
