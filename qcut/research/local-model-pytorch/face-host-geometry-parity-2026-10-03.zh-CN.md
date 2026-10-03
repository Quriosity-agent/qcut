# 实际宿主几何与 ONNX 回放：零像素差及采样边界

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。
沿用 [PR #483](https://github.com/Quriosity-agent/qcut/pull/483)。
接续 [旧参考路径的失败证据](face-onnx-owned-replay-2026-10-03.zh-CN.md)。

## 结论与适用范围

本轮完成的不是整个美颜后端独立化，而是**实际几何条件下的 ONNX 关键点回放与渲染对齐**：

```text
原始肖像 RGBA，1448×1086
  -> 原生宿主的实际算法帧 RGBA，640×480
  -> 实际 120 网络输入 + 每次预测的 mean/order/inverse + 网络/人脸 ID
  -> Torch-free CPU ONNX Runtime 1.22.1，执行转换后的 Stage1
  -> raw 解码 -> float64 仿射求和 -> float32 像素点
  -> 原生 float32 顺序的归一化
  -> 外部 replay -> QCut 持有的 FaceBuffer 副本
  -> 原生 Adapter / 效果渲染 / GPU 完成
  -> 四个验收帧逐像素相同，统一 x8 灰度差分全黑
```

输入是一张生成的成年正面肖像，不是真实韩国女团成员。参数仅为大眼 100%。
20 次预测是同一张静态图，不是 20 张脸或长视频；四帧也不能代表全部美妆、侧脸或多脸。
检测、跟踪、几何来源、其他元数据和最终渲染仍来自原生库，产品路径未更换。

## 这次修掉了什么

旧参考 120 路径平均点距 2.101183 px，最终改变 39,780 个像素。
新路径不拟合原生最终点、不裁剪越界坐标、不放宽验收阈值：

| 阶段 | 实际验收 | 结果 |
| --- | ---: | --- |
| 双观察器对原宿主的影响 | 四帧 | 每帧零像素差 |
| ONNX 120/160 五个输出头 | 105 项，21 次推理 | 原有门槛全部通过；raw 关键点精确相同 |
| raw + 实际 mean/order 解码 | 20 次 120 预测 | Stage1 点 float32 精确相同 |
| 实际逆矩阵映射 | 20 次预测，106 点 | 最终 tracked 像素点精确相同 |
| 算法帧归一化与人脸 ID | 18 次 conversion | ID 对应且坐标精确相同 |
| ONNX 派生点写入副本后渲染 | 四个验收帧 | 改变像素 0，最大 RGBA 差 0 |
| 外部点位正负扰动 | 各四帧 | 仍改变眼部 ROI，证明外部输入确实被消费 |
| 错误 replay 拒绝 | 七类实际宿主测试 | 全部通过 |

新候选四帧 RGBA 的共同 SHA-256：
`854da161becb1081a9e73ba430c2cddf1233ca5f30f7493033b069802aa1968c`。
相同点位控制仍为零差；X +0.01 / -0.01 分别改变 24,607 / 24,713 个像素。
七类拒绝为截断、非有限值、尾随字节、未消费数据、时间、身份、数量不一致。

通用 `face_owned_replay_e2e.py` 的顶层 `model_parity_verified=false` 保留：
它只知道收到一个外部文件，不能自行宣称该文件来自 ONNX。
上述结论要联合读取 producer 的 105 项验收和 E2E 的 `cases.candidate.exact_native_parity=true`。
producer 的 `final_consumer_parity=false` 同理，只有后续实际渲染才提供消费端像素证据。

## 实际几何路由

`face_host_geometry_capture.mm` 在自写研究宿主中观察 FsNew 调用，调用原函数后只复制状态。
不是附加剪映进程，不改代码页，不改原结果。库、模型和 ABI 均限定到当前锁定版本。

- FsNew 的实际输入为 RGBA、640×480、stride 2560、rotation 0。
- 120/160 的抽象 provider 与 espresso network 通过真实指针字段关联，不用地址加常量猜对象。
- ByteNN 只读导出当前记录序号；每次预测用左闭右开的记录窗口关联成功推理。
- 本控制路径每个窗口恰有一个 120 推理；160 只出现在检测初始化，不当作最终跟踪点。
- 池有十个已分配槽位，不代表十张有效脸。读取 active bit、导出 ID 和 tracking ID。
- `stage1` 有效区为 2×106；部分缓存容量为 2×280，只取实际有效的前 106 点。
- 旧 `mapped` 缓存中的种子点与最终 `tracked` 点不同，不能拿它替代最终结果。
- inactive 缓存可能保留旧值；不能通过“非零”推断活跃，也不能强制要求它清零。

本次静态实例只有一个活跃人脸，导出 ID 与 18 次 conversion 中的 ID 完全相符。
这不是多脸推理到身份的通用关联协议；多个 120 推理窗口仍拒绝。

### 数值顺序也是 ABI

实际 mean 表选择正确后，raw 重排与 mean 运算得到精确 Stage1 点。
仿射映射使用 float64 中间求和，只在结果写回时转 float32。
旧的 float32 矩阵乘法会引入约 `3.0517578e-5` px 的中间差；不能用阈值掩盖。

最终归一化的原生顺序经锁定库静态指令与运行结果联合验证：

```text
rx = float32(1 / W)
ry = float32(1 / H)
X = float32(x * rx)
Y = float32(float32(H - y) * ry)
```

这里 W/H 是 640/480，不是输出图的 1448/1086，也不是 width-1/height-1。
Y 先做 float32 减法，再乘 reciprocal；写成 `1-y/H` 会改变舍入。
纯测试保留了边界舍入反例。没有用最终点反推出修正矩阵。

另一个 `face_predict_mode==2` 的图 `warpAffine` 后处理分支尚未验证激活条件与实际矩阵，
不能把当前控制路径写成所有模式的完整坐标 ABI。

## 继续查了实际采样

观察器新增每次调用的实际算法帧复制。Python 检查文件名、尺寸、字节数与 SHA，
禁止路径逃逸、部分捕获或截断；报告与原始预测文件及网络 inventory 重新对照。

`face_host_sampling_probe.py` 以实际 RGBA 和真实矩阵做固定控制，
用捕获的 int16 BGR 网络输入加 128 恢复预处理像素，禁止裁剪或丢失精度。
在独立研究对象上直接设置捕获的 forward/inverse，再调用已有原生预处理封装：

| 对照 | 不同元素 / 43,200 | 不同像素 / 14,400 | 最大通道差 |
| --- | ---: | ---: | ---: |
| OpenCV 4.11.0 nearest | 16,625 | 6,185 | 144 |
| OpenCV 4.11.0 linear | 31,657 | 12,387 | 128 |
| 原生 fallback | 0 | 0 | 0 |
| 原生 fused | 0 | 0 | 0 |

20 次静态控制均得到同样结果。原生两个入口都能复现真实网络输入，
说明此素材上已记录的输入画面和矩阵足以复现该脸块；不能再直接把旧误差归因于矩阵猜测。
但 fallback/fused 两者一样，仍不能辨识实际调用用了哪个入口。
OpenCV 的最近邻/线性均未对齐，下一步要确定原生像素中心、采样与边界/舍入规则。
尚未从指令证明具体采样公式，不能仅凭差值断言唯一算法。

采样报告使用 `completed` 和独立的 `sampling_parity`，
前者为真只代表诊断完成；当前后者为假，`preprocessing_route_verified=false`。
这是新采样卡点，不回退已零差分的 ONNX 几何回放。

## 文件与复现

本轮新增职责分开的 contract、observer、probe、producer 和采样对照脚本；
所有权与渲染继续复用原有代码，不重新实现 publisher 或解析协议。
模型、二进制、厂商表、图片与原始记录仅在忽略的 `.local/jianying-model-pytorch/`：

- `face-render-model-capture-20261003-r3/`：当前 ByteNN counter 观察器的基准。
- `face-host-geometry-20261003-r10/`：20 次真实预测、67 次成功推理、输入帧 SHA、四帧观察器零差分。
- `face-host-geometry-replay-20261003-r5/`：当前 producer，105 项头部、20 次映射、18 次归一化与 ID 精确。
- `face-host-geometry-owned-e2e-20261003-r3/`：当前候选的四帧零差分及 `comparison.png`。
- `face-host-sampling-20261003-r5/`：实际输入、OpenCV 和原生预处理对照及统一 x8 灰度图。

几何 R1–R3、R5–R6 与 producer R1 的早期失败记录保留；成功的中间版本同样保留。
采样 R1 因未设置运行库搜索路径失败，未被覆盖。新 producer R5 与 R4 的 replay 字节相同。
使用前文的锁定 RUNTIME/PACKAGE/IMAGE，在 `qcut/` 中运行，输出必须是新目录：

```bash
python3 research/local-model-pytorch/face_host_geometry_probe.py \
  --capture .local/jianying-model-pytorch/face-render-model-capture-20261003-r3 \
  --runtime "$RUNTIME" --package "$PACKAGE" \
  --out .local/jianying-model-pytorch/geometry-fresh

.local/jianying-model-pytorch/face-heads-runtime122/bin/python \
  research/local-model-pytorch/face_host_geometry_replay.py \
  --capture .local/jianying-model-pytorch/geometry-fresh \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out .local/jianying-model-pytorch/geometry-replay-fresh

python3 research/local-model-pytorch/face_owned_replay_e2e.py \
  --runtime "$RUNTIME" --package "$PACKAGE" --image "$IMAGE" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}' \
  --eye-roi 473 306 977 558 \
  --candidate .local/jianying-model-pytorch/geometry-replay-fresh/replay.json \
  --out .local/jianying-model-pytorch/geometry-render-fresh

DYLD_LIBRARY_PATH="$RUNTIME/Frameworks" \
  .local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python \
  research/local-model-pytorch/face_host_sampling_probe.py \
  --capture .local/jianying-model-pytorch/geometry-fresh --native-control \
  --out .local/jianying-model-pytorch/sampling-fresh
```

采样私有环境为 Python 3.12、NumPy 2.2.6、Pillow 12.2.0、OpenCV headless 4.11.0.86；
ONNX 私有环境仍为无 Torch 的 ORT 1.22.1。没有更改全局依赖或产品安装包。

## 回归与异常路径

完整相关 Python 主套件 **680 个通过**，采样独立环境 **21 个通过**，合计 **701 个，无跳过**。
相对上一阶段 585 个新增 116 个。产品 portrait/provenance TypeScript **29 个通过**。
新几何三组共 66 个测试；真实输入 ONNX 的主测试与依赖守卫共 38 个，采样测试 21 个。

两次测试实际抓到并修复：参数校验失败时宿主可能未关闭，以及把 inactive 分配池算成有效人脸。
新输入帧的部分捕获、文件名/路径、类型、字节长度、哈希均有拒绝测试。
审查发现的 cleanup 异常也补齐：一处 close 抛错后仍关闭其余对象并尝试保存失败报告，
不把清理或报告写入错误覆盖原始探针异常。

主套件先加载 Torch 的测试会污染后续纯 mocked ORT 测试；现在仅隔离测试依赖。
生产 installed/imported Torch 的拒绝和真实 Torch-free 子进程保持不变，未放宽数值门槛。
JSON 严格解析复用已有 `strict_json`，不复制另一份解析实现。

```bash
.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  -m unittest discover -s research/local-model-pytorch -p 'face_host_geometry*_test.py'
.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  -m unittest discover -s research/local-model-pytorch -p 'face_render_model_parity*_test.py'
.local/jianying-model-pytorch/face-warp-runtime-20261003/bin/python -B \
  -m unittest discover -s research/local-model-pytorch -p face_host_sampling_probe_test.py
```

这不是 CI 绿色或编辑器完整 E2E 声明；真实控制只在本文限定的本机资源/样本上执行。

## 还剩什么

优先把采样前端逐字节对齐，再扩展新真实素材、侧脸/遮挡/移动/无脸/恢复和多脸关联。
检测与接纳、身份、姿态拟合、Stage2/虹膜/遮罩、五官/皮肤/美妆完整消费仍须分阶段验证。
之后才考虑关闭原生推理、长期回收和产品 IPC/预览/导出。
当前副本保留直到宿主销毁、最多 128 个；不是长视频内存策略。
Windows/x86、其他 Adapter 模式和新的剪映 GUI 导出对照均未验收。
**这一轮没有合并或触发发布，也没有把研究结果开启为用户默认后端。**
