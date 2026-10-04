# beauty-6-kpop：原生美妆消费闭环与真实口红差分

日期：2026-10-05。分支：`beauty-6-kpop`。
工作目录：`/Users/peter/Desktop/code/qcut/qcut`。
本轮起点：`1a19ef6bf5c80a4f5b69c2e7aa697b8b3740801c`。
前置记录：[主 106 点读取证据](beauty-kpop6-makeup-xy-proof-2026-10-05.zh-CN.md)。

## 结论与边界

**本轮完成了研究宿主中“当次 ONNX 候选主点 → 原生美妆几何处理 → 最终 RGBA”的有审计闭环。**
此前只有 106 个 XY 被读取的证据，宿主仍因缺消费收据而拒绝生成最终图；现在三张不同人物素材
都通过当次会话、逐点读取、转换、原生处理函数返回、GPU 完成和恢复检查，并产出可比较图片。

**口红效果尚未对齐。** 三张图都在嘴唇区域存在实际差异，零容差验收继续失败。
新增消费证据不是产品通过、全链独立、额外关键点通过或全部美妆通过。
产品候选后端仍禁用，没有修改 Electron UI、产品预览或导出实现。

本轮对照是 **QCut 研究宿主调用固定剪映原生库的 baseline** 与 **ONNX 主点混合宿主**，
不是新做的剪映 GUI 导出对照，也不是两个已上线的 QCut 产品后端。

## 原生消费者怎么接通

固定 `libcccreator.dylib`：

- UUID：`D6342ECD-5432-33F0-A2AD-0C28F5699994`。
- SHA256：`0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`。
- `FaceMakeupSystemV2 + 0xd0` 在本轮样本内有 10 个 geometry 对象。
- 原 vtable 偏移 `0x35eac48`，虚函数槽 `+0x10` 指向 `0xa0bb54`。
- 分派调用点 `0x9eba48`，返回点 `0x9eba4c`；最终预测只有槽 0 实际消费 primary。
- 参数 ABI 保留 object、primary 引用、extra 引用、auxiliary 引用、width、height。
  primary/extra 引用分别为 object+8/object+16；auxiliary 引用本身必须非空，引用内指针允许空。

只在显式 `--consume-makeup-candidate` 研究模式、最终预测 1 安装实例级影子 vtable。
复制两项 metadata 加 30 个函数槽，仅替换 process 槽；其他对象行为不改。
调用原函数前后核对 graph、预测、时间、线程、面部 ID、输入存储与快照；原函数只调用一次。
返回后恢复影子表。某个表无法恢复时继续恢复其他对象，不覆盖第三方替换的表，整体仍失败。

直接 XY 读取仍由独立只读硬件观察器验证。新增处理函数回调核对完整目标数组：

```text
x_pixel = float32(x_normalized * width)
y_pixel = float32(height - float32(y_normalized * height))
```

逐次 float32 舍入必须一致，不能把 Y 乘减融合为 FMA。
源点指针和全部位模式必须匹配发布前不可变快照，以及 worker 当前结果；不能拿已被修改的
clone 作为新的“原始候选”来通过检查。目标点数组不能与源/clone 点数组别名或重叠。

## 收据和验收分层

冷启动先完成 prediction 0 的发布、回滚、初始化结束与参数应用，初始化输出继续抑制。
prediction 1 才允许下列顺序：

```text
fresh candidate received → isolated clone publication
  → 106 source XY loads
  → geometry enter + exact source/destination bits
  → original geometry function returned + source unchanged
  → makeup conversion receipt → update exit
  → GPU complete + original restored → final stage complete
  → final RGBA comparison
```

`face_live_makeup_render_audit.py` 不伪造旧 rollback 收据，也不把新记录改写为旧记录。
它验证两次独立发布、一次完整 106 点加载、处理函数上下文、恢复和阶段顺序。
`renderer_consumption: true` 在这个 schema 中仅指已关联的原生 CPU geometry 消费收据；
`product_parity_verified`、`extra_points_verified`、`pipeline_acceptance` 都仍为 false。

推理会话/ONNX head hash 检查复用拆出的 `inference()`，不是 head 数值对原生相等的证明。
clone 深拷贝检查以两次 publication 关联，不能冒充两次 conversion。
图像比较默认仍要求完全相等；新模式先保存差异指标，再执行相同的零容差门槛。
消费审计通过而图像不同的报告保持 `passed=false`、`completed=false`、
`live_checks_completed=false`。进程清理成功单独记录，不与通过验收混淆。

## 本机真实结果

所有目录位于 `.local/jianying-model-pytorch/`，本轮稳定源码后的四轮均使用新进程、会话和输出目录，
无重复暖机。每轮 `cleanup.completed=true`、`dependencies_unchanged=true`。

| 运行目录后缀 | 素材/效果 | 原生对原图变化像素 | 候选对原生变化像素 | 最大通道差 | 结论 |
| --- | --- | ---: | ---: | ---: | --- |
| `beauty-kpop6-lip-consumer-20261005-r4` | 微笑正脸，柔和粉口红 +80，640x640 | 4096 | 3970 | 31 | 消费审计通过，图像失败 |
| `beauty-kpop6-kpop-lip-consumer-20261005-r6` | K-pop 正脸，同口红，1448x1086 | 12331 | 10776 | 23 | 消费审计通过，图像失败 |
| `beauty-kpop6-mature-lip-consumer-20261005-r7` | 户外人像，同口红，1448x1086 | 8213 | 7420 | 34 | 消费审计通过，图像失败 |
| `beauty-kpop6-eye-consumer-regression-20261005-r5` | 微笑正脸，大眼 +40，640x640 | 4760 | 0 | 0 | 既有冷启动链回归通过 |

户外素材沿用 `outdoor-male--02/manifest.json`，其图片路径历史命名含 `mature-eye`；
这里只据实际图像称户外人像，不将目录名当作年龄/身份标签。
三次口红都有 2 个新 worker prediction、2 个隔离 clone、最终 1 次 conversion/恢复、106 次加载。
大眼仍为 2 次 conversion/恢复，输出 SHA 与上一轮相同：
`c76dbca3b0ef4a3aa0fa9eefaef1ad7695723cd545eee1133034afbadfa40ac8`。

微笑口红 r4：

- baseline RGBA SHA256：`37c5fb55392d446227290fdfa837c9ad6a8e95d8bfc54b6ce3fe5b6a8bae0a77`。
- candidate RGBA SHA256：`9ebd7fac700abb18776dbebdb372d73b1f1c92c7fce417226c8d7886d2ede27e`。
- 差异包围框 `[260,191,360,259]`；Alpha 无差异。
- 与早期 r3 图像 hash 相同，但 r3 因旧审计拒绝新收据而失败；本轮主证据使用完整审计的 r4。

探索期 r1 只用于确认 geometry 清单，未产出候选最终图；r2 将 auxiliary 的空 pointee
错误地当作非法参数，已修正，仍保留原失败记录。不能将这些失败算成通过样本。

## 对比图与定位

报告：`.local/jianying-model-pytorch/beauty-kpop6-consumer-comparison-20261005-r1/index.html`。
输入清单：`.local/jianying-model-pytorch/beauty-kpop6-consumer-matrix-20261005.json`。
24 张 PNG 包含每例的原图、原生结果、候选结果，以及三种两两灰度差分。
公式统一为 `min(255, 8 * max(abs(RGB delta)))`，不逐图归一化；Alpha 指标单列。
报告 hash 核对所有 RGBA，保留原始审计状态，得到 `DIFFERENT=3, EXACT=1`，没有素材校验错误。

已目视查看 K-pop 两条结果图及三张口红差分，变化集中在唇缘与唇内，未见全图偏移。
嘴唇以外差分黑色不能用于推断其它美妆功能通过。

微笑 r4 的 worker prediction 1 主点，与同一次 live 宿主 `algorithm_update.faces_before`
记录的原生分析结果比较（归一化坐标按 640 缩放）：

- 106 点最大单坐标差约 **6.2292 px**，位于点 37。
- 平均二维距离约 **2.7046 px**。
- 嘴部索引 `[84,104)` 最大单坐标差约 **4.5231 px**。

这证明消费前已经存在主点差异；不是拿 baseline 日志中不存在的点冒充对照。
已验证的 normalized-to-pixel 转换没有引入额外位差，但尚未证明主点差异是最终图差异的唯一原因。
`CandidateCore` 的 Extra primary106 平滑调度已实现，Extra Stage2 几何仍明确未验收。
当前资料不足以区分网络 head、初始化/crop、Stage2 或状态推进的贡献；不能直接称 ONNX 精度问题。

## 测试

- 11 个 Python 套件：**180 项通过，无跳过**，覆盖新收据、逐位算术、旧路径回归和差分报告。
- geometry C++：严格乘减和允许收缩两种编译设置，各 **11055 项检查**通过，ASan/UBSan 无诊断。
- consumer C++：直接包含真实生产 header，**70 场景、2675 检查**通过，ASan/UBSan 无诊断。
- render-stage C++：2 个合法流程、204 个拒绝场景及失败后重试通过。
- lifecycle C++：17 项通过；scene inventory 的边界、布局、身份、去重测试通过。
- 稳定源码后的真实宿主运行：3 例口红消费审计通过但图像失败；1 例大眼完整回归通过。

没有执行产品全量 CI、Electron UI E2E、剪映 GUI 导出、分钟级、多脸或 Windows/x86 验收。

```bash
cd /Users/peter/Desktop/code/qcut/qcut/research/local-model-pytorch
../../.local/jianying-model-pytorch/face-heads-runtime122/bin/python -B -m unittest \
  face_live_makeup_conversion_math_test face_live_makeup_render_audit_test \
  face_live_makeup_point_trace_test face_live_makeup_point_audit_test \
  face_live_bridge_probe_test face_live_bridge_audit_test face_live_reader_trace_test \
  face_live_bridge_lldb_test face_owned_result_probe_test face_live_bridge_process_test \
  beauty_dual_matrix_report_test
```

原生复跑使用对应 `report.json.command`，必须换新输出目录/cache prefix，串行运行并冻结研究源码。
新消费模式需要 `--single-frame --cold-frame --stable-host --trace-makeup-system
--publish-makeup-candidate --stage-makeup-render --trace-makeup-points --consume-makeup-candidate
--execute-native --lease <owner>`；不得同时打开 getter 硬件观察。
复用 runtime/模型/包路径；模型、二进制、原图、raw 日志和会话数据不提交 Git。

## 下一步

1. 优先在同一次冷启动上按阶段捕获主点：160 seed、120 decoded/mapped、Extra 平滑前后、
   Stage2 前后、最后归一化。绑定当次 call、预测、face ID 和参数，定位首次分歧。
2. 先证明采样 tensor/head 是否逐值一致，不能把 hash 收据的存在当成相等。
   只修复首个分歧的调度/算术/几何，再重跑三张口红和大眼；不手调唇点掩盖上游误差。
3. 受控唇点扰动作为单独因果实验，清楚标为人为输入，不能混入正常候选验收。
4. 单图口红对齐后再扩强度、眉妆、眼妆、其它人物、真实视频和多脸；随后接产品预览/导出。

仍需原生提供 full-frame 输入、检测/接纳、几何与重置信号、extra/iris/fitting/masks、效果包和 renderer。
本轮缩小了“候选点到有效美妆结果的工程链路与验证缺口”，未消除口红数值差异或原生依赖。
