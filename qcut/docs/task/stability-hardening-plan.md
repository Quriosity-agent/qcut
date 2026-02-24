# Stability Hardening Plan

Three focused improvements to reduce runtime fragility and improve long-term maintainability.

---

## Task 1: Fix Circular Dependencies (29 detected)

**Status**: Detected by `bun run check:circular` (madge v8.0.0) in CI — warns but does not block merges.

### Problem

29 circular dependency cycles exist across `apps/web/src/` and `electron/`. Most are type-only re-exports through barrel files, so they don't break at runtime today. But they degrade tree-shaking, slow bundling, and will eventually cause initialization order bugs as the codebase grows.

### High-Risk Barrel Files

| Barrel File | Exports | Risk |
|---|---|---|
| `apps/web/src/lib/ai-video/index.ts` | 100+ items across 14 submodules | High |
| `apps/web/src/lib/remotion/index.ts` | 190+ lines, deep export tree | High |
| `apps/web/src/stores/timeline/index.ts` | 30+ exports, interdependent submodules | Medium |
| `apps/web/src/lib/export/index.ts` | 16 export engine variants | Medium |
| `apps/web/src/lib/ai-clients/ai-video-client.ts` | `export * from "../ai-video"` re-export chain | Medium |
| `apps/web/src/lib/ai-models/text2image-models.ts` | Cross-barrel re-export to `../text2image-models/` | Medium |

### Subtasks

#### 1.1 Audit and categorize all 29 cycles

- Run `npx madge --circular --extensions ts,tsx apps/web/src electron/ --json` and capture output
- Classify each cycle: **type-only** (safe to fix with `import type`) vs **value import** (needs refactoring)
- File: `.github/workflows/ci.yml` (lines 40-41) — current CI check

#### 1.2 Fix type-only cycles with `import type`

- For cycles caused by type re-exports, switch to `import type { ... }` / `export type { ... }`
- Primary targets: `ai-video/index.ts`, `ai-models/text2image-models.ts`, `timeline/index.ts`
- Files: all barrel `index.ts` files listed above

#### 1.3 Break value-import cycles by extracting shared types

- For true value-import cycles, extract shared interfaces into a dedicated `types.ts` at the module boundary
- Example: if `ai-video` and `ai-clients` both import values from each other, move shared types to `lib/ai-video/types.ts`
- Files: determined by audit in 1.1

#### 1.4 Make CI check blocking

- Change `bun run check:circular` to fail the build when cycles exceed 0
- Add `--warning` threshold if gradual reduction is preferred
- File: `.github/workflows/ci.yml`

### Tests

- `bun run check:circular` should exit 0 with no cycles
- `bun run build` should still succeed
- `bun check-types` should pass (type-only import changes can surface errors)

---

## Task 2: Replace spawnSync with Async Spawn for FFmpeg Binary Validation

### Problem

`isBinaryExecutable()` in `electron/ffmpeg/paths.ts:91-102` uses `spawnSync` with a 2.5s timeout to validate FFmpeg/FFprobe binaries. This blocks the Electron main process during startup while `getFFmpegPath()` and `getFFprobePath()` each call it (potentially multiple times across search candidates).

The health check in `electron/ffmpeg/health.ts` already uses async `spawn` — the sync validation in `paths.ts` is the only blocker.

### Relevant Files

| File | Lines | Purpose |
|---|---|---|
| `electron/ffmpeg/paths.ts` | 91-102 | `isBinaryExecutable()` — **the sync call to fix** |
| `electron/ffmpeg/paths.ts` | 237-279 | `getFFmpegPath()` — calls `isBinaryExecutable` |
| `electron/ffmpeg/paths.ts` | 289-359 | `getFFprobePath()` — calls `isBinaryExecutable` |
| `electron/ffmpeg/health.ts` | 20-81 | `checkBinaryVersion()` — already async, reference impl |
| `electron/ffmpeg-handler.ts` | 40-67 | Cached health check orchestrator |
| `electron/main.ts` | 653, 683 | Startup registration + health check init |

### Subtasks

#### 2.1 Convert `isBinaryExecutable` to async

- Replace `spawnSync` with `spawn` wrapped in a `Promise`
- Keep the 2.5s timeout
- Return `Promise<boolean>` instead of `boolean`
- File: `electron/ffmpeg/paths.ts:91-102`

#### 2.2 Make `getFFmpegPath` and `getFFprobePath` async

- Change return type from `string` to `Promise<string>`
- `await` the `isBinaryExecutable` calls inside the search loop
- Files: `electron/ffmpeg/paths.ts:237-279`, `electron/ffmpeg/paths.ts:289-359`

#### 2.3 Update all callers

- Update `electron/ffmpeg-handler.ts` and any IPC handlers that call `getFFmpegPath`/`getFFprobePath` to `await` the result
- Ensure `initFFmpegHealthCheck()` in `electron/main.ts:683` still fires non-blocking
- Files: `electron/ffmpeg-handler.ts`, `electron/main.ts`

### Tests

- Existing test: `electron/__tests__/sticker-export-real.test.ts` (uses `spawnSync` to locate FFmpeg — keep as-is since it's a test utility, not production code)
- Add unit test for `isBinaryExecutable`: mock `spawn` to verify timeout and success/failure paths
- Test file: `electron/__tests__/ffmpeg-paths.test.ts` (new)
- Manual: verify `bun run electron:dev` starts without blocking, FFmpeg paths resolve correctly

---

## Task 3: Add React Error Boundaries Around Core Editor Panels

### Problem

If the Timeline, Preview, Media, or Properties panel throws a runtime error, the entire editor white-screens. The app already has:

- A global `<ErrorBoundary>` in `apps/web/src/routes/__root.tsx:46`
- An isolated `<ErrorBoundary isolate>` around `<Outlet />` in `__root.tsx:50`
- A reusable `ErrorBoundary` component at `apps/web/src/components/error-boundary.tsx`

But no Error Boundary wraps the individual panels inside the editor layout. An error in the Timeline crashes the Preview, Media, and Properties panels too.

### Relevant Files

| File | Lines | Purpose |
|---|---|---|
| `apps/web/src/components/error-boundary.tsx` | 180-251 | Existing `ErrorBoundary` component (supports `isolate` prop) |
| `apps/web/src/components/editor/panel-layouts.tsx` | 22-411 | All 4 editor layouts (`Default`, `Media`, `Inspector`, `VerticalPreview`) |
| `apps/web/src/components/editor/media-panel/index.tsx` | 34-94 | MediaPanel component |
| `apps/web/src/components/editor/properties-panel/index.tsx` | 39-150+ | PropertiesPanel component |
| `apps/web/src/components/editor/timeline/index.tsx` | 45-150+ | Timeline component |
| `apps/web/src/components/editor/preview-panel.tsx` | 498-1296 | PreviewPanel component |

### Subtasks

#### 3.1 Create a lightweight `PanelErrorFallback` component

- Smaller than the existing `DefaultErrorFallback` — just shows panel name, "Something went wrong", and a Retry button
- Should fit inside a resizable panel without layout overflow
- File: `apps/web/src/components/editor/panel-error-fallback.tsx` (new)

#### 3.2 Wrap each panel in `<ErrorBoundary isolate>` in all 4 layouts

- Wrap `<MediaPanel />`, `<PreviewPanel />`, `<PropertiesPanel />`, and `<Timeline />` with `<ErrorBoundary isolate fallback={<PanelErrorFallback name="..." />}>`
- Apply in all 4 layout components: `DefaultLayout`, `MediaLayout`, `InspectorLayout`, `VerticalPreviewLayout`
- File: `apps/web/src/components/editor/panel-layouts.tsx`

#### 3.3 Add tests

- Unit test: render `PanelErrorFallback`, verify it shows the panel name and retry button
- Unit test: wrap a component that throws in `<ErrorBoundary isolate>`, verify the fallback renders instead of propagating
- Test file: `apps/web/src/components/editor/__tests__/panel-error-boundary.test.tsx` (new)

### Implementation Notes

- The existing `ErrorBoundary` already supports `isolate` mode (line 32 in `error-boundary.tsx`) which prevents the error from propagating to parent boundaries
- The existing `componentDidCatch` (line 204) logs to the centralized error handler at `lib/debug/error-handler.ts`
- No changes needed to the `ErrorBoundary` component itself — just use it

---

## Priority Order

1. **Error Boundaries** (Task 3) — highest user-facing impact, prevents full white-screen crashes
2. **Async FFmpeg** (Task 2) — removes main-process blocking, small surface area
3. **Circular Dependencies** (Task 1) — largest scope, lowest immediate risk, best done incrementally
