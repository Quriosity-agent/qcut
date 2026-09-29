# 下颌骨：原生策略修复与双端导出对照

日期：2026-09-28。分支：`beauty-kpop-v2`。修复前基线：`a37d23e0f3300019097eed7ad2d68f01940803a3`。

承接[脸型与肤色逐项对照](beauty-face-shape-skin-tone-2026-09-28.zh.md)。本轮只修“下颌骨”，不是“下颌线”；没有把尚未验证的其他控件一起调整。

## 结论

下颌骨旧结果在画面左侧轮廓有额外改动，整体幅度偏大。主要可修复因素是原生宿主没有开启 `face_distortion_jawbone_improve`，使用了库默认的旧下颌骨策略。

开启该策略后，真实剪映与 QCut 同规格导出的差分 MAE 在 50/100 两档分别下降 **25.1% / 35.8%**，差分余弦由 **0.750/0.798** 提升至 **0.886/0.952**。修复前额外的左侧轮廓改动明显减弱，变化集中位置更接近剪映。仍有强度与边缘残差，不是完全一致。

此结论来自一张有轻微转头、头发及手部遮挡的真人照片。不能据此声称多脸型、运动视频或 Windows/x86 已通过。

## 原因与排除过程

1. UI 的“下颌骨”对应 `face_adjust_ZoomJawbone`，0..100 映射到 SDK 的 0..1；本轮没有发现滑杆映射错误，所以不改 UI 范围或项目持久化 key。
2. QCut 私有资源与剪映当前缓存的脸型包 `7408077448513998114/aa4932200616e291a252039a3aac7232` 递归比较一致。包内 `reshape.lua` 对该参数乘 0.675，再驱动 organ 14 的 0..-0.2 范围；不能因为最终效果偏大就随意再缩小输入系数。
3. 只将处理输入从 1080 宽提高至 2160，旧截图参考下的差分余弦仅由 0.730/0.781 变成 0.736/0.792，改善很小。本次没有采用放大输入方案，也没有改变祛斑祛痘的既有处理策略。
4. 在本机剪映及 QCut 私有 `libcccreator.dylib` 的 AB 元数据中发现 `face_distortion_jawbone_improve`，类型为 bool，默认 false，描述为 `enable new jawbone strategy`。
5. 保持源像素、模型、资源包、输入尺寸及滑杆值不变，只通过 `bef_effect_config_ab_value` 将这个开关设置为 true，冷宿主重复渲染即改善。随后再用真实编辑器和双端视频导出验证，不把独立探针当作产品通过。

**证据边界：**已确认库中的开关定义、默认值及开启后的因果改善；没有读取剪映进程正在使用的 AB 值，所以不声称已直接捕获剪映线上开关为 true。

## 产品改动

`research/jianying-runtime-probe/filter-probe.mm` 的 `runFilterHost`，在构造图形上下文及渲染会话之前配置该 bool，并把配置返回值加入既有启动失败检查。

这个持久宿主服务于 QCut 人像预览及导出；开发模式的 resolver 会按源码指纹重新编译宿主。没有增加用户设置、修改模型、替换第三方资源或重新标定强度。旧项目继续使用同一个下颌骨 key。独立研究路径 `runFilterSequence` 不在本次修改范围。

## 真实导出结果

原图：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-27/sources/face-ike-louie-natividad.jpg`，4000×6000。

SHA-256：`cac833976bce18c2df0dc4533243a75bfd675e729b492b09ff057b0f3e5aceb2`。

剪映测试草稿 `QCut-Beauty-RealPeople-20260927`，时间线02。三套导出分别为旧 QCut、新 QCut、剪映；每套依次只设置 0、50、100、0，其他美颜参数归零。保存参数截图和导出截图。QCut 只有保存文件选择器使用测试替代，实际效果与编码路径没有 mock。

- 每个文件 H.264、1080×1620、30 fps、5 秒、YUV420P、BT.709、TV 范围。
- 对照器完整解码 12 个文件，共 1800 帧；每个文件另存第 0/60/149 帧并检查尺寸和非空内容。
- 三套各自前后零值图的平均漂移均为 0；旧/新 QCut 的零值对照像素也完全相同。
- 比较第 60 帧，统一到 600×900，各减各自零值，Gaussian σ=0.6，ROI 为 `(70,195)-(535,750)`。灰度为 RGB 绝对差均值固定乘 6，不逐图拉伸，不做几何配准或曝光补偿。

| 下颌骨 | 旧 QCut 差分余弦 | 新 QCut 差分余弦 | 旧差分 MAE | 新差分 MAE | MAE 下降 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 | 0.749702 | 0.885851 | 1.112254 | 0.832618 | 25.1% |
| 100 | 0.798190 | 0.952052 | 1.361403 | 0.874090 | 35.8% |

MAE 是 ROI 中有符号 RGB 改变量之间的平均绝对误差，单位为 0..255；余弦比较改动方向和分布，不是“百分之多少一致”。灰度显示最终像素变化，不是内部蒙版。H.264 编码和两端重采样仍贡献残差，因此这里只报告相对改善，不作为无损像素平价。

早期探针对剪映 UI 截图的误差下降约 38%/47%，不能与本表混用：本表使用双方真实导出，参考图、采样尺寸和颜色路径均不同。

## 测试与非目标回归

- 新增 `portrait-jawbone-export-reference.e2e.ts`：旧/新宿主分别通过真实 Electron 的四次导出，检查独立参数、1080×1620 画布、编码契约、150 帧完整解码、非零两档不同和复位一致。错误列表为空。
- 移除宿主覆盖环境变量后再跑同一导出 E2E：1 项通过，44.9 秒；默认源码构建宿主的四张解码帧哈希与实验新宿主完全相同，最终对照使用这次默认路径的导出。
- 默认宿主运行既有脸型和皮肤 E2E：2 项通过，约 4.2 分钟，覆盖逐项复位、窄窗口、保存重开和组合导出。
- 脸型/现有肤色 26 个单项案例中，只有下颌骨 50/100 两张画布哈希变化，其他 24 张与修复前完全相同。
- 8 个皮肤控件的 16 个单项案例哈希全部不变，皮肤组合及保存重开哈希也不变。
- Python 人像对照测试 42 项通过；新增 4 项覆盖错误来源、不完整/重复/混合参数、零值漂移、颜色契约，以及两档必须同时改善且指标有限的门禁。
- 人像运行契约 16 项通过；Web TypeScript `--noEmit` 与新增 E2E 的 Biome 检查通过。原生宿主由 resolver 使用 `-Wall -Wextra -Werror` 编译。

新增 `scripts/compare-portrait-jawbone-exports.py` 复用现有导出解码、差分、排图工具。它拒绝不匹配来源、混合参数、缺失案例、解码不完整、零值漂移和颜色契约不一致，并要求 50/100 两档的 MAE 均下降且余弦均提升。

## 本地证据与复现

证据根目录：`/Users/peter/Desktop/Jianying-Beauty-Test-2026-09-28/jawbone-gap/`。

- `jianying/`：四个真实导出、各档参数及导出截图、来源 manifest；测试结束后下颌骨恢复 0。
- `qcut-before/`、`qcut-after/`：通过旧/新宿主覆盖路径采集的 E2E 报告、预览截图、导出截图、MP4 和解码帧。
- `qcut-current/`：最终使用默认宿主、无覆盖变量的四档导出；`comparison/report.json` 的 after 输入指向此报告。
- `face-regression/`、`skin-regression/`：使用默认宿主的其他控件回归报告。
- `probe-1080/`、`probe-2160/`、`probe-improved-1080/`：排除分辨率因素、隔离策略开关的原生探针输出。
- `comparison/jawbone-50-before-after.png`、`comparison/jawbone-100-before-after.png`：上排旧 QCut，下排新 QCut；五列为剪映零值、剪映效果、剪映灰度、QCut 效果、QCut 灰度。
- `comparison/` 还保留原始照片副本、三套零值/效果/灰度 PNG、浮点差分 NPY、视频指纹、解码记录和指标 `report.json`。

在仓库 `qcut/` 执行；需要已构建 Electron、可用本地私有运行库、原图、FFmpeg 和 Python 图像依赖。原图未提供时 E2E 会跳过，跳过不算通过。

```bash
SOURCE=/path/to/face-ike-louie-natividad.jpg
ROOT=/path/to/jawbone-gap
QCUT_REAL_PORTRAIT_IMAGE_PATH="$SOURCE" \
QCUT_PORTRAIT_JAWBONE_OUTPUT="$ROOT/qcut-current" \
  bunx playwright test portrait-jawbone-export-reference --workers=1 --reporter=line
python3 scripts/fingerprint-portrait-exports.py \
  "$ROOT/jianying/capture.json" "$ROOT/jianying/manifest.json"
python3 scripts/compare-portrait-jawbone-exports.py \
  "$ROOT/qcut-before/report.json" "$ROOT/qcut-current/report.json" \
  "$ROOT/jianying/manifest.json" "$ROOT/comparison"
python3 -m unittest discover -s scripts/__tests__ -p 'test_portrait*.py'
bun test electron/__tests__/jianying-portrait-adjustment.test.ts
```

旧版对照需保留修复前编译的宿主，再通过 `QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST` 指向它运行同一 E2E；不要为采集旧结果回滚当前工作区。剪映四档需真实操作导出，manifest 不能代替视频证据。

剪映每次真实导出时，在 `capture.json` 记录 `source`、`sourceSha256`、`samples`（每项包含 `name`、`values`、`exportPath`）及 `errors`。立即运行上面的指纹命令生成新 manifest，它保留人工记录的参数并绑定视频字节，不验证这些参数是否真的应用于画面。QCut E2E 则在导出时直接记录 `exportSha256`。比较器在解码前拒绝缺失或不匹配的指纹；旧证据不再直接通过，也不应事后补哈希冒充采集时的绑定，应重新采集。指纹命令不会覆盖旧 manifest，也不会接受已绑定后发生变化的视频。

原始照片、截图、导出视频、模型和第三方二进制仍只留本机，不提交 Git。尚未验证无遮挡正脸、更多脸型、真实运动、多人、其他运行库版本或 Windows/x86。流畅脸、下颌线、小脸及五种肤色色板的既有缺口没有被本修复解决。
