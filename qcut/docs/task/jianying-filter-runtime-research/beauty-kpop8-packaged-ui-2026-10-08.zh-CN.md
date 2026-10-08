# Beauty 8：签名应用窗口、双路处理与 ZIP 导出

本轮在独立工作树的 `beauty-8-packaged-ui` 分支推进，基于 `origin/master` 的 `cdfb012a33aa3443c6226bdf6aaed872702562eb`。上一轮 PR #487 已合并；本轮修复实际签名应用启动缺失依赖，并完成窗口内真人照片双路处理和导出验收。

## 启动修复与回归门禁

旧包启动停在错误弹窗：主进程通过 Beauty Lab research 模块加载 PNG 解码器时，需要 `pdf-lib/cjs/utils/png.js`，但 `pdf-lib` 被声明为开发依赖，打包时被排除。将其移入生产依赖，锁文件仅同步依赖分类，未改版本。

新增 `scripts/verify-packaged-beauty-lab.ts`，要求指定应用自己的 Electron Node 可执行文件，加载真实 ASAR 内 research 入口及 PNG 解码器、包内 canvas。生成带过滤行和透明像素的 1448×1086 PNG，并逐字节校验解码。旧签名包在该门禁失败，新包通过；既有生产依赖门禁也由缺少 pdf-lib 变为全部 46 项通过。该 CLI 明确输出 `packagedUIVerified: false`，不能替代下面的窗口证据。

```sh
bunx esbuild scripts/verify-packaged-beauty-lab.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/scripts/verify-packaged-beauty-lab.cjs
ELECTRON_RUN_AS_NODE=1 '<app>/Contents/MacOS/QCut AI Video Editor' dist/scripts/verify-packaged-beauty-lab.cjs '<app>'
codesign --verify --deep --strict '<app>'
```

本机 QA 包为工作树下 `.local/beauty-ui-package-r1/mac-arm64/QCut AI Video Editor.app`。使用既有 Developer ID、Hardened Runtime 和原 entitlements，未 notarize。完整 Web/Electron 构建、全库类型检查、来源检查通过；PNG 解码、独立 provider、IPC handler、包内矩阵 provider 四个测试文件共 99 项通过。

## 实际窗口验收

通过原生应用界面创建测试项目 `ee1c5586-c36f-4ea2-b056-0e789235d644`，导入 `portrait-02-original.png`（240×320），加入时间线，进入美颜实验室并导入同一照片。设置美白 45、瘦脸 35（TotalFace）、瘦鼻 25，以及珊瑚裸粉口红 40，其他参数为零；依次点击原生处理和自研处理，最后通过应用 Save 面板保存对照 ZIP。

默认独立运行库使用 `~/Library/Application Support/qcut/PrivateRuntimes/IndependentBeauty/current`，Python 使用其中 `.venv/bin/python`。本机将既有独立版的 research、Cache、Frameworks、Models 和 Python 链接到外置版本目录。最初漏链 Cache，界面自研美白报错；补齐资源后同一请求成功。没有向应用或 Git 复制私有模型、素材或库，也没有覆盖原生宿主。独立流程会读取外置素材及常量，但回执确认未使用原生输入、几何或 fallback。

| 对比 | 变化像素 / 76,800 | 最大 RGB 差 | RGB MAE | 最大 Alpha 差 |
| --- | ---: | ---: | ---: | ---: |
| 原图 → 原生 | 41,510 | 120 | 3.1047699653 | 0 |
| 原图 → 自研 | 41,510 | 120 | 3.1046918403 | 0 |
| 原生 → 自研 | 31 | 1 | 0.0001475694 | 0 |

本地证据均在工作树 `.local/jianying-parity/beauty-ui-r1/`：`beauty-lab.png` 是实际签名窗口截图；`qcut-beauty-lab-comparison.zip` 是应用界面导出；`ui-receipt.json` 是导出后的像素与资源校验。ZIP SHA-256 为 `06a45bd80a358bf64bb0719f9fddedb6ddf8362ecfa7782ff3c070a89a89bd1c`，CRC 检查通过，包含三张结果、三张差异及 comparison.json。独立 PNG 文件字节 SHA 与 worker 最终回执一致，未重编码；原图／独立 RGBA SHA 与 provider 回执一致。

运行后再次验证整包严格签名成功，261 个导入源码和 1 个生成源码的 262 个哈希全部正确；资源目录精确为 263 个文件，未产生字节码缓存。UI 验证标志记录在独立的 ui-receipt.json，未改变 CLI 的能力边界。

## 仍需推进

此次闭环限于本机签名 macOS arm64 包和一张照片的复合参数。新机器安装／依赖引导、运行库完整性预检和 notarization 尚未验证。provider 的可用状态只证明入口与基础路径可用，不代表每种素材完整安装。原全矩阵的 19 项残差、独立视频时间线／最终导出、跟踪／遮挡／多人仍未解决。本轮没有修改算法或放宽像素阈值。
