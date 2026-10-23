# 美体视频：原生调度、常驻 CoreML 与可重复恢复

本轮将 `swing-coreml-v1` 接入独立 Python 视频引擎和 resident worker。它遵循当前固定版本原生的逐检测器 readiness、冷启动补一次 refine、同一源帧两次 graph update，以及两次更新之间生效的参数规则。默认编辑器仍使用已有 `bef-cpu-warm-v1`；新路径是显式选择的 macOS 引擎能力，尚未接入 Electron/UI 参数入口。

## 结果与边界

- 1080×1920，4 帧、3 张独立原图，`SlimBody=40`、`StretchLeg=30`。
- 三条**实际后端序列匹配**的对照：全 CoreML、5 次 CPU 后 4 次 CoreML、1 次 CPU 后 8 次 CoreML。每条均为 4/4 最终 RGBA 完全一致，MAE=0、最大差=0。
- 原生对照通过明确标注的回调/检测线程等待形成对应调度，没有伪造模型 ready 标志。它们证明给定实际调度时的完整渲染一致，**不证明两套程序的异步加载耗时相同**。
- 最终自然运行选择 1 CPU + 8 CoreML；与不干预的原生 2 CPU + 7 CoreML 比，RGBA MAE 为 0.7395–0.7716、最大差 58–66。该残差保留在报告里，不能隐藏或宣称默认原生已逐像素一致。
- 自研完整重播 4/4、检查点恢复后续 2/2 均逐像素一致。冷首帧约 2.85 秒，后续约 297–317 ms/帧；这不是实时播放性能验收。
- 真正 SIGKILL 已激活的 refine 子进程：失败帧不前进、不改走 CPU；新会话从自己的检查点/执行日志恢复后输出一致。请求已发出后的真实取消也退出并回收 helper，恢复帧逐像素一致。验证涉及的 10 个 helper 均已退出。

上述证据不是多人真实视频、长视频、全部美体控件或跨平台验收。原模型权重仍是外部私有依赖；执行只加载自有 helper 与 Apple 系统 CoreML，不加载剪映 dylib。未上传模型、图片、张量、编译产物或日志。

## 实现

`BodyCoreMLNetwork` 对 coarse/refine 各持有一个常驻子进程，模型/源码先验证再启动，完整帧处理开始时异步加载。每次检测在裁切前读取对应 loader 的实际状态；已激活 CoreML 后不允许回退 CPU。真实初始化失败保留 CPU；完整性损坏和运行故障直接报错。

粗检测有四个原生输入尺寸；短长边比例用 Float32 与 0.68 比较。letterbox 两端分别截断，不能用整数居中替代。补边是 byte 128，其归一化值约为 0.007843256；float 输出保持物理值，不量化回 int16。六种比例、十六次 ready coarse 输入已与原生逐字节核对。

执行日志只记录本引擎完成帧的后端选择、输入/参数/时间戳摘要。恢复/导出重用自己的历史：记录为 CPU 的调用仍用 CPU，记录为 CoreML 的调用等待 CoreML 就绪。未完成或取消的帧不提交日志。不得把原生参考张量、姿态或参考调度注入产品运行。

检查点 v6 绑定显式 generation、源代码闭包、固定模型、helper、系统与后端配置；旧 v5 继续服务 warm CPU。跨 profile、源码、模型、generation 或执行前缀的恢复在修改状态前拒绝。ONNX 动态 LRU 收据不属于不可变身份，已从身份中排除；固定图和权重指纹仍保留。初始化采用完整构造后发布，避免脸模型加载失败留下半个可复用会话。

## 使用与验证

外部 `QCUT_BODY_COREML_MODEL_ROOT` 必须指向经 `body_coreml_assets.extract_models` 验证并解包的 `coarse.mlmodelc`、`refine.mlmodelc`。解包源由调用者显式提供；不自动读取剪映安装目录。1080p 使用 `BEAUTY_RENDER_RESOLUTION=original`。

```python
session = BodySmartSequence(
    runtime=external_runtime,
    execution_profile="swing-coreml-v1",
    execution_generation="caller-owned-render-generation",
)
```

resident worker 的 sequence 请求可显式携带 `executionProfile`、`executionGeneration`。调参/源尺寸或编辑语义变化由调用方提供新 generation，并使用独立的 session/checkpoint 目录。完整 UI 缓存键与持久化入口还需接入后再做编辑器 E2E；此处不冒充已完成。

本地完整回归、包装与源校验保留在验证收据中；新增公开 CI 只使用合成输入和模拟 helper，覆盖调度、两次更新、取消、失败、日志/检查点恢复，不下载私有模型。冻结照片引擎的两份 manifest 保持原样，219 文件照片 staging 通过。独立引擎完整 staging 为 487 个固定源码文件加 manifest。

更多原生地址、模型指纹、调度干预说明和可复现命令见 [原生调度研究](../../research/jianying-runtime-probe/body_backend_schedule.md)。私有证据根目录：

- `.local/body-backend-schedule-20261023/`：原生 schedule、coarse、lifecycle 与三份独立像素审计。
- `.local/body-default-profile-20261023/swing-render-r4/`：最终自然运行、重播、恢复与原生默认残差。
- `.local/body-default-profile-20261023/resident-coreml-crash-r2/`：真实崩溃、取消、恢复。

下一步优先接入显式编辑器 profile 与持久化 generation，测同一项目的预览/导出/调参/跳播，再扩大到连续真实视频、多人交叉和遮挡。当前四帧条件对齐不能代替这些验收。
