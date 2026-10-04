# Beauty Lab 开发宿主：修复重复桌面授权

日期：2026-10-04。分支：`codex/beauty-live-hybrid-v7`。PR：[#484](https://github.com/Quriosity-agent/qcut/pull/484)。

## 原因

旧链路每个请求都把 `live-host` 编译到随机 `static-*/audit/` 目录，再由 LLDB/debugserver 启动。
实际 `codesign -d -r- --verbose=4` 显示 `Signature=adhoc`、`TeamIdentifier=not set`，
designated requirement 只有当前二进制的 `cdhash`。新任务路径、重编译后的二进制身份都不稳定。

14:22:29 的系统日志将 `SystemPolicyDesktopFolder` 请求归到独立的 `live-host`，
而不是已经运行的 Electron。采样显示进程停在 dyld 打开文件阶段，尚未进入模型推理。
这是辅助宿主身份/文件访问问题，不是 ONNX 精度失败，也不是屏幕录制或辅助功能权限。

macOS 会追踪负责访问的代码实体；不能假设 Electron 被允许访问桌面，所有调试器启动的后代就共享这个授权。
Apple DTS 也明确提示 ad-hoc 开发签名会给 TCC 带来问题。
参考：[Apple 对责任归属与开发签名的说明](https://developer.apple.com/forums/thread/125438)，
[TN3127 代码签名要求](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)。

## 实现

1. 新增 `research/local-model-pytorch/face_live_host_identity.py`，只用于显式启用的开发版单帧候选。
2. 固定宿主位置为当前仓库的 `.local/jianying-model-pytorch/beauty-live-host/live-host`。
   它仍位于同一个 Desktop 仓库，没有搬出受保护目录规避访问控制。
3. 使用本机可用的 **Apple Development** 证书和固定标识 `com.qcut.beauty-lab.live-host`。
   自动选择仅限恰好一个开发证书；多个证书必须用 `QCUT_BEAUTY_LAB_SIGNING_IDENTITY` 指定 SHA-1。
   没有证书、证书改变、签名失败都停止，不退回 ad-hoc，不自动生成/信任证书。
4. 构建 recipe 绑定源文件/头文件、原生库、编译命令、编译器版本/路径、SDK 路径/构建版本和证书。
   相同 recipe 复用代码；输入图片、请求、基线、worker、时间状态、输出仍然逐次新建。
5. 在同一目录的临时 staging 内编译、签名、验证，再原子替换固定宿主。
   签名后的 SHA-256、Team ID、证书指纹、正常证书约束的 designated requirement 保存到收据。
   重建必须满足原有 requirement，不使用仅 identifier 的宽松自定义规则。
6. 固定 lock inode 上的 `flock` 贯穿构建、运行、清理、来源检查和报告保存。
   `active-audit.json` 在异常退出后保留；清理未确认时，不允许下一个任务覆盖可能仍被使用的宿主。
7. 每个任务在执行前保留 `audit/live-host.snapshot` 与 `audit/live-host-receipt.json`，
   同时锁定真实执行文件与副本的哈希。副本只作证据，**绝不从该随机路径启动**。
   Electron 消费任务快照、收据、LLDB 实际目标路径与本次报告，避免下一个合法重建造成上一结果误失败。
8. Python 失败通过有界结构化错误行反馈；Electron 只接受有界、合法 UTF-8/JSON，清理控制字符，
   不把整段 stderr 或私有 session token 展示给用户。

未改动 TCC 数据库、没有调用权限重置、没有关闭 SIP/沙盒/库验证，也没有自动授予 Full Disk Access。
只给 QCut 自己的研究宿主做开发签名，未重签第三方运行库，没有增加宿主安全例外 entitlement。

## 实测记录

所有时间为这台 Mac 的本地时间 AEDT。以下路径相对仓库。

| 实测 | 结果与边界 |
| --- | --- |
| `face-live-stable-host-prepare-20261004-r1` | 稳定宿主签名、来源锁、准备和清理通过；未执行原生推理，不把 `passed:false` 改为通过 |
| 开发证书真实重建测试 | 两个内容不同的可执行文件 cdhash 不同，但 designated requirement 一致；第二份通过第一份 requirement 的系统验证 |
| `static-x4jDwp` | 15:25:54 新身份第一次弹出桌面授权；15:25:59 系统记录 `user-consent: Allowed`，随后 live 回调与原生基线零差异；没有代用户点击 |
| UI r1 | 已显示候选并导出 ZIP；旧前端构建错误地导出 `arbitraryFrameCandidateReady:true`，完整测试未通过。源码已有正确静态范围标记，重新构建前端 |
| `static-wPL4pg` / UI r2 | 新 Electron 进程复用稳定宿主；15:30:06 起直接为 `Allowed (User Consent)`，未再次提示。图片/差分/ZIP/移动布局/失效隔离断言通过；最终被更新通知组件未捕获的 `get-update-state` 错误挡住 |
| `static-eF7EjF` / UI r3 | 源码/recipe 更新触发真实重新编译，`reused:false`；58 秒完整 E2E 通过，15:37:29 仍直接沿用 `Allowed (User Consent)` |
| `static-LyPLvM` / UI r4 | 再次启动独立 Electron、重建项目和请求，`reused:true`；完整 E2E 通过，15:39:37 沿用授权，无新增提示 |

准备/原生报告在 `.local/jianying-model-pytorch/`；任务报告在其 `beauty-live-candidate-jobs/`。
UI 目录为 `output/playwright/beauty-live-stable-host-ui-20261004-r{1,2,3,4}`。
四次原图到效果均改变 3,924 个像素，最大通道差 53；候选到原生变化像素 0，最大通道差 0。
最终 r3/r4 的 `report.json` 均为 `passed:true`、`pageErrors:[]`、`timelineUnchanged:true`、
`staleCandidateInvalidated:true`、`arbitraryFrameCandidateReady:false`、`staticAuditReady:true`。
保存原图、原生、候选、x8 灰度差分、桌面/移动截图及 ZIP。r1/r2 失败记录保留，不改成通过。

新旧真实宿主的 SHA-256 从 `b72f6e8a...` 变为 `2b435c20...`，cdhash 从 `ff6966f9...` 变为
`d9f49714...`，designated requirement 完全一致。用 `codesign --verify --strict -R=<旧 requirement>`
验证新宿主通过，证明不是仅运行同一份旧二进制。

系统日志归档：`output/playwright/beauty-live-stable-host-identity-20261004/tcc-desktop.log` 和
`tcc-summary.json`。该时间窗只有首次迁移的 1 条 `AUTHREQ_PROMPTING`；r4 为已有用户授权。
早期 info 级别日志可能被系统滚动淘汰，归档不补造缺失行；r2/r3 的即时查询结果按上表记录。
进程清理报告均成功，退出后没有该任务遗留的 worker/LLDB/debugserver/live-host。

最终本地验证：

- 250 项相关 Vitest 通过，覆盖错误协议、收据绑定、缓存替换、导出范围、更新通知失败等。
- 62 项 Python 测试全部通过，显式包含真实开发证书重建测试，无跳过。
- 全工作区 `bun run check-types`、Electron 构建、前端构建通过。已有 Vite 分块/路由警告未扩大处理。
- 两次完整 Electron E2E 通过；不是把命令行签名检查冒充 UI 验收。
- `update-notification.tsx` 为启动状态读取失败补 catch，不宣布不存在的更新，继续接受后续状态事件；16 项组件测试通过。

## 运行与恢复

```sh
security find-identity -v -p codesigning
# 多个开发证书时设置上一步列出的证书 SHA-1，不使用显示名末尾括号作为 Team ID。
export QCUT_BEAUTY_LAB_SIGNING_IDENTITY='<Apple Development certificate SHA-1>'
bun run build:electron
(cd apps/web && bun run build:electron)
QCUT_BEAUTY_LAB_LIVE_CANDIDATE=1 \
QCUT_REAL_PORTRAIT_IMAGE_PATH="$PWD/.local/jianying-model-pytorch/face-live-validation-20261004-r1/fixtures/front-smile/eye/face.png" \
QCUT_BEAUTY_LIVE_OUTPUT=output/playwright/beauty-live-stable-host-ui-fresh \
bunx playwright test beauty-lab-live-candidate.e2e.ts --project=electron --workers=1 --reporter=line
```

新签名身份第一次访问仍可能弹窗，必须由用户决定。拒绝后不会通过更换身份、路径或重置授权重试。
证书续期/更换、仓库路径迁移、换机器或系统策略变化，需要重新验收，不承诺永远不再询问。

`active-audit.json` 留存时，先核对其中的审计目录、进程报告以及 LLDB/debugserver/宿主是否退出。
确认没有遗留任务后才人工清理该标记；不自动删除 lock 文件、不按进程名批量 kill。
构建中断造成二进制/收据不一致也会停止，需检查构建日志后维护本地缓存，不能静默接受未知二进制。

本修复只打通开发版 macOS ARM64 单帧审计。分钟级候选、多脸动态身份、跨平台原生渲染和正式产品启用门限没有因此放宽。
