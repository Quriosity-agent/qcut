# beauty-8-kpop：原生与独立自研双路径

2026-10-07。分支 `beauty-8-kpop` 从 `beauty-7-kpop` 的 `a466330e7969a1bc236a7923f2631921d5a61561` 创建。本轮把独立引擎源码拷入 QCut，并在美颜实验室接通原生、自研各自处理、保留结果、差分和导出。提交与推送状态以 Git 为准；本轮不创建 PR。

## 路径边界

- **原生处理**：原有 `jianyingPortraitAdjustment.render` → `createJianyingPortraitAdjustmentProvider` → 本机原生宿主与实际效果运行库。返回 `jianying-local-swing-v1`，未改接为自研。
- **自研处理**：新增独立 IPC/provider → 拷入的 `independent_pipeline.py` → 原图驱动的感知、几何、蒙版及自有渲染代码。返回 `qcut-independent-photo-v1`，回执禁止 native input、geometry、fallback。仍使用已有感知模型和静态资产，并非新训练的模型。
- **混合候选核验**：保留原来的候选研究协议，仍含原生依赖，与上述独立自研分开命名。

“原生按钮确实原生”已由真实 provider 出图验证；整个实验室同时有自研与混合核验入口，不能将所有结果都称为原生。

## 复用范围与来源

`research/independent-beauty/source-manifest.json` 固定 246 份文件、1,125,824 字节。源仓库 `donghaozhang/qcut-beauty-standalone` 在拷贝时的已提交基线为 `c81c840a2f8d2882055c018acc83bdb0b3649ed6`，实际拷贝包含其工作区改动，每个文件用 SHA-256 标识。源目录仍在变化，不将工作区快照误称为该提交的完整内容。

包括 Python 依赖闭包、原图复合规划器、纯界面模型和对应测试；保留 SVD 许可证。未拷贝原生私有库、模型权重、历史人脸 fixture、结果 PNG。生成的轻量 `src/runtime.ts` 去除了规划器对独立版原生接口的导入，纳入同一来源校验。仅改动一份测试中的临时目录路径归一化及私有历史 fixture 缺失时的显式 skip。

| 目录 | QCut 原生目录 | 当前独立复合入口 |
| --- | --- | --- |
| 数值控制 | 90：80 面部 + 10 美体 | 30，均已有相同 key 与 min/max |
| 美妆卡 | 29 | 28，原生另有 `brows-flow` |

目录覆盖不能代表所有效果的像素验收。自研限单人、不透明、最长边 1280 静态照片；多人、视频、手动精修、美体及肤色资源仍由原生路径承担。UI 对自研不支持的当前选择显示原因并阻止提交。

## 使用行为

导入一次图片，两个 provider 使用同一份解码后的 RGBA。实验室图片导入最长边 640。原生／自研先后顺序均保留另一份同参数结果，改变参数或原图时清空旧结果。自研进程树有超时和取消；关闭实验室取消未完成任务。旧输入、取消请求和异常 provider 的返回不能显示为新结果。

导出包含 `original.png`、`native.png`、`independent.png`、三组差分与 `comparison.json`。自研 PNG 保留 worker 原始字节，导出前校验原图 RGBA、自研 RGBA 和 PNG 哈希。运行前后验证固定源码及清单；回执附 `qcutSourceManifestSha256`。结果说明中始终保留 `nativeProductParityVerified: false`，单次接近不是总体验收。

## 本轮实测

- Python 436 项：435 通过，1 项因未分发历史几何 fixture 跳过。
- Bun 规划器／界面模型：12 项通过。
- QCut provider、IPC、双路径 hook、取消、导出和结果组件：274 项通过；覆盖错误返回、不支持选项、原生缺失时自研美妆仍可选择、参数／输入变化、取消和失败不切换到原生。
- Electron 构建、Electron 与 Web TypeScript 检查通过。
- `scripts/beauty-lab-photo-probe.ts` 通过 QCut 两个真实 provider 执行零参数和美白 45 + TotalFace 35 + Nose 25 + `lip-coral-nude` 40 组合。

本机证据目录：

- `.local/jianying-parity/beauty-8-dual-path-r1/`：542×640 真人照片，独立零参数保持 RGBA；组合两路均改变原图。原生／自研 RGB MAE `0.00023543204182041821`、最大差 `1`，239 个差异像素，Alpha 一致。
- `.local/jianying-parity/beauty-8-dual-path-r2/`：480×640 第二张真人照片的同组组合：独立零参数保持 RGBA；RGB MAE `0.00011827256944444445`、最大差 `1`，108 个差异像素，Alpha 一致。数据见 `comparison.json`。
- `.local/jianying-parity/beauty-8-dual-path-r3/`：最终生命周期修复后的真实 provider 重跑，输出与第一轮保持相同 SHA-256，回执包含源码清单哈希。
- 第一目录 `desktop-dual-path.png`：实际 QCut 窗口，美白 45 先自研再原生，两个结果均保留；与原图各改变 62,537 / 346,880 像素，RGB MAE 1.054，最大差 13；两路 RGBA 完全一致。
- 第一目录 `desktop-comparison.zip`、`export-validation.json`：实际通过桌面按钮导出，CRC、三图解码、自研输入／输出 RGBA 与原始 PNG 哈希均通过验证。下载原件在 `~/Downloads/qcut-beauty-lab-comparison.zip`。

桌面 QA 使用独立测试项目 `071a1d4b-4cf7-4c24-b198-d4e3ccb6dcde`。实验室参数与结果不写入时间线。

## 尚未完成的验收

两个真人组合与一个美白案例证明本轮接口真实可用，不覆盖所有 30 项调节、28 卡、参数正负／极值、多脸、侧脸、遮挡、所有复合顺序或视频时序。旧独立版跨阶段报告曾有失败，不因本轮少数样本接近就删除这些缺口。后续应使用同一双路径接口扩展参数与样本矩阵。

当前开发机器通过忽略的软链接复用独立目录的模型资产与 Python 环境。新机器需安装自己的运行环境；打包只携带源码，不携带这些私有资产。本轮未验证发布安装包或自动资产部署。安装与复现命令见 `research/independent-beauty/README.md`。
