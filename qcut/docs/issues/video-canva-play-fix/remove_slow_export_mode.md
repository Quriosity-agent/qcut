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

### 5. **apps/web/src/lib/export-engine.ts** (Base Export Engine) ⚠️ **IMPORTANT**

#### Additional Canvas Rendering Methods to Consider:

The base `ExportEngine` class (which `CLIExportEngine` extends) also contains Canvas rendering methods that are inherited:

**Key Methods in Base Class:**
- `async renderFrame(currentTime: number): Promise<void>` (line ~195)
- `private async renderElement(...)` (line ~233)
- `private async renderImage(...)` (line ~270)
- `private async renderVideo(...)` (line ~374)
- `private async renderVideoAttempt(...)` (line ~412)
- `private renderTextElement(...)` (line ~637)
- `async renderOverlayStickers(...)` (uses `renderStickersToCanvas` helper)

**Decision Required:**
- If Mode 3 is completely removed, these base class methods become dead code
- Options:
  1. Remove the entire `ExportEngine` base class if only `CLIExportEngine` is used
  2. Keep the base class for potential future use cases
  3. Extract only the non-Canvas methods into a shared utility class

**Dependencies:**
- `@/lib/stickers/sticker-export-helper` - `renderStickersToCanvas` function
- `@/lib/effects-utils` - `applyEffectsToCanvas`, `resetCanvasFilters`, `mergeEffectParameters`
- `@/lib/effects-canvas-advanced` - `applyAdvancedCanvasEffects`

---

## Code Review Findings

### ✅ Verified Sections (Accurate Line Numbers)

**export-analysis.ts:**
- ✅ Line 33: `"image-pipeline"` strategy type confirmed
- ✅ Lines 504-524: Mode 3 selection logic verified
- ✅ Lines 637-641: Mode 3 logging confirmed

**export-engine-cli.ts:**
- ✅ Line 64: Class declaration `export class CLIExportEngine extends ExportEngine`
- ✅ Line 93: `async renderFrame(currentTime: number)` method starts
- ✅ Lines 1462-1467: Mode 3 detection logic confirmed
- ✅ Line 1613: `renderFramesToDisk` method starts
- ✅ Lines 1486-1491: Mode 3 fallback confirmed

**ffmpeg-handler.ts:**
- ✅ Lines verified through code inspection

### ⚠️ Additional Considerations Discovered

1. **Parent Class Dependency:**
   - `CLIExportEngine` extends `ExportEngine`
   - Base class has extensive Canvas rendering infrastructure
   - Need to decide if base class should be kept or removed

2. **Feature Flag System:**
   - `localStorage.getItem("qcut_skip_export_optimization") === "true"` allows forcing Mode 3
   - This feature flag check at line ~1406 in export-engine-cli.ts should be removed

3. **Debug Mode:**
   - Line 1563 in export-engine-cli.ts: `const DEBUG_MODE = true;`
   - Prevents cleanup of temp frames for inspection
   - Should be removed or set to false when Mode 3 is removed

4. **Effect System Integration:**
   - Effects use Canvas rendering via `applyEffectsToCanvas`
   - Need to verify if all effects can work with FFmpeg filters
   - Some effects may only work with Canvas API

5. **Video Cache:**
   - Lines 436-444 in export-engine-cli.ts: `cliVideoCache` for frame rendering
   - This cache becomes unnecessary without Mode 3

### 🔍 Code Quality Issues Found

1. **Inconsistent Error Handling:**
   - Some fallback paths silently switch to Mode 3
   - Should throw descriptive errors instead

2. **Mixed Responsibilities:**
   - `CLIExportEngine` handles both Canvas rendering AND FFmpeg CLI orchestration
   - After Mode 3 removal, could be simplified to FFmpeg-only

3. **Dead Code After Removal:**
   - Entire `ExportEngine` base class may become unused
   - Helper utilities for Canvas effects will be orphaned
   - Video cache system becomes redundant

### 📊 Dependency Graph

```
Mode 3 (Image Pipeline) Dependencies:
├── export-analysis.ts
│   └── Determines when Mode 3 is needed
├── export-engine-cli.ts (CLIExportEngine)
│   ├── renderFrame() - Main Canvas rendering
│   ├── renderFramesToDisk() - Writes frames to disk
│   ├── saveFrameToDisk() - Saves individual frames
│   └── Canvas rendering methods (7 methods)
├── export-engine.ts (Base ExportEngine)
│   ├── renderFrame() - Base implementation
│   ├── renderElement() - Element rendering
│   ├── renderImage() - Image rendering
│   ├── renderVideo() - Video rendering
│   └── renderTextElement() - Text rendering
├── Helper Libraries
│   ├── sticker-export-helper.ts - renderStickersToCanvas()
│   ├── effects-utils.ts - applyEffectsToCanvas()
│   └── effects-canvas-advanced.ts - applyAdvancedCanvasEffects()
└── ffmpeg-handler.ts
    ├── Frame validation logic
    └── Frame-based FFmpeg args builder
```

### 🎯 Complete File List

| File | Purpose | Action Required |
|------|---------|----------------|
| `export-analysis.ts` | Mode detection | Remove Mode 3 strategy |
| `export-engine-cli.ts` | CLI export with Canvas | Remove Canvas methods |
| `export-engine.ts` | Base class with Canvas | ⚠️ Evaluate if needed |
| `ffmpeg-handler.ts` | Electron FFmpeg handler | Remove frame validation |
| `sticker-export-helper.ts` | Canvas sticker rendering | ⚠️ May become unused |
| `effects-utils.ts` | Canvas effects | ⚠️ Check if still needed |
| `effects-canvas-advanced.ts` | Advanced Canvas effects | ⚠️ Check if still needed |
| `export-analysis.test.ts` | Tests | Update expectations |

### ⚡ Performance Impact

**Current State (with Mode 3):**
- Image elements: 5-10s export time (Mode 3)
- Overlapping videos: 5-10s export time (Mode 3)
- Simple timeline: 0.1-0.5s (Mode 1)

**After Removal:**
- Image elements: ❌ **Export will fail** (no Mode 3)
- Overlapping videos: ❌ **Export will fail** (no Mode 3)
- Simple timeline: ✅ 0.1-0.5s (Mode 1 unchanged)

### 🚨 Critical Breaking Changes

1. **Image Support Lost:**
   - PNG/JPG images in timeline will cause export to fail
   - Need alternative: FFmpeg overlay filter support

2. **Overlapping Video Compositing Lost:**
   - Videos that overlap in time will cause export to fail
   - Need alternative: FFmpeg complex filter graphs

3. **Blob URL Support Lost:**
   - Generated/AI images with blob URLs will fail
   - Need alternative: Download blobs to temp files for FFmpeg

4. **Some Effects May Break:**
   - Canvas-only effects won't have FFmpeg equivalent
   - Need audit of all effects to verify FFmpeg compatibility

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
2. ✅ **Code review completed** (verified all line numbers and dependencies)
3. ⬜ **Choose migration path** (Option 1, 2, or 3 above)
4. ⬜ **Decide on base class** (Keep, Remove, or Refactor `ExportEngine`)
5. ⬜ **Audit effects system** (Verify FFmpeg compatibility)
6. ⬜ **Create subtasks** for each file modification
7. ⬜ **Implement changes** in recommended order
8. ⬜ **Update tests** to match new behavior
9. ⬜ **Test thoroughly** with various timeline configurations
10. ⬜ **Update user documentation** about export limitations

---

## Final Recommendations

### 🎯 Recommended Approach: **Option 2 Extended** (Most User-Friendly)

Instead of completely removing Mode 3, **extend Mode 2 capabilities** to handle the cases currently requiring Mode 3:

#### Phase 1: Immediate (Low-hanging fruit)
1. **Add FFmpeg overlay support for images**
   - Download image blobs to temp files
   - Use FFmpeg `-i image.png` + overlay filter
   - Works for static images on timeline

2. **Improve error messages**
   - Detect unsupported cases before export starts
   - Show clear error: "Overlapping videos not yet supported"
   - Provide actionable guidance

#### Phase 2: Medium-term (More complex)
3. **Add FFmpeg complex filter graphs for overlapping videos**
   - Research FFmpeg xstack filter for multi-video compositing
   - Implement for 2-3 video overlap scenarios
   - More complex than Mode 3 but still faster

4. **Migrate Canvas effects to FFmpeg filters**
   - Audit all effects in effects-store
   - Map Canvas filters to FFmpeg equivalents
   - Document effects that cannot be migrated

#### Phase 3: Long-term (Optional)
5. **Remove Mode 3 infrastructure**
   - Only after Phases 1-2 prove stable
   - Keep as deprecated fallback for 1-2 releases
   - Clean up dead code

### ⚠️ What NOT to Do

1. **Don't remove Mode 3 immediately** - Too many breaking changes
2. **Don't keep silent fallbacks** - Users need to know when/why Mode 3 is used
3. **Don't ignore the base class** - `ExportEngine` may be used elsewhere

### 📋 Checklist Before Removal

- [ ] All image overlay cases work with FFmpeg filters
- [ ] All overlapping video cases work with complex filters
- [ ] All effects have FFmpeg equivalents OR clear error messages
- [ ] Blob URLs are downloaded to temp files automatically
- [ ] Tests cover all edge cases
- [ ] User documentation is updated
- [ ] Export UI shows clear errors for unsupported cases
- [ ] Migration guide exists for users with Mode 3 timelines

---

## Document Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-XX | 1.0 | Initial documentation - identified all Mode 3 code sections |
| 2025-01-XX | 1.1 | Added code review findings, verified line numbers, identified base class dependencies |

---

## Questions for Product/Engineering

1. **How many users currently use image elements in timelines?**
   - If high usage: Prioritize FFmpeg overlay implementation
   - If low usage: Consider blocking/warning

2. **How many users have overlapping videos?**
   - Complex to implement in FFmpeg
   - May need to keep Mode 3 for this case

3. **What is the priority: Speed vs Features?**
   - Speed-focused: Remove Mode 3, accept limited features
   - Feature-focused: Keep Mode 3, optimize it instead

4. **Are there analytics on Mode 3 usage?**
   - Add telemetry to track Mode 3 usage before removal
   - Understand real-world impact

---

## Additional Resources

- **FFmpeg Overlay Documentation**: https://ffmpeg.org/ffmpeg-filters.html#overlay-1
- **FFmpeg Complex Filters**: https://trac.ffmpeg.org/wiki/FilteringGuide
- **Canvas to FFmpeg Filter Mapping**: (TODO: Create this guide)
- **Performance Benchmarks**: (TODO: Benchmark Mode 2 vs Mode 3 with various scenarios)
