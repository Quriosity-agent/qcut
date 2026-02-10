# Subtask 5: Split `electron/main.ts` (1601 → ~600 + ~1001)

**Parent Plan:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md)
**Estimated Effort:** 25-35 minutes
**Risk Level:** Medium — IPC channel names must stay stable

---

## Goal

Extract inline IPC handlers from `main.ts` into `main-ipc.ts`. Keep app lifecycle, window creation, protocol setup, and handler registration orchestration in `main.ts`.

---

## Files Involved

| File | Action |
|------|--------|
| `electron/main.ts` | Edit — keep lifecycle + orchestration |
| `electron/main-ipc.ts` | **Create** — inline IPC handler registration |
| `electron/__tests__/release-notes-handler.test.ts` | Verify passes unchanged |
| `electron/__tests__/ai-video-migration.test.ts` | Verify passes unchanged |

---

## What Moves to `main-ipc.ts` (~1001 lines)

All inline `ipcMain.handle(...)` calls currently inside `app.whenReady()`:

### Audio & Video Handlers (Lines 606-665)

| Channel | Lines | Description |
|---------|-------|-------------|
| `audio:save-temp` | 606-623 | Save audio to temp dir |
| `save-audio-for-export` | 625-641 | Audio export |
| `video:save-temp` | 647-665 | Save video to temp dir |

### Shell & GitHub (Lines 668-712)

| Channel | Lines | Description |
|---------|-------|-------------|
| `shell:showItemInFolder` | 668-673 | Open in file explorer |
| `fetch-github-stars` | 675-712 | CORS bypass for GitHub API |

### FAL Upload Handlers (Lines 714-1035)

| Channel | Lines | Description |
|---------|-------|-------------|
| `fal:upload-video` | 714-816 | 2-step signed URL video upload |
| `fal:upload-image` | 818-912 | 2-step signed URL image upload |
| `fal:upload-audio` | 914-1010 | 2-step signed URL audio upload |
| `fal:queue-fetch` | 1012-1035 | Queue polling CORS bypass |

### File Dialog Handlers (Lines 1037-1130)

| Channel | Lines | Description |
|---------|-------|-------------|
| `open-file-dialog` | 1037-1074 | Video/audio/image picker |
| `open-multiple-files-dialog` | 1076-1106 | Multi-file picker |
| `save-file-dialog` | 1108-1130 | Save dialog |

### File I/O Handlers (Lines 1132-1340)

| Channel | Lines | Description |
|---------|-------|-------------|
| `read-file` | 1132-1145 | Read file to buffer |
| `write-file` | 1147-1162 | Write buffer to file |
| `save-blob` | 1164-1203 | ZIP save dialog |
| `file-exists` | 1205-1215 | File existence check |
| `validate-audio-file` | 1217-1317 | FFprobe audio validation (100 lines) |
| `get-file-info` | 1319-1340 | File metadata |

### Storage Handlers (Lines 1342-1424)

| Channel | Lines | Description |
|---------|-------|-------------|
| `storage:save` | 1342-1362 | Save to JSON file |
| `storage:load` | 1364-1387 | Load from JSON file |
| `storage:remove` | 1389-1400 | Delete JSON file |
| `storage:list` | 1402-1413 | List storage files |
| `storage:clear` | 1415-1424 | Clear all storage |

### FFmpeg Resource Handlers (Lines 1426-1473)

| Channel | Lines | Description |
|---------|-------|-------------|
| `get-ffmpeg-resource-path` | 1426-1449 | Resolve FFmpeg binary path |
| `check-ffmpeg-resource` | 1451-1473 | Check FFmpeg file exists |

### Update Handlers (Lines 1475-1566)

| Channel | Lines | Description |
|---------|-------|-------------|
| `check-for-updates` | 1475-1503 | Manual update check |
| `install-update` | 1505-1524 | Install update |
| `get-release-notes` | 1526-1549 | Fetch single release note |
| `get-changelog` | 1551-1566 | Fetch full changelog |

---

## What Stays in `main.ts` (~600 lines)

| Section | Lines (current) | Description |
|---------|-----------------|-------------|
| Imports & types | 1-121 | Module imports, type defs, logger |
| Global state | 124-128 | `mainWindow`, `staticServer` |
| Protocol registration | 130-144 | `app:// protocol` |
| Utility functions | 146-387 | `detectChannelFromVersion`, `normalizeAutoUpdaterReleaseNotes`, `getReleasesDir`, `readChangelogFallback`, `setupAutoUpdater`, `createStaticServer` |
| Window creation | 389-461 | `createWindow()` |
| `app.whenReady()` | 463-604 | Protocol handler, static server, handler orchestration, **call to `registerMainIpcHandlers()`** |
| App lifecycle | 1569-1600 | `window-all-closed`, `activate`, type exports |

---

## Implementation Steps

### Step 1: Create `main-ipc.ts` with registration function

```typescript
// electron/main-ipc.ts

import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
// ... other needed imports

interface MainIpcDeps {
  mainWindow: BrowserWindow | null;
  app: Electron.App;
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void };
  autoUpdater: any;
  getReleasesDir: () => string;
  readChangelogFallback: () => any[];
}

export function registerMainIpcHandlers(deps: MainIpcDeps): void {
  const { mainWindow, app: electronApp, logger, autoUpdater, getReleasesDir, readChangelogFallback } = deps;

  // Audio handlers
  ipcMain.handle('audio:save-temp', async (_, audioData, filename) => { ... });

  // Video handlers
  ipcMain.handle('video:save-temp', async (_, videoData, filename) => { ... });

  // ... all other handlers
}
```

### Step 2: Move handler implementations

Move each `ipcMain.handle(...)` block from `main.ts` into `registerMainIpcHandlers`. Keep exact channel names.

### Step 3: Wire into `main.ts`

In `app.whenReady()`, after window creation and handler orchestration:

```typescript
import { registerMainIpcHandlers } from './main-ipc';

// After existing handler registrations (FFmpegIPC, SoundIPC, etc.)
registerMainIpcHandlers({
  mainWindow,
  app,
  logger,
  autoUpdater,
  getReleasesDir,
  readChangelogFallback,
});
```

### Step 4: Identify shared dependencies

Functions needed by `main-ipc.ts` that currently live in `main.ts`:
- `getReleasesDir()` — pass via deps
- `readChangelogFallback()` — pass via deps
- `logger` — pass via deps
- `autoUpdater` — pass via deps
- `mainWindow` — pass via deps

### Step 5: Handle `app.getPath()` and `app.isPackaged` calls

These are used inside handlers for path resolution. Pass `app` via deps or pass specific paths.

---

## Verification

```bash
# Type check
bun run check-types

# Existing tests (these test external handlers, not inline ones)
bun x vitest run electron/__tests__/release-notes-handler.test.ts
bun x vitest run electron/__tests__/ai-video-migration.test.ts

# Lint
bun lint:clean

# Critical: Full smoke test — every IPC channel must work
bun run electron:dev
# Test: file dialogs, save/load, FAL uploads, updates check, storage
```

---

## Unit Tests to Add

Create `electron/__tests__/main-ipc.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `registerMainIpcHandlers registers all expected channels` | Channel registration |
| `audio:save-temp writes file to temp directory` | Audio handler |
| `storage:save creates JSON file` | Storage handler |
| `storage:load reads JSON file` | Storage handler |
| `fal:upload-video calls signed URL endpoint` | FAL upload flow |
| `get-ffmpeg-resource-path resolves correct path` | FFmpeg path |
| `validate-audio-file uses ffprobe` | Audio validation |

> **Note:** Mock `ipcMain.handle`, `dialog`, `fs`, `path` for unit testing.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| IPC channel name typo breaks bridge silently | Keep exact strings; grep for channel names before/after |
| `mainWindow` reference stale in handler | Pass getter `() => mainWindow` or use deps.mainWindow |
| FAL upload handlers use `app.getPath('temp')` | Pass `app` in deps; handlers call `app.getPath()` themselves |
| Storage path resolution uses `app.getPath('userData')` | Same — pass `app` |
| Handler ordering matters | Register all in same function; order within function doesn't matter for `ipcMain.handle` |
| Release note handlers need `getReleasesDir` | Pass as dep function |
