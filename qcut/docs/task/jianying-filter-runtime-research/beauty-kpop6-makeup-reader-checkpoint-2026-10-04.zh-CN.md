# beauty-6-kpop：口红原生读取路径检查点

日期：2026-10-04。分支：`beauty-6-kpop`。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。
基线：`c2effe5dd9b6c5d72d555edd7930859653467e6b`，v2026.10.04.2。

## 本轮结论

柔和粉口红的阻断已从笼统的“没有消费”缩小到具体原生调用路径：
真实冷启动中，`FaceMakeupV2System::onUpdate` 直接读取 type-4 人脸结果，
没有经过现有 `FaceAdapter` 克隆交接入口。
ONNX 已返回预测 0，但原生渲染没有取得候选克隆的有效消费收据，因此宿主仍拒绝输出候选图。

这是已复现的**交接覆盖缺口**，不是已证明的 ONNX 数值精度问题。
尚未解决口红接管，尚未证明美妆使用候选关键点，更没有实现独立于原生运行库的美妆。
本轮不修改 UI、不启用产品候选后端、不放宽消费或 RGBA 零差异门槛。

## 只读探针

新增 `research/local-model-pytorch/face_live_reader_trace.py`，通过
`face_live_bridge_probe.py --trace-face-readers` 显式启用。

- 原有 3 个 liblens 推理观察断点保持不变，新增第 4 个硬件断点。
- 固定 libcccreator UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
- 固定库 SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
- 读取入口：`0xc15cd4`，`x0 = BachAlgorithmResult*`、`w1 = type`，仅保存 type 4 调用栈。
- 上限 512 次断点回调、每条 24 层栈、符号 512 字符，沿用 240 秒观察预算。
- 不写目标内存、不调用目标函数、不向 worker 发送额外消息，不修改推理序号或裁剪状态。
- `reader_trace.events` 独立于推理事件及消费 JSONL，始终标记 `renderer_consumption=false`。
- 观察器成功不等于候选成功；宿主拒绝请求时，整个审计仍失败。

同时修正协议报错：有序、匹配请求的原生拒绝原因不再被
`fresh host did not acknowledge every request exactly once` 覆盖。
错误正文限长并转义控制字符；乱序、陌生请求、重复响应仍被拒绝。

## 真实冷启动结果

输入统一为 `front-smile-original.jpg`，640 x 640，零预热。
以下目录前缀均为 `.local/jianying-model-pytorch/`；每次使用新目录、宿主和 worker。

| 运行 | 结果 | 证据 |
| --- | --- | --- |
| `beauty-kpop6-lip-cold-20261004-r1` | 失败复现 | 预测 0 收到候选；未消费；没有候选图；清理完成 |
| `beauty-kpop6-lip-trace-20261004-r2` | 读取路径已观察，候选仍失败 | 13 次 raw getter 命中，10 次 type-4；全部属于预测 0、同一 graph/thread |
| `beauty-kpop6-eye-trace-20261004-r3` | 无效参数被拒绝 | `face_adjust_eye` 不适用于所选包；原生与候选都不改变原图，不能算通过 |
| `beauty-kpop6-eye-trace-20261004-r4` | 大眼 +40 对照通过 | 正确参数 `face_adjust_EnlargeEye`；2 次预测、2 次真实转换、2 次 GPU 后恢复 |

大眼通过项：

- 原图改变 4,760 像素，RGB 最大差 30；变化框 `[212,109,408,173]`。
- 原生与候选 RGBA 差异像素 0，最大差 0。
- 两者 RGBA SHA256：`c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8`。
- 新探针记录 57 次 getter 命中、51 条 type-4 栈；包括原生读取、交接检查和恢复检查。
  这些命中不替代已有 2 次转换/恢复收据。

口红原生基线：4,096 个 RGB 像素改变、最大差 44、Alpha 不变。
候选输出缺失，所以没有“口红两链误差数值”。

## 口红实际调用栈

证据文件：`beauty-kpop6-lip-trace-20261004-r2/live/observer.json`。
表内偏移是固定库的非 ASLR 文件地址；“返回地址”不冒充函数入口。

| 条数 | 观察到的上层路径 | 意义 |
| --- | --- | --- |
| 4 | 函数 `0x99b850`，返回地址 `0x99be78/0x99bea0/0x99c04c/0x99c1f8` | 第一阶段原生读取，具体系统身份未在本轮确认 |
| 2 | Lua -> `0xc1f1f0/0xc1f228` -> face count/base accessor | 效果脚本确实读取数量和基础人脸；不能据此声称渲染几何消费 |
| 2 | `0x9ea110` -> helper `0x9eb348` -> count/aux accessor | 与美妆 V2 更新函数处于同一原生栈 |
| 2 | `0x9ea110` -> `0xc16554/0xc16634` -> `0xc15cd4` | 美妆 V2 直接读取数量和 extra 人脸数据，绕过 FaceAdapter |

静态分析通过构造函数/vtable 将 `0x9ea110` 识别为 `FaceMakeupV2System::onUpdate`：
vptr `0x35e6378`、槽 `+0xb8`。静态几何 helper `0x9eb6e8` 可读 base/extra/aux，
但本轮预测 0 的栈没有命中它，不能写成已观测到该 helper 消费候选嘴唇点。
旧 `FaceMakeUpSystem` 更新入口 `0xa24730` 也只是静态候选，本次没有动态命中证据。

### 待动态验证的对象入口

静态反汇编补齐了下一步对象级钩子的访问路线，但尚未安装或验证：

- 宿主保留的 `feature_` 是原生 Segment 指针，C API 创建结果没有额外句柄包装。
- `FeatureSegment::getScene(int)`：`0x180b8ac`，读取已有 scene、不主动加载。
  feature 的场景记录 begin/end 位于 `+0x2e8/+0x2f0`，记录步长 `0x58`，scene 在记录 `+0x20`。
- scene 更新函数 `0x61cc20` 使用 `scene+0xb0/+0xb8` 的系统记录，步长 `0x58`，记录 `+0` 为 System 指针。
- V2 vtable shadow 候选需复制含 2 个 ABI 头的 32 个 qword；替换 shadow index 25，
  对象 vptr 指向 shadow index 2。调度 ABI 为 `x0=this`、`d0=deltaTime`。
- 实现时必须额外验证内存可读、起止顺序、步长整除、数量上限、vptr 和目标函数；
  这些是固定版本内部布局，不是可跨版本复用的公开类型。
- 不使用尚未明确 name-key ABI 的 `Scene::getSystem`；不把构造返回容器的 `getScenes()`
  错当普通指针 getter。不尝试给直接调用的 `getBaseInfo` 编造虚函数钩子。

即使完成 onUpdate 钩子，也只证明进入美妆更新作用域，不能自动标记候选点已消费。

## 对照图

本地 HTML：`output/beauty-kpop6-reader-20261004/index.html`。
机器报告：同目录 `report.json`；合计 `EXACT:1 / MISSING:1 / AUDIT_FAILED:1`。

共 15 张 PNG：大眼 6 张、口红 3 张、被拒绝的无效参数对照 6 张。
原图、原生、候选分别保存；灰度统一为 `min(255, 8 * max(abs(RGB difference)))`。
人工检查灰度图：大眼变化集中眼部，原生口红变化集中嘴唇。
口红候选及其差分标记为 `UNAVAILABLE`，不复制原生图填补。

本轮没有新的剪映 GUI 导出或 Electron UI E2E；这些是 QCut 本机宿主的研究链对照。
尝试浏览器截图时，Playwright CLI 拒绝 `file:` URL，未绕过此限制；PNG 已逐项读取检查。

## 下一步验收顺序

1. 确认 `FaceMakeupV2System` 对象和 graph 的可验证访问方式，优先对象级 vtable shadow，
   不凭推测扫描内存或全局修改原生代码页。
2. 在真实美妆更新作用域交接独立克隆，保留原生 source、extra 数据、遮罩和所有权。
   明确区分发布、实际读取、GPU 完成后的恢复；检查用 getter 永不算消费。
3. 给新路径独立的 consumer 标识，Python 和 Electron 同时验证 binding/graph/预测/时间戳。
   冷启动仍要求 `[0,1]` 两次预测都完成，不增加隐式预热或复用历史点。
4. 同值输入先要求零 RGBA 差异，再做受控嘴唇相关扰动，证明变化确实来自候选点。
   眼部扰动通过不能替代嘴唇的因果证据；数量/extra 读取也不能冒充主 106 点消费。
5. 通过单图单口红后才扩展到三个人物、其它妆容、多强度、真实 Electron UI，
   最后才考虑分钟视频、多脸和跨平台。当前仍不进入这些能力的验收通过数。

## 测试与复现

10 个 Python 套件运行 126 项：125 通过，1 项真实 Apple Development 签名测试因未显式启用而跳过。
新探针、协议报错及直接相关测试 54 项全通过，无跳过。
真实探针运行使用稳定开发签名宿主，所有本轮运行均完成进程清理。
大眼通过运行对应逻辑版本 `db0947b52`；之后仅补充断点说明与本检查点文档。

```bash
cd /Users/peter/Desktop/code/qcut/qcut/research/local-model-pytorch
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_reader_trace_test face_live_bridge_lldb_test \
  face_live_bridge_probe_test face_live_bridge_audit_test
```

真实重跑使用各审计 `report.json` 内的 `command`，先检查父进程/GPU lease 无占用，
保留 `--single-frame --cold-frame --stable-host --trace-face-readers`。
每次必须换新输出目录和 Python cache prefix；口红预期仍失败，不能为了绿灯取消检查。
私有运行库、模型、效果包、人物图和完整审计不提交 Git。
