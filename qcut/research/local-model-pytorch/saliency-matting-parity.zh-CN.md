# 显著性抠像（`saliency_matting` v1.0）CPU 网络对拍与 ONNX

日期：2026-09-19。分支：`codex/local-neural-model-remaining-20260919`。
盘点表编号 N07（`saliency-script` 显著性抠像的实验路径）。本轮之前研究目录里没有相关工作。

## 结论

- 网络已恢复为可读、可回读、可推理的 PyTorch 图，`vision_batch_profiles.py` 新增 `saliency_matting` profile。
- 原生 CPU 对拍 **10/10 通过**，判定不变：`atol=1e-4, rtol=1e-4`；最大绝对误差 `5.9e-5`（`ones`），其余九组 `≤2.7e-6`。
  普通 fp32 执行即通过，没有使用固定数值 profile。
- 独立进程回放 10/10；ONNX 导出通过 ORT 回比 4/4，再用 r2 冻结的十组原生输出回比 **10/10**（最大 `5.1e-5`），
  单帧 640x640 CPU 推理约 60 ms。没有任何产品或编辑器接入。

## 源与身份

| 项 | 值 |
| --- | --- |
| 源文件 | `~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models/saliency_matting_v1.0_size0_md55882cbfb5e9c1f205cd599d3c5d0833a.model` |
| 源 SHA256 | `ac2ae6badafc6a94641dc59b5844762676eee71b218785bfad37169eea380341` |
| 容器 | `named-records-v3`；内含 1 个 `bytenn-bm`（7,065,546 字节）、1 个 JSON 记录、1 个不透明记录 |
| 网络 SHA256 | `44952b5a54204d43e96010b461bb0478369cfd88b4217206eaaa590b1ce16318` |
| 图 SHA256 | `4f681b2f1fcf3391ea35f944308202f150de0376938cc4aaba09c354291935b7`（214 层，头 `E` + `D`） |
| 权重 | fp16 arena 3,525,476 个值，与图内参数总数逐一相等；末尾 uint32 图戳 `1680516412` |
| 运行库 | `libbytenn.dylib` `1bf9be78…c53ad0` |
| 产物 | `.local/jianying-model-pytorch/saliency-matting-20260919-r2/saliency_matting.pt`，SHA256 `10e6ef54b2cc0e5acedb34019c047315cfa0301e4e415981d672c45c6edf8a80` |
| 状态摘要 | `da8833efb05be81fe6ef9359770ce7fc9c1e2e71711708970d52d957cc0b44e9` |
| ONNX | `saliency-matting-20260919-onnx-r1/model.onnx`，SHA256 `3efb0fcb26c8324091df2ca3761906894d1e790b097741a2c97d78301e329c32`，330 节点，opset 18 |

容器 JSON 记录：`{"matting": {"name": "matting", "forwardType": 1, "normMean": 128.0, "normStd": 128.0, "sharpenMode": 2}}`。
只记录，不据此宣称产品前处理已复现。

## 图结构

输入 `data` `[1,3,640,640]`。先 2x2 平均池化到 320，随后是带残差与 concat 的 1x1 / 3x3 深度可分离编码器，
四个 dilation 为 2/4/8/16 的 3x3 `Conv2D`（ASPP 风格），七个 2x2 最大池化，十个 `UpSampling BILINEAR` x2。
尾部是引导滤波精修：`conv_w.3` 输出 4 通道 160x160，`Upsample 4.0 linear 0 1` 放大到 640，
`Slice` 拆成 3 通道权重与 1 通道偏置，`OnnxOp2 Mul` 与原始输入逐元素相乘，`OnnxOp1 ReduceSum` 沿通道求和，
加偏置后 `Sigmoid`，输出 `Sigmoid_316` `[1,1,640,640]`。

算子计数：Convolution 74、Concat 47、DepthwiseSeparableConvolution 26、Eltwise 23、Conv2D 21、UpSampling 10、
Pooling 7、Upsample 1、Slice 1、OnnxOp2 1、OnnxOp1 1、Sigmoid 1、PoolingDown 1。

通用解释器为此新增：`E`/`D` 头前缀、输入边长上限 1024、`Conv2D`（字段为 groups、ci、co、kh、kw、sh、sw、
四向 pad、dilation、bias、relu；本图只出现 groups=1、stride 1、pad 等于 dilation 的 3x3）、`Pooling MAX 2x2`、
`Slice`（前 K 通道与其余通道两个输出）、`OnnxOp2 Mul`（同形状逐元素乘）、`OnnxOp1 ReduceSum`（沿通道求和保维）。
`Conv2D` 字段的读法由参数总数与 fp16 arena 长度逐一相等得到确认。

## fp16 arena 与原生执行

`CreateNet` 不直接接受 `E` 头图（日志 `bytenn config error!!! D`）。运行库的
`CheckFp16AndConvertModel` 会去掉 `E` 前缀、只扩展权重载荷并保留图戳；OCR 阶段已证明 `ocr_torch.widen_fp16`
与原生 `BYTENN::float16buffer_to_float32buffer` 对全部 65,536 个半精度位型逐位相同。
本轮再用 `ocr_oracle.mm --widen` 按 1 MiB 分块扩展整个 arena（含 38,361 个次正规/零值），与 Python 结果**逐字节相同**。
因此 `vision_batch_export.py` 对 `arena: fp16` 的 profile 把转换后的 `D` 图与扩展后的 arena 交给 oracle，
原图与原 arena 另存为 `graph.original.private.txt` / `arena.original.private.bin`，报告写明
`original_graph_unchanged: false` 与 `graph_transform`。bundle 内保存的是原始 `E` 图文本，`graph_sha256` 不变。

## 验证范围

- 十组合成输入（零、一、负一、ramp、seed 17/41 均匀随机、seed 509/1709/20260919 正态保留集、非对称脉冲）。
- 原生与 PyTorch 输入完全相同，绕过图像解码、`normMean/normStd` 归一化、裁剪、`sharpenMode` 后处理。
- 独立进程回放：`vision_batch_replay.py`，禁止读取厂商源文件与 Python 网络，10/10。
- ONNX：`onnx_export.py` 导出并做 ORT 对 PyTorch 回比 4/4（最大 `7.7e-7`）；另用 r2 冻结的原生/PyTorch 输出回比
  10/10（对原生最大 `5.1e-5`，对 PyTorch 最大 `9.5e-6`），记录在 `saliency-matting-20260919-onnx-frozen-r1/report.json`。
  现有 `vision_batch_onnx_replay.py` 固定为第四阶段的三个 profile 与 54 组用例，本网络未纳入其中。
- 台账快照：`remaining-20260919-ledger.json` 由第二阶段索引加本报告与匀肤 GAN 报告生成，两者 `main` 网络均 `verified: true`；
  不是全局累计台账。

不能据此宣称：真实视频经产品前处理后的抠像质量；`forwardType: 1` 所指的 GPU 路径；`saliency_script_for_cc` 脚本包
（A01）与本网络的编排关系；任何编辑器接入。

## 证据目录（全部在 `.local/`，不进 Git）

- `saliency-matting-20260919-r1`：oracle 直接吃 `E` 图失败的记录（十组 `native-failed`）。
- `saliency-matting-20260919-r2`：最终对拍与逐 case 原生输出，`report.json` 为最终报告。
- `saliency-matting-20260919-replay-r1`：独立进程回放。
- `saliency-matting-20260919-onnx-r1`：ONNX 导出、contract 与 ORT 回比。
- `saliency-matting-20260919-onnx-frozen-r1`：ONNX 对冻结原生输出回比。
- `remaining-20260919-ledger.json`：台账快照。

## 复现

```sh
/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_export.py \
  --profile saliency_matting --out .local/jianying-model-pytorch/saliency-new-empty-run --oracle
/opt/homebrew/bin/python3 research/local-model-pytorch/vision_batch_replay.py \
  --report .local/jianying-model-pytorch/saliency-new-empty-run/report.json \
  --out .local/jianying-model-pytorch/saliency-new-empty-replay
python3 research/local-model-pytorch/onnx_export.py \
  --model .local/jianying-model-pytorch/saliency-new-empty-run/saliency_matting.pt \
  --input .local/jianying-model-pytorch/saliency-new-empty-run/case-random-17/inputs.npz \
  --out .local/jianying-model-pytorch/saliency-new-empty-onnx
```

ONNX 步骤需要 `requirements-onnx-export.txt` 里固定的 `onnx`、`onnxscript`、`onnxruntime`。
