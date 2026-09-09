# Lens 第三批：MergeUtil 使用的运动约束核

本轮交付可独立编译的 C++20 `constrain_motion`，恢复 `MoveSys::Move::Run` 在 **border enum=11** 下完整的缩放、旋转和平移限制。这个分支有 `SmartMotionPipeline::preview → MergeUtil` 的实际调用证据。输入为像素坐标中的 `Rigid` 参数；没有把模型调度、理想几何或私有库桥当成独立算法。

本机固定版本原生对照：**249,411 次 Move 调用、997,644 个 float 输出逐 bit 一致**。另外 **2,048 帧真实 CenterFocus / 8,192 个 bbox 值**一致后接入约束核。Release 与 fail-closed ASan/UBSan 各 **15/15 CTest**，两种原生构建输出相同；六个旧原生诊断 JSON 全部保持原值。本轮没有新增产品像素、完整 MergeUtil、VAS 或 Deflicker 验收；新 head 的远程 CI 另行检查。

## 固定身份与证据位置

- 安装库：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`。
- universal SHA256：`8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf`。
- arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
- 私有 arm64 slice SHA256：`fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4`。
- 本轮私有目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/batch3/lens-crop-merge/`。
- 旧反汇编输入：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-07/lens-planning/full-disassembly.private.txt`；本轮仅摘取定点区间，不修改旧证据。

`identity.json` 保存本次身份核验；`source-manifest.json` 保存当前 Lens 项目源码与本文的逐文件 SHA256。原始二进制、反汇编、运行日志与错误变体仅留私有目录。仓库新增文件均为自有算法、诊断、测试或中文说明，不包含供应商原始源码或资源。

## 实际调用链与本轮边界

`SmartMotionPipeline::preview` 从 `0x1118e4` 开始。它先按帧索引选择模板向量，把当前检测输入送入真实 `CenterFocus::Process`，再于 `0x111a64` 调用 `MergeUtil`。这段静态链与上一批的 [检测框裁切研究](lens-crop-selection-2026-09-08.zh.md) 连续。

`MergeUtil` 位于 `0xb0f00`，其整体顺序如下；**本轮实现并原生验证的是第 4 步的约束核**：

1. 模板向量实际顺序是 `[scale, angle_degrees, translation_x, translation_y]`。它不是四条 bbox 边。函数据此构造内部 `Rigid`，物理字段顺序是 `[tx, ty, angle, scale]`。
2. 调用 `Rigid2Lock`，以画面中心及宽高把模板参数转换到像素空间。
3. 用 CenterFocus 的 `[left,top,right,bottom]` 计算中心：`cx=(right+left)/2F`、`cy=(bottom+top)/2F`。将相对画面中心的偏移加到已转换的平移上。
4. 用真实 `MoveParam` 构造 `Move`：border=11，宽高来自 SettingInfo，旋转中心为上一步 bbox 中心，minimum scale 固定 `.2F`；执行 `Move::Run`。
5. 调用 `Lock2Rigid`，再按 `[scale,angle,tx,ty]` 输出向量。

当前函数中有计算 bbox 宽度/画面宽度以及读取 SettingInfo `+0x10` 后未再使用的值。不能据此给第 4 步额外添加 bbox scale 乘法。

SettingInfo 的真实默认构造 `0x1126d8` 把宽高写为 `-1F`。尚未恢复安全、可验证的实际宽高配置入口。本轮没有手写对象字段或伪造配置，也没有调用默认负尺寸的整个 MergeUtil。两侧 `Rigid2Lock` / `Lock2Rigid` 已定点保存静态证据，但没有作为本轮独立源码交付。故本轮不是完整模板与检测结果合并算法。

## 约束算法语义

公开入口见 [motion_constraint.hpp](../../../research/independent-lens-contract/motion_constraint.hpp)；实现在 [motion_constraint.cpp](../../../research/independent-lens-contract/motion_constraint.cpp)。

### 缩放和包含末端像素的四角

四角按 `(0,0),(W-1,0),(W-1,H-1),(0,H-1)` 排列；宽高是 float。先计算：

```text
scale = max(min(input_scale, 1F), minimum_scale)
p = ((p + -center) * scale) + center
```

所有加、减、乘、除按 binary32 分步执行，禁止隐式 FMA 或 fast-math。原生 min/max 为 `FMINNM/FMAXNM`；独立有限域显式保留正负零的选择。

原生角度和平移的激活判断是严格 `value > 1e-5F || value < -1e-5F`。等于正负 epsilon 时仍旁路，保留原值及有符号零。

### 旋转搜索

只要角度激活，先检查裁切 polygon 的包围盒宽、高是否均至少为 `1F`；不足时跳过旋转限制。非退化时先尝试完整旋转。全部点位于 `[0,W-1]×[0,H-1]` 则保留角度。

若越界，令 accepted=0、rejected=requested、previous=requested，最多迭代 30 次：

1. 按角度符号判断两界是否仍有区间。
2. `candidate = accepted + (rejected-accepted)/2F`。
3. 将**上一轮已经旋转的 polygon**再旋转 `candidate-previous`，保留多轮 float 坐标舍入，不能每次重建初始四角。
4. 如果角度增量绝对值小于 `1e-5F` 且点都在界内，则结束；否则按当前包含结果更新 accepted 或 rejected，并更新 previous。
5. 返回**最后 candidate**，不是 accepted。

`Run` 随后对自己的原 polygon 再执行一次 `scale/scale` 的复裁，再按最后角度旋转。这里保留原生操作顺序；删除这次复裁在本轮矩阵中没有可见差异，不能把该试验当作错误检出。

原点旋转复用已有 `rotate_points`，保留原生 degree 常量及独立 `cosf` / `sinf` 调用，详见 [六个原语研究](lens-cpp-contract-2026-09-07.zh.md)。原生最后候选可能仍带极小越界，所以本实现不会追加“保证完全包含”的理想化修正。

### 平移裁切

任一平移轴激活时，在最终 polygon 的包围盒宽、高均至少为 1 的前提下，对两个轴执行：

```text
first  = -minimum_coordinate
second = (dimension - 1F) - maximum_coordinate
low  = min(first, second)
high = max(first, second)
translation = min(max(input_translation, low), high)
```

原生先排序两个边界，不假设 `first <= second`。如果一轴激活，另一轴即使处于 epsilon 内也会参与本次裁切。退化面积时，两轴平移都保留输入。`Move` 参数在重复 Run 之间保持不变，本轮实现也没有隐藏帧历史。

## 安全域和独立策略

- 宽高有限且在 `1..32768`；中心分别在 `0..W`、`0..H`。
- minimum scale `.01..1`；输入 scale `-4..4`，负值按原生缩放夹取后变为正值。
- 角度 `-180..180` 度；平移绝对值各不超过该轴边长的四倍。
- 必须使用 `FE_TONEAREST`；所有字段拒绝 NaN、无穷和域外输入。
- 失败保持原输出，允许输入和输出引用同一对象。

这些保护域是独立实现策略，不宣称原生拒绝相同输入。域内中间坐标有界、最小缩放非零，30 次迭代有固定上限；没有浮点到整数的隐式转换。原生会接受更多参数与 border 枚举；本轮不开放 border=10/12 或 `BorderCutDown` 的其它独立 MoveEnum 分支。

## 原生对象和 ABI 证据

[原生支持](../../../research/independent-lens-contract/motion_constraint_native_support.hpp) 通过现有 SHA256/UUID 校验器加载固定镜像，并检查导出锚点 `Move::Run=0x9fc24` 后才解析内部偏移。目标只允许 macOS arm64 / Apple libc++；默认标准 C++ 库没有该诊断依赖。

| 单元 | 固定地址 | 原生构造/调用方式 |
| --- | --- | --- |
| MoveParam 参数构造 | wrapper `0x9fa94` → `0xb6bec` | 参数为 int border 与五个 float；真实构造分配并编码 24 字节 payload |
| Move 构造 | wrapper `0x9faf0` → `0xb6d8c` | 从真实参数对象复制；之后析构临时参数 |
| Rigid 构造 | `0x97208` | 真实构造写入 tx、ty、angle、scale；16 字节布局逐 bit 反读确认 |
| Run | `0x9fc24` | 在真实 Move / Rigid 对象上调用，读取四个输出 float |
| Check | `0xb6fc4` | border=11 分派至 `BorderCutDown`，不是 BorderScale |
| BorderCutDown | `0xb7234` | Run 实际使用旋转 enum=8、平移 enum=6 |
| RotRestrict | `0x977bc` | 增量 polygon 旋转，30 次上限，最后 candidate 返回 |
| InBorder predicate | `0xbf234` | 包含 `0` 和 `dimension-1` 的四个比较 |
| Move / MoveParam 析构 | `0x9ffbc` / `0x9fb24` | 调用真实析构释放参数缓冲 |

MergeUtil 的真实栈槽和构造实现表明 MoveParam、Move 各为 24 字节。诊断为这些真实对象以及 16 字节 Rigid 提供前后 32 字节 canary，不伪造 `std::vector` 或控制块。每次 Run 后核对 guard 和真实参数 payload 的字段/顺序/不变性。参数与输入 guard 检查不计入输出 float 总数。

## 验证、负控和重跑

`native-release.json` 与 `native-san.json` 完全相同，文件 SHA256 均为 `646d252d8a09a70c5115829a8377546271200e37ba79520583cf718c7fbe37f8`。

| 矩阵 | 调用数 | 内容 |
| --- | ---: | --- |
| 随机有效参数 | 196,608 | 65,536 组，每个真实对象按 A/B/A 顺序调用，验证对象无帧历史 |
| 非三角 portable fingerprint | 4,096 | 同一原生矩阵的固定 float 位指纹，进入跨平台 CTest |
| 显式边界 | 46,659 | 1/2/3 像素边、奇数尺寸、32768 上界、正负零、epsilon 与 nextafter、scale 下限、面积阈值和 ±180° |
| CenterFocus 中心组合 | 2,048 | 真实检测/缺失检测连续序列，先比对四条边，再计算中心并接真实 Move |
| **Move 合计** | **249,411** | **997,644 个输出 float 零差异** |

组合还有 8,192 个 bbox float 对照；加上 Move 输出合计 **1,005,836** 个值。该组合验证使用已锁定的像素参数，不冒充整个 MergeUtil 的 normalized template 处理。当前主矩阵的 rotation/translation/scale 分别有 **183,664 / 213,351 / 214,036** 次发生变化，排除了“所有调用原样返回”的空对照。

原生主指纹 `4417fe2981dbc217`；4,096 个非三角 portable 子集指纹 `45f096155aba0950`。Portable CTest 的旋转 goldens 对 libm 使用明确小容差，原生诊断仍要求四字段逐 bit 相同，不用容差掩盖实际差异。

新增 4,152 个 C++ 检查覆盖有用输出、非对称中心、包含末端像素、退化面积、signed zero、epsilon 边界、alias、非有限输入和舍入模式拒绝；另有三组 CLI 测试。完整项目 Release / ASan+UBSan 均为 15/15 CTest。Clang 额外以 `-Wconversion -Wsign-conversion -Werror` 检查三个新 portable `.cpp` 文件通过；这不等于已经在本轮 Windows CI 验证。

私有 `mutants.json` 记录八个实际编译变体：七个错误变体被相同原生比较断言拒绝，包括完整图像边替代末端像素、每轮重建 polygon、返回 accepted、缩短迭代、改为包含 epsilon、移除 scale 上限和错误面积阈值。删除单位复裁的第八个变体在当前矩阵没有差异，明确记录 `detected=false`。`negative-identity.json` 的错误 SHA / 错误预期 UUID 两个负控均在数值调用前拒绝，供应商二进制未修改。

六个旧原生诊断重新执行，其 JSON 与上一批完全相同，包括旧 **161,540,260 字节** base RGBA/BGR 验证。复跑记录在 `old-regressions.json`；本轮没有重复计算这些旧字节为新增像素成果。

从包根编译和复跑：

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-lens-motion -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-lens-motion -j4
ctest --test-dir /tmp/qcut-lens-motion --output-on-failure
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks /tmp/qcut-lens-motion/lens-motion-native-oracle /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

默认独立构建省略 `LENS_CONTRACT_NATIVE_ORACLE=ON` 即可；ASan/UBSan 另开构建目录并添加 `-DLENS_CONTRACT_SANITIZERS=ON`。警告即错误、关闭隐式浮点收缩及 fast-math、sanitizer fail-closed 均沿用项目配置，不改统一 workflow。

## 尚未完成

下一步需要真实配置 SettingInfo，完成两侧坐标转换后直接对照整个 MergeUtil。随后才能核验模板时间索引、模板运动生成与最终产品图像的对应关系。当前没有恢复多检测候选评分、模型检测、VAS 轨迹全流程、Deflicker 或 SmartMotion UI/导出；已有 affine warp 与本轮 motion constraint 也不能在缺少坐标方向证据时随意拼成所谓产品完整链。
