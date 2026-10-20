# 1080p 美体连续效果预览

日期：2026-10-20。分支：`codex/body-playback-preview-1020`。

本轮补上“先准备效果画面，再连续播放”的编辑器路径。准备阶段复用导出合成器，
将全分辨率画面保存为无损 PNG；播放阶段读取已准备画面，避免逐次播放重复推理。
自研 180 帧完整操作验收的 8 项检查通过；最新双路解码实现的 180 帧复核
另有 5 项通过，轻量观测播放 6 秒素材耗时 6.002 秒。
产品默认原生 180 帧验证的 5 项检查也通过，轻量观测耗时 6.002 秒。
两条路径的缓存均与各自导出完全一致；原生与自研之间仍有画面差异。

使用时，在支持的时间线视频上启用人像或美体效果，点击预览区的
“准备效果预览”。准备完成后用正常播放按钮观看；修改参数会使旧缓存
失效，需要重新准备。准备过程中可以取消，已准备好的画面也可以关闭。

## 实现与适用范围

| 层级 | 实现 |
| --- | --- |
| 合成 | `canvas-composition-frame.ts` 的可复用 renderer 直接调用导出 `renderFrame`，保留项目尺寸、帧率、时间线快照与合成设置，复用 canvas 和顺序视频解码资源 |
| 准备 | `use-canvas-playback-preview.ts` 按帧串行渲染和落盘，全部成功且 renderer 释放后才发布 ready；新一轮等待旧任务收尾 |
| 播放 | `effect-playback-preview.tsx` 使用原有播放时钟和帧索引显示缓存 canvas；缺帧时暂停并缓冲，准备完成后继续 |
| 存储 | `canvas-composition-playback-cache.ts` 管理 OPFS 中每代全分辨率 PNG |
| 解码 | `canvas-composition-playback-reader.ts` 最多并行解码 2 帧，共用有界 ImageBitmap 预算；跳播淘汰旧图，迟到结果立即关闭 |
| 后端 | `beauty-lab-independent-body-video.ts` 与 handler 补齐请求身份计算、磁盘查找和入队前的取消；继续使用既有 worker、序列缓存和历史恢复 |

入口要求可见画面均为有可用 URL 的视频，且存在视觉编辑或受支持的 canvas 转场。
尺寸每边为 2–4096，总像素不超过 8,294,400，帧率大于 0 且不超过 240。
原生人像仍须满足既有 source-window 与预滚读取条件。

当前排除可见文字、图片、贴纸、未支持或原包转场、透视、色度抠像、
自定义抠像、入出场／组合动画、增强与插帧。UI 也排除模糊背景、
扩展预览、蒙版／取色／贴纸交互、拖动、叠加贴纸、独立特效层、
录屏缩放／光标覆盖和录屏背景。因此当前入口不代表所有编辑器组合均已覆盖。

参数、工程、时间线、尺寸、背景等变化使当前代失效。合成器额外读取的
特效、贴纸、录屏、摄像头与标注 store 只订阅影响画面的字段；
选择状态等界面变化不触发重做。导出会取消正在准备的任务，
保留已完成缓存，导出期间不能新建准备任务。

## 取消与原生时序

准备、改参和取消均暂停播放；旧代后续结果不能重新覆盖当前画面。
取消发生在身份计算、缓存查询或排队时，不再向 worker 提交新帧。
已经提交且成功的帧仍完成并写入既有引擎缓存，因为跟踪历史可能已经推进；
前端丢弃取消代的结果。取消请求不会触发崩溃后的额外重试。

没有修改 Python 美体算法、模型、跟踪更新次数、初始化、RESET_PARAMS、
checkpoint 或历史重放规则。播放准备沿用此前验证的导出规则，
没有通过重复目标帧、额外迭代或切换参考配置来减少原生差分。

## 资源与磁盘边界

- 每代 OPFS 缓存最多 **2 GiB 压缩 PNG**；这是单代预算，不是全应用磁盘或内存上限。
  文件写入关闭后才计入完成，读取检查文件大小，解码检查画面尺寸。
- 解码缓存最多 **6 帧且不超过 64 MiB RGBA**，在途解码也计入预算。
  1080 × 1920 每帧 8,294,400 字节，6 帧约 47.46 MiB。
  跳播后旧解码必须实际结束才能释放预约槽位，双路解码不会突破容量。
  这不包含 canvas、浏览器解码器、GPU、引擎模型或测试截图的额外内存。
- OPFS 读写和销毁串行；退出、取消、跳播关闭对应 bitmap。
  删除失败保留实际字节统计、记录警告，不声称空间已释放。
- 新代创建前通过 Web Locks 回收无人持有的受管理旧目录；
  其他窗口仍持锁的目录保留。无 Web Locks 时告警并禁用崩溃残留回收，
  未管理或旧版目录也保留并告警。真实磁盘耗尽、跨进程崩溃压力仍需扩展验收。

OPFS 保存的是整帧最终合成结果，区别于 Electron 既有的美体引擎帧缓存。
播放命中 OPFS 时不再发起美体推理。PNG 无损性由重新解码后与导出编码前
RGBA 摘要逐帧比较验证；生产读取不执行逐帧密码学完整性校验。

## 当前验证结果

证据根目录为主工作区 `.local/body-playback-20261020/`。
`final-180-r1/e2e-evidence.json` 状态 `passed`，8 项检查通过。
这是串行 reader 的 r3 构建，素材为单人无声竖屏，1080 × 1920，
30 fps，6 秒／180 帧；智能美体瘦身 40、长腿 30，改参为瘦身 55。

| 检查 | 已核实结果 |
| --- | --- |
| OPFS 与导出 | 基线、改参各 180/180 帧重新解码后，与同索引编码前导出 RGBA SHA-256 完全相同 |
| 连续播放 | 基线、重复播放、改参播放捕获的所有画面均与对应导出相同 |
| 缓存复用 | 三次播放期间 worker completed 计数均未增加 |
| 准备后跳播 | 第 178、1、90 帧与对应导出相同 |
| 改参中取消 | 第 1 帧仍在 worker pending 时收到取消 IPC，返回 true；迟到展示 0 帧 |
| 手动取消 | 同样命中处理中的第 1 帧；迟到展示 0 帧 |
| 解码预算 | 三次播放观测峰值均为 5 帧、41,472,000 字节，低于配置上限 |
| 异常记录 | 页面异常 0；保留 HTTP 401／404 资源错误记录，不据此宣称网络功能验收 |

串行 reader 暴露了 PNG 解码供给不足：r3 基线播放 6 秒素材耗时 8.170 秒，
总捕获 179 帧，其中播放中 157 帧，其余在缓冲暂停期间展示。
随后保持相同像素、容量和取消规则，将解码并发提高到最多 2 帧。

最新 `decoder-180-r4/e2e-evidence.json` 状态 `passed`，5 项检查通过。
它重新打开前次测试保存的瘦身 55／长腿 30 工程，以前次 `changed`
完整导出的 180 帧摘要为参考，核对引擎清单后重新准备；没有重新导出，
也没有重复完整取消矩阵，不能把这项复核称为新一次完整导出验收。

| 最新 r4 复核 | 已核实结果 |
| --- | --- |
| 完整缓存像素 | 新 OPFS 的 180/180 帧均与先前同索引导出 RGBA SHA-256 相同 |
| 实际展示像素 | 完整 RGBA 采证捕获 179 个不同帧，其中播放中 178 帧；全部匹配参考，播放耗时 6.062405 秒 |
| 轻量播放观测 | 6.001620 秒；179 帧在播放中展示，暂停时展示 0 帧；29.825 fps，覆盖率 99.44% |
| 缓存与跳播 | 播放期间 worker completed 为 0 → 0；跳到第 90 帧与参考相同 |
| 资源 | 解码峰值 6 帧／49,766,400 字节；OPFS 632,434,107 字节 |
| 准备与异常 | 准备 36.194 秒，worker completed 为 0 → 0；页面异常和控制台错误均为 0 |

r4 的轻量观测不复制或散列全帧 RGBA；另一次完整像素采证负责逐帧核对。
r3 基线与 r4 使用不同参数和采证条件，因此上述时间只说明发现并修复了
串行解码瓶颈，不构成受控前后性能基准，也不保证所有素材稳定 30 fps。
36.194 秒是**引擎缓存已暖后的合成、编码和落盘耗时**，不能解释为冷推理提速。
最新构建、119 项相关前端测试及 165 项 Electron 测试通过。

`native-180-r1/e2e-evidence.json` 状态 `passed`，5 项检查通过。
它使用产品默认 Swing／CoreML、瘦身 40／长腿 30，完整导出并重新准备 180 帧。

| 产品默认原生 | 已核实结果 |
| --- | --- |
| 完整缓存像素 | 180/180 帧与同索引编码前导出 RGBA SHA-256 相同 |
| 实际展示像素 | 完整 RGBA 采证捕获 178 个不同帧，全部匹配对应导出；播放耗时 6.062295 秒 |
| 轻量播放观测 | 6.002245 秒；第 1–179 帧全部在播放中展示，暂停时展示 0 帧；29.822 fps |
| 资源 | 解码峰值 6 帧／49,766,400 字节；OPFS 631,808,386 字节 |
| 耗时 | 完整导出 700.101 秒，重新准备缓存 699.237 秒；不是实时原生推理 |
| 缓存所有权 | 终止持有缓存锁的浏览器 Worker 后，新准备回收其孤儿目录，另一仍持锁的目录保留 |
| 异常记录 | 页面异常 0；保留 24 条 HTTP 401 资源错误，不据此宣称网络功能验收 |

缓存所有权探针没有杀死 Electron 渲染进程或美体引擎，不能解释为这些进程
完整崩溃恢复已在本轮重新验收。原生取消与引擎崩溃恢复也未在这项测试中执行。
两条路径的轻量计时均在播放前已显示第 0 帧，然后连续展示第 1–179 帧。
完整像素采证与轻量计时分开运行，避免读取全帧 RGBA 扰动帧率。

最终本地对比页为 `.local/body-playback-20261020/index.html`，包含原图、
本轮原生、自研、改参导出、实际播放器截图、静帧差分与完整视频差分。
原图复用上一轮锁定的相同素材、尺寸、帧率和时长的无效果导出；
两条效果视频为本轮新生成。本轮全部 180 帧解码后的原生／自研平均 RGB 差
为 **6.205300871** 色阶，最大单通道差 **192**；该视频数值包含编码误差。
三张编码前静帧也分别报告差值。本轮自研基线导出的 180 帧编码前摘要
与上一轮相同配置全部一致，播放改动没有改变已验证的算法输出。

## 原生对齐与剩余缺口

此前受控 **Bef 效果图／modern skeleton CPU／warm-reset** 探针
60/60 帧与自研 RGBA 相同；产品默认 **Swing／CoreML／cold-start**
仍有差异，平均 RGB 差 3.669544、最大单通道差 192。
此前编辑器 180 帧三方对照平均 RGB 差为 6.205301。
两组配置、历史和预滚不同，不能把这些数字当作改进前后比较。
本轮再次测得相同量级的画面差异，没有缩小这项算法差距，见
[既有编辑器闭环](body-editor-closure-2026-10-20.zh-CN.md) 与
[原生运行配置](../../../research/jianying-runtime-probe/BODY_VIDEO_PROFILES.md)。

还需优化冷启动整段准备速度，扩展稳定呈现帧率、全部美体参数和手动工具、
多人／遮挡／丢失重获、长片内存及磁盘稳定性、音画同步、复杂编辑组合。
当前短片无音轨，运行前后进程内存采样不构成长时间泄漏验收。
超出单代预算的长片会失败，尚无分段流式准备或跨重启复用整段效果缓存。
自研仍需本地私有模型，尚未达到完全脱离原包模型文件的目标。

## 复现与隐私

在 `qcut/` 包目录先执行 `bun run build`，设置以下环境变量后运行：

```sh
bun x playwright test \
  apps/web/src/test/e2e/portrait-independent-body-playback.e2e.ts \
  --project=electron --workers=1
```

| 环境变量 | 用途 |
| --- | --- |
| `QCUT_E2E_OFFSCREEN=1` | 后台 Electron，避免改变用户焦点 |
| `QCUT_BODY_CLOSE_SOURCE` | 本地 1080 × 1920 源视频绝对路径 |
| `QCUT_BODY_PLAYBACK_OUTPUT` | 本次独立证据目录；已有 evidence JSON 时拒绝覆盖 |
| `QCUT_BODY_PLAYBACK_SECONDS` | smoke 为 2；最终验收为 6 |
| `QCUT_INDEPENDENT_BEAUTY_RUNTIME` | 本地私有引擎运行目录 |
| `QCUT_INDEPENDENT_BEAUTY_PYTHON` | 对应 Python 解释器 |
| `QCUT_API_PORT`、`XDG_STATE_HOME` | 并行运行时分别隔离端口与状态目录 |

最新 reader 复核使用：

```sh
bun x playwright test \
  apps/web/src/test/e2e/portrait-body-playback-recheck.e2e.ts \
  --project=electron --workers=1
```

额外设置 `QCUT_BODY_PLAYBACK_RECHECK_SOURCE` 为已通过的完整 evidence JSON，
`QCUT_BODY_PLAYBACK_RECHECK_PROJECT` 为其中测试 profile 的保存工程 ID，
`QCUT_BODY_PLAYBACK_RECHECK_OUTPUT` 为新目录。源 profile 必须仍在本机，
复核固定为 180 帧，并验证保存参数为瘦身 55／长腿 30。

产品默认原生播放使用：

```sh
bun x playwright test \
  apps/web/src/test/e2e/portrait-native-body-playback.e2e.ts \
  --project=electron --workers=1
```

它要求本机原生 runtime 就绪，沿用源视频、离屏、端口和状态隔离设置；
额外指定 `QCUT_NATIVE_BODY_PLAYBACK_SECONDS=6`、
`QCUT_NATIVE_BODY_PLAYBACK_OUTPUT`。测试保持产品默认 Swing／CoreML，
不注入算法或后端覆盖，不产生原生取消／崩溃恢复验收结论。

素材 SHA-256：
`d1f6593f61723b2a838c8bc962533d192f3071b92f0035a71fa601ca63b471f4`。
r4 复核导入并校验的引擎清单 SHA-256：
`bb7917fab3820b671ff8c667652e43dfce45d40a2cba92d78a783710b29bb8c7`。
导入的 `final-180-r1/e2e-evidence.json` SHA-256：
`884c8fa685ab2e9be585534019eb9991c3ebce336c54bb6d67389fdfc543aa9e`。
r4 Electron 构建 SHA-256：
`9294150c38cf87fbd97ab66d20dc5998f60f9732ff12b131009d67b87b566141`；
前端 index SHA-256：
`3b209a597c6512d891ee608b061c1d8948c743b7f00e34769d499a055df5fc2e`。
evidence 中的 Git HEAD 为基线，运行包含未提交改动，不能单独作为完整构建身份。

关键单测：

```text
apps/web/src/lib/preview/__tests__/canvas-composition-renderer.test.ts
apps/web/src/lib/preview/__tests__/canvas-composition-playback-cache.test.ts
apps/web/src/lib/preview/__tests__/canvas-composition-playback-reader.test.ts
apps/web/src/hooks/preview/__tests__/use-canvas-playback-preview.test.tsx
apps/web/src/components/editor/preview-panel/__tests__/effect-playback-preview.test.tsx
electron/__tests__/beauty-lab-independent-body-video-cancel.test.ts
```

测试覆盖画布串行占用、缓存配额与资源释放、迟到解码、改参失效、
准备期间播放保护、取消、清理失败与旧代隔离。原生三方测试入口仍为
`apps/web/src/test/e2e/body-video-close-threeway.e2e.ts`。
模型、原生库、原包、源媒体与本地 PNG／视频证据均不加入 Git；
提交范围只含自有实现、测试、说明与哈希。

## 附：早期 smoke 诊断

`smoke-60-r1/` 的 60 帧、8 项检查通过，两组缓存各 60/60 帧匹配导出。
基线／重复／改参各有 48 帧在播放中展示，观测为 15.89–16.91 fps，
加上缓冲暂停画面总共捕获 55／56／55 帧，全部像素匹配。
该构建早于最终 store 失效、残留回收和双路解码修复，且首批同步 PNG
采证扰动时序；保留作诊断记录，最新结果以上述三项 180 帧验证为准。
