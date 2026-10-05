# beauty-6-kpop：美妆主 106 点真实读取证据

日期：2026-10-05。分支：`beauty-6-kpop`。
工作目录：仓库内的 `qcut/`（本文其余路径均以它为基准）。
本轮起点：`cae2d173b4874b612f13e6f4788fab8831fb0e87`。
前置记录：[初始化与最终渲染阶段协议](beauty-kpop6-render-stages-2026-10-05.zh-CN.md)。

## 本轮结论

**“口红几何路径究竟有没有读取本次候选点”已获得直接证据。**
三个独立新进程运行中，原生美妆几何转换均顺序读取全部 106 个主关键点。
每个 XY 的加载寄存器位模式、候选克隆内存、当次 ONNX worker 返回点的 float32 位模式完全一致。
这不是 getter 命中、指针发布成功或历史结果回放。

**口红最终渲染接管仍未通过。** 只读观察器生成的是 CPU 读取证据，尚未接入本机宿主的消费收据协议。
原有 `makeup final rendering lacks landmark consumption` 验收继续拒绝；没有有效候选口红 RGBA，
因此本轮没有口红效果差分图，也不能宣布口红效果已对齐或把它归因于 ONNX 精度误差。

大眼 +40 的既有冷启动链通过回归：原生/候选输出 0 像素差异，且与前轮输出 SHA256 相同。
所有代码仅用于显式研究模式；产品候选后端仍禁用，没有改变 Electron UI 或放宽最终渲染门槛。

## 直接读取证据怎么取得

固定 libcccreator UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
本轮重新核对了以下 arm64 指令及两个调用返回点；偏移只适用于该二进制版本。

```text
0xa207e0  ldr  x11, [x19, #0x20]  // base -> primary vector
0xa207e4  ldr  x11, [x11, #0x10]  // vector -> XY begin
0xa207e8  add  x11, x11, x8       // point byte offset
0xa207ec  ldp  s2, s3, [x11]      // actual normalized source XY load
0xa207f0  fmul s2, s2, s0         // hardware stop before scaling
0xa207f8  fmul s3, s3, s1
0xa207fc  fsub s3, s1, s3
0xa20800  stp  s2, s3, [x11]      // converted destination XY
```

上面是节选，不是完整函数。断点停在 `0xa207f0` 执行之前，此时 `s2/s3` 已加载，尚未缩放。
允许的调用返回偏移为 `0x9eb7bc` / `0x9eb9c4`；三次真实运行均来自后者。
本轮直接证明的是归一化源 XY 加载，不是缩放后写回结果或 GPU 渲染结果。

观察点逐项检查：

- 固定 UUID、PC、硬件断点及调用者，拒绝其他版本或路径。
- 当前线程与宿主同步刷出的 publication 一致，预测 1、时间 0、binding 2、graph 1、face 0。
- `x19` 等于当次 `owned_base`；vector 的 begin 等于 `owned_points`，跨度严格为 `106 * 8` 字节。
- `x8` 从 0 到 840，步进 8；`x11 == owned_points + x8`，不是原生 source 地址。
- `s2/s3` 用寄存器原始数据读取为两个 uint32，不做浮点数到整数的数值转换。
- 寄存器位模式等于加载地址内存；离线审计再与当次 worker 的每个候选点转为 float32 后逐位比较。
- 两次发布的克隆互不复用，不能与原生 source 缓冲别名；初始化与最终渲染的完整生命周期必须有序。

只读观察器不写目标内存、不执行目标函数、不设置软件断点、不额外触发推理。
这里的“只读”指观察器；QCut 宿主既有的候选克隆填充与发布仍照常发生。
不允许将主点读取推断为 extra 点、遮罩、GPU 或最终产品效果已验证。

## 实现与拒绝条件

- `face_live_makeup_point_trace.py`：单一 XY 观察职责，复用版本锁定的硬件断点安装器。
- `face_live_bridge_lldb.py`：可选第四个硬件断点；XY 与 raw getter 观察互斥，保留原有三个推理断点。
  每轮最多 848 次命中、240 秒；回调不进入推理 exchange。新会话先清空旧 observer 状态。
- `face_live_makeup_hooks.h`：publication 增加源 base/points、线程和 face ID，供真实加载关联。
- `face_live_makeup_point_audit.py`：独立 stdlib 审计，绑定 worker 会话、进程、阶段、发布、地址和数值。
  接受 1 到 8 个完整的顺序 106 点 pass；不完整、重复、跨预测、位模式不符均拒绝。
  观察器只读声明、空错误/异常停止记录必须明确存在，缺字段不能当作成功。
- `face_live_bridge_probe.py`：新增 `--trace-makeup-points`，必须显式启用冷启动、美妆发布及阶段模式。
  在检查最终宿主响应前保存狭义读取证据，随后继续执行原有最终验收，不把失败改成成功。

狭义结果有意区分为：

```json
{
  "candidate_xy_reads_verified": true,
  "point_count": 106,
  "read_count": 106,
  "pass_count": 1,
  "renderer_consumption": false,
  "pipeline_acceptance": false,
  "product_parity_verified": false,
  "extra_points_verified": false
}
```

`renderer_consumption: false` 表示尚未产生宿主所需的消费收据，不是说 CPU 没有读这些点。
整体报告仍是 `passed: false`，不能只摘取狭义的 `true` 宣称链路通过。

## 本机实测

口红输入沿用 `front-smile-original.jpg`，640 x 640，强度 0.8，柔和粉动态效果包。
各运行使用新进程、worker、会话和 Python cache prefix；没有重复暖机。
下列目录均位于 `.local/jianying-model-pytorch/`，原图、库、模型、效果包和原始日志不进 Git。

| 运行目录 | 结果 |
| --- | --- |
| `beauty-kpop6-lip-xy-20261005-r1` | 106/106 XY 加载位模式匹配；最终消费门槛拒绝 |
| `beauty-kpop6-lip-xy-20261005-r2` | 独立重复相同读取结果；最终消费门槛拒绝 |
| `beauty-kpop6-lip-xy-20261005-r3` | 收紧只读声明/异常停止审计后，重新真实运行仍匹配 106/106；最终消费门槛拒绝 |
| `beauty-kpop6-eye-xy-regression-20261005-r4` | 既有大眼 +40 冷启动成功；2 次预测、2 次转换、2 次恢复；原生/候选 RGBA 相等 |

四轮依赖检查均未发现变化，进程清理完成。口红 r1-r3 的 `live/` 没有 `.rgba` 文件，
初始化图继续被抑制，失败不能留下冒充最终效果的候选图片。

口红三次的加载位模式摘要相同：
`6329d5d02e34d5b39e775ac81b241564184daed30cccef87188894367412360e`。
这是以下紧凑 JSON 输出（包含结尾换行）的 SHA256，不是原始 float32 缓冲摘要：

```bash
jq -c '[.point_trace.events[].loaded_bits]' <run>/live/observer.json | shasum -a 256
```

大眼回归相对原图改变 4,760 像素，最大差 30，变化框 `[212,109,408,173]`，不是两个无效输出相等。
原生/候选之间改变像素 0，最大差 0；两者 SHA256：
`c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8`。
这是该单图/单强度的回归，不扩展为全脸型、全美妆或原生网络中间数值完全一致。

## 测试与复现

8 个 Python 套件共 **105 项通过，无跳过**。
覆盖读取位置、最后一个点、地址/线程/调用者混淆、位模式差异、NaN、缺失/重复/乱序日志、
旧会话状态、预算超限、标志互斥，以及读取证据不能冒充最终渲染成功。
本轮真实宿主构建和执行通过；没有运行产品全量 CI、Electron UI E2E、剪映 GUI 导出、
分钟级视频、多脸、Windows/x86 验收。

```bash
cd "$(git rev-parse --show-toplevel)/qcut/research/local-model-pytorch"
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_makeup_point_trace_test face_live_makeup_point_audit_test \
  face_live_bridge_probe_test face_live_bridge_audit_test \
  face_live_reader_trace_test face_live_bridge_lldb_test \
  face_owned_result_probe_test face_live_bridge_process_test
```

真实复跑使用各 `report.json` 的 `command`，保持固定 runtime/模型/效果包并换全新的输出目录和 cache prefix。
美妆模式需要 `--single-frame --cold-frame --stable-host --trace-makeup-system --publish-makeup-candidate
--stage-makeup-render --trace-makeup-points --execute-native --lease <owner>`。
不能同时加 `--trace-face-readers`。GPU/宿主运行应串行，运行期间冻结受 guard 保护的源码。
不得通过修改 TCC 或放宽 guard 绕过授权/来源检查。当前口红 CLI 退出码 1 是最终门槛拒绝，不是全链成功。

## 下一段工作

1. 基于已验证读取路径设计美妆专用宿主消费收据，将当次 binding/graph/预测/线程、主点加载与完整转换完成关联。
   不把 LLDB 输出、getter 命中或 publication 直接赋值为 `consumed`；不得将主点证据冒充 extra 证据。
2. 为初始化/最终渲染接入一致的 native、Python 审计协议；补错误预测、旧绑定、部分点、未恢复/GPU 未完成的拒绝测试。
   只有真实新收据成立，才考虑移除 publication-only 的强制失败门槛。
3. 获取第一张有效口红候选帧，与同参数原生结果做 RGBA 差分；再做受控嘴唇点扰动及统一增益灰度差分，
   验证嘴唇区域确实随候选点变化，而不只观察到相同结果。
4. 单图口红通过后扩展人物、强度和妆容，再接产品/Electron、实时预览与导出。期间产品候选后端保持禁用。

大蓝图依赖仍在：原生检测、调度/拟合、extra/遮罩和美妆渲染没有被本轮替换。
本轮缩小的是“候选主关键点到原生美妆几何读取”的证据缺口，不是完成独立渲染器。
