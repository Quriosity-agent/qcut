# Phase 4: Split `export-engine.ts`

**Source:** `apps/web/src/lib/export-engine.ts` (1404 lines → ~550 + 4 extracted modules)
**Risk Level:** Medium-High
**Estimated Time:** ~40 min
**Predecessor:** Phase 3

---

## Objective

Extract rendering, recording, utility, and debug methods from the `ExportEngine` class into standalone function modules. The class delegates to these via an explicit `ExportEngineContext` interface, keeping the public API identical.

---

## Key Design Decision: Context Object Pattern

Instead of extracting class methods that need `this`, define:

```ts
// In export-engine.ts
export interface ExportEngineContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  settings: ExportSettings;
  tracks: Track[];
  mediaItems: MediaItem[];
  videoCache: Map<string, HTMLVideoElement>;
  usedImages: Map<string, HTMLImageElement>;
  cancelled: boolean;
  progressCallback?: ProgressCallback;
}
```

Extracted functions accept this context as their first parameter. The class creates the context once and passes it.

---

## Subtasks

### 4.1 Create `export-engine-utils.ts` (~145 lines)
**~8 min**

**File:** `apps/web/src/lib/export-engine-utils.ts`

Move from `export-engine.ts`:
- `calculateTotalFrames(tracks, settings)` — frame count from timeline duration and FPS
- `getActiveElements(tracks, frameTime)` — filter elements visible at given time
- `calculateElementBounds(element, canvasWidth, canvasHeight)` — position/size to pixel coords
- `getTotalDuration(tracks)` — max end time across all tracks
- `getFrameRate(settings)` — FPS from settings with default

These are **pure functions** — no class dependency, no canvas access.

Exports: all 5 functions

### 4.2 Create `export-engine-debug.ts` (~92 lines)
**~5 min**

**File:** `apps/web/src/lib/export-engine-debug.ts`

Move from `export-engine.ts`:
- `validateRenderedFrame(ctx, width, height)` — checks canvas for blank frames
- `logActualVideoDuration(videoElement)` — console diagnostics for video element timing

Only needs canvas context and dimensions — minimal interface.

Exports: both functions

### 4.3 Create `export-engine-recorder.ts` (~125 lines)
**~8 min**

**File:** `apps/web/src/lib/export-engine-recorder.ts`

Move from `export-engine.ts`:
- `setupMediaRecorder(canvas, settings)` — creates MediaRecorder with codec/bitrate config
- `getVideoBitrate(resolution, quality)` — bitrate lookup table
- `startRecording(recorder)` — begins capture
- `stopRecording(recorder)` — stops and returns Blob promise

**Recorder context:**
```ts
interface RecorderContext {
  canvas: HTMLCanvasElement;
  settings: ExportSettings;
  mediaRecorder: MediaRecorder | null;
  recordedChunks: Blob[];
  useFFmpegExport: boolean;
}
```

### 4.4 Create `export-engine-renderer.ts` (~440 lines)
**~12 min**

**File:** `apps/web/src/lib/export-engine-renderer.ts`

Move from `export-engine.ts`:
- `renderFrame(ctx, elements, frameTime)` — orchestrates single frame render
- `renderElement(ctx, element, frameTime)` — dispatches to typed renderers
- `renderImage(ctx, element)` — draws image element with transforms
- `renderVideo(ctx, element, frameTime, videoCache)` — draws video frame with seek
- `renderVideoAttempt(ctx, videoElement, bounds)` — single draw attempt with error recovery
- `renderOverlayStickers(ctx, stickers, frameTime)` — sticker layer rendering
- `renderTextElement(ctx, element)` — text with font, alignment, effects

All take `ExportEngineContext` as first param.

**This is the largest extraction** — take care with:
- `videoCache` Map mutations (shared between renders)
- Canvas state save/restore around each element
- Effect application order (filters, transforms, opacity)

### 4.5 Update `export-engine.ts` to delegate to modules
**~7 min**

**File:** `apps/web/src/lib/export-engine.ts` (~550 lines remaining)

Changes:
- Define `ExportEngineContext` interface (exported)
- Import from 4 new modules
- Class constructor builds context object
- `export()` method calls: `renderFrame(this.context, elements, frameTime)`
- Keep: class shell, constructor, `export()` orchestration, `cancel()`, `isExportInProgress()`, `isExportCancelled()`, `downloadVideo()`, `exportAndDownload()`, `preloadAllVideos()`, `preloadVideo()`
- Public API signatures unchanged

---

## Existing Related Files

- `apps/web/src/lib/export-engine-optimized.ts` — optimized variant (already separate)
- `apps/web/src/lib/export-engine-factory.ts` — factory for selecting engine
- `apps/web/src/lib/export-engine-cli.ts` — CLI export interface
- `apps/web/src/lib/export-engine.backup.ts` — backup file (can be ignored)

These files import from `export-engine.ts` — verify their imports still resolve.

---

## Unit Tests

### Existing tests
- `apps/web/src/lib/remotion/__tests__/export-engine-remotion.test.ts` — verify still passes
- `apps/web/src/lib/__tests__/export-analysis.test.ts` — verify still passes

### New tests

**File:** `apps/web/src/lib/__tests__/export-engine-utils.test.ts`

| Test Case | Description |
|-----------|-------------|
| `calculateTotalFrames returns correct count` | 10s at 30fps → 300 frames |
| `getActiveElements filters by time` | Elements with start/end, query at midpoint |
| `calculateElementBounds scales to canvas` | 50% width element on 1920 canvas → 960px |
| `getTotalDuration returns max end time` | Multiple tracks → latest end time |
| `getFrameRate defaults to 30` | No FPS in settings → 30 |

**File:** `apps/web/src/lib/__tests__/export-engine-recorder.test.ts`

| Test Case | Description |
|-----------|-------------|
| `getVideoBitrate returns correct bitrate for 1080p` | Resolution + quality → expected bitrate |
| `getVideoBitrate returns correct bitrate for 720p` | Lower resolution → lower bitrate |

**File:** `apps/web/src/lib/__tests__/export-engine-debug.test.ts`

| Test Case | Description |
|-----------|-------------|
| `validateRenderedFrame detects blank canvas` | All-black canvas → returns false |
| `validateRenderedFrame passes non-blank canvas` | Canvas with content → returns true |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `this` context lost in extracted methods | Explicit `ExportEngineContext` — no `this` reliance |
| `export()` references many extracted methods | Import and call with context object |
| Renderer duplicates effect application | Consolidate into shared helper within `export-engine-renderer.ts` |
| `renderVideo()` mutates shared `videoCache` | Cache is in context object — mutations work the same |
| Class API shape changes | All public method signatures kept identical |
| `export-engine-optimized.ts` imports break | Verify imports; add re-exports if needed |

---

## Verification Checklist

- [ ] `bun run check-types` — no new type errors
- [ ] `bun lint:clean` — no lint violations
- [ ] `bun run test` — existing + new tests pass
- [ ] Smoke test: `bun run electron:dev` → export video → renders correctly
- [ ] `ExportEngine` public API unchanged — `export()`, `cancel()`, `downloadVideo()` all work
- [ ] `export-engine-factory.ts` and `export-engine-cli.ts` still import correctly
