# moyin:parse-script CLI

Parse screenplay/story text into structured ScriptData (characters, scenes, episodes) using multiple LLM providers. Supports OpenRouter (Kimi K2.5, MiniMax M2.5, Gemini), direct Gemini API, and Claude CLI fallback with streaming output.

**Last verified**: 2026-03-01 — all provider paths and streaming tested.

## User Guide

### Prerequisites

- QCut project built (`bun run build`)
- One of:
  - `OPENROUTER_API_KEY` — access to Kimi, MiniMax, Gemini, and 200+ models via [OpenRouter](https://openrouter.ai)
  - `GEMINI_API_KEY` — direct Google Gemini API access
  - [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed (zero-config fallback)

### Setting an API Key

```bash
bun run pipeline set-key --name OPENROUTER_API_KEY --value sk-or-...
bun run pipeline check-keys   # verify
```

Keys are stored in `~/.qcut/.env` and loaded automatically on every CLI run.

### Basic Usage

```bash
# From a file (auto-detects best provider from available keys)
bun run pipeline moyin:parse-script --script screenplay.txt

# Choose a specific model
bun run pipeline moyin:parse-script --script screenplay.txt --model kimi
bun run pipeline moyin:parse-script --script screenplay.txt --model minimax
bun run pipeline moyin:parse-script --script screenplay.txt --model gemini

# Pipe from stdin
cat script.txt | bun run pipeline moyin:parse-script --input -

# Inline text
bun run pipeline moyin:parse-script --text "A story about a detective..."

# Streaming output (shows progress as tokens arrive)
bun run pipeline moyin:parse-script --script screenplay.txt --model gemini --stream
```

### Available Models

| Alias | OpenRouter Model ID | Notes |
|-------|-------------------|-------|
| `kimi` / `kimi-k2.5` | `moonshotai/kimi-k2.5` | Good at Chinese + English scripts |
| `minimax` / `minimax-m2.5` | `minimax/minimax-m2.5` | Fast, good structured output |
| `gemini` / `gemini-flash` | `google/gemini-2.5-flash` | Default, cheapest, fast |
| `gemini-pro` | `google/gemini-2.5-pro` | Higher quality, slower |

Any OpenRouter model ID (e.g., `anthropic/claude-3.5-sonnet`) can also be passed directly via `--model`.

### Provider Priority

1. `OPENROUTER_API_KEY` set → uses OpenRouter with selected model
2. `GEMINI_API_KEY` set → uses direct Gemini API
3. Neither set → falls back to Claude CLI subprocess (no API key needed)

### Output Modes

```bash
# TTY mode (default) — human-readable summary
bun run pipeline moyin:parse-script --script screenplay.txt
# Output:
#   ✓ Output: /path/to/output/parsed-script.json
#   Duration: 12.8s
#
#   Title:      The Last Garden
#   Genre:      Drama
#   Logline:    A botanist restores nature to the city...
#   Characters: 4
#   Scenes:     4
#   Episodes:   2
#   Provider:   OpenRouter (google/gemini-2.5-flash)

# JSON mode — machine-readable envelope
bun run pipeline moyin:parse-script --script screenplay.txt --json

# Streaming mode — live progress as tokens arrive
bun run pipeline moyin:parse-script --script screenplay.txt --stream
```

### Options

| Flag | Description |
|------|-------------|
| `--script <file>` | Path to screenplay/story file |
| `--input <file\|->` | File path or `-` for stdin |
| `--text <string>` | Inline script text |
| `--model <name>` | Model alias or full OpenRouter ID (default: `gemini-flash`) |
| `--stream` | Enable streaming output (live progress during LLM inference) |
| `--language <lang>` | Hint language (default: auto-detect) |
| `--max-scenes <n>` | Limit number of extracted scenes |
| `--output-dir <dir>` | Output directory (default: `./output`) |
| `--json` | JSON envelope output |
| `--quiet` | Suppress progress messages |
| `--host` / `--port` | Editor API endpoint for UI push (default: `127.0.0.1:8765`) |

### Output File

Written to `<output-dir>/parsed-script.json` with this structure:

```json
{
  "title": "Story Title",
  "genre": "Drama",
  "logline": "One-sentence summary",
  "characters": [
    {
      "id": "char_1", "name": "Maya", "gender": "Female", "age": "30s",
      "role": "...", "personality": "...", "traits": "...", "skills": "...",
      "keyActions": "...", "appearance": "...", "relationships": "...",
      "tags": ["protagonist"], "notes": "..."
    }
  ],
  "episodes": [
    { "id": "ep_1", "index": 1, "title": "...", "description": "...", "sceneIds": ["scene_1"] }
  ],
  "scenes": [
    {
      "id": "scene_1", "name": "...", "location": "...", "time": "Day",
      "atmosphere": "...", "visualPrompt": "English visual description for AI generation",
      "tags": ["outdoor"], "notes": "..."
    }
  ],
  "storyParagraphs": [
    { "id": 1, "text": "Paragraph content", "sceneRefId": "scene_1" }
  ]
}
```

### Editor Integration

When QCut editor is running, parsed data is automatically pushed to the Director panel via HTTP API. No extra flags needed — the CLI checks editor health and silently skips if unavailable.

---

## What Works

Verified via real test runs (1052-char screenplay):

| Area | Status | Details |
|------|--------|---------|
| OpenRouter provider | OK | Tested with Kimi K2.5, MiniMax M2.5, Gemini Flash |
| Gemini direct provider | OK | Uses `generativelanguage.googleapis.com` API |
| Claude CLI fallback | OK | Spawns `claude -p --model haiku` when no API keys |
| Model alias resolution | OK | `--model kimi` → `moonshotai/kimi-k2.5` |
| Full OpenRouter model ID | OK | `--model anthropic/claude-3.5-sonnet` passes through |
| Streaming (OpenRouter) | OK | SSE parsing, live progress updates during inference |
| Streaming (Gemini) | OK | SSE via `streamGenerateContent?alt=sse` |
| Provider auto-detection | OK | Checks OPENROUTER_API_KEY → GEMINI_API_KEY → Claude CLI |
| `--script` file input | OK | Reads file via `readScriptInput()` |
| `--input -` stdin pipe | OK | Piped content parsed correctly |
| `--text` inline input | OK | Direct text argument works |
| Schema validation | OK | `validateScriptData()` rejects missing title/characters/scenes |
| TTY output formatter | OK | Shows Title/Genre/Logline/Characters/Scenes/Episodes/Provider |
| JSON mode output | OK | Includes `provider` and `model` fields in data |
| Transient error retry | OK | Auto-retries once on rate limit / 429 / 503 / network errors |
| stdin error handling | OK | Try-catch around `child.stdin.write()` / `.end()` |
| stderr forwarding | OK | `process.stderr.write(chunk)` shows Claude CLI warnings live |
| Timeout | OK | 120s for API calls, 180s for Claude CLI |
| Editor UI push | OK | Pushes to `/api/claude/moyin/parse-result` when editor is running |
| Key storage | OK | `set-key --name OPENROUTER_API_KEY --value ...` persists to `~/.qcut/.env` |

## Performance by Provider

Measured from real test runs (1052-char screenplay):

| Provider | Model | Time | Notes |
|----------|-------|------|-------|
| OpenRouter | `google/gemini-2.5-flash` | ~12s | Fastest, cheapest |
| OpenRouter | `minimax/minimax-m2.5` | ~30s | Good quality, fast |
| OpenRouter | `moonshotai/kimi-k2.5` | ~59-107s | Best for Chinese scripts |
| Claude CLI | `haiku` | ~54s | Zero-config fallback |

## Known Limitations

### JSON extraction regex is fragile

```typescript
const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
```

Nested markdown fences inside the LLM response can break the regex. In practice, OpenRouter/Gemini return clean JSON more reliably than Claude CLI.

### No streaming for Claude CLI fallback

Claude CLI buffers the entire response (`--output-format json`). Streaming is only available when using OpenRouter or Gemini direct.

### Large script backpressure (Claude CLI only)

If script text exceeds ~10MB, `child.stdin.write()` may block without backpressure handling. OpenRouter/Gemini use HTTP body which handles large payloads natively.

## Future Improvements

| Priority | Improvement | Impact | Effort |
|----------|-------------|--------|--------|
| P3 | Direct Anthropic API as fourth provider | Native Claude access without CLI subprocess | 1 hour |
| P3 | Route via editor IPC when QCut is running | Fastest path, no network calls | 1 hour |
| P3 | `--timeout` CLI flag to override defaults | User control for slow models | 15 min |

## Source Files

| File | Purpose |
|------|---------|
| `electron/native-pipeline/cli/cli-handlers-moyin.ts` | Handler, LLM routing, streaming, JSON extraction, validation |
| `electron/native-pipeline/cli/cli-output-formatters.ts` | TTY output formatting (line 198-218) |
| `electron/native-pipeline/cli/cli.ts` | CLI entry, routing, output dispatch |
| `electron/native-pipeline/infra/api-caller.ts` | `envApiKeyProvider()` for CLI-safe key resolution |
| `electron/native-pipeline/infra/key-manager.ts` | Key storage (`~/.qcut/.env`) and loading |
