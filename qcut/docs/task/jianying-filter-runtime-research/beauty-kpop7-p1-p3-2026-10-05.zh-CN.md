# beauty-7-kpop：P1-P3 第一轮实现与真实验证

日期：2026-10-05。分支：`beauty-7-kpop`。下文路径相对仓库内 `qcut/`。
这是阶段性交付，不是 P1-P3 全部完成；未改 P4/P5，也未启用正式时间线后端。
任务定义见 [优先级交接](beauty-kpop6-priority-handoff-2026-10-05.zh-CN.md)。

## 结论

| 项目 | 本轮新增证据 | 仍未通过 |
| --- | --- | --- |
| P1 小脸 | 原生 V5 完整一轮 106 点、V6 首轮 30 条规则读取 QCut 发布点，加载、运算、存储逐位核对通过 | 最终形变渲染交接、GPU 消费、三人物多强度 RGBA |
| P2 高光/雀斑 | 矩阵 getter 与下一次 BachVariant 复制的真实 64 字节证据；硬件槽调度及失败关闭探针 | 后续 EngineVariant/Lua 生命周期、实际 setMatrix/DeviceProperty 全链、候选拟合和 6 项图像 |
| P3 独立几何 | inner 初始化、空历史、近零缩放 CPU 分支；独立 Stage2 输入准备；普通分支旧实测输入回放保持一致 | 新分支真实捕获、独立正逆矩阵、真实输入替换及整链 RGBA |

本轮没有产生合格的新最终候选图，不能更新历史的 **78 EXACT / 6 MISSING**，
也不能据此宣称效果差距已经消失。原生研究宿主不等于剪映 GUI 导出。

## P1：从发布证据推进到真实点读写

新增 `face_live_reshape_points.py` / `face_live_reshape_trace.py`，通过
`face_live_bridge_probe.py --trace-reshape-points v5|v6` 显式启用。
仍须搭配 `--publish-reshape-candidate --single-frame --cold-frame`。

- 固定二进制 SHA/UUID；绑定当前 publication、prediction=1、时间戳=0、face=0、线程和地址。
- 仅借第四个硬件槽，逐点切换 load/store 断点，不写进程内存、不执行目标函数、不续跑未知停止。
- V5 的 X 为 float32 乘法；Y 的 `(1-y)*height` 保留原生 double 中间步骤后再转 float32。
- V6 按规则选择源点，逐次 float32 运算；不能把规则输出错误地当成顺序 106 点。
- 验证原始点不变、两个完整输出区间不别名；覆盖相同及部分重叠区间、过期身份和缺失记录负例。

本机私有证据根：`.local/jianying-model-pytorch/`。

| 运行目录 | 输入 | observer 结果 | 完整 render audit |
| --- | --- | --- | --- |
| `beauty-kpop7-reshape-v5-20261005-r1` | kpop-front，小脸 +80 | 106 点 / 318 callbacks，complete=true | 失败，保留消费门槛 |
| `beauty-kpop7-reshape-v6-20261005-r1` | 同上 | 30 条规则 / 60 callbacks，complete=true | 失败，保留消费门槛 |
| `beauty-kpop7-reshape-v6-20261005-r2` | 同上，加严完整区间重叠检查后 | 30 条规则 / 60 callbacks，complete=true | 失败，保留消费门槛 |

上述不是三个人物，也不是 V6 所有内部 pass。探针 scope 为
`first-final-prediction-selected-conversion-pass`。三个目录的 `live/observer.json`
记录分段证据；顶层 `report.json` 仍拒绝 `makeup final rendering lacks landmark consumption`。
`renderer_consumption` / `gpu_consumption_verified` / `product_backend_enabled` 都保持 false。

### P1 下一步

从已验证目的数组继续跟踪下游形变对象和绘制输入，建立真正的消费回执，不能直接调用
`converted()` 绕过严格失败。固定版本的后续候选边界包括 V5 的 `0x9d69e8`、
`0x9d6a40`、`0x9d6a54`；这些目前只有静态定位，不是已验证调用链。
闭环后再对 front-smile / kpop-front / outdoor-male 各做 0、中、高强度冷启动和灰度差分。

## P2：矩阵的复制链比 getter 指针更长

新增 `face_live_mesh_matrix_{abi,capture,audit,trace,bridge}.py`，显式入口为
`--trace-mesh-points --trace-mesh-matrices`，继续要求冷启动、单帧、staged makeup。
保持两个原生库 hash/UUID 锁定；每次只占一个观察槽，地址滑动在 launch 后解析。

审计器实现 getter、BachVariant 复制、网格复制、renderer props、setMatrix 和
DeviceProperty 的有界检查。**后半段只有合成测试覆盖，不能称原生完整路线通过。**

真实高光测试均为 kpop-front / Sweetheart +80，失败目录完整保留：

1. `beauty-kpop7-mesh-matrix-highlight-20261005-r1`：MVP getter 的 64 字节与源矩阵一致；
   下一次 model getter 时临时对象已失效，报 `matrix Lua clone changed`。
2. `beauty-kpop7-mesh-matrix-highlight-20261005-r2`：增加 `0xc2d8ec` / `0xc2d938`
   的 BachVariant 复制回执，MVP 的第二份 64 字节验证通过；下一次 model getter 仍拒绝，
   因为这份 BachVariant 也不是最终 Lua 数据。没有删掉生命周期校验继续往下跑。

两次均停止目标并完成清理；不是 ONNX 精度失败，也不证明高光效果本身错误。
顶层没有所有请求回执的错误来自严格停止，具体原因应看 observer 的失败及 events。

### P2 下一步：先补所有权交接，不换模型

静态路径已收窄到以下边界；均适用于当前 hash 锁定的 `libcccreator.dylib`：

```text
mesh.mvp getter
  -> 临时 64-byte Matrix
  -> c22ff8 / c1c12c / BachObject::copyFrom：BachVariant 拷贝
  -> 404924 的 404ab0：读取 BachObject
  -> 40146c 的 401548：转 Matrix4x4f，写入调用栈临时值
  -> 401550 / 5f38ac / 5f3bb0：EngineVariant
  -> 6abaf8 -> 6b4a04 / 6ae0e4：Lua typed data
  -> renderer.props:setMatrix -> DeviceProperty -> GPU
```

当前只实测到前两次复制。下一轮按每次复制的源、目的、类型、调用身份和生命周期取证；
不可将内容相等当成同一对象，也不可在临时内存释放后继续读取它。
只有完整的矩阵交接后才能继续候选关键点到拟合生产者的来源审计；原生网格复制本身
不属于 QCut 独立拟合。高光/雀斑六项仍缺合格候选图。

## P3：独立算术和正确的 Stage2 输入

已新增 `face_extra_inner_math.py` 及测试，改造 `face_extra_crop_geometry.py`：

- 空 current 或空输入：复制完整输入，保留状态。
- 近零 scale：复制完整输入，可保留 280 点长度；previous 更新为旧 current，保留 first/delta/count。
- 普通分支：仍只使用前 106 点，分别执行 float32 算术，不改变已验证的普通路线。
- 初始化：清理/写入当前点，保留 alpha、previous 和 delta；支持范围明确限制为 primary106。
- Stage2 目标应由 `PartFaceMeanFace @ 0x5ddf88` 准备，
  `float32((double(value)/256)*160)`；不能使用已有的 `ExtraInfoMeanFace @ 0x5dd088`。

新分支是静态重建和 CPU 合约，**还没有新分支原生调用捕获**。原有 live capture
仍明确拒绝空历史/近零等未验证 profile，没有因实现 CPU 算术而放宽。
本轮回放两个旧真实 capture 的普通 inner 路线，算术/状态位值均保持相等：
`beauty-kpop6-direct-inner-20261005-r3`、`beauty-kpop6-direct-inner-kpop-20261005-r1`。
这是旧输入回放，不是新原生图像验收。

静态分析还确认 `computeTransform @ 0x3ae2b8` 为四参数相似变换，不是任意 affine/SVD。
按顺序 float32 求质心、中心化及 `C=sum(x*u+y*v)`、`K=sum(x*v-y*u)`、
`D=sum(x*x+y*y)`，得到 `a=C/D`、`b=K/D` 和平移。
求逆包含融合运算与 double 中间值，不能直接用通用矩阵库假定逐位相等。
原生 forward 没有 D=0 保护，inverse 使用精确零分支；ready 标记不代表数值有限。

### P3 下一步

先在 `0x2d7978` 调用前捕获 T=x0、x1 的 212 个源 float、T+0xc0 的 212 个目标 float
及 FPCR；在 `0x2d797c` 返回后读取 T 与 T+0x60 的正逆矩阵，尊重 stride。
只用调用前数组独立计算，返回矩阵仅供对比。随后补原始 PartFaceMeanFace 的准备校验。
必要时在 `0x3ae878` 捕获累加中间量、在 `0x3ae9f8` / `0x3ae9fc` 区分求逆误差。
当前仍为 `owned_geometry_enabled=false` / `geometry_parity_verified=false`。

## 测试与重跑

- 主 agent 定向回归：**435 tests，0 failure，0 error，0 skip**。
- 日志：`.local/jianying-model-pytorch/beauty-kpop7-p123-tests-20261005-r1.log`。
- 覆盖 reshape 算术/控制器/启动器、mesh ABI/复制/矩阵、共享 LLDB/probe、Extra/inner/crop。
- 这不是全仓 CI、编辑器 E2E、跨平台或视频验收；本轮未执行这些验收。
- 新原生运行全部串行，运行期间冻结非测试研究源码，依赖未变和进程清理均成功。
- 运行失败也保留 report、observer 和 stdout/stderr，不覆写 r1、不自动重试到通过。

复现先检查各目录的 `report.json.command`，使用新输出目录及新 lease。
局部成功看 observer；整链成功必须看顶层严格 audit，不能只看 complete=true 的子对象。
模型、效果包、照片、反汇编原文和全部运行产物只留本机 `.local/`，不提交到 Git/CI。
代码按 single file / single commit / push 保存；不自动合并或触发发布。
