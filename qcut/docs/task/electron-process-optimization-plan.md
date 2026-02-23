# Electron Main Process Optimization Plan

> **Branch:** win-9  
> **Date:** 2026-02-23  
> **Goal:** Move heavy operations out of Electron's main process to prevent UI freezes

## Executive Summary

After analyzing the codebase, the situation is better than expected:

| Component | Current State | Action Needed |
|-----------|--------------|---------------|
| FFmpeg Export | ✅ Already uses `child_process.spawn()` | None (already offloaded) |
| AI Pipeline | ✅ Already uses `child_process.spawn()` | None (already offloaded) |
| Claude HTTP Server | ⚠️ Runs in main process | Move to `utilityProcess` |
| PTY Handler | ⚠️ Runs in main process (node-pty) | Move to `utilityProcess` |

**Only the Claude HTTP server and PTY handler need migration.** FFmpeg and AI Pipeline are already properly architected.

---

## 1. FFmpeg Export — ✅ Already Done

### Current Architecture

**File:** `electron/ffmpeg-export-handler.ts`

FFmpeg operations already run in child processes via `spawn()`:

```typescript
// Line ~200 in ffmpeg-export-handler.ts
const ffmpegProc: ChildProcess = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
});
```

All three export modes (Mode 1 direct copy, Mode 1.5 normalization, Mode 2 filter-based) use the same pattern. The helper `runFFmpegCommand()` also uses `spawn()`. Video probing uses `spawn()` via `probeVideoFile()`.

### What Runs in Main Process

- **IPC handler registration** (`ipcMain.handle("export-video-cli", ...)`) — lightweight, must stay
- **Argument construction** (`buildFFmpegArgs()`) — CPU-trivial string building
- **File existence checks** (`fs.existsSync()`) — fast syscalls
- **Progress parsing** (`parseProgress()`) — simple regex on stderr chunks

### Verdict

**No action needed.** The heavy work (video encoding/decoding) runs in FFmpeg child processes. The main process only orchestrates and parses progress, which is negligible overhead.

---

## 2. AI Pipeline — ✅ Already Done

### Current Architecture

**File:** `electron/ai-pipeline-handler.ts`

The `AIPipelineManager.execute()` method spawns the `aicp` binary as a child process:

```typescript
// In execute() method
const proc = spawn(cmd, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnEnv,
});
```

### What Runs in Main Process

- **Environment detection** (`detectEnvironment()`) — one-time async check at startup
- **API key decryption** (`getDecryptedApiKeys()`) — uses Electron's `safeStorage`, must stay in main
- **Output path extraction** — lightweight string/JSON parsing
- **Auto-import** (`importMediaFile()`) — file copy operations

### Electron API Dependencies

- `app.getPath("temp")` — for output directories
- `app.getVersion()` — for compatibility checks  
- `app.isPackaged` — for binary resolution

These are all main-process-only APIs, but they're only called during setup, not during heavy computation.

### Verdict

**No action needed.** All AI generation (image/video/avatar) runs in the external `aicp` binary process. The main process only manages lifecycle and parses results.

---

## 3. Claude HTTP Server — ⚠️ Needs Migration

### Current Architecture

**File:** `electron/claude/http/claude-http-server.ts`

A Node.js HTTP server (`http.createServer()`) running on `127.0.0.1:8765` in the main process. It handles ~30+ REST endpoints for media, timeline, project, export, analysis, and generation operations.

### What Actually Blocks

1. **HTTP request parsing** — Node's `http` module is async, minimal overhead
2. **File system operations** in media handlers — `fs.readdir`, `fs.stat`, `fs.copyFile` — async but can block on large directories
3. **JSON serialization** of large timelines — could block if timeline has thousands of elements
4. **Route matching** — negligible

### Electron API Dependencies (Critical)

The HTTP server uses these main-process-only APIs:

| API | Usage | Can Move? |
|-----|-------|-----------|
| `BrowserWindow.getAllWindows()` | Get renderer for IPC | ❌ Must proxy |
| `win.webContents.send()` | Send data to renderer | ❌ Must proxy |
| `app.getVersion()` | Health check | ✅ Pass at init |

### Migration Plan

Move the HTTP server to an Electron `utilityProcess`. The utility process communicates with the main process via `MessagePort`.

#### Step 1: Create the utility process entry point

**New file:** `electron/claude/http/claude-http-utility.ts`

```typescript
// Runs in utilityProcess — no access to BrowserWindow/app
import { createServer } from "node:http";

// Receive MessagePort from main process
process.parentPort.on("message", (e) => {
    const { type, port, config } = e.data;
    
    if (type === "init") {
        // Store port for communicating with main process
        setupServer(port, config);
    }
});

function setupServer(mainPort: MessagePort, config: { port: number; version: string }) {
    // For routes that need BrowserWindow, send request to main via MessagePort
    // and await response
    async function requestFromMain(channel: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const handler = (e: MessageEvent) => {
                if (e.data.id === id) {
                    mainPort.removeEventListener("message", handler);
                    if (e.data.error) reject(new Error(e.data.error));
                    else resolve(e.data.result);
                }
            };
            mainPort.addEventListener("message", handler);
            mainPort.postMessage({ id, channel, data });
        });
    }
    
    // Routes that only do file I/O can run directly
    // Routes that need renderer go through requestFromMain()
    const server = createServer(/* ... */);
    server.listen(config.port, "127.0.0.1");
}
```

#### Step 2: Launch from main process

**Modified:** `electron/claude/http/claude-http-server.ts`

```typescript
import { utilityProcess, MessageChannelMain, BrowserWindow } from "electron";

export function startClaudeHTTPServer(port = 8765): void {
    const { port1, port2 } = new MessageChannelMain();
    
    const child = utilityProcess.fork(
        path.join(__dirname, "claude-http-utility.js")
    );
    
    // Send init message with MessagePort
    child.postMessage(
        { type: "init", config: { port, version: app.getVersion() } },
        [port2]  // Transfer port2 to utility process
    );
    
    // Handle requests from utility process that need main-process APIs
    port1.on("message", async (e) => {
        const { id, channel, data } = e.data;
        try {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) throw new Error("No active window");
            
            // Forward to renderer and get response
            const result = await handleRendererRequest(win, channel, data);
            port1.postMessage({ id, result });
        } catch (err) {
            port1.postMessage({ id, error: err.message });
        }
    });
    
    // Crash recovery
    child.on("exit", (code) => {
        if (code !== 0) {
            console.error(`[Claude HTTP] Utility process crashed (code ${code}), restarting...`);
            setTimeout(() => startClaudeHTTPServer(port), 1000);
        }
    });
}
```

#### Step 3: Identify which routes need main process

**Can run entirely in utility process (file I/O only):**
- `GET /api/claude/media/:projectId` — `listMediaFiles()` reads filesystem
- `GET /api/claude/media/:projectId/:mediaId` — `getMediaInfo()` reads filesystem
- `POST /api/claude/media/:projectId/import` — file copy (but sends notification to renderer)
- `DELETE /api/claude/media/:projectId/:mediaId` — file delete
- `GET /api/claude/project/:projectId/settings` — reads JSON file
- `PATCH /api/claude/project/:projectId/settings` — writes JSON file
- `GET /api/claude/health` — trivial
- `POST /api/claude/diagnostics/analyze` — pure computation

**Must proxy to main process (needs BrowserWindow/renderer):**
- `GET /api/claude/timeline/:projectId` — calls `requestTimelineFromRenderer(win)`
- `POST /api/claude/timeline/:projectId/import` — sends `win.webContents.send()`
- All timeline element CRUD — sends IPC to renderer
- `GET /api/claude/project/:projectId/stats` — needs renderer
- `POST /api/claude/export/:projectId/start` — needs timeline from renderer

### Effort & Risk

- **Effort:** ~3-4 days
- **Risk:** Medium
  - MessagePort serialization adds latency to renderer-dependent routes (~1-5ms)
  - Must handle utility process crashes gracefully
  - `node-pty` integration from utility process needs testing
- **Testing:** All existing HTTP tests should pass with minimal changes (they test handler functions directly)

---

## 4. PTY Handler — ⚠️ Needs Migration

### Current Architecture

**File:** `electron/pty-handler.ts`

Uses `node-pty` to spawn pseudo-terminal sessions in the main process. Each terminal session (Claude Code, Gemini CLI, etc.) is managed via IPC handlers.

### What Actually Blocks

1. **`node-pty` native module loading** — one-time at startup, can block briefly
2. **`pty.spawn()`** — spawns OS-level PTY, the child process runs independently
3. **Data forwarding** (`ptyProcess.onData()`) — callbacks in main process event loop
4. **Session management** — Map lookups, negligible

### Electron API Dependencies

| API | Usage | Can Move? |
|-----|-------|-----------|
| `ipcMain.handle()` | Register handlers | ❌ Must proxy or keep thin wrapper |
| `event.sender.send()` | Forward PTY output to renderer | ❌ Must proxy |
| `event.sender.id` | Track which renderer owns session | ❌ Must proxy |
| `event.sender.isDestroyed()` | Check renderer alive | ❌ Must proxy |
| `app.on("web-contents-created")` | Cleanup on renderer destroy | ❌ Must stay in main |

### Migration Plan

Move PTY session management to a utility process. The main process keeps thin IPC wrappers that forward to the utility.

#### Architecture After Migration

```
Renderer  ──IPC──>  Main Process (thin proxy)  ──MessagePort──>  Utility Process
                                                                   └── node-pty sessions
                                                                   └── Claude HTTP server
```

**Key insight:** PTY and HTTP server can share the same utility process since they're both I/O-bound, not CPU-bound.

#### Step 1: Create combined utility process

**New file:** `electron/utility/claude-utility.ts`

```typescript
// Combined utility process for PTY + HTTP server
import * as pty from "node-pty";

const sessions = new Map<string, pty.IPty>();

process.parentPort.on("message", (e) => {
    const { type, ...data } = e.data;
    
    switch (type) {
        case "pty:spawn": {
            const { sessionId, shell, args, cols, rows, cwd, env } = data;
            const proc = pty.spawn(shell, args, {
                name: "xterm-256color",
                cols, rows, cwd, env,
            });
            sessions.set(sessionId, proc);
            
            proc.onData((output) => {
                process.parentPort.postMessage({
                    type: "pty:data", sessionId, data: output
                });
            });
            
            proc.onExit(({ exitCode, signal }) => {
                process.parentPort.postMessage({
                    type: "pty:exit", sessionId, exitCode, signal
                });
                sessions.delete(sessionId);
            });
            
            process.parentPort.postMessage({
                type: "pty:spawned", sessionId, success: true
            });
            break;
        }
        
        case "pty:write": {
            const session = sessions.get(data.sessionId);
            session?.write(data.input);
            break;
        }
        
        case "pty:resize": {
            const session = sessions.get(data.sessionId);
            session?.resize(data.cols, data.rows);
            break;
        }
        
        case "pty:kill": {
            const session = sessions.get(data.sessionId);
            session?.kill();
            sessions.delete(data.sessionId);
            break;
        }
    }
});
```

#### Step 2: Thin proxy in main process

```typescript
// electron/pty-handler.ts (simplified)
import { utilityProcess, ipcMain } from "electron";

let utility: Electron.UtilityProcess;

export function setupPtyIPC(): void {
    utility = utilityProcess.fork(
        path.join(__dirname, "utility", "claude-utility.js")
    );
    
    // Forward PTY data from utility to correct renderer
    utility.on("message", (msg) => {
        if (msg.type === "pty:data" || msg.type === "pty:exit") {
            const webContents = sessionToWebContents.get(msg.sessionId);
            if (webContents && !webContents.isDestroyed()) {
                webContents.send(msg.type, msg);
            }
        }
    });
    
    ipcMain.handle("pty:spawn", async (event, options) => {
        const sessionId = generateSessionId();
        sessionToWebContents.set(sessionId, event.sender);
        utility.postMessage({ type: "pty:spawn", sessionId, ...resolveShell(options) });
        // Wait for spawned confirmation
        return waitForMessage(utility, "pty:spawned", sessionId);
    });
    
    // ... similar thin wrappers for write/resize/kill
}
```

### Will Moving PTY to Utility Process Affect Claude Code Sub-Agents?

**No.** When Claude Code runs in a PTY, it spawns its own child processes (sub-agents) via the operating system's process tree. The PTY is just a terminal emulator — moving it from the main process to a utility process doesn't change how the child process tree works. Claude Code's sub-agents are grandchildren of whichever process hosts the PTY, and they run independently regardless.

### Effort & Risk

- **Effort:** ~2-3 days  
- **Risk:** Medium-High
  - `node-pty` native module must load in utility process context (may need rebuild)
  - Session-to-renderer mapping becomes indirect
  - Crash recovery must re-establish all active PTY sessions (or notify users)
  - MCP server path resolution uses `app.getAppPath()` — must pass from main

---

## 5. Combined Migration Strategy

### Recommended: Single Utility Process

Combine PTY and HTTP server into one utility process to minimize overhead:

```
Main Process (lightweight)
├── Window management, menus, dialog
├── IPC routing (thin proxy)
├── FFmpeg spawn orchestration (already child_process)
└── AI Pipeline spawn orchestration (already child_process)

Utility Process (heavy I/O)
├── Claude HTTP Server (port 8765)
├── PTY Session Manager (node-pty)
└── File-based route handlers
```

### Implementation Order

1. **Phase 1:** Move HTTP server to utility process (lower risk, fewer Electron API deps)
2. **Phase 2:** Move PTY to same utility process (higher risk due to node-pty native module)
3. **Phase 3:** Test crash recovery and session restoration

### IPC Pattern Changes

**Before (current):**
```
Renderer ──ipcRenderer.invoke──> Main Process ──handler──> Result
```

**After:**
```
Renderer ──ipcRenderer.invoke──> Main Process ──MessagePort──> Utility Process
                                      ↑                              │
                                      └──────MessagePort─────────────┘
```

### Crash Recovery Strategy

```typescript
// In main process
utility.on("exit", (code) => {
    if (code !== 0) {
        console.error(`Utility process crashed with code ${code}`);
        
        // Notify all renderers that PTY sessions are gone
        for (const [sessionId, webContents] of sessionToWebContents) {
            if (!webContents.isDestroyed()) {
                webContents.send("pty:exit", { 
                    sessionId, exitCode: -1, signal: "CRASHED" 
                });
            }
        }
        sessionToWebContents.clear();
        
        // Restart utility process
        setTimeout(() => {
            utility = utilityProcess.fork(utilityPath);
            // HTTP server will restart automatically
            // PTY sessions are lost — user must reconnect
        }, 1000);
    }
});
```

---

## 6. Effort Summary

| Task | Effort | Risk | Priority |
|------|--------|------|----------|
| FFmpeg Export | None | N/A | ✅ Done |
| AI Pipeline | None | N/A | ✅ Done |
| Claude HTTP → utility | 3-4 days | Medium | P1 |
| PTY → utility | 2-3 days | Medium-High | P2 |
| Crash recovery | 1 day | Low | P2 |
| Integration testing | 2 days | Low | P2 |
| **Total** | **~8-10 days** | | |

### Dependencies

- Electron ≥ 22 (for `utilityProcess` API)
- `node-pty` must be compatible with utility process context
- MessagePort/MessageChannelMain for bidirectional communication
- All existing IPC tests must pass after migration

### What Stays in Main Process

These **must** remain in main process due to Electron API requirements:
- `BrowserWindow` creation and management
- `dialog.showOpenDialog()` / `dialog.showSaveDialog()`
- `ipcMain.handle()` registration (thin proxies)
- `app` lifecycle events
- `protocol` handlers
- `safeStorage` for API key encryption
- Menu and tray management
- Auto-updater
