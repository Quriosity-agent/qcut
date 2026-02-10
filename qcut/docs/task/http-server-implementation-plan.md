# HTTP Server Layer for Claude Code Control

> Implementation plan for exposing QCut's Claude API over HTTP so Claude Code can control QCut externally.

**Estimated total time:** ~45 minutes (5 subtasks)

---

## Overview

QCut's Claude integration currently works through Electron IPC only — unusable by external tools like Claude Code. This plan adds a lightweight HTTP server on `localhost:8765` that proxies REST requests to the existing IPC handlers.

```text
Claude Code  ──HTTP──>  localhost:8765  ──IPC──>  QCut Main Process  ──IPC──>  Renderer
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP library | Native `http` module | Already imported in `main.ts`, no new dependency, follows existing `createStaticServer()` pattern |
| Port | 8765 (configurable via `QCUT_API_PORT`) | Avoids conflict with existing static server (8080) and common dev ports |
| Bind address | `127.0.0.1` only | Security: prevents external network access |
| Auth | Bearer token (optional) | Simple, stateless, configurable via env var |
| Architecture | Separate handler file | Follows existing handler pattern, keeps `main.ts` minimal |

---

## Subtask 1: Create HTTP Server Handler

**Time:** ~15 min
**Files:**
- `electron/claude/claude-http-server.ts` (new)
- `electron/claude/utils/http-router.ts` (new)

### 1a. Create minimal router utility

**File:** `electron/claude/utils/http-router.ts`

A lightweight router (~60 lines) that matches `METHOD /path/:param` patterns and extracts params. No external dependency.

```typescript
// Error convention: throw HttpError for non-200 responses
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (req: ParsedRequest) => Promise<any>;
}

interface ParsedRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

// Usage:
// router.get("/api/media/:projectId", async (req) => { ... });
// router.post("/api/timeline/:projectId/import", async (req) => { ... });
// Errors: throw new HttpError(404, "Not found");
```

Features:
- Path parameter extraction (`:projectId`, `:mediaId`)
- JSON body parsing for POST/PUT/DELETE with **1MB body size limit** (returns 413 if exceeded)
- Query string parsing
- `HttpError` class for typed error responses (handlers throw `HttpError` for non-200 status codes)
- Returns `{ status, body }` or catches `HttpError` to send appropriate status

**Body size enforcement** (inside the router's body parser):

```typescript
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new HttpError(413, "Payload too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : undefined); }
      catch { reject(new HttpError(400, "Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
```

### 1b. Create HTTP server handler

**File:** `electron/claude/claude-http-server.ts`

The main server file that:
1. Creates an `http.Server` on `127.0.0.1:8765`
2. Registers routes that map to existing IPC handler logic
3. Optional bearer token auth via `QCUT_API_TOKEN` env var
4. Exports `startClaudeHTTPServer()` and `stopClaudeHTTPServer()`

> **Note:** No CORS handling needed — the only consumer is Claude Code (a CLI tool), not a browser. CORS is browser-enforced and irrelevant for non-browser HTTP clients like `curl` or Claude Code.

**Route mapping (all routes prefixed with `/api/claude`):**

| HTTP Method | Route | Maps to IPC Channel | Description |
|-------------|-------|---------------------|-------------|
| `GET` | `/api/claude/media/:projectId` | `claude:media:list` | List media files |
| `GET` | `/api/claude/media/:projectId/:mediaId` | `claude:media:info` | Get media info |
| `POST` | `/api/claude/media/:projectId/import` | `claude:media:import` | Import media |
| `DELETE` | `/api/claude/media/:projectId/:mediaId` | `claude:media:delete` | Delete media |
| `PATCH` | `/api/claude/media/:projectId/:mediaId/rename` | `claude:media:rename` | Rename media |
| `GET` | `/api/claude/timeline/:projectId` | `claude:timeline:export` | Export timeline (query: `?format=json\|md`) |
| `POST` | `/api/claude/timeline/:projectId/import` | `claude:timeline:import` | Import timeline |
| `POST` | `/api/claude/timeline/:projectId/elements` | `claude:timeline:addElement` | Add element |
| `PATCH` | `/api/claude/timeline/:projectId/elements/:elementId` | `claude:timeline:updateElement` | Update element |
| `DELETE` | `/api/claude/timeline/:projectId/elements/:elementId` | `claude:timeline:removeElement` | Remove element |
| `GET` | `/api/claude/project/:projectId/settings` | `claude:project:getSettings` | Get settings |
| `PATCH` | `/api/claude/project/:projectId/settings` | `claude:project:updateSettings` | Update settings |
| `GET` | `/api/claude/project/:projectId/stats` | `claude:project:getStats` | Get stats |
| `GET` | `/api/claude/export/presets` | `claude:export:getPresets` | List presets |
| `GET` | `/api/claude/export/:projectId/recommend/:target` | `claude:export:recommend` | Get recommendation |
| `POST` | `/api/claude/diagnostics/analyze` | `claude:diagnostics:analyze` | Analyze error |
| `GET` | `/api/claude/health` | (none) | Health check |

**Key implementation detail:** The HTTP server cannot directly call `ipcMain.handle` handlers (those are for renderer→main). Instead, the HTTP routes must call the **same underlying functions** that the IPC handlers use. This means we need to refactor the handler logic slightly — extract the core logic into reusable functions that both IPC handlers and HTTP routes can call.

**Approach:** For handlers that directly access the file system (media, project settings, export presets), the HTTP server calls the logic directly. For handlers that need renderer data (timeline export, project stats), the HTTP server sends IPC events to the renderer window and waits for the response — same pattern the IPC handlers already use.

```typescript
// Simplified structure
import * as http from "http";
import { BrowserWindow } from "electron";
import { createRouter } from "./utils/http-router";
import { claudeLog } from "./utils/logger";

let server: http.Server | null = null;

// --- Bearer token auth (optional — only enforced when QCUT_API_TOKEN is set) ---
function checkAuth(req: http.IncomingMessage): boolean {
  const token = process.env.QCUT_API_TOKEN;
  if (!token) return true; // Auth disabled
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${token}`;
}

export function startClaudeHTTPServer(
  port = parseInt(process.env.QCUT_API_PORT || "8765", 10)
): void {
  const router = createRouter();

  // Media routes
  router.get("/api/claude/media/:projectId", async (req) => {
    return listMediaFiles(req.params.projectId);
  });

  // Timeline routes (need renderer window)
  router.get("/api/claude/timeline/:projectId", async (req) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new HttpError(503, "No active window");
    const timeline = await Promise.race([
      requestTimelineFromRenderer(win),
      new Promise((_, reject) => setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)),
    ]);
    const format = req.query.format || "json";
    // ...
  });

  // Health check
  router.get("/api/claude/health", async () => ({
    status: "ok",
    version: app.getVersion(),
    uptime: process.uptime(),
  }));

  server = http.createServer((req, res) => {
    // 30s request timeout — prevents hung connections
    req.setTimeout(30_000, () => {
      res.writeHead(408, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request timeout" }));
    });

    // Auth — reject early if QCUT_API_TOKEN is set and token is missing/wrong
    if (!checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    router.handle(req, res);
  });
  server.listen(port, "127.0.0.1", () => {
    claudeLog.info("HTTP", `Server started on http://127.0.0.1:${port}`);
  });
}

export function stopClaudeHTTPServer(): void {
  server?.close();
  server = null;
}
```

---

## Subtask 2: Refactor Handler Logic into Reusable Functions

**Time:** ~10 min
**Files:**
- `electron/claude/claude-media-handler.ts` (modify)
- `electron/claude/claude-timeline-handler.ts` (modify)
- `electron/claude/claude-project-handler.ts` (modify)
- `electron/claude/claude-export-handler.ts` (modify)
- `electron/claude/claude-diagnostics-handler.ts` (modify)

Currently, the core logic lives **inside** `ipcMain.handle()` callbacks. We need to extract it into exported functions so both IPC and HTTP can call them.

**Pattern change per handler:**

```typescript
// BEFORE: Logic embedded in IPC handler
ipcMain.handle("claude:media:list", async (_event, projectId: string) => {
  // ... logic here ...
});

// AFTER: Logic extracted, IPC handler is a thin wrapper
export async function listMediaFiles(projectId: string): Promise<MediaFile[]> {
  // ... logic here (moved from ipcMain.handle callback) ...
}

export function setupClaudeMediaIPC(): void {
  ipcMain.handle("claude:media:list", async (_event, projectId: string) => {
    return listMediaFiles(projectId);
  });
}
```

**Note:** `claude-media-handler.ts` already has `listMediaFiles()` extracted — it just needs to be exported. The other handlers need similar extraction.

**Functions to extract/export per handler:**

| Handler | Functions to Export |
|---------|-------------------|
| `claude-media-handler.ts` | `listMediaFiles()` (already exists, just export), `importMediaFile()`, `deleteMediaFile()`, `renameMediaFile()`, `getMediaInfo()` |
| `claude-timeline-handler.ts` | `requestTimelineFromRenderer()` (already exists, just export), `timelineToMarkdown()`, `markdownToTimeline()`, `validateTimeline()` |
| `claude-project-handler.ts` | `getProjectSettings()`, `updateProjectSettings()`, `getProjectStats()` |
| `claude-export-handler.ts` | `getExportPresets()`, `getExportRecommendation()` (+ export `PRESETS` array) |
| `claude-diagnostics-handler.ts` | `analyzeError()` (already exists, just export), `getSystemInfo()` |

**Breaking changes:** None. IPC handlers become thin wrappers around the same logic. All existing behavior preserved.

---

## Subtask 3: Register HTTP Server in Main Process

**Time:** ~5 min
**Files:**
- `electron/claude/index.ts` (modify)
- `electron/main.ts` (modify — 2 lines)

### 3a. Update `electron/claude/index.ts`

Add HTTP server startup to the existing `setupAllClaudeIPC()` function:

```typescript
import { startClaudeHTTPServer, stopClaudeHTTPServer } from "./claude-http-server.js";

export function setupAllClaudeIPC(): void {
  // ... existing handler setup ...

  // Start HTTP server for external control (non-blocking — failure is non-fatal)
  try {
    startClaudeHTTPServer();
  } catch (error) {
    claudeLog.warn("Claude", `HTTP server failed to start: ${error}. External control disabled.`);
  }

  claudeLog.info("Claude", "All handlers registered successfully");
}

export { stopClaudeHTTPServer };
```

### 3b. Update `electron/main.ts`

Add server shutdown on app quit (near the existing `staticServer?.close()` call):

```typescript
// In the 'before-quit' or 'will-quit' handler:
const { stopClaudeHTTPServer } = require("./claude/index.js");
stopClaudeHTTPServer();
```

### 3c. Update CSP (if needed)

**File:** `electron/main.ts` (~line 416)

Add `http://127.0.0.1:8765` to `connect-src` in the Content Security Policy if the renderer needs to call the HTTP API directly. This may not be needed since the HTTP server is for external tools, not the renderer.

---

## Subtask 4: Add Unit Tests

**Time:** ~10 min
**Files:**
- `electron/claude/__tests__/http-router.test.ts` (new)
- `electron/claude/__tests__/claude-http-server.test.ts` (new)

### 4a. Router tests

**File:** `electron/claude/__tests__/http-router.test.ts`

```typescript
describe("HTTP Router", () => {
  it("matches GET routes with params", ...);
  it("matches POST routes and parses JSON body", ...);
  it("returns 404 for unknown routes", ...);
  it("extracts query parameters", ...);
  it("handles path parameters correctly", ...);
});
```

### 4b. HTTP server integration tests

**File:** `electron/claude/__tests__/claude-http-server.test.ts`

```typescript
describe("Claude HTTP Server", () => {
  // Mock ipcMain and BrowserWindow
  it("GET /api/claude/health returns status ok", ...);
  it("GET /api/claude/media/:projectId returns media list", ...);
  it("POST /api/claude/media/:projectId/import validates source path", ...);
  it("GET /api/claude/export/presets returns preset list", ...);
  it("rejects requests without auth token when QCUT_API_TOKEN is set", ...);
  it("accepts requests with valid auth token", ...);
  it("returns 503 when no renderer window available", ...);
  it("binds to 127.0.0.1 only", ...);
});
```

### 4c. Refactored handler tests

**File:** `electron/claude/__tests__/handler-functions.test.ts` (new)

Test the extracted functions directly (without IPC):

```typescript
describe("Extracted Handler Functions", () => {
  describe("Media", () => {
    it("listMediaFiles returns empty for nonexistent project", ...);
    it("importMediaFile rejects invalid paths", ...);
  });
  describe("Export", () => {
    it("getExportPresets returns all presets", ...);
    it("getExportRecommendation returns platform-specific tips", ...);
  });
  // ...
});
```

---

## Subtask 5: Documentation

**Time:** ~5 min
**Files:**
- `docs/task/claude-api-usage-guide.md` (modify — add HTTP section)
- `CLAUDE.md` (modify — add HTTP server info)

### 5a. Update API usage guide

Add a new section to `docs/task/claude-api-usage-guide.md`:

```markdown
## HTTP API (External Control)

QCut exposes a REST API on `http://127.0.0.1:8765` for external tools like Claude Code.

### Authentication (Optional)
Set `QCUT_API_TOKEN=your-secret` env var. If set, all requests require:
```text
Authorization: Bearer your-secret
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
```

### 5b. Update CLAUDE.md

Add HTTP server reference to the Key Entry Points table:

```markdown
| Claude HTTP API | `electron/claude/claude-http-server.ts` |
```

---

## File Summary

| File | Action | Subtask |
|------|--------|---------|
| `electron/claude/utils/http-router.ts` | New | 1 |
| `electron/claude/claude-http-server.ts` | New | 1 |
| `electron/claude/claude-media-handler.ts` | Modify (export functions) | 2 |
| `electron/claude/claude-timeline-handler.ts` | Modify (export functions) | 2 |
| `electron/claude/claude-project-handler.ts` | Modify (export functions) | 2 |
| `electron/claude/claude-export-handler.ts` | Modify (export functions) | 2 |
| `electron/claude/claude-diagnostics-handler.ts` | Modify (export functions) | 2 |
| `electron/claude/index.ts` | Modify (start/stop server) | 3 |
| `electron/main.ts` | Modify (shutdown hook, ~2 lines) | 3 |
| `electron/claude/__tests__/http-router.test.ts` | New | 4 |
| `electron/claude/__tests__/claude-http-server.test.ts` | New | 4 |
| `electron/claude/__tests__/handler-functions.test.ts` | New | 4 |
| `docs/task/claude-api-usage-guide.md` | Modify (add HTTP section) | 5 |
| `CLAUDE.md` | Modify (add entry point) | 5 |

**New files:** 5 | **Modified files:** 9 | **Total:** 14

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Network exposure | Bind to `127.0.0.1` only — no external access |
| Unauthorized access | Optional bearer token via `QCUT_API_TOKEN` env var |
| Path traversal | Reuses existing `isValidSourcePath()` and `sanitizeFilename()` |
| Port conflict | Configurable port via `QCUT_API_PORT` env var (default 8765) |
| Denial of service | Request body size limit (1MB), request timeout (30s) |

---

## Implementation Order

```text
Subtask 2 (extract functions)  ──>  Subtask 1 (HTTP server + router)  ──>  Subtask 3 (register)
                                                                              |
                                                                              v
                                                                      Subtask 4 (tests)
                                                                              |
                                                                              v
                                                                      Subtask 5 (docs)
```

Start with Subtask 2 because it's the foundation — the HTTP server needs the extracted functions to call.

---

*Created: 2026-02-10*
