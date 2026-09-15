# 智能镜头分割 · 交接文档

面向接手的人。读完这一份就能知道:现在能做什么、怎么跑起来、模型长什么样、还差什么、哪些路已经走死不用再试。
背景与调用链细节看 [README.zh-CN.md](./README.zh-CN.md),符号与偏移看 [SYMBOLS.md](./SYMBOLS.md)。

最后更新:2026-09-15。

## 1. 一句话现状

剪映 11.3.0 的「智能镜头分割」模型已经能在本机脱离剪映 App 运行,并且已经接进 QCut CLI 和一个桌面网页工具;
两个模型、预处理和后处理**都已在纯 PyTorch 里逐位复现**(`detect_cuts_torch.py`),不再需要剪映的运行库。

| 事项 | 状态 |
|---|---|
| 不装剪映跑出切点 | ✅ 已实现,私有快照 + 本机桥 |
| 接进 QCut CLI (`qcut analyze shots`) | ✅ 已合并进 master,v2026.09.14.1 起可用 |
| 桌面拖拽视频出分镜表 | ✅ `~/Desktop/智能分镜`,见该目录 README |
| 模型网络结构 | ✅ 两个模型逐层取出,见第 4 节 |
| 模型权重数值 | ✅ 两个模型全部逐层精确切出,见第 5 节 |
| 复现前向(PyTorch) | ✅ 主干 128 维输出、预测头概率均与引擎误差 ≤ 1e-6;后处理照反汇编逐字实现,3 份素材 15 个切点全部一致 |
| 跨平台(Windows/Intel Mac) | ✅ 复现只依赖 PyTorch + 两个 .bytenn 文件;但模型文件仍是剪映资产,见第 7 节 |

## 2. 环境前提

缺任何一项都跑不起来:

- Apple Silicon 的 Mac。桥接里的地址是按 arm64 那份切片逆向的,Intel 不行。
- 装过**剪映专业版 11.3.0**,用来生成私有快照。运行时会逐个校验 29 个文件的 SHA-256,版本不对直接拒绝。
- 私有快照在 `~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current`,由
  `snapshot-private-runtime.sh` 生成。快照不入库、不外发。
- Xcode 命令行工具(`xcrun clang++`),首次运行要编译本机桥。
- Bun,跑 QCut CLI 和桌面工具。

## 3. 四条使用路径

**研究路径(最底层)**

```bash
cd research/jianying-shot-split-probe
npm run snapshot          # 一次性,从装好的剪映生成私有快照
npm run build-bridge      # 编译本机桥
./detect-cuts.sh some.mp4 24
```

**QCut CLI**

```bash
qcut analyze shots -i footage.mp4 --json      # cut_points / cut_frames / shots
qcut analyze shots --check --json             # 只看运行环境是否就绪
```

代码在 `electron/jianying-shot-split/`,命令处理在 `electron/native-pipeline/cli/cli-handlers-analyze-shots.ts`。
ffmpeg 到桥之间**必须走命名管道**,用 Bun 的流式 pipe 会丢帧,这个坑踩过。

**桌面网页工具**

`~/Desktop/智能分镜`,双击 `启动.command`,浏览器拖入视频出分镜表。它内部就是调上面的 CLI。
不在 Git 里,是本机工具,自带 README。

### 路径四:纯 PyTorch,不加载剪映运行库(2026-09-15 起)

```bash
python3 research/jianying-shot-split-probe/detect_cuts_torch.py <backbone.bytenn> <engine-4/params.tsv> <predhead.bytenn> <engine-5/params.tsv> --video 某个.mp4 --fps 24
```
只要 PyTorch、两个 `.bytenn` 和 `weight-dump` 导出的层表,Windows / Intel Mac 也能跑;结果与桥接一致(第 5 节)。

## 4. 模型结构(已完整取出)

配置在快照的 `Resources/SceneEditDetection/config.json`:输入 blit 到 96×96,7 帧滑窗,特征 128 维,阈值 0.35,
两个模型 `jy_compressShotDetect{Backbone,PredHead}_new`。

**backbone = GhostNet,118 层。** 16 组 `primary_conv` + `cheap_operation` + `Concat` 的 Ghost 模块,14 个残差 Add,
若干 MatMul/Transpose/Reshape 注意力块,末端 `final_expand_layer.conv` → `backbone.embedding` →
GlobalAveragePool → Flatten,输出 128 维,与配置的 `img_feat_dims` 对上。首层是 3 通道进 8 通道出、3×3 核、步长 2、输入 96×96。

**predhead = GRU 时序头,41 层。** 2 个 GRU、7 个 Conv、ReduceSum、LeakyRelu、`classifier.0/2/4`,最后 Sigmoid → Reshape,
输出每帧切点概率。

整体就是:每帧下采样到 96×96 → GhostNet 出 128 维特征 → 7 帧滑窗 → GRU 判边界 → sigmoid 超过 0.35 即切点。
**复刻请照这个结构,不要按 TransNetV2 猜**,那是早期的错误假设,TransNetV2 用的是 3D 卷积块,结构不同。

逐层清单(层名、类型、卷积参数)由 `weight-dump.mm` 产出,落在 `.local/jianying-shot-split/weights/engine-*/`,不入库。

## 5. PyTorch 复现:已完成(2026-09-15)

### 5.1 结论与用法

```bash
cd research/jianying-shot-split-probe
RT="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current"
python3 detect_cuts_torch.py \
  "$RT/Resources/models/jy_compressShotDetectBackbone_new_v1.0_size0.bytenn" ../../.local/jianying-shot-split/params2/engine-4/params.tsv \
  "$RT/Resources/models/jy_compressShotDetectPredHead_new_v1.0_size0.bytenn" ../../.local/jianying-shot-split/params2/engine-5/params.tsv \
  --video 某个.mp4 --fps 24
```

不加载 `libcccreator` / `libbytenn`,只读两个 `.bytenn` 文件和 `weight-dump` 导出的层表。验证结果:

| 对拍项 | 结果 |
|---|---|
| 主干 118 层逐层(引擎自己的张量) | 全部余弦 1.00000、最大误差 0.0000 |
| 主干最终 128 维输出 | 余弦 +1.000000,最大绝对误差 0.000000 |
| 预测头:GRU 堆叠 / 相似度图 / 切点概率 | 误差 4e-7 / 9e-7 / 概率 0.000786 vs 0.000786 |
| 端到端逐帧概率(cuts、soft 素材) | 最大差 0.0065 / 0.0012,平均差 6e-5 / 3e-5 |
| 端到端切点 vs 桥接 `predict_result` | cuts `71 143 215`、soft `119 125 198 201` 完全一致;拼接素材 8 个切点中 8 个一致,另多出 1 个 p=0.352 vs 引擎 0.345 的阈值边缘案例 |

唯一残差来自**缩放**:引擎 blit 节点输出 96×96 RGB uint8,我们用 `torch` 双线性(整帧拉伸、无抗锯齿、`align_corners=False`)再四舍五入,
仍有约 3% 像素差 1 级(试过 8~16 位定点、多种取整,最好 933/27648);由此概率差约 0.007,只在 p 距阈值 0.01 以内时决策才可能不同。

### 5.2 结构(全部经引擎逐层张量精确对拍)

主干(`torch_backbone.py`):
```
first_conv 3x3 s2 +ReLU
GhostBottleneck x8 (features.0/2/3/4/5/6/7/8):
    ghost1 = [primary 1x1 +ReLU] ‖ [cheap dw3x3 +ReLU]
    步长 2 的块(0/2/5/8)接 dw3x3 s2(无激活)
    ghost2 = [primary 1x1] ‖ [cheap dw3x3](无激活)
    shortcut(步长 2 的块)= dw3x3 s2 **+ReLU** -> 1x1;其余恒等;输出 = 主路 + 旁路
注意力块 x2 (features.13/14),2 头 x 32 维(头按通道分块):
    q/k/v 1x1;attn = softmax(q k^T * 0.125)(0.125 作为 1 元素常数存在权重区)
    proj 1x1 **+ReLU**;a = x + proj;**a = 2a**(图里紧挨的两个 Add)
    ff = fc1 1x1 +ReLU -> dw3x3 +ReLU -> fc2 1x1;输出 = a + ff
final_expand 1x1 +ReLU -> embedding 3x3 -> 全局平均 -> 128 维
```
预处理:NHWC 96×96×3,`x/127.5-1`(RGB,整帧拉伸双线性)。

预测头(`torch_predhead.py`):输入最近 7 帧特征 `[f-6, f]`,概率归到中心帧 `f-3`(引擎从喂入第 7 帧起产出):
```
GRU_8 -> GRU_11(128->128,单向,PyTorch 式 linear_before_reset,h0=0)
-> 128 维按连续 32 维分 4 组,每组算 7x7 帧间余弦相似度 -> (1,4,7,7)
-> Conv5x5 4->128 +ReLU -> [dw5x5 +ReLU -> 1x1 +ReLU] x3 -> 全局平均
-> Linear 128->128 -> LeakyReLU(0.01) -> Linear -> LeakyReLU(0.01) -> Linear 128->1 -> Sigmoid
```

### 5.3 权重文件布局(`arena_weights.py` / `torch_predhead.py`)

文件头明文:`+0x14`/`+0x18` 是权重区长度/偏移(图定义区加密,读不出层表;层表来自 `weight-dump` 在内存里导出的 params.tsv)。
权重区是明文小端 float32,按**图顺序**逐层「权重 + 偏置」连续排列:

| | 主干 | 预测头 |
|---|---|---|
| 权重区起点(字节) | 16061 | 2911(不 4 字节对齐,直接按字节切) |
| 长度(float) | 576,899(用到 576,898) | 303,236(最后 1 个是垃圾) |
| 额外常数 | 两个注意力缩放 0.125,各在自己的 `proj.conv` 之前 | 两个 LeakyReLU 斜率 0.01,各在 `classifier.0` / `.2` 之后 |
| GRU 块 | — | 各 98,816:`A(256x256,行 [r;z],列 [x|h])` `W_n(128x128)` `R_n(128x128)` `b_r b_z b_n_in b_n_h` |

卷积权重排布:密集 3x3 **OHWI** `(cout,kh,kw,cin)`;1x1 `(cout,cin)`;深度卷积 **HWC** `(kh,kw,cout)`。
BatchNorm 已融合进权重和偏置(所以有的偏置到 30 多、深度卷积权重到 50 多,是正常的)。

### 5.4 后处理(`detect_cuts_torch.py::cut_points`,照 libcccreator 0xcc7844 的反汇编逐字写)

算法对象里有两组逐帧数组:P(+0x440,每帧概率)和 Q(+0x458,**当前帧与前一帧 96x96 RGB uint8 图的逐字节平均绝对差**,第一帧不推,
所以 Q[k] 对应第 k 与 k+1 帧)。阈值在 +0x408,窗口半宽 `(7+1)/2 = 4`,常数 `d8 = 0.1`(0x2c46c40)。
```
for i in 1..len(P)-2:
    rising = (P[i-1] < P[i]) or carry;  carry = (P[i] <= P[i+1]) and rising
    if P[i] <= P[i+1] or not rising: continue          # 只在「上升后下降」的局部极大值处
    if not P[i] > thr: carry = 0; continue
    c = i + 4                                            # = 该窗口的中心帧
    if |P[i]-P[i-1]| < 0.1 and Q[c-1] > 2·Q[c-2]: c -= 1
    elif |P[i]-P[i+1]| < 0.1 and Q[c] < 2·Q[c+1]: c += 1
    emit c
```
硬切两侧相邻两帧概率都很高、几乎相等,靠 Q 判断边界在哪一侧;这就是为什么同样的硬切有时报旧镜头末帧、有时报新镜头首帧。

### 5.5 怎么得到这些结论(方法可复用)

1. `layer-trace`:给每种层类型的 forward 虚函数挂钩子(槽位靠计数探测:卷积虚表上 5/18/19 三个槽每层每帧各调一次),
   每层一返回就 `Thrustor::Extract(层名)`,118 + 41 层全部是真值。`feature-dump` 只在前向结束后取,内存池复用让中间层几乎全是脏数据。
2. GRU 的输出 blob 不叫层名,叫 `GRU_8.out`;层对象里还能扫出 `GRU_8_rz_blob` / `_n_blob` / `_concat_blob` 等内部 blob 名 —— 它们暴露了
   「r、z 融合成一次 [x|h] GEMM,n 单独算」的内核结构,权重排布也就跟着定了。
3. 单层权重定位用互相关:已知一层的输入输出,把权重区和输入向量做滑动点积,要求全部输出通道按固定间距同时命中。
4. 后处理规则光靠拟合概率序列猜不出来(15 个样本、几十种规则族全败),最后是 `xref` 阈值键 -> 找到 `ldr s3,[x20,#0x408]` -> 读那 60 条指令。

## 6. 已经走死的路(不用再试)

| 路子 | 结论 |
|---|---|
| 图配置里开 `compress_shot_detect_model_forward_type` 逼它走 CoreML | **死代码**。值读进 w23 后到函数收尾都没用过;实测填 1..6 全是 CPU 后端,无回退日志 |
| 环境变量 / AB 开关切后端 | libbytenn 里没有 |
| `LabNetWork::GetWeight(层名, Tensor*)` | 推理态对所有层名及 `.weight`/`_weight` 等变体都返回 5、data 为空 |
| `SaveModel(void*)` | 返回 0 但不按传入路径落盘,参数含义未知 |
| `Thrustor::CreateNet(string, void*, vector&)` | 那个 `void*` 是带尺寸字段的 config,为空会报 "bytenn config error"(0x20303c 附近判两个维度非零) |
| 构造 `BYTENN::Config` 调 `Init` | 没做完。config 在栈上约 96 字节,`+0x00` 是模型名 `std::string`,`+0x5c` 写 1,模型数据怎么进去还没查 |
| 图配置里填 `compress_shot_detect_debug_data_save_path` 想让它自己吐调试数据 | 填了可写目录,跑完一个文件都没落盘 |
| `Thrustor::GetWeight(层名)` 取内存里融合后的权重 | 和 `LabNetWork::GetWeight` 一样,推理态返回空 data |
| 扫层对象字段找权重指针 | `+0x108`/`+0x110` 指向的是全零暂存区;把每个指针字段的头 8 个 float 拿去文件权重区反查,**一处都搜不到** —— 引擎加载时对权重做了重排 |
| 拿中间层的 `Extract` 结果当真值 | 内存池复用,已被覆写。用第 1 层「真值」反解 first_conv 的 28 个未知数,残差 60~80,和数据量级相同 |

## 7. 跨平台与"彻底脱离剪映"

- **脱离剪映 App**:早就做到。
- **脱离剪映的运行库**:现在也做到了 —— `detect_cuts_torch.py` 只要 PyTorch,Windows / Intel Mac / Linux 都能跑。
- **脱离剪映的权重**:没有,也不该有。两个 `.bytenn` 是剪映的资产,只能放在本机私有目录里做内部参照,不能随 QCut 发布。

所以要上产品,路线是:用这份复现当**教师/基准**,照第 5.2 节的结构自己训一套权重(TransNet 类数据即可),
再用 `torch_compare.py` 那套逐层对拍的方法验收自训模型。复现的价值就在于把结构、预处理、后处理全部钉死了,自训时不用再猜。

## 8. 红线

- 剪映的运行库、模型、快照、反汇编产物、导出的权重、`layer-trace` 抓的张量,**一律不进 Git、不外发**。研究产物统一放 gitignore 掉的
  `.local/jianying-shot-split/`,快照放私有 runtime 目录。
- 本目录里只放我们自己写的工具和分析结论。
- 不解密任何加密草稿。
- 模型文件尾部带有作者的内部邮箱等构建元数据,不要摘录或传播。
