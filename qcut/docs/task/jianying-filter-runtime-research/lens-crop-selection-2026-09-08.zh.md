# Lens 已选检测框到连续目标裁切：CenterFocus / RectCropper

日期：2026-09-08，第二批。源码：[independent-lens-contract](../../../research/independent-lens-contract/README.zh.md)。

本轮将 `OnlineMove::CenterFocus` 和 `RectCropper` 的数值逻辑恢复成标准 C++20，接到已有 `RectSmoother`，并验证输出可接已有矩阵计划与 RGBA warp。独立库和 CLI 不加载厂商库、不需要模型。另一个可选诊断程序使用固定版本真实构造、初始化和方法作为 oracle。

这里的输入是**一个已经选好的像素检测框，或本帧没有检测框**。实际 `SmartMotionPipeline::preview` 将传入的 float 向量复制并送入 CenterFocus。本轮没有恢复多候选打分、检测模型、完整 VAS、Deflicker，也没有证明其产品下游实际使用本次组合测试的 warp 后端。

## 固定版本和实际调用

本轮再次读取 `/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`：

| 身份 | 值 |
| --- | --- |
| 通用库 SHA256 | `8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf` |
| arm64 UUID | `248872F2-7736-32A9-A48B-DC5DFEE20C99` |
| x86_64 UUID | `D4523AEB-6699-3937-B560-6BC53782ABB1` |
| 实际执行 | 本机 macOS arm64；x86_64 仅核对身份，未调用 |

下表地址是这一 arm64 映像的静态虚拟地址：

| 单元 | 地址 | 证据和本轮范围 |
| --- | --- | --- |
| CenterFocus C1 / C2 | `0xe99e4` / `0xe97dc` | 真实构造三个 vector 和两个 shared_ptr；诊断调用 C1 |
| CenterFocus Init | `0xe9a9c` | 初始化 bbox，真实工厂创建 Cropper 和 Smoother |
| CenterFocus Process | `0xe9e7c` | 非空检测、缺失检测、Cropper→Smoother 和返回四边界 |
| getZoomBBox | `0xea230` | 各边独立阈值跟随 |
| CenterFocus reset / D1 | `0xe9924` / `0xe9a70` | scalar reset，真实析构 vector/子对象 |
| RectCropper Init / Process | `0xe9dac` / `0xea5a0` | 尺度历史、覆盖扩张和整数裁切 |
| RectCropper C1 / reset / D1 | `0xeb308` / `0xeb29c` / `0xeb348` | 真实生命周期 |
| GetInfoArea | `0xeb374` | `[left,top,right,bottom]` → `[left,top,width,height]` |
| float / int clip | `0xeb3d4` / `0xeb458` | `min(max(value,lower),upper)`，保留反向区间行为 |
| SmartMotion init 调用 | `0x10f9c8` | CenterFocus 参数 `.5,.5,.8,width,height` |
| SmartMotion preview 调用 | `0x111a40` | 复制输入 vector 后调用 CenterFocus；输入没有在这里变成多候选表 |
| 产品下游尚未闭合 | `0x111a64` 调用 `MoveSys::MergeUtil` | 合并 CenterFocus 与模板运动结果；本轮未重实现此合并 |

CenterFocus 的真实 shared allocation 在 `0x117d1c` 使用 152 字节，元素地址 `+24`，`0x117de0` 调用 C1；故诊断提供 128 字节元素容量。RectCropper 对应 `0xecd18` 的 88 字节分配、`+24` 元素、`0xecddc` 的构造调用，提供 64 字节容量。这是分配中可用容量，不将其冒称未经验证的源代码 `sizeof`。

诊断在带 guards 的存储中调用真实 C1；CenterFocus Init 自行创建真实子对象。没有伪造虚表、shared_ptr 或 vector 指针，没有写入 SDK 对象字段。原生 `Process` 的按值参数和返回值都使用真实 Apple libc++ `std::vector<float>`；静态调用点确认输入复制/销毁和隐式返回缓冲区，运行时确认长度、源字节和 guards。读取状态仅用 `memcpy`，Smoother 字段解码与已有诊断共用。

RectCropper 的 C1/reset 会把尚未配置的 `configured_scale` 复制到 `previous_scale`。诊断在 C1 后立即调用真实 Init，后者设置 configured scale 和 previous scale=1，再进行任何状态比较或 Process。独立类给未初始化存储提供确定的安全默认值，不声称复现厂商构造前的不确定值。

私有静态证据目录：

`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch2/lens-crop-selection/`

`identity-and-static.json` 固定上述身份及各 `*.private.txt` 哈希。原始反汇编、厂商输出和二进制均不进入仓库。

## 完整数值顺序

接口：[crop_selection.hpp](../../../research/independent-lens-contract/crop_selection.hpp)；实现：[crop_selection.cpp](../../../research/independent-lens-contract/crop_selection.cpp)。除明确标出的 double 阈值外，以下浮点操作按 binary32 分步运算，关闭隐式 FMA 和 fast-math。所有 float→int 转换向零截断。

### CenterFocus 初始化、重初始化和 reset

配置为 `(anchor_x,anchor_y,scale,W,H)`。两个 anchor 字段被记录，但不会传给 RectCropper；实际裁切锚点固定为 `.5,.5`。本轮没有给它们赋予未观察到的可调取景功能。

首次 Init 将三个 vector resize 为四个元素，previous bbox 为：

```text
cx = float(W / 2)               # 先整数除法
cy = float(H / 2)
halfWidth  = (float(W) * scale) / 2.0F
halfHeight = (float(H) * scale) / 2.0F
previous = [cx-halfWidth, cy-halfHeight, cx+halfWidth, cy+halfHeight]
```

奇数图像不能把 `float(W/2)` 改成 `float(W)/2`。例如 `257×145,scale=.8` 的 previous 为 `[25.1999969482421875,14,230.8000030517578125,130]`。

每次 Init 都创建新的 Cropper 和 Smoother。**没有先 reset 的再次 Init 会保留 previous bbox**，包括改尺寸的情况；incoming/adjusted vector 也保留已有内容。reset 仅恢复标量配置和 initialized 标志，不清空三个 vector，也不 reset 子对象。随后 Init 因标志为 false 才重新生成 previous。独立接口在 reset 后要求再次 Init 才允许 Process，避免把原生的零尺寸路径带入安全 API。

### 有检测和缺失检测

输入非空时，从 `[left,top,right,bottom]` 得到 incoming。四条边分别执行：

```text
delta = incomingEdge - previousEdge
threshold = double(axisDimension) * 0.025
adjustment = double(abs(delta)) > threshold ? delta / 5.0F : delta
adjustedEdge = adjustment + previousEdge
```

阈值是存于 `0x48a720` 的 double 常量 `0.025`；x 用 W，y 用 H。判断严格大于。刚好 2.5% 时完整跟随，刚超过时只跟随五分之一，存在真实不连续点。小位移分支仍做 `delta+previous`，没有替换成直接复制 incoming；这是浮点顺序的一部分。

输入为空时，adjusted=previous，incoming 保留上次检测内容。仍然运行 Cropper 和 Smoother，不冻结输出。缺失检测使用的是先前调整后的检测 bbox，不能拿上次最终平滑输出作替代。

非空帧将 adjusted 送进 Cropper，`has_detection=1`，然后 previous=adjusted。空帧 `has_detection=0`，previous 不变。四边独立跟随在退化输入附近可能生成反向局部区间，底层数值 Cropper 因此保留有符号 extent，不偷偷排序四边。

### RectCropper 的尺度历史

Init 设置 configured scale，previous scale=1，是否允许检测扩张的布尔值。reset 把 previous scale 设回 configured scale，其他字段恢复默认，扩张开关恢复 true。

输入信息转换为 `left,top,width=right-left,height=bottom-top`。中心为 `left+width/2`、`top+height/2`。若允许扩张且 has_detection 为真：

```text
coverage = max((height*1.0F)/float(H), (width*1.0F)/float(W))
requested = max(coverage + 0.05F, requested)
scale = min(max(requested, previousScale - 0.05F), 1.0F)
cropWidth = scale * float(W)
cropHeight = scale * float(H)
```

否则跳过 coverage 两行。最后 previousScale=scale。放大没有对应的每帧上限；缩小最多为浮点表达式里的 `.05F`，不是对称平滑，也不是配置 scale 直接乘图像尺寸。

### 整数裁切和最终返回

x 轴按以下顺序，y 同理：

```text
ix = clip_int(trunc(centerX), trunc(cropWidth*.5F), trunc(float(W)-cropWidth*(1-.5F)))
left = float(ix)-cropWidth*.5F
left = float(clip_int(trunc(left), 0, trunc(informationLeft)))
right = left+cropWidth
```

clip 是 `min(max(value,lower),upper)`，当 lower>upper 时返回 upper。因此负数 informationLeft 会令最终 left 为负数；不能替换为要求合法区间的 `std::clamp`，也不能把结果统一夹到图像内部。保存的四条边分别截断为 int。

CenterFocus 把 Cropper 的 `[L,T,R-L,B-T]` 送进已有 RectSmoother，两个参数都为 `-1`，保留默认 `.7/.05`。返回向量是 `[float(x),float(y),float(x+width),float(y+height)]`。这是最终边界表示；连接 crop warp 时仍使用 Smoother 的 x/y/宽/高和已有包含末端像素的矩阵约定。详见 [上一批真实平滑器语义](lens-temporal-contract-2026-09-08.zh.md)。

## 独立输入域与限制

以下是本库主动限制，不能推断厂商也会拒绝：

| 接口/参数 | 当前合同 |
| --- | --- |
| CenterFocus Init | W/H 为 `16..8192`，scale 为 `.125..1`，两个存储 anchor 为 `0..1`；全部 float 有限 |
| CenterFocus Process | 已成功 Init；空输入或恰好四个有限 float，坐标 `-8192..8192`，输入满足 left≤right、top≤bottom；允许点/线退化 bbox |
| CropPlanner | 同尺寸/scale 域；四个有限坐标 `-8192..8192`；允许反向边界，保留有符号 extent |
| 浮点环境 | IEEE binary32、`FE_TONEAREST`；不接受其他舍入模式 |
| 失败行为 | false，配置、检测历史、Cropper、Smoother 和输出都不推进 |

在此域内，差值、覆盖率、中心和所有 float→int 值都有界，Cropper 尺度对应宽至少 2、高至少 2；整数边界差在 int32 内。组合中的 Smoother 另有真实的一侧边界限制，可能输出无效宽高；调用 warp 仍要满足其宽高大于 1、目标总像素上限等合同。组合测试选用满足该域的输出，不绕过拒绝。

原生 CenterFocus 仅检查 vector 是否为空，没有保护非空且少于四个元素。独立接口拒绝 1/2/3 个元素，不调用厂商危险读取；多于四个也明确不在本合同内。没有通过伪造模型结果的 SDK 对象来扩大输入语义。

## 验证与负控

原生工具：[crop_selection_native_oracle.cpp](../../../research/independent-lens-contract/crop_selection_native_oracle.cpp)；真实对象支持：[crop_selection_native_support.hpp](../../../research/independent-lens-contract/crop_selection_native_support.hpp)。

| 对照 | 规模 | 结果 |
| --- | --- | --- |
| 完整数值链 | 256 序列×256 帧 = 65,536 帧，含 9,472 个缺失检测帧 | 每帧 48 个 SDK 状态/输出值逐位一致，另核对接口就绪标志 |
| 生命周期 | 每序列第 128 帧无 reset 重初始化，第 192 帧 reset 后重初始化 | 保留/重建历史和新子对象均与原生一致 |
| 阈值和数值边界 | 56 个阈值帧 +24 个最大/最小尺寸、±8192 坐标、正负零、点/线退化帧 | 逐位一致 |
| 直接 RectCropper | 4,096 帧；检测开关、配置、reset、退化/反向/负坐标区间 | 13 个真实字段逐位一致 |
| 选择→平滑→矩阵→warp | 128 帧；64×48 和 257×145 输入，97×53 输出 | 2,632,192 RGBA 字节逐字节一致；输入/行填充/guards 不变 |
| 总数值字段 | 3,208,960 个 32 位字段 | 0 差异 |

完整 CenterFocus Process 调用合计 65,744 次：65,536 主矩阵 +80 边界 +128 组合；另有 4,096 次直接 Cropper Process。组合是实测的两端真实对象相接和独立算法相接，不是只比较配置或成功日志；它仍不证明完整 SmartMotion 产品输出，因为实际 preview 下游还有 MergeUtil。

首 16 组、4,096 帧的原生状态指纹 `f51cd5b3c664660a` 固定在可移植测试中。包含额外 CenterFocus 边界/组合的指纹是 `4be21af0aeba184a`；组合像素指纹 `a03e99d4caa0f06b`。直接 Cropper 的 4,096 帧单独逐位比较，不混入这两个 CenterFocus 指纹。

统计中另列 65,744 次由原生 initialized 标志推导的接口 ready 比较，它不是新增的 SDK 存储字段；包含这一列时总比较数为 3,274,704，SDK 数值比较数为 3,208,960。

七个在私有目录真正编译运行的错误变体全部被原测试拒绝：把 `>` 改 `>=`、五分之一改四分之一、拿输出当检测历史、重初始化总清 previous、去掉覆盖 margin、奇数尺寸改浮点除二、强制裁切起点非负。不是用测试跳过或宽容误差达到通过。未知库 SHA 和相对库路径的两项负控也在加载前拒绝，stdout 为空。

本机 Release 与 fail-closed ASan/UBSan **各 12/12 CTest 通过**；新增 C++ 测试 **4,197 个检查**，CLI 另有 3 组外部进程测试。两构建原生报告完全一致。`-Wconversion -Wsign-conversion -Werror` 检查通过；本轮新 head 的真实 Windows/远程 CI 由统一任务继续验收，本文不预先声称通过。

五个旧原生诊断全部复跑，JSON 与上一批保存结果一致：六原语、原 base 的 161,540,260 像素字节、两种后端、锚点/裁切矩阵，以及上一批时序平滑器。没有更改旧算法，只提取共用的只读 Smoother 状态解码，避免两份 ABI 字段表。

## CLI 与复跑

默认构建保持完全独立：

```sh
cmake -S research/independent-lens-contract -B /tmp/lens-selection -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/lens-selection -j4
ctest --test-dir /tmp/lens-selection --output-on-failure
/tmp/lens-selection/lens-crop-selection <<'EOF'
init 80 40 .8 .5 .5
missing
box 10 5 74 38
missing
reset
init 80 40 .8 .5 .5
missing
EOF
```

`init` 后五个数字顺序是 `width height scale anchor_x anchor_y`，`box` 后四个是像素边界。每条成功命令输出一行 JSON 并立即 flush；失败非零退出，保留此前成功输出。首个 missing 的输出 bounds 为 `[2,1,78,39]`。输出还包含调整后的检测框、平滑前目标矩形和实际尺度，便于消费者区分各阶段。

原生诊断须显式开启 `LENS_CONTRACT_NATIVE_ORACLE=ON`，仅在已固定的 macOS arm64 环境运行：

```sh
cmake -S research/independent-lens-contract -B /tmp/lens-selection-native -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/lens-selection-native -j4
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/lens-selection-native/lens-crop-selection-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

所有原生函数调用前检查库 SHA256 和已加载 Mach-O UUID，内部图像入口还检查固定符号锚点。未知身份拒绝。这里没有 app patch、注入、草稿读取或产品变更。

最终私有证据为本目录的 `native-final.json`、`native-san.json`、`old-regressions.json`、`negative-controls.json`、`verification.json`、`source-manifest.json`；Release/san 构建与 CTest 日志也在同目录。source manifest 固定原创源码和本文的 SHA256，不包含厂商资产。
