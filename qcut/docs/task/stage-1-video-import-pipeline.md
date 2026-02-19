# Stage 1: Video Import Pipeline

> **Goal**: Let Claude Code generate, download, or upload video into a QCut project in one API call
> **Status**: IMPLEMENTED
> **Branch**: `claude-auto`

---

## Implementation Summary

All 4 subtasks are implemented and tested. **35 tests pass, 0 regressions across 597 total electron tests.**

| Subtask | Status | Endpoint | Tests |
|---|---|---|---|
| 1.1 URL-to-Import | Done | `POST /api/claude/media/:projectId/import-from-url` | 11 |
| 1.2 Generate-and-Add | Done | `POST /api/claude/generate/:projectId/start` + polling | 15 |
| 1.3 Batch Import | Done | `POST /api/claude/media/:projectId/batch-import` | 6 |
| 1.4 Frame Extraction | Done | `POST /api/claude/media/:projectId/:mediaId/extract-frame` | 3 |

---

## Files Changed

| File | Lines | Change |
|---|---|---|
| `electron/claude/claude-media-handler.ts` | 668 | +`importMediaFromUrl()`, `batchImportMedia()`, `extractFrame()`, 3 IPC handlers |
| `electron/claude/claude-generate-handler.ts` | 331 | **New** — job tracking, `NativePipelineManager` wrapper |
| `electron/claude/claude-http-server.ts` | 768 | +9 HTTP routes (3 media, 6 generate) |
| `electron/types/claude-api.ts` | 426 | +`UrlImportRequest`, `BatchImport*`, `FrameExtract*`, `GenerateAndAdd*`, `GenerateJobStatus` types |
| `electron/__tests__/claude-media-stage1.test.ts` | 464 | **New** — 20 tests for URL import, batch, frame extraction |
| `electron/__tests__/claude-generate-handler.test.ts` | 272 | **New** — 15 tests for generate job lifecycle |

---

## API Reference

### Subtask 1.1: URL-to-Import

```
POST /api/claude/media/:projectId/import-from-url
Body: { "url": "https://...", "filename": "optional-name.mp4" }
Response: { "success": true, "data": { "id": "media_...", "name": "video.mp4", "type": "video", "path": "...", "size": 1024 } }
```

**Implementation**: `electron/claude/claude-media-handler.ts` — `importMediaFromUrl()`

- Downloads via Node.js `fetch` with streaming to disk (no browser needed)
- SSRF prevention: rejects `localhost`, `127.0.0.1`, `::1`, `169.254.*`
- Validates URL scheme (http/https only)
- 5GB size limit enforced from `Content-Length` header
- 5-minute download timeout
- Auto-detects filename from `Content-Disposition` header or URL path
- Deduplicates filenames with `_1`, `_2` suffix (reuses existing `getUniqueFilePath()`)
- Cleans up partial files on failure

**IPC**: `claude:media:importFromUrl`

---

### Subtask 1.2: Generate-and-Add

Wraps the existing `NativePipelineManager` (which already handles FAL.ai API calls, auto-import, and progress) with HTTP job tracking.

**Start generation (returns immediately):**
```
POST /api/claude/generate/:projectId/start
Body: {
  "model": "kling_v3_pro",
  "prompt": "A sunset over the ocean",
  "imageUrl": "https://...",       // optional, for image-to-video
  "duration": 5,                    // optional
  "aspectRatio": "16:9",           // optional
  "resolution": "1080p",           // optional
  "negativePrompt": "...",         // optional
  "addToTimeline": true,           // optional, adds to timeline on completion
  "trackId": "track_1",            // optional, which track
  "startTime": 0                   // optional, where on timeline
}
Response: { "success": true, "data": { "jobId": "gen_..." } }
```

**Poll job status:**
```
GET /api/claude/generate/:projectId/jobs/:jobId
Response: {
  "success": true,
  "data": {
    "jobId": "gen_...",
    "status": "processing",        // queued | processing | completed | failed | cancelled
    "progress": 65,
    "message": "Generating with Kling v3 Pro...",
    "model": "kling_v3_pro",
    "result": null,                 // populated when completed
    "createdAt": 1771477000000,
    "completedAt": null
  }
}
```

**When completed**, `result` contains:
```json
{
  "success": true,
  "outputPath": "/path/to/output.mp4",
  "mediaId": "media_...",
  "importedPath": "/path/to/imported.mp4",
  "duration": 12.5,
  "cost": 0.15
}
```

**Additional endpoints:**
```
GET  /api/claude/generate/:projectId/jobs           — List all jobs
POST /api/claude/generate/:projectId/jobs/:jid/cancel — Cancel running job
GET  /api/claude/generate/models                     — List available models
POST /api/claude/generate/estimate-cost              — Estimate cost { "model": "...", "duration": 5 }
```

**Implementation**: `electron/claude/claude-generate-handler.ts`

- Lazy-initializes a shared `NativePipelineManager` instance
- Stores jobs in-memory (max 50, auto-pruned)
- Background execution with progress forwarding to renderer via IPC
- When `addToTimeline: true`, sends `claude:timeline:addElement` IPC on completion
- Cancellation via `AbortController` (same as native pipeline)

---

### Subtask 1.3: Batch Media Import

```
POST /api/claude/media/:projectId/batch-import
Body: {
  "items": [
    { "url": "https://example.com/video1.mp4" },
    { "path": "/local/path/video2.mp4" },
    { "url": "https://cdn.example.com/clip.mp4", "filename": "intro.mp4" }
  ]
}
Response: {
  "success": true,
  "data": [
    { "index": 0, "success": true, "mediaFile": { ... } },
    { "index": 1, "success": true, "mediaFile": { ... } },
    { "index": 2, "success": false, "error": "HTTP 404 Not Found" }
  ]
}
```

**Implementation**: `electron/claude/claude-media-handler.ts` — `batchImportMedia()`

- Max 20 items per batch
- Processes sequentially to avoid I/O contention
- Each item must have either `url` or `path`
- Per-item error reporting (partial failures don't abort the batch)
- Reuses `importMediaFile()` for local paths, `importMediaFromUrl()` for URLs

**IPC**: `claude:media:batchImport`

---

### Subtask 1.4: Frame Extraction

```
POST /api/claude/media/:projectId/:mediaId/extract-frame
Body: { "timestamp": 5.0, "format": "png" }
Response: { "success": true, "data": { "path": "/tmp/qcut_frame_..._5000.png", "timestamp": 5.0, "format": "png" } }
```

**Implementation**: `electron/claude/claude-media-handler.ts` — `extractFrame()`

- Uses FFmpeg directly via `child_process.execFile` (30s timeout)
- Supports `png` and `jpg` formats
- Validates media exists and is a video file
- Validates timestamp is non-negative
- Outputs to system temp directory
- Verifies output file exists and is non-empty

**IPC**: `claude:media:extractFrame`

---

## Architecture Notes

### Why job-based for generation?

Video generation takes 30s–3min. Instead of blocking an HTTP request:
1. `POST /start` creates a job and returns immediately
2. Background: `NativePipelineManager.execute()` runs with progress callbacks
3. Claude Code polls `GET /jobs/:jid` until `status === "completed"`
4. Result includes `mediaId` (auto-imported) and optionally timeline element

### Reuse of existing infrastructure

- **`NativePipelineManager`** — Already handles FAL.ai queue submission, polling, download, auto-import, cancellation, cost estimation, and 73+ model registry. The generate handler is just a 331-line HTTP wrapper.
- **`importMediaFile()`** — Existing function reused by batch import and auto-import.
- **`getUniqueFilePath()`** — Existing deduplication logic reused by URL import.
- **`getMediaType()`** — Existing extension → type mapping.

### Security

- SSRF prevention on URL imports (blocks private/loopback IPs)
- Path traversal prevention (via existing `sanitizeFilename()`)
- 5GB file size limit
- 5-minute download timeout
- Max 20 items per batch
- Max 50 stored generation jobs
