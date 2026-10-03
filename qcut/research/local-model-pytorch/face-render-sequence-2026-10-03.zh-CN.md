# 连续换图与参数切换的真实宿主回归

日期：2026-10-03。分支：`codex/kpop-beauty-v6`。

目的：在同一个持久宿主内换图、丢脸和切换参数，检查真实渲染链的重复性。
不是独立分析替换测试，不是剪映 GUI 导出与 QCut 的全功能对齐验收。

## 实现

`face_render_sequence_probe.py` 复用产品原始宿主编译器及 `NativeHost` 通信。
一个版本 1 的 manifest 包含 1-24 帧，每帧有本地图片、0-60 秒有限时间戳、参数对象、
可选 `expect_change` 和标签。所有图片尺寸一致，每边 1-4096 像素。
允许重复或倒退时间，用来复现编辑器 seek，而不是假装只有顺序播放。

执行流程：

```text
检查 manifest / 图片 / 参数与路径
  -> 私有目录保存解码输入和来源哈希
  -> SHA/UUID 锁定 core、AGFX
  -> 编译原产品宿主
  -> 新进程 A：依次发送 manifest 全部请求
  -> 新进程 B：再次发送完全相同请求
  -> 每个请求检查 READY/RESULT、字节数、退出码
  -> 对应帧 RGBA 精确比较，包括 alpha
  -> 保存输出、相对输入灰度差分、跨进程灰度差分和报告
```

源文件、manifest、图片、解码输入和宿主二进制均有执行前后身份检查。
原生日志有行长/总量限制；阻塞、错误响应、缺失帧、变更来源、异常退出均为失败。
不会把 SIGSEGV 或“文件已经存在”当作通过。失败时保留 `passed=false` 和错误阶段。
图片、模型、效果包和日志仅存私有 `.local/jianying-model-pytorch`。

`expect_change=true` 要求参数中存在非零效果值，并且输出确实不同于输入。
face/track id 不算效果强度；无脸和零效果允许合法不变，不能让负控制导致假失败。
重复性一致也不等于每个有状态输出都符合创作预期。

## 本轮真实结果

core 与 AGFX 使用 [所有权审计](face-owned-result-2026-10-03.zh-CN.md) 的相同 SHA/UUID。
源图是成人正面生成头像，1448x1086，PNG SHA-256：
`5c76fa2eb885de93c1d034b1918d61f94cdaf97a2e1b3f25ce4c68ba3c1b31f9`。
只调用本地原生大眼效果，不调用付费生成服务。

| 顺序 | 输入/参数 | 相对输入变化像素 | 最大 RGBA 差 | 两个新进程的对应帧 |
| --- | --- | ---: | ---: | --- |
| 1 | 原正面脸，强度 1 | 43893 | 214 | 精确一致 |
| 2 | 水平平移，强度 1 | 43838 | 237 | 精确一致 |
| 3 | 水平镜像，强度 1 | 44035 | 223 | 精确一致 |
| 4 | 无脸灰色帧，强度 1 | 0 | 0 | 精确一致 |
| 5 | 原图恢复，强度 1 | 43698 | 235 | 精确一致 |
| 6 | 原图，强度 0 | 0 | 0 | 精确一致 |
| 7 | 原图，强度 0.5 | 42469 | 171 | 精确一致 |

`passed=true`，14 个真实请求成功，7 个跨进程精确比较通过。
镜像输出和对应增益 8 灰度图已目视检查，变化集中在眼部。
恢复帧没有遗留空脸状态，强度 0 没有遗留上次非零效果。

第一帧与恢复帧的变化统计并不完全相同：原生分析有跟踪历史，
本轮验证的是两次相同历史的对应帧，而不是宣布恢复结果必须等于另一条冷启动历史。
尚未对这种历史差异做独立算法验收或长期真实视频验证。

证据目录：

- `.local/jianying-model-pytorch/face-sequence-fixture-20261003-r1/`：7 帧输入、manifest、来源记录。
- `.local/jianying-model-pytorch/face-sequence-native-20261003-r1/`：两路输出、逐帧两种灰度差分、日志及 `report.json`。

## 测试与复现

`face_render_sequence_probe_test.py` 的 35 项测试无需 Pillow、NumPy、厂商库或 site-packages：
覆盖协议、输入边界、非法时间/参数、尺寸变化、输出覆盖、来源变更、原生错误/崩溃/日志异常、
超时清理、增益差分及退出状态。不以模拟宿主测试代替上面的真实执行。

```bash
cd research/local-model-pytorch
python3 -S -B -m unittest face_render_sequence_probe_test
```

生成新的私有测试输入，不改动源图：

```bash
PYTHONPATH=research/local-model-pytorch python3 -B -c \
  'import sys; from pathlib import Path; from face_render_sequence_probe import make_fixture; print(make_fixture(image=Path(sys.argv[1]), out=None))' \
  "$IMAGE"
```

运行打印出的 manifest 路径，每次使用新的输出目录：

```bash
python3 research/local-model-pytorch/face_render_sequence_probe.py \
  --runtime "$RUNTIME" --package "$PACKAGE" --manifest "$MANIFEST" \
  --expect-change --out .local/jianying-model-pytorch/face-sequence-fresh
```

## 下一步

同一个 manifest 应用于“完整外部结果绑定”的隔离宿主。
先同值逐像素一致，再受控改变眼点验证消费；之后才禁用原生推理。
多脸身份、240 点、遮罩、美妆、长视频、Windows/x86 与编辑器预览/导出尚未被本组测试覆盖。
报告保留 `native_analysis_bypassed=false`，不要把两个原宿主一致写成 QCut 独立分析已完成。
