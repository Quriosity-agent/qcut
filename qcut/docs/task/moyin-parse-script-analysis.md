# moyin:parse-script CLI

Parse screenplay/story text into structured ScriptData (characters, scenes, episodes) using Claude CLI. Runs standalone — no API keys required beyond Claude CLI auth.

**Last verified**: 2026-03-01 — all tests pass.

## User Guide

### Prerequisites

- [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed and authenticated
- QCut project built (`bun run build`)

### Basic Usage

```bash
# From a file
bun run pipeline moyin:parse-script --script screenplay.txt

# Pipe from stdin
cat script.txt | bun run pipeline moyin:parse-script --input -

# Inline text
bun run pipeline moyin:parse-script --text "A story about a detective..."
```

### Output Modes

```bash
# TTY mode (default) — human-readable summary
bun run pipeline moyin:parse-script --script screenplay.txt
# Output:
#   ✓ Output: /path/to/output/parsed-script.json
#   Duration: 56.0s
#
#   Title:      The Last Garden
#   Genre:      Drama
#   Logline:    A botanist restores nature to the city...
#   Characters: 4
#   Scenes:     4
#   Episodes:   2

# JSON mode — machine-readable envelope
bun run pipeline moyin:parse-script --script screenplay.txt --json
# Output: { "schema_version": "1", "command": "moyin:parse-script", "success": true, ... }

# Quiet mode — suppress progress, print result only
bun run pipeline moyin:parse-script --script screenplay.txt --quiet
```

### Options

| Flag | Description |
|------|-------------|
| `--script <file>` | Path to screenplay/story file |
| `--input <file\|->` | File path or `-` for stdin |
| `--text <string>` | Inline script text |
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

Verified via real test run (1052-char screenplay, ~56s parse time):

| Area | Status | Details |
|------|--------|---------|
| `--script` file input | OK | Reads file via `readScriptInput()` |
| `--input -` stdin pipe | OK | Piped content parsed correctly |
| `--text` inline input | OK | Direct text argument works |
| Claude CLI spawn | OK | `claude -p --model haiku --output-format json --max-turns 1 --system-prompt` |
| Error on missing CLI | OK | Catches ENOENT, prints install instructions |
| Error on non-zero exit | OK | Captures stderr (first 200 chars) |
| Empty response check | OK | Rejects with "Empty response from Claude CLI" |
| `is_error` check | OK | Detects Claude CLI error envelope |
| JSON envelope unwrap | OK | Handles `--output-format json` wrapper `{type, result}` |
| JSON extraction | OK | Strips markdown fences, brace-matches outermost `{}` |
| Schema validation | OK | `validateScriptData()` rejects missing title/characters/scenes |
| TTY output formatter | OK | Prints Title/Genre/Logline/Characters/Scenes/Episodes |
| JSON mode output | OK | Prints structured JSON envelope to stdout |
| Output file write | OK | Creates `./output/parsed-script.json` |
| Transient error retry | OK | Auto-retries once on rate limit / 429 / 503 / network errors |
| stdin error handling | OK | Try-catch around `child.stdin.write()` / `.end()` |
| stderr forwarding | OK | `process.stderr.write(chunk)` shows Claude CLI warnings live |
| Timeout | OK | 180s (3 min), kills subprocess on expiry |
| Editor UI push | OK | Pushes to `/api/claude/moyin/parse-result` when editor is running |
| Env cleanup | OK | Deletes `CLAUDE_CODE`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT` |

## Known Limitations

### JSON extraction regex is fragile

```typescript
const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
```

- Nested markdown fences inside the LLM response break the regex (greedy `[\s\S]*?` captures first closing fence)
- Brace-matching fallback doesn't account for braces inside JSON string values containing `{` or `}`
- No `JSON.parse` error context (line/column) on malformed output

**Mitigation**: In practice, the `--output-format json` flag causes Claude CLI to return a JSON envelope directly (not markdown-wrapped), so the regex rarely fires. The brace-matcher handles the common case.

### No streaming progress during LLM inference

User sees progress messages at 10% (parsing) and 80% (extracting) but nothing during the 30-90s LLM inference gap. No token-by-token feedback.

### Cold start on every call

Each invocation spawns a fresh `claude` subprocess (~500ms overhead). No connection pooling or session reuse. The subprocess overhead is <1.5% of total time so impact is minimal.

### Large script backpressure

If script text exceeds ~10MB, `child.stdin.write()` may block without backpressure handling. The try-catch prevents silent failure but doesn't handle partial writes.

## Performance Profile

Measured from real test run (1052-char screenplay):

| Phase | Time | % of Total |
|-------|------|------------|
| Subprocess spawn | ~500ms | ~1% |
| Prompt delivery via stdin | ~50ms | <0.1% |
| **LLM inference** | **43-68s** | **~97%** |
| JSON extraction + validation | ~10ms | <0.1% |
| File write | ~5ms | <0.1% |
| Editor UI push | ~100-500ms | ~1% |
| **Total** | **~43-68s** | |

LLM inference is the dominant cost. Model is `haiku` (fastest tier). Longer scripts produce more output tokens and take proportionally longer.

## Future Improvements

| Priority | Improvement | Impact | Effort |
|----------|-------------|--------|--------|
| P2 | Stream LLM output (`--output-format stream-json`) | Live progress during 60s wait | 1 hour |
| P3 | Direct Anthropic API call instead of subprocess | Eliminates 500ms spawn, proper streaming, token tracking | 2 hours |
| P3 | Route via editor IPC when QCut is running | Fastest path, no subprocess | 1 hour |
| P3 | `--timeout` CLI flag to override 180s default | User control for very long scripts | 15 min |

### Direct Anthropic API (P3 detail)

Replace `callClaudeCLI()` with direct HTTP:

```typescript
import Anthropic from "@anthropic-ai/sdk";

async function callAnthropicDirect(system: string, user: string): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text : "";
}
```

**Trade-off**: Requires `ANTHROPIC_API_KEY` in env (currently uses Claude CLI's built-in auth).

### Editor IPC Fallback (P3 detail)

When QCut editor is running, skip subprocess entirely:

```typescript
const client = createEditorClient(options);
if (await client.checkHealth()) {
  return await client.post("/api/claude/moyin/parse", { script: rawScript });
}
// Fall back to Claude CLI subprocess
response = await callClaudeCLI(PARSE_SYSTEM_PROMPT, userPrompt);
```

## Source Files

| File | Purpose |
|------|---------|
| `electron/native-pipeline/cli/cli-handlers-moyin.ts` | Handler, Claude CLI spawn, JSON extraction, validation |
| `electron/native-pipeline/cli/cli-output-formatters.ts` | TTY output formatting (line 198-214) |
| `electron/native-pipeline/cli/cli.ts` | CLI entry, routing, output dispatch (line 800-832) |
