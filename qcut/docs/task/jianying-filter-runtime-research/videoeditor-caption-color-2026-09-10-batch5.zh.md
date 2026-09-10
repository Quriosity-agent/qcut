# VideoEditor Caption 颜色求值器合同（2026-09-10，第五批）

本轮恢复两件东西，都在 `libvideoeditor.dylib` 11.3.0 arm64 里：

1. **Caption 颜色路径的求值本体** —— 未导出的局部函数 `slide+0x33f1e9c`，签名
   `std::vector<double>(const std::vector<double>&, const std::vector<double>&, float)`，sret 走 x8。
   它把两端 RGB 各自转成极坐标（hue / saturation / peak），走最短弧混合，再按扇区表还原并
   经 255 整数量化输出四个 double。
2. **门禁的叶子谓词** —— 导出符号 `lyra::CaptionAnimUtils::isCaptionType(std::string const&)` @ `0x2a1e6b8`，
   六个类型名的长度加比较。

473,918 次真实调用、1,895,672 个 double 逐位一致，0 处不一致；50 次谓词对照 0 处不一致。

**这一批关不掉整条 Caption 颜色路径。** 求值本体和叶子谓词是路径的两个零件；门禁的 `SegmentText`
一侧（`isCaptionText`、四个颜色 key 比较、`(rp-lp) > 0`）以及从 `getPropertyValuesByTimeOffsetInner`
端到端走进 `0x33f4c84` 都**没有**真实原生差分，第 4 节逐条写明。

源码入口 [caption_color.hpp](../../../research/independent-editor-contract/caption_color.hpp)，
实现 [caption_color.cpp](../../../research/independent-editor-contract/caption_color.cpp)，
语料 [caption_color_fixtures.hpp](../../../research/independent-editor-contract/caption_color_fixtures.hpp)，
独立测试 [caption_color_tests.cpp](../../../research/independent-editor-contract/caption_color_tests.cpp)，
诊断程序 [caption_color_probe.mm](../../../research/independent-editor-contract/caption_color_probe.mm)。

本批起点 HEAD `f628548eac0953bd8cb780d47bede7dae298d7f1`，工作树 `qcut-binary-cpp-scaleup-wt/qcut`，
分支 `codex/jianying-binary-cpp-batch4-20260910`。全部原始证据在
`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/batch5/editor/`；厂商二进制、反汇编、原生 JSON
与全部 mutant 产物都留在仓库外。

## 1. 身份与对象来源

| 镜像 | SHA-256 | arm64 UUID |
| --- | --- | --- |
| `libvideoeditor.dylib` | `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab` | `22337058-B217-3CAF-9979-CFECA7302CF7` |
| `libcccreator.dylib` | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` | `100726E3-FCB0-31BC-98EE-1B196A1714A3` |

诊断沿用既有 `native_library.hpp::load_verified`：请求文件 SHA-256 → `dlopen` → `dlsym`
锚点 `_ZNK4lvve14MaterialEffect9get_valueEv` → `dladdr` 回查实际镜像文件再哈希一次 → `MH_MAGIC_64`
+ `CPU_TYPE_ARM64` → 遍历 load command 取 `LC_UUID` 比对 → 断言锚点等于 `base + 0xf1cc6c`。
第二镜像走 `getVEUtils` @ `0x1c3077c` 的同一套门禁。

**`0x33f1e9c` 没有符号**（`nm` 里该地址无定义，最近的前置定义符号是 `0x33f15ec` 的
`KeyframeEnableHelper::prePasteMaskKeyframe`），所以调用前额外比对该地址前 12 个指令字，
`0x2a1e6b8` 比对前 8 个。两组常量都由 `identity.txt` 里直接读镜像字节复核：

```
0x33f1e9c: d10243ff 6d033bef 6d0433ed 6d052beb 6d0623e9 a9074ff4
           a9087bfd 910203fd aa0803f3 9000b828 f9428d08 f9400108
0x2a1e6b8: a9be4ff4 a9017bfd 910043fd aa0003f3 39405c0a 13001d49 f9400408 7100013f
```

**对象来源**：本单元不需要任何 SDK 对象。只传 `std::vector<double>` 与 `std::string`；`otool -L`
确认厂商库链接系统 `/usr/lib/libc++.1.dylib`，两侧共用同一份容器 ABI 与分配器；返回向量由厂商侧
`operator new` 分配、探针侧析构。没有伪造 vtable、shared 控制块或对象存储。

## 2. 分支地图

反汇编在 `batch5/editor/recon/`（`color_interp_helper_33f1e9c.arm64.txt`、
`isCaptionType_string.arm64.txt`、`caption_color_path.arm64.txt`、`caption_gate.arm64.txt`）。

| 静态定位 | 恢复的行为 | 本轮动态证据 |
| --- | --- | --- |
| `0x33f1ed0` / `0x33f1ee4` | 两侧各算 `(end-begin)>>3` 再 `cmp #3 ; b.lo`：少于三个 double 落回落值 | 16 组 0..3 × 0..3 形状，其中 15 组落回落值、(3,3) 那组正常求值；`shapeFallback` 合计 16 次（另 1 次来自 golden） |
| `0x33f1efc`…`0x33f1f08` | `fcmp s0,#0.0` + `fccmp s8,#1.0,#0,pl` + `b.gt`：门禁精确等于 `t<0 \|\| t>1`，**NaN 不落门禁** | `rangeFallback` 25,736 次；NaN 进度另见第 6 节 |
| `0x33f1fac`…`0x33f1fd0` | 回落值取自 `0x47be4f8` 的 32 字节常量池 | 直接读镜像：`0,0,0,0x3ff0000000000000` |
| `0x33f1f0c` / `0x33f229c` | 入口 scale 是 binary64 `0x406FE00000000000`，出口 scale 是 binary32 `0x437F0000`，两个不同字面量 | 实现里写成两个常量，合并即改变算术 |
| `0x33f1f20` / `0x33f21b8` / `0x33f22b0` | `fcvtzs`：向零取整 + 饱和，NaN→0；double 与 float 两个重载的正向边界不同 | `narrowing_semantics` 单测钉死两个边界 |
| `0x33f1f38` | `subs w11,w10,w9` 同时给出有符号比较标志和**回绕**的 r−g，且该差值留到 240° 臂复用 | mutant M10（差值改饱和）91,966 次检出 |
| `0x33f1f60` vs `0x33f2090` | 左操作数 `cbz` 跳过除法，右操作数无条件除后 `fcsel`：右侧真的算 0/0，但选中的值相同 | 实现按同一形式写出，注释记录不对称 |
| `0x33f1f78` / `0x33f1fd4` / `0x33f200c` | 三条 hue 臂 `+0/+360`、`+120`、`+240`，常量 `0x42700000/0x43b40000/0x42f00000/0x43700000` | 左侧 151,929 / 148,640 / 146,131；右侧 152,628 / 148,713 / 145,355 |
| `0x33f1fa0` | 加 0° 还是 360° 由 `subs`+`b.ge` 的**有符号**比较决定，不是回绕差值的符号 | mutant M4（`>=` 改 `>`）1,022 次检出 |
| `0x33f2004`→`0x33f2034` | 加 0° 是一条真 `fadd`，不是空操作 | 见第 6 节 M14 |
| `0x33f200c` `cmp w14,w12 ; b.gt` | 到达该臂时必有 `upper < blue`，`b.gt` 结构性不可达 | 896,332 次极坐标转换里 else 侧计数**恒为 0** |
| `0x33f2144`…`0x33f217c` | `fabd` + 180° 比较 + 两个 `-360.0f` 的 `fadd` + `pl`/`le` 两组 `fcsel`：谁大谁减 360，NaN 两侧都取「短弧」 | `rotatedArc` 121,117 次；M1 检出 103,880、M2 检出 3,432 |
| `0x33f2180`…`0x33f2188` | 混合是 `fsub`/`fmul`/`fadd` 三条独立指令，**没有 fmadd** | mutant M3（融合）14,688 次检出 |
| `0x33f2198` | 负 hue 回加一圈，且只加一次 | `correctedNegativeHue` 59,814 次 |
| `0x33f21a8`…`0x33f21c8` | `hue/60` → `fmodf(·,6)` → `fcvtzs` → **无符号** `cmp #5 ; b.hi` | `sectorFallback` 3,051 次；M11（改有符号）3,050 次检出 |
| `0x33f2204` | 小数部分取自未折叠的 `h6` 减去折叠结果的截断，不是折叠结果本身 | mutant M5 检出 7,848 次 |
| `0x33f220c`…`0x33f222c` | `p=V(1−S)`、`q=V(1−Sf)`、`u=V(1−S(1−f))`，全是独立指令 | — |
| `0x47be4c8` 跳表 | 六个字节 `00 03 07 0b 0f 13` → 六个块，解出 (V,u,p)/(q,V,p)/(p,V,u)/(p,q,V)/(u,p,V)/(V,p,q) | 六个扇区分别 85,107 / 72,018 / 73,271 / 71,333 / 72,855 / 70,531 |
| `0x33f229c`…`0x33f22ec` | 每通道 ×255 → `fcvtzs` → `scvtf` → ÷255 → `fcvt d,s`；第四个元素是字面量 1.0 | M6（去量化）369,997 次检出；473,918 次调用第四元素恒为 `0x3ff0000000000000` |
| `0x2a1e6b8` 六段 | 先比长度再 `compare(0,npos,lit,N)`：`page`/`word`/`word_unread`/`line`/`line_unread`/`keyword` | 25 个串各跑内联与预留堆缓冲两种布局共 50 次对照，0 处不一致；M12（前缀匹配）检出 20 处 |

四个 key 字面量与六个类型字面量都是直接读 `__TEXT,__const` 得到的，地址与长度记在 `identity.txt`：
`KFTypeTextColor`(15)/`KFTypeBorderColor`(17)/`KFTypeShadowColor`(17)/`KFTypeBackgroundColor`(21)。

## 3. 与已交付子域的差别

线性属性路径（`linear_property` / `property_dispatch`）全程 binary64；Caption 颜色路径在
`0x33f4c9c…0x33f4ca8` 把同源的分子分母 `scvtf` 成 double 相除后再 `fcvt` 成 **binary32**，
后面整条求值都在 float 里跑。这是两条路径第一处可观察差别，写成
`caption_color_progress(std::int64_t, std::int64_t)`。

**这四条指令只是转录，没有原生差分**：驱动外层分支需要真实 `SegmentText`，本批没有找到合法工厂。
函数本身的语义由 standalone 测试钉死（binary64 相除后单次窄化，与「先各自转 float 再除」在
`69769528 / 104144162` 上答案相邻），但它**不计入零差异的那 473,918 次**。

输出**不做 UI 范围钳位**：`{inf,0,0}` 与 `{0,0,-inf}` 在 t=0.5 的真实返回是
`{4210752.5, 3158064.5, 2105376.25, 1.0}`，远超 1.0。已作为 golden 钉进测试。

## 4. 明确没有关闭的东西

1. **`isCaptionText`（`0x2a1e5a0`）没有还原。** 它是 `shared_ptr` 判空 → `___dynamic_cast` 到
   `lvve::SegmentText`（typeinfo `0x4c227f0`，源 typeinfo `0x4c16bc8`）→ `get_caption_info()` 判空 →
   调 `isCaptionType` 的对象图管道。本批只做静态记录。第四批实测「它对 `SegmentVideo` 返回 false」
   的结论保持不变，没有升级。
2. **端到端没有走通。** 从 `getPropertyValuesByTimeOffsetInner` 进入 `0x33f4c84` 需要真实
   `SegmentText`，本批没有找到合法工厂，因此**没做**。「四个颜色 key 常量比较」「`(rp-lp)>0`」
   「`isCaptionText && …`」这三段门禁仍然只是第四批的静态结论加上那 1,156 次「换 key 结果不变」
   的旁证，**不是本批验证过的**。
3. **进度窄化只有转录、没有验证**（见第 3 节），单列，不混入零差异计数。
4. **`property_dispatch.cpp` 没有接上本单元。** 那里的 `throw` 保持原样。接上会引入一条在现有语料下
   没有原生对应的复合分支（`isCaptionText(SegmentVideo)` 恒为 false），并且会改变
   `property_dispatch` oracle 的 JSON，破坏回归比较。是否连接留给编排者决定；本批**没有悄悄接上**。
5. **11 条 Segment 默认取值链（`0x33f3848`…`0x33f412c`）一条都没动。** 本批只解析了 11 个 typeinfo
   地址供下一批用：`0x4c25220` SegmentVideo、`0x4c191c0` SegmentAudio、`0x4c1e7f8` SegmentPictureAdjust、
   `0x4c1bb30` SegmentFilter、`0x4c21300` SegmentSticker、`0x4c1d960` SegmentImageSticker、
   `0x4c1c8a8` SegmentHandwrite、`0x4c227f0` SegmentText、`0x4c23888` SegmentTextTemplate、
   `0x4c28af8` SegmentVideoEffect、`0x4c20668` SegmentShape。
6. **带 graph 的分派路由 `0x33f47f0` 仍整体划出域。**
7. **`0x33f200c` 的 `b.gt` 臂结构性不可达**：896,332 次极坐标转换里 else 侧恒为 0。只做文档记录，
   没有伪造测试去「覆盖」它；实现里那条 `if (upper <= blue)` 也保留，因为删掉等于断言一条二进制里
   没有的证明。
8. **无符号扇区越界（`b.hi`）虽然可达但只经由 int32 回绕**：3,051 / 473,918 次，全部来自通道饱和到
   `INT32_MAX`/`INT32_MIN` 之后差值回绕。这是二进制语义上可达的真实分支，**不是产品上会发生的输入**。
9. **`fmodf` 依赖系统 libm。** fmod 是精确运算、没有舍入，符合标准的实现不应有差异，但它仍是外部依赖；
   本机结果不代替 Linux/Windows CI 的实际结果。
10. `caption_color_to_polar` 对少于三个 double 抛 `std::invalid_argument`。这是本 API 自己的定义域限制，
    不是恢复出来的原生校验：原生的调用方在转换前先做形状测试。

## 5. 可重复验证

Release 与 Debug ASan/UBSan 两次 oracle 的整份 JSON **完全相同**（`native-release.json` /
`native-san.json` 直接 `diff` 无差异），`passed=true`、0 mismatches：

| 项目 | 数量 |
| --- | ---: |
| 求值器真实调用 | 473,918 |
| 共享语料调用（standalone 复算的那部分） | 473,901 |
| 逐位比较的 double | 1,895,672 |
| 不一致 | 0 |
| NaN 输出 | 0 |
| 谓词对照（25 个串 × 内联/预留堆缓冲两种布局） | 50 |
| 其中容量大于 22 的堆缓冲 | 25 |

语料构成（完全确定性，不用 `<random>` 的分布，只用 `mt19937_64` 的规定输出）：
17 个边界值三重叉乘 17³ × 14 个 progress = 68,782；0..1 色立方 1/8 步长 9³ × 7 个 progress = 5,103；
400,000 组伪随机（每个通道 1/7 概率注入 14 个极值之一）；16 组 0..3 × 0..3 形状门禁。合计 473,901。
再加 17 个具名 golden，共 473,918。

路径直方图覆盖全部 473,918 次调用（含 17 个 golden）：`sector0` 85,107、`sector1` 72,018、`sector2` 73,271、`sector3` 71,333、`sector4` 72,855、
`sector5` 70,531、`sectorFallback` 3,051、`rangeFallback` 25,736、`shapeFallback` 16。
最短弧旋转 121,117 次，负 hue 回加一圈 59,814 次。

standalone 测试不加载厂商库，钉住 17 个原生 golden 的逐位结果、整条语料的**原生数值 FNV-1a
指纹** `9426952596422373182` 与分支归属指纹 `1057191529647246839`。
统一入口 CTest 本目录 14 → 15，Release 与 sanitizer 各 15/15 通过，构建 0 warning。

门禁核验（`gate-checks.log` / `gate-fast-math.log`），七项全部非零退出：
无参数、错误镜像（传 `libAGFX.dylib`）、相对路径、第二镜像传成第一个、改掉任一钉死指令字、
`-ffast-math`、`-ffinite-math-only`。

## 6. 负控（14 个，全部由改动**交付源码本身**生成）

驱动脚本 `mutants/build-and-run.py` 每次只对 `caption_color.cpp` 做一处文本替换，然后
（a）对着真实求值器跑同一条 473,901 次语料，（b）用同一份 mutant 源码编译 standalone 测试。
基线 M0（未改动）两侧都为 0，harness 本身是干净的。

| 变体 | 原生检出 | standalone 检出 |
| --- | ---: | --- |
| M1 弧向对调 | 103,880 | 是 |
| M2 180° 边界改严 | 3,432 | 是 |
| M3 混合改成 fma | 14,688 | 是 |
| M4 红臂 `>=` 改 `>` | 1,022 | 是 |
| M5 小数部分取自 fmod 结果 | 7,848 | 是 |
| M6 去掉 255 量化 | 369,997 | 是 |
| M7 NaN 进度按越界处理 | **0** | 是 |
| M8 G/B 通道对调 | 421,581 | 是 |
| M9 负向饱和差一 | 7,881 | 是 |
| M10 通道差值改饱和 | 91,966 | 是 |
| M11 扇区判定改有符号 | 3,050 | 是 |
| M12 类型谓词改前缀匹配 | 20（谓词侧） | 是 |
| M13 进度改成 binary32 相除 | **0** | 是 |
| M14 去掉红臂的 0° 加法 | **0** | 是 |

**三个原生未检出项，如实分类：**

- **M7「NaN 进度按越界处理」——结构性不可观测，不是漏检。** NaN 进度沿正常路径走下去，S/V/f/p/q/u
  全为 NaN，被 `fcvtzs(NaN)=0` 的量化器压成 `{0,0,0,1}`，与门禁回落值逐位相同。原生返回值里没有
  任何位可以区分两者。只能由 standalone 的路径断言抓（`A NaN progress passes the range gate and
  lands in the first sector`）。
- **M13「进度改成 binary32 相除」——本批不存在原生差分。** `caption_color_progress` 对应的四条指令
  在本批没有任何真实调用点（见第 4 节第 2、3 条），所以 oracle 结构上就看不到它。变异本身是真的，
  harness 里的 `transcribedProgressChanged` 标志为 true，standalone 抓得住。
- **M14「去掉红臂的 0° 加法」——结构性不可观测，且已定点确证不是语料覆盖不足。** 专门写了
  `mutants/zero-turn-reach.mm` 沿同一条语料统计：语料实际发生的 896,302 次极坐标转换里，**有 915 次**
  真的走到「红臂 + 商为 −0.0 + 选中 0° 转」这个状态，交付实现每次都产出 +0.0 而变体每次产出 −0.0；但
  这个符号差在后续混合、`fmod`、p/q/u 里被完全吸收，473,901 次调用没有一个输出位改变。
  只能由 standalone 的 `float_bits(zero_turn.hue) == 0U` 抓。

没有为了让表好看而删变体或补样例。

## 7. 回归

本条线四个既有原生 oracle 全部用同一份构建重跑，JSON 与第四批记录
（`/Users/peter/Downloads/QCut-Binary-CPP-2026-09-10/editor/property-dispatch/`）**逐字节相同**：

| oracle | 结果 |
| --- | --- |
| `editor-property_dispatch-probe` | 与 `native-final.json` 完全相同 |
| `editor-graph-probe` | 与 `regression-graph.json` 完全相同 |
| `editor-nonlinear_property-probe` | 与 `regression-nonlinear_property.json` 完全相同 |
| `editor-variable_graph-probe` | 与 `regression-variable_graph.json` 完全相同 |

本批只新增文件与一行 CMake 注册，没有修改任何既有单元的实现。
