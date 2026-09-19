# 第五阶段：ONNX 平台合约、公开 CI 与本地 x86_64 回放

日期：2026-09-19。分支 `codex/local-neural-model-audit-20260919`，延续 PR #477。
本文只记录平台测试与 workflow，不把合成图结果当作私有模型或产品验收。五个代码/workflow 文件已按单文件提交推送。

## 验收口径

必须区分三种证据，不能互相替代：

1. **公开合成图**：自行构造小图、初始化参数和 NumPy 期望值，验证标准算子与执行合约；可以在 GitHub 执行，不包含恢复模型。
2. **本地私有模型回放**：使用已有 19 份 ONNX 和冻结 PyTorch 张量，在其他 ABI 的 ORT 中比较；不等于在目标平台重新调用厂商原生 oracle。
3. **产品或媒体 E2E**：编辑器前处理、状态生命周期、导出和质量验收属于其他子任务，本 CI 不做这些承诺。

新增的五张合成图不计入神经网络数量。合成报告固定标注 `evidence_scope=authored-synthetic-only`、`private_models_tested=0`。

## 实际完成

| 环境 | 合成回归 | 合成图执行 | 私有 19 图 | 限制 |
| --- | --- | --- | --- | --- |
| macOS 26.6.2 ARM64，Python 3.12.12 | 33/33，无跳过 | 36 数值 case + 20 重载/重置 + 5 独立 CLI，全部通过 | 沿用第四阶段，不在本表重复计数 | 全新独立环境，没有安装或导入 Torch |
| Linux ARM64，Python 3.13.5 | 33/33，无跳过 | 同上，全部通过 | 沿用第四阶段 | 本机 Docker Linux VM，断网执行 |
| Linux x86_64，Python 3.13.5 | 33/33，无跳过 | 同上，全部通过 | **19/19 图、76/76 case 通过** | AMD64 镜像在 ARM 宿主运行，不是独立 Intel 物理机 |
| Windows x64，Python 3.12.10 | GitHub 实际 33/33 通过 | 36 数值 case + 20 重载/重置 + 5 CLI 通过 | **未验证** | 只运行自行编写的合成图 |
| macOS Intel | 不进入当前固定依赖矩阵 | 不支持当前 wheel 安装方案 | 未验证 | ORT 1.30.0 没有 macOS x86_64 wheel |

三个已执行合成环境使用相同的五个模型 SHA-256，全部数值 case 最大绝对误差均为 `2.384185791015625e-7`。
固定合成判定为 `abs(actual-reference) <= 1e-6 + 1e-6*abs(reference)`；INT16 与 scalar 要求字节一致，包含负零。
这些只是小型合成图的严格阈值，不修改私有模型既有的 `1e-4 + 1e-4*abs(reference)` 门槛。

本轮还在已有 Torch 环境预先导入 `torch` 后独立执行这 33 项单测，全部通过，确保它们可参加全仓库发现式回归；这不把该环境冒充无 Torch 部署环境。

## 公开测试覆盖

| 图 | 标准 ONNX 算子与期望值 | case |
| --- | --- | ---: |
| `conv-relu-nearest` | 有偏置 Conv、非对称 padding、stride、ReLU、nearest/asymmetric/floor Resize；逐元素 NumPy 卷积参考 | 3 |
| `grouped-dilated-linear` | 分组及膨胀 Conv、ReLU、linear/half_pixel Resize；独立双线性插值参考 | 3 |
| `explicit-two-state` | MatMul、Add、Tanh、Mul；24 帧连续回灌 hidden 和 memory，再重新加载并按不同顺序重置输入状态 | 24 |
| `int16-floor-saturation` | INT16 转 DOUBLE、MatMul、Div、Floor、Clip、转回 INT16；两端饱和及负数小数向下取整 | 3 |
| `scalar-identity` | 零维 FLOAT Identity，含正零、负零、负数 | 3 |

循环图是自行编写的状态接口测试，不是假称恢复出的 GRU。INT16 图也不是完整跟踪子网，只测试宽位算术、取整和饱和组合。
每张图另有 4 组独立重载/状态重置，以及 1 次实际 `onnx_infer.py` 子进程调用。执行器必须保持输入未被原地修改。

33 项合成回归包含：

- 候选/失败状态默认拒绝，显式研究 bypass 类型检查；错误数值候选不可晋升为可用合同。
- 模型 SHA 不匹配、文件损坏、相对和绝对路径越界、外部 tensor/自定义算子声明拒绝。
- 名称、rank、维度、dtype、finite、range、线程数、张量大小边界及非连续内存输入。
- 不覆盖已有输出或输入；含空格及中文路径的实际 CLI 回放。
- 非有限输出、INT16 一位差异、标量负零差异不得判定成功。
- NPZ 非有限值、object、错误 dtype、空集合、重复成员及过多成员拒绝。
- 错误 OS/架构、存在 Torch 的目标环境必须留下失败报告；报告目录不覆盖。

软链接拒绝分支用替身触发以避免依赖 Windows 建链权限；本轮不声称完整验证 Windows NTFS junction/reparse-point 行为。
所有图是内嵌参数、标准域、opset 18 / IR 10。CPUExecutionProvider 显式固定，图优化关闭。

## GitHub Actions

实际运行 [35427584529](https://github.com/Quriosity-agent/qcut/actions/runs/35427584529)，提交 `6786b918f27e927b6322fb108ea28f9a84e0d021`：Windows x64、Linux x64、Linux ARM64、macOS ARM64 四个 job 全部成功。每个平台 33 项单测和五图套件通过；四份报告已下载到私有 `phase5-platform/github-35427584529/`。本结果不代表后续提交的所有仓库 CI 已通过。

真正的 Git 根目录是 `qcut/` 的上一级目录；workflow 位于其 `.github/workflows/local-model-onnx.yml`，不是 QCut 子目录内的同名路径。

矩阵为：

| Runner | Python 架构 | 运行期校验 |
| --- | --- | --- |
| `ubuntu-24.04` | x64 | Linux / x86_64 |
| `windows-2025` | x64 | Windows / x86_64，接受 `AMD64` 系统别名 |
| `macos-15` | arm64 | Darwin / arm64 |
| `ubuntu-24.04-arm` | arm64 | Linux / arm64，接受 `aarch64` 系统别名 |

采用仓库已有的 Actions v6 习惯，CI Python 固定 `3.12.10`；NumPy `2.5.3` 和 ORT `1.30.0` 来自现有 `requirements-onnx-runtime.txt`，ONNX `1.23.0` 直接读取 `requirements-onnx-export.txt` 的单独锁定行。**不安装完整 export requirements，不安装 Torch。**
交接前核对 [setup-python 官方构建清单](https://github.com/actions/python-versions/blob/main/versions-manifest.json)：本机采用的 `3.12.12` 只有 Linux 构建，不能直接用于该 Windows/macOS 矩阵；`3.12.10` 覆盖上述全部 OS/架构，因此使用可安装的精确版本，而不是依赖 Runner 上碰巧存在某个解释器。
传递依赖遵循上游约束，并未新建完整传递锁文件。与后续模型部署版本变更一起维护，而不是悄悄降级某一平台的 ORT。

工作目录固定 `qcut`，PR 到 master、master push 和手动派发可触发。修改 ONNX Python、两份依赖或本 workflow 才触发；15 分钟上限，各平台独立报告失败，不设置 continue-on-error。
启用只读仓库权限、checkout 不保留凭据、同一 PR 新运行取消旧运行。`actionlint v1.7.11` 实际校验通过。

上传目标只有明确的一份合成 `report.json`，保留 7 天。没有通配上传 `.local/`，不上传 `.onnx`、`.pt`、NPZ、媒体或任何私有输出；没有私有路径输入、下载私有模型或调用原生库的 CI 步骤。
它不依赖还在变化的 `shot_video`/`shot_postprocess`，父任务可在这些公共测试稳定后协调接入。

ORT 固定版本确实提供 Windows x64 wheel，本机 `uv --dry-run --python-platform x86_64-pc-windows-msvc --python-version 3.12 --only-binary=:all:` 解析通过。macOS Intel 同一锁定方案解析失败，因没有匹配的 ORT wheel；不能用 ARM Runner 的成功代替它。[ORT 1.30.0 发布文件](https://pypi.org/project/onnxruntime/1.30.0/#files)

## 本地私有 x86_64 证据

使用已存在镜像 `ghcr.io/quriosity-agent/wzrdagentstudio-daytona-agent:test-20260611`，镜像 ID：

```text
sha256:f80239d0ec3ed8c03fe242110879abe252528404b613fae61ab976bab0986b1d
```

实际系统 `Linux-6.12.76-linuxkit-x86_64-with-glibc2.41`，Python 3.13.5，ORT 1.30.0、NumPy 2.5.3；未安装 Torch。
目标 ABI wheel 由 uv 下载到独立目录，不拷贝 macOS 虚拟环境。容器断网、根文件系统只读、无 capabilities、no-new-privileges、2 CPU / 4 GiB 限制。
只读挂载代码、ONNX 与冻结 NPZ；不挂载厂商原生库、PT 或原始模型容器。

19 图的 76 组完整输出均满足已有门槛；最大绝对误差 `0.0001220703125`，相关元素仍满足同一混合容差，不宣称所有绝对误差小于 `1e-4`。
12 组为全部输出逐值完全一致，其他浮点 case 仍按既有容差判定。未切换 provider 或启用优化以掩盖差异。
这是第四阶段四组/图冻结数据的复测，不是新增 76 组原生 oracle，更不是 Windows 私有回放。

尝试拉取 `python:3.12.12-slim` 的 AMD64 镜像时，Docker 凭据助手没有返回；有界等待后只停止了本次拉取及它自己的助手进程，没有修改 Docker 配置、凭据或外部账户。使用已有 AMD64 镜像完成了实际验证。

## 代码与本地证据

| 路径 | 责任 |
| --- | --- |
| `onnx_platform_fixtures.py` | 自行构造图、独立 NumPy 参考、候选合同 |
| `onnx_platform_checks.py` | 数值晋升、状态回灌/重置、独立 CLI |
| `onnx_platform_test.py` | 33 项纯 NumPy/ORT/ONNX 回归 |
| `onnx_platform_suite.py` | 平台检查、批次失败门槛、报告 |
| Git 根 `.github/workflows/local-model-onnx.yml` | 四平台公开合成 CI |

本地证据根为 QCut 工作区内 `.local/jianying-model-pytorch/phase5-platform/`，已在既有 Git ignore 范围中：

- `macos-arm64-final/report.json`、`linux-arm64-final/report.json`、`linux-x86_64-final/report.json`：最终合成报告；各目录保留实际生成的小图、张量与 `unittest.log`。
- `linux-x86_64-private19/report.json`：19 图 / 76 组私有回放；输出 NPZ 保留在同目录各模型子目录。
- `runtime-venv/`：本机无 Torch Python 3.12.12 环境。
- `linux-{arm64,x86_64}-deps/`：目标 CPython 3.13 的公共 wheels 安装目录。
- 带 `debug`、`no-torch`、`synthetic` 名称的预跑结果保留，不计作额外独立覆盖数。

本机合成复现，必须使用新的输出目录：

```sh
.local/jianying-model-pytorch/phase5-platform/runtime-venv/bin/python \
  research/local-model-pytorch/onnx_platform_suite.py \
  --out .local/jianying-model-pytorch/phase5-platform/macos-new-run \
  --require-no-torch --expected-system Darwin --expected-machine arm64
```

实际私有 x64 命令，从 QCut 工作区运行；新的 `--out` 目录不能已有结果：

```sh
docker run --rm --platform linux/amd64 --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 4g \
  --tmpfs /tmp:rw,size=64m \
  -e PYTHONPATH=/deps:/runner -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$PWD/.local/jianying-model-pytorch/phase5-platform/linux-x86_64-deps:/deps:ro" \
  -v "$PWD/research/local-model-pytorch:/runner:ro" \
  -v "$PWD/.local/jianying-model-pytorch/onnx-phase4:/models:ro" \
  -v "$PWD/.local/jianying-model-pytorch/phase5-platform:/results" \
  --entrypoint python3 \
  ghcr.io/quriosity-agent/wzrdagentstudio-daytona-agent:test-20260611 \
  /runner/onnx_replay.py --root /models --out /results/linux-x86_64-private-new \
  --require-no-torch
```

把入口改为 `onnx_platform_suite.py`、移除 `/models` 挂载，并传入新的输出目录及 `--expected-system Linux --expected-machine x86_64`，即可复测公开合成链。

## 下一步门槛

- 四个实际远端 job 已通过；后续提交仍须观察新运行，不能把 QCut build 的其他失败混成本矩阵结果。
- Windows x64 私有回放只在有授权的本地/受控机器运行，复用相同 artifact/input hash；绝不能为了 CI 全绿而上传私有权重。
- macOS Intel 需要明确选择并重新验收一个可获得的 ORT 构建；当前版本没有 wheel，不能默认偷偷降级。
- 把稳定后的公共 shot 前后处理回归纳入 CI，继续单独跟踪真实视频、编辑器及导出验证。

官方依据：[GitHub Runner 架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[setup-python 版本及架构参数](https://github.com/actions/setup-python)、[ONNX Resize 语义](https://onnx.ai/onnx/operators/onnx__Resize.html)、[ORT 安装](https://onnxruntime.ai/docs/install/)。
