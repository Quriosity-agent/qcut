# 独立照片美体同步到 QCut 实验室

## 范围与来源

此前 QCut 实验室保留十项智能美体和视频跨帧处理，但没有独立版后来增加的
CPU 照片编辑器。本次同步独立版 PR #17–#21，源码基准为
`donghaozhang/qcut-beauty-standalone@0c790e219f857baaa19ea77e8cc6be4a8db6ab97`。
#20 包含照片功能扩展；#21 增加交付包跨平台测试，没有新增渲染算法。

实验室新增“独立照片美体（CPU）”入口，打开 QCut 自己管理的独立窗口，复用完整的
上游照片 UI 和 HTTP 接口。现有时间线、原生美体、状态跟踪、跳播重置和视频导出
继续使用原有引擎。照片参数不写入视频参数结构。

同步的照片能力：

- 21 项身体参数，包括大腿、小腿、腹部、提臀、臀形、腿直、脚踝和四项身体皮肤调节。
- 局部拖拽、背景保护、锁脚及裁腿拒绝规则。
- 自动臀部轮廓估计、手动轮廓修正及明确的不可用状态。
- 原图半边／闪烁对比、失效结果清理、原尺寸 PNG 下载和绑定输入输出哈希的回执。
- ONNX CPU 推理和自有栅格渲染，不加载剪映原生动态库。

完整列表和上游算法边界见 `research/body-photo/body/README.md`。

## 引擎与资源隔离

照片引擎冻结在 `7bd5ceacc996b924c25563f430651dd1046d6ce0` 的 107 个源文件。
其中 105 个文件与当前 QCut 研究代码完全相同，构建时按哈希复用；
`alignment_decode.py` 与 `independent_pipeline.py` 使用两个冻结版本。
没有回退或覆盖当前视频引擎的新实现。

`research/body-photo/source-manifest.json` 记录每个导入文件和所有适配。
适配仅涉及外部运行目录、CPU 选择、进程所有权及离线校验；几何、感知、蒙版、肤色、
控制范围和上游网页保留原始内容。`stage-body-photo` 组装完整的冻结源树。

应用仅打包经过哈希校验的文本源码。31 个模型／常量文件、Python 环境、照片、回执、
原生库和交付 ZIP 均不进入 Git 或应用资源。启动时对本地模型、源码和依赖版本再校验，
校验通过只代表可以运行，实际效果由渲染测试证明。

在实验室选择已安装的本地 V3 资源目录，其中包含 `runtime/body`、
`runtime/body-portable` 和 `body/.venv`。选择成功后仅将目录配置存入用户数据。
开发测试可使用 `QCUT_BODY_PHOTO_RUNTIME`，另可指定 `QCUT_BODY_PHOTO_PYTHON`。
清除这两个覆盖后，可重新从界面选择目录。

## 生命周期与窗口

- 主进程只接受主窗口主 frame 发来的无参数 IPC；网页不提供执行路径或目标 URL。
- 照片窗口启用 sandbox、context isolation，无 Node 和 preload。
- 窗口仅允许自己的 loopback origin，拒绝外部网络、导航、子 frame 和弹窗。
- 上游 CSP、Host／Origin 检查及随机实例标识继续生效。
- 单实例打开，关闭或崩溃后清理自己的 host、渲染进程及临时目录。
- 渲染进程监视 host；host 突然退出时关闭自己的渲染进程组。
- 构建可重复执行，只替换拥有完整生成回执和文件哈希的旧 staging；拒绝覆盖未知目录。

## 验证

2026-10-23 本地 macOS 实测：

- 同一批四张私有样本的 21 个实际滑杆、29 个边界值与七个工作流，共 36 次浏览器渲染。
- 追加背面提臀、正面提臀拒绝、裁腿拉长拒绝、六项复合调节及背景保护，共四例。
- 40 例移植前后 PNG 字节完全相同，解码 RGBA 完全相同，最大通道差为零。
- 两边分别运行独立像素检查，核对回执、尺寸、透明度、保护区域与预览／下载一致性。
- 本地原有 31 个模型／常量文件仅被读取，并核对运行前后内容身份。

完整编辑器入口、实际 PNG 下载、处理中关闭、崩溃重开由
`apps/web/src/test/e2e/beauty-lab-body-photo.e2e.ts` 验证。
实际 Electron E2E 已通过：下载 PNG 与独立版基准哈希相同，处理中关闭后服务退出；
再次打开、renderer 崩溃后重开及零参数输出通过，时间线内容保持不变。
相关 Vitest 回归共 1,985 项通过；13 个 TypeScript 项目通过；
编译后的打包 hook 可重复运行，真实 electron-builder 资源复制后的 219 个文本文件
通过完整源码校验，包含必需的隐藏清单文件。
私有样本通过 `QCUT_BODY_PHOTO_TEST_FIXTURE` 指定，测试输出目录通过
`QCUT_BODY_PHOTO_TEST_OUTPUT` 指定；没有资源时，该 E2E 明确跳过。

可运行的源码检查：

```sh
bun run check-types
bun run check-provenance
bun run stage-body-photo
bunx vitest run electron/__tests__/body-photo-*.test.ts scripts/__tests__/body-photo-packaging.test.ts apps/web/src/lib/portrait/__tests__/use-body-photo-lab.test.tsx
"$QCUT_BODY_PHOTO_PYTHON" -B -m unittest discover -s research/body-photo/body/tests
bun test ./research/body-photo/body/tests
```

Python 单元测试命令需要先将 `QCUT_BODY_PHOTO_PYTHON` 指向已安装依赖的 V3 Python。

上游已有 Windows／Linux 交付包证据；本次 QCut 窗口的真实运行验收仅在 macOS，
不能把上游交付包测试当成 QCut 三平台安装包验收。

## 保留的边界

本次同步的是单人、站立、非透明照片编辑能力。自动臀部轮廓是穿衣照片的二维估计，
支持范围有限；拒绝时需要手动轮廓，不能当成语义分割或三维理解。
照片新增参数尚未进入时间线，也未获得视频跨帧、多人或任意姿态的验收。
此次像素一致性比较对象是独立版 V3，不能据此宣称新增参数与剪映原生等价。
