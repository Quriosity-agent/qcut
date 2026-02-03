# Fix Sticker/Image Overlay Export Issue

## Problem Statement

Stickers and image overlays work correctly in the preview panel and timeline but fail to appear in exported videos. This affects both standard canvas export and CLI/FFmpeg export modes.

## Root Cause Analysis

### 1. Silent Failure in Canvas Export
- **File**: `apps/web/src/lib/stickers/sticker-export-helper.ts` (Line 57)
- **Issue**: Empty catch block silently ignores rendering errors
- **Impact**: Sticker rendering failures go unnoticed

### 2. Timing Data Inconsistency
- **Files**:
  - `apps/web/src/stores/stickers-overlay-store.ts` (Lines 627-636)
  - `apps/web/src/lib/export-cli/sources/sticker-sources.ts` (Lines 209-210)
- **Issue**: Different default behavior when `timing` field is undefined
- **Impact**: Stickers may appear at wrong times or not at all

### 3. Image Loading Race Condition
- **File**: `apps/web/src/lib/export-engine.ts` (Lines 566-635)
- **Issue**: No verification that sticker images are loaded before rendering
- **Impact**: Export may render empty frames where stickers should be

### 4. No Export Verification
- **Files**:
  - `apps/web/src/lib/export-engine.ts`
  - `apps/web/src/lib/export-engine-cli.ts`
- **Issue**: No confirmation that stickers actually rendered to each frame
- **Impact**: Silent failures with no diagnostic information

---

## Implementation Plan

**Estimated Total Time**: 45-60 minutes

---

### Subtask 1: Add Error Logging to Sticker Export Helper (10 min)

**Objective**: Replace silent failures with proper error handling and logging.

**Files to Modify**:
- `apps/web/src/lib/stickers/sticker-export-helper.ts`

**Changes**:
1. Add error logging in catch blocks instead of swallowing errors
2. Add `handleAIServiceError` or custom error handler for sticker rendering failures
3. Return success/failure status from `renderSticker()` method
4. Track and report failed sticker renders

**Implementation**:
```typescript
// Before (line 57):
} catch (error) {}

// After:
} catch (error) {
  console.warn(`[StickerExportHelper] Failed to render sticker ${sticker.id}:`, error);
  this.failedStickers.push({ id: sticker.id, error });
}
```

**Test File**: `apps/web/src/lib/__tests__/sticker-export-helper.test.ts`

---

### Subtask 2: Ensure Sticker Images Are Preloaded Before Export (15 min)

**Objective**: Guarantee all sticker images are loaded before export begins.

**Files to Modify**:
- `apps/web/src/lib/export-engine.ts`
- `apps/web/src/lib/stickers/sticker-export-helper.ts`

**Changes**:
1. Add `preloadStickerImages()` method that returns Promise
2. Call preload before export starts in `exportVideo()`
3. Create image cache to reuse loaded images across frames
4. Add timeout handling for slow image loads

**Implementation**:
```typescript
// New method in sticker-export-helper.ts
export async function preloadStickerImages(
  stickers: OverlaySticker[],
  mediaItemsMap: Map<string, MediaItem>
): Promise<Map<string, HTMLImageElement>> {
  const imageCache = new Map<string, HTMLImageElement>();

  await Promise.all(
    stickers.map(async (sticker) => {
      const mediaItem = mediaItemsMap.get(sticker.mediaId);
      if (!mediaItem?.url) return;

      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load: ${mediaItem.url}`));
        setTimeout(() => reject(new Error("Image load timeout")), 10000);
        img.src = mediaItem.url;
      });

      imageCache.set(sticker.id, img);
    })
  );

  return imageCache;
}
```

**Test File**: `apps/web/src/lib/__tests__/sticker-preload.test.ts`

---

### Subtask 3: Fix Timing Data Consistency (10 min)

**Objective**: Ensure consistent timing behavior across preview and export.

**Files to Modify**:
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts`
- `apps/web/src/stores/stickers-overlay-store.ts`

**Changes**:
1. Define explicit default timing constants
2. Apply same defaults in all code paths
3. Add `getEffectiveTiming()` utility function
4. Document timing behavior

**Implementation**:
```typescript
// New utility in stickers-overlay-store.ts or separate file
export const DEFAULT_STICKER_TIMING = {
  startTime: 0,
  endTime: Infinity, // Visible for entire video
};

export function getEffectiveTiming(
  sticker: OverlaySticker,
  totalDuration: number
): { startTime: number; endTime: number } {
  if (!sticker.timing) {
    return { startTime: 0, endTime: totalDuration };
  }
  return {
    startTime: sticker.timing.startTime ?? 0,
    endTime: sticker.timing.endTime ?? totalDuration,
  };
}
```

**Test File**: `apps/web/src/stores/__tests__/stickers-timing.test.ts`

---

### Subtask 4: Add Export Verification and Diagnostics (15 min)

**Objective**: Verify stickers render correctly and provide diagnostic information.

**Files to Modify**:
- `apps/web/src/lib/export-engine.ts`
- `apps/web/src/lib/export-engine-cli.ts`

**Changes**:
1. Add `verifyStickerRendered()` method that checks canvas pixels
2. Log sticker render status per frame (in debug mode)
3. Add summary report at end of export
4. Include sticker info in export progress callback

**Implementation**:
```typescript
// In export-engine.ts
private async renderOverlayStickers(currentTime: number): Promise<StickerRenderResult> {
  const result: StickerRenderResult = {
    attempted: 0,
    successful: 0,
    failed: [],
  };

  const visibleStickers = stickersStore.getVisibleStickersAtTime(currentTime);
  result.attempted = visibleStickers.length;

  for (const sticker of visibleStickers) {
    try {
      await this.renderStickerToCanvas(sticker);
      result.successful++;
    } catch (error) {
      result.failed.push({ id: sticker.id, error: String(error) });
    }
  }

  if (result.failed.length > 0) {
    console.warn(`[Export] ${result.failed.length}/${result.attempted} stickers failed at ${currentTime}s`);
  }

  return result;
}
```

**Test File**: `apps/web/src/lib/__tests__/export-sticker-verification.test.ts`

---

### Subtask 5: Fix FFmpeg Filter Generation for CLI Export (10 min)

**Objective**: Ensure FFmpeg overlay filters apply stickers correctly.

**Files to Modify**:
- `apps/web/src/lib/export-cli/filters/sticker-overlay.ts`
- `apps/web/src/lib/export-cli/sources/sticker-sources.ts`

**Changes**:
1. Verify coordinate transformation (center to top-left)
2. Fix timing expression for FFmpeg `enable` filter
3. Add filter validation before export
4. Log generated filter for debugging

**Implementation**:
```typescript
// In sticker-overlay.ts - validate filter before returning
export function generateStickerOverlayFilter(
  sticker: ExportStickerSource,
  inputLabel: string,
  outputLabel: string
): string {
  // Validate coordinates
  if (sticker.x < 0 || sticker.y < 0) {
    console.warn(`[StickerFilter] Negative coordinates for sticker ${sticker.id}`);
  }

  // Generate timing expression
  const timingExpr = sticker.startTime === 0 && sticker.endTime === Infinity
    ? "" // No timing constraint
    : `:enable='between(t,${sticker.startTime},${sticker.endTime})'`;

  const filter = `[${inputLabel}][sticker_${sticker.id}]overlay=${sticker.x}:${sticker.y}${timingExpr}[${outputLabel}]`;

  console.debug(`[StickerFilter] Generated: ${filter}`);
  return filter;
}
```

**Test File**: `apps/web/src/lib/__tests__/sticker-ffmpeg-filter.test.ts`

---

## Test Plan

### Unit Tests
1. `sticker-export-helper.test.ts` - Verify error handling
2. `sticker-preload.test.ts` - Verify image preloading
3. `stickers-timing.test.ts` - Verify timing consistency
4. `export-sticker-verification.test.ts` - Verify render verification
5. `sticker-ffmpeg-filter.test.ts` - Verify filter generation

### Integration Tests
1. Export video with single sticker - verify it appears
2. Export video with multiple stickers at different times
3. Export video with sticker that has no timing (should appear entire video)
4. Export video with invalid sticker image URL (should log error, not crash)

### Manual Testing
1. Add sticker in preview, verify in timeline, export, verify in output
2. Test both standard canvas export and CLI/FFmpeg export
3. Test with various sticker types (images, GIFs)

---

## Files Summary

### Modified Files
| File | Purpose |
|------|---------|
| `apps/web/src/lib/stickers/sticker-export-helper.ts` | Add error logging, image preloading |
| `apps/web/src/lib/export-engine.ts` | Add preloading, verification |
| `apps/web/src/lib/export-engine-cli.ts` | Add sticker diagnostics |
| `apps/web/src/lib/export-cli/sources/sticker-sources.ts` | Fix timing defaults |
| `apps/web/src/lib/export-cli/filters/sticker-overlay.ts` | Fix filter generation |
| `apps/web/src/stores/stickers-overlay-store.ts` | Add timing utility |

### New Test Files
| File | Purpose |
|------|---------|
| `apps/web/src/lib/__tests__/sticker-export-helper.test.ts` | Error handling tests |
| `apps/web/src/lib/__tests__/sticker-preload.test.ts` | Preloading tests |
| `apps/web/src/stores/__tests__/stickers-timing.test.ts` | Timing tests |
| `apps/web/src/lib/__tests__/export-sticker-verification.test.ts` | Verification tests |
| `apps/web/src/lib/__tests__/sticker-ffmpeg-filter.test.ts` | FFmpeg filter tests |

---

## Long-term Considerations

1. **Logging Infrastructure**: Consider adding a centralized logging service for export diagnostics
2. **Sticker Type Support**: Current fix focuses on images; ensure GIFs and videos work similarly
3. **Performance**: Image caching should be cleared after export to free memory
4. **Error Recovery**: Consider partial export success (export video even if some stickers fail)
5. **User Feedback**: Show sticker render status in export progress dialog

---

## Success Criteria

1. Stickers visible in preview appear correctly in exported video
2. Sticker timing matches between preview and export
3. Failed sticker renders are logged (not silent)
4. Both canvas and FFmpeg export modes work correctly
5. All new tests pass
