# Lens 连续帧裁切平滑：OnlineMove RectSmoother

日期：2026-09-08。实现目录：[independent-lens-contract](../../../research/independent-lens-contract/README.zh.md)。

本轮恢复 `LENS::ALGORITHM::OnlineMove::RectSmoother` 的首帧初始化、连续帧更新、裁切插值和 reset，提供原创 C++20 库与持续输入 CLI。实际调用点在 `CenterFocus::Process`。这是已选矩形的在线取景平滑，**不是完整 VAS 防抖或 Deflicker 去闪烁**，也没有恢复检测器如何选出输入矩形。

独立算法默认构建不链接厂商库。另一个可选诊断程序调用固定版本的真实构造函数、方法和析构函数，在隔离进程内比较状态、插值和组合后的像素。没有启动、修改或注入剪映，也没有修改草稿、伪造虚表或填造 SDK 对象字段。

## 本轮选型依据

优先检查了当前 `VideoDeflicker::process_diff`（`0x4362e4..0x43664c`）：该段调用 Metal box filter、blend、scale、纹理复制和转换；没有在这段恢复到可独立运行的 CPU 去闪烁数值核。这里不能以重写调度层作为“独立去闪烁算法”。

另定位到 VAS 的 `applyAlphaV2`，但它读取真实 pipeline 的配置成员；本轮没有闭合该对象的实际配置和上游轨迹来源。没有用猜测对象内存来执行此路径。

最终选择的是具有真实调用点、完整无资源构造/reset、可闭合连续帧状态的 `RectSmoother`。它与上一批 `ImageTransform` 锚点/crop/warp 算法不同：本轮引入帧历史、参数更新和运动量控制，复用上一批像素重采样验证输出组合。

## 固定身份与静态入口

安装路径：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`。本轮重新读取文件 SHA256 和 Mach-O UUID，均与上一批一致：

| 项目 | 值 |
| --- | --- |
| 完整通用库 SHA256 | `8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf` |
| arm64 UUID | `248872F2-7736-32A9-A48B-DC5DFEE20C99` |
| x86_64 UUID | `D4523AEB-6699-3937-B560-6BC53782ABB1` |
| 原生运行域 | 本机 macOS / arm64；不调用 x86_64 代码 |

以下地址为固定 arm64 映像的静态虚拟地址，不能直接用于其他版本：

| 入口 | 地址/定位 | 本轮证据 |
| --- | --- | --- |
| `RectSmoother::Process` | `0xea8d0..0xeae14` | 连续帧完整状态更新；真实原生对照 |
| C1 构造 | `0xeaf38`，调用 C2 `0xeaea4` | C2 直接调用 reset；诊断实际调用 C1 |
| `reset` | `0xeaed0..0xeaf38` | 默认参数、历史、首帧标志、计数、输出清零 |
| D1 析构 | `0xeaf78` | 实际调用；不需要伪造控制块 |
| `GetCrop` | `0xeafa4..0xeb114` | 权重插值、整数截断、输出四边界 |
| 内部边界助手 | `0xeb114..0xeb1ec` | 比较结果再比较宽高；固定符号锚点校验后调用 |
| 实际调用者 | `CenterFocus::Process` 的 `0xea048` | 从 `RectCropper` 得到 x/y/宽/高，传入图像尺寸，参数为 `-1,-1` |
| 真实 shared allocation | `0xed834` 分配总计 80 字节；`0xed69c` 元素地址为 `+24`；`0xed8f0` 调 C1 | 为真实元素保留 56 字节容量；构造/处理写入的已识别字段到 `+0x33` |

诊断在带前后 guards 的 56 字节容量中调用真实 C1；只以 `memcpy` 读取已识别字段，不把自制类布局传给厂商方法。析构也调用真实 D1。56 是真实分配中元素可用容量，不把它冒称未经确认的 C++ `sizeof`。GetCrop 不依赖或改变历史字段；诊断另外比较调用前后整个对象存储。

私有反汇编、identity 和哈希列表放在：

`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/lens-temporal/identity-and-static.json`

该目录的 `rect-smoother.private.txt`、`center-focus-caller.private.txt`、`shared-allocation.private.txt` 和 `deflicker-diff.private.txt` 是原始静态证据，不进入仓库。仓库仅保存本说明、原创算法、采集程序和自产样本定义。

## 可直接实现的连续帧语义

公开接口：[temporal_crop.hpp](../../../research/independent-lens-contract/temporal_crop.hpp)；算法：[temporal_crop.cpp](../../../research/independent-lens-contract/temporal_crop.cpp)。所有以下算术按 binary32 分步骤运算，关闭隐式 FMA 和 fast-math。

### 状态、参数与首帧

状态包含：当前图像宽高；`history_limit=0.7F`；`motion_fraction=0.05F`；历史中心 `cx,cy`；历史水平跨度 `extent`；首帧标志；32 位已处理帧数；整数输出矩形。

一次输入为 `(x,y,width,height,frame_width,frame_height,history_limit,motion_fraction)`：

1. **两个参数只有同时非负才一起更新**。任一为负，两个存储值都保留。不是每个参数分别更新。非负包括负零。
2. 原生先按 int32 计算 `right=x+width-1`、`bottom=y+height-1`，再转 float。
3. 中心为 `(float(x)+float(right))/2` 和对应的 y 公式。水平跨度是 `float(right)-float(x)`；比例为垂直跨度除水平跨度。
4. 首帧把这些带小数的中心、跨度写入历史，帧数加一，输出**原输入矩形**。没有裁到图像范围，也没有减一后的输出宽高。
5. reset 恢复全部默认状态。帧数在原生用 32 位加法，独立实现用无符号计数保留回绕位语义；本轮未运行四十多亿帧来动态验证计数回绕。

### GetCrop 的截断顺序

对当前和历史中心及水平跨度，调用者先分别转 int32，向零截断。给定历史权重 `a`，GetCrop 对 x/y/跨度分别计算：

`p = float(previous) * a + (1.0F - a) * float(current)`

其中两次乘法和一次加法分别舍入；随后再次向零转 int32。得到整数中心 `ix,iy` 和跨度 `iw` 后：

- `vertical_extent = current_aspect_ratio * float(iw)`。
- `left = float(ix - iw/2)`；此处 `iw/2` 是**整数除法**。
- `right = left + float(iw)`。
- `top = float(trunc_int32(float(iy) - vertical_extent/2.0F))`。
- `bottom = top + vertical_extent`。

这不是对四条矩形边直接插值。把中心保持为 float 到最后、合并 FMA、给上下都做同一种整数除法，都会改变结果。

### 20 次二分与实际边界异常

非首帧从 `lower=0, upper=1` 开始，最多 20 次，候选权重为 `float(double(lower+upper)/2)`；加法先按 float 完成。GetCrop 生成候选四边界，再交给内部边界助手，成功则更新 lower，失败则更新 upper。

**边界助手没有实现通常理解的矩形包含检查。** 每条边实际做：

`int32(-1.0F <= edge) < corresponding_dimension`

四项再做逻辑与。因此宽高都大于 1 时，无论矩形是否在图像内，均通过。有限安全域内，20 次后 lower 为 `1-2^-20`。图像边长为 1 时才会出现不同布尔结果。独立实现显式保留此运算，命名为 `observed_crop_constraint`，没有把它修成理想几何算法。

3,600 个真实助手调用覆盖 `-1/0/1/2/普通宽高`、边缘前后、画外值、无穷和 quiet NaN。它与普通非负且不超界的矩形检查有 **769** 个不同结果。quiet NaN 只用于这个不做像素访问的比较助手；连续帧 API 拒绝非有限输入。

### 最终历史权重与输出

记 `d=abs(current_cx-previous_cx)+1.0F`，有：

```text
motion_budget = motion_fraction * float(min(frame_width, frame_height))
update_weight = min(motion_budget / d, 1.0F)
a = max(min(lower, history_limit), 1.0F - update_weight)
```

运动距离只取**水平中心变化**，不是二维欧氏距离。`motion_fraction=0` 会锁定浮点历史；本帧的纵横比例仍可改变最终矩形。

再次用 GetCrop 得到四边界，分别执行 `left=max(left,0)`、`top=max(top,0)`、`right=min(right,frame_width)`、`bottom=min(bottom,frame_height)`。这是一侧限制，**没有**保证 right 不小于 left、bottom 不小于 top。输出 x/y 和两条边的差再向零转 int32。

历史中心和跨度另外使用未截断的当前/历史 float 按同一权重更新，保持小数；它们不是从整数输出矩形反推出来。重复同一输入也没有身份快捷分支。例如 `(10,12,100,60)` 的首帧保持原矩形，第二次同输入输出 `[10,11,99,59]`，历史跨度仍为 `99.0F`。

## 独立安全域和产品边界

这些限制是独立实现主动声明的安全域，不声称厂商具有相同拒绝策略：

| API | 接受域 |
| --- | --- |
| `TemporalCropSmoother::process` | 图像宽高 `1..32768`；矩形 x/y `-32768..32768`；宽 `2..32768`；高 `1..32768` |
| 参数更新 | 两参数有限；同时非负时都在 `0..1`，否则同时保留旧值 |
| 独立 `interpolate_temporal_crop` | 权重 `0..1`；当前/旧中心 `-65536..65536`；当前/旧跨度 `0..32768`；比例 `0..32768`，浮点参数均有限 |
| 浮点环境 | IEEE binary32，`FE_TONEAREST`，不启用 fast-math/隐式融合 |
| 失败行为 | 返回 false；原状态或输出保持不变 |

最大垂直跨度不超过 `32768*32768=2^30`，加减中心和除二仍在 int32 安全范围内；输入端点相加也在 int32 内。这样不需要模拟原生非有限/溢出 `FCVTZS`，也不会把不安全 float→int 转换带入可移植 C++。

画外矩形允许作为时序输入，测试中有 **33,088** 帧输出负宽或负高。调用者应按下游像素 API 的要求拒绝这些结果，不能把它们当有效裁切。已存在的 `warp_crop_rgba` 要求裁切宽高大于 1，会拒绝该情况。这个库没有提供基于检测器或实际项目的视频自动取景产品适配。

## 原生差分与负控

实现：[temporal_crop_native_oracle.cpp](../../../research/independent-lens-contract/temporal_crop_native_oracle.cpp)；真实对象支持：[temporal_crop_native_support.hpp](../../../research/independent-lens-contract/temporal_crop_native_support.hpp)。

| 验证 | 规模 | 结果 |
| --- | --- | --- |
| 连续序列 | 256 组 × 256 帧 = 65,536 帧 | 每帧 13 个已识别状态字段逐位一致 |
| 含构造、reset、重放终态的状态比较 | 65,795 快照；855,335 个 32 位字段 | 0 差异 |
| 裁切插值 | 32,768 次；131,072 个 float | 0 差异；对象存储不变 |
| 原生边界助手 | 3,600 次 | 0 差异；错误几何替代负控 769 次不同 |
| reset 重放 | 重用对象 reset 后 64 帧，对比新对象同序列 | 终态逐位相同 |
| 时序输出 → 锚点矩阵 → RGBA warp 组合 | 128 帧；2,632,192 RGBA 字节 | 逐字节一致，源数据/行填充/guards 不变 |

Native `Process` 总调用数为 **65,792**：主矩阵 65,536 + reset/新对象重放 128 + 像素组合 128。像素组合的 128 份额外状态也逐位比较，但不混入主状态快照指纹。组合复用真实 `ImageTransform` 和 `Mat` 构造/方法；它证明这些已恢复单元可连接并与相同原生组合一致，**没有证明 CenterFocus 的产品下游实际选择了这个 warp 后端**。

首 16 组 4,096 帧及 reset/构造状态的 native FNV-1a64 指纹为 `fdf6f80b5071677a`，进入可移植测试；插值矩阵指纹为 `3cd3c49e4cf689aa`。不是把完整算法表复制到测试。另有明确的首帧、第二帧、重复输入、参数保留、横纵跳变、历史冻结、画外和舍入模式断言。

五个真正编译后的错误变体全部被原测试拒绝：理想几何包含、二维运动距离、排除端点、两个参数分别更新、无运动预算的普通 EMA。另有未知库 SHA 和相对库路径两个诊断负控，均在加载前失败、标准输出为空。详情在私有 `negative-controls.json`。

## 本轮验证状态与复跑

本机 Release、fail-closed ASan/UBSan **各 9/9 CTest 通过**；新增核心测试 36,926 项，CLI Python 测试 3 项。两种构建的新原生 JSON 完全一致。额外 `-Wconversion -Wsign-conversion -Werror` 语法检查通过；这不是 Windows 实际编译的替代证据，新 head 的远程 CI 仍须统一验收。

四个旧原生诊断全部重跑通过：六数值原语；原 base warp 的 3,892 组 / 161,540,260 字节；NEON 与 ImageTransform 后端各 10,998 组；既有矩阵计划的 363,684 个 float 与 1,324,512 RGBA 字节。旧单元没有用本轮新增算法替代。

从 QCut 包目录运行：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-lens-temporal -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-lens-temporal -j4
ctest --test-dir /tmp/qcut-lens-temporal --output-on-failure
/tmp/qcut-lens-temporal/lens-temporal-crop <<'INPUT'
10 12 100 60 320 180 -1 -1
13 19 99 61 320 180 -1 -1
reset
10 12 100 60 320 180 -1 -1
INPUT
```

每行八数字；成功立即输出 JSON，`reset` 独占一行。非法行非零退出，不输出占位帧。CLI 测试在 stdin 尚未 EOF 时实际读到已 flush 的一行，并验证进程仍活着。

可选原生诊断必须在有固定版本库的 macOS arm64 上运行：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-lens-temporal-native -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-lens-temporal-native -j4
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-lens-temporal-native/lens-temporal-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib > native.json
```

完整证据根目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/lens-temporal/`。

- `native-final.json`、`native-san.json`：正式两构建结果。
- `ctest-release-final.log`、`ctest-san.log`：本机 9/9。
- `old-lens-*-oracle.json`：旧数值和图像链回归。
- `negative-controls.json`、`strict-conversions.log`：变异测试、身份拒绝和窄化检查。
- `verification.json`、`source-manifest.json`：本轮验收摘要、原创交付文件与证据哈希。

完整 VAS 轨迹估计/平滑/裁边、防抖视频链和 Deflicker GPU 算法仍未完成；本轮不改变整库恢复计数，也不算新增完整滤镜效果链。
