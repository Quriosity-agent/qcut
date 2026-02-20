# Project, Export, Generate & Diagnostics API Reference

Base URL: `http://127.0.0.1:8765/api/claude`

## Types

```typescript
// Project
interface ProjectSettings {
  name: string; width: number; height: number; fps: number;
  aspectRatio: string; backgroundColor: string;
  exportFormat: string; exportQuality: string;
}
interface ProjectStats {
  totalDuration: number;
  mediaCount: { video: number; audio: number; image: number };
  trackCount: number; elementCount: number;
  lastModified: number; fileSize: number;
}
interface ProjectSummary { markdown: string; stats: { totalDuration: number; mediaCount: number; elementCount: number } }
interface PipelineStep { stage: string; action: string; details: string; timestamp: number; duration?: number; projectId?: string }
interface PipelineReport { markdown: string; savedTo?: string }

// Export
interface ExportPreset { id: string; name: string; platform: string; width: number; height: number; fps: number; bitrate: string; format: string }
interface ExportRecommendation { preset: ExportPreset; warnings: string[]; suggestions: string[]; estimatedFileSize?: string }
interface ExportJobRequest { preset?: string; settings?: { width?: number; height?: number; fps?: number; bitrate?: string; format?: string; codec?: string }; outputPath?: string }
interface ExportJobStatus {
  jobId: string; projectId: string;
  status: "queued" | "exporting" | "completed" | "failed";
  progress: number; outputPath?: string; error?: string;
  startedAt: number; completedAt?: number;
  currentFrame?: number; totalFrames?: number; timeRemaining?: number;
  duration?: number; fileSize?: number; presetId?: string;
}

// Generate
interface GenerateAndAddRequest {
  model: string; prompt: string; imageUrl?: string; videoUrl?: string;
  duration?: number; aspectRatio?: string; resolution?: string; negativePrompt?: string;
  addToTimeline?: boolean; trackId?: string; startTime?: number; projectId: string;
}
interface GenerateJobStatus {
  jobId: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number; message: string; model: string;
  result?: { url?: string; mediaId?: string; elementId?: string };
  createdAt: number; updatedAt: number;
}

// Diagnostics
interface ErrorReport { message: string; stack?: string; context: string; timestamp: number; componentStack?: string }
interface DiagnosticResult {
  errorType: string; severity: "low" | "medium" | "high" | "critical";
  possibleCauses: string[]; suggestedFixes: string[];
  canAutoFix: boolean; autoFixAction?: string;
  systemInfo: SystemInfo;
}
interface SystemInfo {
  platform: string; arch: string; osVersion: string; appVersion: string;
  nodeVersion: string; electronVersion: string;
  memory: { total: number; free: number; used: number }; cpuCount: number;
}
```

## Project Endpoints

#### Get / Update settings
```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/settings | jq

curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"name":"My Video","fps":60,"width":3840,"height":2160}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/settings | jq
```

#### Get stats
```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/stats | jq
```

#### Get project summary (markdown)
```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/summary | jq -r '.data.markdown'
```

#### Generate pipeline report
```bash
# In-memory
curl -s -X POST -H "Content-Type: application/json" -d '{}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq -r '.data.markdown'

# Save to disk and clear log
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"saveTo":"/tmp/","clearLog":true}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq
```

## Export Endpoints

#### List presets
```bash
curl -s http://127.0.0.1:8765/api/claude/export/presets | jq
```

| ID | Resolution | FPS | Bitrate |
|----|-----------|-----|---------|
| `youtube-4k` | 3840x2160 | 60 | 45Mbps |
| `youtube-1080p` | 1920x1080 | 30 | 8Mbps |
| `youtube-720p` | 1280x720 | 30 | 5Mbps |
| `tiktok` | 1080x1920 | 30 | 6Mbps |
| `instagram-reel` | 1080x1920 | 30 | 5Mbps |
| `instagram-post` | 1080x1080 | 30 | 5Mbps |
| `instagram-landscape` | 1080x566 | 30 | 5Mbps |
| `twitter` | 1920x1080 | 30 | 6Mbps |
| `linkedin` | 1920x1080 | 30 | 8Mbps |
| `discord` | 1280x720 | 30 | 2Mbps |

#### Get recommendation
```bash
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/recommend/tiktok | jq
```

#### Start export job
```bash
# Preset
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"preset":"youtube-1080p"}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq

# Custom
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"settings":{"width":1920,"height":1080,"fps":30,"format":"mp4"}}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq
```

#### Poll / List export jobs
```bash
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/jobs | jq
```

## Generate Endpoints (AI Video/Image)

```bash
# Start
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"model":"fal-ai/wan","prompt":"A sunset over the ocean","duration":5,"addToTimeline":true,"trackId":"TRACK_ID"}' \
  http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/start | jq

# Poll / List / Cancel
curl -s http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs/$JOB_ID/cancel | jq

# List models / Estimate cost
curl -s http://127.0.0.1:8765/api/claude/generate/models | jq
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"model":"fal-ai/wan","duration":5}' \
  http://127.0.0.1:8765/api/claude/generate/estimate-cost | jq
```

## Diagnostics Endpoint

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"message":"ENOENT: no such file","context":"media-import","timestamp":1707580800000}' \
  http://127.0.0.1:8765/api/claude/diagnostics/analyze | jq
```

| Error Type | Triggers | Severity |
|-----------|----------|----------|
| `file_not_found` | ENOENT, "no such file" | medium |
| `permission_denied` | EACCES, EPERM | high |
| `out_of_memory` | ENOMEM, "heap" | critical |
| `ffmpeg_error` | "ffmpeg" in message/stack/context | medium |
| `network_error` | "network", "fetch", ECONNREFUSED | low |
| `ui_error` | "react" in stack | medium |
| `storage_error` | "indexeddb", "storage", "quota" | high |

## Security

| Measure | Detail |
|---------|--------|
| Binding | `127.0.0.1` only |
| Auth | Optional bearer token (`QCUT_API_TOKEN`) |
| Body limit | 1MB |
| Timeout | 30s per request |
| Port | 8765 (configurable via `QCUT_API_PORT`) |

Path validation: `isValidSourcePath()`, `isPathSafe()`, `sanitizeFilename()`, `sanitizeProjectId()` in `electron/claude/utils/helpers.ts`.

## Electron IPC (Renderer)

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

// Project
await window.electronAPI.claude.project.getSettings(projectId);
await window.electronAPI.claude.project.updateSettings(projectId, settings);
await window.electronAPI.claude.project.getStats(projectId);

// Export
await window.electronAPI.claude.export.getPresets();
await window.electronAPI.claude.export.recommend(projectId, target);

// Diagnostics
await window.electronAPI.claude.diagnostics.analyze(errorReport);
```
