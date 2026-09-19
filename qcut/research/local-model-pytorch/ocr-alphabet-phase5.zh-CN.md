# OCR 第五阶段：精确字表与图片到文本

日期：2026-09-19。范围只包含新增 `ocr_decode_*.py` 和本文，不修改共享 infer、ONNX、Phase 4 文档、产品入口或既有识别器。

## 冻结结论

- 已从已安装剪映的 `libcccreator.dylib` 提取 **精确的 10,537 类映射**，依据构造函数顺序和识别调用点，不是用已知图片文本反推，也没有借用其他模型字典。
- 11 张已有中英文字条图片实际经过新运行的 PT / ONNX 推理，再由该映射解码；另对 0–255 输入重新运行了 11 次原生 CPU oracle。
- 新原生、PT、ONNX 的完整 logits 比较全部通过，argmax 和最终文字相同；**文字质量只有 4/11 完全正确，12/239 字符编辑错误，CER 5.0209%**，不能写成语义全对。
- 本轮仅是固定尺寸识别器的 PNG → logits → strings，不是检测、裁剪、方向校正或编辑器 OCR 全链路验收。没有启用产品功能，没有提升旧失败候选状态。
- 用户要求停止实验后冻结；没有继续 E2E、导出或模型实验。所有本子任务命令已结束，无遗留实验服务或执行 session。提交和发布由父任务处理。

## 字表证据

读取的安装文件：`/Applications/VideoFusion-macOS.app/Contents/Frameworks/libcccreator.dylib`。
源模型是当前缓存中的 `general_ocr_rec_fp16_v2.4_size0_md57699202ce3514ac281c76ed49bf93814.model`，与 Phase 4 v4 的源哈希相同。

| 对象 | SHA-256 |
| --- | --- |
| 原模型 | `d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac` |
| 安装库完整文件 | `b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` |
| arm64 slice | `272739b8603126fdf0f9ab1db703388b0e67e63351edf9aab02e43168a9e2ca3` |
| UTF-32LE 原始数组 | `c69f43d50fbe0d84e41185626703e7596cd734f1c4a6d89ea1734597a5db81e3` |
| 规范 JSON tokens 数组 | `707fc0b30801d75498382950d6760deab10bd8e4c98db11cbff5811b58e5bebb` |

地址均为上述 arm64 slice 的静态 VA，不是进程 ASLR 地址：

1. `AlgorithmGeneralOCR` 构造函数 `0xD437D4` 连接 `OCRFunction`，设置 `tt_general_ocr_rec` 模型名。
2. `OCRFunction` 构造调用点 `0xD44A80` 连接字表构造函数 `0xD46470`。
3. 字表构造先放空字符串、空格，再按内存顺序转换 `0x2D0BC2C` 的 **10,535 个 UTF-32LE Unicode scalar**。完整文件偏移 `120962092`，arm64 slice 起点 `73728000`。
4. 因此 class 0 是 blank，class 1 是空格，class `2+i` 是数组第 i 项。数组第一项本身也是空格，**class 1 和 class 2 同为空格，不能去重或排序**。
5. `recForward` 的 argmax / CTC 循环在 `0xD45818` 起；调用点 `0xD444C4`。7 段调用证据的地址、长度、代码哈希固定在 `ocr_decode_contract.py`，完整指令只保存在私有 evidence。

关联证据来自安装库构造函数、模型名、缓存源哈希和已验证的 v4 计算图；没有动态拦截剪映 UI 的模型加载，也没有执行完整的原产品 OCR wrapper。
字表证据标记为 `binary-callsite-pinned`、`native_execution=false`；后面的原生图推理是另一份独立证据，不能混为同一次调用。

## 解码与输入语义

- 按时间正向取 argmax；原生 max-element 的严格比较保留第一个相同最大值。
- 合并相邻的原始 class ID，再移除 blank 0；`A, blank, A` 必须输出 `AA`。重复判断按 ID，不按字符串，因此重复拼写的 class 仍保留各自语义。
- 不进行 trim、大小写转换、Unicode normalization、标点替换或词典纠错。输出 token span 是 logits 时间步，不是视频时间戳。
- `recForward` 的 `0xD45784` 附近直接将 uint8 转 FP32。该复制循环没有 `x/127.5-1`。此前 Phase 4 明确只是研究张量输入，不能冒充产品预处理。
- 本轮同时保留旧 `fixture` 模式和新增 `byte-float` 模式，不覆盖旧结果。后者把固定 `512x32 RGB` PNG 的 0–255 值转成 NCHW FP32，不偷偷缩放或调整图片。
- 所有图片都是灰阶文字复制到 RGB 通道，**本批无法区分 RGB/BGR**；仅证明该数值输入范围有效，不证明完整裁剪、色彩、旋转和引擎前处理。
- softmax 派生分数只是 emitted token 首个时间步概率的几何均值，不是校准过的 OCR 置信度。

通用 CTC 行为可参阅 [TensorFlow greedy decoder 文档](https://www.tensorflow.org/api_docs/python/tf/nn/ctc_greedy_decoder)；这里的专有 blank、字表和顺序依据是本地调用点，不是该外部文档。

## 11 张图片的真实结果

源图片来自 `ocr-rec-phase4-r4/rendered-inputs/`，全部参与，未按识别质量筛选。下表实际输出在新原生、PT、ONNX 三者之间一致。编辑距离按未归一化 Unicode codepoint 计算，空格、大小写、标点均计入。

| Case 后缀 | 参考文字 | 实际输出 | 编辑数 |
| --- | --- | --- | ---: |
| english | `QCut subtitle recognition 2026` | `QCut subtitle recognition 2026` | 0 |
| english-inverted | `The meeting starts at 3:30 pm.` | `The meeting starts at 3:30 pm.` | 0 |
| english-low-contrast | `Keep the original video file.` | `Keep the original video file.` | 0 |
| english-blur | `Budget: 1,250.00 dollars` | `Budget 1,250.00 dollars` | 1 |
| chinese | `大家好，这是中文字幕测试` | `大家好,这是中文字幕测试` | 1 |
| chinese-inverted | `请保存项目，不要删除原始文件` | `请保存项目,不要删除原始文件` | 1 |
| mixed | `QCut 预算 1250 元，下午 3:30` | `QCut预算 1250元,下午3:30` | 4 |
| chinese-small-blur | `这段素材包含中文数字和英文名称` | `这段素材包含中文数字和英文名称` | 0 |
| fresh-english | `No raw weights in public builds.` | `No raw welghts in public builds.` | 1 |
| fresh-chinese | `新的留出样本：画面与字幕对齐` | `新的留出样本:画面与字幕对齐` | 1 |
| fresh-mixed | `TEST 789 中文识别 ABC` | `TEST789中文识别ABC` | 3 |

旧 `fixture` 模式的真实质量是 **0/11 完全正确，87/239 编辑错误，CER 36.4017%**，虽然 PT/ONNX 与冻结 native/PT 完整数值比较仍然通过。保留该负面结果，说明“张量移植正确”和“输入适合识别”是两道不同门槛。

## 新原生完整数值对照

`byte-float-native/report.json` 状态为 `native-byte-range-parity-passed`。使用固定 v4 完整图和 arena，原始 `[1,3,32,512]` 输入，不改图、不执行 ReInferShape，不调用剪映 UI。
`libbytenn` SHA 为 `1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0`；强制 CPU，回读 `forward_type=0`。11 个原生输入回读逐字节一致。

| 比较 | 完整元素数 | 最大绝对误差 | 最大误差/允许误差 | argmax 差异 |
| --- | ---: | ---: | ---: | ---: |
| 新 PT 对新 native | 14,836,096 | 0.000202178955078125 | 0.2016450676459109 | 0 |
| 新 ONNX 对新 native | 14,836,096 | 0.000087738037109375 | 0.24492517242658807 | 0 |

每个元素必须满足 `abs(actual-native) <= 1e-4 + 1e-4*abs(native)`，没有放宽容差，也没有用 argmax 或文字相同代替完整值比较。两组不是 bitwise exact。
实测平台为 macOS 26.6.2 arm64、Python 3.12.12、NumPy 2.5.3、Torch 2.10.0、ORT 1.30.0，CPUExecutionProvider、2 线程、ONNX 图优化关闭。

## 代码与门槛

| 新文件 | 职责 |
| --- | --- |
| `ocr_decode_binary.py` | 有界只读 Mach-O、字符串引用、局部反汇编；输出限制到私有目录 |
| `ocr_decode_extract.py` | 固定源/安装库/代码段/表哈希，按构造顺序提取私有映射 |
| `ocr_decode_contract.py` | 严格 JSON/schema/源和映射哈希/相邻证据/调用点校验 |
| `ocr_decode_ctc.py` | NumPy 通用 CTC、显式 layout/length、Unicode 和重复 ID 语义 |
| `ocr_decode_metrics.py` | 不纠错、不归一化的编辑距离与 micro CER |
| `ocr_decode_evaluate.py` | 11 个 PNG 的 PT/ONNX 实际推理、完整比较和质量报告 |
| `ocr_decode_native.py` | 新 byte-range 输入的原生 CPU 完整对照 |
| `ocr_decode_test.py` | 41 个合成字典、CTC、schema/hash 和指标单测 |
| `ocr_decode_evidence_test.py` | 18 个合成二进制、输入契约、证据门槛单测 |

解码交接入口是 `load_pinned_alphabet(path=...)`，再调用 `decode_logits(logits=..., alphabet=..., layout="NCHW")`。
真实入口固定 10,537 类及源、映射、证据哈希；只有 class count 相同或自报 verified 不能通过。修改字表并同步其自报哈希也不能绕过调用方固定哈希。
泛用 decoder 可接受自创合成字典；真实 recognizer loader 不接受它们。证据是可复核的本地固定配置，不声称数字签名或第三方认证。
提取器需要 Capstone；解码本身只依赖 NumPy；PNG 评估需要 Pillow 及选中的 PT/ORT 后端。未修改公共依赖清单。

## 冻结测试与剩余边界

- Python 3.12：`python -m unittest discover -s research/local-model-pytorch -p 'ocr*test.py' -v`，**115/115 通过**，包含既有检测器、识别器、ONNX 回放与新增 59 项。
- Python 3.14：`python -m unittest discover -s research/local-model-pytorch -p 'ocr_decode*test.py' -v`，**59/59 通过**。
- 合成测试包括 3 类、长度 0–7 的 3,280 条穷举路径、重复 class 拼写、blank、ties、长度和 layout、Unicode、非有限值、坏 JSON/schema/hash、缺少/伪造证据。
- 最后收紧调用点证据校验后，实际私有 alphabet 已重新加载成功；没有重新生成大张量。
- **未运行整个父任务最终回归**，由父任务在所有分支文件冻结后统一执行。上述数字不是整个仓库测试数量。
- 本子任务未执行 Windows/x86 或 Linux 的图片到文字推理。既有 Phase 4 跨平台 logits 证据不能升级成 Phase 5 的文字全链路证明。
- 待验证：检测框后处理、NMS、透视裁剪、动态宽度、色彩通道、旋转/竖排/多行、空图、真实视频帧、时间合并、QCut 编辑器及剪映可见结果。
- 11 张自创固定字条不代表自然图像质量；既有 fixture 已参与先前数值验证，不是独立生产质量基准。没有语言模型补字、标点修正或静默标准化来抬高指标。

## 私有证据与磁盘边界

以下路径统一位于忽略目录 `.local/jianying-model-pytorch/ocr-decode-phase5/`：

| 路径 | 内容 |
| --- | --- |
| `alphabet/alphabet.json` | 全部私有 class tokens 和严格 manifest |
| `alphabet/evidence.json` | 安装库、模型、表和 7 段调用点溯源 |
| `fixture-e2e/report.json` | 旧 -1..1 输入真实失败质量，完整数值对照仍通过 |
| `byte-float-e2e/report.json` | 11 次新 PT + 11 次新 ONNX 的实际文本及完整比较 |
| `byte-float-native/report.json` | 11 次新原生 CPU 与上述结果的完整比较 |

复用的源包：`ocr-rec-phase4-r4/ocr-recognizer-logits.pt`；ONNX contract：`onnx-phase4/ocr-rec-v4/contract.json`，均在同一私有根下。
本子任务私有输出总计约 **368 MiB**；停止前磁盘可用约 **14 GiB**。没有再生成完整逐层 trace，没有复制其他研究目录，也没有删除父任务或他人的证据。
仓库只包含自写代码、自创合成测试与本文；**不提交字表、厂商字节、权重、NPZ、原生指令或私有模型**。未上传、购买、修改剪映草稿，未执行 commit/push。
