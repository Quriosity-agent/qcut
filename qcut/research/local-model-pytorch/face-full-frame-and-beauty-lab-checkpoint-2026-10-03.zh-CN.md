# 完整画面预处理与美颜实验室检查点

日期：2026-10-03。分支 `codex/kpop-beauty-v6`，继续 [PR #483](https://github.com/Quriosity-agent/qcut/pull/483)。工作目录 `/Users/peter/Desktop/code/qcut/qcut`。

## Review 修复后的证据状态

以下七帧 ONNX/renderer/UI 验收属于修复前的 `f21eb8ab9828ab47e92024db394ddacb51179e25`，不是当前源码的验收。此次修复 `face_render_consumer_probe.py` 的环境隔离，清除继承的 `QCUT_*`、`DYLD_*`、`MTL_*`，再显式加入本次探针参数；它属于原始 50 source 的哈希保护范围，旧 capture/replay/render/audit/UI 包因此失效。保留所有旧报告原字节和精度门槛，不改哈希伪造新验收。

实际调用当前 Electron provider：历史 `temporal`/`qcut-export` 和 `owned-preprocess` 列表均为空，显式加载旧 owned 包被 `SHA mismatch: local-model-pytorch/face_render_consumer_probe.py` 拒绝。普通输入的原生处理不是此离线记录路径；任意画面 candidate 仍未接通。必须重新采集新源码周期的中立记录，再跑真实 ONNX replay、renderer、CPU audit、UI export 和 Electron E2E，才能恢复这些开发记录。

另已用当前源码启动 fresh 原生宿主，故意继承不存在的 binding replay、错误 eye shift/wait/trace 参数：同值控制及眼部 X ±0.01 三组各四帧、各 18 次转换全部通过，帧 SHA 和指标逐项与旧 R3 完全相同。新证据为 `.local/jianying-model-pytorch/face-owned-binding-review-20261003-r1/report.json`，SHA-256 `6b9d4efacabf93989ec169d9b38479e654d4c92212449cf84ebeeb4b7b7cce64`；已查看三路原图/统一 gain8 差分。该测试证明环境修复未改变这组原生像素，**不替代新七帧 ONNX/UI 验收**。C ABI 另增加真实 C++ 编译执行的异常边界测试，预测/提取异常返回 `-6`，原有成功/错误码不变。

本次本地回归：受影响探针组 101 项、下游组 761 项、Espresso CI 对应组 277 项、Electron 六组 568 项均通过；各组存在重叠，不累加为独立测试总数。当前没有重跑完整产品 E2E，也不以旧 E2E 代替当前源码证据。

## 本轮结论

已把上一轮真实 ONNX/采样/点位/原生 renderer 的固定七帧证据接进美颜实验室，并补独立 CPU 审计、完整画面缩放诊断和真实只读调用栈。不是把离线帧注册为实时候选后端。

- 下游：独立复核 135 个模型输出头、24 次归一化点位转换、七帧最终 RGBA，原有门槛保持不变，最终零差。
- 产品：新增 `owned-preprocess` 只读对照案例，七帧、统一增益灰度、三路图像、指标及 ZIP 在真实 Electron 中验收。
- 上游：1448×1086 → 640×480 的 CPU 控制和五种独立 Metal 候选均不精确；最大单通道差 1，不能放行。
- 依赖：完整画面到 algorithm RGBA、detector/caller geometry/flags/identity/routing、其他遮罩/效果数据及效果 renderer 仍有原生依赖。模型/效果资产也不是因 ONNX 转换而成为自主或可分发资产。
- `available=false`、`state=not-connected` 保留；当前不可对任意上传图片运行新链路，不能宣称全美颜/美体或跨平台已对齐。

## 链路与验收边界

```text
QCut 原始 RGBA / 滑杆
  → 原生完整画面到 algorithm RGBA（当前未独立）
  → 原生 detector / 实际 caller Rect、flags、tracking matrix、身份信号
  → 自有 160 / 120 像素采样
  → ONNX 160 / 120 输出头
  → 自有初始化 seed、解码、时序平滑、坐标回映
  → QCut 自有宿主归一化点位 ABI
  → 同版本原生效果 renderer
  → 最终 RGBA
  → 新 CPU 审计 + 原始报告/字节导出
  → Beauty Lab verified-offline-replay 对照 / 灰度 / ZIP
```

研究 replay 实际使用自有 replacement tensors，非捕获 tensor/native 最终点输入。新 UI provider 只验证并呈现这些已验收记录，不重新执行网络或效果 renderer；UI 像素一致性与模型推理验收是两个不同证据。

仍是同一正脸的 0–0.2 秒短序列：正脸、平移、镜像、无脸、重获、零强度、半强度。两次 160 为同图/同几何的初始化与重获，不能称为多脸型/多人/分钟级测试。format=0、orientation=0，实际 algorithm stride=2560。

## CPU 审计与导出

新增 `face_preprocess_chain_audit.py`：重新计算 160/120 输入、135 原始输出头门槛、seed/解码/时序/回映/replay，并复核真实 renderer 事件、13 次请求和最终像素。没有重新跑推理/原生/GPU，不替代前一轮真实执行。锁定 1,615 个文件身份，原始 50 source 未修改。

新增 `face_preprocess_chain_export.py`：审计器来源必须匹配当前源码，所有报告/replay SHA 必须是合法且匹配的 SHA-256；完整 fixtures 在导出前及结束时验证。报告原字节不重写，目标文件独占创建，不覆盖已有文件或符号链接。私有模型/运行库/效果包不复制进 UI 包。

包 `beauty-owned-chain-ui-20261003-r2/` 含 `index.json`、九份报告、manifest/replay、七帧 input PNG/native RGBA/candidate RGBA。固定相对路径，不授权 JSON 里的绝对路径读取。索引绑定 62 个实际 source 身份，其中保留原始 50 文件保护。

electron provider 分成证据 schema、报告关联校验、文件/像素加载三项职责。仅主进程选定可信目录；IPC 只接受固定 caseId/0–6 帧号。来源/根目录/符号链接/尺寸/文件身份/晚期变化/跨帧篡改拒绝。所有七帧都验证，不会加载一帧就跳过其他帧；逐帧有界快照避免七帧累积超过内存读取上限。

## 完整画面采样诊断

`face_full_frame_metal.mm` 只用 Foundation/Metal，不加载剪映库。独立上传 RGBA8Unorm、半像素归一化 UV、linear clamp sampler；分别测试 float/half 采样、纹理 UNorm 输出和 buffer 截断/四舍五入。另保留有界 float4 原始采样模式作为诊断接口，本轮固定 profile 比较只用五种 uint8 模式。编译开启 `-Wall -Wextra -Werror`。

`face_full_frame_probe.py` 独立处理七个原始画面，对所有 26 次捕获的 algorithm input 比较。捕获图只在候选生成后充当 oracle，不反馈给采样器，不向 ONNX 或产品返回不相同的图。保存每帧原生/候选/灰度 x8 PNG。

prediction 0，307,200 像素的结果：

| 候选 | 变化像素 | 最大通道差 |
| --- | ---: | ---: |
| CPU half-pixel bilinear round 控制 | 88,429 | 1 |
| Metal float → texture UNorm | 81,244 | 1 |
| Metal float → buffer truncate | 191,991 | 1 |
| Metal float → buffer round | 107,859 | 1 |
| Metal half → texture UNorm | 89,499 | 1 |
| Metal half → buffer truncate | 181,358 | 1 |

最终 `completed=true, passed=true` 只表示诊断完成；`sampling_parity=false, exact_modes=[]` 才是算法结论。没有放宽门槛、拟合偏置或把视觉相似说成字节相同。差异尚不能区分 UV、sampler 精度、量化或其他转换。

## 真实调用栈与二进制边界

新增 `face_full_frame_stack_lldb.py` 与 `face_full_frame_stack_probe.py`，复用旧有界硬件观察器。无软件断点、目标内存写入、函数求值或额外 SDK 调用。实际 26 次 algorithm input SHA 与中立 R6 完全相同，七帧最终 RGBA 零差，观察中立性通过。

LLDB 必须先注册旧 callback 模块，再临时替换 Observer，结束恢复；第一轮未注册导致 callback=0，拒绝并保留失败，不当作有效采集。最终以 R3 为准。

运行库为 arm64 `libcccreator.dylib`，UUID `D6342ECD-5432-33F0-A2AD-0C28F5699994`。下面均为未加 ASLR slide 的 file address，不可直接用于其他版本：

```text
SwingManager::seekFrame
 → 0x27823d0 → 0x27838c4
 → AlgorithmManager 0x25df5fc
 → BachAlgorithmService 0xb72428
 → 0xb6e0bc → 0xb6d718 → 0xb6d518
 → 0xba7d00 → 0xb964f4 → 0xcd42a8 → 0xcd4e3c
 → liblens FsNew_DoPredict
```

`0xcd42a8` 取得既有 BachImage，经 `0xbaaa18` 打包描述；data getter `0xbc5ccc` 是 `ldr x0,[x0,#0x60]; ret`。`0xcd4e3c` 把已有像素及 format/width/height/stride/orientation 送进网络。两者不是 resize 或 lazy GPU readback producer，预测入口 stack 中看不到已经返回的 producer。

静态 disassembly 的上游线索：`0x2783c60` 调用 `0x278558c`，内部虚表 slot `+0x48` 的交接发生在 manager preparation `0x25de9b0` 之前。此处有 getNativeBuffer/getId 纹理路径；具体虚函数及真实 shader/readback 尚未关联，不能称为已还原。

下一探针按此顺序，仍只读并要求输入/最终像素中立：

1. `0x27855ac` 读取 `x8`，取得 slot `+0x48` 的实际 target，再静态查看 target。
2. `0x2783c64` / `0x2783eb4` 对比纹理交接/manager preparation 后的实际描述及身份。
3. `0xbc5cd4` / `0xbc5cf0` 读取 BachImage owner、提供的 data 指针及 caller stack；赋值指令在 `0xbc5cec`。
4. `0xbc5d38` 是 calloc 后的另一路分配边界，分配并不证明填充者身份。

`TERLTexture::downloadTextureData` / `TERLFrameBuffer::downloadTextureBuffer` 的符号已找到，但没有实际路由证据；不要据符号直接选一个当实现。

## 本轮测试和失败修复

- Python：31 组、757 项相关回归通过，包含旧 611 项、新审计 31、完整画面/stack 85、导出 30。
- TypeScript：六组 568 项通过，新增 owned provider 60、IPC 10；旧记录、IPC、候选请求/provider 一并回归。
- Electron TypeScript/build、Web TypeScript/Vite build 通过；九个改动 TS/TSX 文件 Biome 检查通过。既有 bundle/route-test 警告不表示跨平台验收。
- 真实 Electron E2E 两项通过，合计 39.9 秒，单 worker 串行：新七帧对照与旧原生/记录/预设/ZIP/窄屏路径。不是 mocked browser API。
- 原生 live 大眼 40：640×480，原图变化 7,900 像素、RGB MAE 0.183674、最大差 78、Alpha 差 0，与旧验收相同。
- 新 UI 七帧原图→结果变化分别为 `43893,43565,44022,0,43698,0,42469`，原生→新链路七帧均 0；无脸/零效果控制通过。
- 最终 E2E 共 15 张 UI 截图、三个 ZIP；已人工查看新对照正脸/无脸/窄屏及上游三列差分。窄屏无水平溢出、时间线未改变、pageErrors 为空，候选状态仍不可用。

负向测试找到并修复：bool/float 与整数相等被接受、空/部分 profile 真空通过、一次 guard 失败被第二次成功覆盖、guard error 掩盖原始执行错误、审计器来源哈希未验证、空 replay SHA 被视为可选。新 `face_diagnostic_report.py` 统一撤销完成/采样/观察标记，保留原始异常并附 guard 错误；旧 50 source 和旧门槛不修改。早期失败和未对齐目录均保留，不覆盖成成功。

## 最终本地证据

以下目录均相对 `.local/jianying-model-pytorch/`，不进 Git：

| 结果 | 路径 | report SHA-256 |
| --- | --- | --- |
| CPU 复核 | `face-preprocess-chain-audit-20261003-r2/report.json` | `0245ff52bf65ecc9570c071cc7da2c5bc61b62d84f8e83c641ed37f752451fad` |
| 独立缩放诊断，未对齐 | `face-full-frame-probe-20261003-r3/report.json` | `0752ba01ef4b5440ef713498dee71e90ba45a0c122d38f525f7c5de4a74f4bc0` |
| 中立真实 stack | `face-full-frame-stack-20261003-r3/report.json` | `d8cd944c9945d63f038e99492cb4dccb2ba1839ab71beb15f78e14316dd3fcc9` |
| UI 导出 | `beauty-owned-chain-ui-20261003-r2/report.json` | `36cd570237463f111c370353612cb9a5cf7cd72bd71069f697bd57d70390dcb4` |

UI 索引 SHA：`46a4b384e480dd9fd6d0e4f5a371364b706232b0a6ded928d181be8e114019dc`。R1/R2 索引相同，因为封装的原始九报告和七帧不变；外层 exporter source/guard 报告不同，不混用。

实际推理/renderer 仍引用前一轮 `face-preprocess-chain-replay-20261003-r4/` 与 `face-preprocess-chain-render-20261003-r4/`；neutral 为 `face-160-preprocess-host-20261003-r6/`。本轮 CPU 审计不是新一次推理，本轮 UI 不是新一次候选渲染。

UI 文件位于：

- `output/playwright/beauty-lab-owned-chain-20261003-r2/`：八张截图、`owned-chain-comparison.zip`、`report.json`。
- `output/playwright/beauty-lab-regression-20261003-r4/`：七张截图、两个 ZIP、`e2e-report.json`。

## 复现

以下命令描述修复前检查点的输入关系；当前源码直接复用这些旧记录会被哈希保护拒绝。先重新采集当前源码的 capture/replay/render，再替换输入目录。输出必须使用新的未存在目录，不覆盖验收证据：

```sh
env PYTHONPATH=research/local-model-pytorch \
  .local/jianying-model-pytorch/face-heads-runtime122/bin/python -B \
  research/local-model-pytorch/face_preprocess_chain_audit.py \
  --capture .local/jianying-model-pytorch/face-160-preprocess-host-20261003-r6 \
  --candidate .local/jianying-model-pytorch/face-preprocess-chain-replay-20261003-r4/replay.json \
  --render .local/jianying-model-pytorch/face-preprocess-chain-render-20261003-r4 \
  --root .local/jianying-model-pytorch/face-heads-20261003-stable-r2 \
  --out .local/jianying-model-pytorch/face-preprocess-chain-audit-next
```

完整画面诊断/stack 分别运行 `face_full_frame_probe.py` / `face_full_frame_stack_probe.py`，参数都是 `--capture` 取上述 R6、`--out` 取独立新目录。stack 会启动串行 fresh 私有宿主，不能并行运行实际 GPU 宿主探针。

UI 导出运行 `face_preprocess_chain_export.py`，复用审计命令的 `--capture/--candidate/--render/--root`，增加 `--audit` 指向通过的审计报告、`--out` 指向新包。当前开发 main.ts 只绑定 R2；更换包需显式修改主进程可信路径及 E2E 前提并重新 build，不从 renderer 传任意路径。

```sh
bun run build:electron
bun --cwd apps/web run build:electron
env QCUT_REAL_PORTRAIT_IMAGE_PATH=/Users/peter/Desktop/code/qcut/qcut/.local/jianying-model-pytorch/face-sequence-fixture-20261003-r1/face.png \
  QCUT_BEAUTY_OWNED_CHAIN_OUTPUT=output/playwright/beauty-lab-owned-next \
  QCUT_BEAUTY_LAB_OUTPUT=output/playwright/beauty-lab-regression-next \
  bunx playwright test beauty-lab-owned-chain.e2e.ts beauty-lab.e2e.ts \
  --project=electron --workers=1 --reporter=line
```

没有私有包时新 E2E 会 skip；skip 不是验收。发行包禁用该开发私有路径。当前使用 app:// 已构建界面测试，没有启动 5173 开发服务器。

## 下一步

先完成上述新源码周期的 capture → ONNX replay → renderer → audit → UI export → Electron E2E，不能给旧记录换哈希。然后取得上游实际虚函数/纹理转换证据，解决 1 灰阶来源，再扩充格式/stride/旋转。原生 detector/caller 数据应成为明确实时输入契约，不能注入 native 最终点伪造自主关键点。

随后接真实任意帧 driver 到候选协议，锁定来源/时间/模型/运行库/效果包，逐阶段同输入对拍后开放实验室按钮，再验证预览/导出。最后扩展嘴/眼/鼻/眉/脸型/美妆/皮肤/美体及组合、多脸型/多人/侧脸/分钟级/Windows/x86。当前只有固定大眼 profile，不应据本轮七帧给其他 90 个参数盖精度通过章。

仍按每个文件单独 commit、每次 push、同分支同 PR。此轮不合并、不触发发行，也不将私有二进制/模型/效果资产提交。
