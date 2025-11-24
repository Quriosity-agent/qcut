# Remove Slow Export Mode (Mode 3 - Image Pipeline)

## Overview
Mode 3 "image-pipeline" is the slowest export mode that uses frame-by-frame rendering via Canvas API. This document identifies all relevant files and code sections that implement this mode.

## Export Mode Summary

### Current Export Modes
1. **Mode 1 - Direct Copy** (15-48x faster): Sequential videos with NO overlays, uses FFmpeg concat demuxer
2. **Mode 1.5 - Video Normalization** (5-7x faster): Videos with different properties, uses FFmpeg padding
3. **Mode 2 - Direct Video + Filters** (3-5x faster): Single video WITH text/stickers, uses FFmpeg filters
4. **Mode 3 - Image Pipeline** (baseline/slowest): Frame-by-frame Canvas rendering + FFmpeg encoding

### Mode 3 Triggers
Mode 3 is selected when:
- Images are present in the timeline
- Videos overlap in time (require compositing)
- Text needs frame rendering (not using FFmpeg drawtext)
- Stickers need frame rendering (not using FFmpeg overlay)
- Effects are present
- Videos lack local file paths (blob URLs)
- Optimization is explicitly disabled via feature flag

## Files to Modify

### 1. **apps/web/src/lib/export-analysis.ts** (Main Analysis Logic)

#### Sections to Remove/Modify:

**Lines 32-36** - Remove `"image-pipeline"` strategy type:
```typescript
/** Which export pipeline to use */
optimizationStrategy:
  | "image-pipeline"  // ← REMOVE THIS LINE
  | "direct-copy"
  | "direct-video-with-filters"
  | "video-normalization";
```

**Lines 504-524** - Remove Mode 3 selection logic:
```typescript
} else {
  // Mode 3: Frame rendering - slowest but most flexible
  optimizationStrategy = "image-pipeline";
  console.log(
    "🎨 [MODE DETECTION] Selected Mode 3: Frame rendering (baseline speed)"
  );

  // Log why Mode 3 was selected
  const reasons: string[] = [];
  if (hasImageElements) reasons.push("has image elements");
  if (hasTextElements && needsFrameRendering)
    reasons.push("text needs frame rendering");
  if (hasStickers && needsFrameRendering)
    reasons.push("stickers need frame rendering");
  if (hasEffects) reasons.push("has effects");
  if (hasOverlappingVideos) reasons.push("videos overlap");
  if (!allVideosHaveLocalPath) reasons.push("videos lack local paths");
  if (videoElementCount === 0) reasons.push("no video elements");

  console.log(`   Reasons: ${reasons.join(", ")}`);
}
```

**Lines 637-641** - Remove Mode 3 logging:
```typescript
} else {
  console.log(
    "🎨 [EXPORT ANALYSIS] MODE 3: Using IMAGE PIPELINE - Slow export (frame-by-frame)"
  );
}
```

**Action Required**: Replace Mode 3 fallback with error handling or force Mode 2/1.5 instead.

---

### 2. **apps/web/src/lib/export-engine-cli.ts** (Export Engine Implementation)

#### Sections to Remove:

**Lines 1462-1467** - Remove Mode 3 detection:
```typescript
if (this.exportAnalysis?.optimizationStrategy === "image-pipeline") {
  // Mode 3: Frame rendering required
  debugLog("[CLIExportEngine] 🎨 MODE 3: Frame rendering required");
  debugLog(`[CLIExportEngine] Reason: ${this.exportAnalysis.reason}`);
  progressCallback?.(15, "Rendering frames...");
  await this.renderFramesToDisk(progressCallback);
```

**Lines 1486-1491** - Remove Mode 3 fallback:
```typescript
} else {
  // Fallback to frame rendering
  debugLog("[CLIExportEngine] ⚠️ Falling back to frame rendering");
  progressCallback?.(15, "Rendering frames...");
  await this.renderFramesToDisk(progressCallback);
}
```

**Lines 1493-1524** - Remove Mode 3 error fallback:
```typescript
} catch (error) {
  // Fallback: Force image pipeline if optimization fails
  debugWarn(
    "[CLIExportEngine] ⚠️ Direct processing preparation failed, falling back to image pipeline:",
    error
  );

  // Safe default for exportAnalysis if it's null
  const analysisBase: ExportAnalysis = this.exportAnalysis || {
    // ... (entire fallback block)
  };

  // Force image processing
  this.exportAnalysis = {
    ...analysisBase,
    needsImageProcessing: true,
    canUseDirectCopy: false,
    optimizationStrategy: "image-pipeline",
    reason: "Fallback due to optimization error",
  };

  // Render frames as fallback
  progressCallback?.(15, "Rendering frames (fallback)...");
  await this.renderFramesToDisk(progressCallback);
}
```

**Lines 1613-1764** - Remove entire frame rendering implementation:
```typescript
private async renderFramesToDisk(
  progressCallback?: ProgressCallback
): Promise<void> {
  // ... entire method implementation (150+ lines)
}

private async saveFrameToDisk(
  frameName: string,
  currentTime: number
): Promise<void> {
  // ... entire method implementation
}
```

**Lines 92-247** - Remove Canvas rendering methods:
- `async renderFrame(currentTime: number): Promise<void>`
- `private async renderElementCLI(...)`
- `private async renderMediaElementCLI(...)`
- `private async renderVideoCLI(...)`
- `private renderImageCLI(...)`
- `private renderTextElementCLI(...)`
- `private async renderStickerElementCLI(...)`

**Action Required**: Remove all Canvas-based frame rendering code. Keep only Mode 1, 1.5, and 2 implementations.

---

### 3. **electron/ffmpeg-handler.ts** (Electron FFmpeg Handler)

#### Sections to Remove:

**Lines 870-897** - Remove Mode 3 frame validation:
```typescript
} else {
  // MODE 3: Frame-based mode - verify frames exist
  console.log("🎨 [MODE 3 VALIDATION] Validating frame files...");

  if (!fs.existsSync(frameDir)) {
    const error: string = `Frame directory does not exist: ${frameDir}`;
    console.error(`❌ [MODE 3 VALIDATION] ${error}`);
    reject(new Error(error));
    return;
  }

  const frameFiles: string[] = fs
    .readdirSync(frameDir)
    .filter(
      (f: string) => f.startsWith("frame-") && f.endsWith(".png")
    );

  if (frameFiles.length === 0) {
    const error: string = `No frame files found in: ${frameDir}`;
    console.error(`❌ [MODE 3 VALIDATION] ${error}`);
    reject(new Error(error));
    return;
  }

  console.log(
    `🎨 [MODE 3 VALIDATION] ✅ Found ${frameFiles.length} frame files`
  );
}
```

**Lines 2139-2299** - Remove frame-based FFmpeg args builder:
```typescript
// Frame-based processing (normal path)
const inputPattern: string = path.join(inputDir, "frame-%04d.png");

const args: string[] = [
  "-y", // Overwrite output
  "-framerate",
  String(fps),
  "-i",
  inputPattern,
];

// ... (entire frame-based args building logic - 160 lines)
```

**Lines 129-133** - Remove `"image-pipeline"` from OptimizationStrategy type:
```typescript
/** Optimization strategy for export mode selection (Mode 1, 1.5, 2, or 3) */
optimizationStrategy?:
  | "image-pipeline"  // ← REMOVE THIS LINE
  | "direct-copy"
  | "direct-video-with-filters"
  | "video-normalization";
```

**Action Required**: Remove frame-based validation and FFmpeg args building. Keep only Mode 1, 1.5, and 2 logic.

---

### 4. **apps/web/src/lib/__tests__/export-analysis.test.ts** (Tests)

#### Sections to Review:

Tests that verify Mode 3 behavior should be removed or updated to expect Mode 2/1.5 instead:
- Tests that check for `optimizationStrategy: "image-pipeline"`
- Tests that verify `needsImageProcessing: true`
- Tests that check fallback to frame rendering

**Action Required**: Update tests to expect Mode 2 or Mode 1.5 instead of Mode 3.

---

## Impact Analysis

### What Will Break:
1. **Image elements**: Currently no way to export images without Mode 3
2. **Overlapping videos**: Currently require compositing via Mode 3
3. **Blob URL videos**: Videos without localPath cannot use Modes 1/2
4. **Complex effects**: Some effects may only work with frame rendering

### Recommended Migration Path:

**Option 1: Error on Unsupported Cases**
- Throw descriptive errors when Mode 3 would have been used
- Guide users to simplify their timelines (remove images, fix overlaps, etc.)

**Option 2: Extend Mode 2 Capabilities**
- Add image support to Mode 2 via FFmpeg overlay filters
- Implement video compositing for overlaps in FFmpeg
- Convert blob URLs to temporary files for FFmpeg access

**Option 3: Keep Mode 3 for Specific Cases Only**
- Only allow Mode 3 for images + overlapping videos
- Force all other cases to use Mode 1/1.5/2
- Show warning when Mode 3 is used

## Recommended Implementation Order

1. **Update export-analysis.ts**
   - Remove `"image-pipeline"` strategy
   - Add error handling for unsupported cases
   - Update mode selection logic

2. **Update export-engine-cli.ts**
   - Remove Canvas rendering methods
   - Remove `renderFramesToDisk` and `saveFrameToDisk`
   - Remove Mode 3 fallback handling

3. **Update ffmpeg-handler.ts**
   - Remove frame validation logic
   - Remove frame-based FFmpeg args builder
   - Simplify `buildFFmpegArgs` to only handle Modes 1, 1.5, 2

4. **Update tests**
   - Remove Mode 3 test cases
   - Add tests for error handling on unsupported cases

5. **Update user-facing code**
   - Add validation before export starts
   - Show helpful error messages
   - Guide users to simplify timelines if needed

## Files Summary

| File | Lines to Remove/Modify | Impact |
|------|------------------------|--------|
| `apps/web/src/lib/export-analysis.ts` | 32-36, 504-524, 637-641 | Remove Mode 3 strategy type and selection logic |
| `apps/web/src/lib/export-engine-cli.ts` | 92-247, 1462-1524, 1613-1764 | Remove entire Canvas rendering implementation |
| `electron/ffmpeg-handler.ts` | 129-133, 870-897, 2139-2299 | Remove frame validation and frame-based FFmpeg logic |
| `apps/web/src/lib/__tests__/export-analysis.test.ts` | Multiple test cases | Update to expect Mode 2/1.5 instead of Mode 3 |

## Next Steps

1. ✅ **Document current state** (this file)
2. ⬜ **Choose migration path** (Option 1, 2, or 3 above)
3. ⬜ **Create subtasks** for each file modification
4. ⬜ **Implement changes** in recommended order
5. ⬜ **Update tests** to match new behavior
6. ⬜ **Test thoroughly** with various timeline configurations
7. ⬜ **Update user documentation** about export limitations
