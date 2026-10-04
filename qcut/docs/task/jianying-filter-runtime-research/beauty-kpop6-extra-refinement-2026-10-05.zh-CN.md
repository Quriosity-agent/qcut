# beauty-6-kpop：Extra ONNX 精修与口红零差异闭环

日期：2026-10-05。分支：`beauty-6-kpop`。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。
起点：`6c9e5d9a0c859f178c5263b6081dad939b4a8670`。
前置记录：[逐阶段诊断与 Extra 缺口](beauty-kpop6-stage-divergence-2026-10-05.zh-CN.md)。

## 结论与范围

**这次实际消除了三个口红样本的最终 RGBA 差异，不仅是增加诊断。**
新增 Extra-160 网络的 PyTorch/ONNX 转换、从当前算法 RGBA 自行采样的精修、严格可选接入和验收。
微笑正脸、K-pop 正脸、户外人像的柔和粉口红 +80，从 3970/10776/7420 个差异像素降至 0。
三个样本各两次冷启动 prediction 的最终 106 点均与原生逐 float32 位一致；大眼 +40 保持零差异。

这只是**固定 macOS arm64 原生依赖研究宿主、指定单图和配置**的通过结果：

- baseline 是 QCut 研究宿主调用固定剪映原生库，不是本轮新导出的剪映 GUI 视频。
- candidate 使用自主采样和 ONNX 主点推理，但内层裁剪几何、检测、遮罩、效果包和渲染仍依赖原生。
- 不输入原生最终点、不重放捕获的 crop/tensor、不调整图像验收容差。
- 没有接入产品 UI 或开放候选后端；没有证明全部美妆、真实视频、多脸或跨平台完成。

## 根因如何确定

上轮 map120 对 post-predict tracked 的不一致只定位了比较范围，未证明首次分歧位置。
本轮新增固定库上的 Stage2 调用边界：调用前 `0x2d9a20`，返回后 `0x2d9a24`。
只读硬件探针先深拷贝调用前数据，再深拷贝调用后数据，绑定 owner、alignment、face ID、线程和 prediction。
一个诊断硬件槽按 before / after / makeup XY 顺序轮换，同一时刻最多四个启用断点。

微笑样本 r14 的证据：

| 阶段 | prediction 0 | prediction 1 |
| --- | ---: | ---: |
| 候选 map120 对原生 Stage2 调用前主点 | 212/212 位一致 | 212/212 位一致 |
| 候选 map120 对原生 Stage2 返回后主点最大坐标差 | 6.399520874 px | 6.229232788 px |
| Stage2 返回码 | 0 | 0 |

因此，这个样本的首次主点分歧确实发生在 Stage2 内，不能再归咎于此前的 120 网络精度。
当次配置 `F+0x3c=1`、`F+0x68=0`、`C+0xb/0x20/0x21=0`，
可选的 optimized、OneEuro/secondary warp、suppression 路径未启用。
内层 AvgFilter 参与决定 Extra 裁剪；这部分几何尚未独立实现。

固定 `liblens.dylib` SHA256：
`fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161`；
arm64 UUID：`248872F2-7736-32A9-A48B-DC5DFEE20C99`。
地址是 unslid 虚拟地址，不是 Mach-O 文件偏移。原始反汇编不提交。

## 实现链

```text
当前算法 RGBA + 明确标注的原生 Extra 几何依赖
  → QCut 自行采样 BGR 160x160
  → signed input [-128,127]，int64 NHWC [1,160,160,3]
  → Extra ONNX，CPUExecutionProvider / ORT 1.22.1
  → raw fc [240,1,1,2]，float32，fraction=0
  → 取前 106 对，按原始浮点顺序加 mean
  → Extra inverse → Stage2 forward → Stage2 inverse
  → 既有外层平滑 / 归一化
  → 当次候选回复 → 消费者读取 / 几何转换 → 原生 GPU 渲染
  → 独立收据、点位比较、最终 RGBA 零容差验收
```

网络输入的 fraction=6 是原始量化契约，不是在整数输入之前再除以 64。
PyTorch 实现复用现有整数 backbone 和 FloatDense，网络末端以 channel-major reshape 为 240x25，
再做原始 dense。ONNX 使用标准算子、opset 18、自包含权重，不需要运行时导入 Torch。

解码顺序为 `float32(float64(raw[:106]) + float64(mean106) / 256 * 160)`。
映射必须保留每次输出为 float32 的中间舍入，不能合并正反仿射：
r15 中只做 Extra inverse 留下 7/10 个位差，最大差约 `3.05e-5 / 1.53e-5` 算法像素；
补上 Stage2 forward/inverse 往返后，两次 prediction 都是 212/212 位一致。
该轮自主采样的 BGR crop 与独立捕获的原生 crop 也逐字节一致。
捕获 crop 和原生点只用于离线对照，未输入在线候选。

### 模型证据

- 私有转换源：`.local/jianying-model-pytorch/face-capture-20260920/collected/7938cfc3abdb0934`。
- graph SHA256：`7938cfc3abdb0934cfe28353561963b2118f3bf3e439835d86339d4d98f05f85`。
- arena SHA256：`84e987cd3155af712ee6c3bef905f82fbfeaf718007509321f429626163c7b9d`。
- 生成目录：`.local/jianying-model-pytorch/face-extra-heads-20261005-r1`。
- ONNX SHA256：`eb807d75672d09ce3566ebd6397ae3004d6a7ea5796584cc1352fd5a72a95956`。
- 模型约 3.18 MB；三个重新生成的随机输入 seed 17/41/509，PyTorch、ONNX 及历史原生 fc 的 480 个输出均逐位一致。

历史 fc 对照不是本轮重新运行原生网络的 synthetic oracle；本轮新执行的原生证据是下述真实人像。
manifest 精确绑定 graph、arena、exporter、ONNX、runtime 版本和形状。
运行前后检查文件未变，ORT 加载已验证的 bytes；符号链接、替换文件、错误形状/范围、非有限输出均拒绝。
模型、权重、原图、raw 日志均留在本机，不提交 Git。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `face_extra_heads_onnx.py` | 私有源转换、标准 ONNX 导出、hash-bound CPU 推理 |
| `face_live_extra_refinement.py` | 严格 geometry 契约、自主采样、106 主点解码/映射、可审计摘要 |
| `face_live_extra_capture.h` | 从当次原生状态取得四个仿射、mean 和受限配置，不传原生坐标数组 |
| `face_live_candidate.py` | 显式注入 refiner，精修后才平滑；reset120 以 refined 点初始化；失败不推进状态 |
| `face_live_worker.py` | 只有明确启用时接收 extra_geometry，缺项/多项/异常会使当前会话不可继续 |
| `face_live_extra_audit.py` | 两次冷预测、固定模型版本、源 RGBA hash、采样来源和原生依赖的收据核对 |
| `face_live_extra_trace.py` | Stage2 before/after 只读边界，身份/线程/顺序/硬件槽约束 |
| `face_live_extra_model_trace.py` | 可选私有原图/crop/几何诊断，独占写证据文件，不向候选传诊断数据 |
| `face_live_bridge_capture.mm` / `face_live_bridge_lldb.py` / `face_live_bridge_probe.py` | 可选采集、硬件探针、CLI 门槛和完整执行链接线 |

`--extra-root` 必须和 cold-frame、paired stages、makeup consumption 显式配套；默认不开启。
`--trace-extra-model` 必须配 `--trace-extra-stages`，诊断不是推理开关。
实际实现生成 240 对原始输出，但本轮只独立接入前 106 个主点，不能据此声称剩余 Extra 点和 mask 已替换。

## 最终原生实测

以下目录均位于 `.local/jianying-model-pytorch/`；运行期间冻结非测试研究源码，串行使用显式 GPU lease。
每例都是新进程、当前画面推理和新输出文件，不覆盖旧结果。

| 素材 / 参数 | 修复前 RGBA 差异像素 / 最大通道差 | 修复后 | 原生效果对原图变化像素 | 最终运行目录 |
| --- | ---: | ---: | ---: | --- |
| 微笑正脸，口红 +80 | 3970 / 31 | **0 / 0** | 4096 | `beauty-kpop6-smile-extra-final-20261005-r20` |
| K-pop 正脸，口红 +80 | 10776 / 23 | **0 / 0** | 12331 | `beauty-kpop6-kpop-extra-final-20261005-r21` |
| 户外人像，口红 +80 | 7420 / 34 | **0 / 0** | 8213 | `beauty-kpop6-outdoor-extra-final-20261005-r22` |
| 微笑正脸，大眼 +40 | 0 / 0 | **0 / 0** | 4760 | `beauty-kpop6-eye-extra-regression-20261005-r24` |

三例口红 `extra_refinement_audit.passed=true`；四例 `passed=true`、`completed=true`、
`cleanup.completed=true`、`dependencies_unchanged=true`。
大眼未启用 Extra refiner，用于验证既有 Base 路径未回退。
微笑输出 640x640；K-pop/户外输出 1448x1086、算法输入 640x480。
户外素材历史目录名是 `outdoor-male--02`，仅作为路径使用，不推断人物身份或年龄。

三例口红 smoothed/normalized 在 prediction 0 和 1 均为 212/212 位一致。
原有 `mapped_120` 对 post-predict tracked 仍报告差异，这是**精修前**对**精修后**的比较，
没有把原始 map120 偷换成 refined 数据以装作全阶段通过。
reset 后未使用的滤波 previous/delta 历史数组仍有形状差异；未伪造相等，也未证明视频时序等价。
seed160 的原生 pre-tracking 对照仍缺失。

候选和 baseline 的最终 RGBA SHA256：

```text
smile   37c5fb55392d446227290fdfa837c9ad6a8e95d8bfc54b6ce3fe5b6a8bae0a77
kpop    7dec47e873ee79d0da5dcdad9fe3a5e88b75d3ed9ec98c932cf2f2e20029b28b
outdoor 9c3af0191e92f1c9159e3dd5e165f97ac402eda12d4dbd4ae5fe4a22937b3dee
eye     c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8
```

Extra 自主采样、推理和映射在这六次预测中约 13.9-15.1 ms。
这是带校验的单模块观测，不是产品帧率或无调试器全链实时性能保证。

### 失败保留

- r14/r15 使用旧候选，最终口红零容差仍失败；作为定位证据保存，未改写结果。
- r16 暴露候选复合 backend version 的局部变量覆盖了 face identity，导致后续 prediction 身份检查失败。
  已分离为 `backend_identity`，连续 seed/reset/update 与失败回滚测试覆盖；r17 起重新运行。
- r23 大眼宿主在 getter 地址 `0xc15cd4` 停于 `EXC_BREAKPOINT`，未正常退出且缺完成回执，验收失败。
  未知具体触发原因，未当成图像通过或绕过断点；相同代码/参数、全新目录的 r24 完整通过。
  失败目录保留，cleanup/dependency guard 均正常。不能据一次成功重跑声称这类调试器停止已根治。
- 收据异常测试暴露了错误容器类型和超大整数耗时的拒绝漏洞，已严格校验并新增回归。

## 图片与报告

本地报告：`.local/jianying-model-pytorch/beauty-kpop6-extra-comparison-20261005-r1/index.html`。
清单：`.local/jianying-model-pytorch/beauty-kpop6-extra-comparison-matrix-20261005.json`。

7 个比较行、42 张 PNG：三个人像各有修复前/后，大眼一行。
每行提供原图、原生、候选及三组两两差分；固定公式
`min(255, 8 * max(abs(RGB delta)))`，不逐图归一化，Alpha 单独统计。
源 hash 校验通过，所有 `issues=[]`；旧三例 `DIFFERENT`，新三例和大眼 `EXACT`。
已目视核对 K-pop 原生/候选和修复前后差分：旧误差集中嘴唇，新差分全黑，
而效果对原图仍有清晰的嘴唇区域变化，不是禁用效果得到的相等。
这些是实际 RGBA 生成的诊断图，不冒充剪映 UI 截图。

## 测试与复跑

**406 项 Python 测试通过，0 skip**，包括新鲜 PyTorch 导出、真实 ORT 推理、历史 fc 对照、
形状/类型/有限数/文件替换、诊断隔离、refiner 契约、worker poison、连续预测、默认路径、收据和报告。
这是单元/集成测试数，不是 406 次原生或 UI E2E。
四个有效原生案例的 capture/host 编译、消费证明、点位和最终图像验收另计。

```bash
cd /Users/peter/Desktop/code/qcut/qcut/research/local-model-pytorch
export QCUT_FACE_LIVE_MODEL_ROOT=$PWD/../../.local/jianying-model-pytorch/face-heads-20261003-stable-r2
export QCUT_FACE_EXTRA_MODEL_ROOT=$PWD/../../.local/jianying-model-pytorch/face-extra-heads-20261005-r1
export QCUT_FACE_EXTRA_REFERENCE_ROOT=$PWD/../../.local/jianying-model-pytorch/face-capture-20260920
export QCUT_FACE_EXTRA_SOURCE=$QCUT_FACE_EXTRA_REFERENCE_ROOT/collected/7938cfc3abdb0934
export QCUT_FACE_EXTRA_EXPORT_PYTHON=$PWD/../../.local/jianying-model-pytorch/face-heads-export122/bin/python
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_candidate_trace_test face_live_candidate_test face_live_candidate_extra_test \
  face_live_worker_test face_live_worker_trace_test face_live_worker_protocol_test face_live_worker_server_test \
  face_live_stage_audit_test face_live_stage_launcher_test face_live_bridge_probe_test face_live_bridge_audit_test \
  face_live_makeup_render_audit_test face_live_makeup_point_audit_test face_live_makeup_point_trace_test \
  face_live_bridge_lldb_test face_owned_result_probe_test face_live_bridge_process_test beauty_dual_matrix_report_test \
  face_extra_heads_onnx_test face_live_extra_trace_test face_live_extra_launcher_test face_live_extra_model_trace_test \
  face_live_extra_refinement_test face_live_extra_candidate_test face_live_extra_audit_test face_live_extra_worker_test
```

原生复跑以 r20/r21/r22/r24 的 `report.json.command` 为准；命令预留 `-rerun` 输出目录，
若已存在继续改成全新目录和 pycache_prefix，保留 runtime、manifest、模型、效果包和 lease。
不要并发跑 GPU，不在运行中修改研究源码。
图像报告可用 `beauty_dual_matrix_report.py --matrix <上述清单> --out <全新目录>` 重建。

## 下一步

1. 优先扩相同口红的 0/低/高强度、眉妆和眼妆，继续每个控制项做原图/原生/候选/固定增益差分。
   原生实际 Extra predictor 实例与 head descriptor 尚未逐帧独立绑定；新变体不能仅凭同名包默认适用。
2. 捕获并独立实现内层 AvgFilter 的初始化、crop/rotation、forward/inverse 生成，替掉当前原生几何输入。
   同时增加真实 pre-tracking seed160 对照，验证首次初始化和 reset 后的全部状态，而不只最终点位。
3. 扩到真实视频、转头、眨眼、遮挡、消失重入、多脸和 seek，严格验证时序状态、吞吐和取消清理。
4. 再替换额外点、iris、fitting、mask 与效果渲染；最后做产品预览/导出及 Windows/x86 验收。

本轮没有做产品全量 CI、Electron UI E2E、新剪映 GUI 导出、分钟级视频、多脸或跨平台验收。
不能把三张口红零差异解释成整套美颜美妆独立完成。
