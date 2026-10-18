# 冷状态智能美体候选的历史验证

同步主分支后，这份候选实现保留为显式研究入口 `body_smart_candidate.py`。编辑器默认照片入口仍为上游 `body_smart_render.py`，同图更新八次。以下数据对应合并前候选；最终合并验证另见持续状态记录。

# 十项自研智能美体接入桌面端（2026-10-18）

分支：`codex/body-beauty-desktop-scaleup`，从 `origin/master` 的
`3d625c25519196240105a1adb44100b5039a6453` 创建。PR #506 已提供三个手动美体工具和智能长腿；
本次补齐另外九项，并用完整 cold 描述符替换正式链路中长腿的八次拟合更新。

## 代码链路

1. 同一张原图先经自有 float-texture Metal 算法图缩放，身体和人脸使用同一光栅。
2. 既有私有固定点身体网络：coarse 检测后一次 refine，取首次对外报告的身体。
   检测第一人，最多五个人脸候选；身体头部位置关联最近且在门限内的人脸。
3. 既有独立 face160/120 推理，首帧 warm 后一次 tracked update，独立产生归一化 106 点、
   矩形和保留的 roll。越界脸归类为拒绝候选；模型或推理故障继续抛出。
4. `body_composition` 命名包生成完整 Status、Head、Public 与各部位状态。
   每个请求新建实例，所有部位读取同一 30×30 基础网格，依次累加 float32 位移：
   小头、长腿、瘦腰、瘦身、直角肩、宽肩、天鹅颈、美胯、瘦手臂、胸型。
5. 系统边界处理后，原图只经一次 half-texture Metal 采样。

没有复制桌面研究的 oracle、厂商库、人物点或新权重到仓库。
使用已有 `body-skeleton-v1.npz`、face detector、face-align120/160、alignment assets。
实现仍依赖本机私有模型数据和 macOS Metal/系统 float32 数学。

智能美体仍在妆容之后作为单个 stage；手动美体在脸型之前，沿用既有顺序。
控件百分比只除以 100 一次；宽肩、美胯、胸型支持 -50..50，另外七项支持 0..100。
美胯和胸型的正负倍率不同，不能统一取绝对值。

## 桌面能力门禁

`MediaPortraitProperties` 与引擎提示共享一次独立运行时检查。
智能控件读取 `inspectIndependent().controls`，手动工具读取 `manualBodyTools`。
原生资源缺失不再错误禁用可用的自研工具；老版本运行时也不会借原生资源开放不支持项。
切换引擎时丢弃旧检查结果，不支持的已保存手动效果仍可清除，区域 overlay 停止编辑。
自研范围显示为“智能：首个检测人物；手动：指定区域”。

## 当前实测

| 验证 | 结果 |
| --- | --- |
| 命名化数学包 vs 桌面 owned Combined | 52 组同输入全部 bit-exact，含十项各自、组合、零、负值、有脸/无脸 |
| 部分骨点缺失与有/无脸 | 242 组合无异常，全部输出有限 |
| 原始 720×1280 图片重新推理 vs 桌面已保存独立结果 | 身体点、visibility、人脸106、矩形、roll、完整网格及 RGBA 全部逐字节相同 |
| 新代码 vs 本机原生 Status/描述符/十项网格/原生 Metal | 720×1280、1080×1920 两个尺寸通过，最大顶点误差 0、RGBA 最大差值 0 |
| 旧/新共享 half Metal host | 256×512、1080×1920 变形网格随机图逐字节相同 |
| 新 float 算法光栅 vs 桌面研究 host | 两组尺寸逐字节相同 |
| 完整 Python 回归 | 631 项通过，1 项旧照片 opt-in 测试跳过 |
| 最终智能美体回归 | 15 项通过，含无 Darwin 专用符号时的参数验证与零值导入；几何仅在确实渲染时加载 |
| Planner / Electron / worker / UI | 29 planner、91 provider/cache、30 worker/queue/sequence、26 UI 测试通过 |
| 打包来源与环境 | 346 个源码 pin、既有 363 个私有 payload 文件验证通过；Python/CPU/Swift/Metal 环境检查通过 |
| 真实桌面 UI → 1080p 预览/导出 | 十项智能滑块及三个手动工具实际录入，预览 vs canonical pipeline 和无损导出第0/3/5帧均 RGBA 最大差0；6帧 MP4完整解码通过，压缩后 RGB MAE 2.663 |
| 旧长腿桌面 E2E | 通过，导出腿部 vs 自研引擎 MAE 2.67，vs 原图 15.53；上半身 vs 原图 2.28 |
| 真实 1080p one-shot / resident | 各三次 RGBA、PNG 全 exact；one-shot 中位3.800秒，resident热态中位1.406秒，2.70倍 |
| 活跃计算中取消 / SIGKILL / 恢复 | 自有 worker CPU 增长210ms后触发，两者均拒绝请求并换新PID恢复，输出像素不变；测试worker均已退出 |

原生对拍使用新代码从原图独立推理得到的共同输入，再在独立 oracle 进程执行原生函数与原生着色器。
这验证描述符、状态、网格和采样，**不等于默认 CoreML 感知、多人身份或长视频时序全部一致**。
720p 的完整独立结果另与桌面固定 CPU 已验收 profile 对齐。
1080p 是同一原始照片的高清缩放样本，不是另一张人物样本。

十项复合参数：小头40、长腿60、瘦腰20、瘦身30、天鹅颈20、瘦手臂30、直角肩20、
宽肩15、美胯-30、胸型-40。两尺寸的十项均产生非零位移；分别改变 423,210 和 970,282 个像素。

本机证据（未提交图片与私有 oracle 数据）：

- `.local/body-composition-port/reference-parity.json`
- `.local/body-beauty-desktop-scaleup/perception/comparison.json`
- `.local/body-beauty-desktop-scaleup/mesh-review/comparison.json`
- `.local/body-beauty-desktop-scaleup/native-audit/index.html`
- `.local/body-beauty-desktop-scaleup/native-audit/{720x1280,1080x1920}/summary.json`
- `.local/body-beauty-desktop-scaleup/resident-body-active/summary.json`
- `output/playwright/portrait-independent-body-composite/run-Okm6rw/acceptance.json`

桌面 E2E 是 0.25 秒单图短片，六帧均来自同一张静态照片，用于验证 UI、帧渲染与导出接线。
不能将其计为真实运动视频验收。常驻进程试验不包含帧缓存，热态复用模型会话；取消在观测到
本次 worker 消耗 CPU 后才触发。预检阶段取消可保留原 PID，不能用 PID 未变误判取消失效。

## 仍需验证

逐帧是 fresh-state 契约。常驻 worker 复用不可变模型会话，不保留人物状态；把桌面的
`PersistentCombined` 直接放入全局缓存，会让 seek、倒放、跨片和命中帧缓存依赖调用历史。
后续必须先定义 source/stream、时间戳、重置及历史身份协议，再验收真实运动、遮挡和恢复。

尚未闭环：真实运动长视频、转身/交叉/多人身份、背景保护蒙版、不同身形与服装的大样本、
长时内存与音画同步、身体参数本身的关键帧，以及默认 CoreML 与固定 CPU 感知的差异。
小图与横屏的独立处理不应由当前竖屏共同输入对拍推导为原生全链 parity。
