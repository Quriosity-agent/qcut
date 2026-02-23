# QCut Architecture Review & Improvement Plan

> **Date:** 2026-02-23  
> **Branch:** win8-refactor  
> **Scope:** Full codebase — Electron main process + React/web frontend

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Design & Component Boundaries](#2-system-design--component-boundaries)
3. [Dependency Graph & Coupling](#3-dependency-graph--coupling)
4. [Data Flow & Bottlenecks](#4-data-flow--bottlenecks)
5. [Scaling & Single Points of Failure](#5-scaling--single-points-of-failure)
6. [Priority Recommendations](#6-priority-recommendations)

---

## 1. Project Overview

### Codebase Stats

| Layer | Files | Notes |
|-------|-------|-------|
| `electron/` | 151 TS files | Main process, IPC handlers, AI pipeline, Claude integration |
| `apps/web/src/` | 494 TS + 357 TSX | React frontend, stores, components |
| `apps/web/src/stores/` | 37 store files | Zustand stores, many >600 lines |

### Largest Files (Electron)

| File | Lines | Responsibility |
|------|-------|---------------|
| `electron/ffmpeg-export-handler.ts` | 1,219 | FFmpeg export orchestration |
| `electron/claude/claude-timeline-handler.ts` | 1,143 | Claude AI ↔ timeline operations |
| `electron/screen-recording-handler.ts` | 1,075 | Screen capture & recording |
| `electron/claude/claude-export-handler.ts` | 1,040 | Claude-driven export pipeline |
| `electron/native-pipeline/cli-runner.ts` | 943 | CLI binary spawning for AI pipeline |
| `electron/ai-pipeline-handler.ts` | 940 | AI content generation (images, video, avatars) |
| `electron/main-ipc.ts` | 884 | Central IPC handler registration |
| `electron/preload-types/electron-api.ts` | 852 | Single ElectronAPI interface |
| `electron/native-pipeline/vimax-cli-handlers.ts` | 829 | Vimax CLI integration |
| `electron/claude/claude-http-server.ts` | 785 | HTTP server for Claude Code |
| `electron/main.ts` | 730 | App entry point & initialization |
| `electron/sound-handler.ts` | 700 | Sound search & download |

### Largest Files (Web Stores)

| File | Lines | Responsibility |
|------|-------|---------------|
| `apps/web/src/stores/timeline-store-operations.ts` | 1,427 | Timeline mutation operations |
| `apps/web/src/stores/media-store.ts` | 1,157 | Media file management |
| `apps/web/src/stores/timeline-store.ts` | 1,087 | Timeline state & playback |
| `apps/web/src/stores/remotion-store.ts` | 918 | Remotion rendering state |
| `apps/web/src/stores/effects-store.ts` | 852 | Effects & filters |
| `apps/web/src/stores/moyin-store.ts` | 800 | Moyin platform integration |

---

## 2. System Design & Component Boundaries

### Problem: Fat Main Process

The Electron main process is a monolith. `main.ts` (730 lines) imports and initializes **17+ handler modules** in a single function:

```typescript
// electron/main.ts — lines 89–126
const { setupFFmpegIPC, initFFmpegHealthCheck } = require("./ffmpeg-handler.js");
const { setupSoundIPC } = require("./sound-handler.js");
const { setupThemeIPC } = require("./theme-handler.js");
const { setupApiKeyIPC } = require("./api-key-handler.js");
const { setupGeminiHandlers } = require("./gemini-transcribe-handler.js");
const { registerAIVideoHandlers, migrateAIVideosToDocuments } = require("./ai-video-save-handler.js");
const { setupGeminiChatIPC } = require("./gemini-chat-handler.js");
const { setupAIFillerIPC } = require("./ai-filler-handler.js");
const { setupPtyIPC, cleanupPtySessions } = require("./pty-handler.js");
const { setupSkillsIPC } = require("./skills-handler.js");
const { setupSkillsSyncIPC } = require("./skills-sync-handler.js");
const { setupAIPipelineIPC, cleanupAIPipeline } = require("./ai-pipeline-ipc.js");
const { setupMediaImportIPC } = require("./media-import-handler.js");
const { registerElevenLabsTranscribeHandler } = require("./elevenlabs-transcribe-handler.js");
const { setupProjectFolderIPC } = require("./project-folder-handler.js");
const { setupAllClaudeIPC } = require("./claude/index.js");
const { setupRemotionFolderIPC } = require("./remotion-folder-handler.js");
const { setupScreenRecordingIPC } = require("./screen-recording-handler.js");
const { setupMoyinIPC } = require("./moyin-handler.js");
```

Every module runs in the same Node.js event loop. A long-running FFmpeg encode or AI pipeline call can starve IPC message handling and make the app feel unresponsive.

### Problem: Handler Files Are Too Large

Individual handler files contain **mixed concerns** — IPC registration, business logic, file I/O, error handling, and process management all in one file. For example, `ai-pipeline-handler.ts` (940 lines) spawns child processes, manages state, handles errors, and formats output — all inline.

### Recommendation: Thin IPC Layer + Domain Services

**Implementation:**

```
electron/
  ipc/                          # Thin IPC layer — only ipcMain.handle() wiring
    ffmpeg.ipc.ts               # 30-50 lines: register handlers, delegate to service
    claude.ipc.ts
    ai-pipeline.ipc.ts
    media.ipc.ts
    ...
  services/                     # Business logic — no Electron imports
    ffmpeg/
      export-service.ts         # Pure logic: build command, parse output
      health-check.ts
    claude/
      timeline-service.ts
      export-service.ts
      http-server.ts
    ai-pipeline/
      pipeline-runner.ts
      output-parser.ts
    media/
      import-service.ts
  main.ts                       # Slim: create window, register IPC domains
```

**Steps:**
1. For each handler file, extract business logic into a `services/` module with no Electron imports
2. The IPC file becomes a thin adapter: parse args → call service → return result
3. Services become testable without Electron mocking
4. Aim for IPC files <100 lines, services <400 lines

---

## 3. Dependency Graph & Coupling

### Problem: Single IPC Registration Point

`main-ipc.ts` (884 lines) is the single registration point for all "general" IPC handlers. It receives a `MainIpcDeps` dependency bag and registers handlers for file dialogs, storage, FAL uploads, release notes, and more — all in one function.

```typescript
// electron/main-ipc.ts
export interface MainIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  logger: Logger;
  autoUpdater: AutoUpdater | null;
  getReleasesDir: () => string;
  readChangelogFallback: () => ReleaseNote[];
}

export function registerMainIpcHandlers(deps: MainIpcDeps) {
  // 800+ lines of ipcMain.handle() calls covering 6+ domains
}
```

Adding any new IPC handler means touching this file. It's a merge-conflict magnet and makes it hard to understand what depends on what.

### Problem: Monolithic API Interface

`electron/preload-types/electron-api.ts` (852 lines) defines a single `ElectronAPI` interface with **every method** the renderer can call. This creates implicit coupling — any change to any subsystem requires editing this one file.

### Problem: Store Coupling

The web stores cross-reference each other heavily. `timeline-store-operations.ts` (1,427 lines) contains operations that read from and write to multiple stores. The stores form a tightly-coupled graph:

```
timeline-store ←→ timeline-store-operations
       ↕                    ↕
  media-store ←→ effects-store
       ↕
  project-store
```

### Recommendation: Domain-Based IPC Registration

**Implementation:**

```typescript
// electron/ipc/media.ipc.ts — small, focused, single-domain
import { ipcMain, dialog } from "electron";
import { MediaService } from "../services/media/media-service.js";

export function registerMediaIPC(deps: { getMainWindow: () => BrowserWindow | null }) {
  const service = new MediaService();

  ipcMain.handle("media:import", (_e, opts) => service.importFile(opts));
  ipcMain.handle("media:delete", (_e, id) => service.deleteFile(id));
  ipcMain.handle("media:info", (_e, id) => service.getInfo(id));
}
```

**Steps:**
1. Split `main-ipc.ts` into domain files: `file-dialog.ipc.ts`, `storage.ipc.ts`, `fal-upload.ipc.ts`, `updates.ipc.ts`, etc.
2. Each domain file exports a single `register*IPC()` function
3. `main.ts` calls each registration function — becomes a simple list of `register*IPC(deps)` calls
4. Split `ElectronAPI` into domain interfaces composed via intersection types:

```typescript
// electron/preload-types/electron-api.ts
type ElectronAPI = MediaAPI & TimelineAPI & ExportAPI & ClaudeAPI & SystemAPI;
```

### Recommendation: Store Decoupling via Event Bus

**Implementation:**

```typescript
// apps/web/src/lib/event-bus.ts
type EventMap = {
  "media:imported": { fileId: string; path: string };
  "timeline:clip-added": { clipId: string; trackIndex: number };
  "export:started": { preset: string };
};

const bus = createEventBus<EventMap>();

// In media-store: after import
bus.emit("media:imported", { fileId, path });

// In timeline-store: subscribe without importing media-store
bus.on("media:imported", ({ fileId }) => { /* add to timeline */ });
```

**Steps:**
1. Create a typed event bus (`mitt` or custom ~50 lines)
2. Identify cross-store calls (grep for `useMediaStore.getState()` inside other stores)
3. Replace direct store access with event emissions
4. Stores subscribe to events they care about — no import coupling

---

## 4. Data Flow & Bottlenecks

### Problem: CPU-Heavy Work on Main Process

The AI pipeline handler (`ai-pipeline-handler.ts`) spawns child processes via `child_process.spawn()`, which is fine — but the **orchestration, state tracking, and output parsing** all happen on the main process event loop. Similarly:

- **Claude HTTP server** (`claude-http-server.ts`, 785 lines) runs an HTTP server on the main process via `node:http.createServer()`. Every incoming request is handled on the main thread.
- **FFmpeg export** (`ffmpeg-export-handler.ts`, 1,219 lines) does progress parsing, frame extraction, and file I/O on main.
- **Screen recording** (`screen-recording-handler.ts`, 1,075 lines) manages capture state, file writing, and encoding on main.

While the actual FFmpeg/AI binary runs in a child process, the IPC message handling for progress updates and state management competes with window events and UI responsiveness.

### Recommendation: Utility Processes for Heavy Subsystems

Electron's `utilityProcess` (Electron 22+) provides a sandboxed Node.js process that can communicate with main via `MessagePort`. This is ideal for:

1. **Claude HTTP Server** — move to a utility process; it doesn't need BrowserWindow access for most routes
2. **AI Pipeline orchestration** — move state machine & output parsing to utility process
3. **FFmpeg progress tracking** — move progress parsing to a worker

**Implementation:**

```typescript
// electron/workers/claude-server.worker.ts
import { createServer } from "node:http";

process.parentPort.on("message", (msg) => {
  if (msg.data.type === "start") {
    const server = createServer(/* ... */);
    server.listen(8765);
  }
});

// electron/main.ts
import { utilityProcess } from "electron";
const claudeWorker = utilityProcess.fork(
  path.join(__dirname, "workers/claude-server.worker.js")
);
claudeWorker.postMessage({ type: "start", config: { ... } });
```

**Steps:**
1. Start with Claude HTTP server — least coupled to BrowserWindow
2. Define a message protocol between main and utility process
3. For routes that need renderer data (timeline state), relay via main → renderer IPC
4. Move AI pipeline orchestration next
5. Benchmark before/after to quantify UI responsiveness improvement

---

## 5. Scaling & Single Points of Failure

### Problem: All-or-Nothing Initialization

`main.ts` initializes everything synchronously-ish during `app.whenReady()`. If any handler fails to set up (e.g., FFmpeg binary missing, Claude server port taken), the entire app could be in a degraded state with no clear indication to the user.

```typescript
// Current pattern in main.ts (conceptual)
app.whenReady().then(async () => {
  createWindow();
  setupFFmpegIPC(mainWindow);     // if this throws?
  setupSoundIPC(mainWindow);       // does this still run?
  setupAllClaudeIPC(mainWindow);   // what if port 8765 is taken?
  // ... 15 more setup calls
});
```

### Problem: No Feature-Level Error Boundaries

If the Claude HTTP server crashes, the entire main process might become unstable. There's no isolation between subsystems — a bug in the sound handler could theoretically affect FFmpeg exports because they share the same event loop and global state.

### Recommendation: Progressive Loading with Feature Flags

**Implementation:**

```typescript
// electron/feature-registry.ts
interface Feature {
  name: string;
  setup: (deps: FeatureDeps) => Promise<void>;
  cleanup?: () => Promise<void>;
  optional: boolean;  // true = app works without it
}

const features: Feature[] = [
  { name: "ffmpeg",    setup: setupFFmpegIPC,    optional: false },
  { name: "claude",    setup: setupAllClaudeIPC, optional: true  },
  { name: "ai-pipeline", setup: setupAIPipelineIPC, optional: true },
  { name: "screen-recording", setup: setupScreenRecordingIPC, optional: true },
  // ...
];

export async function initializeFeatures(deps: FeatureDeps) {
  const results: Record<string, "ok" | "failed"> = {};
  for (const feature of features) {
    try {
      await feature.setup(deps);
      results[feature.name] = "ok";
    } catch (err) {
      results[feature.name] = "failed";
      logger.error(`Feature "${feature.name}" failed to initialize:`, err);
      if (!feature.optional) throw err;
    }
  }
  return results;  // report to renderer for UI indication
}
```

**Steps:**
1. Wrap each `setup*IPC()` call in try-catch with logging
2. Mark features as `optional` or `required`
3. Report feature status to renderer so UI can show degraded state (e.g., gray out Claude features if server failed)
4. Add cleanup hooks for graceful shutdown

### Recommendation: Plugin Architecture for AI Providers

Multiple AI providers (Gemini, Claude, ElevenLabs, FAL) are hardcoded. A plugin system would:

- Allow adding new providers without touching core code
- Enable lazy loading (don't load Claude code if user doesn't use it)
- Support community extensions

**Implementation sketch:**

```typescript
// electron/plugins/ai-provider.ts
interface AIProvider {
  id: string;
  name: string;
  capabilities: ("transcribe" | "generate-image" | "generate-video" | "chat")[];
  setup(deps: ProviderDeps): Promise<void>;
  cleanup?(): Promise<void>;
}

// electron/plugins/providers/gemini.provider.ts
export const geminiProvider: AIProvider = {
  id: "gemini",
  name: "Google Gemini",
  capabilities: ["transcribe", "chat"],
  async setup(deps) {
    // register IPC handlers for Gemini
  }
};
```

---

## 6. Priority Recommendations

### Quick Wins (1-2 weeks each)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Continue file splitting** (already in progress on win8-refactor) | Reduces cognitive load, easier reviews | Low |
| 2 | **Wrap setup calls in try-catch** in `main.ts` | Prevents cascading failures | Very Low |
| 3 | **Split `ElectronAPI` into domain interfaces** | Reduces merge conflicts, clearer ownership | Low |
| 4 | **Extract `main-ipc.ts` into 5-6 domain files** | Each file <200 lines, easier to navigate | Low-Med |

### Mid-Term (1-2 months)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 5 | **Move Claude HTTP server to `utilityProcess`** | Unblocks main process, better isolation | Medium |
| 6 | **Split IPC registration by domain** across all handlers | Clean architecture, testable | Medium |
| 7 | **Create typed event bus** for store communication | Decouples stores, prevents circular deps | Medium |
| 8 | **Extract business logic from handlers into services/** | Testable without Electron, reusable | Medium |

### Long-Term (3-6 months)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 9 | **Store decoupling** — all cross-store communication via events | Maintainable, scalable state management | High |
| 10 | **Plugin architecture** for AI providers | Extensible, lazy-loadable, community-ready | High |
| 11 | **Feature registry** with progressive loading | Graceful degradation, better UX | Medium-High |
| 12 | **Worker threads** for FFmpeg progress parsing & AI orchestration | UI responsiveness | Medium-High |

### Suggested Order of Execution

```
Phase 1 (Now):     #1 → #2 → #3 → #4
Phase 2 (Next):    #6 → #8 → #5 → #7
Phase 3 (Later):   #9 → #11 → #12 → #10
```

Each phase builds on the previous. Phase 1 is mechanical refactoring with low risk. Phase 2 introduces architectural changes that benefit from Phase 1's cleaner structure. Phase 3 is strategic investment for long-term maintainability.

---

## Appendix: Key File Paths Reference

```
electron/
  main.ts                                    # 730 lines — app entry, window creation
  main-ipc.ts                                # 884 lines — general IPC handlers
  ffmpeg-export-handler.ts                   # 1,219 lines — FFmpeg export
  ai-pipeline-handler.ts                     # 940 lines — AI content generation
  screen-recording-handler.ts                # 1,075 lines — screen capture
  sound-handler.ts                           # 700 lines — sound search/download
  claude/
    claude-timeline-handler.ts               # 1,143 lines — Claude ↔ timeline
    claude-export-handler.ts                 # 1,040 lines — Claude export pipeline
    claude-http-server.ts                    # 785 lines — HTTP API for Claude Code
  native-pipeline/
    cli-runner.ts                            # 943 lines — CLI binary spawning
    vimax-cli-handlers.ts                    # 829 lines — Vimax CLI
    editor-handlers-timeline.ts              # 738 lines — editor timeline ops
    manager.ts                               # 682 lines — pipeline management
  preload-types/
    electron-api.ts                          # 852 lines — ElectronAPI interface

apps/web/src/stores/
  timeline-store-operations.ts               # 1,427 lines — timeline mutations
  media-store.ts                             # 1,157 lines — media management
  timeline-store.ts                          # 1,087 lines — timeline state
  remotion-store.ts                          # 918 lines — Remotion rendering
  effects-store.ts                           # 852 lines — effects & filters
  moyin-store.ts                             # 800 lines — Moyin integration
```
