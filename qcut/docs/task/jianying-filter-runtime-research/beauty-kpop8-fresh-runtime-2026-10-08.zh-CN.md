# Beauty 8：外置资源安装与运行环境预检

本轮在 `beauty-8-packaged-ui` 推进外置运行库安装闭环。验收目标是在一个全新目录中复制完整资源、创建独立 Python 虚拟环境、执行真实计算预检，再处理原图。既有应用默认运行库和独立版源目录保持原样。本轮是同一台 macOS arm64 机器上的隔离目录验收，不能视作另一台全新 Mac 的安装证明。

## 安装与可用状态

`electron/beauty-lab-runtime-install.ts` 复用资源 profile 验证器：先验证本地源 payload，复制 358 个指定文件到新目录，再验证副本。创建 Python venv 时固定最终位置，不在临时路径创建后搬迁，以免破坏脚本 shebang。依赖版本与源码快照的 `setup.sh` 保持一致：Python 3.12，onnxruntime 1.22.1、onnx 1.19.0、numpy 2.5.3、Pillow 12.2.0、opencv-python-headless 4.12.0.88。OpenCV 按快照的 `--no-deps` 安装方式处理，实际数组运算会在预检验证。

安装不覆盖已有目录或链接；源资源保持原样。复制 worker 全部退出后才回滚，失败只删除本次创建的目标目录。依赖安装后再次验证资源，并写入安装回执。并发安装只能由一个调用占有目标目录。目标可以直接是新用户数据目录下的 `PrivateRuntimes/IndependentBeauty/current`；已有安装的升级需要新目标和明确配置，不自动切换旧 `current`。

provider 的可用状态现在检查：

- Python 版本、五个固定版本依赖的导入、NumPy／Pillow／OpenCV 运算，以及真实 ONNX CPU Identity 推理。
- Bun 实际执行和 TypedArray 运算，避免仅凭可执行权限把 Node 当作 Bun。
- Swift 编译器执行，以及 Swift 调用 Metal 设备编译一段着色器。

管线使用 Metal 运行时编译，无需独立 `metal` 命令。本机该命令缺少离线工具链，但真实 Swift／Metal 预检及原图渲染成功。每项预检最多 30 秒，渲染取消信号传到预检；失败会等待其他预检结束。继承环境清除 Python 路径和 DYLD 注入。预检返回 `gpuRenderVerified: false`，安装回执返回 `pixelsRendered: false`，实际照片渲染另行记录。

## 重现命令

在 QCut workspace 根目录执行，参数中的工具路径均为绝对路径。`BEAUTY_SOURCE` 指本地合法持有、与当前 source manifest 绑定的资源；不下载或上传私有素材。`BEAUTY_INSTALL` 必须尚不存在。

```sh
BEAUTY_SOURCE='/absolute/local/payload'
BEAUTY_INSTALL='/absolute/new-user-data/PrivateRuntimes/IndependentBeauty/current'
bun scripts/install-independent-beauty-runtime.ts "$BEAUTY_SOURCE" research/independent-beauty "$BEAUTY_INSTALL" /opt/homebrew/bin/python3.12 /absolute/uv /absolute/bun
bun scripts/verify-independent-beauty-runtime.ts "$BEAUTY_INSTALL" research/independent-beauty "$BEAUTY_INSTALL/.venv/bin/python" /absolute/bun
```

校验 CLI 只传前两个参数时仅审计 payload；传 Python 和 Bun 后执行计算环境预检。Python 路径保留 venv 的链接入口，不能先 realpath 成系统 Python，否则会丢失虚拟环境语义。该 CLI 验证 profile 与 manifest 的绑定；provider 还会重新检查全部 262 个源码哈希。

签名包照片探针复用矩阵的包内 provider 加载器，要求实际指定包自己的 Electron 可执行文件，不允许原生 host override。保存原图、独立结果、原生结果和差异图，并记录应用身份、零参数恒等和 RGB／Alpha 差异。

```sh
bunx esbuild scripts/beauty-lab-photo-probe.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/scripts/beauty-lab-photo-probe.cjs
QCUT_INDEPENDENT_BEAUTY_RUNTIME="$BEAUTY_INSTALL" QCUT_INDEPENDENT_BEAUTY_PYTHON="$BEAUTY_INSTALL/.venv/bin/python" ELECTRON_RUN_AS_NODE=1 '<app>/Contents/MacOS/QCut AI Video Editor' dist/scripts/beauty-lab-photo-probe.cjs '<portrait.png>' '<new-output>' --packaged-app '<app>'
codesign --verify --deep --strict '<app>'
```

## 验证与边界

本机全新副本位于工作树 `.local/jianying-parity/fresh-install-r2/PrivateRuntimes/IndependentBeauty/current`。资源副本均为普通文件，不含原生 Frameworks，venv 独立创建。安装回执记录 358 文件、68,134,182 字节，预检约 397 ms。开发 provider 对 240×320 原图施加美白 45、TotalFace 35、Nose 25、珊瑚裸粉口红 40，独立 RGBA SHA 与此前一致：`fa61940f10af88ed408e83aeb6c547ee29edc7ab2fab4509f36e5e5e0316fa0a`。

真实异常验收：只有系统 Python、用 Node 代替 Bun、无效 Xcode 目录均报不可用；用失败的 provisioning 工具安装时新目录完整回滚。分别记录于上述 evidence 根目录的 `negative-cases.json`、`development-receipt.json` 和安装目录的 `installation-receipt.json`。私有资源和这些本地路径证据未提交或加入应用包。

重建的 Developer ID 签名应用位于 `.local/beauty-fresh-install-package-r1/mac-arm64/QCut AI Video Editor.app`，Hardened Runtime 和原 entitlements 保持有效，明确关闭 notarization。使用这个包自己的 Electron 加载其 ASAR provider，外置目录和 Python 都指向新安装，包内原生 provider 也成功处理同一原图。结果保存在 evidence 根目录的 `packaged-photo/`：独立零参数与原图逐字节一致；复合参数下原生与独立差异为 31 / 76,800 像素，RGB 最大差 1，RGB MAE 0.0001475694，Alpha 最大差 0。原生和独立 RGBA SHA 均与先前窗口验收一致。`comparison.json` 记录实际应用可执行文件、ASAR、原生 host 的身份哈希，并保持 `packagedUIVerified: false`。

处理后整包严格签名仍通过，262 个源码哈希和精确 263 个资源文件全部正确；358 个资源副本的哈希全部匹配，确认都是普通文件。新 venv 的 `sys.prefix` 指向新安装，其 package inventory 记录在 `python-environment.json`。`final-receipt.json` 汇总安装副本、包内身份和像素门禁。本轮重建并验证的是目录包，尚未创建公开安装器或执行 notarization。

同时通过新签名应用的实际窗口打开测试项目 `ee1c5586-c36f-4ea2-b056-0e789235d644`，重新导入原图、设置同样四个参数并执行双路处理。环境预检后自研状态就绪，窗口显示原生与自研为 31 像素／RGB 最大差 1／Alpha 差 0；`beauty-lab-window.png` 和 `beauty-lab-window.ax.txt` 保存截图及状态。窗口使用原有默认外置安装，保持用户配置原样；全新资源／venv 的包内处理证明来自上述 CLI，二者分别记录。CLI 自身的 `packagedUIVerified` 标志不因此修改。

相关九个测试文件共 171 项通过，覆盖环境失败、等待和取消、资源完整性、复制独立性、旧安装保护、并发占有、安装回滚、provider／IPC／序列／PNG／包内加载及前端 hook。Electron 构建、全库类型、三个 CLI 严格类型和明确文件范围的 Biome 检查通过。

上一轮 head `430bb46f` 的 CI 在资源 profile 测试失败：CI 从 `apps/web` 启动，测试从 cwd 拼接快照路径导致 ENOENT。profile 测试和新增环境测试改用 `import.meta.url` 相对测试文件定位，保留原始哈希校验；另从 CI 相同 cwd 运行四个相关文件，74 项通过，不降低测试要求。最终推送的跨平台 CI 仍需按新 head 观察。

仍需另一台干净 Mac 的安装验证、基础工具自动引导、完整传递依赖锁定、notarization、19 项照片残差，以及独立视频的时间线／最终导出和跟踪／遮挡／多人处理。资源来源必须是匹配当前 profile 的本地完整 payload；不支持按控制项裁剪安装。本轮没有修改美颜算法或放宽像素阈值。
