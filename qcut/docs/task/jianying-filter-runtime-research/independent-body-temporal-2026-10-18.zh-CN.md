# 美体持续状态与原版依赖边界（2026-10-18）

本轮目标是按已验证的原生数学推进独立实现。生产默认路径仍是逐帧照片渲染；新增持续序列是显式离线 API，尚未切换编辑器的预览、内容缓存和导出调度。不能把底层对拍通过写成产品视频已经验收。

> 后续：[自研美体接入视频片段（2026-10-18）](independent-body-video-2026-10-18.zh-CN.md) 已把这套会话接进预览、帧缓存与导出。

## 新增能力

- `body_composition.PersistentCombinedBody(mode=1|2)`：十项变形器持续状态、Head/Public/Status、肩部缓存、ROI 与计数器。原 `CombinedBody` 保留。
- `BodySkeletonSequence`：初检只建立跟踪目标，后续帧使用上帧关节生成 ROI，运行 refine 和原版阈值／平滑；丢失后回到 coarse。当前明确拒绝初检多个人体，未默认选第一个人。
- `BodyVideoFaceSequence`：持续的 160 初始化、120 更新、106 点／矩形／roll；视频概率分段和可见点判定、同帧全图重检、帧尾恢复窗口。恢复窗口内保留跟踪脸的匹配分支明确拒绝，避免采用未验证规则。
- `BodySmartSequence`：固定尺寸、显式 stream、连续 frame index 和 timestamp；目标归零仍推进历史；取消或推理／GPU 失败使会话失效，必须 reset 后从起点重放。没有全局可变时序状态，也没有复用旧照片内容缓存。
- `body_sequence_render.py`：一进一出的离线 PNG 序列接口。初检／无外部骨架帧输出原图；保留帧号和时间，不丢帧。
- 可选 `QCUT_BODY_SKELETON_BACKEND=onnx-exact`：从已校验的私有 NPZ 在内存构建标准 ONNX，保留定点运算顺序、溢出和舍入。固定 CPU、ORT 1.22.1、关闭图优化；默认仍是 NumPy。

持续几何的 mode1、mode2 不等价。新增离线序列明确使用 mode2 的锚点保持规则，不代表所有剪映调用场景都应选择 mode2。尺寸、镜头或人物身份变化需要外部重置和重新建立历史。

## 验证范围

证据目录：`.local/body-temporal-20261018/`。原始私有模型、原生库、着色器、反编译输出与素材均未纳入源码。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 持续几何移植 | Python 3.12、3.14 各 240 帧，状态／网格／两肩缓存逐位一致 | 对照已有自写研究实现，不冒充新增原生实拍验收 |
| 已捕获的 6 帧感知 | 张量、骨架、脸点、矩形、roll 一致 | 同一照片平移的固定回归素材 |
| 6 帧中的 5 个身体输出 | 原生状态、网格和原生着色器 RGBA 零差异 | mode2、单人、orientation0、bit16、空保护遮罩 |
| 真实 1080×1920 连续 12 帧感知 | 骨架有无、11 组坐标和可见性，脸部有无、11 组 face106／矩形／roll 逐位一致 | 对拍原生完整 Bach 图；指定 modern CPU 骨架，非全部 CoreML／视频场景 |
| 真实 12 帧视频脸部判定 | 16 次模型调用的接受／拒绝、可见点数、阈值、恢复状态一致 | 分类概率自身存在数 ULP 差异，未声称所有网络输出逐位一致 |
| 原生分类与裁剪函数 | 6,320 个分类边界／随机案例；1,003 个裁剪案例，全部一致 | 直接调用已锁定版本的原生函数 |
| 修正后的持续变形／渲染 | 输出 12 帧；11 个身体输出的原生状态、网格和 RGBA 零差异 | 先证明感知一致，再以相同输入比较 mode2 几何与原生着色器；不替代完整产品验收 |
| 取消／跳播重放 | GPU 绘制后取消使会话失效；reset 重放与原输出 12/12 帧逐像素一致 | 显式 Python API，非编辑器 IPC／工作进程恢复验收 |
| 系统文件隔离 | 禁读剪映应用、私有原生库、原模型目录、桌面参考实现后，12/12 帧与普通运行相同 | 测试目录仍带有提取的原版模型权重 |
| 可选 ONNX | 16 个输入、28 个输出、403,488 个整数逐位一致 | 固定权重／CPU／ORT 版本；不推广至 CoreML |

最初对拍发现两处实际缺口，现均按原生规则修复：骨架跟踪缺少脚踝／膝盖不可见时的扩框，导致精细网络裁掉腿部；人脸错误沿用了照片 `prob0 > .5` 拒绝规则，且缺失同帧重检与恢复窗口。修正后第 5 帧跟踪和重检均拒收，第 6 帧放宽可见性阈值恢复，第 7 帧回到普通阈值并接受，与原生一致。恢复窗口不是简单的“上帧没脸”：触发帧尾开启，最多 30 帧，重新增添有效脸后退出。故障注入还确认了未实现的 retained-face 匹配分支，当前显式报错。

运行文件隔离前，负向对照直接打开 `libcccreator.dylib` 被系统返回 `PermissionError`。候选进程及其自写 Metal 子进程的原版私有动态库列表为空。候选的图像、骨架、状态和网格先独立生成；原生比对进程随后读取候选结果，原生结果不会反向成为候选输入。

## 性能

修正后的 12 帧取消／重放探针记录热态中位数 234–238 ms／帧，保留模型会话的照片算法约 490 ms／帧。运行时其他回归也在执行，因此这里只记录观测值，不作为正式加速倍率。二者历史状态不同，也不能用两者像素差衡量加速误差；尚未达到实时 24／30 fps 的验收。

单独替换网络解释器时，1080p 感知热态 369→357 ms，冷态 2631→2772 ms。收益小且冷启动退步，所以 ONNX 维持显式启用。原 NumPy 路径继续作为默认和精确对照。

## 三层独立性

1. **自有推理、状态、几何与渲染代码**：候选路径不调用原版库，也不读取原生点位／网格捕获。
2. **运行时不访问剪映安装文件**：已用系统沙箱验证；显式视频配置的最小身体＋脸部感知资产共六项、7,432,629 字节，可独立放置；默认照片 payload 仍为 363 项，没有新增必需文件。
3. **完全不含剪映来源文件／权重**：尚未完成。六项仍是 `body-skeleton-v1.npz`、`face-detector-dynamic.onnx`、`face-align-120.onnx`、`face-align-160.onnx`、`alignment-assets-v1.npz`，以及可选视频 profile 必需的 `body-face-video-policy-v1.json`。复制、改名或转换格式都不改变其来源。独立训练／替代权重需要自己的验收，不能沿用当前定点网络逐位一致的结论。

## 显式离线调用

```json
{
  "stream": "clip-a",
  "frames": [
    {
      "image": "/absolute/frame0.png",
      "timestampSeconds": 0,
      "controls": { "SlimBody": 25, "StretchLeg": 25 }
    },
    {
      "image": "/absolute/frame1.png",
      "timestampSeconds": 0.041666666666666664,
      "controls": { "SlimBody": 25, "StretchLeg": 25 }
    }
  ]
}
```

```sh
research/independent-beauty/research/.venv/bin/python \
  research/independent-beauty/research/body_sequence_render.py \
  --manifest /absolute/frames.json \
  --runtime /absolute/private-runtime \
  --output /absolute/new-output-directory
```

输出目录必须不存在；每帧保存 PNG 和收据，全部完成才生成 `report.json`。每个 manifest 最多 300 帧，时间必须严格递增、相邻不超过 0.1 秒；这是当前明确接受的连续视频输入约束，不是对剪映全部时间调度分支的复刻。

上述 CLI 会设置 `BEAUTY_RENDER_RESOLUTION=original`。直接导入 `render_sequence` 或调用 `BodySmartSequence` 时，调用方须显式设置同一环境变量才能处理 1080p 竖屏；否则默认 `preview` 模式的最长边预算是 1280。原图模式最长边不超过 4096，序列 API 另限制每帧不超过 3840×2160 个像素。

## 尚未关闭的缺口

- 恢复窗口内仍保有跟踪人脸时的全图检测／匹配分支明确拒绝；多人身份关联、交叉遮挡和保护遮罩尚未验收。当前 12 帧只覆盖原生的 1→0→1 恢复。
- 骨架的 coarse 初检会拒绝多个人体，但 refine 跟踪期间不重新进行全图人体检测，因此尚未覆盖第二人进入画面的发现与身份处理；单人仍是输入验收范围。
- `body=None` 时保留该帧原图和时间戳，冻结 composition 历史；身体重新输出后继续使用原有历史。这是当前显式策略，尚未证明其与原生完整遮挡／恢复行为一致。
- 编辑器预览／导出共同的显式时序协议、跳播重放与检查点、取消／进程重启的恢复协议；现有照片缓存不能直接用于有状态算法。
- mode1／mode2 的产品调用选择、关键帧、切镜、旋转、音画同步、长视频内存增长、默认 CoreML 和其他平台。
- 手动 slim 的实测场、stretch 的完整全图采样仍有差距。zoom 已还原有限网格：30 组 CPU 网格逐位一致，12 图最大差 1；空运行目录的系统隔离证明其无需任何原版资产，详见 [局部缩放记录](independent-manual-zoom-2026-10-18.zh-CN.md)。
- 去掉原版来源的模型权重。

同步主分支前的 Python 3.12 回归执行 708 项：707 通过、1 项缺少可选本地图片而跳过，0 失败／错误；日志 `full-python-tests-final.log`。当时的 373 份源码指纹、默认 363 项私有 payload、Python／ONNX／Swift／Metal 环境检查通过；合并上游后的源码清单另行重建。

Electron provider／帧缓存测试使用 Vitest：91 项通过；独立 planner 使用 Bun：29 项通过。

桌面 E2E 另行通过：十项智能美体＋三项手动工具，1080×1920，静态照片导出 6 帧；预览与直接自研、导出无损采样帧 0／3／5 的 RGBA 差异均为 0。MP4 解码平均 RGB 差为 2.61658，属于编码后结果。证据 `output/playwright/portrait-independent-body-composite/run-S3VpRr/acceptance.json`；不把这个静态桌面测试计入真实视频持续状态验收。

REA/Ghidra 在 `/Volumes/MOVE SPEED/ReverseEngineering/rea-ghidra.sh`，本轮 provider doctor 验证可用。反编译针对尚不明确的分支开展；原始 dump 留在本地，仓库只保留自写实现、测试和证据说明。

最终证据入口：

- `sequence-final/actual-native-perception.json`：候选独立推理后再读取原生完整图输出对比，包含骨架可见性。
- `face-lifecycle/candidate-final-face-r2/report.json`：16 次视频分类调用与恢复门控。
- `sequence-final-native/report.json`：11 个原生几何／状态／着色器输出。
- `replay-recovery-final.json`：绘制后取消使会话失效，两次 reset 重放均 12／12 像素相同。
- `isolation/verification-final.json`：修正后的六资产视频 profile 在系统禁读原版目录时 12／12 相同。
- `index.html`：原图、原生几何与着色器、自研、相对原图的差分；另有手动缩放对比入口。

以上相对路径均位于 `.local/body-temporal-20261018/`。反编译／原始探针文件和模型均被 Git 忽略。

## 主分支兼容整合

本分支从 `837012a3e` 同步上游，保留生产 `body_smart_render.py` 的八次同图更新，以及上游人脸元数据和姿态滤波行为。冷态研究入口改为 `body_smart_candidate.py`，视频脸部跟踪改为 `body_video_face_sequence.py`，避免改变照片处理语义。网格、坐标归一化和 roll 滤波通过适配器复用上游代码。

整合后重新运行真实 12 帧离线序列，与本轮已通过原生对拍的最终产物全部 RGBA 字节一致，最大差 0。证据 `.local/body-pr-publish-20261018/temporal-real12/integration-parity.json`；这次检查是整合回归，没有扩大原生验收范围。

整合后完整 Python 3.12 回归：720 项，718 通过、2 跳过、0 失败／错误；日志 `.local/body-pr-publish-20261018/full-python-tests.log`。重新校验 421 份源码指纹与 363 项默认运行资产通过。完整 13 个 TypeScript 配置检查、lint 与桌面生产构建通过。

整合后完整 Vitest coverage：1,520 文件、14,575 测试通过，102 测试跳过，0 失败；包含 Electron 和真实 FFmpeg 回归。另一次并发 Electron 运行中的转场线程测试失败，隔离复测 21/21 通过，完整 coverage 中同项亦通过；未修改无关转场代码。planner 29 项、打包清单 41 项通过。

生产照片路径的桌面 E2E 重新通过：`output/playwright/portrait-independent-body-composite/run-JEoepD/acceptance.json`。十项智能美体＋三项手动工具，1080×1920、6 帧，预览与直接自研、无损导出采样帧 0／3／5 最大 RGBA 差均为 0；MP4 解码 RGB MAE 为 2.60122。这是保留八次同图更新后的静态照片结果，仍不代表编辑器动态视频跟踪验收。
