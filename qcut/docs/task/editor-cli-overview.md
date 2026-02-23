# Editor CLI Wrapper — Overview & Architecture

> **Date:** 2026-02-22
> **Goal:** Add `editor:*` commands to the native pipeline CLI that proxy to QCut's HTTP API, giving LLMs a single unified CLI interface for both standalone generation and live editor control.
> **Reference:** `.claude/skills/qcut-api/SKILL.md`, `.claude/skills/native-cli/SKILL.md`
> **Status:** Implemented & Tested (157 tests passing)

## Problem

QCut has two LLM interfaces that don't overlap:

| Interface | Syntax | Requires | Domain |
|-----------|--------|----------|--------|
| Native CLI | `bun run pipeline create-video -m kling -t "sunset"` | Just `bun` | Standalone generation, analysis |
| QCut API | `curl -X POST -H "Content-Type: application/json" -d '{...}' http://127.0.0.1:8765/api/claude/...` | Running QCut app | Live editor control |

The HTTP API is verbose, error-prone for LLMs (JSON quoting, bracket matching, nesting), and costs more tokens. The native CLI's flat `--flag value` syntax is significantly easier for LLMs to construct correctly.

## Solution

Add ~59 `editor:*` CLI commands that proxy to the 64 HTTP API endpoints. The CLI becomes a superset — one tool for everything.

```bash
# Before (verbose curl)
curl -s -X POST http://127.0.0.1:8765/api/claude/media/my-project/import \
  -H "Content-Type: application/json" \
  -d '{"source":"/path/to/video.mp4"}'

# After (simple CLI)
bun run pipeline editor:media:import --project-id my-project --source /path/to/video.mp4
```

## Command Naming Convention

Uses colon-separated namespaces, matching existing `vimax:*` convention in `cli.ts`:

```
editor:<module>:<action>
```

## Complete Command List (59 commands)

### Health (1)
```
editor:health
```

### Media (8)
```
editor:media:list             --project-id <id>
editor:media:info             --project-id <id> --media-id <id>
editor:media:import           --project-id <id> --source <path>
editor:media:import-url       --project-id <id> --url <url> [--filename <name>]
editor:media:batch-import     --project-id <id> --items <json>
editor:media:extract-frame    --project-id <id> --media-id <id> --timestamp <s>
editor:media:rename           --project-id <id> --media-id <id> --new-name <name>
editor:media:delete           --project-id <id> --media-id <id>
```

### Timeline (14)
```
editor:timeline:export          --project-id <id> [--format json|md]
editor:timeline:import          --project-id <id> --data <file-or-json> [--format json|md] [--replace]
editor:timeline:add-element     --project-id <id> --data <json>
editor:timeline:batch-add       --project-id <id> --elements <json>
editor:timeline:update-element  --project-id <id> --element-id <id> --changes <json>
editor:timeline:batch-update    --project-id <id> --updates <json>
editor:timeline:delete-element  --project-id <id> --element-id <id>
editor:timeline:batch-delete    --project-id <id> --elements <json> [--ripple]
editor:timeline:split           --project-id <id> --element-id <id> --split-time <s> [--mode split|keepLeft|keepRight]
editor:timeline:move            --project-id <id> --element-id <id> --to-track <id> [--start-time <s>]
editor:timeline:arrange         --project-id <id> --track-id <id> --mode sequential|spaced|manual [--gap <s>]
editor:timeline:select          --project-id <id> --elements <json>
editor:timeline:get-selection   --project-id <id>
editor:timeline:clear-selection --project-id <id>
```

### Project (5)
```
editor:project:settings         --project-id <id>
editor:project:update-settings  --project-id <id> --data <json>
editor:project:stats            --project-id <id>
editor:project:summary          --project-id <id>
editor:project:report           --project-id <id> [--output-dir <path>]
```

### Export (5)
```
editor:export:presets
editor:export:recommend    --project-id <id> --target <platform>
editor:export:start        --project-id <id> [--preset <name>] [--poll]
editor:export:status       --project-id <id> --job-id <id>
editor:export:list-jobs    --project-id <id>
```

### Generate (6)
```
editor:generate:start         --project-id <id> --model <key> --prompt <text> [--poll]
editor:generate:status        --project-id <id> --job-id <id>
editor:generate:list-jobs     --project-id <id>
editor:generate:cancel        --project-id <id> --job-id <id>
editor:generate:models
editor:generate:estimate-cost --model <key> [--duration <s>]
```

### Analysis (5)
```
editor:analyze:video    --project-id <id> --source <type:id-or-path>
editor:analyze:models
editor:analyze:scenes   --project-id <id> --media-id <id> [--threshold <n>]
editor:analyze:frames   --project-id <id> --media-id <id> [--timestamps <csv>]
editor:analyze:fillers  --project-id <id> [--media-id <id>]
```

### Transcription (5)
```
editor:transcribe:run       --project-id <id> --media-id <id>
editor:transcribe:start     --project-id <id> --media-id <id> [--poll]
editor:transcribe:status    --project-id <id> --job-id <id>
editor:transcribe:list-jobs --project-id <id>
editor:transcribe:cancel    --project-id <id> --job-id <id>
```

### Editing (7)
```
editor:editing:batch-cuts      --project-id <id> --element-id <id> --cuts <json>
editor:editing:delete-range    --project-id <id> --start-time <s> --end-time <s> [--ripple]
editor:editing:auto-edit       --project-id <id> --element-id <id> --media-id <id> [--dry-run] [--poll]
editor:editing:auto-edit-status --project-id <id> --job-id <id>
editor:editing:auto-edit-list  --project-id <id>
editor:editing:suggest-cuts    --project-id <id> --media-id <id> [--poll]
editor:editing:suggest-status  --project-id <id> --job-id <id>
```

### Diagnostics (1)
```
editor:diagnostics:analyze --message <text> [--stack <text>] [--context <text>]
```

### MCP (1)
```
editor:mcp:forward-html --html <html-string-or-file>
```

## Architecture

```
bun run pipeline editor:media:list --project-id abc --json
        |
        v
  cli.ts (parseArgs)
        |
        v
  cli-runner.ts (switch → startsWith("editor:") → dispatch)
        |
        v
  cli-handlers-editor.ts (secondary router by module)
        |
        v
  editor-handlers-{media,timeline,analysis,generate}.ts
        |
        v
  editor-api-client.ts (HTTP fetch → http://127.0.0.1:8765)
        |
        v
  QCut Electron main process (existing HTTP API)
```

## Key Design Decisions

### 1. Single dispatch in cli-runner.ts
`cli-runner.ts` is 894 lines (near the 800-line limit). Instead of adding 59 `case` statements, add one catch-all:
```typescript
if (options.command.startsWith("editor:")) {
  return handleEditorCommand(options, onProgress);
}
```

### 2. Shared HTTP client
All editor commands use `EditorApiClient` which handles:
- Base URL configuration (`--host`, `--port` flags or `QCUT_API_HOST`/`QCUT_API_PORT` env vars)
- Auth token (`--token` flag or `QCUT_API_TOKEN` env var)
- Response envelope unwrapping (`{ success, data, error }` → returns `data` or throws)
- Connection health check before first command
- Async job polling (`--poll` with `--poll-interval`)

### 3. JSON input pattern
For flags that accept JSON bodies (`--data`, `--elements`, `--cuts`, `--changes`, `--updates`):
- Value starting with `@` → read from file: `--elements @elements.json`
- Value starting with `{` or `[` → parse as inline JSON
- Value of `-` → read from stdin
- Matches common CLI conventions (curl's `@file` pattern)

### 4. `--poll` for async jobs
Commands that start async jobs (generate, transcribe, auto-edit, suggest-cuts, export) support:
- Without `--poll`: returns `{ jobId }` immediately (default, best for scripting)
- With `--poll`: blocks until job completes, showing progress bar in TTY / JSONL events in `--stream` mode
- `--poll-interval <seconds>`: polling frequency (default 3s)
- `--timeout <seconds>`: max wait time (default 300s)
- Ctrl+C sends cancel request to the API before exiting

### 5. Connection validation
Before executing any `editor:*` command, the dispatcher calls `editor:health`. If QCut is not running, returns a clear error:
```
Error: QCut editor not running at http://127.0.0.1:8765
Start QCut with: bun run electron:dev
```

## File Manifest

### New Files (9)

| File | Purpose | Est. Lines |
|------|---------|------------|
| `electron/native-pipeline/editor-api-client.ts` | Shared HTTP client with auth, polling, health check | ~180 |
| `electron/native-pipeline/editor-api-types.ts` | TypeScript interfaces for editor CLI options | ~120 |
| `electron/native-pipeline/cli-handlers-editor.ts` | Editor command router (dispatches to sub-handlers) | ~150 |
| `electron/native-pipeline/editor-handlers-media.ts` | `editor:health`, `editor:media:*`, `editor:project:*` handlers | ~250 |
| `electron/native-pipeline/editor-handlers-timeline.ts` | `editor:timeline:*`, `editor:editing:*` handlers | ~350 |
| `electron/native-pipeline/editor-handlers-analysis.ts` | `editor:analyze:*`, `editor:transcribe:*` handlers | ~300 |
| `electron/native-pipeline/editor-handlers-generate.ts` | `editor:generate:*`, `editor:export:*`, `editor:diagnostics:*` handlers | ~250 |
| `electron/__tests__/editor-api-client.test.ts` | HTTP client + resolveJsonInput + media/project handler tests (97 tests) | 509 |
| `electron/__tests__/editor-handlers-timeline.test.ts` | Timeline + editing handler tests | 765 |
| `electron/__tests__/editor-handlers-analysis.test.ts` | Analysis + transcription handler tests | 506 |
| `electron/__tests__/editor-handlers-generate.test.ts` | Generate + export + diagnostics + MCP handler tests | 512 |
| `electron/__tests__/editor-cli-integration.test.ts` | Full dispatcher integration + uncovered handler coverage (60 tests) | 560 |

### Modified Files (2)

| File | Change |
|------|--------|
| `electron/native-pipeline/cli.ts` | Add 59 commands to `COMMANDS` array, add new flags to `parseArgs`, add help text |
| `electron/native-pipeline/cli-runner.ts` | Add import + `editor:*` catch-all dispatch |

### Total: 14 files (12 new + 2 modified), ~4,900 lines of new code + tests

## Dependency Graph

```
Phase 1: Core Infrastructure
  Subtask 1.1 (editor-api-client.ts)
  Subtask 1.2 (editor-api-types.ts)
  Subtask 1.3 (cli-handlers-editor.ts)
      ↓
  ┌───┴───────────────┬──────────────────┐
  ↓                   ↓                  ↓
Phase 1 contd.     Phase 2            Phase 3
  1.4 media          2.1 timeline       3.1 analyze
  1.5 project        2.2 editing        3.2 transcribe
      ↓                   ↓                  ↓
      └───────┬───────────┘                  |
              ↓                              ↓
           Phase 4                        Phase 4
           4.1 generate                   4.1 generate
           4.2 export                     contd.
           4.3 diagnostics
              ↓
           Phase 5: CLI Integration
           5.1 cli.ts modifications
           5.2 cli-runner.ts modifications
              ↓
           Phase 6: Tests ✅ (157 tests passing)
           6.1 editor-api-client.test.ts ✅
           6.2 editor-handlers-timeline.test.ts ✅
           6.3 editor-handlers-analysis.test.ts ✅
           6.4 editor-handlers-generate.test.ts ✅
           6.5 editor-cli-integration.test.ts ✅
```

## New CLI Flags (added to cli.ts parseArgs)

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | QCut project ID (required for most editor commands) |
| `--media-id` | string | Media file ID |
| `--element-id` | string | Timeline element ID |
| `--job-id` | string | Async job ID |
| `--track-id` | string | Timeline track ID |
| `--to-track` | string | Target track for move operations |
| `--split-time` | string | Timestamp for split operation |
| `--start-time` | string | Start time (seconds) |
| `--end-time` | string | End time (seconds) |
| `--new-name` | string | New name for rename |
| `--changes` | string | JSON changes object |
| `--updates` | string | JSON updates array |
| `--elements` | string | JSON elements array |
| `--cuts` | string | JSON cut intervals |
| `--items` | string | JSON batch import items |
| `--target` | string | Export target platform |
| `--preset` | string | Export preset name |
| `--threshold` | string | Scene detection threshold |
| `--timestamps` | string | Comma-separated timestamps |
| `--host` | string | QCut API host (default: 127.0.0.1) |
| `--port` | string | QCut API port (default: 8765) |
| `--token` | string | QCut API auth token |
| `--poll` | boolean | Auto-poll async jobs until complete |
| `--poll-interval` | string | Polling interval in seconds (default: 3) |
| `--replace` | boolean | Replace timeline on import |
| `--ripple` | boolean | Ripple edit mode |
| `--cross-track-ripple` | boolean | Cross-track ripple |
| `--dry-run` | boolean | Preview without applying (already exists) |
| `--remove-fillers` | boolean | Auto-edit: remove filler words |
| `--remove-silences` | boolean | Auto-edit: remove silences |
| `--html` | string | HTML content for MCP forwarding |
| `--message` | string | Error message for diagnostics |
| `--stack` | string | Error stack trace |

Note: `--format`, `--source`, `--data`, `--timeout`, `--url`, `--filename`, `--prompt`, `--model`, `--duration`, `--json`, `--quiet`, `--verbose` already exist in cli.ts.

## Real CLI Test Results (2026-02-23)

End-to-end CLI tests against a running QCut instance:

| Test | Command | Result |
|------|---------|--------|
| Health check | `editor:health` | **PASS** — returns version, uptime |
| Import media | `editor:media:import --source /path/to/video.mp4` | **PASS** — file copied, media ID returned |
| List media | `editor:media:list` | **PASS** — shows imported file |
| Media info | `editor:media:info --media-id ...` | **PASS** — returns metadata |
| Timeline import | `editor:timeline:import --data '{"name":"...","tracks":[...]}'` | **PASS** — elements must use `sourceName` (filename), not `mediaId` |
| Timeline export | `editor:timeline:export` | **PASS** — returns tracks + elements with correct times |
| Add text element | `editor:timeline:add-element --data '{"type":"text",...}'` | **PASS** — text elements don't need media resolution |
| Split element | `editor:timeline:split --element-id ... --split-time 10` | **PASS** — creates left (0-10s) + right (10-30s) |
| Delete element | `editor:timeline:delete-element --element-id ...` | **PASS** — element removed, duration updated |
| Project stats | `editor:project:stats` | **PASS** — returns counts, duration |
| Add media element | `editor:timeline:add-element --data '{"type":"video",...}'` | **PARTIAL** — API returns success+elementId, but renderer silently drops element if `sourceName` field missing |
| Move (same track) | `editor:timeline:move --to-track <same-track>` | **BUG** — element disappears (see bug below) |

### Bug: `moveElementToTrack()` loses element on same-track move

**File:** `apps/web/src/stores/timeline-store.ts:531-584`

When `fromTrackId === toTrackId`, the `.map()` only processes each track once. The first `if (track.id === fromTrackId)` removes the element, but the second `if (track.id === toTrackId)` never executes for the same track object. The element is removed and never added back.

**Fix:** Add an `else if` guard or handle the same-track case separately:
```typescript
if (fromTrackId === toTrackId) {
  // Same track: just reposition, don't remove+re-add
  // ... update startTime directly
} else {
  // Cross-track: remove from source, add to target
}
```

### Note: Element field naming

The renderer's `findMediaItemForElement()` resolves media by `sourceName` (filename) or `sourceId`, NOT by `mediaId` or `name`. When adding media elements via CLI, always use `sourceName: "filename.mp4"` to ensure the renderer can find the matching media file.

## Out of Scope

- WebSocket/SSE streaming from the HTTP API
- New HTTP endpoints on the server side (all 64 exist)
- Changes to Electron main process or renderer
- Interactive/TUI mode for editor commands
- Batch command files (scripting multiple editor commands)
- GUI integration of editor CLI commands

## Phase Files

| File | Scope |
|------|-------|
| [editor-cli-phase1-core.md](editor-cli-phase1-core.md) | HTTP client, types, dispatcher, media, project |
| [editor-cli-phase2-timeline.md](editor-cli-phase2-timeline.md) | Timeline + editing commands |
| [editor-cli-phase3-analysis.md](editor-cli-phase3-analysis.md) | Analysis + transcription commands |
| [editor-cli-phase4-generate-export.md](editor-cli-phase4-generate-export.md) | Generate, export, diagnostics + test plan |
