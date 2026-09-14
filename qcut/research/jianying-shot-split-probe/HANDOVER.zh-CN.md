# 智能镜头分割 · 交接文档

面向接手的人。读完这一份就能知道:现在能做什么、怎么跑起来、模型长什么样、还差什么、哪些路已经走死不用再试。
背景与调用链细节看 [README.zh-CN.md](./README.zh-CN.md),符号与偏移看 [SYMBOLS.md](./SYMBOLS.md)。

最后更新:2026-09-15。

## 1. 一句话现状

剪映 11.3.0 的「智能镜头分割」模型已经能在本机脱离剪映 App 运行,并且已经接进 QCut CLI 和一个桌面网页工具;
模型的**网络结构、预处理、权重格式都已取出并用引擎自己的张量验证过**,PyTorch 复现还差最后一步。

| 事项 | 状态 |
|---|---|
| 不装剪映跑出切点 | ✅ 已实现,私有快照 + 本机桥 |
| 接进 QCut CLI (`qcut analyze shots`) | ✅ 已合并进 master,v2026.09.14.1 起可用 |
| 桌面拖拽视频出分镜表 | ✅ `~/Desktop/智能分镜`,见该目录 README |
| 模型网络结构 | ✅ 两个模型逐层取出,见第 4 节 |
| 模型权重数值 | ✅ 位置、格式、排布已验证,单层对拍余弦 0.98,见第 5 节 |
| 复现前向(PyTorch) | 🟡 结构搭好、预处理定死;整模型数值还对不上,卡在权重区前 60 层的排列顺序 |
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

## 5. 权重与复现(2026-09-15 复核)

### 5.1 先说工具:`feature-dump`,能拿到引擎自己的张量

`feature-dump.mm`(`build-bridge.sh` 会一并编译)复用桥接的加载流程,喂若干帧之后在进程内
定位 ByteNN 引擎对象,用 libbytenn 导出的 `bytenn_cpu::Thrustor::Extract(层名)` 取出**引擎自己算出来的张量**,
并用 `bytenn_cpu::ThrustorGetInput` 取出**网络真正看到的输入**。有了它就不用再靠猜来对齐:

```bash
.local/jianying-shot-split/build/feature-dump "$RT" frames.rgba 320 180 out-dir 3
```

产出 `out-dir/engine-N/features.tsv`(每层名字、四维、元素数)和逐层 `.f32`。

**要害:ByteNN 复用内存池。**一帧跑完之后,只有**形状唯一**的缓冲区还留着真值 ——
`__input`、`114 final_expand`、`115 embedding`、`116 GlobalAveragePool`、`117 Flatten`;
中间层的缓冲区已经被后面的层覆写(最明显的证据是 `Softmax_152` 里出现负数,还有 `-82.179/82.386`
这一对极值在二十几个互不相关的层里重复出现)。**拿中间层当真值会得出完全错误的结论**,
我就是先信了它,才误判「第一层结构不对」。

### 5.2 这次靠引擎张量定死的三件事

| 事项 | 结论 | 怎么验的 |
|---|---|---|
| 预处理 | NHWC `1×96×96×3`,取值 `x/127.5-1` | 引擎输入张量实测落在 `[-1, 1]`,维度直接读出来 |
| 注意力缩放 | `dim**-0.5` | 图里 `Constant_150` 实测 `0.125` = `64**-0.5`,q 的输出通道正是 64 |
| 注意力块有两个 Eltwise | `Add_160` 紧跟 `Add_161` | 118 层完整图谱,见 `features.tsv` |

### 5.3 权重:位置和格式已经验证,排列顺序还没有

文件头是可读的(图定义区加密,权重区不加密):

| 偏移 | 值 | 含义 |
|---|---|---|
| `+0x04` | 2,323,729 | 文件总长 |
| `+0x0c` / `+0x10` | 15,993 / 68 | 图定义区长度 / 偏移(这一段加密,里面找不到任何可打印串) |
| `+0x14` / `+0x18` | 2,307,596 / 16,061 | **权重区长度 / 偏移** |

权重区开头 8 字节是它自己的头,数据从字节 **16069** 开始,共 **576,896 个明文小端 float32**,
正好等于 61 个卷积的 `权重 + 偏置`(573,904 + 2,992),一个不多一个不少;
和 `Thrustor::GetWeightLen()` 报的 2,307,592 字节也对得上。

排布是 **OHWI**(`cout, kh, kw, cin`),不是 PyTorch 的 OIHW。1×1 卷积两者等价,3×3 的非深度卷积会差。

**验证方法(可复用)**:embedding 这一层的输入(114)和输出(115)都是可信缓冲区。3×3 卷积在 3×3 输入上、
中心位置的输出正好是「整个权重向量 · 整个输入向量」,于是把权重区和输入向量做一次滑动点积(FFT 互相关),
再要求 128 个输出通道**同时**命中(通道之间间距必须是 3456),就能把该层的起点唯一定死:
偏移 134402 处残差 0.023,相邻位置全都 ≥ 0.84。装进 PyTorch 单层对拍余弦 **0.981**,
这一层占全模型 77% 的参数。

还没定死的是**前 60 层在权重区里的先后顺序**。按图顺序(`params.tsv` 的层序)逐层切「权重+偏置」,
从 embedding 末尾倒着走回去正好落在 float 2(前面剩 2 个头),**边界在算术上自洽**;
但除 embedding 和 final_expand 外,每一层切出来的「偏置」幅度都在 1~33,而且所有幅度异常大的权重
(42.6 / 52.3 / 39.1 / 39.4)全是深度卷积。整模型前向因此从第一个 bottleneck 起就放大,
最终输出到 1e12 量级(引擎是 0.53)。

已经排除的解释:
- 不是按形状装错层。改成按层名装载后结果**完全一样**(不过按形状匹配本身是个隐患,已经改掉)。
- 不是 ReLU 少放。把 ReLU 加在深度卷积后 / ghost2 后 / shortcut 后 / 残差后,16 种组合全试过,
  幅度从 1e12 压到 1e6,离 0.53 还差六个数量级,余弦最高 0.33。
- 不是 OIHW/OHWI 或深度卷积 CHW/HWC 选错。16 种「顺序 × 排布」组合全试过,没有一个接近。

### 5.4 建议的下一步

把 5.3 的互相关定位法**推广到其余各层**。难点是中间层没有可信真值,两条路:

1. `bytenn_cpu::Thrustor::SetSubNet(vector<TextureLayerOutput>*, vector<TextureLayerOutput>*)` 已导出。
   用它把网络截断到某一层做输出,该层的缓冲区就不会被覆写,于是每一层都能拿到真值,
   再用互相关逐层定位。要先弄清 `TextureLayerOutput` 的布局。
2. 或者反过来:每次只喂一帧、并在**每层执行之间**取张量。需要在层的虚函数上下断点,成本更高。

拿到任意一层的可信「输入 + 输出」之后,该层在权重区的位置就能像 embedding 一样一次定死,
顺藤摸瓜把 60 层的顺序全排出来。

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
