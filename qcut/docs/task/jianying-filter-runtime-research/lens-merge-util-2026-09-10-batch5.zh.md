# Lens 第五批：MergeUtil 整链与 SettingInfo 的真实配置入口

本轮交付可独立编译的 C++20 `merge_util`，恢复 `LENS::ALGORITHM::MoveSys::MergeUtil`（`0xb0f00`）整条链：`Rigid2Lock` → 框中心平移 → `Move::Run`（border 11）→ `Lock2Rigid` → 输出置换。第三批已交付其中的约束核，第四批已交付两侧的坐标转换；本轮补上把它们串起来的那一层，并且第一次通过 `SmartMotionPipeline` 的真实构造与 `init` 拿到配置好的 `SettingInfo`，因此整个 `MergeUtil` 第一次真正被调用。

本机固定版本原生对照：**387,498 次真实 `MergeUtil` 调用**，其中 **334,645 次落在声明域内并逐 bit 比较，1,338,580 个 float32 零差异**。Release 与 fail-closed ASan/UBSan 各 **21/21 CTest**（此前 18/18），两种构建的原生 JSON 逐字符相同；八个既有原生诊断重跑结果保持原值。十四个故意改错的算法变体全部被默认 CTest 与原生对照同时检出，两个身份负控在任何数值调用之前中止，一个如实记为「不是变体」。本轮没有新增产品像素、`preview`、VAS 或 Deflicker 声明。

## 固定身份与证据位置

- 安装库：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib`，剪映 11.3.0。
- universal SHA256：`8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf`。
- arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
- 私有 arm64 slice SHA256：`fa88f3ce374753842b8256f6cb3486a3db7095062ea3b7272a5149f3e76a8ec4`。
- 本轮私有目录：`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/batch5/lens/`。

`merge-util-identity.json` 保存身份核验与全部定点地址；反汇编、原生 JSON、变体日志、探针源码只留私有目录。仓库新增文件全部是自有算法、诊断、测试或中文说明，不含供应商源码或资源。

原生诊断的门禁顺序与前四批一致：绝对路径 → 整文件 SHA256 → `dlopen` → `dlsym` 锚符号 → `dladdr` 取基址 → 校验 Mach-O arm64 与 LC_UUID → 校验锚符号地址等于 `base+0x967f8`。任何一项不符都在**第一次数值调用之前**抛出。

## 静态证据

反汇编产物见 `recon/mergeutil-0xb0f00.private.txt` 等，全部来自 `objdump -d` 私有 arm64 slice。

### 链条顺序

| 地址 | 动作 |
| --- | --- |
| `0xb0f34`/`0xb0f38` | `ldr s0,[SettingInfo,#0x10]` → `stur s0,[x29,#-0x4c]`，此后全函数不再引用 |
| `0xb0f40`–`0xb0fb0` | 四次 `operator[]`（`0x94ff4`）取 `v0[2] v0[3] v0[1] v0[0]`，送进 `0x97208` 的 `tx, ty, degrees, scale` |
| `0xb0fc8`/`0xb0fd4` | `fmov s2,#2.0` 后两次 `fdiv`，得 `w/2`、`h/2` |
| `0xb0fe8` | `Rigid2Lock(rigid, w/2, h/2, w, h)` |
| `0xb1018`–`0xb1028` | `L0 = (v1[2]-v1[0]) / width` → `[x29,#-0x60]`，**全函数只有这一次出现，且是写** |
| `0xb1058`–`0xb1070` | `L1 = (v1[2]+v1[0])/2 - width/2`（`width/2` 现算） |
| `0xb10a0`–`0xb10b8` | `L2 = (v1[3]+v1[1])/2 - height/2` |
| `0xb1100`/`0xb1144` | `CX = (v1[2]+v1[0])/2`、`CY = (v1[3]+v1[1])/2` |
| `0xb1150`–`0xb1178` | `mov w1,#0xb`；`0x3E4CCCCD = 0.2f`；`0x9fa94` 建 Parameter、`0x9faf0` 建 Move、`0x9fb24` 析构 Parameter |
| `0xb1184`/`0xb1190` | `q.tx = lock.tx + L1`、`q.ty = lock.ty + L2`；角度、缩放原样 |
| `0xb11a0` | 第二个 `Rigid`（`sp+0x9c`） |
| `0xb11b0` | stub `0x460e88` → `__la_symbol_ptr 0x4ec270`（间接符号 1127）= `MoveSys::Move::Run(Rigid&)` |
| `0xb11b8`–`0xb1228` | 重新算一遍 `CX`、`CY`（同一表达式，逐 bit 相同） |
| `0xb1240` | `Lock2Rigid(rigid, CX, CY, width, height)` |
| `0xb1248`–`0xb1280` | `out = {q.scale, q.degrees, q.tx, q.ty}`，经 `0x97680` 构造 4 元素 `vector<float>` |
| `0xb128c` | `0x9ffbc` 析构 Move |

`SettingInfo` 解引用全表：`+0x00` 六次、`+0x04` 五次、`+0x10` 一次（死读）。**没有第四个字段被读**。

### 更正第四批文档的一处记述

[第四批研究记录](lens-rigid-lock-conversion-2026-09-10.zh.md) 原文写「`0xb1240` 以同样四个参数调 `Lock2Rigid`」。反汇编显示不是：`0xb121c`/`0xb1228` 装的是 **框中心** `((x1+x0)/2, (y1+y0)/2)`，`0xb1230`/`0xb1238` 才装 width/height。只有后两个参数与 `Rigid2Lock` 相同，中心不同。第四批那 36,024 次「MergeUtil 形状调用」用的是 `w/2, h/2`，所以它证明的是 `Lock2Rigid` 本身，不是 `MergeUtil` 的实参。该文档已就地更正。

这不是措辞问题：把 `Lock2Rigid` 的中心改成画幅中心，本轮负控 `06` 在默认 CTest 与原生对照上都被检出。

### 真实配置入口

`SmartMotionPipeline::init`（`0x10f408`）：

- `0x10f42c` `cbnz x8` 空指针早退；
- `0x10f458` 调 stub `0x460e1c` → `__la_symbol_ptr 0x4ec228`（间接符号 1063）= `lens_smart_motion_config::operator=`，第一实参是 `this`，**说明 config 成员位于 pipeline+0**；
- `0x10f488`–`0x10f49c`：`ldr s0,[cfg,#0x8]; scvtf s0,s0; str s0,[this,#0x2b8]`；
- `0x10f4a0`–`0x10f4ac`：同法从 `cfg+0xc` 写 `+0x2bc`。

这两条发生在 `0x10f650` 的 `operator new`、`0x10f674`/`0x10f684` 的 HumanMotionDetector、`0x10f8b0` 的 `TriggerGenerator::init(string)`、`0x10f9c8` 的 `CenterFocus::Init` **之前**。

第二条语义佐证：`Tool::GetTimeLine`（`0xac600`）头四条指令就是 `strb wzr,[s,#0x18]`、`ldr s0,[v,#0x4]; str s0,[s]`、`ldr s0,[v,#0x8]; str s0,[s,#0x4]`，即 `SettingInfo.width/height` 就是视频帧宽高。本轮不驱动这条路。

调用点：`SmartMotionPipeline::preview`（`0x1118e4`）在 `0x111a54` `add x2, x8, #0x2b8`，第三实参正是 `pipeline+0x2b8`。

## 运行期实测的对象布局

诊断用 `0xa5` 哨兵包裹的存储量出而不是假设：

- `SmartMotionPipeline` 构造后最高被写字节 = **`0x330`（816 字节）**，哨兵未被踩，析构后仍未被踩。
- `SettingInfo` 默认构造（定点 `0x1126d8`，叶子函数）**恰好写 `0x44` 字节**，最后一个字段在 `+0x40`。
- `pipeline+0x2b8` 与「现场默认构造的一份 `SettingInfo`」逐字节比对。

### 侦察阶段的一个结论在这里被推翻

侦察方案要求断言「`init` 只改 `+0x00`/`+0x04` 两个 float，其余 66 字节必须一致」。**这是错的。** `0x10f488`–`0x10f570` 一共往 `SettingInfo` 写了 18 个字段：`+0x00`/`+0x04` 来自 `cfg+0x8`/`+0xc` 的 `scvtf`，`+0x08`..`+0x3c` 逐个来自 `cfg+0x68`..`+0x94`；只有 `+0x40` 不写。

实测（`merge-util-settinginfo-readback.txt`）：`init(1920,1080)` 之后与默认构造相比，**四个 word 不同**——

| 偏移 | 默认构造 | `init` 之后 |
| --- | --- | --- |
| `+0x00` | `0xbf800000`（-1） | `0x44f00000`（1920） |
| `+0x04` | `0xbf800000`（-1） | `0x44870000`（1080） |
| `+0x08` | `0x3ecccccd`（0.4） | `0x3e4ccccd`（0.2） |
| `+0x0c` | `0x3f333333`（0.7） | `0x3f19999a`（0.6） |

`+0x08`/`+0x0c` 之所以变，是因为 `lens_smart_motion_config` 自己的默认值与 `SettingInfo` 默认构造不同，不是 `init` 特意改的。

因此交付的门禁按**实际能断言的东西**写，而不是按侦察的措辞写：

1. `+0x00`、`+0x04` 必须逐 bit 等于 `(float)width`、`(float)height`；
2. `+0x10` 到 `+0x43` 的每一个字节必须与现场默认构造完全相同——`+0x10` 正是 `MergeUtil` 读的第三个字段，这一条直接钉住它的取值；
3. `+0x08`/`+0x0c` 的两个 config 派生 word 必须恒为 `0x3e4ccccd`/`0x3f19999a`（七种画幅、多次 `init` 实测不变），作为 fail-closed 校验，但**不宣称 `MergeUtil` 读它们**；
4. 每次 `MergeUtil` 调用前后重新比对整 `0x44` 字节，确认原生没有改动它。

两处 padding（`+0x19`..`+0x1b`、`+0x32`..`+0x33`）两个对象都不写，比对时相等是因为两块存储用同一个 `0xa5` 填充；一旦原生写进去，比对会立刻失败而不是被掩盖。

### `+0x10` 是死读，运行期也验证过

`merge-util-dead-field-poison.txt`：把 `SettingInfo+0x10` 依次改成 `0`、`-1`、`FLT_MAX`、qNaN、`-inf`，原生 `MergeUtil` 五次输出与参考值逐 bit 相同；作为对照，把 `+0x00` 从 1920 改成 960，输出立刻改变。独立实现同样不读这个字段，默认 CTest 用五个毒值断言这一点。

## 算法语义

公开入口见 [merge_util.hpp](../../../research/independent-lens-contract/merge_util.hpp)，实现在 [merge_util.cpp](../../../research/independent-lens-contract/merge_util.cpp)，只调用第一到第四批已交付的 `rigid_to_lock` / `constrain_motion` / `lock_to_rigid`。

```text
templated = Rigid{tx = current[2], ty = current[3], degrees = current[1], scale = current[0]}
locked    = Rigid2Lock(templated, 中心 = (w/2, h/2), w, h)
CX = (box[2] + box[0]) / 2f      CY = (box[3] + box[1]) / 2f
shifted   = Rigid{locked.tx + (CX - w/2f), locked.ty + (CY - h/2f), locked.degrees, locked.scale}
moved     = Move::Run(shifted)   参数 = (border 11, w, h, CX, CY, 0.2f)
merged    = Lock2Rigid(moved, 中心 = (CX, CY), w, h)
输出      = {merged.scale, merged.degrees, merged.tx, merged.ty}
```

三处不能「顺手改对」的地方，源码里都写了原因：

1. **模板向量不是 Rigid 的字段顺序。** 物理顺序是 `[scale, degrees, tx, ty]`，由 `0xb0f40`–`0xb0fb0` 的索引 2/3/1/0 与 `0x97208` 的形参顺序共同确定；输出用同一个置换写回。
2. **`(x1-x0)/width` 是死值。** `0xb1028` 写进去之后再没读过。把它当成水平位移是最容易犯的错，负控 `04` 专门检它。
3. **`Rigid2Lock` 的中心是画幅中心，`Move` 与 `Lock2Rigid` 的中心是框中心。** 三段中心不是同一个，负控 `05`/`06`/`07` 分别检这三种混淆。

另外，位移用的是 `(sum/2) - (extent/2)` 而不是 `(sum - extent)/2`；原生在 `0xb105c`/`0xb1068` 分别做两次 `fdiv` 再相减。

## 独立实现的安全域

`FE_TONEAREST`；`SettingInfo` 宽高 `1..8192`；两个向量都必须至少四个元素、前四个元素有限（原生用 `operator[]` 不做边界检查，少于四个在原生是 UB，这里拒绝；多于四个原生忽略，这里也忽略）。之后是三段子域的合取，逐段归因：

| 段 | 门禁 |
| --- | --- |
| `rigid_to_lock` | 宽高 `1..8192`、中心在框内、`\|scale\| ∈ [1e-4, 4]`、角度 `±360`、平移 ≤ 4×边长 |
| `constrain_motion` | **框中心必须落在 `[0,W]×[0,H]`**、`\|scale\| ≤ 4`、角度 `±180`、平移 ≤ 4×边长 |
| `lock_to_rigid` | 同第一段，中心换成框中心 |

拒绝时保持输出不变，返回值指明是哪一段拒绝的。输出可以和输入引用同一个容器：所有输入值在第一次写入之前读完。

**`scale` 为正负零被拒绝**：原生对奇异矩阵求逆没有保护，沿用第四批的策略拒绝整个奇异邻域。`width/height = -1.0f` 的未配置默认态不在声明域内（实测 `MergeUtil` 在该值下也不崩，记录在 `recon/probe-run1.txt`，但不进正式域）。

### 域拒绝率随画幅变化，如实归因

默认 CTest 的 3,584 样例扫描（七种画幅各 512）：

| 画幅 | 接受 | 被运动段拒绝 |
| --- | --- | --- |
| 1920×1080 | 510 | 2 |
| 1280×720 | 512 | 0 |
| 720×1280 | 512 | 0 |
| 640×480 | 511 | 1 |
| 3840×2160 | 511 | 1 |
| 1×1 | 512 | 0 |
| **17×145** | **188** | **324** |

17×145 有 63.3% 被运动段的平移门禁拒绝：极小画幅下 `Rigid2Lock` 的锁定平移天然超过 4×边长。这不是缺陷，也不是可以调大门禁掩盖的东西；把小画幅从样例里删掉会让拒绝率假装为零，所以它留在默认 CTest 里，并且计数被钉死。

原生对照里 52,794 次运动段拒绝的细分（`motion_gate_attribution`）：

| 子门禁 | 次数 |
| --- | --- |
| 框中心落在画幅外 | 8,316 |
| 锁定 scale 超过 4 | 14,549 |
| 锁定角度超过 180 度 | 924 |
| 锁定平移超过 4×边长 | 29,005 |

## 明确没有关闭的项

1. **域外不比较，也不宣称一致。** 387,498 次原生调用里有 52,836 次被独立实现拒绝，其中 **51,606 次原生返回的四个 float 全部有限**。也就是说在这些输入上原生给得出结果而本实现拒绝——本实现比原生**更窄**，这是安全策略，不是等价性。JSON 里 `rejected_with_finite_native` 就是这个数，没有被折叠进「一致」。
2. **`lock_to_rigid` 这一段的门禁在 387,498 次调用里一次都没触发。** 运动段会把 scale 夹进 `[0.2, 1]`、角度限制在 `±180`、平移裁进画幅，交给第三段时已经落在它的域内。守卫保留（fail-closed），但**不宣称它被验证过**。
3. **本轮接受的结果里没有出现 NaN。** 第四批那族 NaN 角度（负 scale 配零角度）在这里会被运动段的角度门禁挡掉，所以 `nan_results = 0`。NaN 只比分类的规则仍然生效，只是本轮没有被接受路径触发。
4. **`0.2f` 这个常量只能通过负 scale 观测。** `Rigid2Lock` 输出的 scale 约等于 `1/输入 scale`，而输入 `|scale| ≤ 4`，所以正的锁定 scale 恒 `≥ 0.25`，`max(min(s,1), 0.2)` 的下限永远不咬合。真正让它可观测的是**负**的锁定 scale（输入 scale 为负，或角度接近 ±180 导致符号翻转）：`max(负数, 0.2) = 0.2`。实测 3,584 个样例里有 **885 个**会因为这个常量改变而改变输出（`merge-util-minimum-scale-observability.txt`）。

两个负控的检出机制**不同**，不能一并说成走负 scale 路径：把下限改成 `0.25f`（负控 `14`）动 885 个，与把它改成 `0.02f` 完全同数，说明确实只有负 scale 路径咬合；但改成 `0.5f`（负控 `13`）动 **1,698** 个，多出来的是**正的**锁定 scale 落在 `[0.25, 0.5)` 区间的样例（证据文件里 case 6 的 `lock_scale=0.25`、case 10 的 `0.4066` 都是 `below_0.25=0 below_0.5=1`）。所以负控 13 通过正常缩放路径就能观测，只有负控 14 依赖负 scale 路径。
5. **border mode 11 无法在本单元内做变体。** 第三批交付的 `constrain_motion` 只恢复了 mode 11 这一条分支，本单元没有别的模式可切。把它记为「不可表达」，不计进检出数。
6. **`-ffp-contract=off` 是硬前提，已实测。** 用 `-ffp-contract=fast` 或编译器默认（Apple clang 21 对 C++ 默认允许收缩）重建，默认 CTest 立刻报 `Native golden changed`，原生对照在第 17 / 第 21 次调用就出现差异。记录见 `merge-util-fp-contract-prerequisite.txt`。新单元已挂进 CMakeLists 同一个 `contract_targets` 循环；任何独立编译的诊断也必须显式带上这个标志。
7. **逐位一致只在 Apple Silicon / macOS arm64 上验证。** 分解尾部对扫出来的矩阵元素调用 `powf` 与 `atan2f`，它们不是正确舍入的。十六个定点样例在本平台按逐 bit 断言，在其他平台按 `1e-5 × max(1,|期望值|)` 的容差、逐字段符号位和 NaN 分类断言；3,584 样例的指纹只在本平台断言。这是沿用第四批被云端 CI 推翻后的口径，不再假设零角度族跨平台逐位相同。
8. **`SettingInfo` 只有三个字段的作用被恢复。** 其余 15 个字段的语义没有恢复，本轮只证明 `init` 会写它们、`MergeUtil` 不读它们。
9. **`SmartMotionPipeline` 只被当作 `SettingInfo` 的真实工厂。** `process`、`update`、`preview` 都不在本轮范围内；`preview` 里排在 `MergeUtil` 之前的 `CenterFocus::Process`（`0x111a40`）也没有恢复。`ProcessDetectionImage`、VAS、Deflicker、UMVFI、VMB 一律没碰。
10. **这是从固定二进制恢复的坐标合同。** 不能据此宣称 QCut 或剪映当前界面走这条路径，也不构成任何成片像素声明。
11. **`init` 内部会走 HumanMotionDetector / `TriggerGenerator::init(string)` / `CenterFocus::Init`。** 本机七种画幅、多次构造与重复 `init` 都返回 true；若在别的机器或别的剪映版本上失败，配置回读门禁会立刻抛出而不是静默退化成假一致。

## 验证数字

| 项目 | 数值 |
| --- | --- |
| CTest（本轮前 / 后，Release） | 18 / 21 |
| CTest（本轮前 / 后，ASan+UBSan fail-closed） | 18 / 21 |
| 新增独立 C++ 检查 | 3,459 |
| 真实原生 `MergeUtil` 调用 | 387,498 |
| 落在声明域内并逐 bit 比较的调用 | 334,645 |
| 逐 bit 比较的 float32 | 1,338,580 |
| bit 差异 / NaN 分类差异 | 0 / 0 |
| 接受结果中的 NaN | 0 |
| 策略拒绝（`rigid_to_lock` 段 / 运动段 / 其他） | 42 / 52,794 / 0 |
| 其中原生返回全有限值的次数 | 51,606 |
| Release 指纹 / 边界指纹 | `6ec3506a3f95ca78` / `2c637629ae2219f3` |
| ASan+UBSan 指纹 / 边界指纹 | 同上，JSON 逐字符相同 |

样例构成：16 个定点样例（各调两次原生，共 32 次）、七种画幅各 50,000 轮随机域（共 350,000 次；`current` 按归一化量级生成，`box` 在画幅内随机且不强制左上/右下顺序）、37,422 次显式边界（七种画幅 × 九种框：整幅、零面积、四角、中心点、负零、内缩一像素、中心在幅外两种 × 角度 `-180/-90/-25/±1e-5/±0/1e-6/25/90/180` × scale `±4/±1/-0.25/1e-4/0.2/0.25/1/2.6` × 平移比例 `±1/±1e-5/±0`）、42 次奇异族、2 次死字段对照。合计 387,498 次。

原生 JSON 见 `merge-util-native-oracle-release.json` 与 `merge-util-native-oracle-asan-ubsan.json`，两者逐字符相同。

## 既有原生诊断回归

八个既有诊断全部重跑，输出与第四批记录一致（`merge-util-existing-oracles-rerun.txt`）：

| 诊断 | 关键数字 |
| --- | --- |
| `lens-native-oracle` | 与记录逐字符相同 |
| `lens-image-native-oracle` | 3,892 组、161,540,260 字节、0 差异 |
| `lens-warp-backend-native-oracle` | NEON 与 ImageTransform 各 10,998 组、0 差异 |
| `lens-transform-plan-native-oracle` | 30,307 组矩阵、363,684 个 float、0 差异 |
| `lens-temporal-native-oracle` | 65,536 帧、65,795 快照 |
| `lens-crop-selection-native-oracle` | 65,536 帧、3,208,960 个字段 |
| `lens-motion-native-oracle` | 249,411 次调用、指纹 `4417fe2981dbc217` |
| `lens-rigid-lock-native-oracle` | 1,332,811 次调用、指纹 `e1df497aa6f374b3`，与第四批 JSON 逐字符相同 |

## 负控

变体在源码副本上构建，只改一处；日志见 `merge-util-negative-controls.json`。

| 变体 | 默认 CTest | 原生对照 |
| --- | --- | --- |
| 01 模板 `tx`/`ty` 取错位 | 拒绝 | 拒绝 |
| 02 模板 `scale`/`degrees` 取错位 | 拒绝 | 拒绝 |
| 03 输出写成 `[tx, ty, degrees, scale]` | 拒绝 | 拒绝 |
| 04 把死值 `(x1-x0)/width` 当水平位移 | 拒绝 | 拒绝 |
| 05 Move 中心改用 `(W/2, H/2)` | 拒绝 | 拒绝 |
| 06 `Lock2Rigid` 中心改用 `(W/2, H/2)` | 拒绝 | 拒绝 |
| 07 `Rigid2Lock` 中心改用框中心 | 拒绝 | 拒绝 |
| 08 Move 段与 `Lock2Rigid` 段顺序对调 | 拒绝 | 拒绝 |
| 09 位移加在 `Rigid2Lock` 之前 | 拒绝 | 拒绝 |
| 10 `SettingInfo +0x10` 当 width 用 | 拒绝 | 拒绝 |
| 11 框读成 `{x0, x1, y0, y1}` | 拒绝 | 拒绝 |
| 12 去掉框中心位移 | 拒绝 | 拒绝 |
| 13 `min_scale` `0.2f → 0.5f` | 拒绝 | 拒绝 |
| 14 `min_scale` `0.2f → 0.25f` | 拒绝 | 拒绝 |
| 身份负控：错误 SHA256 | — | 在任何数值调用前中止 |
| 身份负控：错误 UUID | — | 在任何数值调用前中止 |

十四个算法变体全部被两条防线同时检出。

**如实记录为「不是变体」的一项**：把 `move_minimum_scale` 写成 double 字面量 `0.2`，两种构建与原生对照都没有差异——`0.2` 转成 float 就是同一个 binary32 `0x3E4CCCCD`。这不算漏检。

**如实记录为「不可表达」的一项**：border mode `11 → 10`。第三批交付的 `constrain_motion` 只恢复了 mode 11 分支，本单元没有别的模式可以切换；这不是本单元能构造的变体，因此不计进检出数，也不当成通过。

**如实记录为「结构性不可观测」的一项**：改动 `SettingInfo +0x10` 的取值。原生与独立实现都不受影响，因为那次载入是死读（五个毒值实测见上文）。这是被证明的不可观测，不是漏检；对应的可观测形式是负控 `10`（把这个字段当 width 用），它被检出了。

## 复现

```sh
cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-independent-lens -j8
ctest --test-dir /tmp/qcut-independent-lens --output-on-failure

cmake -S research/independent-lens-contract -B /tmp/qcut-independent-lens-native \
    -DCMAKE_BUILD_TYPE=Release -DLENS_CONTRACT_NATIVE_ORACLE=ON
cmake --build /tmp/qcut-independent-lens-native -j8
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks \
    /tmp/qcut-independent-lens-native/lens-merge-util-native-oracle \
    /Applications/VideoFusion-macOS.app/Contents/Frameworks/liblens.dylib
```

`SmartMotionPipeline` 的构造会往标准输出打印 `bytenn` / `mobilecv2` 的 banner，诊断在整个运行期间把标准输出重定向到标准错误，只在最后恢复出来写 JSON，所以标准输出上只有那一行 JSON。

原生诊断只在隔离进程中调用通过身份校验的导出函数，不启动、不注入剪映，也不读取任何草稿。
