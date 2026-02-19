# Stage 1: Video Import Pipeline

> **Goal**: Let Claude Code generate, download, or upload video into a QCut project in one API call
> **Status**: IMPLEMENTED + FIXED (media sync bug resolved)
> **Base URL**: `http://localhost:8765`

---

## Quick Reference — Copy-Paste curl Commands

All endpoints use the base URL `http://localhost:8765/api/claude`. Replace `PROJECT_ID` and `TRACK_ID` with real values.

### Discover project state

```bash
# List media files in project
curl -s http://localhost:8765/api/claude/media/$PROJECT_ID | python3 -m json.tool

# Get timeline (tracks, elements, durations)
curl -s http://localhost:8765/api/claude/timeline/$PROJECT_ID | python3 -m json.tool

# Project summary (media count, element count, duration)
curl -s http://localhost:8765/api/claude/project/$PROJECT_ID/summary | python3 -m json.tool
```

### Batch upload files to media library

```bash
# Batch import from local paths (max 20 items)
curl -s -X POST http://localhost:8765/api/claude/media/$PROJECT_ID/batch-import \
  -H "Content-Type: application/json" \
  -d '{"items":[
    {"path":"/absolute/path/to/video1.mp4"},
    {"path":"/absolute/path/to/video2.mp4"},
    {"path":"/absolute/path/to/image.png"}
  ]}'

# Batch import from URLs
curl -s -X POST http://localhost:8765/api/claude/media/$PROJECT_ID/batch-import \
  -H "Content-Type: application/json" \
  -d '{"items":[
    {"url":"https://example.com/video.mp4"},
    {"url":"https://cdn.example.com/clip.mp4","filename":"custom-name.mp4"}
  ]}'
```

Response includes per-item `id`, `name`, `type` for use in timeline add.

### Batch add to timeline (immediately after import)

```bash
# Use sourceId or sourceName from the batch-import response
curl -s -X POST http://localhost:8765/api/claude/timeline/$PROJECT_ID/elements/batch \
  -H "Content-Type: application/json" \
  -d '{"elements":[
    {"type":"video","trackId":"TRACK_ID","startTime":0,"duration":5,"sourceName":"video1.mp4"},
    {"type":"video","trackId":"TRACK_ID","startTime":5,"duration":3,"sourceName":"video2.mp4"},
    {"type":"image","trackId":"TRACK_ID","startTime":8,"duration":4,"sourceName":"image.png"}
  ]}'
```

Media sync happens automatically — no workaround needed.

### Delete elements from timeline

```bash
# Delete a single element
curl -s -X DELETE http://localhost:8765/api/claude/timeline/$PROJECT_ID/elements/$ELEMENT_ID

# Batch delete multiple elements (max 50)
curl -s -X DELETE http://localhost:8765/api/claude/timeline/$PROJECT_ID/elements/batch \
  -H "Content-Type: application/json" \
  -d '{"elements":[
    {"trackId":"TRACK_ID","elementId":"ELEMENT_ID_1"},
    {"trackId":"TRACK_ID","elementId":"ELEMENT_ID_2"}
  ]}'

# Batch delete with ripple (shifts subsequent elements left)
curl -s -X DELETE http://localhost:8765/api/claude/timeline/$PROJECT_ID/elements/batch \
  -H "Content-Type: application/json" \
  -d '{"ripple":true,"elements":[
    {"trackId":"TRACK_ID","elementId":"ELEMENT_ID_1"}
  ]}'
```

### Delete media from project

```bash
# Delete a single media file
curl -s -X DELETE http://localhost:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID
```

### Full workflow: import → add → verify

```bash
PROJECT_ID="your-project-id"
TRACK_ID="your-track-id"

# 1. Import files
curl -s -X POST http://localhost:8765/api/claude/media/$PROJECT_ID/batch-import \
  -H "Content-Type: application/json" \
  -d '{"items":[{"path":"/path/to/clip.mp4"}]}'

# 2. Add to timeline (works immediately — no delay needed)
curl -s -X POST http://localhost:8765/api/claude/timeline/$PROJECT_ID/elements/batch \
  -H "Content-Type: application/json" \
  -d '{"elements":[{"type":"video","trackId":"'$TRACK_ID'","startTime":0,"duration":5,"sourceName":"clip.mp4"}]}'

# 3. Verify
curl -s http://localhost:8765/api/claude/timeline/$PROJECT_ID | python3 -m json.tool
```

### Finding project and track IDs

```bash
# Project files live at: ~/Documents/QCut/Projects/<project-id>/
ls ~/Documents/QCut/Projects/

# Get track IDs from timeline export
curl -s http://localhost:8765/api/claude/timeline/$PROJECT_ID | \
  python3 -c "import sys,json; [print(f'{t[\"id\"]} — {t[\"name\"]} ({t[\"type\"]})') for t in json.load(sys.stdin)['data']['tracks']]"
```

---

## All API Endpoints

### Media

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/media/:projectId` | List all media files |
| GET | `/media/:projectId/:mediaId` | Get single media info |
| POST | `/media/:projectId/import` | Import single local file |
| POST | `/media/:projectId/import-from-url` | Import from URL |
| POST | `/media/:projectId/batch-import` | Batch import (max 20) |
| POST | `/media/:projectId/:mediaId/extract-frame` | Extract video frame |
| PATCH | `/media/:projectId/:mediaId/rename` | Rename media file |
| DELETE | `/media/:projectId/:mediaId` | Delete media file |

### Timeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/timeline/:projectId` | Export timeline (json, `?format=md` for markdown) |
| POST | `/timeline/:projectId/import` | Import timeline |
| POST | `/timeline/:projectId/elements` | Add single element |
| POST | `/timeline/:projectId/elements/batch` | Batch add (max 50) |
| PATCH | `/timeline/:projectId/elements/:elementId` | Update single element |
| PATCH | `/timeline/:projectId/elements/batch` | Batch update (max 50) |
| DELETE | `/timeline/:projectId/elements/:elementId` | Delete single element |
| DELETE | `/timeline/:projectId/elements/batch` | Batch delete (max 50) |
| POST | `/timeline/:projectId/elements/:elementId/split` | Split element |
| POST | `/timeline/:projectId/elements/:elementId/move` | Move to different track |
| POST | `/timeline/:projectId/arrange` | Arrange elements on track |
| POST | `/timeline/:projectId/selection` | Set selection |
| GET | `/timeline/:projectId/selection` | Get selection |
| DELETE | `/timeline/:projectId/selection` | Clear selection |

### Generate

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate/:projectId/start` | Start generation job |
| GET | `/generate/:projectId/jobs/:jobId` | Poll job status |
| GET | `/generate/:projectId/jobs` | List all jobs |
| POST | `/generate/:projectId/jobs/:jobId/cancel` | Cancel job |
| GET | `/generate/models` | List available models |
| POST | `/generate/estimate-cost` | Estimate cost |

### Project

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/project/:projectId/summary` | Project summary |
| GET | `/project/:projectId/settings` | Get settings |
| PATCH | `/project/:projectId/settings` | Update settings |
| GET | `/project/:projectId/stats` | Project statistics |

---

## Limits

| Limit | Value |
|-------|-------|
| Batch import items | 20 |
| Batch timeline operations | 50 |
| File size (URL import) | 5 GB |
| Download timeout | 5 min |
| Generation jobs stored | 50 |

---

## Media ID Format

Media IDs use deterministic base64url encoding: `media_` + base64url(filename).

```text
filename: "clip.mp4" → id: "media_Y2xpcC5tcDQ"
```

You can use either `sourceId` (media ID), `sourceName` (filename), or `mediaId` (renderer ID) when adding elements to the timeline.

---

## Fixed Issues

### Batch timeline add after import (FIXED)

Previously, `POST /elements/batch` failed with `"Media source could not be resolved"` when called immediately after `POST /batch-import`. The batch import wrote files to disk but the renderer's media store was stale.

**Fix**: Added `syncProjectMediaIfNeeded()` call in the batch add handler at `apps/web/src/lib/claude-timeline-bridge.ts:499-503`, before the element resolution loop. This matches the single-add endpoint behavior.

**Tested**: batch import → immediate batch add now works with 0 failures (verified with 5 files across 2 consecutive batches).

---

## Key Source Files

| File | Purpose |
|------|---------|
| `electron/claude/claude-http-server.ts` | HTTP route definitions |
| `electron/claude/claude-media-handler.ts` | Import, batch import, frame extraction |
| `electron/claude/claude-generate-handler.ts` | AI generation job tracking |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Renderer-side timeline operations (batch add/update/delete) |
| `apps/web/src/lib/claude-timeline-bridge-helpers.ts` | Media sync, element resolution helpers |
| `electron/types/claude-api.ts` | TypeScript types for all requests/responses |
| `electron/claude/utils/helpers.ts` | `getProjectPath()`, `getMediaPath()` — project dir: `~/Documents/QCut/Projects/<id>/` |
