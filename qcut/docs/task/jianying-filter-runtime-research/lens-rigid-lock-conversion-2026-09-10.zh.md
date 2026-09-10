# Lens 第四批：MergeUtil 两侧的模板与像素坐标转换

本轮交付可独立编译的 C++20 `rigid_to_lock` / `lock_to_rigid`，恢复 `MoveSys::Util::Rigid2Lock`（`0x967f8`）和 `MoveSys::Util::Lock2Rigid`（`0x9622c`）。这两个函数正好夹住第三批交付的 `Move::Run` 约束核：`MergeUtil` 在 `0xb0fe8` 调 `Rigid2Lock`、在 `0xb1240` 调 `Lock2Rigid`。本轮只恢复这两个坐标转换本身，没有配置 `SettingInfo`，也没有调用整个 `MergeUtil`。

本机固定版本原生对照：**1,332,811 次真实调用、5,331,244 个 float 输出逐 bit 一致**，NaN 只比较分类，0 处分类不符。Release 与 fail-closed ASan/UBSan 各 **18/18 CTest**（此前 15/15），两种构建的原生 JSON 完全相同；七个旧原生诊断输出保持原值。十个故意改错的算法变体全部被原生对照检出，两个身份负控在任何数值调用之前中止。本轮没有新增产品像素、完整 MergeUtil、VAS 或 Deflicker 声明。

## 固定身份与证据位置

- 安装库：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`，剪映 11.3.0。
- universal SHA256：`8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf`。
- arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
- 私有 arm64 slice SHA256：`fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4`。
- 本轮私有目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/lens/`。

`rigid-lock-identity.json` 保存本次身份核验与全部定点地址；反汇编、原生 JSON、错误变体日志只留私有目录。仓库新增文件均为自有算法、诊断、测试或中文说明，不含供应商源码或资源。

## 实际调用位置与本轮边界

`SmartMotionPipeline::preview`（`0x1118e4`）先在 `0x111a40` 调 `CenterFocus::Process`，再在 `0x111a64` 调 `MergeUtil`（`0xb0f00`）。`MergeUtil` 内部顺序与第三批 [运动约束研究](lens-crop-merge-2026-09-08.zh.md) 记录一致，本轮补上其中的第 2 步和第 5 步：

- `0xb0f34` / `0xb0f38` 读 `SettingInfo`，`+0x00` 是 width、`+0x04` 是 height，`+0x10` 读出后本函数未再使用。
- `0xb0fc8` / `0xb0fd4` 用 `fmov s2,#2.0` 做 `fdiv`，于 `0xb0fe8` 以 `(w/2, h/2, w, h)` 调 `Rigid2Lock`；`0xb1240` 调 `Lock2Rigid`，宽高相同但中心不同。中心是前两个 float 实参，不是函数内部推导出来的。

  **修正（第五批反汇编实测）**：本文最初写「`0xb1240` 以同样四个参数调 `Lock2Rigid`」，这是**错的**。`0xb121c`/`0xb1228` 装进 `s0`/`s1` 的是 `MergeUtil` 第二个入参那个框的中心 `((x1+x0)/2, (y1+y0)/2)`，`0xb1230`/`0xb1238` 才装 width/height；只有后两个实参与 `Rigid2Lock` 相同。因此下文那 36,024 次「MergeUtil 形状调用」用 `w/2, h/2` 当中心，证明的是 `Lock2Rigid` 本身，不是 `MergeUtil` 的实际实参。整链的实参与原生对照见 [第五批研究记录](lens-merge-util-2026-09-10-batch5.zh.md)。

`SettingInfo` 的默认构造 `0x1126d8` 把 `+0x00`、`+0x04` 写成 `-1.0f`（`+0x08` 写 `0.4f`、`+0x0c` 写 `0.7f`）。本轮没有恢复真实宽高的配置入口，也没有手写对象字段去凑一个可用配置，因此整个 `MergeUtil` 仍未打通。这一条明确不算关闭。

## 算法语义

公开入口见 [rigid_lock_conversion.hpp](../../../research/independent-lens-contract/rigid_lock_conversion.hpp)，实现在 [rigid_lock_conversion.cpp](../../../research/independent-lens-contract/rigid_lock_conversion.cpp)。两个方向共用第一批恢复的 `multiply` / `inverse`（`MatrixMul3x3` `0x95830`、`MatrixInv3x3` `0x95f38`），矩阵元素是 double，输入输出是 binary32。

### 两个角度常量是不对称的

正向常量在 `0x9683c`（Rigid2Lock）和 `0x9632c`（Lock2Rigid）都是 `mov w8,#0xf34d; movk w8,#0x3c8e`，即 `0x3C8EF34D = 0.017449999f`，字面量写法是 `0.01745f`。它**不是** `pi/180`（`0x3C8EFA35`），也不是本项目 `rotate_points` 使用的 `0.017453299835324287f`。反向常量在 `0x96bfc` / `0x96730` 是 `0x42652EE1 = 57.295780181884766f`，这个**正好**是 `float(180/pi)`。

这对不对称是刻意保留的：它是两个方向不能互为逆的直接原因。源码里有 `static_assert` 钉住这两个常量的 binary32 位型，把 `0.01745f` 改成真正的 `pi/180` 会在编译期就被拒绝（`rigid_lock_conversion.cpp:18`）。

### Rigid2Lock

`Rigid` 的物理字段顺序是 `{tx, ty, degrees, scale}`，由 `0xb1444` 处四条 `str s0,[x0,#0/4/8/0xc]` 独立确认（`0x97208` 是尾调用它的包装）。

```text
rad = degrees * 0.01745f
B   = [[s*cosf(rad), s*sinf(rad), tx], [(-s)*sinf(rad), s*cosf(rad), ty], [0,0,1]]
A   = [[w/2, 0, w/2], [0, h/2, h/2], [0,0,1]]
R   = inv(A * B * inv(A))
```

`w/2`、`h/2` 先按 float 除以 `2.0f` 再转 double；`B` 的每个元素都是 float 乘法结果再转 double。四次 `cosf`/`sinf` 通过 `0x96784`/`0x967a8` 两个 thunk 各自单独调用（thunk 落到 `_cosf` `0x4649ec`、`_sinf` `0x464d1c`），第三行 24 字节直接从 `__DATA` `0x4EFFA0` / `0x4EFFB8` 读入，实测都是 `(0.0, 0.0, 1.0)`。

矩阵链是 `MatrixInv3x3(A)` → `MatrixMul3x3(A,B,T)` → `MatrixMul3x3(T,invA,T)` → `MatrixInv3x3(T,R)`。第二次乘法的输出别名到第一个输入，这在原生是安全的，因为 `MatrixMul3x3` 的 23 次乘积载入全部发生在 `0x95d68`–`0x95f08` 的 9 次存储之前；本项目 `multiply()` 先算进局部候选再赋值，同样安全，但改成逐元素写入会静默破坏它。

平移带中心修正（`0x96c14`–`0x96c78`）：

```text
tx = ((R02 + cx*R00) - cy*R10) - cx
ty = ((R12 + cx*R10) + cy*R00) - cy
```

### Lock2Rigid

反向不是把上式反解，而是另建五个矩阵：

```text
M1 = 平移 (-cx, -cy)
M2 = 平移 (cx + tx, cy + ty)      # 加法在 float 上做，再转 double
M3 = [[cosf, -sinf, 0], [sinf, cosf, 0], [0,0,1]]
M4 = diag(scale, scale, 1)
M5 = [[w/2, 0, w/2], [0, h/2, h/2], [0,0,1]]
U  = inv(M5) * inv(M2*M3*M4*M1) * M5
```

平移直接取 `U[0][2]` / `U[1][2]`（`0x96714` / `0x96720`），**没有** Rigid2Lock 那段中心修正。

### 共用的分解尾

两个方向的分解完全同构，只有 `atan2f` 的实参符号相反：

```text
sx = sqrtf(powf(m00,2) + powf(m01,2));  if (m00 < 0) sx *= -1f
sy = sqrtf(powf(m10,2) + powf(m11,2));  if (m11 < 0) sy *= -1f
scale = (sx + sy) / 2f
```

`powf` 是真的 `_powf`（stub `0x464c08`，`__la_symbol_ptr 0x4EEB70`），并且预先 `fmov s1,#2.0`，即字面上的 `powf(x, 2.0f)`，不是 `x*x`。符号判断是 `fcmp s0,#0.0; b.pl`，所以 `-0.0` 和 NaN 都不触发取反。

角度是两个 `atan2f` 估计的几何平均：

- Rigid2Lock：`atan2f(m10, m11)` 与 `atan2f(-m01, m00)`。
- Lock2Rigid：`atan2f(-m10, m11)` 与 `atan2f(m01, m00)`。

每个估计先过一个零带：转成 double 与 `0x489E00` 的 `-1e-05`、`0x488660` 的 `+1e-05` 比较，`fcmp; b.le` 加 `fcmp; b.pl`，只有落在开区间内才强制为 `+0.0f`；NaN 因为比较为无序而保持原值。两个估计相乘后开方，**符号来自第三次重新计算的 `atan2f`**（`0x966cc` / `0x96bc0`），这次不过零带。最后乘 `57.295780181884766f`。

## 独立实现的安全域

`FE_TONEAREST`；宽高 `1..8192`；中心位于 `[0,width]×[0,height]`；角度 `-360..360` 度；两轴平移各不超过相应边长四倍；scale 绝对值 `1e-4..4`。输入输出可引用同一对象（所有字段在第一次写入前读进局部）；拒绝时保持输出不变。

**scale 为正负零被拒绝**。原生对奇异矩阵求逆没有任何保护，直接返回四个 NaN；本实现按已有 `inverse()` 的零行列式策略拒绝整个奇异邻域，不复现无保护的除法。原生诊断把这一族单独跑了 36 次，逐次确认原生输出确实非有限，再计入 `policy_rejections`，没有当成一致或掩盖。

## 明确没有关闭的项

1. **两个方向不是往返关系。** 45 度经 `Rigid2Lock` 得 42.1861 度，再经 `Lock2Rigid` 得 39.6338615 度；这两步本身也在原生对照里逐 bit 走了一遍。文档、README 和 CLI 帮助都写死了这一点，不能把其中一个说成另一个的逆。原生诊断中还有 420 次 `Rigid2Lock` 的输出直接落在 `Lock2Rigid` 安全域之外（`relay_out_of_domain`），也一并记下来。
2. **NaN 只声明分类。** 负 scale 配接近零的角度时，`atan2f(-0.0, m11<0) = -pi` 与 `atan2f(+0.0, m00<0) = +pi` 让乘积为负，原生 `fsqrt` 得到 NaN **角度**，而 tx/ty/scale 仍是有限值。本轮 1,332,811 次调用中出现 4,601 次，每次恰好一个 NaN 字段。对照按分类比较通过，但**不宣称 payload 一致**。
3. **scale 为零的四 NaN 族不在覆盖范围内**，见上一节。
4. **逐位一致只在 Apple Silicon / macOS 上验证。** `cosf`/`sinf`/`powf`/`atan2f` 的舍入是系统 libm 的。默认 CTest 里 8 个定点样例按逐位断言，远程 CI 已确认这 8 个在 Linux 与 Windows 上同样精确；其余 8 个含三角函数的样例按 `1e-5 × max(1, |期望值|)` 的容差断言。

   **修正（远程 CI 实测）**：本文最初推断 8,192 个结果的指纹也是 libm 无关的，理由是该族的 `cosf(0)`、`sinf(0)`、`atan2f(±0, x)` 在任何合规 libm 上都精确。这个推断是**错的**——分解尾部仍然对扫出来的矩阵元素调用 `powf` 和 `atan2f`，它们的实参并不总是精确零。PR #470 的首次云端 CI 在 ubuntu-24.04（含 ASan/UBSan）和 windows-latest 三个 job 上都以 `8192 native-observed zero-angle results changed` 失败，只有 macOS 通过。该指纹现在只在原生对照实际运行过的平台（Apple Silicon / macOS arm64）上按逐位断言，其他平台改为检查接受、计数与有限性。这与本工程 README 早就写明的「数值逐位对照目前只在 Apple Silicon/macOS 上验证」是一致的；原来的写法把本机 libm 的位钉进了跨平台默认测试。
5. **没有配置 `SettingInfo`，没有调用整个 `MergeUtil`**，也没有 `ProcessDetectionImage`、VAS、Deflicker、UMVFI、VMB。
6. **这是从固定二进制恢复的坐标转换**，不能据此宣称 QCut 或剪映当前界面走这条路径，也不构成任何成片像素声明。

## 验证数字

| 项目 | 数值 |
| --- | --- |
| CTest（本轮前 / 后，Release） | 15 / 18 |
| CTest（本轮前 / 后，ASan+UBSan fail-closed） | 15 / 18 |
| 新增独立 C++ 检查 | 8,283 |
| 真实原生调用 | 1,332,811 |
| 逐 bit 比较的 float32 | 5,331,244 |
| bit 差异 / NaN 分类差异 | 0 / 0 |
| 出现 NaN 角度的结果 / NaN 字段 | 4,601 / 4,601 |
| 策略拒绝（scale 为零，原生确认非有限） | 36 |
| Rigid2Lock 输出落在 Lock2Rigid 安全域外 | 420 |
| Release 指纹 / 边界指纹 | `e1df497aa6f374b3` / `9975d8c13ae9233c` |
| ASan+UBSan 指纹 / 边界指纹 | 同上，逐字符相同 |

原生 JSON 见 `rigid-lock-native-oracle-release.json` 与 `rigid-lock-native-oracle-asan-ubsan.json`。七个旧原生诊断重跑结果见 `rigid-lock-existing-oracles-unchanged.txt`，全部保持原值（例如运动约束仍是 249,411 次调用、指纹 `4417fe2981dbc217`）。

固定样例采集覆盖：16 个定点样例（含两族退化）、3 次往返演示样例（默认 CTest 的同一组）、300,000 轮随机域（居中与任意中心各一组，两个方向共 1,200,000 次）、96,768 次显式边界（宽 1/2/3/17/1920/8192，高 1/2/145/8192，中心取 0、半幅、满幅；角度 `-360/-270/-180/-90/-45/±0/±1e-5/1e-4/1e-6/45/90/180/270/360`，scale `±4/±1/±1e-4/0.2`，平移为边长的 `±4/±1e-5/±0` 倍）、36 次奇异族，以及 36,024 次 MergeUtil 形状调用（六种真实画幅、中心取 `w/2, h/2`；12,288 次正向加 23,736 次反向）。合计 1,332,811 次。

## 负控

| 变体 | 默认 CTest | 原生对照 |
| --- | --- | --- |
| `degrees_to_radians` 改成真正的 `pi/180` | 拒绝 | 拒绝 |
| `radians_to_degrees` 改成真正的 `1/0.01745f` | 拒绝 | 拒绝 |
| 删掉 `±1e-5` 角度零带 | 拒绝 | 拒绝 |
| 两个方向的 `atan2f` 实参符号互换 | 拒绝 | 拒绝 |
| `powf(x,2)` 改成 `x*x` | **通过** | 拒绝 |
| scale 符号改从 `m01` 取 | 拒绝 | 拒绝 |
| 角度用算术平均代替开方 | 拒绝 | 拒绝 |
| 去掉 Rigid2Lock 的 `-cx/-cy` 修正 | 拒绝 | 拒绝 |
| `A*B*invA` 乘法顺序对调 | 拒绝 | 拒绝 |
| Lock2Rigid 改用 Rigid2Lock 的链序 | 拒绝 | 拒绝 |
| 身份负控：错误 SHA256 | — | 在任何数值调用前中止 |
| 身份负控：错误 UUID | — | 在任何数值调用前中止 |

十个算法变体全部被原生对照检出。其中 `powf(x,2) → x*x` 只有原生对照能检出：定点样例集里那一族恰好没有触发差异，如实记在这里，不从检出数里美化掉。

另有一项**如实记录为「不是变体」**：把 `radians_to_degrees` 写成 `57.29578f`，两种构建和原生对照都没有差异——因为 `57.29578f` 与 `57.295780181884766f` 是同一个 binary32（`0x42652ee1`），源码里的 `static_assert` 也接受它。这不算漏检。

另外，把两个角度常量改错在**编译期**就会被 `static_assert` 拒绝；为了让运行期对照也跑一遍，上表对应的两个变体是把那两行 `static_assert` 一并删掉之后构建的。

日志见 `rigid-lock-negative-controls.txt`。

## 复现

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-independent-lens -j8
ctest --test-dir /tmp/qcut-independent-lens --output-on-failure

cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-native \
    -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-independent-lens-native -j8
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks \
    /tmp/qcut-independent-lens-native/lens-rigid-lock-native-oracle \
    /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

原生诊断只在隔离进程中调用通过身份校验的导出函数，不启动、不注入剪映，也不读取任何草稿。
