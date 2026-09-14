# 智能镜头分割 · 交接文档

面向接手的人。读完这一份就能知道:现在能做什么、怎么跑起来、模型长什么样、还差什么、哪些路已经走死不用再试。
背景与调用链细节看 [README.zh-CN.md](./README.zh-CN.md),符号与偏移看 [SYMBOLS.md](./SYMBOLS.md)。

最后更新:2026-09-15。

## 1. 一句话现状

剪映 11.3.0 的「智能镜头分割」模型已经能在本机脱离剪映 App 运行,并且已经接进 QCut CLI 和一个桌面网页工具;
模型的**网络结构已完整取出**,**权重数值还没导出**。

| 事项 | 状态 |
|---|---|
| 不装剪映跑出切点 | ✅ 已实现,私有快照 + 本机桥 |
| 接进 QCut CLI (`qcut analyze shots`) | ✅ 已合并进 master,v2026.09.14.1 起可用 |
| 桌面拖拽视频出分镜表 | ✅ `~/Desktop/智能分镜`,见该目录 README |
| 模型网络结构 | ✅ 两个模型逐层取出,见第 4 节 |
| 模型权重数值 | ⬜ 已确认是明文 float32、已知总长,但尚未整块导出,见第 5 节 |
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

## 5. 权重:进展与下一步

已确认的:

- **不是加密的**。整体熵 7.43 bits/byte,加密会是 7.99 以上;文件头是自洽的分段表;尾部有 XOR 0x25 的构建元数据。
- **运行时是明文 float32**,在卷积层对象里读到过真实数值(量级 0.0x 到 1.x)。
- **权重区总长已知**:`Thrustor::GetWeightLen()` 给出 backbone 2,307,592 字节、predhead 1,212,940 字节;
  文件头里权重段是 offset 68 到 0x23360c(长度 2,307,528),两者只差 64 字节。
- 但把文件那一段直接按 float32 解不是权重,说明加载时有个**不改变尺寸的变换**,这一步还没查清。

**下一步该怎么做**:不要再逐层找权重指针——偏移随层类型变化且跨进程不稳定,按 `out×in×kh×kw` 精确尺寸匹配也失败
(CPU 后端按 4 通道分块补零)。正确做法是**整块导出权重区**(长度已知),再用已经拿到的每层形状离线切分对齐。

工具:`weight-dump.mm`。做法是复用桥接流程把模型加载进本进程,再按 `vtable for BYTENN::ByteNNEngineImpl`
扫内存找引擎对象,然后走 `GetNetwork` → `GetLayers` / `GetLayerName`。注意用 `mach_vm_region` 平铺枚举,
**不要用 `mach_vm_region_recurse`**,遇子映射不推进地址会死循环;读内存用 `mach_vm_read_overwrite`,直接解引用会崩。

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
