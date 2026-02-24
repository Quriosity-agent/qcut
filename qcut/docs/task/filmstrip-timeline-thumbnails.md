# Filmstrip Timeline Thumbnails

**Status**: Implemented
**Estimated effort**: ~3-4 hours (multi-subtask)
**Priority**: High — core UX improvement for professional editing experience

## Problem

Currently, QCut displays a **single thumbnail frame** (captured at ~1s or 10% of duration) tiled repeatedly across the entire clip width on the timeline. Every tile shows the **same image**, regardless of position within the clip. Professional editors (Premiere Pro, DaVinci Resolve, CapCut) show **different frames at different positions** — a filmstrip view that lets users visually locate scenes without scrubbing.

Additionally, the current tiles are a fixed pixel size (`trackHeight × 16/9`) and don't respond to zoom changes — more tiles simply become visible or hidden. The filmstrip should **recalculate which frames to show** when the user zooms in/out or stretches a clip, so the visual always maps to the actual video content at that position.

## Current Implementation

| File | Role |
|------|------|
| `apps/web/src/components/editor/timeline/timeline-element.tsx:399-451` | Video clip rendering with tiled single thumbnail |
| `apps/web/src/stores/media/media-store.ts:236-331` | `generateVideoThumbnailBrowser()` — captures ONE frame via canvas |
| `apps/web/src/lib/ffmpeg/ffmpeg-utils.ts:497-578` | `generateThumbnail()` — FFmpeg fallback, also ONE frame |
| `apps/web/src/hooks/timeline/use-frame-cache.ts` | Frame cache (for preview, not timeline thumbnails) |
| `apps/web/src/hooks/timeline/use-timeline-zoom.ts` | Zoom state management |
| `apps/web/src/constants/timeline-constants.ts` | `PIXELS_PER_SECOND: 50`, zoom levels, track heights |

### Current tile rendering (timeline-element.tsx:419-451):
```tsx
// Single image tiled across entire clip width
backgroundImage: `url(${mediaItem.thumbnailUrl})`,
backgroundRepeat: "repeat-x",
backgroundSize: `${tileWidth}px ${tileHeight}px`,
```

## Architecture

### Design Principles
1. **Progressive enhancement** — show single-frame tile immediately, replace with filmstrip frames as they load
2. **Lazy extraction** — only extract frames for clips visible in the viewport
3. **Zoom-aware** — recalculate visible frame count when zoom changes
4. **Memory-bounded** — cap total cached thumbnails with LRU eviction
5. **Offscreen extraction** — use OffscreenCanvas / Web Worker to avoid blocking UI

### Frame Extraction Strategy
- Use **browser HTML5 `<video>` + `<canvas>`** (not FFmpeg) for speed
- Create a hidden `<video>` element per media item, seek to target times, capture frames
- Extract frames at **thumbnail resolution** (e.g., 160×90 for 16:9) to minimize memory
- Store as **Blob URLs** (not data URLs) to reduce string allocation

### How Many Frames to Extract
```
clipWidthPx = effectiveDuration × PIXELS_PER_SECOND × zoomLevel
tileWidth = (trackHeight - 8) × (16/9) ≈ 101px
visibleTiles = Math.ceil(clipWidthPx / tileWidth)
```

For a 30s clip at 1× zoom: `30 × 50 / 101 ≈ 15 tiles → 15 frames`
At 0.25× zoom: `30 × 50 × 0.25 / 101 ≈ 4 frames`
At 3× zoom: `30 × 50 × 3 / 101 ≈ 45 frames`

### Frame Time Calculation
Each tile `i` maps to a video time:
```
trimmedDuration = duration - trimStart - trimEnd
frameTime = trimStart + (i / visibleTiles) × trimmedDuration
```
This ensures trimmed regions are excluded and frames align to actual video content.

---

## Subtasks

### Subtask 1: Create filmstrip thumbnail extraction service

**Files**:
- `apps/web/src/lib/filmstrip/filmstrip-extractor.ts` (new)
- `apps/web/src/lib/filmstrip/filmstrip-cache.ts` (new)

**Description**:
Build a service that extracts multiple frames from a video file at specified timestamps.

**Requirements**:
- `extractFrames(file: File, timestamps: number[], width: number, height: number): Promise<Map<number, string>>`
  - Returns `Map<quantizedTime, blobUrl>`
  - Uses a single hidden `<video>` element per extraction batch
  - Seeks sequentially to each timestamp (seeking is async)
  - Captures via `OffscreenCanvas` or regular `<canvas>`
  - Output as Blob URLs at thumbnail resolution (160×90 default)
- `FilmstripCache` class:
  - Key: `${mediaId}:${quantizedTime}:${resolution}`
  - LRU eviction with configurable max entries (default: 500)
  - `get(mediaId, time)` / `set(mediaId, time, blobUrl)` / `evict(mediaId)`
  - Revoke Blob URLs on eviction to prevent memory leaks
- Queue system: max 2 concurrent extraction jobs to avoid starving the main thread
- Abort support: cancel in-flight extractions when clip is removed or zoom changes rapidly

**Tests**:
- `apps/web/src/lib/filmstrip/__tests__/filmstrip-extractor.test.ts`
  - Mock `<video>` and `<canvas>` elements
  - Verify correct timestamps are sought
  - Verify Blob URL creation and cleanup on eviction
  - Verify queue limits concurrent jobs to 2
  - Verify abort cancels pending extractions

---

### Subtask 2: Create `useFilmstripThumbnails` React hook

**Files**:
- `apps/web/src/hooks/timeline/use-filmstrip-thumbnails.ts` (new)

**Description**:
React hook that computes which frames are needed for a clip at the current zoom level and triggers extraction.

**Requirements**:
```ts
interface UseFilmstripOptions {
  mediaId: string;
  file: File | undefined;
  duration: number;
  trimStart: number;
  trimEnd: number;
  zoomLevel: number;
  trackHeight: number;
  clipWidthPx: number;
  enabled: boolean; // false for non-video or loading states
}

interface FilmstripResult {
  frames: Array<{ time: number; url: string | null }>;
  isLoading: boolean;
  tileWidth: number;
}
```

- Compute `visibleTiles` from `clipWidthPx / tileWidth`
- Compute frame timestamps accounting for `trimStart` / `trimEnd`
- Debounce recalculation on zoom change (150ms) to avoid thrashing during scroll-zoom
- Return array of `{ time, url }` where `url` is null until extracted (allows progressive rendering)
- Memoize frame list — only re-extract when `visibleTiles` count changes or `mediaId` changes
- Clean up Blob URLs when component unmounts

**Tests**:
- `apps/web/src/hooks/timeline/__tests__/use-filmstrip-thumbnails.test.ts`
  - Verify correct frame count at different zoom levels
  - Verify frame timestamps respect trim values
  - Verify debounce prevents rapid re-extraction
  - Verify cleanup on unmount

---

### Subtask 3: Update timeline-element.tsx to render filmstrip

**Files**:
- `apps/web/src/components/editor/timeline/timeline-element.tsx` (modify lines ~399-451)

**Description**:
Replace the single-image CSS tiling with individual filmstrip frame tiles.

**Requirements**:
- Import and use `useFilmstripThumbnails` hook
- Replace the CSS `background-image: repeat-x` approach with a **flex row of individual `<div>` tiles**
- Each tile renders its own `backgroundImage` from the filmstrip frame array
- Tiles where `url === null` (still loading) fall back to `mediaItem.thumbnailUrl` (single frame)
- Keep the existing overlay grid pattern for visual separation
- Preserve existing loading/fallback states (pending, no thumbnail)
- Pass `zoomLevel` from the timeline context (it's already available via props or context)

**Rendering approach**:
```tsx
<div className="absolute top-3 bottom-3 left-0 right-0 flex flex-row overflow-hidden">
  {frames.map((frame, i) => (
    <div
      key={`${frame.time}-${i}`}
      style={{
        width: tileWidth,
        height: tileHeight,
        backgroundImage: `url(${frame.url || mediaItem.thumbnailUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        flexShrink: 0,
      }}
    />
  ))}
</div>
```

**Tests**:
- `apps/web/src/components/editor/timeline/__tests__/timeline-element-filmstrip.test.ts`
  - Verify filmstrip tiles render with unique images
  - Verify fallback to single thumbnail when frames not yet loaded
  - Verify correct tile count matches zoom level
  - Verify loading state still displays correctly

---

### Subtask 4: Zoom/stretch responsiveness

**Files**:
- `apps/web/src/hooks/timeline/use-filmstrip-thumbnails.ts` (modify)
- `apps/web/src/components/editor/timeline/timeline-element.tsx` (modify)

**Description**:
Ensure filmstrip thumbnails update correctly when the user zooms the timeline or stretches/trims a clip.

**Requirements**:
- When zoom level changes:
  - Debounce (150ms) before recalculating frame count
  - If new frame count differs from current, trigger new extraction
  - Reuse cached frames where timestamps match (within quantization threshold)
- When clip is trimmed/stretched:
  - Recalculate frame timestamps based on new `trimStart`/`trimEnd`
  - Existing frames with matching timestamps remain; new ones are extracted
- Performance target: filmstrip should visually update within 300ms of zoom stop
- During rapid zoom: show current frames (may be wrong count) until debounce settles

**Tests**:
- Covered by subtask 2 tests (zoom recalculation, debounce behavior)
- Additional integration test: verify frame reuse on small zoom changes

---

### Subtask 5: Viewport-aware lazy loading

**Files**:
- `apps/web/src/hooks/timeline/use-filmstrip-thumbnails.ts` (modify)
- `apps/web/src/components/editor/timeline/timeline-element.tsx` (modify)

**Description**:
Only extract filmstrip frames for clips currently visible in the viewport. Off-screen clips keep their single-thumbnail fallback.

**Requirements**:
- Use `IntersectionObserver` on each timeline element to detect visibility
- Pass `enabled: isVisible` to `useFilmstripThumbnails`
- When a clip scrolls out of view, keep cached frames but don't extract new ones
- When a clip scrolls into view, trigger extraction if not already cached
- Priority queue: clips near the center of the viewport extract first

**Tests**:
- `apps/web/src/hooks/timeline/__tests__/use-filmstrip-thumbnails.test.ts`
  - Mock IntersectionObserver
  - Verify extraction pauses when not visible
  - Verify extraction resumes when visible again

---

## File Impact Summary

| File | Change |
|------|--------|
| `apps/web/src/lib/filmstrip/filmstrip-extractor.ts` | **New** — frame extraction service |
| `apps/web/src/lib/filmstrip/filmstrip-cache.ts` | **New** — LRU cache for filmstrip Blob URLs |
| `apps/web/src/hooks/timeline/use-filmstrip-thumbnails.ts` | **New** — React hook |
| `apps/web/src/components/editor/timeline/timeline-element.tsx` | **Modify** — replace tiled background with filmstrip |
| `apps/web/src/lib/filmstrip/__tests__/filmstrip-extractor.test.ts` | **New** — unit tests |
| `apps/web/src/hooks/timeline/__tests__/use-filmstrip-thumbnails.test.ts` | **New** — hook tests |
| `apps/web/src/components/editor/timeline/__tests__/timeline-element-filmstrip.test.ts` | **New** — component tests |

## Non-Goals (for this task)
- Waveform thumbnails for audio clips (already handled separately)
- Image clip filmstrip (images are static — single tile is correct)
- Server-side / Electron-process frame extraction (browser API is sufficient)
- Prefetching frames for off-screen clips (lazy loading handles this)

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Memory pressure from many Blob URLs | LRU cache with 500 entry cap + Blob URL revocation |
| Seek latency on large video files | Progressive rendering — show single frame while loading |
| Main thread blocking during extraction | OffscreenCanvas if available, requestIdleCallback scheduling |
| Rapid zoom thrashing | 150ms debounce on recalculation |
| Trim changes invalidating all frames | Quantize timestamps — reuse frames within tolerance |
