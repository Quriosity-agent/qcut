# 滤镜实验室：迷雾 Metal / 独立 C++ 同图对照

本轮把已有算法研究接到 QCut 界面：在「滤镜 → 滤镜实验室 → 算法对照」中，用同一张图片、同一强度和已核验的同一 LUT，比较现有 QCut Metal 迷雾与独立 C++ 迷雾管线。该入口不修改项目或时间线，只生成实验结果。

## 使用

1. 在 macOS QCut 打开上述入口，默认使用自有 320×180 测试图；也可选择 PNG、JPEG 或 WebP。
2. 设置强度 0–100，点击「运行同图对照」。初次开发环境调用会构建 C++ 参考程序；发布包通过已有 staging 流程携带程序。
3. 查看共同输入、Metal 输出、C++ 输出、RGB 绝对差异 ×8。数值包括 RGB MAE、RMSE、最大误差、Alpha 最大误差和不同像素数，单位为 0–255 色阶。
4. 切换五个 C++ 阶段：输入、横向模糊、纵向模糊、迷雾合成、LUT 调色。当前只采集 C++ 阶段，不显示虚构的 Metal 阶段差异。
5. 下载含图片的 JSON 报告；可在命令行按报告的实际输入和强度复跑。

本地需要已缓存、hash 匹配的迷雾 LUT。不会下载资源，也不会加载剪映动态库。不支持的版本、透明输入和无效请求明确失败，不改用另一滤镜或 identity LUT。

## 接入结构

- [界面入口](../../../apps/web/src/components/editor/media-panel/views/adjustments/filter-lab-backends.tsx)新增第三个标签；图片读取、结果展示独立拆分。
- [对照服务](../../../electron/qcut-independent-filter/comparison.ts)复用实际产品的 `createIndependentFilterSession` 作为 Metal 候选，调用已有独立 C++ CLI 作为参考，不复制一套算法。
- [参考 adapter](../../../electron/qcut-independent-filter/fog-cpu-reference.ts)将 RGBA 和经过核验的 LUT 写入独立临时目录，运行 `--trace`，严格检查输出长度和最终阶段一致性，然后清理目录。
- [构建桥](../../../electron/qcut-independent-filter/fog-cpu-bridge.ts)以源码/头文件 hash 缓存开发程序。`stage-independent-filter-host` 新增 `qcut-independent-fog-cpu`，通过既有 `resources/bin` 规则进入 macOS 包。
- 新 IPC 复用主窗口与主 frame 身份校验。调用方不能指定可执行文件、LUT 或输出路径；服务只允许一项对照任务，两个 worker 均结束后才释放门禁和清理 renderer。

报告记录资源 ID/版本、强度、实际比较尺寸、系统、两种程序的二进制 SHA256、LUT RGBA SHA256、所有图像原始 RGBA SHA256、结果图和数值。换图片或强度时清除旧结果；离开页面后不回填过期任务。下载使用 Blob URL，结果更新和组件卸载时释放。

## 复跑

从包根运行；输出目录必须是新目录，以免覆盖已有证据。

```sh
bun scripts/compare-independent-fog.ts --input /absolute/input.png --intensity 100 --output /absolute/new-comparison
bun scripts/compare-independent-fog.ts --replay /absolute/qcut-fog-comparison.json --output /absolute/new-replay
```

输入文件模式要求图像每边不超过 640 像素，不隐式缩小；报告模式解码报告内的实际输入 PNG，并核验 RGBA hash 后重放。可以显式覆盖 `--intensity` 另做强度试验。输出包含 `report.json`、共同输入、两种输出、差异图和五个 C++ 阶段 PNG。

## 范围

本轮仅支持已核验版本的迷雾、macOS Metal、单张不透明 SDR RGBA8。界面图片上限 20 MB / 4000 万解码像素，长边自动等比缩到 640 并显示实际尺寸。比较前的浏览器解码与缩小可能影响图片，但两个实现接收完全相同的最终字节；不能把结果外推为原尺寸或 HDR 结论。

这里比较的是 QCut 的两个实现，不是剪映 UI 对照。没有设置“所有图片通过”的全局容差标记，也不更新资源库的 native parity 认证。没有接入 C++ 迷雾到产品预览/导出，没有接入其它滤镜、视频批量比较或 Metal 中间 Pass 捕获。现有预览与导出路径保持独立。

## 验收记录

- 自有 320×180 测试图，强度 100：RGB MAE `0.013101851851851852`，RMSE `0.11446332098909175`，最大误差 1，Alpha 最大误差 0；2145 / 57600 像素不同。实际界面与 CLI 重放一致。
- 自有 33×19 非均匀图实际运行：零强度逐字节不变；强度 100 重复两次结果与数值一致，五个阶段完整，最大误差不超过 2，Alpha 不变。
- 32 项相关单元/组件/IPC 回归通过；另 1 项 opt-in 真实 Metal/C++ adapter 测试通过，后者覆盖多次真实调用。
- Electron 与 Web TypeScript 检查通过；完整 Electron 构建和三种自有 helper staging 通过。
- 完整 QCut 独立测试配置中，从滤镜面板进入对照页，运行真实任务并确认五张显示图片解码成功；1280×720 上传图被等比缩为 640×360；阶段选择与参数失效处理可用。640×360 上传图零强度误差全为 0；透明图片明确拒绝，恢复测试图后可继续操作，时间线序列化前后相同。
- 报告经真实 Electron `will-download` / `done=completed` 保存；测试监听器仅将保存位置指向私有证据目录，随后 CLI 核验输入 hash 并复跑成功。发布目录中的 Metal 与 C++ 程序也通过同一报告重放。
- 测试实例遇到既有在线资源服务请求失败；对照本身使用已校验的本地 LUT 和自有程序，数值验收不依赖这些网络请求。

全部图片、报告、构建日志、UI 记录保存在 `/Users/peter/Downloads/QCut-Binary-CPP-2026-09-08/filter-lab-comparison/`，不入 Git。源代码、测试及文档继续在 PR #469；远端 CI 以本次推送的精确 head 为准。
