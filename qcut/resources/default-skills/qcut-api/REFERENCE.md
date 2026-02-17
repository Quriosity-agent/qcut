# QCut API — Complete Reference

## Type Definitions

All types are defined in `electron/types/claude-api.ts`.

### MediaFile

```typescript
interface MediaFile {
  id: string;                                    // Deterministic: media_${base64url(name)}
  name: string;                                  // Filename
  type: "video" | "audio" | "image";
  path: string;                                  // Absolute file path
  size: number;                                  // Bytes
  duration?: number;                             // Seconds (optional)
  dimensions?: { width: number; height: number }; // Pixels (optional)
  createdAt: number;                             // Timestamp (ms)
  modifiedAt: number;                            // Timestamp (ms)
}
```

### ClaudeTimeline / ClaudeTrack / ClaudeElement

```typescript
interface ClaudeTimeline {
  name: string;
  duration: number;         // Seconds
  width: number;            // Pixels
  height: number;           // Pixels
  fps: number;
  tracks: ClaudeTrack[];
}

interface ClaudeTrack {
  index: number;            // 0-based
  name: string;
  type: string;
  elements: ClaudeElement[];
}

interface ClaudeElement {
  id: string;
  trackIndex: number;
  startTime: number;        // Seconds
  endTime: number;          // Seconds
  duration: number;         // Seconds
  type: "video" | "audio" | "image" | "text" | "sticker" | "captions" | "remotion" | "media";
  sourceId?: string;        // Media/sticker/component ID
  sourceName?: string;      // Display name
  content?: string;         // Text content
  style?: Record<string, unknown>;
  effects?: string[];
}
```

### ClaudeSplitRequest / ClaudeMoveRequest / ClaudeSelectionItem

```typescript
interface ClaudeSplitRequest {
  splitTime: number;
  mode?: "split" | "keepLeft" | "keepRight";  // default: "split"
}

interface ClaudeSplitResponse {
  secondElementId: string | null;
}

interface ClaudeMoveRequest {
  toTrackId: string;
  newStartTime?: number;
}

interface ClaudeSelectionItem {
  trackId: string;
  elementId: string;
}
```

### ProjectSettings / ProjectStats

```typescript
interface ProjectSettings {
  name: string;
  width: number;            // Canvas width (pixels)
  height: number;           // Canvas height (pixels)
  fps: number;
  aspectRatio: string;      // e.g. "16:9"
  backgroundColor: string;  // Hex color
  exportFormat: string;     // e.g. "mp4"
  exportQuality: string;    // e.g. "high"
}

interface ProjectStats {
  totalDuration: number;    // Seconds
  mediaCount: { video: number; audio: number; image: number };
  trackCount: number;
  elementCount: number;
  lastModified: number;     // Timestamp (ms)
  fileSize: number;         // Bytes
}
```

### ExportPreset / ExportRecommendation

```typescript
interface ExportPreset {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;          // e.g. "8Mbps"
  format: string;           // e.g. "mp4"
}

interface ExportRecommendation {
  preset: ExportPreset;
  warnings: string[];
  suggestions: string[];
  estimatedFileSize?: string;
}
```

### ErrorReport / DiagnosticResult / SystemInfo

```typescript
interface ErrorReport {
  message: string;
  stack?: string;
  context: string;
  timestamp: number;
  componentStack?: string;
}

interface DiagnosticResult {
  errorType: string;
  severity: "low" | "medium" | "high" | "critical";
  possibleCauses: string[];
  suggestedFixes: string[];
  canAutoFix: boolean;
  autoFixAction?: string;
  systemInfo: SystemInfo;
}

interface SystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  appVersion: string;
  nodeVersion: string;
  electronVersion: string;
  memory: { total: number; free: number; used: number };
  cpuCount: number;
}
```

---

## HTTP REST API — Complete Route Reference

Base URL: `http://127.0.0.1:8765`

### Health Check

```bash
GET /api/claude/health
```

```bash
curl -s http://127.0.0.1:8765/api/claude/health | jq
```

Response:
```json
{"success": true, "data": {"status": "ok"}, "timestamp": 1707580800000}
```

---

### Media Endpoints

#### List media files

```bash
GET /api/claude/media/:projectId
```

```bash
curl -s http://127.0.0.1:8765/api/claude/media/project_123 | jq
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "media_dmlkZW8ubXA0",
      "name": "video.mp4",
      "type": "video",
      "path": "/Users/me/Documents/QCut/Projects/project_123/media/video.mp4",
      "size": 15728640,
      "createdAt": 1707580800000,
      "modifiedAt": 1707580800000
    }
  ]
}
```

#### Get media info

```bash
GET /api/claude/media/:projectId/:mediaId
```

```bash
curl -s http://127.0.0.1:8765/api/claude/media/project_123/media_dmlkZW8ubXA0 | jq
```

#### Import media file

```bash
POST /api/claude/media/:projectId/import
Content-Type: application/json

{"source": "/absolute/path/to/file.mp4"}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"source": "/Users/me/Videos/clip.mp4"}' \
  http://127.0.0.1:8765/api/claude/media/project_123/import | jq
```

**Rules:**
- Source must be an absolute path
- No null bytes in path
- Supported extensions only (video/audio/image)
- Duplicate filenames get `_1`, `_2` suffix
- Creates `media/` directory if needed

#### Delete media file

```bash
DELETE /api/claude/media/:projectId/:mediaId
```

```bash
curl -s -X DELETE http://127.0.0.1:8765/api/claude/media/project_123/media_dmlkZW8ubXA0 | jq
```

#### Rename media file

```bash
PATCH /api/claude/media/:projectId/:mediaId/rename
Content-Type: application/json

{"newName": "new-filename"}
```

```bash
curl -s -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"newName": "intro-clip"}' \
  http://127.0.0.1:8765/api/claude/media/project_123/media_dmlkZW8ubXA0/rename | jq
```

Preserves original extension if omitted from `newName`.

---

### Timeline Endpoints

#### Export timeline

```bash
GET /api/claude/timeline/:projectId?format=json|md
```

```bash
# JSON (machine-readable)
curl -s "http://127.0.0.1:8765/api/claude/timeline/project_123?format=json" | jq

# Markdown (human-readable)
curl -s "http://127.0.0.1:8765/api/claude/timeline/project_123?format=md"
```

**Timeout:** 5 seconds. Requires active QCut renderer.

Markdown output example:
```markdown
# Timeline: My Project

## Project Info
| Property | Value |
|----------|-------|
| Duration | 0:01:30 |
| Resolution | 1920x1080 |
| FPS | 30 |
| Tracks | 3 |

## Track 1: Video
| ID | Start | End | Duration | Type | Source | Content |
|----|-------|-----|----------|------|--------|---------|
| `element_` | 0:00:00 | 0:00:15 | 0:00:15 | media | clip.mp4 | - |
```

#### Import timeline

```bash
POST /api/claude/timeline/:projectId/import
Content-Type: application/json

{"data": "<serialized timeline>", "format": "json"}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"data":"{\"name\":\"My Project\",\"duration\":90,\"width\":1920,\"height\":1080,\"fps\":30,\"tracks\":[]}","format":"json"}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/import | jq
```

**Limitation:** Markdown import only parses metadata (name, resolution, FPS, duration). Use JSON for full import.

#### Add timeline element

```bash
POST /api/claude/timeline/:projectId/elements
Content-Type: application/json

{"type": "text", "trackIndex": 0, "startTime": 5.0, "endTime": 10.0, "content": "Hello World"}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"type":"text","trackIndex":0,"startTime":5,"endTime":10,"content":"Hello World"}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/elements | jq
```

Element types: `video`, `audio`, `image`, `text`, `sticker`, `captions`, `remotion`, `media`

#### Update timeline element

```bash
PATCH /api/claude/timeline/:projectId/elements/:elementId
Content-Type: application/json

{"startTime": 2.0, "endTime": 8.0}
```

```bash
curl -s -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"startTime":2,"endTime":8}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/elements/element_abc | jq
```

#### Remove timeline element

```bash
DELETE /api/claude/timeline/:projectId/elements/:elementId
```

```bash
curl -s -X DELETE \
  http://127.0.0.1:8765/api/claude/timeline/project_123/elements/element_abc | jq
```

#### Split timeline element

```bash
POST /api/claude/timeline/:projectId/elements/:elementId/split
Content-Type: application/json

{"splitTime": 3.5, "mode": "split"}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"splitTime":3.5,"mode":"split"}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/elements/element_abc/split | jq
```

**Modes:**
- `split` (default) — Split into two clips at the given time. Returns `secondElementId`.
- `keepLeft` — Keep the left portion, discard right.
- `keepRight` — Keep the right portion, discard left.

Response:
```json
{"success": true, "data": {"secondElementId": "element_xyz"}}
```

#### Move timeline element

```bash
POST /api/claude/timeline/:projectId/elements/:elementId/move
Content-Type: application/json

{"toTrackId": "track_2", "newStartTime": 5.0}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"toTrackId":"track_2","newStartTime":5.0}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/elements/element_abc/move | jq
```

`newStartTime` is optional. If omitted, the element keeps its current start time.

Response:
```json
{"success": true, "data": {"moved": true}}
```

#### Set timeline selection

```bash
POST /api/claude/timeline/:projectId/selection
Content-Type: application/json

{"elements": [{"trackId": "track_1", "elementId": "element_abc"}]}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"elements":[{"trackId":"track_1","elementId":"element_abc"}]}' \
  http://127.0.0.1:8765/api/claude/timeline/project_123/selection | jq
```

#### Get timeline selection

```bash
GET /api/claude/timeline/:projectId/selection
```

```bash
curl -s http://127.0.0.1:8765/api/claude/timeline/project_123/selection | jq
```

Response:
```json
{"success": true, "data": {"elements": [{"trackId": "track_1", "elementId": "element_abc"}]}}
```

#### Clear timeline selection

```bash
DELETE /api/claude/timeline/:projectId/selection
```

```bash
curl -s -X DELETE http://127.0.0.1:8765/api/claude/timeline/project_123/selection | jq
```

---

### Project Endpoints

#### Get project settings

```bash
GET /api/claude/project/:projectId/settings
```

```bash
curl -s http://127.0.0.1:8765/api/claude/project/project_123/settings | jq
```

Response:
```json
{
  "success": true,
  "data": {
    "name": "My Video",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "aspectRatio": "16:9",
    "backgroundColor": "#000000",
    "exportFormat": "mp4",
    "exportQuality": "high"
  }
}
```

#### Update project settings

```bash
PATCH /api/claude/project/:projectId/settings
Content-Type: application/json

{"name": "New Name", "fps": 60, "width": 3840, "height": 2160}
```

```bash
curl -s -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"name":"My Video","fps":60,"width":3840,"height":2160}' \
  http://127.0.0.1:8765/api/claude/project/project_123/settings | jq
```

Side effects: Writes `project.json` to disk, sends `claude:project:updated` event to renderer.

#### Get project stats

```bash
GET /api/claude/project/:projectId/stats
```

```bash
curl -s http://127.0.0.1:8765/api/claude/project/project_123/stats | jq
```

Response:
```json
{
  "success": true,
  "data": {
    "totalDuration": 90,
    "mediaCount": {"video": 3, "audio": 1, "image": 2},
    "trackCount": 4,
    "elementCount": 12,
    "lastModified": 1707580800000,
    "fileSize": 52428800
  }
}
```

**Timeout:** 3 seconds. Returns empty stats if renderer unresponsive.

---

### Export Endpoints

#### List export presets

```bash
GET /api/claude/export/presets
```

```bash
curl -s http://127.0.0.1:8765/api/claude/export/presets | jq
```

Available presets:

| ID | Name | Resolution | FPS | Bitrate |
|----|------|-----------|-----|---------|
| `youtube-4k` | YouTube 4K | 3840x2160 | 60 | 45Mbps |
| `youtube-1080p` | YouTube 1080p | 1920x1080 | 30 | 8Mbps |
| `youtube-720p` | YouTube 720p | 1280x720 | 30 | 5Mbps |
| `tiktok` | TikTok | 1080x1920 | 30 | 6Mbps |
| `instagram-reel` | Instagram Reel | 1080x1920 | 30 | 5Mbps |
| `instagram-post` | Instagram Post | 1080x1080 | 30 | 5Mbps |
| `instagram-landscape` | Instagram Landscape | 1080x566 | 30 | 5Mbps |
| `twitter` | Twitter/X | 1920x1080 | 30 | 6Mbps |
| `linkedin` | LinkedIn | 1920x1080 | 30 | 8Mbps |
| `discord` | Discord (8MB limit) | 1280x720 | 30 | 2Mbps |

#### Get export recommendation

```bash
GET /api/claude/export/:projectId/recommend/:target
```

```bash
curl -s http://127.0.0.1:8765/api/claude/export/project_123/recommend/tiktok | jq
```

Response:
```json
{
  "success": true,
  "data": {
    "preset": {
      "id": "tiktok",
      "name": "TikTok",
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "bitrate": "6Mbps",
      "format": "mp4"
    },
    "warnings": ["Maximum video length is 10 minutes"],
    "suggestions": [
      "Videos under 60 seconds perform best on TikTok",
      "Add captions for better engagement (85% watch without sound)",
      "Use trending sounds when possible"
    ]
  }
}
```

Target can be a platform name (`youtube`, `tiktok`, `instagram`, `twitter`, `linkedin`, `discord`) or a preset ID (`youtube-4k`, `instagram-reel`, etc.).

---

### Diagnostics Endpoint

#### Analyze error

```bash
POST /api/claude/diagnostics/analyze
Content-Type: application/json

{
  "message": "ENOENT: no such file or directory",
  "stack": "Error: ENOENT...",
  "context": "media-import",
  "timestamp": 1707580800000
}
```

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"ENOENT: no such file","context":"media-import","timestamp":1707580800000}' \
  http://127.0.0.1:8765/api/claude/diagnostics/analyze | jq
```

Detected error types:

| Error Type | Triggers | Severity |
|-----------|----------|----------|
| `file_not_found` | ENOENT, "no such file" | medium |
| `permission_denied` | EACCES, EPERM | high |
| `out_of_memory` | ENOMEM, "heap" | critical |
| `ffmpeg_error` | "ffmpeg" in message/stack/context | medium |
| `network_error` | "network", "fetch", ECONNREFUSED | low |
| `ui_error` | "react" in stack, componentStack present | medium |
| `storage_error` | "indexeddb", "storage", "quota" | high |
| `unknown` | Everything else | medium |

---

## Electron IPC Reference

For use in renderer process code (React components, libraries).

### Namespace: `window.electronAPI.claude`

```typescript
// Media
await window.electronAPI.claude.media.list(projectId);
await window.electronAPI.claude.media.info(projectId, mediaId);
await window.electronAPI.claude.media.import(projectId, sourcePath);
await window.electronAPI.claude.media.delete(projectId, mediaId);
await window.electronAPI.claude.media.rename(projectId, mediaId, newName);

// Timeline
await window.electronAPI.claude.timeline.export(projectId, "json" | "md");
await window.electronAPI.claude.timeline.import(projectId, data, "json" | "md");
await window.electronAPI.claude.timeline.addElement(projectId, element);
await window.electronAPI.claude.timeline.updateElement(projectId, elementId, changes);
await window.electronAPI.claude.timeline.removeElement(projectId, elementId);

// Timeline event listeners (renderer-side)
window.electronAPI.claude.timeline.onRequest(callback);
window.electronAPI.claude.timeline.onApply(callback);
window.electronAPI.claude.timeline.onAddElement(callback);
window.electronAPI.claude.timeline.onUpdateElement(callback);
window.electronAPI.claude.timeline.onRemoveElement(callback);
window.electronAPI.claude.timeline.onSplitElement(callback);
window.electronAPI.claude.timeline.onMoveElement(callback);
window.electronAPI.claude.timeline.onSelectElements(callback);
window.electronAPI.claude.timeline.sendResponse(timeline);
window.electronAPI.claude.timeline.removeListeners();

// Project
await window.electronAPI.claude.project.getSettings(projectId);
await window.electronAPI.claude.project.updateSettings(projectId, settings);
await window.electronAPI.claude.project.getStats(projectId);

// Project event listeners (renderer-side)
window.electronAPI.claude.project.onStatsRequest(callback);
window.electronAPI.claude.project.sendStatsResponse(stats, requestId);
window.electronAPI.claude.project.onUpdated(callback);
window.electronAPI.claude.project.removeListeners();

// Export
await window.electronAPI.claude.export.getPresets();
await window.electronAPI.claude.export.recommend(projectId, target);

// Diagnostics
await window.electronAPI.claude.diagnostics.analyze(errorReport);
```

### IPC Channel Map

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `claude:media:list` | renderer → main | List media files |
| `claude:media:info` | renderer → main | Get file info |
| `claude:media:import` | renderer → main | Import file |
| `claude:media:delete` | renderer → main | Delete file |
| `claude:media:rename` | renderer → main | Rename file |
| `claude:timeline:export` | renderer → main | Export timeline |
| `claude:timeline:import` | renderer → main | Import timeline |
| `claude:timeline:addElement` | renderer → main | Add element |
| `claude:timeline:updateElement` | renderer → main | Update element |
| `claude:timeline:removeElement` | renderer → main | Remove element |
| `claude:timeline:splitElement` | main → renderer | Split element at time |
| `claude:timeline:splitElement:response` | renderer → main | Split result |
| `claude:timeline:moveElement` | main → renderer | Move element to track |
| `claude:timeline:selectElements` | main → renderer | Set selection |
| `claude:timeline:getSelection` | main → renderer | Request current selection |
| `claude:timeline:getSelection:response` | renderer → main | Selection result |
| `claude:timeline:clearSelection` | main → renderer | Clear selection |
| `claude:timeline:request` | main → renderer | Request timeline data |
| `claude:timeline:response` | renderer → main | Send timeline data |
| `claude:timeline:apply` | main → renderer | Apply imported timeline |
| `claude:project:getSettings` | renderer → main | Get settings |
| `claude:project:updateSettings` | renderer → main | Update settings |
| `claude:project:getStats` | renderer → main | Get stats |
| `claude:project:statsRequest` | main → renderer | Request stats |
| `claude:project:statsResponse` | renderer → main | Send stats |
| `claude:project:updated` | main → renderer | Notify settings changed |
| `claude:export:getPresets` | renderer → main | Get presets |
| `claude:export:recommend` | renderer → main | Get recommendation |
| `claude:diagnostics:analyze` | renderer → main | Analyze error |

---

## Security

### Path Validation Functions (from `electron/claude/utils/helpers.ts`)

| Function | Purpose |
|----------|---------|
| `isValidSourcePath(path)` | Absolute path, no null bytes |
| `isPathSafe(target, base)` | Target stays within base directory |
| `sanitizeFilename(name)` | Strips `/`, `\`, null bytes, `..` |
| `sanitizeProjectId(id)` | Prevents path traversal in project IDs |

### HTTP Server Security

| Measure | Detail |
|---------|--------|
| Binding | `127.0.0.1` only (no external access) |
| Auth | Optional bearer token (`QCUT_API_TOKEN`) |
| Body limit | 1MB max request body |
| Timeout | 30 seconds per request |
| Port | Default 8765, configurable via `QCUT_API_PORT` |
