# Beauty 8：签名包原生宿主加载闭环

上一轮签名宿主无法解析 `@rpath/libAGFX.dylib`。本轮在完整 Developer ID 签名 arm64 包内，通过自动解析的包内原生宿主完成四张真人照片、24 项双路渲染；没有宿主覆盖、没有重新签名运行时缓存、没有放宽 entitlements。此结论限于真实包内 provider，窗口与新机器安装仍未验收。

## 修复与边界

Hardened Runtime 下，依赖 `DYLD_LIBRARY_PATH` 的开发启动方式不足以支持签名宿主。构建宿主加入 `LC_RPATH @executable_path/Frameworks`；启动时将自己的宿主原始签名字节放入用户缓存，旁边的 `Frameworks` 软链接指向已安装的外部私有运行库。原生库不复制进应用或 Git。子进程环境去除 `DYLD_*`。

缓存身份绑定宿主 SHA-256 和运行库 canonical path。发布采用临时目录与原子 rename；复用前验证目录、执行权限、字节哈希与链接目标。篡改缓存、重定向链接、宿主或缓存根软链接均拒绝。并发创建只接受完整胜出目录。宿主更新和运行库安装位置变化产生新缓存。

实际包：`.local/beauty-signed-layout-package-r1/mac-arm64/QCut AI Video Editor.app`。它使用现有 Developer ID 和 Hardened Runtime，关闭 notarization，仅用于本机 QA。运行前后整包 `codesign --verify --deep --strict` 均通过；包内和缓存宿主的严格签名验证通过，字节 SHA-256 相同：`3f6d74cf48d90bd167b3b5f53aa29ee7c300755223f41c5aefbbb3cb515969cd`。

## 可复跑的包内矩阵

`beauty-lab-matrix.ts --packaged-app <app>` 要求在指定包自己的 Electron Node 模式执行，禁止原生宿主覆盖，要求明确的外部独立运行库／Python 路径。工具加载 ASAR 内两套真实 provider；记录 ASAR、应用可执行文件和原生宿主哈希。断点续跑同时验证执行身份，包重建后不能沿用旧案例。

```sh
bunx esbuild scripts/beauty-lab-matrix.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/scripts/beauty-lab-matrix.cjs
env -u QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST \
  ELECTRON_RUN_AS_NODE=1 \
  QCUT_INDEPENDENT_BEAUTY_RUNTIME=<absolute-external-runtime> \
  QCUT_INDEPENDENT_BEAUTY_PYTHON=<absolute-external-python> \
  '<app>/Contents/MacOS/QCut AI Video Editor' \
  dist/scripts/beauty-lab-matrix.cjs <configuration.json> <new-output-directory> \
  --packaged-app '<app>'
```

配置取上一轮四张真实照片，最长边 320，每张执行 stress 六项：zero、shape-features、local-six、skin-shape-lip、eye-three、pigment-seven。文件名不作为人物身份或姿态标注。输出 `.local/jianying-parity/beauty-8-signed-package-matrix-r1/`；`run.json` 保存完整配置与执行身份，`matrix.json` 保存逐项结果，`signed-receipt.json` 保存运行后源码和签名验证，页面与浏览器截图保存原图／原生／自研／差异 ×8。

| 指标 | 实测 |
| --- | --- |
| 计划／完成／两路出图 | 24／24／24 |
| 最大 RGB 差 ≤1，alpha 无差异 | 23 |
| 超阈值 | 1 |
| 渲染失败／非零自研不改图 | 0／0 |
| 独立零参数原图恒等 | 4／4 |
| 运行后固定源码哈希 | 262／262 |
| 运行后精确资源文件数 | 263（源码加 manifest） |
| 新生成 Python 字节码缓存 | 0 |

唯一残差为 `portrait-01--skin-shape-lip`：最大 RGB 差 18，RGB MAE 0.0232818，与上轮同案例一致。本轮没有修改算法或阈值，也没有解决原有全矩阵的 19 项残差。24 个保存案例的续跑重新校验成功。开发路径另执行同照片的一组 6 项，全部出图、全部最大 RGB 差 ≤1，验证去除 DYLD 后开发宿主仍能加载。

## 回归与未完成项

本轮 QCut 回归 221 项／12 文件通过，包含 10 项缓存布局、18 项矩阵执行选择、相关原生宿主／鼻子／preroll、独立 provider／IPC／序列、矩阵续跑、资源 staging 和来源规则。新执行选择测试加入 CI。Electron 构建、全库类型检查、来源检查通过。

应用实际窗口通过 CUA 启动检查仍超时；该次应用 PID 9879 的进程采样停在 `NSAlert runModal`（`/tmp/qcut-beauty-signed-ui-sample.txt`），尚未获得提示文本，不能把包内 Node 模式渲染当作窗口验收。

仍缺：包内窗口进出图与导出、新机器运行库／Python 安装、notarization；19 项照片残差；独立视频接入时间线／最终导出以及跟踪、遮挡和多人样本。此次明确突破是签名包原生宿主自动加载，并非整个美颜产品已完成。
