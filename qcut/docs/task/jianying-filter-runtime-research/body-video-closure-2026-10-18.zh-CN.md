# 单人动态美体闭环验收（2026-10-18）

<!-- markdownlint-disable MD013 -->

**状态：** 进行中（本文随证据产出更新）
**分支：** `body-video-close-1018`（基于 master `c14e3a61f`）
**证据目录（仓库外，不进 git）：** `.local/jianying-parity/body-video-close-20261018/`
**对照页：** `…/threeway/report/index.html`（原图 / 原生 / 自研 / 差分 + 完整视频 + 最差帧说明）

## 1. 场景锁定

| 项 | 值 |
| --- | --- |
| 素材 | `beach-woman-1080-source.mp4`，1080×1920，23.976 fps，316 帧；sha256 `d1f6593f…`（完整值见 `scenario-lock.json`） |
| 时间线 | 0–6 s，30 fps，**180 帧**；一条干净片段，无关键帧、裁剪、转场 |
| 内容 | 真实单人：走动、转身；初始全身，后半身到腰部以上（10-15 素材审计） |
| 参数 | `body_adjust_SlimBody: 40`，`body_adjust_StretchLeg: 30`（与 `portrait-independent-body-video.e2e.ts` 已测组合一致） |
| 自研引擎 | runtime manifest `948ccb1c…`，body-face-video policy `b5b99053…` |
| 原生 | 本机剪映运行时（`jianying-local-swing-v1`），inspect `state=ready` |

30 fps 时间线在 23.976 fps 源上会重复帧，不增加时间细节；这与 10-15 轮一致，是产品里的真实路径。

## 2. 方法

### 2.1 三方对照（第 1–3 步）

`apps/web/src/test/e2e/body-video-close-threeway.e2e.ts`：同一条片段依次以 untouched / native / independent 三种设置走**真实导出**（muxer 引擎，与产品相同），每路：

- 180 帧 MP4；
- 16 个采样帧（0,12,…,179）的**编码前导出画布 PNG**；
- 同一批采样帧**暂停后已提交的 canvas-composition 预览 PNG**（真实预览画布，不是缓存键比较）。

untouched 这一路没有 composition plan，预览走普通 video 路径，没有 composition 画布可读；它只保留导出帧作为原图参照。≤1 色阶的预览↔导出判定针对原生与自研两路。

`scripts/body-video-close-report.py` 解码三路 MP4 做全 180 帧统计（效果量、原生↔自研误差、残差跳变、身体区域是否被改变），编码前 PNG 样本做 ≤1 判定与原生↔自研无编码器对照，并生成对照页。

### 2.2 操作不变性（第 4 步）

`apps/web/src/test/e2e/portrait-independent-body-video-close.e2e.ts`：以顺序导出为基准，依次验证倒序跳播（缓存不变）、清缓存重算、导出进行中取消、**计算进行中 worker 被杀**、进程重启（带缓存 / 清缓存）后 180 帧 framemd5 全部一致。

## 3. 代码发现与修复

### 3.1 计算进行中 worker 丢失会让导出失败（已修，待 E2E 证明）

阅读 `beauty-lab-independent-worker.ts`：常驻 worker 退出时，**正在处理的请求被以通用错误拒绝**，下一次请求才会懒启动新 worker；`beauty-lab-independent-body-video.ts` 只把 `IndependentSequenceGapError` 转成 `replay`，其它错误直接抛出 → 导出中断。原有 E2E 的杀进程发生在导出完成之后，所以没覆盖到。

修复：worker 模块新增 `IndependentWorkerExitedError`（区分「自己死掉」与「有原因的 stop」）；会话渲染器在收到该错误时**重提交一次**——新 worker 没有会话历史，会按既有协议回复 gap → `replay`，渲染端已经会从检查点重放。连续两次死亡原样抛出。单测：`beauty-lab-independent-worker.test.ts`、`beauty-lab-independent-body-video.test.ts`。

### 3.2 harness 两个坑

- 原图路径没有 composition 画布（见 2.1），采集预览会等满 300 s 超时 → 改为按路径决定是否采集预览。
- 原生 inspect 结果没有顶层 `ready`，就绪判定是 `state === "ready" && available`。

## 4. 结果

（待三方与不变性 E2E 产出后填写：逐帧误差分布、最差帧与跳变帧、身体区域检查、预览↔导出最大色阶差、六项不变性结论。）

## 5. 未覆盖 / 后续

- 多人、遮挡与背景保护；
- 实时播放性能；
- 手动拉长／瘦身剩余误差（整帧亚像素 base 重采样未复现，见 independent-manual-stretch 文档）；
- 原版模型权重替换。
