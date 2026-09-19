# nn_denoise PyTorch 同张量恢复

2026-09-19。本机互操作研究，不发布原模型、解码图、权重和原生张量，不声明真实视频降噪质量。

## 本次结果

- 模型来源：`JianyingBasicVideo/current/Models/noise_reduction/nn_denoise.bytenn`。
- 源 SHA256：`3dfdbefcd5da99fde8b54b01c96ce58625b0feb2e2307b9b7bae71a5817b8a83`。
- 28 个节点：3 个输入、15 个卷积、4 个 BILINEAR 上采样、5 个残差加法、1 个拼接。
- 共 62,779 个 FP32 参数；按图消费全部参数，仅末尾 4 字节不是参数。
- 3 个输入均为 `[1,3,1088,1920]`，输出 `Add_38` 同形状。网络残差加到 `data1`。
- “三个输入是相邻视频帧”的产品调度顺序、归一化、tile、颜色空间尚未取证；工具保留全部显式输入，不假装单图模型。

原始尺寸 `.local/jianying-model-pytorch/denoise-original/report.json`：
零输入与两个独立随机输入 case 均通过固定 `max_abs <= 1e-4` 阈值，最大误差约 `1.02e-6`。
输入经原生 `Extract` 回读逐值一致，权重和前向保存/重载均逐值一致。
原生输出包含形状、序列化 float32 存储格式、布局 schema，读取时严格检查字节长度与有限性。
Tensor 尾部 `+24` / `+28` 两个 int32 只按原值写入 `tensor-descriptors.tsv` 与报告，不把它们解释成已验证的 dtype。
输入和输出均先检查非空指针以及原生完整 `NWHC == [1,width,height,3]`，通过后才复制缓冲；原生 `--self-test` 覆盖空指针、交换尺寸和每一维不匹配。

缩小尺寸 `.local/jianying-model-pytorch/denoise/report.json` 是 64x64 派生图，
只允许标记 `limited-derived-shape-parity-passed`，不等于原尺寸验证。
两批权重相同，输入 shape provenance 不同。报告分别保存原始尺寸和派生尺寸。

## 可复用的原生入口

只针对已审计 libbytenn SHA256 `1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`。
没有使用 `IESNN::Net::CreateNetFromFile`，此版本该接口仅分配空对象，不证明模型已加载。

1. `bytenn_cpu::Thrustor` 构造到足够大的对齐本机对象空间。
2. `CreateNet(const std::string&, void*, vector<string>&)`：字符串是**解码后的图文本**，指针是**权重 arena**，不是文件路径或整个 BM 文件。
3. `SetInput(std::string, void*, int, int, int)`：第一个整数是**字节数**，后两个整数在该版本此路径未使用，传 0。只传尺寸会出现返回成功却仅复制输入开头的情况。
4. `Inference()` 返回 0 后，`Extract(const string&)` 以 32 字节 POD 的 sret ABI 返回 data 指针、4 个 int32 维度和两个额外字段。
5. 数据实际布局为 NHWC，但返回 Tensor 的四个维度字段按 NWHC 排列，原始非方形输入确认返回 `1,1920,1088,3`。每次原生调用都保存输入、原生回读输入和最终输出，确保不是只对齐零输入。

`CreateNet` 的输出名字 vector 在这个模型中为空，不能把空 vector 当作失败或完整 schema。
输出名来自恢复图，使用 `Extract("Add_38")` 并验证实际 shape。
通用性仅证实本模型的无 D 前缀 CPU 图；不推断所有 D/E 前缀图、FP16 或量化模型支持。
容器与文本解码直接复用 `container_scan.decode_graph`、`runtime_graph_table` 和 `model_containers.bytenn_sections`。

## Resize 与失败回归

独立原生对照证明，本模型 `BILINEAR` 对应 PyTorch `F.interpolate(..., scale_factor=2, mode="bilinear", align_corners=False)`。
这不同于另一路抠像模型 `LINEAR` 的零边界插值，不能共享一个未经分类的 resize 实现。
初次随机输入大误差来自 `SetInput` 字节数误传；检查实际输入发现只复制了 16 个 float，修正后无需改变容差或调权重。

## 重跑

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/denoise_torch.py --oracle
/opt/homebrew/bin/python3 research/local-model-pytorch/denoise_torch.py \
  --oracle --original-shape --out .local/jianying-model-pytorch/denoise-original
/opt/homebrew/bin/python3 research/local-model-pytorch/denoise_test.py
```

`load_model(path=...)` 用 `weights_only=True`，检查格式、固定源哈希、输入尺寸、图大小、卷积数量、参数数量、有限 FP32 张量以及完整 state_dict。
模型调用 `model({"data0": tensor0, "data1": tensor1, "data2": tensor2})` 返回 `{"Add_38": tensor}`。
所有原生子进程 cwd 均为私有输出目录，防止原生 OpenCL 缓存落进 Git；没有修改原运行时和模型。
尚未验证真实视频质量、时序稳定性、前后处理、GPU 或编辑器 E2E。
