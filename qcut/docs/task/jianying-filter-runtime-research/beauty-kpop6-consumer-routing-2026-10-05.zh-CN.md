# beauty-6-kpop：消费路由与剩余覆盖

日期：2026-10-05。分支：`beauty-6-kpop`。
起点：`06ae396205b706cea179c5027c09161a879ccc22`。
前置：[三线并行推进记录](beauty-kpop6-parallel-progress-2026-10-05.zh-CN.md)。

后续：[直接消费与内层输入验证](beauty-kpop6-direct-consumers-2026-10-05.zh-CN.md)。
新轮换探针已使 K-pop 腮红三次独立通过，静态汇总更新为 78/84；
本文保留当时的 77/84 与失败记录，不把后续结果覆盖成原轮一次全部成功。

## 不能根据效果分类猜消费入口

前轮小脸、下颌线各三个人像都通过显式 `--route face` 执行，
六例均因缺少候选消费回执而失败。它们只证明该入口没有完成交接，不能证明模型精度有问题。

本轮重读原始 getter 调用栈，并对本机固定版本库作只读静态核对：

| 控制项 | 实际调用证据 | 下一步验证 |
| --- | --- | --- |
| 小脸 `face_adjust_YouTaiFace` | `FaceReshapeSystem` 的 update 调用多个 reshape 分支，再读取 type-4 人脸结果 | 需要独立的 reshape 发布与真实点读取证明，不能冒用美妆几何回执 |
| 下颌线 `face_adjust_XiaHeXian` | getter 栈中实际出现已研究的 `FaceMakeupSystemV2` update；不只是包内出现 FaceWarpX/阴影组件名称 | 用已有的显式 makeup 路由独立复测，仍要求 XY 读取、几何消费和最终像素全部通过 |

固定 core UUID 为 `D6342ECD-5432-33F0-A2AD-0C28F5699994`，
SHA256 为 `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
所有地址仅对这一版本有效，不作为跨版本 ABI。

- 小脸 update：`0x9d9428`；虚表 `0x35e58a0` 的 `+0xb8` 槽指向它。
  构造函数在 `0x9d5ae0` 形成该虚表地址并存入对象。
  update 内的日志标记及真实栈分别佐证 `FaceReshapeSystem` 身份与实际执行路径。
- 下颌线：getter 栈中的 update 返回位置为 `0x9ea1b4`、`0x9ea1bc`、`0x9ea1d8`，
  属于 `0x9ea110` 的 `FaceMakeupSystemV2`，与已有美妆入口一致。
- 原始记录在 `.local/jianying-model-pytorch/beauty-kpop6-parallel-face-20261005-r1/`，
  每个人像/控制项的 `audit/live/observer.json` 中。原始反汇编、库和人物素材不提交。

这纠正了“包名/组件名不同，所以必然不能使用美妆路由”的过度推断。
同时，getter 命中仍不是候选消费证明；一个系统消费成功也不自动证明复合效果的其他系统已接管。

## 本轮执行边界

三个 agent 分别处理剩余美妆矩阵、视频调试器停止诊断、内层滤波独立计算。
主线程集成、审核，并串行运行原生测试。研究源码在原生运行时冻结。

- 保持每个人像/控制项独立冷启动、零像素容差和效果活性检查。
- 不自动继续未知 `EXC_BREAKPOINT`，不把截断视频的部分成功改记成完整通过。
- 不把读取到的 native affine 矩阵或后验拟合当成独立几何实现。
- 不开放产品候选后端，不把本机研究结果扩展为 Windows、多脸、分钟级或预览/导出验收。

后续实测结果追加在本文；前轮失败目录保留。

## 下颌线：三个人像通过现有美妆消费链

`beauty-kpop6-completion-jawline-20261005-r1/matrix.json` 的 3/3 完整通过，
显式选择 `--route makeup --case face_adjust_XiaHeXian-p80 --extra-root <Extra模型>`。
未修改参数值、原生参考图、消费断言或零容差，也未修改产品后端选择。

| 人像 | 效果对原图变化像素 | 候选对原生 RGBA 差异像素 |
| --- | ---: | ---: |
| front-smile | 19151 | 0 |
| kpop-front | 107434 | 0 |
| outdoor-male | 56708 | 0 |

每例都有两次新鲜预测、最终候选 XY 读取、几何交接、GPU 完成后的原始结果恢复，
以及清理和依赖未变回执。比较页位于
`beauty-kpop6-completion-jawline-report-20261005-r1/index.html`，包含 18 张 PNG。
已目视核对 K-pop 图：变化集中下颌，候选/原生差分全黑。
灰度仍采用固定增益 8，Alpha 差异另外校验。

这是原生依赖的静态 +80 用例通过，不能推广为任意强度、连续视频，
也不证明复合效果中所有其他系统或所有附加点都已由 QCut 接管。
以前 `--route face` 的三例失败仍保留；小脸尚未因这次修正获得通过。

## 内层滤波：独立算术与边界状态一致

`face_extra_crop_geometry.py` 新增独立的 inner filter 算术和只读回放审计。
它不是直接套用已实现的外层滤波：内层权重使用位移比的三次方，而非外层平方根，
也不能把每一步 float32 舍入重组为代数上等价的表达式。

- 在已有 r4 原生快照上，prediction 0 的配置旁路和 prediction 1 的实际更新均与边界状态逐位一致。
- 实际更新核对 current 212、previous 212、delta X/Y 各 106，共 636 个坐标状态值，
  以及参数、计数和初始化状态。
- 前后两次坐标映射不能约掉：该输入的 212 个坐标中，5 个在 float32 往返映射后改变了位表示。
- 修改后验参考状态只会令比较失败，不改变独立计算出的结果；没有用后验状态拟合输出。
- 该步仍使用原生 Stage2 forward/inverse 和预滤波初始化状态；尚未捕获实际 inner call 的全部参数。
  因而 `owned_geometry_enabled=false`、`geometry_parity_verified=false` 保持不变。

定向测试 `face_extra_crop_geometry_test`、`face_temporal_smoothing_test`、
`face_host_geometry_replay_test` 共 89 项通过，0 skip；真实快照由
`QCUT_FACE_EXTRA_CROP_OBSERVER=<r4>/live/observer.json` 显式绑定。

## 视频：增强诊断，未豁免异常

`beauty-kpop6-completion-video24-20261005-r1` 再次未通过。
16 次已记录预测、34 次正常回调后停于 `poll`，原因为 `EXC_BREAKPOINT (code=1, subcode=0)`。
最后回调返回 false，停止位置不匹配任何已登记硬件断点；停止位置读取的指令不是 ARM64 BRK。
这些信息仍不足以证明异常可以忽略，因此宿主被清理，未继续运行或标记成功。

新增有界诊断记录调试器版本、断点/位置命中、回调尾部、停止原因原始数据、
可读取的寄存器、停止地址身份和四字节指令，并保留 `break/step` 控制日志。
逻辑断点匹配不等同已验证物理调试寄存器；不存在自动 continue 或忽略异常的路径。
这是一项定位能力改进，**不是视频稳定性修复**。

## 高光与雀斑：需要三维消费契约

本轮独立运行中，Sweetheart 高光与 Sun kissed 雀斑均完成两次预测，
但没有最终 106 点几何消费回执，不能计为成功。
进一步只读检查两个实际绑定的私有资源包 `lua/makeup.lua`，发现：

- 口红、眉毛、眼线等归于二维 makeup 实体列表。
- 高光和雀斑另归于三维实体列表，使用 `MeshRenderer`。
- 脚本按 face ID 关联 `getFaceFittingCount1256` / `getFaceMeshInfo1256`，
  将网格顶点、法线、model matrix 和 MVP 交给渲染器；顶点数量需至少 1200。
- 高光使用单独的高光遮罩、透明度；雀斑使用纹理遮罩、透明度。

资源标识：高光 `7406175318072888576/1fb1a0dfaaeadb313f4b3d3b96eaae0c`；
雀斑 `7406174488410262784/547119e40339154d17eb93c62ee9433b`。
只记录结构化发现，不提交私有包、Lua 原文或反汇编。

因此不能为这两个包删掉 XY 消费门槛，直接把像素相同记为 QCut 已接管。
正确的下一步是独立建立三维拟合结果的所有权、ID 关联、网格/姿态读取和 GPU 完成后恢复证明，
再核对最终输出。当前是“包内明确的三维路径 + 实测二维入口未消费”的证据，
尚未完成运行时三维顶点读取追踪，也未证明 QCut 能独立生成三维拟合。

## 直接 inner 调用采集的下一步

离线逐位回放报告在 `beauty-kpop6-inner-filter-replay-20261005-r1/report.json`。
两次预测分别核对 215/215 与 639/639 个浮点位值；后者包含 636 个坐标状态。
它们不是新增人物或视频验收。

下一次探针应沿 Stage2 before、inner 调用前、inner 返回、Stage2 after 轮换第四个硬件槽：
固定版本地址依次为 `0x2d9a20`、`0x2cff58`、`0x2cff5c`、`0x2d9a24`。
inner 调用前 `x0=A+0x310`、`x1=输入向量`、`x2=输出向量`，返回后必须使用保存的指针，
不能假定参数寄存器还在或将 void 函数的 `w0` 当状态码。
该向量 count 在 `+0x450`，不同于已有 float-vector 的 `+0x430`。
配置旁路必须直接去 Stage2 after；先关后开、总槽数不超过四。
详细私有交接记录为同目录 `direct-inner-capture-proposal.md`，尚未执行该新探针。

## 完整 84 项矩阵与调试器 A/B

剩余 24 张卡各三个人像的 72 项已完整执行，无中止，所有 case 清理和依赖检查通过。
该批 58 通过、14 失败；结合前轮 12 项有效结果，原始整表为 **70 EXACT / 14 MISSING**。
14 项仍保留失败审计：8 项异常硬件断点停止，6 项为高光/雀斑的三维消费缺口。
没有将原生参考输出冒充缺失的候选输出。

完整原始比较页：`beauty-kpop6-complete84-report-20261005-r1/index.html`，
有 84 个 case、462 张 PNG；70 个 EXACT 均有可见效果变化且候选/原生 RGBA 差为零。
包含原图、原生、候选和固定增益 8 的三组差分；缺少候选的项明确标为 MISSING。
已抽看 K-pop Oxygen 整妆、Girl pink 眼影、户外人物 Classical 眉毛的灰度位置，
分别集中于面部妆容、眼周和眉区。这里的参考仍是原生研究宿主，不是本轮新导出的剪映 GUI 截图。

### 显式 LLVM 选择与两次真实视频通过

新增研究选项 `--lldb-executable` 与 `--debugserver`，默认仍为 `xcrun lldb`。
只接受可执行的绝对本地路径；记录并锁定请求路径、解析路径、文件身份与 SHA256，
包括 Homebrew 别名，修改目标或文件会令检查失败。
没有改系统开发工具设置、TCC、二进制权限或模型/像素容差。

用相同视频、前 24 个源帧、大眼 0.4 和现有 BASE bridge 进行两次独立新进程测试：

| 测试目录 | 调试器 | 结果 |
| --- | --- | --- |
| `beauty-kpop6-completion-video24-20261005-r1` | Apple LLDB | 16 次预测后异常停止，失败保留 |
| `beauty-kpop6-llvm-video24-20261005-r1` | LLVM 22.1.5 | 完整 24 帧逐像素一致，60 次预测，122 次回调 |
| `beauty-kpop6-llvm-video24-20261005-r2` | LLVM 22.1.5 | 第二次独立完整通过 |

LLVM 可执行文件 SHA256：`d8297168dc260fb5ec860c085f42e080feea0f61151ed92fe9c352190b5b02b7`。
显式选择的 Xcode debugserver SHA256：`6e8ab0f0a30c30834d61ab8dd21ea54e48731903d4bca1a789d09d52dadc58e9`。
这里记录的是 debugserver 选择和哈希，不冒充已独立观察到其子进程加载身份。
实际 observer 报告确认 LLVM 22.1.5、无异常停止、未使用软件断点、未写目标内存。

每次只有 0.767433 秒源视频，另有 6 次初始化请求；不能写成分钟级、多人或实时性能通过。
切换调试器是有证据的实验路径，不证明 Apple LLDB/debugserver/kernel 的准确根因已修复，
也未让产品运行时依赖这个研究调试器。

### 回归及复现

- 本轮集成后的相关 Python 回归为 **642 通过，0 skip**，含模型/真实边界快照绑定。
- 每次 bridge 的 `report.json.command` 记录完整重跑命令、显式调试器选项及新的输出目录。
- 原始 72 项来自 `beauty_dual_isolated_matrix.py`，限定单图冷启动、Extra ONNX、每项独立进程。
- 比较页可用 `beauty_dual_matrix_report.py --matrix <84项manifest> --out <新目录>` 只读重建，
  manifest 为 `beauty-kpop6-complete84-matrix-20261005-r1.json`。
- 这些结果没有改变 `product_backend_registered=false` 和 `temporal_sequence_acceptance=false`。

### 八项静态 A/B：七项通过，一项仍失败

同样的显式 LLVM 配置下，每项只进行一次新会话，不自动反复运行直到通过：

| 人像 | 选择的原失败项 | 本次 |
| --- | --- | --- |
| front-smile | Baby pink 腮红、Natural II 睫毛 | 2/2 通过 |
| kpop-front | Baby pink 腮红、Doll 卧蚕 | 1/2 通过；腮红仍在 `0xa207f0` 发生异常硬件断点停止 |
| outdoor-male | Mixed 修容、Bittersweet 卧蚕、Natural 眼线、Girl pink 眼影 | 4/4 通过 |

三个独立目录为 `beauty-kpop6-llvm-static8-<portrait>-20261005-r1`。
清理与依赖检查全部通过。7 个新通过项仍要求完整发布/读取/几何/GPU 恢复，未改零差异门槛。
K-pop 腮红仍拒绝输出成功；说明 LLVM 选项不是针对 XY 硬件断点问题的全面修复。

最新汇总为 `beauty-kpop6-complete84-report-20261005-r2/index.html`：
**77 EXACT / 7 MISSING**，包含 483 张 PNG。
7 个缺口为三个人像各两项三维高光/雀斑，以及 K-pop 腮红。
汇总使用各明确会话的证据，**不是同一配置一次跑完 84 项全部成功**。
对应 r2 manifest 为每个替换项保存 `previous_audit` 和 A/B 说明；r1 原始整表保持不变。
“某项已有通过证据”不等于已证明其冷启动不再偶发失败。

## 剩余工作与验收顺序

1. 解决 K-pop 腮红的独立 XY 读取断点异常，补固定配置重复冷启动测试。
   不能将相同 PC、相同 ESR 或曾经通过视为自动忽略异常的依据。
2. 为高光/雀斑建立单独的三维拟合消费契约：face ID、1256 网格、法线、姿态矩阵、
   所有权和 GPU 恢复都应有实际读取回执，再做三图零差异。
3. 小脸仍需要 `FaceReshapeSystem` 发布与读取探针。下颌线通过没有修复小脸。
4. 按上文直接 inner call/return 采集方案补齐输入证据，再重建原生 Stage2 几何，
   逐步切掉矩阵依赖；现有 inner 算术逐位一致不能代替这一步。
5. 视频在不依赖研究调试器的产品路径上补持续会话、遮挡恢复、多人身份、拖动/跳转/取消，
   再做分钟级、预览/导出一致性、端到端性能与跨平台验收。当前未开放产品候选后端。

原生 GPU 仍必须由主线程串行持有 lease；运行时冻结非测试研究源码。
本轮提交只含代码、测试和文档，`.local` 中人物、模型、包、调试日志与图像不推送。
