# Test Plan: Auto-Verify Sticker Overlay Export Fix

## Overview

Automated test suite to verify all five root causes identified in [`fix-sticker-overlay-export.md`](./fix-sticker-overlay-export.md) are addressed and remain working. Total estimated time: **35-45 minutes**.

---

## Subtask 1: Test Sticker Export Helper Error Handling & Rendering (15 min)

**Objective**: Verify `StickerExportHelper` logs errors, tracks failures, and renders stickers correctly to canvas.

**Test File**: `apps/web/src/lib/__tests__/sticker-export-helper.test.ts`

**Source Under Test**: `apps/web/src/lib/stickers/sticker-export-helper.ts`

**Tests**:

```
describe("StickerExportHelper")
├── describe("renderStickersToCanvas")
│   ├── it("should return success result when all stickers render correctly")
│   ├── it("should track failed stickers in result when media item is missing")
│   ├── it("should log warning when sticker rendering fails")
│   ├── it("should continue rendering remaining stickers after one fails")
│   ├── it("should sort stickers by zIndex before rendering")
│   ├── it("should return attempted=0 for stickers with no matching media")
│   └── it("should skip stickers whose mediaItem has no URL")
├── describe("renderSticker positioning")
│   ├── it("should convert percentage position to center-based pixel coordinates")
│   ├── it("should calculate size relative to Math.min(canvasWidth, canvasHeight)")
│   ├── it("should apply rotation in radians around sticker center")
│   └── it("should apply opacity via ctx.globalAlpha")
├── describe("preloadStickers")
│   ├── it("should load all unique sticker image URLs in parallel")
│   ├── it("should report loaded count and failed URLs")
│   ├── it("should cache images for reuse during rendering")
│   └── it("should skip stickers with no media URL")
├── describe("areStickersPreloaded")
│   ├── it("should return true when all sticker images are cached")
│   └── it("should return false when any image is not cached")
└── describe("clearCache")
    └── it("should clear all cached images")
```

**Mock Strategy**:
- Mock `HTMLImageElement` with `onload`/`onerror` triggers
- Mock `CanvasRenderingContext2D` with spies on `drawImage`, `save`, `restore`, `translate`, `rotate`, `globalAlpha`
- Use factory function `createMockSticker(overrides)` returning `OverlaySticker`
- Use factory function `createMockMediaItem(overrides)` returning `MediaItem`

**Key Assertions**:
- `result.failed` array captures sticker ID and error message (not silent)
- `console.warn` called with descriptive message on failure
- `result.successful + result.failed.length === result.attempted`
- Canvas `drawImage` receives correct pixel dimensions derived from `baseSize = Math.min(w, h)`
- Center-to-topleft conversion: `x = (pos.x/100)*canvasW - width/2`

---

## Subtask 2: Test Sticker Timing Consistency (10 min)

**Objective**: Verify timing defaults are consistent between preview store and CLI export sources.

**Test File**: `apps/web/src/lib/__tests__/sticker-timing-consistency.test.ts`

**Sources Under Test**:
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts` (lines 209-210)
- `apps/web/src/types/sticker-overlay.ts` (timing type definition)

**Tests**:

```
describe("Sticker Timing Consistency")
├── describe("extractStickerSources timing defaults")
│   ├── it("should default startTime to 0 when timing is undefined")
│   ├── it("should default endTime to totalDuration when timing is undefined")
│   ├── it("should default startTime to 0 when timing.startTime is undefined")
│   ├── it("should default endTime to totalDuration when timing.endTime is undefined")
│   ├── it("should preserve explicit startTime and endTime values")
│   └── it("should handle timing with only startTime set")
└── describe("coordinate transformation")
    ├── it("should convert center-based percentage to top-left pixel coordinates")
    ├── it("should use Math.min(canvasW, canvasH) as baseSize for sticker dimensions")
    └── it("should round pixel coordinates to integers")
```

**Mock Strategy**:
- Mock `stickersStoreGetter` returning controlled sticker data
- Mock `stickerAPI.saveStickerForExport` returning `{ success: true, path: "/tmp/sticker.png" }`
- Mock `fetch` for blob download path
- No DOM mocks needed (pure data transformation)

**Key Assertions**:
- `sticker.timing === undefined` → `startTime: 0, endTime: totalDuration`
- `sticker.timing.startTime === undefined` → `startTime: 0`
- `sticker.timing.endTime === undefined` → `endTime: totalDuration`
- Pixel math: for 1920x1080 canvas, sticker at `{x:50, y:50}` with `{width:20, height:20}` → `baseSize=1080`, `pixelW=216`, `pixelH=216`, `topLeftX=960-108=852`, `topLeftY=540-108=432`

---

## Subtask 3: Test FFmpeg Filter Generation (10 min)

**Objective**: Verify `buildStickerOverlayFilters()` produces correct FFmpeg complex filter chains with proper timing, rotation, opacity, and positioning.

**Test File**: `apps/web/src/lib/__tests__/sticker-ffmpeg-filter.test.ts`

**Source Under Test**: `apps/web/src/lib/export-cli/filters/sticker-overlay.ts`

**Tests**:

```
describe("buildStickerOverlayFilters")
├── it("should return empty string when stickerSources is empty")
├── it("should return empty string when stickerSources is null/undefined")
├── it("should generate scale filter for each sticker")
├── it("should generate overlay filter with x and y coordinates")
├── it("should add enable='between(t,start,end)' when timing differs from full duration")
├── it("should omit enable clause when sticker spans entire video (startTime=0, endTime=totalDuration)")
├── it("should apply rotation filter before overlay when rotation is non-zero")
├── it("should skip rotation filter when rotation is 0")
├── it("should apply opacity via format+geq when opacity < 1")
├── it("should skip opacity filter when opacity is 1 or undefined")
├── it("should chain multiple stickers with correct input/output labels")
├── it("should use 0:v as initial input label for first sticker")
└── it("should omit output label on last sticker in chain")
```

**Mock Strategy**:
- Pure function test — no mocks needed beyond a silent `logger: vi.fn()`
- Create factory function `createStickerSource(overrides): StickerSourceForFilter`

**Key Assertions**:
- Single sticker: filter contains `scale=W:H`, `overlay=X:Y`
- Timing filter: `enable='between(t,2,8)'` for `startTime:2, endTime:8`
- Rotation: `rotate=45*PI/180:c=none` for 45 degrees
- Opacity 0.5: `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='0.5*alpha(X,Y)'`
- Chain of 3 stickers: output labels `[v1]`, `[v2]`, last has no label
- Semicolons separate filter segments

---

## Subtask 4: Test Sticker Source Extraction (10 min)

**Objective**: Verify `extractStickerSources()` correctly downloads stickers, calculates positions, and handles error cases gracefully.

**Test File**: `apps/web/src/lib/__tests__/sticker-sources.test.ts`

**Source Under Test**: `apps/web/src/lib/export-cli/sources/sticker-sources.ts`

**Tests**:

```
describe("extractStickerSources")
├── describe("happy path")
│   ├── it("should return sticker sources sorted by zIndex")
│   ├── it("should use localPath when available instead of downloading")
│   └── it("should download blob URL via fetch when no localPath")
├── describe("error handling")
│   ├── it("should return empty array when sessionId is null")
│   ├── it("should return empty array when no stickers exist")
│   ├── it("should return empty array when sticker API is unavailable")
│   ├── it("should skip sticker when media item is not found")
│   ├── it("should skip sticker when download fails and continue with rest")
│   └── it("should return empty array when store getter throws")
├── describe("coordinate math")
│   ├── it("should convert percentage position to center-adjusted pixel coordinates")
│   └── it("should use Math.min(canvasW, canvasH) for baseSize calculation")
└── describe("downloadStickerToTemp")
    ├── it("should call saveStickerForExport with correct params")
    ├── it("should throw when fetch returns non-ok response")
    └── it("should throw when saveStickerForExport returns no path")
```

**Mock Strategy**:
- Mock `stickersStoreGetter` returning `{ getStickersForExport: () => [...] }`
- Mock `stickerAPI` with `saveStickerForExport: vi.fn()`
- Mock global `fetch` with `vi.fn()` returning mock Response with `.blob()` → `{ arrayBuffer: () => new ArrayBuffer(8), type: "image/png" }`
- Factory: `createStickerOverlayData(overrides): StickerOverlayData`

**Key Assertions**:
- Sources are sorted by `zIndex` ascending
- `localPath` shortcut: `fetch` NOT called when `mediaItem.localPath` is set
- Coordinate math verified against known pixel values (1920x1080 test case)
- Skipped stickers don't appear in output (graceful degradation)
- Logger called with descriptive messages at each step

---

## Test Infrastructure

### Shared Factories (create in each test file or extract to a shared helper)

```typescript
// Minimal OverlaySticker factory
function createMockSticker(overrides?: Partial<OverlaySticker>): OverlaySticker {
  return {
    id: "sticker-1",
    mediaItemId: "media-1",
    position: { x: 50, y: 50 },
    size: { width: 20, height: 20 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    maintainAspectRatio: true,
    ...overrides,
  };
}

// Minimal StickerSourceForFilter factory
function createStickerSource(overrides?: Partial<StickerSourceForFilter>): StickerSourceForFilter {
  return {
    id: "sticker-1",
    path: "/tmp/sticker-1.png",
    x: 852,
    y: 432,
    width: 216,
    height: 216,
    startTime: 0,
    endTime: 10,
    zIndex: 1,
    opacity: 1,
    rotation: 0,
    ...overrides,
  };
}
```

### Canvas Mock Pattern (from existing `export-engine-remotion.test.ts`)

```typescript
function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    // ... other needed props
  } as unknown as CanvasRenderingContext2D;
}
```

---

## Files Summary

### New Test Files

| File | Subtask | Lines (est.) |
|------|---------|-------------|
| `apps/web/src/lib/__tests__/sticker-export-helper.test.ts` | 1 | ~250 |
| `apps/web/src/lib/__tests__/sticker-timing-consistency.test.ts` | 2 | ~150 |
| `apps/web/src/lib/__tests__/sticker-ffmpeg-filter.test.ts` | 3 | ~180 |
| `apps/web/src/lib/__tests__/sticker-sources.test.ts` | 4 | ~200 |

### Source Files Under Test

| File | What's Tested |
|------|--------------|
| `apps/web/src/lib/stickers/sticker-export-helper.ts` | Error handling, rendering, preloading, caching |
| `apps/web/src/lib/export-cli/sources/sticker-sources.ts` | Source extraction, timing defaults, download logic |
| `apps/web/src/lib/export-cli/filters/sticker-overlay.ts` | FFmpeg filter chain generation |
| `apps/web/src/lib/export-cli/types.ts` | `StickerSourceForFilter` interface (used in factories) |
| `apps/web/src/types/sticker-overlay.ts` | `OverlaySticker` type (used in factories) |

---

## Verification Matrix

Maps each test file to the root causes from `fix-sticker-overlay-export.md`:

| Root Cause | Test File | Key Tests |
|-----------|-----------|-----------|
| 1. Silent failure in canvas export | `sticker-export-helper.test.ts` | Error tracking, console.warn, result.failed array |
| 2. Timing data inconsistency | `sticker-timing-consistency.test.ts` | Default timing fallbacks, undefined handling |
| 3. Image loading race condition | `sticker-export-helper.test.ts` | preloadStickers, areStickersPreloaded, image cache |
| 4. No export verification | `sticker-export-helper.test.ts` | StickerRenderResult tracking, getLastRenderResult |
| 5. FFmpeg filter generation | `sticker-ffmpeg-filter.test.ts` | Timing enable clause, rotation, opacity, coordinates |

---

## Run Command

```bash
bun run test -- --run apps/web/src/lib/__tests__/sticker-export-helper.test.ts apps/web/src/lib/__tests__/sticker-timing-consistency.test.ts apps/web/src/lib/__tests__/sticker-ffmpeg-filter.test.ts apps/web/src/lib/__tests__/sticker-sources.test.ts
```

---

## Long-Term Considerations

1. **Regression safety**: These tests guard all 5 root causes — any future change to sticker export that re-introduces silent failures, timing inconsistency, or filter generation bugs will be caught
2. **Shared factories**: If sticker tests grow, extract `createMockSticker` and `createStickerSource` to `apps/web/src/lib/__tests__/test-utils/sticker-factories.ts`
3. **Integration test**: A future integration test could compose `extractStickerSources` → `buildStickerOverlayFilters` end-to-end with realistic data to verify the full pipeline
4. **Biome compliance**: Expand inline objects to multi-line format in `it.each` calls to satisfy Biome line length limits
