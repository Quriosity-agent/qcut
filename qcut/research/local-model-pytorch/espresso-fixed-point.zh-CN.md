# espresso 定点图的运行库语义（探针测得）

日期：2026-09-20。运行库：`libbytenn.dylib` 3.12.30（分镜运行时 `1bf9be78…c53ad0`，与滤镜运行时的
`febfce45…` 同版本同大小），接口 `espresso::Thrustor`。工具：`espresso_oracle.mm`（原始宽度张量交换）、
`espresso_probe.mm`（结构探针 / 护页模式）。所有规则都由单层构造图对拍得到；运行库对图与 arena 只校验尾部图戳，
所以可以随意构造探针（探针图与结果在 `.local/jianying-model-pytorch/face-capture-20260920/micro*`）。

## 图文本

- 头：可选的单字母行（`D`、`B`；`E` 为 fp16，见显著性抠像记录），随后 `<输入数> <层数> <戳>`；老格式只有
  `<输入数> <层数>`，输入行是 `data n h w c type frac` 而非 `DataV2 … type frac …`。行尾可能带字面 `\n`。
- 存储描述符 `(type, frac)`：type 1 = int8，2 = 16 位存储（值域 ±2047），4 = float32；frac 为小数位数。
- 卷积行：`名 co kh kw sh sw ph pw bias relu  w_t w_f  b_t b_f  o_t o_f  in out`；`b_f = w_f + 输入 frac`。
- `DilationSeparableConvolution 名 co kh kw dh dw sh sw ph pw bias relu  存储×3  in out`：膨胀深度可分离卷积，`pad = dilation` 时尺寸不变（探针 micro-dil）。
- `Slice 名 in 1 1 K 2 out0 f0 out1 f1`、`ShuffleNet 名 2 inA inB 4 2 out0 f0 out1 f1`、`Shuffle 名 4 2 in out`、
  `Crop 名 oy ox oc oh ow oc' in out`、`Upsample 名 f linear 0 1 in out`、`Constant 名 <空> 0 n h w c out t f`、
  `OnnxOp1 名 Reshape in out t f n h w c 2`、`Pooling 名 kh kw sh sw ph pw t f MODE in out [GLOBAL]`。

## arena

| 项 | 规则 | 证据 |
| --- | --- | --- |
| 核布局 | 稠密 `(co, kh, kw, ci)`，ci 最内；深度可分离 `(kh, kw, c)` | 探针 A/D/G/DW1（3×3 中心脉冲读出抽头编号） |
| type-1 核 | int8，1 字节 | 精确 arena 长度核算 |
| type-2 核，`B` 头 | 12 位打包：每对 3 字节 `b0 b1 b2`，`w0 = (b0<<4) \| (b1>>4)`，`w1 = ((b1&15)<<8) \| b2`，值 = raw − 2047，raw 4095 就是 2048（不钳） | 探针 F/F2a/D4095；10 张 `B` 网络长度核算；皮肤分割网络第 16 块的差 1 就是这个 |
| type-2 核，无字母头 | int16 小端，2 字节 | 老格式对齐/虹膜网络长度核算 |
| 偏置 | 紧跟本层核之后，int32 小端，标度 = 累加器标度 `w_f + in_f`；浮点层为 float32 | 探针 C/DW2（偏置放前面则输出饱和） |
| 全连接 | float32 `(co, ci)`，ci 按 NHWC 展平；偏置随后 | 探针 L |
| `Constant` | 按 dims 与 type 读取 | facefitting MLP 长度核算 |
| 尾戳 | 带戳图的 arena 以小端 uint32 戳结尾，缺失即 `bytenn weight not match net` | 收集脚本的负对照 |

## 算术

| 算子 | 规则 | 证据 |
| --- | --- | --- |
| 卷积 / 深度可分离 / 全连接式 1×1 | `acc32 = wrap32(Σ w·x + bias)`（int32 回绕，稠密与深度可分离都一样），`y = (acc32 + 2^(s-1)) >> s`（舍入加法本身**不**回绕，算术右移，`s = w_f + in_f − o_f`），ReLU，饱和到 int8 −128..127 或 type-2 ±2047 | 探针 B（半向上：0.5→1，−0.5→0，−1.5→−1）、E、W1–W3（ci=1024 极值、偏置 2,147,483,000 回绕成负）、W32（mask 网络的死通道）；人体热图网络偏置 −2^31 的通道证明舍入加法不回绕 |
| 输入 | `data` 与超范围的中间 blob（见 ShuffleNet）都不钳制地参与乘法 | 探针 F2b、OOR-CV |
| float 图（存储 `4 0`） | 卷积/全连接按 float32 累加（顺序未固定，~1e-5）；Eltwise/Concat/Slice 直接运算；`UpSampling LINEAR` 为 `(9a+3b+3c+d)/16`；平均池化为 float32 求和再除 | relight 网络 136 层全部 `≤1.3e-5` |
| Eltwise | 输入移到较细的 frac 相加，再一次半向上重量化到输出 frac，ReLU，饱和 | 探针 EL（`[1,2,3,6]@7 + 1@6 → [1,1,1,2]@5`，逐输入模型给 `[1,2,2,3]`） |
| Concat | frac 不同的输入半向上重量化到输出 frac 并饱和；frac 相同的输入原样透传（超范围值也不钳） | 探针 I、OOR-CC |
| Slice | 前 K 通道 / 其余通道；frac 变化的一半重量化并饱和，不变的一半原样透传 | 探针 K/SL/SL2/OOR-SL |
| Shuffle 4 2 | `(2, C/8, 4)` 转置为 `(C/8, 2, 4)`：4 通道为一块、两组交错 | 探针 K（16 通道 → `1-4,9-12,5-8,13-16`） |
| ShuffleNet 2 a b 4 2 | concat → Shuffle 4 2 → 对半切；每个通道从各自来源 frac 半向上重量化到所落半边的 frac。int16 版本随后**单边**钳制且与是否重量化无关：每 8 通道的前 4 个只封上限 2047、后 4 个只封下限 −2047，因此 −4094 或 4094 这类超范围值会留在 blob 里流向下游；int8 版本正常双侧饱和 | 探针 SN/SN2/SN3/SN16/OOR-SN、int8 探针 micro11 |
| Pooling AVE（整数输出） | `floor(sum/k² + 0.5)`；MAX 取最大 | 探针 J |
| Pooling / PoolingDown（float 输出，含 GLOBAL） | `float32(sum) / k² / 2^frac` | 探针 J/PF（5×5 各种写法结果相同） |
| UpSampling LINEAR ×2 | 半像素双线性、图外**零填充**、`(9a+3b+3c+d)>>4`（向下取整） | 探针 O |
| UpSampling BILINEAR ×2 | 与 `Upsample 2.0 linear 0 1` 相同：边缘钳制、向下取整 | 探针 UPB |
| Upsample f linear 0 1 | 半像素双线性、图外**边缘钳制**、精确有理数后向下取整 | 探针 U4（×4、×2） |
| Crop | `oy ox oc oh ow oc'` | 探针 O |
| Reshape / OnnxOp1 Reshape | 按 NCHW 逻辑序展平再按目标维度读回 | `Reshape_805` 四种候选只有 NCHW 序全对 |
| InnerProduct | 输入反量化 `x/2^f`，float32 `x·Wᵀ + b`（累加顺序未固定） | 探针 L |
| Sigmoid（float 输入） | float32 | 探针 L |
| Softmax，SIMD 块像素（像素数按 4 分块的整块部分） | 两类（不论输入类型）：指数相对**通道 0** 取，`p0 = exp(0) × FRECPE(exp(0) + exp(x1−x0))`，`p1 = 1 − p0`；多类定点输入：`exp(x−max) × FRECPE(Σ)`（AArch64 8 位查表倒数估计，不做牛顿修正）；多类 float 输入：`exp(x−max) / Σ` | 探针曲线 `micro6/p1.npy`（4095 点 99.7% 逐位一致）、`micro12`、`micro-sm`（16×16 float 两类逐位一致，3/5 类真除法 `≤9e-7`）、relight 的 256×256 两类头逐位一致、两张 4 类 `prob` 逐位一致；仅两类并列点 `x0 == x1` 上运行库自己的 `exp(0)` 略小于 1，差 `9.8e-4` |
| Softmax，标量尾像素（1×1 全连接头、1×2、2×1 等不足 4 像素的余数） | `exp(x−max) / Σ`，与类数、输入类型无关 | 探针 `micro-sm2`（1×1 的 2/3/4/5 类全部逐位或 `3e-8`），分类网 `prob` 回到 `1.2e-7` |
| ReInferShape(a, b) | 参数序为 (宽, 高) | 检测器 (576, 320) 后 blob 为 h=320, w=576 |

## 密文 BM 容器与 SMASH 包装

- 文件里 `BM\0` 段为密文的容器（BM v2/v4：`nodehub_c3_300`、`tt_matting_large/relight/v15`、`mask`、`facefitting_3d`），运行库自己会解密：
  把容器喂给公开的 `EngineFactory::Create()` + `Init(Config)`（`bytenn_init_host.mm`，Config 布局取自捕获到的 Init 参数块：
  int32 forwardType、int32 threads、模型指针、uint32 长度、int32 缓冲标志，其余清零），注入捕获器后从堆里得到明文图与戳窗口，
  `espresso_heap_carve.py` 按图核算长度切 arena 并用运行库验证。解密后 arena 长度与容器第二段长度相等，密文保长。
- SMASH 自己的 `versioned-model-wrapper`（`tt_face_attribute_*`、`tt_faceverify`、`tt_skeleton*`、`tt_body_detection_lockon`、
  `tt_after_effect`、`tt_matting_video_v1.2`、`tt_face_extra_fast`）是 AES：`smash::AES_DecryptWrapper(data, len, key, keylen, &out, &outlen)`
  有导出，但密钥不在库的字符串里（88,063 个 8–64 字节字符串逐个试过，三种载荷起点都无命中）；`SK_InitModel/FromBuf`
  对 `tt_skeleton_v9.2`/`tt_skeletonlockon` 报 "buf data len is far less"（不是该接口的包），枚举类型 1 还会段错误。
  这些文件只剩"由能加载它们的产品路径触发后堆扫描"一条路。

## 捕获相关的坑

- dyld `__interpose` 只能拦跨库调用：SMASH → `espresso::Thrustor::CreateNet` 可拦，`Init(ConfigExt)` 内部的
  `CreateNet` 拦不到；改为复制引擎对象的 vtable 换掉 `Init` 槽位（按符号名找槽），再扫描堆。
- 就地改写签名运行库的代码页会被 SIGBUS 杀掉（macOS arm64 代码签名），不要走这条路；lldb 因 Developer mode
  关闭无法附加。
- `mach_vm_region` 的段可能与相邻段连续（arena 跨段）；对"可读"段直接 `memmem` 会 SIGBUS，必须用
  `mach_vm_read_overwrite` 拷贝；`8u*1024u*1024u*1024u` 在 32 位无符号里溢出为 0。
- `TensorView.dims` 是 `(n, w, h, c)`；`GetWeightLen` 返回 "Not support"；`BYTENN::Decoder(uint8*, uint8*, int)`
  不是容器密码；一权重层的 12 位打包（半个三字节组）会让 `CreateNet` 失败，真实网络的核元素数都是偶数。
- `Init(Config)` 收到的 config 块可能位于"报告可读但直接访问即 SIGBUS"的页（人体关键点包），捕获器里所有落盘都改走
  `mach_vm_read_overwrite` 拷贝后再写。
