# Sticker Overlay Export — Multiple Stickers

## Summary

Export all overlay stickers composited onto the video during FFmpeg export.
Multiple stickers must render at correct positions, sizes, timings, and z-order.

## Current State: What Already Works

The sticker export pipeline **is already implemented** for the primary export path (Mode 2):

| Component | File | Status |
|-----------|------|--------|
| Store export getter | `stores/stickers-overlay-store.ts:625` | Working |
| Source extraction (% → pixel) | `lib/export-cli/sources/sticker-sources.ts` | Working |
| Blob download to temp file | `sticker-sources.ts:63` via IPC `saveStickerForExport` | Working |
| FFmpeg filter_complex build | `electron/ffmpeg-args-builder.ts:279-316` | Working |
| Scale + rotation + opacity | `ffmpeg-args-builder.ts:285-304` | Working |
| Timed overlay (`enable='between(t,...)'`) | `ffmpeg-args-builder.ts:307-314` | Working |
| Mode demotion (stickers → Mode 2) | `export-engine-cli.ts:929-936` | Working |
| Unit tests | `lib/__tests__/sticker-sources.test.ts` | Working |

### Export Flow (Working Path)
```
getStickersForExport() → extractStickerSources() → downloadStickerToTemp()
  → buildStickerOverlayFilters() → exportOptions.stickerSources
  → electron IPC → buildCompositeEncodeArgs() → filter_complex → FFmpeg
```

### FFmpeg filter_complex Example (2 stickers)
```
[1:v]scale=162:162[sticker_scaled_0];
[sticker_scaled_0]rotate=45*PI/180:c=none[sticker_rotated_0];
[0:v][sticker_rotated_0]overlay=x=798:y=459:enable='between(t,0,5)'[v_sticker_0];
[2:v]scale=200:200[sticker_scaled_1];
[v_sticker_0][sticker_scaled_1]overlay=x=100:y=100:enable='between(t,2,8)'[v_sticker_1];
```

---

## Bugs & Gaps to Fix

### Bug 1: Word Filter Cuts + Stickers — Stickers Silently Dropped

**Severity**: High
**File**: `electron/ffmpeg-export-handler.ts:464-569`

When word filter cuts are active, `handleWordFilterCut()` builds its own `filter_complex` for segment cutting/concatenation. It does NOT include sticker inputs or overlay filters. Stickers are silently dropped.

**Root cause**: `handleWordFilterCut()` runs BEFORE `buildCompositeEncodeArgs()` and creates a completely separate FFmpeg command that ignores `stickerSources`.

**Fix**: Two-pass approach — first apply word filter cuts, then overlay stickers onto the cut result. Or merge sticker overlay filters into the word filter `filter_complex`.

### Bug 2: SVG Stickers May Not Render in FFmpeg

**Severity**: Medium
**File**: `lib/export-cli/sources/sticker-sources.ts:90`

SVG files saved with `format = blob.type.split("/")[1]` → `"svg+xml"` and stored as `.svg+xml` extension. FFmpeg's image decoder has limited SVG support (no CSS, no web fonts, basic rendering only). Most Iconify stickers are SVGs.

**Fix**: Rasterize SVG to PNG before passing to FFmpeg. Use Canvas API to render SVG → PNG at target pixel resolution during export.

### Bug 3: Sticker Aspect Ratio Distortion During Scale

**Severity**: Low
**File**: `electron/ffmpeg-args-builder.ts:286`

`scale=${sticker.width}:${sticker.height}` forces exact dimensions, ignoring the original image aspect ratio. If user resizes a sticker non-uniformly (e.g., stretches width but not height via edge handles), the sticker will appear distorted in export — which matches the preview. But if `maintainAspectRatio` is true in the store, export should also maintain it.

**Fix**: When `maintainAspectRatio` is true, use `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=0x00000000`.

---

## Subtasks

### Subtask 1: Rasterize SVG Stickers for FFmpeg Export
**Time**: ~15 min
**Priority**: High (most stickers are SVGs from Iconify)

**Files**:
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts` — add SVG rasterization before save
- `apps/web/src/lib/export-cli/sources/svg-rasterizer.ts` — new helper (Canvas → PNG)

**Implementation**:
1. In `downloadStickerToTemp()`, detect SVG content (`blob.type === "image/svg+xml"` or data URL starts with `data:image/svg+xml`)
2. Create an offscreen canvas at target pixel dimensions (use `pixelWidth` × `pixelHeight` from caller)
3. Draw SVG onto canvas via `Image` element with the SVG data URL
4. Export canvas as PNG blob
5. Send PNG bytes to `saveStickerForExport` with format `"png"` instead of `"svg+xml"`

**Test**: `apps/web/src/lib/__tests__/sticker-sources.test.ts` — add test for SVG → PNG conversion

### Subtask 2: Support Stickers in Word Filter Cut Mode
**Time**: ~25 min
**Priority**: Medium (only affects projects using both word filters AND stickers)

**Files**:
- `electron/ffmpeg-export-handler.ts` — modify `handleWordFilterCut()` to include sticker overlays
- `electron/ffmpeg-args-builder.ts` — extract sticker filter builder to reusable function

**Implementation**:
1. Pass `stickerSources` through to `handleWordFilterCut()` via `options`
2. After building the segment cut `filter_complex`, append sticker overlay filters
3. Add sticker file inputs (`-loop 1 -i`) alongside the main video input
4. Adjust input indices to account for sticker inputs
5. Chain sticker overlays after the concat output label

**Note**: For the fallback path (`handleWordFilterCutFallback` with >100 segments), apply stickers as a second FFmpeg pass on the concatenated output.

**Test**: Manual test — add stickers + word filters, export, verify stickers appear

### Subtask 3: Fix SVG File Extension in Temp Save
**Time**: ~5 min
**Priority**: High (quick fix, prevents `.svg+xml` extension)

**Files**:
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts:90`

**Implementation**:
1. Replace `const format = blob.type?.split("/")[1] || "png"` with proper format extraction:
   ```typescript
   let format = blob.type?.split("/")[1] || "png";
   if (format === "svg+xml") format = "svg";
   if (format === "jpeg") format = "jpg";
   ```
2. This is a stopgap — Subtask 1 (SVG rasterization) will convert SVGs to PNG anyway

**Test**: Existing tests cover this path

### Subtask 4: Pass `maintainAspectRatio` to Export Pipeline
**Time**: ~10 min
**Priority**: Low

**Files**:
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts` — include `maintainAspectRatio` in output
- `apps/web/src/lib/export-cli/types.ts` — add field to `StickerSourceForFilter`
- `electron/ffmpeg/types.ts` — add field to `StickerSource`
- `electron/ffmpeg-args-builder.ts` — use `force_original_aspect_ratio` when flag is true

**Test**: `apps/web/src/lib/__tests__/sticker-sources.test.ts` — verify field passthrough

---

## Implementation Order

1. **Subtask 3** (5 min) — Quick fix for file extension bug
2. **Subtask 1** (15 min) — SVG rasterization (critical for Iconify stickers)
3. **Subtask 2** (25 min) — Word filter + stickers interop
4. **Subtask 4** (10 min) — Aspect ratio preservation

Total estimated: ~55 min

## Architecture Notes

- **Timeline = source of truth for timing** (`getStickerTimingMap()` from sticker tracks)
- **Overlay store = source of truth for position/size** (percentage-based, 0-100)
- **Size uses `baseSize = min(canvasWidth, canvasHeight)`** not respective dimensions
- **Position is center-based** — converted to top-left for FFmpeg overlay x/y
- **zIndex determines layer order** — lower zIndex overlaid first (bottom), higher last (top)
- **Multiple stickers chain sequentially** in `filter_complex`: each overlay's output becomes the next overlay's video input
