# 智能镜头分割 · 交接文档

面向接手的人。读完这一份就能知道:现在能做什么、怎么跑起来、模型长什么样、还差什么、哪些路已经走死不用再试。
背景与调用链细节看 [README.zh-CN.md](./README.zh-CN.md),符号与偏移看 [SYMBOLS.md](./SYMBOLS.md)。

最后更新:2026-09-15。

## 1. 一句话现状

剪映 11.3.0 的「智能镜头分割」模型已经能在本机脱离剪映 App 运行,并且已经接进 QCut CLI 和一个桌面网页工具;
模型的**网络结构和权重都已取出并逐层对应好**,下一步是用它复现前向。

| 事项 | 状态 |
|---|---|
| 不装剪映跑出切点 | ✅ 已实现,私有快照 + 本机桥 |
| 接进 QCut CLI (`qcut analyze shots`) | ✅ 已合并进 master,v2026.09.14.1 起可用 |
| 桌面拖拽视频出分镜表 | ✅ `~/Desktop/智能分镜`,见该目录 README |
| 模型网络结构 | ✅ 两个模型逐层取出,见第 4 节 |
| 模型权重数值 | ✅ 已提取并按层切分,73 个张量、约 87.6 万参数,见第 5 节 |
| 跨平台(Windows/Intel Mac) | ⬜ 不可能靠移植做到,只能自训权重,见第 7 节 |

## 2. 环境前提

缺任何一项都跑不起来:

- Apple Silicon 的 Mac。桥接里的地址是按 arm64 那份切片逆向的,Intel 不行。
- 装过**剪映专业版 11.3.0**,用来生成私有快照。运行时会逐个校验 29 个文件的 SHA-256,版本不对直接拒绝。
- 私有快照在 `~/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current`,由
  `snapshot-private-runtime.sh` 生成。快照不入库、不外发。
- Xcode 命令行工具(`xcrun clang++`),首次运行要编译本机桥。
- Bun,跑 QCut CLI 和桌面工具。

## 3. 三条使用路径

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

## 5. 权重:已提取(2026-09-15)

**权重是明文 float32,直接躺在模型文件里,没有任何加密或变换。**之前以为"文件到内存有个变换",是错的:
从权重段起始按 float32 解出乱码,只是因为段开头是记录头,而且**浮点数组在段内不是 4 字节对齐的**。

判定过程:先从运行时内存里抓到确定是权重的字节当指纹,再拿去文件里搜,**原样命中**,于是确认无变换。

提取结果:

| 模型 | 权重段 | 对齐 | 连续段数 | 参数个数 | 覆盖率 | 平均绝对值 |
|---|---|---|---|---|---|---|
| backbone | 2,307,528 字节 | 1 | 142 | 572,449 | 99.2% | 0.044 |
| predhead | 1,212,876 字节 | 3 | 7 | 302,503 | 99.8% | 0.073 |

合计约 87.5 万参数。数值分布也对:平均绝对值 0.04 到 0.07,最大不超过 20,是训练出来的权重的样子。

产物在 `.local/jianying-shot-split/extracted/`(不入库):`<模型>-weights-f32.bin` 是按文件顺序拼好的 float32 数组,
`<模型>-runs.json` 记录每个连续段在权重段里的偏移与长度,`summary.json` 是上表。
提取脚本是纯离线的,只读模型文件,不需要加载运行库。

### 参数量已交叉验证

每层的类型、卷积核、输入输出通道由 `weight-dump.mm` 导出(`params.tsv`,backbone 118 层、predhead 41 层)。
按层参数算出来的总量和提取到的浮点数对得上:

- backbone:61 个卷积类层,期望 573,904 个权重,提取到 572,449,差 1,455(0.25%,是浮点段检测漏掉的零头)。
  说明权重段里**只有卷积权重,没有偏置,也没有独立的归一化参数**(应已折叠进卷积)。
- predhead:10 个卷积层共 104,448 个,提取到 302,503,多出 198,055。多出来的正是 **2 个 GRU**:
  按输入 128、隐层 128 算,单个 GRU 是 3·128·128 两组加 6·128 偏置 = 99,072,两个 198,144,与多出来的只差 89。
  这同时印证了主干输出 128 维、时序头吃 128 维。

### 逐层切分:已完成

文件布局已经确定,两个模型形状相同:

    [文件头 + 图定义]  [权重:各张量按层顺序紧挨排列的 float32]  [尾部元数据]

| 模型 | 权重区 | 层数 | 参数个数 | 尾部剩余 |
|---|---|---|---|---|
| backbone | +0x3ebd .. +0x2345fd | 61 | 573,904 | 12,052 字节 |
| predhead | +0x0b5b .. +0x12835b | 12(10 卷积 + 2 GRU) | 302,592 | 2,652 字节 |

61 层和 12 层**全部**数值正常,层序与 `params.tsv` 一致,尾部只剩元数据,没有对不上的缺口。
GRU 按输入 128、隐层 128 计算参数量,能端到端排满,等于反过来印证了这个尺寸。

用 `extract-weights.py <模型> <params.tsv> [输出目录]` 一条命令产出:每层一个 `.f32` 文件,外加
`layer-map.json` 记录层名、类型、形状、参数个数和文件偏移。产物在 `.local/jianying-shot-split/`,不入库。

当初在这一步卡了很久,三个坑记在这里:

1. **浮点数组不按 4 字节对齐**,起点要扫描确定,从文件头偏移直接解全是乱码,一度误判成"存在变换"。
2. **张量之间没有记录头**,一个接一个。中间看起来像分隔符的 4 字节其实是绝对值较大的权重,
   用"数值超过阈值就当分隔"的办法切,会把一整片连续数组切成一百多段,并让逐层锁定滑脱。
3. **权重区越过了文件头 +0x14 指的那个段边界**,一直排到尾部元数据之前。按那个边界截断会少最后一层。

下一步是把这些张量喂进 PyTorch 或 ONNX 复现前向,再用同一段视频和桥接的切点做对齐验证。
注意:运行时内存里的权重顺序和文件里不同(引擎会重排),复现请以文件里的顺序为准。

## 6. 已经走死的路(不用再试)

| 路子 | 结论 |
|---|---|
| 图配置里开 `compress_shot_detect_model_forward_type` 逼它走 CoreML | **死代码**。值读进 w23 后到函数收尾都没用过;实测填 1..6 全是 CPU 后端,无回退日志 |
| 环境变量 / AB 开关切后端 | libbytenn 里没有 |
| `LabNetWork::GetWeight(层名, Tensor*)` | 推理态对所有层名及 `.weight`/`_weight` 等变体都返回 5、data 为空 |
| `SaveModel(void*)` | 返回 0 但不按传入路径落盘,参数含义未知 |
| `Thrustor::CreateNet(string, void*, vector&)` | 那个 `void*` 是带尺寸字段的 config,为空会报 "bytenn config error"(0x20303c 附近判两个维度非零) |
| 构造 `BYTENN::Config` 调 `Init` | 没做完。config 在栈上约 96 字节,`+0x00` 是模型名 `std::string`,`+0x5c` 写 1,模型数据怎么进去还没查 |

## 7. 跨平台与"彻底脱离剪映"

两件事要分开:

- **脱离剪映 App**:已经做到,跑分镜不需要装剪映。
- **脱离剪映的代码和权重**:没有。现在仍依赖 `libcccreator` 和 `libbytenn`,以及它训练的权重。

Windows 和 Intel Mac 用不了,而且不是移植能解决的:运行库是 macOS arm64 动态库,桥接里的地址是按这一版二进制逆向的,
Windows 版剪映用 MSVC 编译,字符串和虚表布局都不同,等于重做一遍逆向。

真正的独立只有一条路:**照第 4 节的结构自训一套权重**。就算把剪映的权重完整抠出来,那也是它的资产,只能内部参照、不能随产品发布;
抠出来的价值在于当对照基准,验证自训模型有没有训到位。

## 8. 红线

- 剪映的运行库、模型、快照、反汇编产物、导出的权重,**一律不进 Git、不外发**。研究产物统一放 gitignore 掉的
  `.local/jianying-shot-split/`,快照放私有 runtime 目录。
- 本目录里只放我们自己写的工具和分析结论。
- 不解密任何加密草稿。
- 模型文件尾部带有作者的内部邮箱等构建元数据,不要摘录或传播。
