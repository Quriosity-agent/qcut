# 独立 Lens 数值与图像算法

这里是 QCut 自行编写的 C++20 库、命令行工具和测试。默认构建只依赖 C++ 标准库，不加载剪映、OpenCV、模型或 GPU 程序。当前恢复了 `liblens` 中 `LENS::ALGORITHM::MoveSys::Util` 的六个 CPU 数值原语、`fsnew` 的 RGBA 仿射图像采样与 BGR 转换、`ImageTransform` 的另一种仿射坐标计算顺序，两对锚点和已处理裁切矩形到缩放矩阵的算法，以及 `OnlineMove::RectSmoother` 的连续帧裁切平滑。`CenterFocus` / `RectCropper` 将已选检测框或缺失检测送入真实的边界跟随、尺度规划和时序裁切链。第三批新增 `Move::Run` 的 border=11 运动约束核，限制像素空间的缩放、旋转和平移。六个数值原语是 3×3 矩阵乘法、求逆、点旋转、刚性点变换、高斯核、轨迹高斯平滑。

这些单元有当前版本二进制静态证据和隔离进程的原生对照。新增像素单元在 3,892 组矩阵、尺寸和布局组合中，RGBA/BGR 共 161,540,260 字节逐字节一致；与原有点变换 `warp_points` 是不同接口。这里尚不提供完整 VAS 防抖、Deflicker、UMVFI、VMB 或成片导出，也未证明剪映当前界面选择这个 `base` 后端。

上一批新增 NEON 导出与 `ImageTransform` 内部像素入口原生对照，各 10,998 组；NEON 在已验证域复用原 `fsnew` 算法，`ImageTransform` 有 60 组结果与该算法不同。实际调用链追到人脸对齐的 `PreProcessor`，没有据此宣称完整防抖或剪映界面已经对齐。详细语义、身份、验证数字与未完成项见 [数值原语研究记录](../../docs/task/jianying-filter-runtime-research/lens-cpp-contract-2026-09-07.zh.md)、[图像仿射研究记录](../../docs/task/jianying-filter-runtime-research/lens-image-warp-2026-09-07.zh.md) 和 [后端分派与浮点边界](../../docs/task/jianying-filter-runtime-research/lens-warp-backends-2026-09-07.zh.md)。

上一批恢复 `ImageTransform::computeTransformForResize` 的浮点主元求解和前、逆矩阵，静态核实 `FsNewAlignAlgo` 的包含末端像素的矩形端点。真实 `ImageTransform` 对象的构造、setter、计算、warp 与析构构成隔离原生对照：363,684 个矩阵 float、1,324,512 个 RGBA 字节零差异。`ProcessDetectionImage` 如何调整初始矩形和重采样尚未恢复；本轮输入是其处理后传给矩阵计算的矩形。见 [矩阵计划与裁切边界](../../docs/task/jianying-filter-runtime-research/lens-transform-planning-2026-09-07.zh.md)。

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
| `resize-plan` | 源点对 `x0 y0 x1 y1`，目标点对 `x0 y0 x1 y1`；输出正向、逆向矩阵各一行 |
| `crop-plan` | 已处理的矩形 `x y width height`，目标整数宽高；输出正向、逆向矩阵各一行 |

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

## 锚点与裁切矩阵

[transform_plan.hpp](transform_plan.hpp) 提供 `plan_anchor_resize`、`plan_crop_resize` 和 `warp_crop_rgba`。锚点是两个点，不是矩形宽高；裁切入口转换为 `(x,y,(x+width)-1,(y+height)-1)`，目标为 `(0,0,W-1,H-1)`。端点算术按 float 的先加后减顺序执行。求解中保留主元选择、阈值和显式 FMA，不能直接用两点差值相除取代。返回的矩阵按 `[sx,0,tx,0,sy,ty]` 排列。

锚点入口允许反射，要求 `FE_TONEAREST`、有限输入、所有主元绝对值至少为 `10*FLT_EPSILON`、有限中间值和可逆结果。裁切入口另外要求矩形宽高大于 1、目标两边 `2..8192` 且总像素不超过 `16,777,216`；负数坐标允许，未自动裁到输入边界。原生求解失败后仍生成非有限逆矩阵，独立接口返回 `false` 并保持输出。大坐标下的窄裁切也可能触发主元阈值，即使几何宽度非零。

`warp_crop_rgba` 使用已经验证的 `image_transform` 像素后端，继承其输入跨度、int32 量化边界和失败时保留输出的约束。CLI 可直接接收矩形；例如从 320×180 输入取 `(10,20)` 开始的 101×81 区域，输出 65×37：

```sh
/tmp/qcut-independent-lens/lens-image-warp 320 180 65 37 --crop 10 20 101 81 < input.rgba > crop.rgba
```

这验证的是可调用的矩阵生成与 RGBA warp 组合；没有执行依赖模型的整个 `FaceAlignmentDet`，也不代表 `ProcessDetectionImage` 的图像输出。

## 连续帧裁切平滑

[temporal_crop.hpp](temporal_crop.hpp) 的 `TemporalCropSmoother` 恢复 `OnlineMove::RectSmoother::Process/GetCrop/reset`。输入是每帧已选择的矩形，输出整数裁切矩形及内部浮点中心、宽度历史。默认历史上限为 `0.7F`，移动比例为 `0.05F`；两个输入参数只在同时非负时一起更新，任一为负则同时保留旧值。首帧直接保留输入矩形，后续按真实浮点与多次截断顺序更新。`reset()` 恢复初始状态。

这个单元有实际 `CenterFocus::Process` 调用点，属于在线取景平滑，不能等同于 VAS 或 Deflicker。原生边界助手存在“比较结果再比较宽高”的行为，宽高大于 1 时不会检查真正的矩形包含关系；本实现忠实保留。画外输入可能输出负宽高，接到 `warp_crop_rgba` 前必须满足后者的宽高大于 1 等约束。详见 [时序算法、原生证据和限制](../../docs/task/jianying-filter-runtime-research/lens-temporal-contract-2026-09-08.zh.md)。

`process()` 接受图像宽高 `1..32768`、矩形 x/y `-32768..32768`、宽 `2..32768`、高 `1..32768`；激活更新的两个参数都须在 `0..1`。所有参数必须有限，舍入模式须为 `FE_TONEAREST`。失败不改变状态。独立 `interpolate_temporal_crop` 的坐标/宽度/比例界限见头文件对应研究文档；它失败时也不改变输出。

`lens-temporal-crop` 是可持续输入的独立 CLI，每行八个数字，输出一行 JSON；`reset` 单独一行重置。每次成功输出立即 flush，不需要先关闭标准输入：

```sh
/tmp/qcut-independent-lens/lens-temporal-crop <<'EOF'
10 12 100 60 320 180 -1 -1
13 19 99 61 320 180 -1 -1
reset
10 12 100 60 320 180 -1 -1
EOF
```

顺序为 `x y width height frame_width frame_height history_limit motion_fraction`。第二帧输出矩形 `[10,13,98,60]`；内部历史保留小数。非法输入立即以非零状态结束，保留此前成功输出，不会输出成功帧占位。

2026-09-08 第一批本机 Release 和 fail-closed ASan/UBSan 均为 **9/9 CTest**（含可用 Python 时的三项 CLI 场景）；新增 C++ 检查 **36,926** 项。固定原生参考覆盖 65,536 连续帧、65,795 状态快照，以及 32,768 次裁切插值、3,600 次边界助手调用。128 帧“真实平滑器 → 已恢复矩阵 → 真实 warp”组合的 2,632,192 RGBA 字节也逐字节一致。组合验证没有证明 `CenterFocus` 产品下游实际选择该 warp 后端。本轮新 head 的 Windows 与远程 CI 状态另行验收。

## 已选检测框到连续目标裁切

[crop_selection.hpp](crop_selection.hpp) 提供 `CropPlanner` 和 `CenterFocus`。输入为空或四个像素边界 `[left,top,right,bottom]`；这里没有多候选打分或模型检测。`CenterFocus` 对各条边应用真实 2.5% 阈值，超过阈值只跟随五分之一，否则完整跟随，再用 `RectCropper` 的覆盖扩张、每帧最多 `.05F` 尺度缩小和整数裁切，交给已有 Smoother。缺失检测仍推进输出；无 reset 的再次 initialize 保留检测历史但重建两个子算法。`reset` 只恢复配置/标志，随后必须再次 initialize。

独立入口接受图像边长 `16..8192`、scale `.125..1`、有限 bbox 坐标 `-8192..8192`，CenterFocus 的非空 bbox 必须恰好四项且按左上/右下排列。两个 Init anchor 为 `0..1` 的存储字段，实际 Cropper 锚点固定 `.5,.5`，不把它们虚构为已接线的控制功能。拒绝非有限数、未知舍入模式、不完整向量和初始化前处理；失败保留所有阶段状态。底层 CropPlanner 允许反向区间，保留原生 min(max()) 与有符号范围行为。

`lens-crop-selection` 持续接受 `init width height scale anchor_x anchor_y`、`box left top right bottom`、`missing`、`reset`，每行立即输出 JSON。示例：

```sh
/tmp/qcut-independent-lens/lens-crop-selection <<'EOF'
init 80 40 .8 .5 .5
missing
box 10 5 74 38
missing
EOF
```

首个 missing 的 bounds 为 `[2,1,78,39]`。输出区分 adjusted detection、平滑前 planned rectangle、最终 bounds 和实际 scale。详细运算顺序和实际产品边界见 [CenterFocus / RectCropper 研究记录](../../docs/task/jianying-filter-runtime-research/lens-crop-selection-2026-09-08.zh.md)。

第二批本机 Release 与 fail-closed ASan/UBSan **各 12/12 CTest**，新增 C++ **4,197 个检查**及 3 组外部 CLI 测试。真实 C1/Init/Process 对照覆盖 65,536 主序列帧、80 边界帧、4,096 Cropper 帧和 128 次组合；**3,208,960 个状态字段、2,632,192 RGBA 字节零差异**。七个错误算法变体均被原测试拒绝，五个旧原生诊断结果保持一致。本轮 Windows/远程 CI 仍由新 head 的统一验收决定。组合没有恢复 SmartMotion preview 的下游 `MergeUtil`，不能因此宣称完整 VAS、Deflicker 或产品自动取景。

## 像素空间运动约束

[motion_constraint.hpp](motion_constraint.hpp) 的 `constrain_motion` 恢复 `MergeUtil` 实际使用的 `Move::Run` / border=11 完整分支。先把 scale 限制到 `[minimum_scale,1]`，围绕指定中心裁切包含末端像素的四角，再执行最多 30 轮增量旋转搜索，最后裁切平移。旋转和位移的旁路条件是绝对值不超过 `1e-5F`；面积不足一个像素时不做旋转/平移限制。两条平移边界先排序，保留原生的小幅负边界和最后候选返回行为，不能把输出强制修成理想几何。

参数为有限 float：宽高 `1..32768`、中心位于 `[0,width]×[0,height]`、minimum scale `.01..1`、输入 scale `-4..4`、角度 `-180..180` 度、两轴平移各不超过相应边长四倍；舍入模式必须为 `FE_TONEAREST`。输出可与输入引用同一对象；拒绝时保持输出。这里接受的是 `Rigid2Lock` **之后的像素参数**，不能直接把模板向量 `[scale,angle,tx,ty]` 当成这四个字段。

```sh
/tmp/qcut-independent-lens/lens-motion-constraint <<'EOF'
run 100 100 50 50 .2 100 -100 0 .5
EOF
```

输出 `{"translation":[24.5,-25],"degrees":0,"scale":0.5}`。每行字段为 `run width height center_x center_y minimum_scale tx ty degrees scale`；成功立即 flush，非法输入非零退出且不写成功占位。

第三批本机 Release 与 fail-closed ASan/UBSan **各 15/15 CTest**；新增 C++ **4,152 项检查**和三组 CLI 测试。249,411 次真实 Move 调用的 **997,644 个 float 输出逐 bit 零差异**，另 2,048 帧真实 CenterFocus 的 8,192 个 bbox 值一致后接约束核。两种构建的原生报告完全一致，六个旧原生诊断 JSON 保持不变。七个错误算法变体和两个身份负控被拒绝；删除一次单位缩放复裁的试验变体在当前矩阵未改变输出，不计入错误检出数。

详见 [运动约束与 MergeUtil 断点](../../docs/task/jianying-filter-runtime-research/lens-crop-merge-2026-09-08.zh.md)。本轮没有恢复 MergeUtil 两侧的坐标转换，也未安全配置 SettingInfo 后调用整个 MergeUtil；没有新增产品像素或 VAS/Deflicker 完整链声明。本轮远程 CI 按新 head 另行验收。

## 可选原生诊断

只有显式开启 `LENS_CONTRACT_NATIVE_ORACLE=ON` 才编译 [数值诊断](native_oracle.cpp)、[原 base 图像诊断](image_warp_native_oracle.cpp)、[后端诊断](image_warp_backend_native_oracle.cpp) 、[矩阵计划诊断](transform_plan_native_oracle.cpp) 、[连续帧诊断](temporal_crop_native_oracle.cpp)、[检测框裁切诊断](crop_selection_native_oracle.cpp) 和 [运动约束诊断](motion_constraint_native_oracle.cpp)。工具限 macOS arm64；共用 [身份校验](native_identity.hpp)，在装载前检查完整文件 SHA256，解析每个导出符号后检查已加载 Mach-O UUID，不匹配即退出。图像诊断调用真实 `Mat` 构造和析构，矩阵计划诊断还调用真实 `ImageTransform` 构造和析构；额外检查导出锚点地址后才使用固定版本的内部入口。[共享诊断支持](image_warp_native_support.hpp) 避免重复 Mat ABI 和旧图像样本。

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-native -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-independent-lens-native -j4
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-image-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-warp-backend-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-transform-plan-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-temporal-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-crop-selection-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-independent-lens-native/lens-motion-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

工具只在隔离进程中调用被固定身份验证的函数，不启动或注入剪映、不读取项目。原生依赖的诊断信息写入标准错误；JSON 验证统计写入标准输出。默认库与 CLI 都不会链接这个诊断工具，也不会包含私有运行库。
