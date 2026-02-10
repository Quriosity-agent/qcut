# QCut Claude Integration API - Usage Guide

> How to use the Claude Code Integration API to programmatically control QCut

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
   - [Media API](#1-media-api)
   - [Timeline API](#2-timeline-api)
   - [Project API](#3-project-api)
   - [Export API](#4-export-api)
   - [Diagnostics API](#5-diagnostics-api)
4. [Type Definitions](#type-definitions)
5. [Data Storage Paths](#data-storage-paths)
6. [Usage Examples](#usage-examples)
7. [Security](#security)
8. [Limitations](#limitations)

---

## Overview

The Claude Code Integration API lets external tools (Claude Code, scripts) interact with QCut's editor. It is organized into 5 modules with 18 total methods, accessible through two interfaces:

1. **Electron IPC** — `window.electronAPI.claude.*` (renderer process)
2. **HTTP REST API** — `http://127.0.0.1:8765/api/claude/*` (external tools like Claude Code)

---

## Architecture

```text
Claude Code (CLI)                      QCut Renderer Process
     |                                        |
     | HTTP (localhost:8765)                   | Electron IPC
     v                                        v
  claude-http-server.ts ──> Extracted Handler Functions <── IPC thin wrappers
                                    |
                                    v
                             Zustand Stores
               timeline-store, project-store, media-store
```

### Handler Registration

All handlers are registered during app startup in `electron/main.ts`:

```typescript
const { setupAllClaudeIPC } = require("./claude/index.js");
setupAllClaudeIPC();
```

This calls each module's setup function:

| Module | Setup Function | File |
|--------|---------------|------|
| Media | `setupClaudeMediaIPC()` | `electron/claude/claude-media-handler.ts` |
| Timeline | `setupClaudeTimelineIPC()` | `electron/claude/claude-timeline-handler.ts` |
| Project | `setupClaudeProjectIPC()` | `electron/claude/claude-project-handler.ts` |
| Export | `setupClaudeExportIPC()` | `electron/claude/claude-export-handler.ts` |
| Diagnostics | `setupClaudeDiagnosticsIPC()` | `electron/claude/claude-diagnostics-handler.ts` |
| HTTP Server | `startClaudeHTTPServer()` | `electron/claude/claude-http-server.ts` |

### Shared Types

All types live in `electron/types/claude-api.ts` and are imported by both main and renderer processes.

---

## API Reference

### 1. Media API

**Namespace:** `window.electronAPI.claude.media`

Manages media files in a project's `media/` folder.

---

#### `media.list(projectId)`

List all media files in a project.

```typescript
const files = await window.electronAPI.claude.media.list("project_123");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |

**Returns:** `Promise<MediaFile[]>`

**IPC Channel:** `claude:media:list`

---

#### `media.info(projectId, mediaId)`

Get detailed info about a specific media file.

```typescript
const file = await window.electronAPI.claude.media.info("project_123", "media_dmlkZW8ubXA0");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `mediaId` | `string` | Media file ID (base64url of filename) |

**Returns:** `Promise<MediaFile | null>`

**IPC Channel:** `claude:media:info`

**Note:** Media IDs are deterministic - generated as `media_${base64url(filename)}`. This means the same filename always produces the same ID.

---

#### `media.import(projectId, source)`

Import a media file by copying it into the project's media folder.

```typescript
const imported = await window.electronAPI.claude.media.import(
  "project_123",
  "C:\\Users\\me\\Videos\\clip.mp4"
);
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `source` | `string` | Absolute path to source file |

**Returns:** `Promise<MediaFile | null>` - `null` on failure

**Behavior:**
- Validates source path (must be absolute, no null bytes)
- Creates `media/` directory if it doesn't exist
- Sanitizes filename (removes path separators, null bytes)
- Handles duplicate filenames by appending `_1`, `_2`, etc.
- Rejects unsupported file types

**IPC Channel:** `claude:media:import`

---

#### `media.delete(projectId, mediaId)`

Delete a media file from the project.

```typescript
const success = await window.electronAPI.claude.media.delete("project_123", "media_dmlkZW8ubXA0");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `mediaId` | `string` | Media file ID |

**Returns:** `Promise<boolean>`

**IPC Channel:** `claude:media:delete`

---

#### `media.rename(projectId, mediaId, newName)`

Rename a media file. Preserves the original extension if omitted.

```typescript
const success = await window.electronAPI.claude.media.rename(
  "project_123",
  "media_dmlkZW8ubXA0",
  "intro-clip"
);
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `mediaId` | `string` | Media file ID |
| `newName` | `string` | New filename (extension optional) |

**Returns:** `Promise<boolean>`

**IPC Channel:** `claude:media:rename`

---

### 2. Timeline API

**Namespace:** `window.electronAPI.claude.timeline`

Read/write timeline data. Uses a **request-response pattern** where the main process asks the renderer for current timeline state via IPC events.

---

#### `timeline.export(projectId, format)`

Export the current timeline as JSON or Markdown.

```typescript
// Export as JSON
const json = await window.electronAPI.claude.timeline.export("project_123", "json");
const timeline = JSON.parse(json);

// Export as Markdown (human-readable)
const md = await window.electronAPI.claude.timeline.export("project_123", "md");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `format` | `"json" \| "md"` | Output format |

**Returns:** `Promise<string>` - Serialized timeline

**IPC Channel:** `claude:timeline:export`

**How it works:**
1. Main process sends `claude:timeline:request` event to renderer
2. Renderer reads from `useTimelineStore` and `useProjectStore`
3. Renderer sends data back via `claude:timeline:response`
4. Main process formats and returns the result
5. Timeout: 5 seconds

**Markdown output example:**

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

---

#### `timeline.import(projectId, data, format)`

Import timeline data into the project.

```typescript
await window.electronAPI.claude.timeline.import("project_123", jsonString, "json");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `data` | `string` | Serialized timeline |
| `format` | `"json" \| "md"` | Input format |

**Returns:** `Promise<void>`

**IPC Channel:** `claude:timeline:import`

**Limitations:**
- Markdown import only parses metadata (name, resolution, FPS, duration). Track data is NOT parsed from Markdown - throws an error if tracks are present. **Use JSON format for full import.**
- JSON import validates structure then sends to renderer via `claude:timeline:apply` event

---

#### `timeline.addElement(projectId, element)`

Add a new element to the timeline.

```typescript
const elementId = await window.electronAPI.claude.timeline.addElement("project_123", {
  type: "text",
  trackIndex: 0,
  startTime: 5.0,
  endTime: 10.0,
  content: "Hello World",
});
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `element` | `Partial<ClaudeElement>` | Element definition |

**Returns:** `Promise<string>` - Generated element ID

**IPC Channel:** `claude:timeline:addElement`

---

#### `timeline.updateElement(projectId, elementId, changes)`

Update properties of an existing timeline element.

```typescript
await window.electronAPI.claude.timeline.updateElement("project_123", "element_abc", {
  startTime: 2.0,
  endTime: 8.0,
});
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `elementId` | `string` | Element to update |
| `changes` | `Partial<ClaudeElement>` | Properties to change |

**Returns:** `Promise<void>`

**IPC Channel:** `claude:timeline:updateElement`

---

#### `timeline.removeElement(projectId, elementId)`

Remove an element from the timeline.

```typescript
await window.electronAPI.claude.timeline.removeElement("project_123", "element_abc");
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `elementId` | `string` | Element to remove |

**Returns:** `Promise<void>`

**IPC Channel:** `claude:timeline:removeElement`

---

#### Timeline Event Listeners (Renderer Side)

The renderer process uses these listeners to respond to main process requests:

```typescript
// Respond to export requests
window.electronAPI.claude.timeline.onRequest(() => {
  const timeline = buildTimelineForExport();
  window.electronAPI.claude.timeline.sendResponse(timeline);
});

// Handle timeline apply (import)
window.electronAPI.claude.timeline.onApply((timeline) => {
  applyTimelineToStore(timeline);
});

// Handle element operations
window.electronAPI.claude.timeline.onAddElement((element) => { /* ... */ });
window.electronAPI.claude.timeline.onUpdateElement((data) => { /* ... */ });
window.electronAPI.claude.timeline.onRemoveElement((elementId) => { /* ... */ });

// Cleanup
window.electronAPI.claude.timeline.removeListeners();
```

---

### 3. Project API

**Namespace:** `window.electronAPI.claude.project`

Read/write project settings stored in `project.json`.

---

#### `project.getSettings(projectId)`

Get project settings.

```typescript
const settings = await window.electronAPI.claude.project.getSettings("project_123");
console.log(`${settings.name} - ${settings.width}x${settings.height} @ ${settings.fps}fps`);
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |

**Returns:** `Promise<ProjectSettings>`

**IPC Channel:** `claude:project:getSettings`

---

#### `project.updateSettings(projectId, settings)`

Update project settings. Persists to disk and notifies renderer.

```typescript
await window.electronAPI.claude.project.updateSettings("project_123", {
  name: "My Video",
  fps: 60,
  width: 3840,
  height: 2160,
});
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `settings` | `Partial<ProjectSettings>` | Fields to update |

**Returns:** `Promise<void>`

**Side effects:**
- Writes updated `project.json` to disk
- Sends `claude:project:updated` event to renderer
- Sets `updatedAt` timestamp

**IPC Channel:** `claude:project:updateSettings`

---

#### `project.getStats(projectId)`

Get project statistics (duration, media count, track count, etc.).

```typescript
const stats = await window.electronAPI.claude.project.getStats("project_123");
console.log(`Duration: ${stats.totalDuration}s, Tracks: ${stats.trackCount}`);
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |

**Returns:** `Promise<ProjectStats>`

**IPC Channel:** `claude:project:getStats`

**How it works:** Main process sends `claude:project:statsRequest` to renderer, which reads from Zustand stores and responds via `claude:project:statsResponse`. Timeout: 3 seconds (returns empty stats on timeout).

---

#### Project Event Listeners (Renderer Side)

```typescript
// Respond to stats requests
window.electronAPI.claude.project.onStatsRequest(() => {
  const stats = computeProjectStats();
  window.electronAPI.claude.project.sendStatsResponse(stats);
});

// Handle project updates from Claude
window.electronAPI.claude.project.onUpdated((projectId, settings) => {
  applySettingsToStore(projectId, settings);
});

// Cleanup
window.electronAPI.claude.project.removeListeners();
```

---

### 4. Export API

**Namespace:** `window.electronAPI.claude.export`

Provides platform-specific export presets and recommendations.

---

#### `export.getPresets()`

Get all available export presets.

```typescript
const presets = await window.electronAPI.claude.export.getPresets();
presets.forEach(p => console.log(`${p.name}: ${p.width}x${p.height} @ ${p.fps}fps`));
```

**Returns:** `Promise<ExportPreset[]>`

**Available presets:**

| ID | Name | Resolution | FPS | Bitrate |
|----|------|-----------|-----|---------|
| `youtube-4k` | YouTube 4K | 3840x2160 | 60 | 45Mbps |
| `youtube-1080p` | YouTube 1080p | 1920x1080 | 30 | 8Mbps |
| `youtube-720p` | YouTube 720p | 1280x720 | 30 | 5Mbps |
| `tiktok` | TikTok | 1080x1920 | 30 | 6Mbps |
| `instagram-reel` | Instagram Reel | 1080x1920 | 30 | 5Mbps |
| `instagram-post` | Instagram Post (Square) | 1080x1080 | 30 | 5Mbps |
| `instagram-landscape` | Instagram Post (Landscape) | 1080x566 | 30 | 5Mbps |
| `twitter` | Twitter/X | 1920x1080 | 30 | 6Mbps |
| `linkedin` | LinkedIn | 1920x1080 | 30 | 8Mbps |
| `discord` | Discord (8MB limit) | 1280x720 | 30 | 2Mbps |

**IPC Channel:** `claude:export:getPresets`

---

#### `export.recommend(projectId, target)`

Get platform-specific export recommendations with warnings and suggestions.

```typescript
const rec = await window.electronAPI.claude.export.recommend("project_123", "tiktok");
console.log("Preset:", rec.preset.name);
console.log("Warnings:", rec.warnings);
console.log("Suggestions:", rec.suggestions);
```

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | Project identifier |
| `target` | `string` | Platform name (`youtube`, `tiktok`, `instagram`, `twitter`, `linkedin`, `discord`) or preset ID (`youtube-4k`) |

**Returns:** `Promise<ExportRecommendation>`

**Example response for `"tiktok"`:**

```json
{
  "preset": {
    "id": "tiktok",
    "name": "TikTok",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "bitrate": "6Mbps",
    "format": "mp4"
  },
  "warnings": [
    "Maximum video length is 10 minutes"
  ],
  "suggestions": [
    "Videos under 60 seconds perform best on TikTok",
    "Add captions for better engagement (85% watch without sound)",
    "Use trending sounds when possible"
  ]
}
```

**IPC Channel:** `claude:export:recommend`

---

### 5. Diagnostics API

**Namespace:** `window.electronAPI.claude.diagnostics`

Analyzes errors and provides diagnostic information with system context.

---

#### `diagnostics.analyze(error)`

Analyze an error and get diagnosis with suggested fixes.

```typescript
const diagnosis = await window.electronAPI.claude.diagnostics.analyze({
  message: "ENOENT: no such file or directory",
  stack: error.stack,
  context: "media-import",
  timestamp: Date.now(),
});

console.log(`Type: ${diagnosis.errorType}`);        // "file_not_found"
console.log(`Severity: ${diagnosis.severity}`);      // "medium"
console.log(`Causes:`, diagnosis.possibleCauses);
console.log(`Fixes:`, diagnosis.suggestedFixes);
console.log(`System:`, diagnosis.systemInfo);
```

| Param | Type | Description |
|-------|------|-------------|
| `error` | `ErrorReport` | Error details to analyze |

**ErrorReport fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | Error message |
| `stack` | `string` | No | Stack trace |
| `context` | `string` | Yes | Where the error occurred |
| `timestamp` | `number` | Yes | When the error occurred (ms) |
| `componentStack` | `string` | No | React component stack |

**Returns:** `Promise<DiagnosticResult>`

**Detected error types:**

| Error Type | Triggers | Severity |
|-----------|----------|----------|
| `file_not_found` | ENOENT, "no such file" | medium |
| `permission_denied` | EACCES, EPERM, "permission" | high |
| `out_of_memory` | ENOMEM, "out of memory", "heap" | critical |
| `ffmpeg_error` | "ffmpeg" in message/stack/context | medium |
| `network_error` | "network", "fetch", ECONNREFUSED, "timeout" | low |
| `ui_error` | "react" in stack, "render", componentStack present | medium |
| `storage_error` | "indexeddb", "storage", "quota" | high |
| `unknown` | Everything else | medium |

**System info included in response:**

```typescript
{
  platform: "win32",
  arch: "x64",
  osVersion: "10.0.22631",
  appVersion: "0.3.59",
  nodeVersion: "20.11.0",
  electronVersion: "28.1.0",
  memory: { total: 17179869184, free: 8589934592, used: 8589934592 },
  cpuCount: 8
}
```

**IPC Channel:** `claude:diagnostics:analyze`

---

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

## Data Storage Paths

All project data is stored under the user's Documents folder:

```
Documents/
└── QCut/
    └── Projects/
        └── {projectId}/
            ├── project.json     # Project settings (read by Project API)
            ├── timeline.json    # Timeline data (not directly used by Claude API)
            └── media/           # Media files (managed by Media API)
                ├── video.mp4
                ├── audio.mp3
                └── image.png
```

**Path helper functions** (from `electron/claude/utils/helpers.ts`):

| Function | Returns |
|----------|---------|
| `getProjectPath(id)` | `Documents/QCut/Projects/{id}` |
| `getMediaPath(id)` | `Documents/QCut/Projects/{id}/media` |
| `getTimelinePath(id)` | `Documents/QCut/Projects/{id}/timeline.json` |
| `getProjectSettingsPath(id)` | `Documents/QCut/Projects/{id}/project.json` |

---

## Usage Examples

### Example 1: Full Project Analysis

```typescript
async function analyzeProject(projectId: string) {
  const claude = window.electronAPI.claude;

  // Get project info
  const settings = await claude.project.getSettings(projectId);
  console.log(`Project: ${settings.name}`);
  console.log(`Canvas: ${settings.width}x${settings.height} @ ${settings.fps}fps`);

  // Get statistics
  const stats = await claude.project.getStats(projectId);
  console.log(`Duration: ${stats.totalDuration}s`);
  console.log(`Tracks: ${stats.trackCount}, Elements: ${stats.elementCount}`);
  console.log(`Media: ${stats.mediaCount.video} video, ${stats.mediaCount.audio} audio, ${stats.mediaCount.image} image`);

  // List all media files
  const media = await claude.media.list(projectId);
  for (const file of media) {
    console.log(`  ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  }
}
```

### Example 2: Export Timeline for Review

```typescript
async function reviewTimeline(projectId: string) {
  const claude = window.electronAPI.claude;

  // Get human-readable timeline
  const md = await claude.timeline.export(projectId, "md");
  console.log(md);

  // Get machine-readable timeline for analysis
  const json = await claude.timeline.export(projectId, "json");
  const timeline = JSON.parse(json);

  // Analyze track usage
  for (const track of timeline.tracks) {
    const totalDuration = track.elements.reduce((sum, el) => sum + el.duration, 0);
    console.log(`Track ${track.index} (${track.name}): ${track.elements.length} elements, ${totalDuration.toFixed(1)}s total`);
  }
}
```

### Example 3: Import Media and Get Export Recommendation

```typescript
async function prepareForTikTok(projectId: string, videoPath: string) {
  const claude = window.electronAPI.claude;

  // Import the source video
  const media = await claude.media.import(projectId, videoPath);
  if (!media) {
    console.error("Failed to import media");
    return;
  }
  console.log(`Imported: ${media.name} (${media.type})`);

  // Get TikTok export recommendation
  const rec = await claude.export.recommend(projectId, "tiktok");
  console.log(`Recommended: ${rec.preset.name} (${rec.preset.width}x${rec.preset.height})`);

  if (rec.warnings.length > 0) {
    console.warn("Warnings:", rec.warnings.join(", "));
  }
  for (const suggestion of rec.suggestions) {
    console.log(`Tip: ${suggestion}`);
  }
}
```

### Example 4: Error Diagnostics

```typescript
async function handleError(error: Error, context: string) {
  const claude = window.electronAPI.claude;

  const diagnosis = await claude.diagnostics.analyze({
    message: error.message,
    stack: error.stack,
    context,
    timestamp: Date.now(),
  });

  console.log(`Error Type: ${diagnosis.errorType} (${diagnosis.severity})`);
  console.log("Possible Causes:");
  for (const cause of diagnosis.possibleCauses) {
    console.log(`  - ${cause}`);
  }
  console.log("Suggested Fixes:");
  for (const fix of diagnosis.suggestedFixes) {
    console.log(`  - ${fix}`);
  }
  console.log(`System: ${diagnosis.systemInfo.platform} ${diagnosis.systemInfo.arch}, Memory: ${(diagnosis.systemInfo.memory.used / 1024 / 1024 / 1024).toFixed(1)}GB / ${(diagnosis.systemInfo.memory.total / 1024 / 1024 / 1024).toFixed(1)}GB`);
}
```

### Example 5: Batch Update Project Settings

```typescript
async function configureForYouTube4K(projectId: string) {
  const claude = window.electronAPI.claude;

  // Get recommended settings
  const rec = await claude.export.recommend(projectId, "youtube-4k");

  // Apply recommended resolution and FPS
  await claude.project.updateSettings(projectId, {
    width: rec.preset.width,
    height: rec.preset.height,
    fps: rec.preset.fps,
    exportFormat: rec.preset.format,
    exportQuality: "high",
  });

  // Verify
  const updated = await claude.project.getSettings(projectId);
  console.log(`Updated: ${updated.width}x${updated.height} @ ${updated.fps}fps`);
}
```

---

## Security

### Path Validation

- **`isValidSourcePath()`** - Import sources must be absolute paths, no null bytes
- **`isPathSafe()`** - Prevents path traversal attacks (target must be within base directory)
- **`sanitizeFilename()`** - Strips path separators (`/`, `\`), null bytes, and `..` from filenames

### Supported Media Formats

| Type | Extensions |
|------|-----------|
| Video | `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`, `.wmv` |
| Audio | `.mp3`, `.wav`, `.aac`, `.ogg`, `.m4a`, `.flac`, `.wma` |
| Image | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`, `.tiff` |

Files with unsupported extensions are silently rejected.

### IPC Channel Isolation

All Claude API channels use the `claude:` prefix, preventing conflicts with existing QCut IPC channels.

---

## HTTP API (External Control)

QCut exposes a REST API on `http://127.0.0.1:8765` for external tools like Claude Code. The server starts automatically when QCut launches and binds to localhost only (no external network access).

### Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `QCUT_API_PORT` | `8765` | HTTP server port |
| `QCUT_API_TOKEN` | (none) | Bearer token for authentication (optional) |

If `QCUT_API_TOKEN` is set, all requests require the header:

```text
Authorization: Bearer your-secret
```

### Route Map

| HTTP Method | Route | Description |
|-------------|-------|-------------|
| `GET` | `/api/claude/health` | Health check |
| `GET` | `/api/claude/media/:projectId` | List media files |
| `GET` | `/api/claude/media/:projectId/:mediaId` | Get media info |
| `POST` | `/api/claude/media/:projectId/import` | Import media (`{"source": "..."}`) |
| `DELETE` | `/api/claude/media/:projectId/:mediaId` | Delete media |
| `PATCH` | `/api/claude/media/:projectId/:mediaId/rename` | Rename media (`{"newName": "..."}`) |
| `GET` | `/api/claude/timeline/:projectId` | Export timeline (`?format=json\|md`) |
| `POST` | `/api/claude/timeline/:projectId/import` | Import timeline |
| `POST` | `/api/claude/timeline/:projectId/elements` | Add element |
| `PATCH` | `/api/claude/timeline/:projectId/elements/:elementId` | Update element |
| `DELETE` | `/api/claude/timeline/:projectId/elements/:elementId` | Remove element |
| `GET` | `/api/claude/project/:projectId/settings` | Get settings |
| `PATCH` | `/api/claude/project/:projectId/settings` | Update settings |
| `GET` | `/api/claude/project/:projectId/stats` | Get stats |
| `GET` | `/api/claude/export/presets` | List presets |
| `GET` | `/api/claude/export/:projectId/recommend/:target` | Get recommendation |
| `POST` | `/api/claude/diagnostics/analyze` | Analyze error |

### Response Format

All responses use a consistent JSON envelope:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": 1707580800000
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": 1707580800000
}
```

### curl Examples

```bash
# Health check
curl http://127.0.0.1:8765/api/claude/health

# List media
curl http://127.0.0.1:8765/api/claude/media/project_123

# Export timeline as markdown
curl "http://127.0.0.1:8765/api/claude/timeline/project_123?format=md"

# Import media
curl -X POST http://127.0.0.1:8765/api/claude/media/project_123/import \
  -H "Content-Type: application/json" \
  -d '{"source": "C:\\Users\\me\\Videos\\clip.mp4"}'

# Get TikTok export recommendation
curl http://127.0.0.1:8765/api/claude/export/project_123/recommend/tiktok

# With authentication
curl -H "Authorization: Bearer <your-token>" \
  http://127.0.0.1:8765/api/claude/health
```

### Security

| Risk | Mitigation |
|------|-----------|
| Network exposure | Binds to `127.0.0.1` only |
| Unauthorized access | Optional bearer token via `QCUT_API_TOKEN` |
| Path traversal | Reuses existing `isValidSourcePath()` and `sanitizeFilename()` |
| Port conflict | Configurable via `QCUT_API_PORT` (default 8765) |
| Denial of service | 1MB body size limit, 30s request timeout |

### Implementation Files

| File | Purpose |
|------|---------|
| `electron/claude/claude-http-server.ts` | HTTP server, route registration, auth |
| `electron/claude/utils/http-router.ts` | Lightweight router (path params, body parsing) |

---

## Limitations

### Timeline Write Operations

- `timeline.import()` with Markdown format only parses metadata (name, resolution, FPS). Use JSON format for full timeline import.
- `timeline.addElement()` and `timeline.updateElement()` send events to the renderer but the renderer-side handling depends on the Timeline Bridge being fully connected.
- `timeline.removeElement()` is fully functional.

### Request Timeouts

| Operation | Timeout | Fallback |
|-----------|---------|----------|
| `timeline.export()` | 5 seconds | Throws error |
| `project.getStats()` | 3 seconds | Returns empty stats |

---

*Source: `electron/claude/` handlers, `electron/types/claude-api.ts`*
*Last updated: 2026-02-10*
