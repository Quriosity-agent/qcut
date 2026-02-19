# Stage 1: Video Import Pipeline

> **Goal**: Let Claude Code generate, download, or upload video into a QCut project in one API call
> **Estimated effort**: ~3 hours total across 4 subtasks
> **Dependencies**: None (standalone)

---

## Current State

| Capability | Status | File |
|---|---|---|
| AI video generation (10 text-to-video, 15+ image-to-video models) | Ready | `apps/web/src/lib/ai-video/generators/` |
| Streaming video download (browser-only) | Ready | `apps/web/src/lib/ai-video/core/streaming.ts` |
| Media import via IPC (symlink + copy) | Ready | `electron/media-import-handler.ts` |
| AI video save to disk | Ready | `electron/ai-video-save-handler.ts` |
| Claude HTTP media API (list/import/delete/rename) | Ready | `electron/claude/claude-media-handler.ts` |

**What's missing**: No HTTP endpoint to download from URL. No compound "generate + import + add to timeline" endpoint. No batch import.

---

## Subtask 1.1: URL-to-Import Endpoint

**What**: `POST /api/claude/media/:projectId/import-from-url`

Downloads a video from an arbitrary URL and imports it into the project media library.

**Relevant files**:
- `electron/claude/claude-media-handler.ts` (292 lines) — add new function `importMediaFromUrl()`
- `electron/claude/claude-http-server.ts` (537 lines) — register new route
- `electron/types/claude-api.ts` (230 lines) — add request/response types
- `electron/ai-video-save-handler.ts` (468 lines) — reuse `saveAIVideoToDisk()` for file writes

**Implementation**:
```typescript
// electron/claude/claude-media-handler.ts
async function importMediaFromUrl(
  projectId: string,
  url: string,
  filename?: string
): Promise<MediaFile> {
  // 1. Validate URL (http/https only, no file:// or data:)
  // 2. Download via Node.js https/http with streaming (no browser needed)
  // 3. Auto-detect filename from Content-Disposition or URL path
  // 4. Validate file type from extension + content-type header
  // 5. Save to Documents/QCut/Projects/{projectId}/media/imported/
  // 6. Return MediaFile metadata
}
```

**API contract**:
```
POST /api/claude/media/:projectId/import-from-url
Body: { "url": "https://...", "filename": "optional-name.mp4" }
Response: { "success": true, "data": { MediaFile } }
```

**Security**: Validate URL scheme (https/http only), reject private IPs (SSRF prevention), enforce 5GB size limit from response headers before downloading, timeout after 5 minutes.

**Test file**: `electron/__tests__/claude-media-url-import.test.ts`

**Tests to write**:
- Downloads valid MP4 from HTTPS URL
- Rejects non-http/https schemes
- Handles Content-Disposition filename parsing
- Rejects files exceeding size limit
- Handles network timeout gracefully
- Deduplicates filename with `_1`, `_2` suffix (reuse existing pattern from `importMediaFile`)

---

## Subtask 1.2: Generate-and-Add Compound Endpoint

**What**: `POST /api/claude/media/:projectId/generate-and-add`

Generates a video via FAL.ai, downloads the result, saves to project, and optionally adds to timeline — all in one call.

**Relevant files**:
- `electron/claude/claude-media-handler.ts` — add `generateAndAddMedia()`
- `electron/claude/claude-http-server.ts` — register route
- `apps/web/src/lib/ai-video/generators/` — reuse existing model configs
- `electron/ai-video-save-handler.ts` — reuse `saveAIVideoToDisk()`
- `electron/claude/claude-timeline-handler.ts` (450 lines) — reuse `addElement` IPC for timeline placement

**Implementation**:
```typescript
// New file: electron/claude/claude-generate-handler.ts (<200 lines)
async function generateAndAdd(projectId: string, options: {
  model: string;       // e.g. "kling_v3_pro"
  prompt: string;
  imageUrl?: string;   // For image-to-video
  duration?: number;
  aspectRatio?: string;
  addToTimeline?: boolean;
  trackId?: string;
  startTime?: number;
}): Promise<{ mediaFile: MediaFile; elementId?: string }> {
  // 1. Submit generation job to FAL.ai
  // 2. Poll until complete (reuse fal-ai client pattern)
  // 3. Download result URL → save to project
  // 4. If addToTimeline, send IPC to add element
  // 5. Return media file + optional element ID
}
```

**API contract**:
```
POST /api/claude/media/:projectId/generate-and-add
Body: { "model": "kling_v3_pro", "prompt": "...", "addToTimeline": true }
Response: { "success": true, "data": { "mediaFile": {...}, "elementId": "el_..." } }
```

**Note**: This is a long-running request (30s–3min depending on model). Use streaming response or return a job ID for polling. Recommend: return job ID + poll endpoint.

**Subtask**: Add `GET /api/claude/media/:projectId/jobs/:jobId` for status polling.

**Test file**: `electron/__tests__/claude-generate-handler.test.ts`

**Tests to write**:
- Submits generation request with valid model
- Returns job ID immediately
- Polls status and returns completion
- Saves generated video to correct project path
- Adds element to timeline when `addToTimeline: true`
- Rejects unknown model IDs

---

## Subtask 1.3: Batch Media Import

**What**: `POST /api/claude/media/:projectId/batch-import`

Imports multiple files or URLs in one call.

**Relevant files**:
- `electron/claude/claude-media-handler.ts` — add `batchImportMedia()`
- `electron/claude/claude-http-server.ts` — register route

**Implementation**:
```typescript
async function batchImportMedia(
  projectId: string,
  items: Array<{ path?: string; url?: string; filename?: string }>
): Promise<{ results: Array<{ success: boolean; mediaFile?: MediaFile; error?: string }> }> {
  // Process items sequentially to avoid disk I/O contention
  // Reuse importMediaFile() for paths, importMediaFromUrl() for URLs
}
```

**API contract**:
```
POST /api/claude/media/:projectId/batch-import
Body: { "items": [{ "url": "..." }, { "path": "/local/file.mp4" }] }
Response: { "success": true, "data": { "results": [...] } }
```

**Limit**: Max 20 items per batch to prevent abuse.

**Test file**: `electron/__tests__/claude-media-batch-import.test.ts`

**Tests to write**:
- Imports mix of local paths and URLs
- Returns per-item success/failure
- Rejects batches exceeding 20 items
- Handles partial failures gracefully

---

## Subtask 1.4: Frame Extraction Endpoint

**What**: `POST /api/claude/media/:projectId/:mediaId/extract-frame`

Extracts a single frame from a video at a given timestamp — useful for image-to-video reference workflows.

**Relevant files**:
- `electron/ffmpeg-basic-handlers.ts` — already has `capture-frame` IPC handler
- `electron/claude/claude-media-handler.ts` — expose via HTTP
- `electron/claude/claude-http-server.ts` — register route

**Implementation**: Thin wrapper around existing `capture-frame` IPC handler.

```
POST /api/claude/media/:projectId/:mediaId/extract-frame
Body: { "timestamp": 5.0, "format": "png" }
Response: { "success": true, "data": { "path": "/tmp/frame_5000.png" } }
```

**Test file**: `electron/__tests__/claude-frame-extraction.test.ts`

**Tests to write**:
- Extracts frame at valid timestamp
- Returns PNG path
- Rejects timestamp beyond video duration
- Handles missing media ID

---

## File Impact Summary

| File | Change Type | Lines Added (est.) |
|---|---|---|
| `electron/claude/claude-media-handler.ts` | Edit | +80 (URL import + batch) |
| `electron/claude/claude-generate-handler.ts` | **New** | ~180 |
| `electron/claude/claude-http-server.ts` | Edit | +30 (4 new routes) |
| `electron/types/claude-api.ts` | Edit | +25 (new types) |
| `electron/__tests__/claude-media-url-import.test.ts` | **New** | ~120 |
| `electron/__tests__/claude-generate-handler.test.ts` | **New** | ~150 |
| `electron/__tests__/claude-media-batch-import.test.ts` | **New** | ~100 |
| `electron/__tests__/claude-frame-extraction.test.ts` | **New** | ~80 |
