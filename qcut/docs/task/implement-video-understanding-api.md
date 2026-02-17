# Implement Video Understanding API via Claude HTTP Server

## Overview

Add a new `analyze` endpoint to QCut's Claude HTTP server that runs AICP video analysis on videos from three sources: timeline elements, media panel items, or user-provided file paths. Returns structured markdown timeline for LLM consumption.

## Architecture

```
Claude Code / LLM / External Client
  │
  POST /api/claude/analyze/:projectId
  │
  ▼
claude-http-server.ts (existing, port 8765)
  │
  ▼
claude-analyze-handler.ts (NEW)
  ├─ Resolve video source → absolute file path
  │   ├─ source: "timeline"  → get mediaId from element → resolve path
  │   ├─ source: "media"     → lookup media file by ID → resolve path
  │   └─ source: "path"      → validate & use directly
  │
  ├─ Spawn aicp binary (reuse AIPipelineManager detection)
  │   └─ aicp analyze-video -i <path> -t <type> -m <model> -o <output> -f both
  │
  └─ Return { markdown, json, outputFiles }
```

## Subtasks

---

### Subtask 1: Create `claude-analyze-handler.ts`

**Estimated time**: ~10 min
**Files**:
- `electron/claude/claude-analyze-handler.ts` (NEW, ~200 lines)
- `electron/claude/utils/helpers.ts` (read-only reference)

**What to implement**:

```typescript
// Core function signatures

/** Resolve a video source to an absolute file path */
export async function resolveVideoPath(
  projectId: string,
  source: AnalyzeSource
): Promise<string>

/** Run AICP analysis on a video file, return markdown + JSON results */
export async function analyzeVideo(
  projectId: string,
  options: AnalyzeOptions
): Promise<AnalyzeResult>

/** Setup IPC handlers for analyze */
export function setupClaudeAnalyzeIPC(): void
```

**Source resolution logic**:

| Source type | Input | Resolution |
|-------------|-------|------------|
| `"timeline"` | `elementId` | Get timeline from renderer → find element → get `sourceId`/`mediaId` → resolve to file path via `getMediaPath(projectId)` |
| `"media"` | `mediaId` | Call `getMediaInfo(projectId, mediaId)` → use `.path` field |
| `"path"` | `filePath` | Validate with `isValidSourcePath()` + `fs.existsSync()` → use directly |

**AICP invocation** (reuse binary detection from `ai-pipeline-handler.ts`):
```typescript
// Spawn the aicp binary with:
// aicp analyze-video -i <resolvedPath> -t <type> -m <model> -o <outputDir> -f both
//
// Output dir: ~/Documents/QCut/Projects/{projectId}/analysis/
// Parse: read the generated .md and .json files from output dir
```

**Key reference files**:
- `electron/ai-pipeline-handler.ts:150-220` — binary detection logic to reuse
- `electron/claude/claude-media-handler.ts:20-60` — `getMediaInfo()` pattern
- `electron/claude/claude-timeline-handler.ts:30-80` — `requestTimelineFromRenderer()` pattern
- `electron/claude/utils/helpers.ts:1-50` — `getProjectPath()`, `isValidSourcePath()`

---

### Subtask 2: Add types to `electron/types/claude-api.ts`

**Estimated time**: ~5 min
**Files**:
- `electron/types/claude-api.ts` (EDIT, append types)

**Types to add**:

```typescript
export interface AnalyzeSource {
  type: "timeline" | "media" | "path";
  elementId?: string;   // when type = "timeline"
  mediaId?: string;     // when type = "media"
  filePath?: string;    // when type = "path"
}

export interface AnalyzeOptions {
  source: AnalyzeSource;
  analysisType?: "timeline" | "describe" | "transcribe";  // default: "timeline"
  model?: string;        // default: "gemini-2.5-flash"
  format?: "md" | "json" | "both";  // default: "md"
}

export interface AnalyzeResult {
  success: boolean;
  markdown?: string;     // full markdown content
  json?: Record<string, unknown>;  // parsed JSON result
  outputFiles?: string[];           // absolute paths to saved files
  videoPath?: string;    // resolved video path
  duration?: number;     // analysis duration in seconds
  cost?: number;         // estimated cost
  error?: string;
}
```

---

### Subtask 3: Register routes in `claude-http-server.ts`

**Estimated time**: ~5 min
**Files**:
- `electron/claude/claude-http-server.ts` (EDIT, ~30 lines added)

**Routes to add** (before the "Create and start the server" section):

```typescript
// ==========================================================================
// Video Analysis routes
// ==========================================================================

// Analyze a video (from timeline, media panel, or file path)
router.post("/api/claude/analyze/:projectId", async (req) => {
  if (!req.body?.source) {
    throw new HttpError(400, "Missing 'source' in request body");
  }
  return analyzeVideo(req.params.projectId, {
    source: req.body.source,
    analysisType: req.body.analysisType,
    model: req.body.model,
    format: req.body.format,
  });
});

// List available analysis models
router.get("/api/claude/analyze/models", async () => {
  return listAnalyzeModels();
});
```

**Import to add at top**:
```typescript
import { analyzeVideo, listAnalyzeModels } from "./claude-analyze-handler.js";
```

---

### Subtask 4: Register IPC + export in `index.ts`

**Estimated time**: ~3 min
**Files**:
- `electron/claude/index.ts` (EDIT, ~5 lines added)

**Changes**:
- Add `export { setupClaudeAnalyzeIPC } from "./claude-analyze-handler.js";`
- Call `setupClaudeAnalyzeIPC()` inside `setupAllClaudeIPC()`

---

### Subtask 5: Add electronAPI types for frontend

**Estimated time**: ~3 min
**Files**:
- `apps/web/src/types/electron.d.ts` (EDIT, ~10 lines added)

**Add under `window.electronAPI.claude`**:
```typescript
analyze: {
  run(projectId: string, options: AnalyzeOptions): Promise<AnalyzeResult>;
  models(): Promise<{ models: AnalyzeModel[] }>;
};
```

---

### Subtask 6: Add preload bridge

**Estimated time**: ~3 min
**Files**:
- `electron/preload-integrations.ts` (EDIT, ~10 lines added)

**Add `analyze` section** to the claude preload API:
```typescript
analyze: {
  run: (projectId, options) => ipcRenderer.invoke("claude:analyze:run", projectId, options),
  models: () => ipcRenderer.invoke("claude:analyze:models"),
},
```

---

### Subtask 7: Unit tests

**Estimated time**: ~10 min
**Files**:
- `electron/claude/__tests__/claude-analyze-handler.test.ts` (NEW)

**Test cases**:

1. **resolveVideoPath — media source**: Mock `getMediaInfo` returning a path, verify correct resolution
2. **resolveVideoPath — path source**: Valid path resolves, invalid path throws
3. **resolveVideoPath — path source security**: Reject path traversal (`../../../etc/passwd`)
4. **analyzeVideo — success**: Mock `child_process.spawn`, verify it invokes aicp with correct args and parses output files
5. **analyzeVideo — missing FAL_KEY**: Returns error about missing API key
6. **analyzeVideo — invalid source type**: Returns 400 error
7. **listAnalyzeModels**: Returns expected model list

---

## API Usage Examples

### Analyze video from media panel
```bash
curl -X POST http://localhost:8765/api/claude/analyze/my-project \
  -H "Content-Type: application/json" \
  -d '{
    "source": { "type": "media", "mediaId": "abc123" },
    "analysisType": "timeline",
    "model": "gemini-2.5-flash"
  }'
```

### Analyze video from timeline element
```bash
curl -X POST http://localhost:8765/api/claude/analyze/my-project \
  -H "Content-Type: application/json" \
  -d '{
    "source": { "type": "timeline", "elementId": "element_xyz" },
    "analysisType": "transcribe"
  }'
```

### Analyze video from file path
```bash
curl -X POST http://localhost:8765/api/claude/analyze/my-project \
  -H "Content-Type: application/json" \
  -d '{
    "source": { "type": "path", "filePath": "/Users/peter/Downloads/video.mp4" },
    "analysisType": "timeline",
    "model": "gemini-2.5-flash",
    "format": "md"
  }'
```

### Response format
```json
{
  "success": true,
  "markdown": "# Detailed Video Timeline Analysis\n\n...",
  "json": { "timeline": "...", "provider": "fal", "model": "...", "usage": {} },
  "outputFiles": [
    "/Users/peter/Documents/QCut/Projects/my-project/analysis/video_detailed_timeline.md",
    "/Users/peter/Documents/QCut/Projects/my-project/analysis/video_detailed_timeline.json"
  ],
  "videoPath": "/Users/peter/Documents/QCut/Projects/my-project/media/video.mp4",
  "duration": 12.5,
  "cost": 0.001637
}
```

## Key Design Decisions

1. **Reuse existing binary detection** from `ai-pipeline-handler.ts` rather than duplicating — import the `findAicpBinary()` utility
2. **Output to project-scoped directory** (`{projectDir}/analysis/`) — keeps results alongside project files
3. **Return markdown directly** in response — no extra read needed by the LLM consumer
4. **FAL_KEY injection** via `getDecryptedApiKeys()` — consistent with existing PersonaPlex pattern in HTTP server
5. **Synchronous spawn with timeout** — video analysis takes 30-60s, use 5-minute timeout matching existing AICP pattern

## File Summary

| File | Action | Lines |
|------|--------|-------|
| `electron/claude/claude-analyze-handler.ts` | CREATE | ~200 |
| `electron/types/claude-api.ts` | EDIT | +20 |
| `electron/claude/claude-http-server.ts` | EDIT | +30 |
| `electron/claude/index.ts` | EDIT | +5 |
| `apps/web/src/types/electron.d.ts` | EDIT | +10 |
| `electron/preload-integrations.ts` | EDIT | +10 |
| `electron/claude/__tests__/claude-analyze-handler.test.ts` | CREATE | ~120 |
| **Total** | | **~395** |
