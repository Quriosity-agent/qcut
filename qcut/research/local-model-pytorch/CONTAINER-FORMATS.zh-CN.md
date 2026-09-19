# 私有模型容器与批量明文图恢复

日期：2026-09-19。只读互操作研究；不替换产品推理路径，不执行提取出的脚本。

## 实际结果

五套 runtime manifest 经原有 `inventory.py` 校验大小和 SHA-256：69 条记录，64 个唯一文件，5 条重复，0 条超限。

| 文件内容分类 | 去重文件数 | 含义 |
| --- | ---: | --- |
| 神经容器，含脚本 | 3 | 容器内同时有文本脚本和 ByteNN 图载荷 |
| 神经容器 | 24 | 有边界确认的 ByteNN 或带 Espresso 图的 ZIP |
| 脚本与小数据 | 9 | 完整长度表中的脚本可解码，其余载荷不超过 64 字节 |
| 音频容器，内部载荷未解释 | 4 | SAMI 头和大小边界成立，不宣称图可读 |
| 已识别结构，内部载荷未解释 | 15 | 版本包装头或命名记录表成立 |
| 未知二进制或数据 | 9 | 不根据文件名猜测神经/非神经属性 |

格式命中可以重叠：18 个命名记录容器、22 个版本包装头、4 个 SAMI、3 个 CRC 校验通过的 ZIP。
共提取 30 个 ByteNN BM 子容器，**不是 30 个新增模型**。同一文件可以有多个子网，原来的四份分镜新旧图也在其中。

使用本机固定哈希的 `libbytenn.dylib` 格式信息，30/30 份图已恢复为明文，并通过声明输入数、层数、文本行结构校验。
此阶段状态是 `decoded-counts-validated`，不是完整图语义、权重映射或原生推理通过。
本工具的 `new_verified_networks` 固定为 0，不能与主导出器的 PyTorch 成功数相加。

## 边界与安全

- 公共仓库只保存本工具、合成测试和本说明。源权重、格式查找表、图文本、提取段、原生日志均不提交、不分发。
- 输出强制位于工作区 `.local/jianying-model-pytorch/` 下；模型里的名字不会成为输出路径。
- 文件大小上限 256 MiB；限制记录数、签名命中数、ZIP 展开总量与输出量。
- 检查嵌入段是否越过父记录边界；拒绝重叠、不连续、截断或不合理长度。
- ZIP 检查路径穿越、绝对路径、反斜线、重复项、symlink、加密标志、展开长度和 CRC。
- 未知 ByteNN 版本或运行库 SHA 不套用本机格式位置；签名命中失败留在 `rejected`，不当作模型。
- TFLite 检查根表、vtable、版本和三个向量边界；ONNX 只进行 protobuf wire/部分字段检查；ncnn 只形成格式候选。都不标记为原生推理成功。本批次没有发现通过这些候选检查的载荷。
- `unknown-binary-or-data` 不等于非神经。脚本也可能依赖另外加载的模型，文件自身为脚本不代表功能没有用神经网络。

## 已观察封装

### BM ByteNN

头部包含版本、总长度、描述符数量和长度/偏移对。本批观察版本 2、3、4、5。
每一段都有独立边界；图和权重的偏移直接来自本文件，不复用分镜硬编码 arena 位置。

27 个子容器的段表完整成立；3 个 v2 子容器的第三描述符首字不是可用的字节长度。
后者只确认前两段和固定在末尾的 8 字节区域，状态为 `bounded-container-partial`。
不能把那个未解释的整数当权重长度；这三份图仍可独立恢复和做声明计数校验。

明文图恢复器先验证本机运行库 SHA，再解析 fat Mach-O 的 arm64 slice 与实际文件支持的 segment，
从本机运行库读取格式查找表。仓库不携带该表。输出保留 `B`、`D`、`E` 存储标志，不猜其完整语义。

图内可以声明多个 DataV2 输入和不同算子字段版本。恢复了文本不意味着现有 matting 或 shot 执行器能直接吃下全部图。
后续执行器必须逐算子验证字段数、连接、形状、权重布局和输出，未知模式继续 fail closed。

### 命名记录 v3

外层总长与文件大小相等，包含段数量与长度表；段内是固定宽度名称、类型字段和子记录长度表。
叶记录再次声明载荷长度。工具同时检查外层、组和叶三个级别全部消耗完且无解释外尾部。

脚本只做 UTF-8 可读性判断；JSON 必须完整解析。含 `ByteNN` 字样的脚本不是神经模型证据。
例如 C73 与舞蹈检测包同时含脚本和 BM，不能与纯脚本包混为一类。

### 版本包装与 SAMI

版本包装头的两段 8 字节相加得到观察到的版本字段，并另校验总长和首名称边界。
只称为 `header-validated`；内部记录表尚未恢复的文件仍保持不透明。

SAMI 只校验固定头、声明载荷长度与尾部范围。四份音频资产没有因此变成已恢复网络，
也没有对其内容做不受约束的解压、反序列化或代码执行。

## 下一批优先候选

以下规模来自已恢复图的声明和算子统计，不是推理通过证据。

| 来源 | 包内 BM 偏移 | 图层数，不含输入 | 为什么优先 |
| --- | ---: | ---: | --- |
| `tt_facefitting_3d` | 1908 | 6 | 212 维输入；三层 InnerProduct，再接 Sigmoid、Constant、二元乘法；适合小型完整对照 |
| `nn_denoise.bytenn` | 0 | 25 | 三个图像输入；Concat、15 个卷积、4 个上采样、5 个 Eltwise；必须核对多帧顺序 |
| 单目标跟踪第二子网 | 172603 | 16 | Crop、卷积、Concat；可用于核对局部裁剪及多输出 |
| 单目标跟踪第三子网 | 361769 | 14 | 类似的小图，但不能因相似就共享未经验证的权重索引 |
| `general_ocr_det_fp16` | 0 | 58 | 卷积、反卷积、Concat2、激活；需单独处理 `E` 存储标志和 FP16 |
| `tt_matting_video_gru` | 13383 | 194 | 与原生抓图交叉核对通过；已有另一个工作流处理时序状态和权重 |
| `lens_vfi` | 4296 | 302 | 五输入，包含 GridSample 与 Depth2Space；图已可读，但不是适合最先执行的简单网络 |

`tt_facefitting_3d` 的包同时包含神经网络与其他数据。不能因为名字带 fitting 就整体排除为“几何资产”。
`tt_facefitting1220/1256/845`、`tt_eyefitting` 与 Bingo 跟踪数据仍保持未知或算法资产候选，不凭文件名决定模型数。

## 原生交叉证据与纠错

将批量恢复的 GRU 抠像图去掉首个 `E` 存储标志后，与另一工作流已经抓到的四份 `graph-32.txt` 逐字节相等。
本机交叉校验报告为 `container-scan-20260919/matting-native-graph-crosscheck.json`。
这证明了本例恢复文本对应原生解析后的图，不是其他 29 份网络的数值推理证明。

旧 `bytenn-probe` 的 `IESNN::Net::CreateNetFromFile` 返回非空，但本版导出函数反汇编显示它只分配空对象，未读取输入路径。
其后 `GetInputConfig` 解引用空的内部网络字段，子进程崩溃；`Thrustor::CreateNet` 也没有正确 config。
**非空 Net 指针和探针进程退出 0 都不能记为装载成功。** 本轮没有把这些探针计入任何通过数。
原探针/旧说明没有在本任务中修改，以免覆盖其他代理所有的文件。

## 使用方式

```bash
/opt/homebrew/bin/python3 research/local-model-pytorch/container_scan.py \
  --out .local/jianying-model-pytorch/container-scan-20260919 \
  --extract \
  --graph-runtime "$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"

/opt/homebrew/bin/python3 research/local-model-pytorch/test_model_containers.py
```

只分类时省略 `--extract` 和 `--graph-runtime`。`--graph-runtime` 仅解析本机文件，不加载动态库或执行网络。

输出文件：

- `report.json`：完整 findings、拒绝原因、提取 SHA、每个图的层数/算子统计及私有路径。
- `classifications.json`：69 条源记录，含去重关联的分类；主批处理可按源路径或 SHA 合并，但不要改变其推理状态。
- `<source-sha256>/<offset>-bytenn-bm.bin`：私有子容器；不是 `.pt`。
- `<source-sha256>/<offset>-bytenn-graph.private.txt`：私有明文图。

25 项合成测试通过，包括父子边界、截断、v2 不透明字段、图声明计数、假签名、FlatBuffer/protobuf 边界、ZIP CRC/路径攻击、symlink、重复导出和超限记录不计为重复。
