---
name: qcut-api
description: Control QCut editor programmatically via its REST API and Electron IPC. Use when the user asks to manipulate media files, timeline elements, project settings, export presets, or diagnose errors in a running QCut instance.
argument-hint: [action description or project ID]
---

# QCut Editor Control API

Programmatically control a running QCut editor instance through its REST API (from Claude Code terminal) or Electron IPC (from renderer code).

**Reference files** (load when needed):
- `REFERENCE.md` — Complete endpoint reference, type definitions, all curl examples

## Architecture

```
Claude Code CLI ──HTTP──▶ http://127.0.0.1:8765/api/claude/*
                                    │
                                    ▼
                          Electron Main Process
                                    │
                                    ▼
                          Zustand Stores (renderer)
```

- **HTTP REST API** — External control from terminal/scripts (port 8765)
- **Electron IPC** — Internal control from renderer via `window.electronAPI.claude.*`
- Both interfaces call the same extracted handler functions

## Quick Start

### Check if QCut is running

```bash
curl -s http://127.0.0.1:8765/api/claude/health | jq
```

### Authentication (optional)

If `QCUT_API_TOKEN` is set in QCut's environment:

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8765/api/claude/health
```

## 5 API Modules — 23 Methods

### 1. Media API — Manage project media files

| Action | HTTP | curl |
|--------|------|------|
| List files | `GET /api/claude/media/:projectId` | `curl http://127.0.0.1:8765/api/claude/media/PROJECT_ID` |
| File info | `GET /api/claude/media/:projectId/:mediaId` | `curl http://127.0.0.1:8765/api/claude/media/PROJECT_ID/MEDIA_ID` |
| Import | `POST /api/claude/media/:projectId/import` | `curl -X POST -H "Content-Type: application/json" -d '{"source":"/absolute/path/to/file.mp4"}' http://127.0.0.1:8765/api/claude/media/PROJECT_ID/import` |
| Delete | `DELETE /api/claude/media/:projectId/:mediaId` | `curl -X DELETE http://127.0.0.1:8765/api/claude/media/PROJECT_ID/MEDIA_ID` |
| Rename | `PATCH /api/claude/media/:projectId/:mediaId/rename` | `curl -X PATCH -H "Content-Type: application/json" -d '{"newName":"new-name"}' http://127.0.0.1:8765/api/claude/media/PROJECT_ID/MEDIA_ID/rename` |

**Media IDs** are deterministic: `media_${base64url(filename)}`. Same filename always produces the same ID.

**Supported formats:** Video (.mp4, .mov, .avi, .mkv, .webm, .m4v, .wmv), Audio (.mp3, .wav, .aac, .ogg, .m4a, .flac, .wma), Image (.jpg, .jpeg, .png, .gif, .webp, .bmp, .svg, .tiff)

### 2. Timeline API — Read/write timeline data

| Action | HTTP | curl |
|--------|------|------|
| Export JSON | `GET /api/claude/timeline/:projectId?format=json` | `curl "http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID?format=json"` |
| Export Markdown | `GET /api/claude/timeline/:projectId?format=md` | `curl "http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID?format=md"` |
| Import | `POST /api/claude/timeline/:projectId/import` | `curl -X POST -H "Content-Type: application/json" -d '{"data":"...","format":"json"}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/import` |
| Add element | `POST /api/claude/timeline/:projectId/elements` | `curl -X POST -H "Content-Type: application/json" -d '{"type":"text","trackIndex":0,"startTime":5,"endTime":10,"content":"Hello"}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements` |
| Update element | `PATCH /api/claude/timeline/:projectId/elements/:elementId` | `curl -X PATCH -H "Content-Type: application/json" -d '{"startTime":2}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements/ELEMENT_ID` |
| Remove element | `DELETE /api/claude/timeline/:projectId/elements/:elementId` | `curl -X DELETE http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements/ELEMENT_ID` |
| Split element | `POST /api/claude/timeline/:projectId/elements/:elementId/split` | `curl -X POST -H "Content-Type: application/json" -d '{"splitTime":3.5,"mode":"split"}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements/ELEMENT_ID/split` |
| Move element | `POST /api/claude/timeline/:projectId/elements/:elementId/move` | `curl -X POST -H "Content-Type: application/json" -d '{"toTrackId":"track_2","newStartTime":5.0}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements/ELEMENT_ID/move` |
| Set selection | `POST /api/claude/timeline/:projectId/selection` | `curl -X POST -H "Content-Type: application/json" -d '{"elements":[{"trackId":"track_1","elementId":"element_abc"}]}' http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/selection` |
| Get selection | `GET /api/claude/timeline/:projectId/selection` | `curl http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/selection` |
| Clear selection | `DELETE /api/claude/timeline/:projectId/selection` | `curl -X DELETE http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/selection` |

**Split modes:** `split` (default, creates two clips), `keepLeft` (trim from right), `keepRight` (trim from left).

**Note:** Timeline export uses a request-response IPC pattern with a 5-second timeout. QCut renderer must be active.

### 3. Project API — Project settings and stats

| Action | HTTP | curl |
|--------|------|------|
| Get settings | `GET /api/claude/project/:projectId/settings` | `curl http://127.0.0.1:8765/api/claude/project/PROJECT_ID/settings` |
| Update settings | `PATCH /api/claude/project/:projectId/settings` | `curl -X PATCH -H "Content-Type: application/json" -d '{"name":"My Video","fps":60,"width":3840,"height":2160}' http://127.0.0.1:8765/api/claude/project/PROJECT_ID/settings` |
| Get stats | `GET /api/claude/project/:projectId/stats` | `curl http://127.0.0.1:8765/api/claude/project/PROJECT_ID/stats` |

### 4. Export API — Platform presets and recommendations

| Action | HTTP | curl |
|--------|------|------|
| List presets | `GET /api/claude/export/presets` | `curl http://127.0.0.1:8765/api/claude/export/presets` |
| Get recommendation | `GET /api/claude/export/:projectId/recommend/:target` | `curl http://127.0.0.1:8765/api/claude/export/PROJECT_ID/recommend/tiktok` |

**Targets:** `youtube`, `youtube-4k`, `youtube-1080p`, `youtube-720p`, `tiktok`, `instagram-reel`, `instagram-post`, `instagram-landscape`, `twitter`, `linkedin`, `discord`

### 5. Diagnostics API — Error analysis

| Action | HTTP | curl |
|--------|------|------|
| Analyze error | `POST /api/claude/diagnostics/analyze` | `curl -X POST -H "Content-Type: application/json" -d '{"message":"ENOENT: no such file","context":"media-import","timestamp":1234567890}' http://127.0.0.1:8765/api/claude/diagnostics/analyze` |

Returns error type, severity, possible causes, suggested fixes, and system info.

## Common Workflows

### Inspect a project

```bash
# Get project settings
curl -s http://127.0.0.1:8765/api/claude/project/PROJECT_ID/settings | jq

# Get project stats
curl -s http://127.0.0.1:8765/api/claude/project/PROJECT_ID/stats | jq

# List all media
curl -s http://127.0.0.1:8765/api/claude/media/PROJECT_ID | jq

# Export timeline as readable markdown
curl -s "http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID?format=md"
```

### Import media and add to timeline

```bash
# Import a video file
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"source":"/Users/me/Videos/clip.mp4"}' \
  http://127.0.0.1:8765/api/claude/media/PROJECT_ID/import | jq

# Add it to the timeline
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type":"media","trackIndex":0,"startTime":0,"endTime":15,"sourceName":"clip.mp4"}' \
  http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements | jq
```

### Configure for a platform

```bash
# Get TikTok recommendation
curl -s http://127.0.0.1:8765/api/claude/export/PROJECT_ID/recommend/tiktok | jq

# Apply recommended settings
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"width":1080,"height":1920,"fps":30}' \
  http://127.0.0.1:8765/api/claude/project/PROJECT_ID/settings | jq
```

### Add text overlay to timeline

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type":"text","trackIndex":1,"startTime":2,"endTime":8,"content":"Subscribe!"}' \
  http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements | jq
```

## Response Format

All responses use a consistent JSON envelope:

```json
{"success": true, "data": { ... }, "timestamp": 1707580800000}
```

Error responses:

```json
{"success": false, "error": "Error message", "timestamp": 1707580800000}
```

## Data Storage

```
Documents/QCut/Projects/{projectId}/
├── project.json     # Settings (Project API)
├── timeline.json    # Timeline data
└── media/           # Media files (Media API)
```

Path helpers in `electron/claude/utils/helpers.ts`: `getProjectPath()`, `getMediaPath()`, `getTimelinePath()`, `getProjectSettingsPath()`

## Source Files

| File | Purpose |
|------|---------|
| `electron/claude/index.ts` | Entry point, `setupAllClaudeIPC()` |
| `electron/claude/claude-http-server.ts` | HTTP REST server |
| `electron/claude/claude-media-handler.ts` | Media operations |
| `electron/claude/claude-timeline-handler.ts` | Timeline export/import |
| `electron/claude/claude-project-handler.ts` | Project settings/stats |
| `electron/claude/claude-export-handler.ts` | Export presets |
| `electron/claude/claude-diagnostics-handler.ts` | Error analysis |
| `electron/claude/utils/http-router.ts` | HTTP router utility |
| `electron/claude/utils/helpers.ts` | Path/security utilities |
| `electron/types/claude-api.ts` | Shared type definitions |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Frontend bridge |

## Limitations

- `timeline.import()` with Markdown only parses metadata (name, resolution, FPS). Use JSON for full import.
- Timeline export has a 5-second timeout — QCut renderer must be active.
- Project stats have a 3-second timeout — returns empty stats if renderer unresponsive.
- `addElement()` and `updateElement()` depend on the Timeline Bridge being connected in the renderer.

**See `REFERENCE.md` for complete type definitions, all endpoint details, and Electron IPC examples.**
