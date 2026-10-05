# QCut 两条美颜链：多人物、脸型、美妆与固定增益差分

日期：2026-10-04。分支：`codex/beauty-live-hybrid-v7`。
PR：[484](https://github.com/Quriosity-agent/qcut/pull/484)。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。

> 2026-10-05 后续实测见[消费路由与完整美妆覆盖](beauty-kpop6-consumer-routing-2026-10-05.zh-CN.md)：
> 美妆已逐项补跑，下颌线三图已通过，24 帧视频在显式 LLVM 调试器下两次通过。
> 本文保留 10 月 4 日的失败快照，不代表当前全部仍失败；三维高光/雀斑、稳定性和产品化仍需验收。

## 比较对象与边界

- 原生链：当前原图、当前产品参数、新启动的 QCut 原生宿主。
- ONNX 混合链：同一原图/参数、另一新宿主、真实回调产生的输入、QCut 采样/ONNX/解码/时序处理，再交回原生效果渲染。
- 第二条链仍依赖原生检测、全帧预处理、裁剪几何、身份/重置判断、附加关键点/遮罩与渲染。不是完全独立 ONNX 美颜。
- 本报告是静态、单脸、单效果包控制组，不证明分钟视频、动态多脸、跨平台或组合效果已经验收。
- 本轮没有重新操作剪映 GUI。原生宿主对比不冒充剪映导出对比；历史剪映配对图仍单独保留。

每项导出六张图：原图、原生、ONNX 混合链、原生减原图、混合链减原图、原生减混合链。
灰度统一为 `min(255, 8 * max(abs(RGB difference)))`，不按每张图自动拉伸。
Alpha 单独计数，避免透明度错误被黑色 RGB 差分掩盖。
只有文件/哈希/回调审计通过、两链 RGBA 完全一致、并满足预期效果变化，才能列为 EXACT。
缺图、审计失败、两边都没生效与真正一致分别标记。

## 覆盖目录

`beauty_dual_matrix_catalog.ts` 从实际产品目录和参数构造器生成，不另写滑杆映射。
本轮输入包含 83 项：脸型 13、眼睛 7、鼻子 7、嘴部 6、眉毛 7、皮肤/肤色 15、美妆 28。
本轮使用正向 80，产品上限不足 80 时钳制到该控件上限；不包含所有负值和中间强度。
默认生成器另外支持多强度、负向控件和旧美妆卡，但不能把“目录存在”算成已实测。

三张原图：

| 人物 | 尺寸 | 本地来源 |
| --- | --- | --- |
| front-smile | 640 x 640 | `output/beauty-kpop-v3-20260930/face-controls/sources/front-smile-original.jpg` |
| kpop-front | 1448 x 1086 | `output/beauty-kpop-v6-20261002/source/kpop-front-original.png` |
| outdoor-male | 1448 x 1086 | `.local/jianying-model-pytorch/face-live-validation-mature-eye-20261004-r1/campaign-00/probe/input-00.png` |

人物是三种不同素材，不代表所有人种、年龄、姿态和遮挡条件。
原图不预缩放成同一大小；每组独立记录原图哈希和原始尺寸。

## 修复前实测

初次脸型批次在第一张人物上完成 10 项，8 项 EXACT、2 项缺失。
8 项：流畅脸、瘦脸、窄脸、下颌骨、颧骨、短脸、V 脸、下巴长短。
失败项与后续美妆探针暴露两个独立问题：

1. 小脸、氧气妆：原生基线有效，但候选宿主出现 `live clone overwritten before GPU completion` 等转换生命周期错误。
2. 下颌线、动态口红：原生实际走 `base_output_mode_bit=true`，旧候选仅接受普通 Base 分支，主动拒绝。

诊断单口红在 kpop-front 明确记录：仅 `base_output_mode_bit` 不同，其余路由位均匹配。
另一次 front-smile 发生 worker 帧截断，原报错随后被 BrokenPipe 覆盖；不能把它解释为模型精度误差。
worker 已改为先保留原始错误收据，再尝试通知断开的调用者。

修复前报告：
`output/beauty-dual-matrix-20261004/initial-face-failures/index.html`。
截图：`output/playwright/beauty-dual-before-fixes.png`。
失败审计保持原样；清理不确定的批次中止后续 GPU 启动。确认所有记录进程已退出后，
仅归档残留 lease 标记，没有修改失败结果、系统权限或绕过正在运行的宿主锁。

## 当前已验证结果

`output/beauty-dual-matrix-20261004/face-fine-current/index.html`：
三张人物各 25 项，共 **75 项 EXACT，450 张 PNG**。

- 脸型/基础五官包 11 项：瘦脸、窄脸、下颌骨、颧骨、短脸、V 脸、下巴长短、大眼、眼距、瘦鼻、嘴巴大小。
- 精修包 14 项：下庭、中庭、上庭、开眼角、眼睛大小/宽度、鼻子大小/位置、嘴巴大小/宽度、眉毛位置/距离/倾斜/大小。
- 每项原图与效果图确有 RGB 变化，原生与候选 RGBA 差异为 0。
- 两链均有 6 个相同预热请求。因此这是同历史状态的研究链对比，不能替代产品首帧测试。

首批 kpop 精修宿主中断，61 项完整通过，其余未接受。独立新会话重跑该人物的 14 项后全通过。
当前汇总同时保留两个来源矩阵的路径和哈希，没有覆盖首批失败。
中断原因没有重现，不能写成已根治；新增 LLDB 停止状态/线程栈采集，避免清理进程时丢失最初错误。

截图：`output/playwright/beauty-dual-75-kpop-face.png`。
首帧修复后又用默认预热模式复测 front-smile 的 11 项基础脸型/五官：34 次内部预测、32 次接管/恢复，
11 项 RGBA 仍全部零差异，清理完成。审计为 `.local/jianying-model-pytorch/beauty-dual-warm-regression-20261004/report.json`。

## 尚未通过的分支

小脸、下颌线、柔和粉口红，在三张人物上的 9 项隔离重跑仍未取得完整候选图：
`output/beauty-dual-matrix-20261004/isolated-failure-regression/index.html`。
原图、有效原生输出和原生减原图仍展示；候选缺失明确标记，不使用原生图填充。

已修复两项前置问题，但不等于这 9 项通过：

1. 图结果的拥有期：只在真实预测/渲染作用域借用克隆，等待 GPU 完成后恢复；渲染后的检查不算消费，也不能留下替换槽位。
2. Extra 输出模式下的主 106 点：依据固定版本反汇编，使用 73→33→73 的滤波顺序，第二次 73 使用原始输入，不能把首次滤波结果再输入。其他未确认路由仍拒绝。

剩余阻断是这些效果没有经过当前已验证的 FaceAdapter 消费路径。worker 成功计算、发布指针或图片看起来相同，均不足以证明渲染器使用了候选点。
尚需原生图结果读取的真实消费证据；没有证据前保持失败关闭。

完整美妆目录已补跑：`output/beauty-dual-matrix-20261004/all-makeup-r2/index.html`。
28 张当前产品卡 × 3 张人物 = **84 组原生输出**，每组均有 RGB 变化，保存了原图、原生结果和固定增益灰度图，共 252 张 PNG。
9 个候选批次全部在真实渲染消费检查处失败，报告为 84 项 MISSING，而不是 EXACT。
同包样式串行组内一旦候选失败，后续没有独立重新启动，因此不能声称逐卡定位了 84 个独立故障。
目前能确定：原生参考已齐，候选两链美妆对比未齐；口红另外有独立冷启动 UI 失败证据。
氧气妆、口红所在组合、以及美瞳/高光/雀斑所在组合都遇到相同消费门槛。

下一步只攻此消费路径：固定一张人物和柔和粉口红，跟踪原生 type-4 FaceBuffer 的实际读取，
分开记录“发布克隆”“原生渲染器读取克隆”“GPU 完成后恢复”。检查函数主动读取不能计入第二步。
证明真实消费后先要求零差异，再扩到其他妆容、多人物和强度；当前不全局启用候选后端。
尚未在本轮完成的 30 项皮肤/高级五官控制及其多强度测试，不纳入上述 75 项通过数。

## 编辑器首帧差异

扩展真实 Electron E2E 后，瘦脸 +80 在 front-smile 上实际生成了两种输出，但差异不为零：

| 比较 | 改变像素 | RGB 最大差 | RGB MAE |
| --- | ---: | ---: | ---: |
| 产品原生 vs 旧候选 | 17,199 | 7 | 0.02821044921875 |
| 产品原生 vs 候选审计第一轮原生帧 | 0 | 0 | 0 |

原因得到逐帧验证：产品返回首次请求结果，旧候选额外预热 6 次，引入不同的时序平滑状态。
不是放大图或灰度增益导致，也没有据此放宽像素阈值。
失败 ZIP 与界面截图保留在 `output/playwright/beauty-dual-face-slim-ui-20261004-r1/`。

候选改为显式冷启动协议：0 个预热请求、2 次内部预测、2 次真实接管与恢复、无原生 bootstrap 例外。
协议单测通过后第一次 GPU 尝试发现 seek 前算法表为空，安全失败，未产生伪候选输出。
该次记录：`output/playwright/beauty-dual-face-slim-ui-20261004-r2/`。
随后改为 seek 前仅保存作用域，在预测 0 的 worker 回调中安装对象钩子，第一次真实转换前完成克隆审计。
预测 1 使用正常更新钩子。两次渲染均必须消费候选克隆并等待 GPU 完成后恢复。
初始化或检查行为不计入消费证明。

修复后的真实 Electron E2E：

| 人物/设置 | UI 输入 | 效果改变像素 | 两链差异像素 | 结果目录 |
| --- | --- | ---: | ---: | --- |
| front-smile / 瘦脸 +80 | 640 x 640 | 53,532 | 0 | `output/playwright/beauty-dual-face-slim-ui-20261004-final/` |
| kpop-front / 眼睛精修 +40 | 640 x 480 | 7,900 | 0 | `output/playwright/beauty-dual-eye-ui-20261004-final/` |

两例均检查了真实候选图、RGBA 零差异、ZIP 内原图/结果/灰度 PNG、桌面和窄屏截图、
改变参数后候选失效、实验室不修改时间线。口红 UI 重跑仍失败，错误为缺少真实渲染消费，
保留 `output/playwright/beauty-dual-lip-ui-20261004-r1/failed.png`，没有回退到原生图冒充候选。

实验室导入图片沿用现有最长边 640 的限制，故 kpop UI 对比是 640 x 480；
上方研究矩阵保留 1448 x 1086。不能把 UI 通过写成原始大图分辨率通过。

复现性修正：`-B` 只禁止写入 `.pyc`，仍可能读取旧字节码。候选启动器、worker 和 LLDB 观察器
改用独立新目录的 Python cache prefix，并禁用写入；单测构造时间戳和长度都有效的旧缓存，
确认普通 `-B` 读到旧值而隔离后的进程执行当前源码。
Electron 还独立核验 worker/消费者 JSONL 的哈希、会话/预测顺序、真实转换/恢复的 binding 和 graph，
以及完整源码、模型、运行库、效果包的预期清单。不能用两个计数或一份自称成功的报告替代消费证明。
最终构建的两例 UI 再次通过，耗时分别 34.6 秒和 38.3 秒；这是逐次审计耗时，不是实时美颜性能。

## 验证汇总

- Electron 候选、来源、进程、选择和 provider：7 个套件、816 项通过。
- Python 审计、矩阵、Extra、LLDB、worker：131 项通过；显式提供本地 ONNX 模型，本轮无跳过。
- 产品目录生成器：64 项通过。
- C++ 拥有期和冷启动：15 项 ASan/UBSan 测试通过。
- `bun run build:electron`、修改的 TypeScript 文件 Biome 检查、`git diff --check` 通过。
- 原生/候选真实 GPU 成功与失败范围见上文，不由单测数或构建成功替代。

## 重跑入口

输入在 `.local/jianying-model-pytorch/beauty-dual-matrix-20261004-inputs/`：
`catalog.json` 和 `portraits.json`。其中引用私有运行时和本机缓存，不提交 Git。

```sh
.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  -X "pycache_prefix=$NEW_OUTPUT_DIRECTORY/python-cache" \
  research/local-model-pytorch/beauty_dual_matrix.py \
  --catalog .local/jianying-model-pytorch/beauty-dual-matrix-20261004-inputs/catalog.json \
  --portraits .local/jianying-model-pytorch/beauty-dual-matrix-20261004-inputs/portraits.json \
  --runtime "$RUNTIME" \
  --models .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out "$NEW_OUTPUT_DIRECTORY" \
  --execute-native --lease beauty-dual-matrix-parent-20261004
```

效果包相同的静态参数串行测试，最多每组 24 项；每张人物每组均新建原生/混合链会话。
这不是每个美妆卡都独立冷启动。运行时、模型、来源和效果包持续验证哈希，漂移即失败。
`progress-NNN.json` 是不可变检查点；中断不能把未运行项目写为成功。

离线报告生成：

```sh
.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/beauty_dual_matrix_report.py \
  --matrix "$MATRIX_OR_PROGRESS_JSON" --out "$NEW_REPORT_DIRECTORY"
```

报告页面可按人物/类别筛选，附原审计快照和每张 PNG 的哈希。
图片、私有运行时与模型保留本地；只提交脚本、测试与本文档。

本地总览入口：`output/beauty-dual-matrix-20261004/index.html`。
该页面链接全部分报告、修复前后截图与实际编辑器 ZIP；可以离线打开，不依赖开发服务器。
