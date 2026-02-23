# Architecture Review v2

**Date:** 2026-02-24  
**Branch:** win-9  
**Reviewer:** Automated (Claude)

---

## 1. System Design & Component Boundaries

### Structure Overview
- `electron/main.ts` (~530 lines) — app lifecycle, window creation, protocol handling, IPC registration orchestration
- `electron/main-ipc.ts` (~550 lines) — inline IPC handlers (audio/video temp, FAL uploads, file dialogs, storage, updates)
- `electron/` has ~40+ handler files, many in the 10-25KB range
- `apps/web/` — React frontend with Zustand stores
- `packages/` — auth, db, video-agent-skill (shared packages)

### Findings

**✅ Good: Handler separation pattern**  
Each domain (ffmpeg, sound, theme, api-keys, gemini, claude, etc.) has its own handler file. Main.ts orchestrates registration with try/catch per handler — one failure doesn't cascade.

**✅ Good: Utility process isolation**  
PTY and HTTP server run in a utility process via `utility-bridge.ts`. This keeps the main process responsive. The bridge includes crash recovery, session persistence, heartbeat monitoring, and a message queue for offline periods — well-engineered.

**🟠 Medium: `main-ipc.ts` is a grab-bag**  
This file handles audio temp saves, video temp saves, shell ops, GitHub stars, FAL uploads (video/image/audio), file dialogs, file I/O (read/write/save-blob/file-exists/validate-audio/get-file-info), storage CRUD, FFmpeg resource paths, updates, and release notes — all in one function. These are unrelated concerns sharing a file.

> **Fix:** Split into `file-io-handler.ts`, `fal-upload-handler.ts`, `storage-handler.ts`, `update-handler.ts`. The FAL upload code is already well-factored with `falUpload()` shared helper — easy to extract.

**🟡 Low: Mixed import styles in main.ts**  
Top-level uses ES `import` for some modules and `require()` for handler registrations. This is likely a build artifact (compiled TS handlers), but mixing styles reduces readability.

**🟡 Low: `createStaticServer` duplicated path logic**  
Both the `ffmpeg/` branch and else branch resolve to the same path (`path.join(__dirname, "../../apps/web/dist", filePath)`). Dead conditional.

---

## 2. Dependency Graph & Coupling

### Store Cross-Imports
Checked the top stores for cross-imports:
- `project-store.ts` imports from `media/media-store-loader` (lazy load pattern) ✅
- `folder-store.ts` imports types from `media-store-types` (type-only) ✅
- `export-store.ts`, `captions-store.ts`, `stickers-overlay-store.ts` — no store cross-imports found ✅
- Commented-out cross-imports in project-store (`// import { useTimelineStore }`, `// import { useStickersOverlayStore }`) suggest these were intentionally removed ✅

### Electron Handler Coupling
- `utility-bridge.ts` imports from `claude-timeline-handler.ts` and `claude-project-handler.ts` — needed for proxying main-process requests from utility process. Acceptable coupling.
- Claude handlers are organized under `electron/claude/handlers/` with shared utils in `electron/claude/utils/`. Clean.

### Findings

**✅ Good: Store isolation**  
Stores don't import each other directly. Cross-store communication appears to go through React component mediation or lazy loaders — good Zustand practice.

**✅ Good: Claude handler organization**  
17 handler files + HTTP routes + shared utils, all under `electron/claude/`. Well-bounded module.

**🟡 Low: No automated circular dependency check**  
No `madge` or similar tool in CI. With 980+ source files and growing, circular dependencies could sneak in undetected.

> **Fix:** Add `bunx madge --circular --extensions ts,tsx apps/web/src` to CI.

---

## 3. Data Flow & Bottlenecks

### IPC Pattern
UI → `ipcRenderer.invoke()` → `ipcMain.handle()` → handler → external service → response back.

For utility process operations:  
UI → `ipcMain.handle()` → `sendToUtility()` → utility process → (HTTP server / PTY) → results back via `postMessage` → forwarded to renderer via `webContents.send()`.

### Findings

**✅ Good: Async everywhere in IPC**  
All `ipcMain.handle()` callbacks are async. No synchronous file reads blocking the main process in IPC handlers (they use `fs.promises`).

**✅ Good: Utility process message queue**  
`sendToUtility()` queues messages when utility is down and flushes on reconnect. Prevents message loss during crash recovery.

**🟠 Medium: `spawnSync` in main process**  
`electron/main.ts:508` uses `spawnSync` for CLI key commands, and `electron/ffmpeg/paths.ts:93` uses `spawnSync` to check FFmpeg version. The CLI case runs before window creation (acceptable). The FFmpeg path check runs at initialization — if FFmpeg is slow to respond, this blocks the main process.

> **Fix:** Make FFmpeg version check async with `spawn` + timeout, or move to utility process.

**🟡 Low: Static server on port 8080**  
A separate HTTP server serves FFmpeg WASM files on port 8080 with `Access-Control-Allow-Origin: *`. This is needed for COOP/COEP headers but introduces a fixed port dependency. Port conflicts aren't handled (no fallback).

> **Fix:** Add port-in-use detection with fallback, similar to how the Claude HTTP server handles `EADDRINUSE`.

---

## 4. Scaling & Single Points of Failure

### Utility Process Crash Recovery

**✅ Good: Comprehensive crash handling**  
- Heartbeat system (30s interval, 5s timeout) detects hung utility process
- Auto-restart on non-zero exit code with 1s delay
- Session registry persists PTY metadata across crashes
- `respawnSessions()` re-creates PTY sessions after recovery
- Dead webContents are detected and skipped during re-spawn
- Pending spawn promises are resolved with failure on crash
- Message queue buffers messages during downtime

This is well-engineered. ✅

### FFmpeg Binary Missing

**🟠 Medium: No graceful degradation path documented**  
`initFFmpegHealthCheck()` is called on startup, but if FFmpeg binary is missing, it's unclear what UX the user sees. The `validate-audio-file` handler returns `{ valid: false, error: "ffprobe spawn error" }` but the user-facing error message may be cryptic.

> **Fix:** Add explicit FFmpeg-not-found detection with a user-friendly setup dialog.

### Error Boundaries

**✅ Good: Well-implemented ErrorBoundary**  
- Class-based React error boundary with `isolate` prop for component-level vs page-level errors
- Custom fallback support, error IDs for tracking, clipboard copy of error details
- `useErrorHandler` hook, `withErrorBoundary` HOC, `handleAsyncError` utility
- Integrates with centralized `handleError` from `@/lib/debug/error-handler`
- Toast notifications with error ID and copy action

This is thorough. ✅

---

## 5. Security

### API Key Handling

**✅ Good: Three-tier key resolution**  
1. Environment variables (highest priority)
2. Electron `safeStorage` (encrypted at rest via OS keychain)
3. AICP CLI credential store (fallback)

Keys are encrypted with `safeStorage.encryptString()` and stored as base64 in `api-keys.json`. File permissions set to `0o600`. Sync to AICP credential store also uses `0o600`.

**🔴 Critical: DRY violation in encryption — but also a security concern**  
The `api-keys:set` handler has 6 identical encrypt-or-empty blocks:
```ts
if (falApiKey) {
    const encryptedFal = safeStorage.encryptString(falApiKey);
    dataToStore.falApiKey = encryptedFal.toString("base64");
} else {
    dataToStore.falApiKey = "";
}
// ... repeated 5 more times
```
This is 60+ lines that should be a 5-line loop:
```ts
for (const [field, value] of Object.entries(keys)) {
    dataToStore[field] = value && encryptionAvailable
        ? safeStorage.encryptString(value).toString("base64")
        : value || "";
}
```
Beyond DRY, repetitive code increases the risk of handling one key differently by accident.

### Claude HTTP Server Auth

**🟠 Medium: Auth is optional by default**  
`checkAuth()` returns `true` when `QCUT_API_TOKEN` is not set. The server binds to `127.0.0.1` (localhost only), which mitigates remote attacks, but any local process can control QCut.

> **Fix:** Generate a random token on startup and pass it to authorized clients (e.g., write to a well-known file). This prevents drive-by localhost attacks from malicious web pages or other local apps.

### Input Sanitization

**✅ Good: Path traversal protection**  
The `app://` protocol handler checks for `..` in paths and validates resolved paths stay within `basePath`. The `storage:save/load/remove` handlers use `path.basename(key)` to strip directory traversal.

**🟠 Medium: `read-file` and `write-file` have no path restrictions**  
```ts
ipcMain.handle("read-file", async (_, filePath) => fs.promises.readFile(filePath));
ipcMain.handle("write-file", async (_, filePath, data) => fs.promises.writeFile(filePath, data));
```
Any renderer code can read/write arbitrary files on disk. If a third-party dependency or XSS achieves renderer code execution, it has full filesystem access.

> **Fix:** Restrict to known safe directories (project folder, temp folder, userData) or add a path allowlist.

### Secrets in Codebase

**✅ Good: No hardcoded secrets found**  
Searched for `sk-ant`, `sk-or`, `AIza`, `ghp_`, `ghu_` patterns. Only found:
- Placeholder text in UI (`placeholder="Enter your Gemini API key (AIza...)"`)
- Test fixtures with obvious fake keys (`sk-or-test-key`)
- Runtime detection logic (`apiKey.startsWith("sk-or-")`)

No real secrets committed. ✅

---

## Summary

| Area | Rating | Key Issues |
|------|--------|-----------|
| System Design | ✅/🟠 | Good handler separation; `main-ipc.ts` is a grab-bag |
| Dependency Graph | ✅ | Clean store isolation, no circular deps detected |
| Data Flow | ✅/🟠 | Async throughout; `spawnSync` in FFmpeg path check |
| Scaling & SPOF | ✅ | Excellent utility process crash recovery |
| Security | 🟠 | Unrestricted `read-file`/`write-file`; optional HTTP auth; DRY violation in encryption |

### Top Priority Fixes

1. **🔴 Restrict `read-file`/`write-file` IPC to safe directories** — prevents filesystem escape from renderer
2. **🟠 Generate auto-token for Claude HTTP server** — prevent local drive-by attacks
3. **🟠 DRY the API key encryption loop** — 60 lines → 5 lines, reduces bug surface
4. **🟠 Make FFmpeg version check async** — avoid blocking main process
5. **🟡 Split `main-ipc.ts`** — improve maintainability

### Test Coverage Note
1,320 test files found across the codebase for ~980 source files — strong test-to-source ratio. ✅
