# Stage 5: Export & Documentation

> **Goal**: Let Claude Code trigger video export and generate an edit summary — completing the end-to-end pipeline
> **Estimated effort**: ~3 hours total across 4 subtasks
> **Dependencies**: Stage 4 (timeline organized and ready to export)

---

## Implementation Status (2026-02-19)

Stage 5 has been implemented.

- Subtask 5.1 (Export Trigger via HTTP): Done
- Subtask 5.2 (Export Progress Polling): Done
- Subtask 5.3 (Edit Summary Generation): Done
- Subtask 5.4 (Pipeline Report Export): Done

### Implemented Endpoints

- `POST /api/claude/export/:projectId/start`
- `GET /api/claude/export/:projectId/jobs/:jobId`
- `GET /api/claude/export/:projectId/jobs`
- `GET /api/claude/project/:projectId/summary`
- `POST /api/claude/project/:projectId/report`

### Implemented Files

- `electron/claude/claude-export-handler.ts` (job lifecycle + export runner + progress updates)
- `electron/claude/claude-summary-handler.ts` (project summary + pipeline report generation)
- `electron/claude/claude-operation-log.ts` (in-memory operation log)
- `electron/claude/claude-http-server.ts` (new routes + operation logging hooks)
- `electron/types/claude-api.ts` (new export/summary/report types)
- `electron/__tests__/claude-export-trigger.test.ts`
- `electron/__tests__/claude-export-progress.test.ts`
- `electron/__tests__/claude-summary-handler.test.ts`
- `electron/__tests__/claude-pipeline-report.test.ts`

### Verification

- `bunx vitest run electron/__tests__/claude-export-trigger.test.ts electron/__tests__/claude-export-progress.test.ts electron/__tests__/claude-summary-handler.test.ts electron/__tests__/claude-pipeline-report.test.ts electron/claude/__tests__/claude-http-server.test.ts`
- Result: 51 tests passed

### Implementation Notes

- Export jobs run in the main process and are tracked in-memory by job ID.
- Progress supports HTTP polling (`jobs/:jobId`) and job listing (`jobs`).
- The pipeline report uses operation logs plus a generated project summary.
- Operation logging is now recorded for key Stage 1/2/5 HTTP actions.

### Real QCut E2E Test (Manual + API)

Use this to validate Stage 5 against a real running QCut app.

1. Start QCut in dev mode.
   - Terminal 1: `bun run dev`
   - Terminal 2: `bun run electron:dev`
2. Open/create a real project in QCut UI and note the `projectId` from the editor URL.
3. Keep the project open and ensure timeline has at least one video clip.

Optional fully-API setup (if timeline is empty):

1. Set env vars in your shell:
   - `export PROJECT_ID=\"<your_project_id>\"`
   - `export API=\"http://127.0.0.1:8765/api/claude\"`
2. Import media:
   - `curl -s -X POST \"$API/media/$PROJECT_ID/import\" -H 'Content-Type: application/json' -d '{\"source\":\"/absolute/path/to/video.mp4\"}'`
3. Add timeline element from returned media:
   - `curl -s -X POST \"$API/timeline/$PROJECT_ID/elements\" -H 'Content-Type: application/json' -d '{\"type\":\"media\",\"sourceId\":\"<media_id>\",\"startTime\":0,\"duration\":5}'`

Run Stage 5 export test:

1. Start export:
   - `curl -s -X POST \"$API/export/$PROJECT_ID/start\" -H 'Content-Type: application/json' -d '{\"preset\":\"youtube-1080p\"}'`
2. Capture returned `jobId`.
3. Poll progress:
   - `curl -s \"$API/export/$PROJECT_ID/jobs/<jobId>\"`
4. Repeat polling until `status` is `completed` or `failed`.
5. Verify output file exists at returned `outputPath` when completed.
6. List recent jobs:
   - `curl -s \"$API/export/$PROJECT_ID/jobs\"`

Run Stage 5 summary/report test:

1. Get summary:
   - `curl -s \"$API/project/$PROJECT_ID/summary\"`
2. Generate report (save to disk):
   - `curl -s -X POST \"$API/project/$PROJECT_ID/report\" -H 'Content-Type: application/json' -d '{\"saveToDisk\":true,\"outputDir\":\"docs/task\"}'`
3. Verify response includes `savedTo` and markdown content.
4. Open saved file and confirm it contains Stage 1-5 sections.

Expected pass criteria:

- Export start returns `jobId` immediately.
- Export job transitions `queued -> exporting -> completed` (or explicit `failed` with error).
- Completed job includes `outputPath`, `duration`, and `fileSize`.
- Summary returns markdown with settings/media/timeline/exports sections.
- Report returns markdown with Stage 1-5 and statistics.

If API auth is enabled (`QCUT_API_TOKEN`), add:

- `-H \"Authorization: Bearer <token>\"` to all `curl` commands.

---

## Current State

| Capability | Status | File |
|---|---|---|
| FFmpeg export (3 modes: copy, normalize, filter-chain) | Ready | `electron/ffmpeg-export-handler.ts` (1220 lines) |
| 10 platform presets (YouTube, TikTok, Instagram, etc.) | Ready | `electron/claude/claude-export-handler.ts` (205 lines) |
| Export preset recommendation | Ready | `GET /api/claude/export/presets`, `GET /recommend/:target` |
| Progress monitoring via IPC | Ready | `ffmpeg-progress` IPC event |
| Project stats | Ready | `GET /api/claude/project/:id/stats` |
| Timeline export (JSON/Markdown) | Ready | `GET /api/claude/timeline/:id` |

**What was missing (now implemented below)**: HTTP export trigger, export progress polling, edit summary generation, and pipeline report export.

---

## Subtask 5.1: Export Trigger via HTTP

**What**: `POST /api/claude/export/:projectId/start`

Triggers FFmpeg export from the Claude HTTP API, returning a job ID for progress tracking.

**Relevant files**:
- `electron/ffmpeg-export-handler.ts` (1220 lines) — existing IPC `export-video-cli`
- `electron/claude/claude-export-handler.ts` (205 lines) — existing presets/recommendations
- `electron/claude/claude-http-server.ts` — register routes
- `electron/types/claude-api.ts` — add ExportJob types

**Implementation**:
```typescript
// Add to claude-export-handler.ts

interface ExportJobRequest {
  preset?: string;           // Preset ID (e.g. "youtube-1080p") or...
  settings?: {               // ...custom settings
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: string;
    format?: string;
    codec?: string;
  };
  outputPath?: string;       // Custom output path (default: Documents/QCut/Exports/)
}

interface ExportJob {
  jobId: string;
  status: "queued" | "exporting" | "completed" | "failed";
  progress: number;          // 0.0 - 1.0
  outputPath?: string;       // Set when completed
  error?: string;            // Set when failed
  startedAt: number;
  completedAt?: number;
}

// In-memory job tracking (simple Map, clears on app restart)
const exportJobs = new Map<string, ExportJob>();
```

**API contract**:
```
POST /api/claude/export/:projectId/start
Body: { "preset": "youtube-1080p" }
Response: {
  "success": true,
  "data": { "jobId": "export_abc123", "status": "queued" }
}
```

**Internally**:
1. Validate preset or custom settings
2. Generate job ID
3. Get timeline state from renderer via IPC
4. Start FFmpeg export (fire-and-forget)
5. Listen for `ffmpeg-progress` IPC events → update job status
6. Return job ID immediately

**Test file**: `electron/__tests__/claude-export-trigger.test.ts`

**Tests to write**:
- Starts export with valid preset
- Starts export with custom settings
- Returns job ID immediately
- Rejects invalid preset ID
- Rejects export when timeline is empty
- Handles concurrent export requests (queue or reject)

---

## Subtask 5.2: Export Progress Polling

**What**: `GET /api/claude/export/:projectId/jobs/:jobId`

Polls export job status and progress.

**Relevant files**:
- `electron/claude/claude-export-handler.ts` — add progress tracking
- `electron/claude/claude-http-server.ts` — register route
- `electron/ffmpeg-export-handler.ts` — existing `ffmpeg-progress` event format

**API contract**:
```
GET /api/claude/export/:projectId/jobs/:jobId
Response: {
  "success": true,
  "data": {
    "jobId": "export_abc123",
    "status": "exporting",
    "progress": 0.65,
    "currentFrame": 1950,
    "totalFrames": 3000,
    "fps": 45.2,
    "estimatedTimeRemaining": 23.5,
    "outputPath": null
  }
}
```

**When completed**:
```json
{
  "status": "completed",
  "progress": 1.0,
  "outputPath": "/Users/peter/Documents/QCut/Exports/my-video-2026-02-19.mp4",
  "duration": 45.2,
  "fileSize": 52428800
}
```

**Also add**: `GET /api/claude/export/:projectId/jobs` — list all recent export jobs.

**Progress bridge**: Listen for the existing `ffmpeg-progress` IPC event in the main process, update the in-memory job map:
```typescript
// In claude-export-handler.ts
ipcMain.on('ffmpeg-progress', (_event, data) => {
  const job = exportJobs.get(data.jobId);
  if (job) {
    job.progress = data.progress;
    job.status = data.progress >= 1.0 ? 'completed' : 'exporting';
  }
});
```

**Test file**: `electron/__tests__/claude-export-progress.test.ts`

**Tests to write**:
- Returns current progress for active export
- Returns completed status with output path
- Returns failed status with error message
- Returns 404 for unknown job ID
- Lists all recent export jobs
- Progress updates correctly from IPC events

---

## Subtask 5.3: Edit Summary Generation

**What**: `GET /api/claude/project/:projectId/summary`

Generates a human-readable markdown summary of the current project state and editing operations.

**Relevant files**:
- `electron/claude/claude-project-handler.ts` — existing stats
- `electron/claude/claude-timeline-handler.ts` — timeline export
- `electron/claude/claude-export-handler.ts` — export history
- `electron/types/claude-api.ts` — add summary types

**Implementation**:
```typescript
// New file: electron/claude/claude-summary-handler.ts (<200 lines)

interface ProjectSummary {
  markdown: string;          // Full markdown report
  stats: {
    totalDuration: number;
    trackCount: number;
    elementCount: number;
    mediaFileCount: number;
    exportCount: number;
  };
}

function generateProjectSummary(
  timeline: ClaudeTimeline,
  mediaFiles: MediaFile[],
  exportJobs: ExportJob[],
  settings: ProjectSettings
): ProjectSummary {
  // Generate structured markdown:
  // ## Project: {name}
  // ### Settings
  // - Resolution: 1920x1080 @ 30fps
  // ### Media Library
  // - 5 videos, 2 images, 1 audio
  // ### Timeline
  // - Track 1 (media): 3 clips, total 45s
  // - Track 2 (text): 2 titles
  // ### Exports
  // - youtube-1080p: completed 2026-02-19 (52MB)
}
```

**API contract**:
```
GET /api/claude/project/:projectId/summary
Response: {
  "success": true,
  "data": {
    "markdown": "## Project: My Video\n...",
    "stats": { ... }
  }
}
```

**Test file**: `electron/__tests__/claude-summary-handler.test.ts`

**Tests to write**:
- Generates valid markdown for populated project
- Includes all track summaries
- Includes media library counts
- Includes export history
- Handles empty project gracefully
- Stats match timeline data

---

## Subtask 5.4: Pipeline Report Export

**What**: `POST /api/claude/project/:projectId/report`

Generates a comprehensive markdown report of everything that happened during an automated editing session — what was imported, analyzed, cut, arranged, and exported.

**Relevant files**:
- `electron/claude/claude-summary-handler.ts` (from 5.3)
- All previous stage handlers (for operation history)

**Implementation**:
```typescript
// Add to claude-summary-handler.ts

interface PipelineReport {
  markdown: string;
  savedTo?: string;          // File path if saved to disk
}

interface PipelineStep {
  stage: number;
  action: string;            // "import", "transcribe", "cut", "arrange", "export"
  details: string;
  timestamp: number;
  duration?: number;         // How long the step took
}

function generatePipelineReport(
  steps: PipelineStep[],
  summary: ProjectSummary
): PipelineReport {
  // ## Auto-Edit Pipeline Report
  // **Date**: 2026-02-19
  // **Project**: My Video
  //
  // ### Stage 1: Import
  // - Imported 3 videos from URLs (12.5s)
  // - Generated 2 videos via Kling v3 Pro (45.2s)
  //
  // ### Stage 2: Understanding
  // - Transcribed 5 clips via ElevenLabs (word-level, 99.2% confidence)
  // - Detected 23 scene boundaries
  // - Found 15 filler words (8.5s total)
  //
  // ### Stage 3: Editing
  // - Removed 15 filler words (8.5s saved)
  // - Removed 8 silence gaps (12.3s saved)
  // - Applied 3 manual cuts
  //
  // ### Stage 4: Organization
  // - Arranged 10 clips sequentially on Track 1
  // - Added 5 text titles on Track 2
  //
  // ### Stage 5: Export
  // - Exported as YouTube 1080p (52MB, 2:05)
  //
  // ### Statistics
  // - Original footage: 5:30
  // - Final duration: 2:05
  // - Time saved: 3:25 (62% reduction)
}
```

**For this to work**, we need a lightweight **operation log** — a simple append-only list that each stage writes to:

```typescript
// electron/claude/claude-operation-log.ts (<80 lines)

const operationLog: PipelineStep[] = [];

function logOperation(step: PipelineStep): void {
  operationLog.push(step);
}

function getOperationLog(): PipelineStep[] {
  return [...operationLog];
}

function clearOperationLog(): void {
  operationLog.length = 0;
}
```

Each stage handler calls `logOperation()` when completing an action. The report generator reads the log.

**API contract**:
```
POST /api/claude/project/:projectId/report
Body: { "saveToDisk": true, "outputDir": "docs/task/" }
Response: {
  "success": true,
  "data": {
    "markdown": "## Auto-Edit Pipeline Report\n...",
    "savedTo": "/path/to/docs/task/pipeline-report-2026-02-19.md"
  }
}
```

**Test file**: `electron/__tests__/claude-pipeline-report.test.ts`

**Tests to write**:
- Generates report from operation log
- Includes all 5 stages
- Calculates correct time savings
- Saves to disk when requested
- Handles empty operation log
- Clears log after report generation (optional)

---

## File Impact Summary

| File | Change Type | Lines Added (est.) |
|---|---|---|
| `electron/claude/claude-export-handler.ts` | Edit | +120 (job tracking + progress bridge) |
| `electron/claude/claude-summary-handler.ts` | **New** | ~180 |
| `electron/claude/claude-operation-log.ts` | **New** | ~70 |
| `electron/claude/claude-http-server.ts` | Edit | +25 (5 new routes) |
| `electron/types/claude-api.ts` | Edit | +45 (new types) |
| `electron/__tests__/claude-export-trigger.test.ts` | **New** | ~150 |
| `electron/__tests__/claude-export-progress.test.ts` | **New** | ~130 |
| `electron/__tests__/claude-summary-handler.test.ts` | **New** | ~120 |
| `electron/__tests__/claude-pipeline-report.test.ts` | **New** | ~140 |

---

## Complete Pipeline: End-to-End

```
Claude Code executes:

  POST /media/:id/import-from-url          → Import video from URL
  POST /transcribe/:id                      → Transcribe audio
  POST /analyze/:id/scenes                  → Detect scene boundaries
  POST /analyze/:id/fillers                 → Find filler words
  POST /auto-edit { dryRun: true }          → Preview auto-edit
  POST /auto-edit { dryRun: false }         → Execute auto-edit
  POST /timeline/:id/elements/batch         → Add remaining clips
  POST /timeline/:id/arrange               → Lay out sequentially
  POST /export/:id/start                    → Start export
  GET  /export/:id/jobs/:jid               → Poll until complete
  POST /project/:id/report                  → Generate pipeline report

Total API calls: ~11 (vs 50+ without batch/compound operations)
```
