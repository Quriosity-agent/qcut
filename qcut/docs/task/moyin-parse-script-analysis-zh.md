# moyin:parse-script CLI 命令文档

将剧本/故事文本解析为结构化 ScriptData（角色、场景、集数），支持多个 LLM 提供商。通过 OpenRouter 支持 Kimi K2.5、MiniMax M2.5、Gemini，以及直接 Gemini API 和 Claude CLI 回退，支持流式输出。

**最后验证日期**：2026-03-01 — 全部提供商路径和流式输出已测试通过。

## 使用指南

### 前置条件

- QCut 项目已构建（`bun run build`）
- 以下任一：
  - `OPENROUTER_API_KEY` — 通过 [OpenRouter](https://openrouter.ai) 访问 Kimi、MiniMax、Gemini 等 200+ 模型
  - `GEMINI_API_KEY` — 直接 Google Gemini API 访问
  - 已安装 [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)（零配置回退）

### 设置 API 密钥

```bash
bun run pipeline set-key --name OPENROUTER_API_KEY --value sk-or-...
bun run pipeline check-keys   # 验证
```

密钥存储在 `~/.qcut/.env`，每次 CLI 运行时自动加载。

### 基本用法

```bash
# 从文件解析（自动检测最佳提供商）
bun run pipeline moyin:parse-script --script screenplay.txt

# 选择特定模型
bun run pipeline moyin:parse-script --script screenplay.txt --model kimi
bun run pipeline moyin:parse-script --script screenplay.txt --model minimax
bun run pipeline moyin:parse-script --script screenplay.txt --model gemini

# 从标准输入管道
cat script.txt | bun run pipeline moyin:parse-script --input -

# 内联文本
bun run pipeline moyin:parse-script --text "一个关于侦探的故事..."

# 流式输出（实时显示 token 接收进度）
bun run pipeline moyin:parse-script --script screenplay.txt --model gemini --stream
```

### 可用模型

| 别名 | OpenRouter 模型 ID | 说明 |
|------|-------------------|------|
| `kimi` / `kimi-k2.5` | `moonshotai/kimi-k2.5` | 擅长中英文剧本 |
| `minimax` / `minimax-m2.5` | `minimax/minimax-m2.5` | 速度快，结构化输出好 |
| `gemini` / `gemini-flash` | `google/gemini-2.5-flash` | 默认，最便宜，速度快 |
| `gemini-pro` | `google/gemini-2.5-pro` | 更高质量，速度较慢 |

也可以直接传入任何 OpenRouter 模型 ID（如 `anthropic/claude-3.5-sonnet`）。

### 提供商优先级

1. 设置了 `OPENROUTER_API_KEY` → 使用 OpenRouter + 所选模型
2. 设置了 `GEMINI_API_KEY` → 使用 Gemini 直连 API
3. 均未设置 → 回退到 Claude CLI 子进程（无需 API 密钥）

### 输出模式

```bash
# TTY 模式（默认）— 人类可读摘要
bun run pipeline moyin:parse-script --script screenplay.txt
# 输出：
#   ✓ Output: /path/to/output/parsed-script.json
#   Duration: 12.8s
#
#   Title:      最后的花园
#   Genre:      剧情
#   Logline:    一位植物学家将自然带回城市...
#   Characters: 4
#   Scenes:     4
#   Episodes:   2
#   Provider:   OpenRouter (google/gemini-2.5-flash)

# JSON 模式 — 机器可读信封
bun run pipeline moyin:parse-script --script screenplay.txt --json

# 流式模式 — 推理期间实时显示进度
bun run pipeline moyin:parse-script --script screenplay.txt --stream
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--script <file>` | 剧本/故事文件路径 |
| `--input <file\|->` | 文件路径或 `-` 表示标准输入 |
| `--text <string>` | 内联剧本文本 |
| `--model <name>` | 模型别名或完整 OpenRouter ID（默认：`gemini-flash`） |
| `--stream` | 启用流式输出（LLM 推理期间实时显示进度） |
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

通过真实测试验证（1052 字符剧本）：

| 功能 | 状态 | 详情 |
|------|------|------|
| OpenRouter 提供商 | 正常 | 已测试 Kimi K2.5、MiniMax M2.5、Gemini Flash |
| Gemini 直连提供商 | 正常 | 使用 `generativelanguage.googleapis.com` API |
| Claude CLI 回退 | 正常 | 无 API 密钥时启动 `claude -p --model haiku` |
| 模型别名解析 | 正常 | `--model kimi` → `moonshotai/kimi-k2.5` |
| 完整 OpenRouter 模型 ID | 正常 | `--model anthropic/claude-3.5-sonnet` 直接传递 |
| 流式输出（OpenRouter） | 正常 | SSE 解析，推理期间实时进度更新 |
| 流式输出（Gemini） | 正常 | 通过 `streamGenerateContent?alt=sse` SSE |
| 提供商自动检测 | 正常 | 检查 OPENROUTER_API_KEY → GEMINI_API_KEY → Claude CLI |
| `--script` 文件输入 | 正常 | 通过 `readScriptInput()` 读取文件 |
| `--input -` 标准输入管道 | 正常 | 管道内容正确解析 |
| `--text` 内联输入 | 正常 | 直接文本参数正常 |
| Schema 验证 | 正常 | `validateScriptData()` 拒绝缺少 title/characters/scenes 的数据 |
| TTY 输出格式化 | 正常 | 显示 Title/Genre/Logline/Characters/Scenes/Episodes/Provider |
| JSON 模式输出 | 正常 | 数据中包含 `provider` 和 `model` 字段 |
| 瞬态错误重试 | 正常 | 遇到速率限制 / 429 / 503 / 网络错误时自动重试一次 |
| stdin 错误处理 | 正常 | `child.stdin.write()` / `.end()` 包含 try-catch |
| stderr 转发 | 正常 | `process.stderr.write(chunk)` 实时显示 Claude CLI 警告 |
| 超时控制 | 正常 | API 调用 120 秒，Claude CLI 180 秒 |
| 编辑器 UI 推送 | 正常 | 编辑器运行时推送到 `/api/claude/moyin/parse-result` |
| 密钥存储 | 正常 | `set-key --name OPENROUTER_API_KEY --value ...` 持久化到 `~/.qcut/.env` |

## 各提供商性能对比

基于真实测试（1052 字符剧本）的实测数据：

| 提供商 | 模型 | 耗时 | 说明 |
|--------|------|------|------|
| OpenRouter | `google/gemini-2.5-flash` | ~12 秒 | 最快，最便宜 |
| OpenRouter | `minimax/minimax-m2.5` | ~30 秒 | 质量好，速度快 |
| OpenRouter | `moonshotai/kimi-k2.5` | ~59-107 秒 | 最适合中文剧本 |
| Claude CLI | `haiku` | ~54 秒 | 零配置回退 |

## 已知限制

### JSON 提取正则表达式较脆弱

```typescript
const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
```

LLM 响应中嵌套的 markdown 代码块可能导致正则匹配错误。实际使用中，OpenRouter/Gemini 返回的 JSON 比 Claude CLI 更干净。

### Claude CLI 回退无流式输出

Claude CLI 缓冲整个响应（`--output-format json`）。流式输出仅在使用 OpenRouter 或 Gemini 直连时可用。

### 大脚本背压问题（仅 Claude CLI）

如果脚本文本超过约 10MB，`child.stdin.write()` 可能会阻塞且无背压处理。OpenRouter/Gemini 使用 HTTP body，天然支持大数据。

## 未来改进

| 优先级 | 改进项 | 影响 | 工作量 |
|--------|--------|------|--------|
| P3 | 直接 Anthropic API 作为第四提供商 | 无需 CLI 子进程即可使用 Claude | 1 小时 |
| P3 | QCut 运行时通过编辑器 IPC 路由 | 最快路径，无网络调用 | 1 小时 |
| P3 | `--timeout` CLI 参数覆盖默认值 | 用户可控制慢模型的超时时间 | 15 分钟 |

## 源文件

| 文件 | 用途 |
|------|------|
| `electron/native-pipeline/cli/cli-handlers-moyin.ts` | 处理器、LLM 路由、流式输出、JSON 提取、验证 |
| `electron/native-pipeline/cli/cli-output-formatters.ts` | TTY 输出格式化（第 198-218 行） |
| `electron/native-pipeline/cli/cli.ts` | CLI 入口、路由、输出调度 |
| `electron/native-pipeline/infra/api-caller.ts` | `envApiKeyProvider()` CLI 安全的密钥解析 |
| `electron/native-pipeline/infra/key-manager.ts` | 密钥存储（`~/.qcut/.env`）和加载 |
