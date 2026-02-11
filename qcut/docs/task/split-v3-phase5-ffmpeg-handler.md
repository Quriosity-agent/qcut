# Phase 5: Split `ffmpeg-handler.ts`

**Source:** `electron/ffmpeg-handler.ts` (1310 lines → ~100 orchestrator + 4 modules)
**Risk Level:** High
**Estimated Time:** ~45 min
**Predecessor:** Phase 4

---

## Objective

Extract IPC handler groups and the FFmpeg argument builder from the monolithic handler into focused modules. The main file becomes a thin orchestrator that calls `setup*Handlers(tempManager)` functions.

---

## Key Design Decisions

1. **Each module exports a `setup*Handlers(tempManager)` function** that registers its IPC handlers via `ipcMain.handle()`.
2. **Registration order preserved** — orchestrator calls setup functions in the same order as current handler registration.
3. **Dual CJS/ESM exports stay in main file only** — sub-modules use ES6 exports exclusively.
4. **`tempManager` singleton passed as parameter** — no module-level shared state.

---

## Subtasks

### 5.1 Create `ffmpeg-args-builder.ts` (~265 lines)
**~10 min**

**File:** `electron/ffmpeg-args-builder.ts`

Move from `ffmpeg-handler.ts` (lines 1027–1291):
- `buildFFmpegArgs(options)` — constructs Mode 1 (frames→video) and Mode 2 (audio+video merge) argument arrays

**This is a pure function** — takes a config object, returns `string[]`. No IPC dependency, no Electron imports.

```ts
interface FFmpegArgsOptions {
  mode: 1 | 2;
  inputPath: string;
  outputPath: string;
  fps: number;
  codec: string;
  quality: number;
  audioPath?: string;
  // ... other options
}

export function buildFFmpegArgs(options: FFmpegArgsOptions): string[];
```

**Why extract first:** Zero risk, zero side effects. Validates the extraction pattern before touching IPC handlers.

### 5.2 Create `ffmpeg-basic-handlers.ts` (~72 lines)
**~5 min**

**File:** `electron/ffmpeg-basic-handlers.ts`

Move from `ffmpeg-handler.ts` (lines 101–172):
- `ffmpeg-path` handler — returns FFmpeg binary path
- `ffmpeg-health` handler — returns health check status
- `create-export-session` handler — creates temp directory for export
- `save-frame` handler — writes single frame PNG to temp directory
- `read-output-file` handler — reads rendered output file
- `cleanup-export-session` handler — removes temp directory
- `open-frames-folder` handler — opens folder in OS file manager

All simple, stateless handlers. Each takes `tempManager` for temp directory operations.

```ts
export function setupBasicHandlers(tempManager: TempManager): void;
```

### 5.3 Create `ffmpeg-utility-handlers.ts` (~274 lines)
**~10 min**

**File:** `electron/ffmpeg-utility-handlers.ts`

Move from `ffmpeg-handler.ts` (lines 744–1016):
- `validate-filter-chain` handler — validates FFmpeg filter graph syntax
- `processFrame` handler — applies FFmpeg filters to single frame
- `extract-audio` handler — extracts audio track from video file
- `save-sticker-for-export` handler — saves sticker overlay data for FFmpeg compositing

```ts
export function setupUtilityHandlers(tempManager: TempManager): void;
```

### 5.4 Create `ffmpeg-export-handler.ts` (~567 lines)
**~12 min**

**File:** `electron/ffmpeg-export-handler.ts`

Move from `ffmpeg-handler.ts` (lines 175–741):
- `export-video-cli` handler — the main 3-mode video export:
  - Mode 1: Frames → video (uses `buildFFmpegArgs`)
  - Mode 2: Audio + video merge (uses `buildFFmpegArgs`)
  - Mode 3: Direct FFmpeg pipeline

Imports `buildFFmpegArgs` from `./ffmpeg-args-builder`.

```ts
import { buildFFmpegArgs } from './ffmpeg-args-builder';

export function setupExportHandler(tempManager: TempManager): void;
```

**This is the largest and most complex extraction.** Take care with:
- Progress reporting via IPC `webContents.send()`
- Error handling and cleanup on failure
- 3 distinct export modes with different FFmpeg invocations

### 5.5 Update `ffmpeg-handler.ts` as orchestrator (~100 lines)
**~8 min**

**File:** `electron/ffmpeg-handler.ts` (~100 lines remaining)

Changes:
- Import 4 setup functions
- Keep: `getFFmpegHealth()`, `initFFmpegHealthCheck()` (~28 lines) — health check is module-level cached promise
- `setupFFmpegIPC()` calls:
  ```ts
  export function setupFFmpegIPC(tempManager: TempManager): void {
    setupBasicHandlers(tempManager);
    setupUtilityHandlers(tempManager);
    setupExportHandler(tempManager);
  }
  ```
- Keep dual export at bottom:
  ```ts
  // CJS compatibility
  module.exports = { setupFFmpegIPC, getFFmpegHealth, initFFmpegHealthCheck };
  // ES6 export
  export default setupFFmpegIPC;
  export { getFFmpegHealth, initFFmpegHealthCheck };
  ```
- Type re-exports from `./ffmpeg/types` stay here

---

## Existing Related Files

- `electron/main.ts` — calls `setupFFmpegIPC()` — verify import still works
- `electron/ffmpeg/types.ts` — shared types (if exists)
- `electron/temp-manager.ts` — `TempManager` class used by all handlers

---

## Unit Tests

### New tests

**File:** `electron/__tests__/ffmpeg-args-builder.test.ts`

| Test Case | Description |
|-----------|-------------|
| `Mode 1: builds frames-to-video args` | Input dir + fps + codec → correct arg array |
| `Mode 1: includes quality flag` | Quality setting → `-crf` or `-b:v` flag present |
| `Mode 2: builds audio merge args` | Video + audio paths → `-i` flags for both |
| `Mode 2: includes audio codec` | Audio present → `-c:a aac` in args |
| `rejects invalid mode` | Mode 4 → throws or returns empty |
| `handles optional audio path` | No audio → no `-i` audio flag |

**File:** `electron/__tests__/ffmpeg-basic-handlers.test.ts`

| Test Case | Description |
|-----------|-------------|
| `ffmpeg-path returns string path` | Mock ipcMain, assert handler returns path |
| `create-export-session creates temp dir` | Mock tempManager, assert `createSession` called |
| `cleanup-export-session removes temp dir` | Mock tempManager, assert `cleanupSession` called |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Shared `tempManager` singleton | Passed as parameter to each setup function — explicit dependency |
| `ipcMain.handle` registration order | Orchestrator calls in same order — document ordering requirement |
| CJS/ESM dual export breaks | All exports stay in main file; sub-modules use ES6 only |
| `buildFFmpegArgs` circular import | Export handler imports args builder → one-directional, no cycle |
| Health check cached promise is module-level | Keep in main file (28 lines) — not worth extracting |
| `webContents.send()` for progress events | Export handler receives `BrowserWindow` reference via `tempManager` or parameter |

---

## CJS/ESM Compatibility Note

The current file uses both `module.exports` and ES6 `export`. This is because Electron's main process may load via CommonJS depending on build config. The extraction must:
- Keep `module.exports` ONLY in the orchestrator file
- Use `export function` in all sub-modules
- Verify `electron/main.ts` import resolves correctly after split

---

## Verification Checklist

- [ ] `bun run check-types` — no new type errors
- [ ] `bun lint:clean` — no lint violations
- [ ] `bun run test` — new tests pass
- [ ] Smoke test: `bun run electron:dev` → export video → all 3 modes work
- [ ] `electron/main.ts` import of `setupFFmpegIPC` still resolves
- [ ] FFmpeg health check still works on app startup
- [ ] IPC handler registration order matches original
- [ ] No `module.exports` in sub-module files
