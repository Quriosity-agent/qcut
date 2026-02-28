# moyin:parse-script CLI 命令文档

将剧本/故事文本解析为结构化 ScriptData（角色、场景、集数），使用 Claude CLI 作为 LLM 后端。独立运行，无需额外 API 密钥，仅需 Claude CLI 已认证。

**最后验证日期**：2026-03-01 — 全部测试通过。

## 使用指南

### 前置条件

- 已安装并认证 [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- QCut 项目已构建（`bun run build`）

### 基本用法

```bash
# 从文件解析
bun run pipeline moyin:parse-script --script screenplay.txt

# 从标准输入管道
cat script.txt | bun run pipeline moyin:parse-script --input -

# 内联文本
bun run pipeline moyin:parse-script --text "一个关于侦探的故事..."
```

### 输出模式

```bash
# TTY 模式（默认）— 人类可读摘要
bun run pipeline moyin:parse-script --script screenplay.txt
# 输出：
#   ✓ Output: /path/to/output/parsed-script.json
#   Duration: 56.0s
#
#   Title:      最后的花园
#   Genre:      剧情
#   Logline:    一位植物学家将自然带回城市...
#   Characters: 4
#   Scenes:     4
#   Episodes:   2

# JSON 模式 — 机器可读信封
bun run pipeline moyin:parse-script --script screenplay.txt --json
# 输出：{ "schema_version": "1", "command": "moyin:parse-script", "success": true, ... }

# 静默模式 — 抑制进度输出，仅打印结果
bun run pipeline moyin:parse-script --script screenplay.txt --quiet
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--script <file>` | 剧本/故事文件路径 |
| `--input <file\|->` | 文件路径或 `-` 表示标准输入 |
| `--text <string>` | 内联剧本文本 |
| `--language <lang>` | 语言提示（默认：自动检测） |
| `--max-scenes <n>` | 限制提取的场景数量 |
| `--output-dir <dir>` | 输出目录（默认：`./output`） |
| `--json` | JSON 信封输出 |
| `--quiet` | 抑制进度消息 |
| `--host` / `--port` | 编辑器 API 地址用于 UI 推送（默认：`127.0.0.1:8765`） |

### 输出文件

写入 `<output-dir>/parsed-script.json`，结构如下：

```json
{
  "title": "故事标题",
  "genre": "剧情",
  "logline": "一句话概要",
  "characters": [
    {
      "id": "char_1", "name": "小明", "gender": "男", "age": "30岁",
      "role": "...", "personality": "...", "traits": "...", "skills": "...",
      "keyActions": "...", "appearance": "...", "relationships": "...",
      "tags": ["主角"], "notes": "..."
    }
  ],
  "episodes": [
    { "id": "ep_1", "index": 1, "title": "...", "description": "...", "sceneIds": ["scene_1"] }
  ],
  "scenes": [
    {
      "id": "scene_1", "name": "...", "location": "...", "time": "白天",
      "atmosphere": "...", "visualPrompt": "英文视觉描述，用于 AI 图像生成",
      "tags": ["室外"], "notes": "..."
    }
  ],
  "storyParagraphs": [
    { "id": 1, "text": "段落内容", "sceneRefId": "scene_1" }
  ]
}
```

### 编辑器集成

当 QCut 编辑器正在运行时，解析数据会自动通过 HTTP API 推送到导演面板。无需额外参数 — CLI 会自动检查编辑器健康状态，不可用时静默跳过。

---

## 正常工作的功能

通过真实测试验证（1052 字符剧本，约 56 秒解析时间）：

| 功能 | 状态 | 详情 |
|------|------|------|
| `--script` 文件输入 | 正常 | 通过 `readScriptInput()` 读取文件 |
| `--input -` 标准输入管道 | 正常 | 管道内容正确解析 |
| `--text` 内联输入 | 正常 | 直接文本参数正常 |
| Claude CLI 进程启动 | 正常 | `claude -p --model haiku --output-format json --max-turns 1 --system-prompt` |
| CLI 未安装错误 | 正常 | 捕获 ENOENT，打印安装说明 |
| 非零退出码错误 | 正常 | 捕获 stderr（前 200 字符） |
| 空响应检查 | 正常 | 拒绝并提示 "Empty response from Claude CLI" |
| `is_error` 检查 | 正常 | 检测 Claude CLI 错误信封 |
| JSON 信封解包 | 正常 | 处理 `--output-format json` 包装器 `{type, result}` |
| JSON 提取 | 正常 | 去除 markdown 代码块，大括号匹配最外层 `{}` |
| Schema 验证 | 正常 | `validateScriptData()` 拒绝缺少 title/characters/scenes 的数据 |
| TTY 输出格式化 | 正常 | 打印 Title/Genre/Logline/Characters/Scenes/Episodes |
| JSON 模式输出 | 正常 | 将结构化 JSON 信封打印到 stdout |
| 输出文件写入 | 正常 | 创建 `./output/parsed-script.json` |
| 瞬态错误重试 | 正常 | 遇到速率限制 / 429 / 503 / 网络错误时自动重试一次 |
| stdin 错误处理 | 正常 | `child.stdin.write()` / `.end()` 包含 try-catch |
| stderr 转发 | 正常 | `process.stderr.write(chunk)` 实时显示 Claude CLI 警告 |
| 超时控制 | 正常 | 180 秒（3 分钟），超时后终止子进程 |
| 编辑器 UI 推送 | 正常 | 编辑器运行时推送到 `/api/claude/moyin/parse-result` |
| 环境变量清理 | 正常 | 删除 `CLAUDE_CODE`、`CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SSE_PORT` |

## 已知限制

### JSON 提取正则表达式较脆弱

```typescript
const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
```

- LLM 响应中嵌套的 markdown 代码块会导致正则匹配错误（`[\s\S]*?` 捕获第一个闭合标记）
- 大括号匹配不考虑 JSON 字符串值中包含的 `{` 或 `}`
- 解析失败时无 `JSON.parse` 错误上下文（行/列号）

**缓解措施**：实际使用中，`--output-format json` 标志使 Claude CLI 直接返回 JSON 信封（非 markdown 包装），因此正则很少触发。大括号匹配器可处理常见情况。

### LLM 推理期间无流式进度

用户在 10%（解析中）和 80%（提取中）看到进度消息，但在 30-90 秒的 LLM 推理期间无任何反馈，无逐 token 进度显示。

### 每次调用冷启动

每次调用都会启动新的 `claude` 子进程（约 500ms 开销）。无连接池或会话复用。子进程开销占总时间不到 1.5%，影响较小。

### 大脚本背压问题

如果脚本文本超过约 10MB，`child.stdin.write()` 可能会阻塞且无背压处理。try-catch 防止了静默失败，但不处理部分写入。

## 性能分析

基于真实测试（1052 字符剧本）的实测数据：

| 阶段 | 耗时 | 占比 |
|------|------|------|
| 子进程启动 | ~500ms | ~1% |
| stdin 传递提示词 | ~50ms | <0.1% |
| **LLM 推理** | **43-68 秒** | **~97%** |
| JSON 提取 + 验证 | ~10ms | <0.1% |
| 文件写入 | ~5ms | <0.1% |
| 编辑器 UI 推送 | ~100-500ms | ~1% |
| **总计** | **~43-68 秒** | |

LLM 推理是主要耗时。使用 `haiku` 模型（最快档）。较长的脚本会产生更多输出 token，耗时相应增加。

## 未来改进

| 优先级 | 改进项 | 影响 | 工作量 |
|--------|--------|------|--------|
| P2 | 流式 LLM 输出（`--output-format stream-json`） | 60 秒等待期间有实时进度 | 1 小时 |
| P3 | 直接调用 Anthropic API 替代子进程 | 消除 500ms 启动开销，支持流式、token 追踪 | 2 小时 |
| P3 | QCut 运行时通过编辑器 IPC 路由 | 最快路径，无子进程 | 1 小时 |
| P3 | `--timeout` CLI 参数覆盖默认 180 秒 | 用户可控制超长脚本的超时时间 | 15 分钟 |

### 直接 Anthropic API 调用（P3 详情）

将 `callClaudeCLI()` 替换为直接 HTTP 调用：

```typescript
import Anthropic from "@anthropic-ai/sdk";

async function callAnthropicDirect(system: string, user: string): Promise<string> {
  const client = new Anthropic(); // 从环境变量读取 ANTHROPIC_API_KEY
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}
```

**权衡**：需要环境变量中设置 `ANTHROPIC_API_KEY`（当前使用 Claude CLI 内置认证）。

### 编辑器 IPC 回退（P3 详情）

QCut 编辑器运行时跳过子进程，直接走 IPC：

```typescript
const client = createEditorClient(options);
if (await client.checkHealth()) {
  return await client.post("/api/claude/moyin/parse", { script: rawScript });
}
// 回退到 Claude CLI 子进程
response = await callClaudeCLI(PARSE_SYSTEM_PROMPT, userPrompt);
```

## 源文件

| 文件 | 用途 |
|------|------|
| `electron/native-pipeline/cli/cli-handlers-moyin.ts` | 处理器、Claude CLI 启动、JSON 提取、验证 |
| `electron/native-pipeline/cli/cli-output-formatters.ts` | TTY 输出格式化（第 198-214 行） |
| `electron/native-pipeline/cli/cli.ts` | CLI 入口、路由、输出调度（第 800-832 行） |
