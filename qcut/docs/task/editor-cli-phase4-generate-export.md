# Editor CLI Phase 4: Generate + Export + Diagnostics + CLI Integration + Tests

> **Date:** 2026-02-22
> **Goal:** Implement `editor:generate:*` (6 commands), `editor:export:*` (5 commands), `editor:diagnostics:*` (1 command), `editor:mcp:*` (1 command), integrate all commands into cli.ts/cli-runner.ts, and write comprehensive tests.
> **Reference:** [editor-cli-overview.md](editor-cli-overview.md), `electron/claude/claude-generate-handler.ts`, `electron/claude/claude-export-handler.ts`, `electron/claude/claude-diagnostics-handler.ts`
> **Status:** Not started
> **Depends on:** Phase 1 (Subtasks 1.1-1.3)

---

## Subtask 4.1: Implement Generate Commands

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-generate.ts` (create, ~250 lines)

**Changes:**

### editor:generate:start
```
POST /api/claude/generate/:projectId/start
Body: {
  model: <string>,
  prompt: <string>,
  imageUrl?: <string>,
  videoUrl?: <string>,
  duration?: <number>,
  aspectRatio?: <string>,
  resolution?: <string>,
  negativePrompt?: <string>,
  addToTimeline?: <boolean>,
  trackId?: <string>,
  startTime?: <number>
}
```
**Required:** `--project-id`, `--model`, `--prompt`
**Optional:** `--image-url`, `--video-url`, `--duration`, `--aspect-ratio`, `--resolution`, `--negative-prompt`, `--add-to-timeline`, `--track-id`, `--start-time`, `--poll`
**Behavior:**
- Without `--poll`: returns `{ jobId }` immediately
- With `--poll`: polls until complete, shows progress (percent + message), returns final result with output URL/mediaId

**Note:** Reuses existing `--model`, `--prompt`, `--image-url`, `--duration`, `--aspect-ratio`, `--resolution`, `--negative-prompt` flags that already exist in `cli.ts` for standalone generation commands.

### editor:generate:status
```
GET /api/claude/generate/:projectId/jobs/:jobId
```
**Required:** `--project-id`, `--job-id`
**Output:** Job details (status, progress, message, model, result)

### editor:generate:list-jobs
```
GET /api/claude/generate/:projectId/jobs
```
**Required:** `--project-id`
**Output:** Table of jobs (jobId, status, model, progress, createdAt)

### editor:generate:cancel
```
POST /api/claude/generate/:projectId/jobs/:jobId/cancel
```
**Required:** `--project-id`, `--job-id`

### editor:generate:models
```
GET /api/claude/generate/models
```
No required flags. Returns available generation models.
**Output:** Table of models (key, name, category, provider)

### editor:generate:estimate-cost
```
POST /api/claude/generate/estimate-cost
Body: { model: <string>, duration?: <number>, resolution?: <string> }
```
**Required:** `--model`
**Optional:** `--duration`, `--resolution`
**Output:** `{ estimatedCost, currency }`

---

## Subtask 4.2: Implement Export Commands

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-generate.ts` (extend)

**Changes:**

### editor:export:presets
```
GET /api/claude/export/presets
```
No required flags. Returns all export presets.
**Output:** Table of presets:
| Preset | Resolution | FPS | Bitrate |
|--------|-----------|-----|---------|
| youtube-4k | 3840x2160 | 60 | 45Mbps |
| tiktok | 1080x1920 | 30 | 6Mbps |
| ... | | | |

### editor:export:recommend
```
GET /api/claude/export/:projectId/recommend/:target
```
**Required:** `--project-id`, `--target`
**Valid targets:** `youtube`, `youtube-4k`, `youtube-1080p`, `youtube-720p`, `tiktok`, `instagram-reel`, `instagram-post`, `instagram-landscape`, `twitter`, `linkedin`, `discord`
**Output:** Recommended settings for the target platform

### editor:export:start
```
POST /api/claude/export/:projectId/start
Body: { preset?: <string>, settings?: { width?, height?, fps?, format?, codec?, bitrate? }, outputPath?: <string> }
```
**Required:** `--project-id`
**Optional:** `--preset`, `--data` (custom settings JSON), `--output-dir`, `--poll`
**Behavior:**
- Without `--poll`: returns `{ jobId }` immediately
- With `--poll`: polls until complete, shows progress (currentFrame/totalFrames, percent, timeRemaining)

**Note:** Either `--preset` or `--data` (custom settings) should be provided. If both, `--preset` takes precedence.

### editor:export:status
```
GET /api/claude/export/:projectId/jobs/:jobId
```
**Required:** `--project-id`, `--job-id`
**Output:** Export job details (status, progress, currentFrame, totalFrames, timeRemaining, outputPath, fileSize)

### editor:export:list-jobs
```
GET /api/claude/export/:projectId/jobs
```
**Required:** `--project-id`
**Output:** Table of export jobs

---

## Subtask 4.3: Implement Diagnostics + MCP Commands

**Time:** ~15 min
**Files:**
- `electron/native-pipeline/editor-handlers-generate.ts` (extend)

**Changes:**

### editor:diagnostics:analyze
```
POST /api/claude/diagnostics/analyze
Body: { message: <string>, stack?: <string>, context?: <string>, timestamp?: <number>, componentStack?: <string> }
```
**Required:** `--message`
**Optional:** `--stack`, `--context`
**Output:** Diagnostic result (errorType, severity, possibleCauses, suggestedFixes, canAutoFix, systemInfo)

### editor:mcp:forward-html
```
POST /api/claude/mcp/app
Body: { html: <string>, toolName?: <string> }
```
**Required:** `--html` (inline HTML string or `@file.html`)
**Optional:** `--tool-name`
**Output:** `{ forwarded: boolean }`

**HTML input handling:**
```typescript
let html = options.html;
if (html?.startsWith("@")) {
  const filePath = html.slice(1);
  html = await fs.promises.readFile(filePath, "utf-8");
}
```

---

## Subtask 4.4: CLI Integration — Modify cli.ts

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/cli.ts` (modify)

**Changes:**

### 4.4.1: Add commands to COMMANDS array (after line 58)
```typescript
const COMMANDS = [
  // ... existing 34 commands ...
  // Editor commands (59)
  "editor:health",
  "editor:media:list",
  "editor:media:info",
  "editor:media:import",
  "editor:media:import-url",
  "editor:media:batch-import",
  "editor:media:extract-frame",
  "editor:media:rename",
  "editor:media:delete",
  "editor:timeline:export",
  "editor:timeline:import",
  "editor:timeline:add-element",
  "editor:timeline:batch-add",
  "editor:timeline:update-element",
  "editor:timeline:batch-update",
  "editor:timeline:delete-element",
  "editor:timeline:batch-delete",
  "editor:timeline:split",
  "editor:timeline:move",
  "editor:timeline:arrange",
  "editor:timeline:select",
  "editor:timeline:get-selection",
  "editor:timeline:clear-selection",
  "editor:project:settings",
  "editor:project:update-settings",
  "editor:project:stats",
  "editor:project:summary",
  "editor:project:report",
  "editor:export:presets",
  "editor:export:recommend",
  "editor:export:start",
  "editor:export:status",
  "editor:export:list-jobs",
  "editor:generate:start",
  "editor:generate:status",
  "editor:generate:list-jobs",
  "editor:generate:cancel",
  "editor:generate:models",
  "editor:generate:estimate-cost",
  "editor:analyze:video",
  "editor:analyze:models",
  "editor:analyze:scenes",
  "editor:analyze:frames",
  "editor:analyze:fillers",
  "editor:transcribe:run",
  "editor:transcribe:start",
  "editor:transcribe:status",
  "editor:transcribe:list-jobs",
  "editor:transcribe:cancel",
  "editor:editing:batch-cuts",
  "editor:editing:delete-range",
  "editor:editing:auto-edit",
  "editor:editing:auto-edit-status",
  "editor:editing:auto-edit-list",
  "editor:editing:suggest-cuts",
  "editor:editing:suggest-status",
  "editor:diagnostics:analyze",
  "editor:mcp:forward-html",
] as const;
```

### 4.4.2: Add new flags to parseArgs options
Add after existing option definitions (~line 200+):
```typescript
// Editor-specific flags
"project-id": { type: "string" },
"media-id": { type: "string" },
"element-id": { type: "string" },
"job-id": { type: "string" },
"to-track": { type: "string" },
"split-time": { type: "string" },
"start-time": { type: "string" },
"end-time": { type: "string" },
"new-name": { type: "string" },
"changes": { type: "string" },
"updates": { type: "string" },
"elements": { type: "string" },
"cuts": { type: "string" },
"items": { type: "string" },
"target": { type: "string" },
"preset": { type: "string" },
"threshold": { type: "string" },
"timestamps": { type: "string" },
"host": { type: "string" },
"port": { type: "string" },
"token": { type: "string" },
"poll": { type: "boolean", default: false },
"poll-interval": { type: "string" },
"replace": { type: "boolean", default: false },
"ripple": { type: "boolean", default: false },
"cross-track-ripple": { type: "boolean", default: false },
"remove-fillers": { type: "boolean", default: false },
"remove-silences": { type: "boolean", default: false },
"html": { type: "string" },
"message": { type: "string" },
"stack": { type: "string" },
"add-to-timeline": { type: "boolean", default: false },
"include-fillers": { type: "boolean", default: false },
"include-silences": { type: "boolean", default: false },
"include-scenes": { type: "boolean", default: false },
"no-diarize": { type: "boolean", default: false },
"tool-name": { type: "string" },
"clear-log": { type: "boolean", default: false },
"analysis-type": { type: "string" },
```

### 4.4.3: Add camelCase mapping in parseCliArgs
Map kebab-case flags to camelCase properties on CLIRunOptions:
```typescript
if (values["project-id"]) result.projectId = values["project-id"];
if (values["media-id"]) result.mediaId = values["media-id"];
if (values["element-id"]) result.elementId = values["element-id"];
if (values["job-id"]) result.jobId = values["job-id"];
// ... etc for all new flags
```

### 4.4.4: Add help text for editor commands
Add a new section to `printHelp()`:
```
Editor Commands (requires running QCut):
  editor:health                  Check QCut editor connectivity
  editor:media:list              List media files in project
  editor:media:import            Import local file to project
  editor:timeline:export         Export timeline as JSON or markdown
  editor:timeline:add-element    Add element to timeline
  editor:editing:auto-edit       Auto-remove fillers and silences
  editor:generate:start          Start AI generation job
  editor:export:start            Export project to video file
  ... (use --help with any editor command for details)

Editor Flags:
  --project-id <id>    QCut project ID
  --media-id <id>      Media file ID
  --element-id <id>    Timeline element ID
  --job-id <id>        Async job ID
  --poll               Auto-poll async jobs until complete
  --host <host>        QCut API host (default: 127.0.0.1)
  --port <port>        QCut API port (default: 8765)
  --token <token>      QCut API auth token
```

**Reference:** Existing help text in `cli.ts` `printHelp()` function

---

## Subtask 4.5: CLI Integration — Modify cli-runner.ts

**Time:** ~15 min
**Files:**
- `electron/native-pipeline/cli-runner.ts` (modify, ~5 lines added)

**Changes:**

### 4.5.1: Add import
```typescript
import { handleEditorCommand } from "./cli-handlers-editor.js";
```

### 4.5.2: Add editor dispatch in the switch statement
Add before the `default` case in `CLIPipelineRunner.run()` (~line 280):
```typescript
default:
  // Editor commands — proxy to QCut HTTP API
  if (options.command.startsWith("editor:")) {
    return handleEditorCommand(options, onProgress);
  }
  return {
    success: false,
    error: `Unknown command: ${options.command}. Run with --help.`,
  };
```

**Note:** This replaces the existing `default` case. The `editor:*` check goes in the default branch so it doesn't add lines to the already-large switch statement.

---

## Subtask 4.6: Comprehensive Test Plan

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/__tests__/editor-api-client.test.ts` (finalize)
- `electron/native-pipeline/__tests__/editor-handlers.test.ts` (finalize)

**Changes:**

### Unit Test Matrix

| Test File | Test Group | Cases | Description |
|-----------|-----------|-------|-------------|
| `editor-api-client.test.ts` | `EditorApiClient` | 10 | HTTP client core (get/post/patch/delete, auth, errors) |
| `editor-api-client.test.ts` | `pollJob` | 5 | Async polling (complete, fail, cancel, timeout, progress) |
| `editor-api-client.test.ts` | `resolveJsonInput` | 4 | JSON input parsing (@file, inline, stdin, errors) |
| `editor-handlers.test.ts` | Media handlers | 8 | All 8 media commands |
| `editor-handlers.test.ts` | Project handlers | 5 | All 5 project commands |
| `editor-handlers.test.ts` | Timeline handlers | 10 | Key timeline commands (export, import, CRUD, split, arrange) |
| `editor-handlers.test.ts` | Editing handlers | 6 | Cuts, range delete, auto-edit sync/async, suggest-cuts |
| `editor-handlers.test.ts` | Analysis handlers | 5 | Video analysis, scenes, frames, fillers, source parsing |
| `editor-handlers.test.ts` | Transcription handlers | 5 | Sync, async+poll, status, list, cancel |
| `editor-handlers.test.ts` | Generate handlers | 5 | Start+poll, status, models, cancel, estimate-cost |
| `editor-handlers.test.ts` | Export handlers | 4 | Presets, recommend, start+poll, status |
| `editor-handlers.test.ts` | Diagnostics | 2 | Analyze error, MCP forward |
| **Total** | | **69** | |

### Mock Server Pattern
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

let mockServer: ReturnType<typeof Bun.serve>;
let client: EditorApiClient;
const responses = new Map<string, unknown>();

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0, // random port
    fetch(req) {
      const url = new URL(req.url);
      const key = `${req.method} ${url.pathname}`;
      const response = responses.get(key);
      if (response) {
        return Response.json({ success: true, data: response, timestamp: Date.now() });
      }
      return Response.json({ success: false, error: "Not found", timestamp: Date.now() }, { status: 404 });
    },
  });
  client = new EditorApiClient({ baseUrl: `http://localhost:${mockServer.port}` });
});

afterAll(() => mockServer.stop());
```

### Smoke Test Script
Create a simple smoke test script that can be run against a real QCut instance:
```bash
#!/bin/bash
# smoke-test-editor-cli.sh
set -e

echo "Testing editor CLI commands against running QCut..."

# Health check
bun run pipeline editor:health --json

# List projects
ls ~/Documents/QCut/Projects/ 2>/dev/null || echo "No projects found"

# If project exists, test basic commands
PROJECT_ID="${1:-test-project}"
bun run pipeline editor:media:list --project-id "$PROJECT_ID" --json
bun run pipeline editor:timeline:export --project-id "$PROJECT_ID" --format md
bun run pipeline editor:project:stats --project-id "$PROJECT_ID" --json
bun run pipeline editor:export:presets --json
bun run pipeline editor:generate:models --json

echo "All smoke tests passed!"
```

---

## Subtask 4.7: Update Native CLI Skill Documentation

**Time:** ~15 min
**Files:**
- `.claude/skills/native-cli/SKILL.md` (modify — add editor commands section)
- `.claude/skills/native-cli/REFERENCE.md` (modify — add editor command reference)

**Changes:**

Add a new section to SKILL.md:
```markdown
## Editor Commands (requires running QCut)

Control a running QCut editor instance from the CLI:

```bash
# Check connectivity
bun run pipeline editor:health

# Import media and add to timeline
bun run pipeline editor:media:import --project-id my-project --source /path/to/video.mp4
bun run pipeline editor:timeline:add-element --project-id my-project --data '{"type":"video","trackIndex":0,"sourceName":"video.mp4"}'

# Transcribe and auto-edit
bun run pipeline editor:transcribe:start --project-id my-project --media-id abc --poll
bun run pipeline editor:editing:auto-edit --project-id my-project --element-id el1 --media-id abc --remove-fillers --dry-run

# Export for platform
bun run pipeline editor:export:recommend --project-id my-project --target tiktok
bun run pipeline editor:export:start --project-id my-project --preset tiktok --poll
```
```

Add full flag reference for all editor commands to REFERENCE.md.

---

## Files Impact Summary

| File | Action | Lines |
|------|--------|-------|
| `electron/native-pipeline/editor-handlers-generate.ts` | Create | ~250 |
| `electron/native-pipeline/cli.ts` | Modify | ~100 lines added |
| `electron/native-pipeline/cli-runner.ts` | Modify | ~5 lines added |
| `electron/native-pipeline/__tests__/editor-api-client.test.ts` | Finalize | ~200 |
| `electron/native-pipeline/__tests__/editor-handlers.test.ts` | Finalize | ~300 |
| `.claude/skills/native-cli/SKILL.md` | Modify | ~30 lines added |
| `.claude/skills/native-cli/REFERENCE.md` | Modify | ~200 lines added |
| **Total** | | **~1,085** |

## API Endpoint Coverage

| Command | HTTP Method | Endpoint |
|---------|-------------|----------|
| `editor:generate:start` | POST | `/api/claude/generate/:projectId/start` |
| `editor:generate:status` | GET | `/api/claude/generate/:projectId/jobs/:jobId` |
| `editor:generate:list-jobs` | GET | `/api/claude/generate/:projectId/jobs` |
| `editor:generate:cancel` | POST | `/api/claude/generate/:projectId/jobs/:jobId/cancel` |
| `editor:generate:models` | GET | `/api/claude/generate/models` |
| `editor:generate:estimate-cost` | POST | `/api/claude/generate/estimate-cost` |
| `editor:export:presets` | GET | `/api/claude/export/presets` |
| `editor:export:recommend` | GET | `/api/claude/export/:projectId/recommend/:target` |
| `editor:export:start` | POST | `/api/claude/export/:projectId/start` |
| `editor:export:status` | GET | `/api/claude/export/:projectId/jobs/:jobId` |
| `editor:export:list-jobs` | GET | `/api/claude/export/:projectId/jobs` |
| `editor:diagnostics:analyze` | POST | `/api/claude/diagnostics/analyze` |
| `editor:mcp:forward-html` | POST | `/api/claude/mcp/app` |

## Full Implementation Checklist

- [ ] Phase 1: `editor-api-client.ts`, `editor-api-types.ts`, `cli-handlers-editor.ts`, `editor-handlers-media.ts`
- [ ] Phase 2: `editor-handlers-timeline.ts`
- [ ] Phase 3: `editor-handlers-analysis.ts`
- [ ] Phase 4: `editor-handlers-generate.ts`
- [ ] CLI integration: Modify `cli.ts` + `cli-runner.ts`
- [ ] Tests: `editor-api-client.test.ts` + `editor-handlers.test.ts`
- [ ] Skill docs: Update `SKILL.md` + `REFERENCE.md`
- [ ] Smoke test: Manual test against running QCut
