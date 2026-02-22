# Editor CLI Phase 1: Core Infrastructure + Media + Project

> **Date:** 2026-02-22
> **Goal:** Build the shared HTTP client, type definitions, and command dispatcher, then implement `editor:health`, `editor:media:*` (8 commands), and `editor:project:*` (5 commands).
> **Reference:** [editor-cli-overview.md](editor-cli-overview.md), `electron/claude/claude-http-server.ts`, `electron/claude/claude-media-handler.ts`, `electron/claude/claude-project-handler.ts`
> **Status:** DONE
> **Depends on:** Nothing (first phase)
> **Implemented:** 2026-02-22

### Implementation Status

| Subtask | Status | File |
|---------|--------|------|
| 1.1 EditorApiClient | DONE | `electron/native-pipeline/editor-api-client.ts` (216 lines) |
| 1.2 Editor API Types | DONE | `electron/native-pipeline/editor-api-types.ts` (108 lines) |
| 1.3 Editor Command Dispatcher | DONE | `electron/native-pipeline/cli-handlers-editor.ts` (80 lines) |
| 1.4 Media Handlers | DONE | `electron/native-pipeline/editor-handlers-media.ts` (278 lines) |
| 1.5 Project Handlers | DONE | `electron/native-pipeline/editor-handlers-media.ts` (same file) |
| 1.6 Unit Tests | DONE | `electron/__tests__/editor-api-client.test.ts` (24/24 passing) |

### Additional Changes
- `electron/native-pipeline/cli.ts` — Added 14 editor commands to COMMANDS array, 45 new parseArgs flags, help text, TTY output handling
- `electron/native-pipeline/cli-runner.ts` — Added import + `editor:*` catch-all dispatch in default case, 30+ new fields on CLIRunOptions

---

## Subtask 1.1: Create EditorApiClient

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/editor-api-client.ts` (create, ~180 lines)

**Changes:**

Create a shared HTTP client class that all editor handlers use.

```typescript
interface EditorApiConfig {
  baseUrl: string;       // default: http://127.0.0.1:8765
  token?: string;        // from QCUT_API_TOKEN or --token
  timeout: number;       // default: 30000ms
}

interface EditorApiError extends Error {
  statusCode?: number;
  apiError?: string;
}

class EditorApiClient {
  constructor(config?: Partial<EditorApiConfig>)

  // Core HTTP methods — unwrap response envelope, throw on !success
  async get<T>(path: string, query?: Record<string, string>): Promise<T>
  async post<T>(path: string, body?: unknown): Promise<T>
  async patch<T>(path: string, body?: unknown): Promise<T>
  async delete<T>(path: string, body?: unknown): Promise<T>

  // Health check — returns true if QCut is running
  async checkHealth(): Promise<boolean>

  // Async job polling
  async pollJob<T>(
    statusPath: string,
    options: {
      interval?: number;      // default: 3000ms
      timeout?: number;       // default: 300000ms
      onProgress?: (progress: { status: string; progress?: number; message?: string }) => void;
      signal?: AbortSignal;
    }
  ): Promise<T>
}

// Factory function — reads config from env + CLI flags
function createEditorClient(options: CLIRunOptions): EditorApiClient
```

**Implementation details:**
- `createEditorClient` reads `--host` (default `127.0.0.1`), `--port` (default `8765`), `--token` from options, falling back to `QCUT_API_HOST`, `QCUT_API_PORT`, `QCUT_API_TOKEN` env vars
- All methods call `fetch()` with appropriate headers (`Content-Type: application/json`, `Authorization: Bearer <token>` if set)
- Response parsing: parse JSON, check `success` field, return `data` or throw `EditorApiError` with the `error` message
- `pollJob`: loops calling GET on the status path, checks `data.status` for `completed`/`failed`/`cancelled`, calls `onProgress` callback, respects `signal` for Ctrl+C cancellation
- No external dependencies — uses Node's built-in `fetch`

**Reference:** Pattern from `electron/native-pipeline/api-caller.ts` (lines 131-205 for auth headers, retry logic)

---

## Subtask 1.2: Create Editor API Types

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/editor-api-types.ts` (create, ~120 lines)

**Changes:**

Define TypeScript interfaces for editor-specific CLI option extensions and common response shapes. These extend the existing `CLIRunOptions` interface without modifying it.

```typescript
// Editor-specific options parsed from CLI flags
interface EditorOptions {
  projectId?: string;
  mediaId?: string;
  elementId?: string;
  jobId?: string;
  trackId?: string;
  toTrack?: string;
  splitTime?: number;
  startTime?: number;
  endTime?: number;
  newName?: string;
  changes?: string;    // raw JSON string
  updates?: string;    // raw JSON string
  elements?: string;   // raw JSON string
  cuts?: string;       // raw JSON string
  items?: string;      // raw JSON string
  target?: string;
  preset?: string;
  threshold?: number;
  timestamps?: string; // comma-separated
  host?: string;
  port?: number;
  token?: string;
  poll?: boolean;
  pollInterval?: number;
  replace?: boolean;
  ripple?: boolean;
  crossTrackRipple?: boolean;
  removeFillers?: boolean;
  removeSilences?: boolean;
  html?: string;
  message?: string;
  stack?: string;
}

// JSON input resolver — handles @file, inline JSON, stdin
function resolveJsonInput(value: string): Promise<unknown>

// Common response types (mirror server-side types from electron/types/claude-api.ts)
interface MediaFile { id: string; name: string; type: string; path: string; size: number; duration?: number }
interface ProjectSettings { name: string; width: number; height: number; fps: number; aspectRatio?: string }
interface ProjectStats { totalDuration: number; mediaCount: { video: number; audio: number; image: number }; trackCount: number; elementCount: number }
interface AsyncJobStatus { jobId: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; progress?: number; message?: string; result?: unknown }
```

**Reference:** Type definitions in `electron/types/claude-api.ts`

---

## Subtask 1.3: Create Editor Command Dispatcher

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/cli-handlers-editor.ts` (create, ~150 lines)

**Changes:**

Create the secondary router that dispatches `editor:*` commands to the correct handler file.

```typescript
import type { CLIRunOptions, CLIResult, ProgressFn } from "./cli-runner.js";
import { createEditorClient } from "./editor-api-client.js";

export async function handleEditorCommand(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  // 1. Create shared client
  const client = createEditorClient(options);

  // 2. Health check (skip for editor:health itself)
  if (options.command !== "editor:health") {
    const healthy = await client.checkHealth();
    if (!healthy) {
      return {
        success: false,
        error: "QCut editor not running at http://127.0.0.1:8765\nStart QCut with: bun run electron:dev",
      };
    }
  }

  // 3. Extract module from command: "editor:media:list" → "media"
  const parts = options.command.split(":");
  const module = parts[1];

  // 4. Dispatch by module
  switch (module) {
    case "health":
      return handleEditorHealth(client);
    case "media":
    case "project":
      return handleMediaProjectCommand(client, options, onProgress);
    case "timeline":
    case "editing":
      return handleTimelineEditingCommand(client, options, onProgress);
    case "analyze":
    case "transcribe":
      return handleAnalysisCommand(client, options, onProgress);
    case "generate":
    case "export":
    case "diagnostics":
    case "mcp":
      return handleGenerateExportCommand(client, options, onProgress);
    default:
      return { success: false, error: `Unknown editor module: ${module}` };
  }
}
```

**Reference:** Dispatch pattern from `electron/native-pipeline/cli-runner.ts` (lines 174-281)

---

## Subtask 1.4: Implement Media Handlers

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/editor-handlers-media.ts` (create, ~250 lines)

**Changes:**

Implement handlers for `editor:health` + all 8 `editor:media:*` commands + 5 `editor:project:*` commands.

### editor:health
```
GET /api/claude/health
```
No required flags. Returns `{ status: "ok", version, uptime }`.

### editor:media:list
```
GET /api/claude/media/:projectId
```
**Required:** `--project-id`
**Output:** Table of media files (id, name, type, size, duration)

### editor:media:info
```
GET /api/claude/media/:projectId/:mediaId
```
**Required:** `--project-id`, `--media-id`
**Output:** Full media file details

### editor:media:import
```
POST /api/claude/media/:projectId/import
Body: { source: <path> }
```
**Required:** `--project-id`, `--source`
**Validation:** Check file exists locally before sending

### editor:media:import-url
```
POST /api/claude/media/:projectId/import-from-url
Body: { url: <url>, filename?: <name> }
```
**Required:** `--project-id`, `--url`
**Optional:** `--filename`

### editor:media:batch-import
```
POST /api/claude/media/:projectId/batch-import
Body: { items: [{path: ...}, ...] }
```
**Required:** `--project-id`, `--items` (JSON array or `@file.json`)
**Limit:** Max 20 items (validate client-side)

### editor:media:extract-frame
```
POST /api/claude/media/:projectId/:mediaId/extract-frame
Body: { timestamp: <number>, format?: "png"|"jpg" }
```
**Required:** `--project-id`, `--media-id`, `--timestamp`
**Optional:** `--format` (default: png)

### editor:media:rename
```
PATCH /api/claude/media/:projectId/:mediaId/rename
Body: { newName: <name> }
```
**Required:** `--project-id`, `--media-id`, `--new-name`

### editor:media:delete
```
DELETE /api/claude/media/:projectId/:mediaId
```
**Required:** `--project-id`, `--media-id`

**Handler pattern (apply to all):**
```typescript
async function handleMediaList(
  client: EditorApiClient,
  options: CLIRunOptions
): Promise<CLIResult> {
  if (!options.projectId) {
    return { success: false, error: "Missing --project-id" };
  }

  const data = await client.get(`/api/claude/media/${options.projectId}`);
  return { success: true, data };
}
```

**Reference:** HTTP endpoints in `electron/claude/claude-media-handler.ts`, types in `.claude/skills/qcut-api/REF-MEDIA-TIMELINE.md`

---

## Subtask 1.5: Implement Project Handlers

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/editor-handlers-media.ts` (extend — same file as 1.4)

**Changes:**

Add 5 `editor:project:*` handlers to the same file since project + media are closely related and the file stays under 250 lines.

### editor:project:settings
```
GET /api/claude/project/:projectId/settings
```
**Required:** `--project-id`

### editor:project:update-settings
```
PATCH /api/claude/project/:projectId/settings
Body: { name?, width?, height?, fps?, aspectRatio?, ... }
```
**Required:** `--project-id`, `--data` (JSON settings object)

### editor:project:stats
```
GET /api/claude/project/:projectId/stats
```
**Required:** `--project-id`

### editor:project:summary
```
GET /api/claude/project/:projectId/summary
```
**Required:** `--project-id`
**Output:** Markdown summary (print raw when not `--json`)

### editor:project:report
```
POST /api/claude/project/:projectId/report
Body: { outputDir?, outputPath?, saveToDisk?, clearLog? }
```
**Required:** `--project-id`
**Optional:** `--output-dir`, `--clear-log`

**Reference:** `electron/claude/claude-project-handler.ts`, `.claude/skills/qcut-api/REF-PROJECT-EXPORT.md`

---

## Subtask 1.6: Unit Tests for Phase 1

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/__tests__/editor-api-client.test.ts` (create, ~200 lines)

**Changes:**

Test the HTTP client and media/project handlers using a mock HTTP server (Bun's built-in `Bun.serve` or Node `http.createServer`).

**Test cases:**

1. **EditorApiClient**
   - `checkHealth()` returns true when server responds with `{ success: true }`
   - `checkHealth()` returns false when ECONNREFUSED
   - `get()` unwraps response envelope and returns `data`
   - `get()` throws `EditorApiError` when `success: false`
   - `post()` sends JSON body with Content-Type header
   - Auth token included in Authorization header when configured
   - `pollJob()` polls until `status: "completed"` and returns result
   - `pollJob()` throws on `status: "failed"`
   - `pollJob()` respects AbortSignal for cancellation
   - `pollJob()` times out after configured timeout

2. **resolveJsonInput()**
   - Parses inline JSON string `'{"key":"value"}'`
   - Reads and parses `@file.json` reference
   - Reads from stdin when value is `-`
   - Throws on invalid JSON

3. **Media handlers**
   - `handleMediaList` requires `--project-id`
   - `handleMediaList` calls correct endpoint
   - `handleMediaImport` validates file exists
   - `handleMediaBatchImport` rejects >20 items

4. **Project handlers**
   - `handleProjectSettings` calls GET endpoint
   - `handleProjectUpdateSettings` sends PATCH with JSON body

**Reference:** Test patterns from existing tests in `electron/native-pipeline/__tests__/`

---

## Files Impact Summary

| File | Action | Lines |
|------|--------|-------|
| `electron/native-pipeline/editor-api-client.ts` | Create | ~180 |
| `electron/native-pipeline/editor-api-types.ts` | Create | ~120 |
| `electron/native-pipeline/cli-handlers-editor.ts` | Create | ~150 |
| `electron/native-pipeline/editor-handlers-media.ts` | Create | ~250 |
| `electron/native-pipeline/__tests__/editor-api-client.test.ts` | Create | ~200 |
| **Total** | | **~900** |
