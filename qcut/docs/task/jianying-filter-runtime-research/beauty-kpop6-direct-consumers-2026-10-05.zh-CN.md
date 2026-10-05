# beauty-6-kpop：直接消费与内层输入验证

日期：2026-10-05。分支：`beauty-6-kpop`。本轮起点：`261ba8fc2`。
前置：[消费路由与剩余覆盖](beauty-kpop6-consumer-routing-2026-10-05.zh-CN.md)。

## 结论边界

继续三条独立研究任务：二维/三维消费、reshape 发布、直接 inner 输入。
主线程串行运行原生测试；运行时冻结研究源码。所有新入口默认关闭，
没有开放产品候选后端，没有将静态对齐认定为分钟级、多脸、跨平台或摆脱原生依赖。

## K-pop 腮红：轮换硬件槽，三次独立通过

此前 LLVM 下仍失败的 `kpop-front--makeup-blush-baby-pink-p80`，
新增显式 `--rotate-makeup-points` 后三次独立冷启动通过。
目录为 `.local/jianying-model-pytorch/beauty-kpop6-rotating-kpop-blush-20261005-r{1,2,3}/`。
每次只运行一次，不在单次任务内重试；此前失败目录原样保留。

固定版本的 XY 读取位置是 `0xa207f0`，变换后写入位置是 `0xa20804`。
新控制器在同一个第四硬件槽中轮换这两个位置：先关闭当前位置，再启用下一位置。
不会继续未知异常，不使用软件断点，不写目标内存，不放宽任何像素或效果活性门槛。
这消除了这三次测试中的重复同址硬件停止，但不能据此宣称已证明所有调试器异常的根因。

每次都验证：

- 2 次新鲜 ONNX 预测，最终预测的 106 个源点加载和 106 个目的点存储完整配对。
- 模块 UUID、调用位置、线程、预测编号、原始数据地址、点索引、宽高和来源记录匹配。
- 实际内存与寄存器中的目的值等于独立计算的 float32 变换。
  Y 必须按 `float32(height - float32(y * height))` 的原始运算顺序计算。
- 原始数据未被改写，目的区间不与原始点区间重叠；几何消费、GPU 完成和原始结果恢复通过。
- 原生和候选均有实际效果，最终 RGBA 差异为零。

r3 的变化像素为 119,531，最大通道变化 13；候选对原生变化像素为 0。
已目视核对输出及固定增益 8 的灰度差分：原图差分集中双颊、鼻部和下巴，
候选/原生差分全黑，Alpha 也独立比较。

## 最新比较页

本地目录前缀：`qcut/.local/jianying-model-pytorch/`。

- 汇总清单：`beauty-kpop6-complete84-matrix-20261005-r3.json`。
- 页面：`beauty-kpop6-complete84-report-20261005-r3/index.html`。
- 结果：**78 EXACT / 6 MISSING**，486 张 PNG。
- 唯一新增的 EXACT 是 K-pop Baby pink 腮红；r3 清单保留此前失败审计路径。
- 剩余 6 项是 3 个人像各自的 Sweetheart 高光、Sun kissed 雀斑。

这是多次明确运行证据的汇总，不是同一配置一次完成 84 项。
参考画面来自固定版本原生研究宿主，不是本轮新导出的剪映 GUI。
78 项都是原生依赖的混合链通过，不意味着拟合、遮罩、美妆渲染器已经独立实现。

## 后续验收

### 小脸实际发布已验证，消费仍未通过

`beauty-kpop6-reshape-publication-20261005-r1` 已执行新的显式
`--publish-reshape-candidate --single-frame --cold-frame` 路径。
两次预测都出现 `live_reshape_publication` 和 `live_reshape_update_exit`，
QCut 点数据与原始数据隔离、源点不变、线程/graph/face ID 和新 binding 均核对通过。
observer 正常完成，记录 66 次 getter 命中；GPU 完成后的原始结果恢复也有回执。

**最终 audit 仍失败**：`makeup final rendering lacks landmark consumption`。
这是复用的渲染阶段验收错误名称，不表示该项经过了 MakeupV2；
reshape 路径故意不调用 `converted()`，发布或 update 返回不能代替实际消费。

新的 getter 栈证实 prediction 1 同时进入 V5 和 V6 的逐人脸处理：
V5 返回位置 `0x9d64f4/0x9d6508`；V6 包含 `0x9d73cc/0x9d7430/0x9d76e0/0x9d7714`。
固定二进制的下一步采集位置为：

| 分支 | 直接读取/写入位置 | 注意 |
| --- | --- | --- |
| V5 | `0x9d6640` X、`0x9d664c` Y、`0x9d6660` 写入后 | 源 `x9` 对应当次 owned_points，索引 `x8 >> 32`，逐点比 float32 位值 |
| V6 | `0x9df290/0x9df298` 锚点、`0x9df364` 索引加载、`0x9df3c8` 写入后 | 规则选择子集，不能强加顺序 106 点覆盖 |

这些位置来自静态核对，**尚未跑新点读取探针**；只能用于下一步设计。
具体内存地址必须绑定当次 publication，禁止把 r1 地址硬编码进下一次执行。

### 首次真实采集纠正两个容器假设

- `beauty-kpop6-direct-inner-20261005-r{1,2}` 停止于输入容器校验。
  r2 读取的真实 input 是堆存储、280 点、capacity 306，而非 inline 106 点。
  正常滤波分支的历史计数仍为 106，仅返回 106 点；调用者只覆盖矩阵前 106 列，
  不能把另 174 点当成内层返回输出。空状态/近零 scale 分支不同，必须分开验收。
- `beauty-kpop6-mesh-highlight-20261005-r{1,2}` 停止于顶点数校验。
  r2 顶点数组为 17,556 字节，即 1,463 个 Vector3f；接口名称中的 1256 不是这一帧实际数组长度。
  getter 的模块、虚表及 face ID 校验已通过，但尚不能认定完整复制或候选网格所有权。

两次 r2 都只增加已有描述符字段的错误记录，不放宽判断，也没有把缺失输出标为通过。
后续按真实布局修正契约，必须重新运行完整路径。

### 直接 inner 修正后：两个人物完整通过

修正只接受已确认的两种输入布局：inline106，以及 heap280/capacity306。
堆输入不得与输入/输出描述符、滤波器和历史状态存储重叠；返回时检查全部 560 个
float 位值未变。独立算术明确取历史计数字段规定的前 106 点，不把其余 174 点冒充输出。
空历史或近零 scale 分支仍拒绝，不把正常分支结果推广过去。

| 本地运行 | 人物/效果 | 最终 RGBA | 独立回放 |
| --- | --- | --- | --- |
| `beauty-kpop6-direct-inner-20261005-r3` | front-smile / 口红 | 零差异 | 848 个坐标值逐位相等 |
| `beauty-kpop6-direct-inner-kpop-20261005-r1` | kpop-front / Baby pink 腮红 | 零差异 | 848 个坐标值逐位相等 |

848 包含输出 XY 212、current 212、previous 212、delta X/Y 各 106。
参数、计数、初始化状态也匹配；初始化预测的配置旁路被单独记录，不伪造调用事件。
两次的实际输入前 106 点亦与此前 Stage2 重建值逐位一致，但独立 inner 算术使用的是
直接捕获的输入和调用前状态，**不使用返回后状态或 Stage2 矩阵修正结果**。

每个目录的 `direct-replay.json` 为 CPU 审计结果，可复现：

```sh
.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_extra_crop_geometry.py \
  --observer <运行目录>/live/observer.json --replay-direct-inner-filter
```

两个原生运行均完成清理、依赖未变检查和真实画面比较。
这是普通主点 inner 子步骤验证，不等于 Stage2 几何已独立；调用前初始化、
实际裁剪和最终渲染仍依赖原生，`owned_geometry_enabled=false` 保持不变。

### 三维读取：三个人物、两种效果均完成

按真实数组长度修正后，只允许 1256/1463 两种明确 profile，且顶点、法线数量必须相等。
六例均观察到 1463 点，完成 getter、顶点复制、法线复制三个阶段：

| 人物 | Sweetheart 高光 | Sun kissed 雀斑 |
| --- | --- | --- |
| front-smile | 读取追踪完成 | 读取追踪完成 |
| kpop-front | 读取追踪完成 | 读取追踪完成 |
| outdoor-male | 读取追踪完成 | 读取追踪完成 |

K-pop 高光目录为 `beauty-kpop6-mesh-highlight-20261005-r3`；其他五例目录为
`beauty-kpop6-mesh-<portrait>-<highlight-sweetheart或freckles-sunburn>-20261005-r1`。

每例均验证全部顶点/法线字节、末组加载寄存器、数量寄存器、源区间不变和目标步长。
实际目标 stride 为 32；顶点位于记录起点，法线位于记录起点 +20，属于同一目标网格。
模块/调用位置、线程、预测、face ID 均绑定；observer 完整通过且未写目标内存。

**六例最终 bridge audit 仍拒绝通过**，原因仍是缺少候选 landmark 消费。
`qcut_mesh_ownership_verified`、`matrix_consumer_verified`、`gpu_consumption_verified` 全为 false。
我们确认了原生拟合结果到 CPU 渲染网格的真实复制，但没有把它改名为 QCut 自己生成的网格。
因此对比页仍是 **78 EXACT / 6 MISSING**，没有凭诊断完成把这六项提升成 EXACT。

### 集成验证与提交

- 完整相关 Python/C++ CPU 回归：**756 通过，0 skip**，含本地模型与真实边界快照绑定。
- 新宿主 Objective-C++ 严格语法编译通过；实际原生运行也完成了宿主构建。
- 本轮只改变研究探针、实验宿主、测试和文档；未启用 Electron 产品候选入口。
- 代码、测试和本文均按单文件提交并逐个 push；人物、模型、包及本地证据不推送。
- 本轮没有进行新的分钟级、多脸、Windows/x86、编辑器预览/导出验收，也没有触发发布。

### 仍需完成

1. 三维高光/雀斑：在已证实的 type-16 / 1256 接口路径上，接入 QCut 拟合输入/结果的
   所有权交接、矩阵消费和 GPU 后恢复。仅复制本批原生 1463 点网格不能算独立拟合。
2. 小脸：单独的 FaceReshapeSystem 路由，发布记录和真实点消费必须分别验证。
   不能借用 MakeupV2 成功记录，也不能把 native update 返回视为消费成功。
3. 几何：直接 inner 输入和输出已在两个人物验证；下一步独立重建 Stage2 矩阵和
   调用前初始化，再替换宿主输入。空历史/近零 scale 分支仍需要单独实现与实测。
4. 视频：现有两次 24 帧通过仍不足以验收连续分钟级、多人、遮挡恢复、跳转、
   取消和预览/导出一致性，候选产品入口保持禁用。

模型、效果包、人物图像、原始日志和反汇编仅留本地，不提交到 Git。
