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
适配涉及外部运行目录、CPU 选择、进程所有权、离线校验及限定文档支持的图片解码格式；几何、感知、蒙版、肤色、
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

同日补充生命周期验收：六个先失败后通过的回归覆盖等待旧 host 清理时取消、
创建状态目录期间取消、主窗口在启动中或运行中关闭，以及已释放／被替换 IPC
控制器返回旧目录选择结果。相关 Electron 测试 45 项通过，入口测试 10 项通过。
最终编译后的真实 Electron E2E 再次通过：从尚未配置资源开始，取消选择后选择
有效目录，渲染处理中修改参数不会显示迟到旧结果；按钮关闭／重开和崩溃后重开
成功。实际下载 PNG 仍与独立版基准逐字节相同。
E2E 可用 `QCUT_BODY_PHOTO_TEST_RUNTIME` 指定测试资源，避免依赖产品环境覆盖。

评审后再次验收：完整 staged Python 测试 522 项通过（9 项显式跳过），
服务／窗口／进程相关 Electron 测试 54 项通过，重新编译后的真实 E2E 通过。
状态查询在 30 秒内复用同一运行时的成功结果并合并并发查询；每次实际打开仍完整
校验 Python、模型和源码。缓存随选择变化、失败、异常退出或解释器身份变化失效。
初次挂载／切回流程的 Python 校验启动次数从 4 次降为 1 次。
图片解码限定为文档承诺的 PNG、JPEG 和 WebP。

可运行的源码检查：

```sh
bun run check-types
bun run check-provenance
bun run stage-body-photo
bunx vitest run electron/__tests__/body-photo-*.test.ts scripts/__tests__/body-photo-packaging.test.ts apps/web/src/lib/portrait/__tests__/use-body-photo-lab.test.tsx
(cd build/body-photo && "$QCUT_BODY_PHOTO_PYTHON" -B -m unittest discover -s body/tests)
bun test ./research/body-photo/body/tests
```

Python 单元测试命令需要先将 `QCUT_BODY_PHOTO_PYTHON` 指向已安装依赖的 V3 Python，
并运行前面的 `bun run stage-body-photo`。完整测试从组装后的 `build/body-photo` 运行，
使用通过哈希校验的 107 个冻结引擎文件；直接从 `research/body-photo` 运行会缺少
`body/engine/research`，导致网格、真实导入和源码回执测试失败。

上游已有 Windows／Linux 交付包证据；本次 QCut 窗口的真实运行验收仅在 macOS，
不能把上游交付包测试当成 QCut 三平台安装包验收。

## 保留的边界

本次同步的是单人、站立、非透明照片编辑能力。自动臀部轮廓是穿衣照片的二维估计，
支持范围有限；拒绝时需要手动轮廓，不能当成语义分割或三维理解。
照片新增参数尚未进入时间线，也未获得视频跨帧、多人或任意姿态的验收。
此次像素一致性比较对象是独立版 V3，不能据此宣称新增参数与剪映原生等价。

原生默认路径的后续研究独立记录在
`research/jianying-runtime-probe/BODY_DEFAULT_PROFILE_20261023.md`：
已经独立复现本次 CPU 冷启动调用，并执行同包中的真实浮点图。
这些探针没有改变生产后端；单次张量或关节点结果不能替代完整视频像素验收。
