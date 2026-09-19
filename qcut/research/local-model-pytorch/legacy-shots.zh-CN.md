# 旧版分镜网络 PyTorch 恢复记录

日期：2026-09-19。仅限本机互操作研究；未提交、未分发厂商权重、原图、原生张量或转换权重。

## 已完成

恢复 `jy_compressShotDetectBackbone` 和 `jy_compressShotDetectPredHead` 两个不带 `_new` 的网络。
单独输出 `legacy-shot-split.pt`，包含两个网络；加载使用 `torch.load(weights_only=True)`。
不复用新版的固定 arena 偏移，不替换 QCut 编辑器默认模型。

| 项目 | 旧版实测 | 新版已有实现 |
| --- | --- | --- |
| 主干图层数 | 118 | 118 |
| 主干输入 | 128x128 RGB | 96x96 RGB |
| 特征维数 | 256 | 128 |
| 时间窗口 | 11 | 7 |
| 预测头图层数 | 39 | 41 |
| 相似度分组 | 每隔 4 通道取一组，共 4 组 | 连续通道分组，共 4 组 |
| 主干 arena 字节偏移 | 16069 | 16061 |
| 预测头 arena 字节偏移 | 2780 | 2911 |

主干层名、卷积参数来自本次原生 `weight-dump`，不是从 `_new` 文件猜测。
已有主干算子实现能够接受这份独立层表；新旧 embedding 输出通道不同。
两个 256 维 GRU 使用自己的完整权重段，逐段消耗校验包含卷积、偏置、注意力缩放与 LeakyReLU 斜率。

第一次旧预测头直接套连续分组时误差为 `0.0158029`，没有通过阈值。
对照 `Reshape_15`、`Transpose_27` 后确认 GRU 输出已匹配，问题是旧图交错分组。
修正后，同样的 `1e-4` 最大绝对误差上限通过，没有放宽阈值。

## 验证证据

私有目录：`.local/jianying-model-pytorch/legacy-shots/`。

- `report.json`：两个网络、3 组确定性回读、6 组新采集原生张量对照。
- `legacy-shot-split.pt`：独立 CPU PyTorch 模型包。
- `params/engine-*/params.tsv`：两个旧模型的本次原生层表。
- `trace-backbone*` / `trace-predhead*`：seed 19、41、83，各 24 帧 128x128 RGBA；保存最后一帧的逐层即时张量。
- `probe-report.json`：固定模型 SHA256 与本次 ABI 库 SHA256。
- `direct-loader.log`：独立 ByteNN 加载接口实验记录。

| 对照项 | 三组测试最大误差 |
| --- | --- |
| 主干 256 维最终输出 | 2.09e-7 |
| 预测头概率 | 4.42e-7 |
| 两层 GRU 后的序列 | 2.76e-7 |
| 相似度图 | 1.08e-6 |

这是**相同输入张量的模型级对照**，不是完整剪映视频导入、缩放、切点阈值与时间线 E2E。
随机帧不能替代真实素材质量测试；未证明所有视频切点完全一致，未验证 MPS/CUDA 或其他操作系统。
原生 trace 的 GRU 内部独立 blob 未全部提取；验证点是两层 GRU 后可见的 `Reshape_15`。

## 重跑

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_probe.py --dump --trace --seed 19
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_probe.py --trace --seed 41
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_probe.py --trace --seed 83
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_probe.py --direct-loader
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_export.py
/opt/homebrew/bin/python3 research/local-model-pytorch/legacy_shot_test.py
```

`--out` / `--evidence` 强制在忽略目录 `.local/jianying-model-pytorch/` 内。
只在该目录创建测试图和指向原运行时的只读使用 symlink，不改原始模型、原图或草稿。
原生进程 cwd 也设在私有目录，因为原生库会额外生成 OpenCL 缓存。
本次首次运行留下的根目录缓存已搬入该私有目录，内容没有删除。
私有运行时 ABI 地址绑定两个固定动态库哈希；不接受未知版本直接解引用。

## 任意 ByteNN 加载 ABI 的边界

这次的可靠执行路径仍为：Bach system -> 自写 finder -> `compress_shot_detect` -> ByteNN -> 原生逐层钩子。
finder 可换文件，但分镜 adapter 会施加输入尺寸、窗口、特征形状；不能作为任意网络的通用执行器。

独立导出接口实验：

1. `IESNN::Net::CreateNetFromFile(const char*)` 返回非空 `Net*`，但后续反汇编确认此版本仅分配空对象、不读取路径，不能称为加载成功。
2. `IESNN::Net::GetIESNet() const` 返回非空内部指针。
3. `GetInputConfig(vector<Tensor>&)` / `GetOutputConfig` 在当前实验声明下崩溃，不记为 schema 成功。
4. `Thrustor::CreateNet(const string&, void*, vector<string>&)` 的“路径+文件内容”和“内容+哑指针”两种旧探针试参均返回 `-1`、config error。
5. `LabNetWork::GetWeight` 推理态返回空；`SaveModel` 返回 0 也未得到有效权重文件。

因此，**非空分配不等于模型加载、图清单成功，更不等于完整权重映射或张量对齐**。
`GetInputConfig` 反汇编首先访问内部 `IESNet+0x3f8` 的配置对象，之后读取 `+0x440` 的输入缓冲列表。
下一步应恢复 IESNet 初始化/配置生命周期，或恢复 `ByteNNEngineImpl` 的配置入口；不能继续靠猜指针调用批量资产。
这里不扩展外层容器解析器。批量 30 个 BM 子容器应直接接其他 worker 已校验的 extracted path；本文件的短头读取仅用于两份固定哈希分镜 arena 校验。

原生 heap scan 会命中栈上的同值虚表指针，旧 trace 因此可能崩溃。
新 `legacy_shot_trace.mm` 在 fork 子进程中检查候选层表，再在父进程对选定引擎执行，避免首个伪命中终止采集。
