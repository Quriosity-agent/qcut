# 智能美体原生跳时与 RESET_PARAMS（2026-10-19）

> 本文保留原生跳时／RESET_PARAMS 阶段的规则与验收证据。后续[尺寸变化、默认多人选择与显式宽肩蒙版](independent-body-multi-mask-2026-10-19.zh-CN.md)已在同一 Python 会话中支持经验证的尺寸变化，并将检查点升级为 v5；本文的固定尺寸限制、v4 及相应待办仅描述当时状态。后续蒙版结论限于显式 WidenShoulder 输入，不代表自动分割或所有部位均有保护蒙版。

本轮还原固定原生效果包的**运行中 IMAGE 重置**。输入时间正跳、倒退和 `reset_params` 都沿原生时间门控进入该路径；不会重建会话、身体跟踪器或人脸跟踪器。验收范围仍为单人、正向画幅、固定 CPU 感知、空保护遮罩。1080×1920 的 48 帧原图独立推理结果与原生完整效果图逐字节一致，序列实际触发 13 次重置。

## 已还原的规则

原效果脚本保存 `currTime`，初始为 -1。每次更新计算双精度 `abs(time - currTime)`，没有额外 epsilon：

| 实际绝对时间差 | 原生输入类型 | 行为 |
| --- | --- | --- |
| 大于 0.1 秒 | 1 / IMAGE | 完整重置指定字段，再更新描述符、强度与网格 |
| 大于 0.01 且不大于 0.1 秒 | 0 / VIDEO | 使用视频平滑规则 |
| 不大于 0.01 秒 | 2 / NOCHANGE | 按各部位门控保留或刷新锚点 |

同一时间戳、时间倒退和名义 10 fps 的浮点误差均直接按上述比较处理。IMAGE 名称不代表创建一个新对象。原生画幅变化也触发 IMAGE；本阶段会话 API 仍要求固定画幅。该限制已由[后续尺寸变化实现](independent-body-multi-mask-2026-10-19.zh-CN.md#运行中完整重置与尺寸变化)解除：沿原生规则分别重置组合几何和身体跟踪、保留规定的人脸历史及网络实例；不是整体重建会话，也不等于任意旋转／朝向已验收。

原 `RESET_PARAMS` 对应事件 key `reset_params`。它将十项 intensityMap 归零，设置 dirty，并将 `currTime` 置为 -1；下一次更新自然进入时间门控。事件本身不调用 Bach 感知重置。多个事件按顺序执行：reset 后 set 可恢复某一项，set 后 reset 则全部归零；即使最终参数与之前相同，中间出现的 reset 仍重置效果时钟。

原生执行顺序是：hard reset → 网格与 mode 配置 → dirty item 拷贝 → 描述符 → prepare → mesh。独立实现把重置放在输入校验之后、描述符更新之前。

## 重置与保留矩阵

| 状态 | 重置 | 保留 |
| --- | --- | --- |
| Status / 骨记录 | 初始化、阻挡、交换标记与计数，关节历史哨兵 | present，随后由本帧更新 |
| Head | 选择标记、计数、有效标记和指定浮点历史 | 脸矩形、保护 ROI 及配置字段 |
| Public、Basis、HipAux、腰身、髋、胸、颈、肩描述符 | 已消费的历史值恢复各自 reset 哨兵；腿 base/endpivot 为 -1 | 原生未被当前配置消费的布局字段不作内存同一声明 |
| Arm 描述符 | 六点置 -1 | 半径 |
| 十项美体 | active / valid 清零，强度步长设为 2 | 当前强度、target、普通锚点、strategy、配置 |
| 小头、美胯、手臂位移历史 | initialized 清零 | 旧数据与 dirty 标记；下次实际调用时再决定重写 |
| 两种肩部几何缓存 | 点、可见性、flip、有效缓存清空，设 dirty | 当前强度和累计计数相位 |
| 身体／人脸感知 | 本事件不重置 | 原跟踪器及模型 |

两肩 reset 瞬间的 bounds 与后续空网格计算结果不同。Ortho 为 `(INT_MAX, INT_MAX, INT_MIN, INT_MIN)`；Widen 为 `(100000000, 100000000, -100000000, -100000000)`。原生全局计数在 warm reset 前后保持相同；独立会话内的对应计数也保留。多个独立会话之间仍不共享原生进程级计数，此项隔离范围没有改变。

不能用构造器整体覆盖 Head，也不能因 filter initialized 清零就丢掉历史数据。`native_reset.py` 分离这些字段规则，`VertexHistory` 单独保存 initialized；未执行部位的 retained-but-uninitialized 状态可以跨帧和检查点继续存在。

## 会话 API

`BodySmartSequence.process` 的 `frame` 是连续提交序号，`timestamp` 是源时间。源时间允许同值、前跳或倒退；遗漏处理帧仍需从检查点重放，不能用源时间跳转替代处理历史。

```python
result, receipt = session.process(
    rgba=rgba,
    controls=current_controls,
    stream='clip-1',
    frame=next_submitted_frame,
    timestamp=source_time,
    control_events=[
        {'type': 'reset_params'},
        {'type': 'set_control', 'name': 'SmallHead', 'value': 75},
    ],
)
current_controls = receipt['controls']
```

控制值为已有公开百分比单位。每帧先使用显式 `controls` 基线，再按顺序执行事件；调用方应保存 receipt 中的有效值作为下一帧基线，不能 reset 后继续传旧基线而期待它保持归零。同值 set 仍触发原生 dirty 规则。事件列表、字段、名称与数值在推理或状态变更前完整校验；不接受未知事件。原生 Lua 对未知 key 的忽略属于 oracle 测试范围，没有扩展为公开 API。

本阶段检查点升级到 **v4**，保存效果时钟、待处理重置与 filter initialized，拒绝旧 v2/v3。当前已随[后续尺寸／蒙版状态](independent-body-multi-mask-2026-10-19.zh-CN.md)升级为 **v5**，旧版本在修改会话前拒绝并要求重放，不猜测缺少的历史字段。取消或 GPU 失败仍将半帧会话标记 invalid，禁止直接重试与保存快照；恢复使用最后完整检查点重放。该故障策略与原生图像重置算法分开处理。

## 对比证据

所有私有证据在本机 `.local/body-native-reset-20261019/`。原图自行经过独立身体／人脸推理；候选没有读取原生捕获作为输入，也没有覆盖生产几何行为。

| 对照 | 结果 |
| --- | --- |
| 完整原效果图 48 帧 | 最终 RGBA、底座、UV、网格位置、感知与已消费状态全部一致，最大像素／网格差为 0 |
| 逐部位与肩缓存 | 480/480 累计部位网格、96/96 肩缓存逐字节一致 |
| 三项位移历史 | 144/144 数值一致；密集／稀疏表示的部分 `-0`/`+0` 字节不同，不影响后续网格及最终 RGBA |
| 合成原生 oracle 240 帧 | 六组各 40 帧，最终网格、部位状态、肩缓存、Status 骨记录、Head 已审计完整区间、Arm 半径、计数全部一致；720 个 filter 初始化／dirty／数值检查一致 |
| 原图重置门控 | 48/48 模式符合双精度时间与事件计算，13 次真实 IMAGE reset |
| 原生感知独立性 | 同原图的单调时间参考运行与跳时／reset 运行，48/48 身体／脸结果及跟踪模式、迭代一致 |
| 观察 hook 透明度 | 增加 reset 观察前后 50 passes、1,766 个已有输出／状态文件逐字节一致 |

48 帧含正跳、倒退、同时间戳、缺体、回归、reset→set 与 set→reset。它由固定人像、黑帧及平移回归构成，不能称为自然遮挡长视频。真实 API 的 algorithm/process 时间都使用实际测试时间。宿主初始化有两次 time0 预热及一次初始 CPU／tracker 设置；之后未注入额外几何重置，第一个测量帧 timestamp1 按原生门控进入 IMAGE。该初始化条件与上轮受控 cold-reset 证据分开记录。

六组 240 帧覆盖运动跳时、缺体跳时、事件顺序、缺体 reset、仅脸 reset 和名义 10 fps。原始虚表 reset 与全宿主 reset 前后快照用于验证字段写入范围与保留项；原生稀疏 map 的分配地址、容量、桶顺序不作为独立实现的承诺。

回归结果：全量 Python **859 项通过、0 跳过**；最终事件／取消／恢复相关测试 **45 项通过、0 跳过**；桌面会话／worker **93 项通过**；打包 **56 项通过**。stage、资源摘要、provenance、Biome 与 diff-check 均通过。源清单为 444 项，摘要 `82fd489ce4ff465fabf5cf885b1ddc654c288925f1ddaeeecf5b31c70b3bacfa`；363 项私有资源、72,827,136 字节及其清单行与基线逐字节相同。

冻结后的 `production48-final` 再次通过全部 48 帧对拍；426 个 Python／Swift／Metal 文件运行前后摘要一致，集合摘要为 `66b3847b4c05b21df47eb4571058fbb5f7f39b42f4c305f005c97788023e8ab2`。最终报告使用这次重跑，早期 r1 留作过程记录。

本机对比入口：`probe-audit/gallery/index.html` 和 `gallery/contact-sheet.png` 展示原图／原生／自研／原生与自研差分／原图与效果差分。`probe-audit/final-acceptance.json` 保存逐项验收与源码摘要；`native-trace/production-profile/aggregate.json` 保存 240 帧合成结果；`native-trace/fullgraph-reset-matrix.json` 保存 13 次实际 reset 的 429 项字段检查。测试与打包日志位于 `integration/`。

原生库 SHA-256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。原生观察脚本、反编译、模型、图片与二进制均留在本地忽略目录；仓库仅包含自有实现、测试、摘要及本文。

## 范围边界

本轮关闭的是**引擎运行中的原生 reset 分支**。当时未覆盖的变化画幅、默认多人体候选选择、受控交叉遮挡和显式宽肩蒙版，已由[后续原生对照](independent-body-multi-mask-2026-10-19.zh-CN.md)补充；范围仍为固定原包的正向画幅、modern CPU、默认单身体目标及明确供应的 WidenShoulder 蒙版。

完整编辑器的 RESET_PARAMS 事件传输、剪辑切点语义、不同人物的外观重识别、旋转／非零朝向、自动分割及其他部位保护蒙版、CoreML 与其他平台仍需分别验收。此次及后续引擎回归不能替代完整预览／导出 E2E，也不构成长视频内存、音画同步或实时吞吐量结论。

独立实现仍使用从原版提取／转换的私有模型权重，完全不依赖剪映来源文件的最终目标尚未完成。本轮未新增或上传模型。
