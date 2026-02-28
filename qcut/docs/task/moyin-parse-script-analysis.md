# moyin:parse-script CLI — Analysis & Improvement Plan

## 1. What Succeeds

| Area | Status | Details |
|------|--------|---------|
| Arg parsing | OK | `--script`, `--input -`, `--text` all route correctly |
| Script reading | OK | File reading, stdin piping, inline text all work in `readScriptInput()` |
| Claude CLI spawn | OK | Properly spawns `claude -p --model haiku --output-format json` |
| Error on missing CLI | OK | Catches ENOENT, prints "Install with: npm install -g @anthropic-ai/claude-code" |
| Error on non-zero exit | OK | Captures stderr (first 200 chars), returns as error |
| Empty response check | OK | Rejects "Empty response from Claude CLI" |
| JSON envelope unwrap | OK | Handles `--output-format json` wrapper `{type, result}` |
| JSON extraction | OK | Strips markdown fences, brace-matches outermost `{}` |
| Output file write | OK | Creates `./output/parsed-script.json` |
| `--json` mode output | OK | Prints structured JSON envelope to stdout |
| UI push (optional) | OK | Silently skips if editor not running |

**Bottom line**: The core parsing pipeline works correctly when the command actually executes.

## 2. What Fails

### 2a. Zero TTY Output (Critical)

**Symptom**: `bun run pipeline moyin:parse-script --script file.txt` prints nothing.

**Root cause chain**:
1. Handler succeeds, returns `{ success: true, data: { title, genre, ... } }`
2. `cli.ts:816` — `result.success` is true
3. `cli.ts:817-824` — Should print "Output:" and "Duration:" lines via `CLIOutput`
4. `cli.ts:825` — Calls `formatCommandOutput("moyin:parse-script", result)`
5. `cli-output-formatters.ts` — **No case for `"moyin:parse-script"`**
6. Function silently returns at line 210 — no summary printed

**Fix**: Add a `moyin:parse-script` case to `cli-output-formatters.ts` (~10 lines).

### 2b. `CLIOutput` May Be Suppressed

The `CLIOutput` class checks `options.quiet` and `options.json` before printing. In `--json` mode the "Output:" and "Duration:" lines are skipped (JSON envelope is printed instead, which works). But in normal mode, the `output.success()` and `output.info()` calls at lines 817-823 **should** print — yet testing showed zero output.

**Possible cause**: The `CLIOutput` constructor may be initialized with `quiet: true` by default, or the `StreamEmitter` consumes stdout. Needs investigation.

### 2c. stdin Write Has No Error Handling

```typescript
// cli-handlers-moyin.ts:223-224
child.stdin.write(userPrompt);
child.stdin.end();
```

- No try-catch around write/end
- If pipe breaks (e.g., Claude CLI exits before reading), silent failure
- If script is very large (>10MB), `write()` may block with no backpressure handling

### 2d. JSON Extraction Is Fragile

```typescript
function extractJSON(response: string): Record<string, unknown> {
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  // ...brace counting...
  return JSON.parse(cleaned);
}
```

- Nested markdown fences break the regex
- No schema validation after parse — missing `characters`/`scenes`/`episodes` fields produce `NaN` or `0` silently
- No JSON.parse error context (line/column)

### 2e. Environment Variable Cleanup Incomplete

```typescript
const env = { ...process.env };
delete env.CLAUDECODE;           // typo? should be CLAUDE_CODE
delete env.CLAUDE_CODE_ENTRYPOINT;
delete env.CLAUDE_CODE_SSE_PORT;
```

Missing: `CLAUDE_CODE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_PROXY` — could interfere with subprocess.

## 3. Why It Is So Slow

### 3a. Subprocess Spawn Overhead (~500ms)

Each call forks a new `claude` process:
- Process creation: ~10ms
- Binary load + Node.js startup: ~200-400ms
- CLI initialization: ~100ms

**Impact**: Adds ~500ms per invocation, cannot be amortized.

### 3b. LLM Inference Is the Bottleneck (~30-90s)

- Model: `haiku` (fastest tier)
- Typical screenplay: 2000-5000 input tokens, 1000-3000 output tokens
- Inference: ~30-90s depending on length
- **This is the dominant cost** — no way to avoid it without a faster model

### 3c. 600s Timeout Is 5-20x Too Long

```typescript
const CLAUDE_CLI_TIMEOUT_MS = 600_000; // 10 minutes!
```

Typical total time is 30-120s. The timeout gives no user feedback and just waits.

### 3d. No Streaming = Silent Wait

- User sees a "Parsing..." message for 60+ seconds with no progress
- Claude CLI supports streaming but `callClaudeCLI()` buffers entire response
- No token-by-token feedback possible

### 3e. Cold Start on Every Call

Unlike the in-app `llm-adapter.ts` which reuses Electron IPC, the CLI:
- Spawns a fresh process every time
- Reads config/env from disk
- Establishes new API connection
- No connection pooling or session reuse

### Performance Breakdown

| Phase | Time | % of Total |
|-------|------|------------|
| Subprocess spawn | ~500ms | 0.5-1.5% |
| Prompt delivery | ~50-200ms | 0.1-0.5% |
| **LLM inference** | **30-90s** | **95-98%** |
| JSON extraction | ~10ms | <0.1% |
| File write | ~5ms | <0.1% |
| UI push attempt | ~100-500ms | 0.3-1% |
| **Total** | **~31-91s** | |

## 4. How to Improve — Robustness & Speed

### Quick Wins (30 min)

#### 4a. Add Output Formatter (10 lines)

In `cli-output-formatters.ts`, add a case for `moyin:parse-script`:

```typescript
if (command === "moyin:parse-script") {
  const d = result.data as {
    title?: string; genre?: string; logline?: string;
    characters?: number; scenes?: number; episodes?: number;
  };
  console.log(`\nTitle:      ${d.title || "Untitled"}`);
  console.log(`Genre:      ${d.genre || "Unknown"}`);
  console.log(`Logline:    ${d.logline || "-"}`);
  console.log(`Characters: ${d.characters ?? 0}`);
  console.log(`Scenes:     ${d.scenes ?? 0}`);
  console.log(`Episodes:   ${d.episodes ?? 0}`);
  return;
}
```

#### 4b. Reduce Timeout to 180s

```typescript
const CLAUDE_CLI_TIMEOUT_MS = 180_000; // 3 minutes (was 10)
```

Add `--timeout` CLI option to override.

#### 4c. Wrap stdin Write in Try-Catch

```typescript
try {
  child.stdin.write(userPrompt);
  child.stdin.end();
} catch (err) {
  reject(new Error(`Failed to write to Claude CLI stdin: ${err}`));
}
```

#### 4d. Forward stderr to Console

Add a stderr line during spawn:

```typescript
child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString();
  process.stderr.write(chunk); // <-- show warnings immediately
});
```

### Medium Improvements (1-2 hours)

#### 4e. Validate Parsed JSON Schema

After `extractJSON()`, validate required fields:

```typescript
function validateScriptData(data: Record<string, unknown>): void {
  const required = ["title", "characters", "scenes"];
  for (const field of required) {
    if (!data[field]) throw new Error(`Missing required field: ${field}`);
  }
  if (!Array.isArray(data.characters) || data.characters.length === 0) {
    throw new Error("No characters found in parsed script");
  }
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("No scenes found in parsed script");
  }
}
```

#### 4f. Add Streaming Progress

Use `--stream` mode to show token progress:

```typescript
const args = ["-p", "--model", "haiku", "--output-format", "stream-json"];
// Then parse JSONL events for progress updates
```

#### 4g. Add Retry Logic

If Claude CLI fails with transient error (rate limit, network), retry once:

```typescript
try {
  response = await callClaudeCLI(systemPrompt, userPrompt);
} catch (err) {
  if (isTransientError(err)) {
    onProgress({ stage: "retry", percent: 15, message: "Retrying..." });
    response = await callClaudeCLI(systemPrompt, userPrompt);
  } else {
    throw err;
  }
}
```

### Long-Term (Architecture Change)

#### 4h. Direct Anthropic API Instead of Subprocess

Replace `callClaudeCLI()` with a direct HTTP call to Anthropic API:

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

**Benefits**:
- Eliminates 500ms subprocess overhead
- Direct streaming support
- Proper error types (rate limit, auth, etc.)
- Token usage tracking
- Configurable retries

**Trade-off**: Requires `ANTHROPIC_API_KEY` in env (currently uses Claude CLI's auth).

#### 4i. Use In-App IPC When Editor Is Running

When QCut editor is available, route through the existing `llm-adapter.ts`:

```typescript
// Try editor IPC first (faster, no subprocess)
const client = createEditorClient(options);
if (await client.checkHealth()) {
  const result = await client.post("/api/claude/moyin/parse", { script: rawScript });
  return result;
}
// Fall back to Claude CLI subprocess
response = await callClaudeCLI(PARSE_SYSTEM_PROMPT, userPrompt);
```

## Summary

| Priority | Fix | Impact | Effort |
|----------|-----|--------|--------|
| P0 | Add output formatter for moyin:parse-script | Fixes zero output bug | 10 min |
| P0 | Wrap stdin write in try-catch | Prevents silent hangs | 5 min |
| P1 | Reduce timeout to 180s + add --timeout flag | Better UX | 15 min |
| P1 | Forward stderr to console | Debuggability | 5 min |
| P1 | Validate parsed JSON schema | Prevents silent data corruption | 20 min |
| P2 | Add streaming progress | Better UX during 60s wait | 1 hour |
| P2 | Add retry on transient errors | Robustness | 30 min |
| P3 | Direct Anthropic API call | -500ms, streaming, retries | 2 hours |
| P3 | IPC fallback when editor running | Fastest path | 1 hour |
