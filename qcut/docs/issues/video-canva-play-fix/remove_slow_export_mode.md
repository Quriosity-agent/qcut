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

**Option 1: Error on Unsupported Cases** ✅ **SELECTED**
- Throw descriptive errors when Mode 3 would have been used
- Guide users to simplify their timelines (remove images, fix overlaps, etc.)

---

## Option 1 Implementation Plan

### Overview

Remove Mode 3 (Image Pipeline) entirely and throw descriptive errors when unsupported timeline configurations are detected. This is the simplest approach that eliminates the slow export path while clearly communicating limitations to users.

### Architecture Changes

```
Current Flow:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Timeline    │ ──▶ │ Analysis    │ ──▶ │ Mode 1/2/3  │
│ Elements    │     │ Determines  │     │ Export      │
└─────────────┘     │ Mode        │     └─────────────┘
                    └─────────────┘

New Flow:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Timeline    │ ──▶ │ Validation  │ ──▶ │ Mode 1/1.5/2│
│ Elements    │     │ + Analysis  │     │ Export      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ Error if    │
                    │ Unsupported │
                    └─────────────┘
```

### Task 1: Define Unsupported Case Errors

**Purpose:** Create clear, actionable error messages for each unsupported case.

**Error Types:**

```typescript
// apps/web/src/lib/export-errors.ts

export class ExportUnsupportedError extends Error {
  constructor(
    public readonly reason: UnsupportedReason,
    public readonly userMessage: string,
    public readonly suggestion: string
  ) {
    super(userMessage);
    this.name = 'ExportUnsupportedError';
  }
}

export type UnsupportedReason =
  | 'image-elements'
  | 'overlapping-videos'
  | 'blob-urls'
  | 'complex-effects'
  | 'no-video-elements';

export const UNSUPPORTED_ERRORS: Record<UnsupportedReason, { message: string; suggestion: string }> = {
  'image-elements': {
    message: 'Image elements are not currently supported in export.',
    suggestion: 'Remove image elements from your timeline, or convert them to video clips using an external tool.',
  },
  'overlapping-videos': {
    message: 'Overlapping videos are not currently supported in export.',
    suggestion: 'Arrange your videos sequentially without overlaps, or trim clips so they don\'t overlap in time.',
  },
  'blob-urls': {
    message: 'Some media files could not be accessed for export.',
    suggestion: 'Re-import the media files from your local disk. Temporary or generated files may need to be saved first.',
  },
  'complex-effects': {
    message: 'Some effects are not supported in the current export mode.',
    suggestion: 'Remove or simplify effects on your clips. Basic color adjustments and text overlays are supported.',
  },
  'no-video-elements': {
    message: 'No video elements found in timeline.',
    suggestion: 'Add at least one video clip to your timeline before exporting.',
  },
};
```

### Task 2: Update Export Analysis

**Purpose:** Remove Mode 3 strategy and add validation that throws errors.

**File:** `apps/web/src/lib/export-analysis.ts`

**Changes:**

```typescript
// Remove "image-pipeline" from OptimizationStrategy type
export type OptimizationStrategy =
  | "direct-copy"           // Mode 1: Simple concat
  | "video-normalization"   // Mode 1.5: Normalize + concat
  | "direct-video-with-filters"; // Mode 2: FFmpeg filters

// Add validation function
export function validateTimelineForExport(elements: TimelineElement[]): void {
  const issues: UnsupportedReason[] = [];

  // Check for image elements
  const hasImageElements = elements.some(el => el.type === 'image');
  if (hasImageElements) {
    issues.push('image-elements');
  }

  // Check for overlapping videos
  const videoElements = elements.filter(el => el.type === 'video');
  if (hasOverlappingElements(videoElements)) {
    issues.push('overlapping-videos');
  }

  // Check for blob URLs without local paths
  const hasBlobUrls = elements.some(el => {
    if (el.type === 'video' || el.type === 'image') {
      const media = el as MediaElement;
      return media.src?.startsWith('blob:') && !media.localPath;
    }
    return false;
  });
  if (hasBlobUrls) {
    issues.push('blob-urls');
  }

  // Check for no video elements
  if (videoElements.length === 0) {
    issues.push('no-video-elements');
  }

  // Throw error if any issues found
  if (issues.length > 0) {
    const primaryIssue = issues[0];
    const errorInfo = UNSUPPORTED_ERRORS[primaryIssue];
    throw new ExportUnsupportedError(
      primaryIssue,
      errorInfo.message,
      errorInfo.suggestion
    );
  }
}

// Update analyzeTimeline to call validation
export function analyzeTimeline(elements: TimelineElement[]): ExportAnalysis {
  // Validate first - throws if unsupported
  validateTimelineForExport(elements);

  // Continue with normal analysis for Mode 1/1.5/2
  // ... existing analysis code ...
}
```

### Task 3: Update Export Engine

**Purpose:** Remove Mode 3 handling from CLIExportEngine.

**File:** `apps/web/src/lib/export-engine-cli.ts`

**Sections to Remove:**

1. **Lines 1462-1467** - Mode 3 detection:
```typescript
// REMOVE THIS BLOCK
if (this.exportAnalysis?.optimizationStrategy === "image-pipeline") {
  debugLog("[CLIExportEngine] 🎨 MODE 3: Frame rendering required");
  debugLog(`[CLIExportEngine] Reason: ${this.exportAnalysis.reason}`);
  progressCallback?.(15, "Rendering frames...");
  await this.renderFramesToDisk(progressCallback);
}
```

2. **Lines 1486-1491** - Mode 3 fallback:
```typescript
// REMOVE THIS BLOCK
} else {
  debugLog("[CLIExportEngine] ⚠️ Falling back to frame rendering");
  progressCallback?.(15, "Rendering frames...");
  await this.renderFramesToDisk(progressCallback);
}
```

3. **Lines 1493-1524** - Mode 3 error fallback:
```typescript
// REMOVE ENTIRE CATCH BLOCK that falls back to image-pipeline
```

4. **Lines 1613-1764** - Frame rendering methods:
```typescript
// REMOVE ENTIRE METHODS
private async renderFramesToDisk(...) { ... }
private async saveFrameToDisk(...) { ... }
```

5. **Lines 92-247** - Canvas rendering methods:
```typescript
// REMOVE ENTIRE METHODS
async renderFrame(...) { ... }
private async renderElementCLI(...) { ... }
private async renderMediaElementCLI(...) { ... }
private async renderVideoCLI(...) { ... }
private renderImageCLI(...) { ... }
private renderTextElementCLI(...) { ... }
private async renderStickerElementCLI(...) { ... }
```

6. **Lines 436-444** - Video cache:
```typescript
// REMOVE
const cliVideoCache: Map<string, HTMLVideoElement> = new Map();
```

### Task 4: Update FFmpeg Handler

**Purpose:** Remove frame-based FFmpeg logic.

**File:** `electron/ffmpeg-handler.ts`

**Sections to Remove:**

1. **Lines 129-133** - Remove `"image-pipeline"` from type:
```typescript
// Change from:
optimizationStrategy?: "image-pipeline" | "direct-copy" | "direct-video-with-filters" | "video-normalization";

// To:
optimizationStrategy?: "direct-copy" | "direct-video-with-filters" | "video-normalization";
```

2. **Lines 870-897** - Mode 3 frame validation:
```typescript
// REMOVE ENTIRE BLOCK
} else {
  // MODE 3: Frame-based mode - verify frames exist
  console.log("🎨 [MODE 3 VALIDATION] Validating frame files...");
  // ...
}
```

3. **Lines 2139-2299** - Frame-based FFmpeg args builder:
```typescript
// REMOVE ENTIRE SECTION
// Frame-based processing (normal path)
const inputPattern: string = path.join(inputDir, "frame-%04d.png");
// ...
```

### Task 5: Update UI Error Handling

**Purpose:** Display user-friendly errors in the export dialog.

**File:** `apps/web/src/components/export-dialog.tsx` (or similar)

**Implementation:**

```typescript
import { ExportUnsupportedError } from '@/lib/export-errors';

// In export handler
try {
  await exportEngine.export(progressCallback);
} catch (error) {
  if (error instanceof ExportUnsupportedError) {
    // Show user-friendly error dialog
    showExportErrorDialog({
      title: 'Export Not Supported',
      message: error.userMessage,
      suggestion: error.suggestion,
      reason: error.reason,
    });
  } else {
    // Handle other errors
    showGenericErrorDialog(error);
  }
}
```

**Error Dialog Component:**

```typescript
interface ExportErrorDialogProps {
  title: string;
  message: string;
  suggestion: string;
  reason: UnsupportedReason;
}

function ExportErrorDialog({ title, message, suggestion, reason }: ExportErrorDialogProps) {
  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle className="text-destructive">{title}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <p className="text-sm text-muted-foreground mb-4">{message}</p>
        <div className="bg-muted p-3 rounded-md">
          <p className="text-sm font-medium">💡 Suggestion:</p>
          <p className="text-sm text-muted-foreground">{suggestion}</p>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </Dialog>
  );
}
```

### Task 6: Remove Dead Code

**Purpose:** Clean up orphaned code after Mode 3 removal.

**Files to Evaluate:**

| File | Action |
|------|--------|
| `export-engine.ts` | Remove if only used for Mode 3 base class |
| `sticker-export-helper.ts` | Keep if used by Mode 2, remove `renderStickersToCanvas` |
| `effects-utils.ts` | Keep `applyEffectsToCanvas` only if used elsewhere |
| `effects-canvas-advanced.ts` | Remove if Canvas-only |

### Task 7: Update Tests

**File:** `apps/web/src/lib/__tests__/export-analysis.test.ts`

**Changes:**

```typescript
describe('Export Analysis', () => {
  describe('Validation', () => {
    it('should throw error for timelines with images', () => {
      const timeline = createTimelineWithImages();

      expect(() => analyzeTimeline(timeline)).toThrow(ExportUnsupportedError);
      expect(() => analyzeTimeline(timeline)).toThrow(/Image elements are not currently supported/);
    });

    it('should throw error for overlapping videos', () => {
      const timeline = createTimelineWithOverlaps();

      expect(() => analyzeTimeline(timeline)).toThrow(ExportUnsupportedError);
      expect(() => analyzeTimeline(timeline)).toThrow(/Overlapping videos are not currently supported/);
    });

    it('should throw error for blob URLs without local paths', () => {
      const timeline = createTimelineWithBlobUrls();

      expect(() => analyzeTimeline(timeline)).toThrow(ExportUnsupportedError);
      expect(() => analyzeTimeline(timeline)).toThrow(/could not be accessed/);
    });

    it('should throw error for empty timeline', () => {
      const timeline: TimelineElement[] = [];

      expect(() => analyzeTimeline(timeline)).toThrow(ExportUnsupportedError);
      expect(() => analyzeTimeline(timeline)).toThrow(/No video elements found/);
    });
  });

  describe('Mode Selection (supported cases)', () => {
    it('should select Mode 1 for simple sequential videos', () => {
      const timeline = createSimpleSequentialTimeline();
      const result = analyzeTimeline(timeline);

      expect(result.optimizationStrategy).toBe('direct-copy');
    });

    it('should select Mode 2 for videos with text overlays', () => {
      const timeline = createTimelineWithText();
      const result = analyzeTimeline(timeline);

      expect(result.optimizationStrategy).toBe('direct-video-with-filters');
    });
  });
});
```

---

### Implementation Order

| Phase | Task | Priority | Complexity |
|-------|------|----------|------------|
| 1 | Create export-errors.ts | High | Low |
| 1 | Update export-analysis.ts (validation) | High | Low |
| 2 | Update export-engine-cli.ts (remove Mode 3) | High | Medium |
| 2 | Update ffmpeg-handler.ts (remove frame logic) | High | Medium |
| 3 | Update UI error handling | Medium | Low |
| 4 | Remove dead code | Low | Low |
| 4 | Update tests | Low | Medium |

---

### Success Criteria

- [ ] `"image-pipeline"` strategy completely removed from codebase
- [ ] Clear error messages shown for unsupported timeline configurations
- [ ] All Mode 1, 1.5, 2 exports continue to work
- [ ] No Canvas rendering code remains in export path
- [ ] All tests pass with updated expectations
- [ ] Export dialog shows actionable suggestions for unsupported cases

---

### User Impact

**What Users Can Still Do:**
- Export sequential video clips (Mode 1)
- Export videos with different properties (Mode 1.5)
- Export videos with text overlays (Mode 2)
- Export videos with stickers (Mode 2)
- Export videos with basic effects (Mode 2)

**What Users Cannot Do (with clear errors):**
- Export timelines with image elements
- Export timelines with overlapping videos
- Export AI-generated/blob media without saving first

---

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

### ✅ Implemented Approach: **Option 1 - Error on Unsupported Cases**

Mode 3 (image-pipeline/Canvas frame rendering) has been **removed**. Unsupported timeline configurations now throw descriptive `ExportUnsupportedError` errors with actionable suggestions.

#### What Was Implemented

1. **Created `export-errors.ts`**
   - `ExportUnsupportedError` class with `reason`, `userMessage`, and `suggestion` properties
   - Clear error types: `image-elements`, `overlapping-videos`, `blob-urls`, `no-video-elements`

2. **Updated `export-analysis.ts`**
   - Removed `"image-pipeline"` from `OptimizationStrategy` type
   - Added `validateTimelineForExport()` function that throws errors for unsupported cases
   - Validation runs before mode selection

3. **Updated `export-engine-cli.ts`**
   - Removed all Canvas rendering methods
   - Removed frame-based export logic
   - Only supports Mode 1, 1.5, and 2

4. **Updated `ffmpeg-handler.ts`**
   - Removed `"image-pipeline"` from strategy type
   - Removed Mode 3 frame validation

#### Supported Export Modes

| Mode | Name | Use Case | Speed |
|------|------|----------|-------|
| **Mode 1** | Direct Copy | Single video, no overlays | 15-48x |
| **Mode 1.5** | Video Normalization | Multiple sequential videos | 5-7x |
| **Mode 2** | Direct Video with Filters | Text, stickers, effects | 3-5x |

#### Unsupported Cases (Throw Errors)

| Case | Error Message | Suggestion |
|------|---------------|------------|
| Image elements | "Image elements are not currently supported" | Remove images or convert to video |
| Overlapping videos | "Overlapping videos are not currently supported" | Arrange sequentially |
| Blob URLs | "Media files could not be accessed" | Re-import from local disk |
| No video elements | "No video elements found" | Add at least one video |

### 📋 Implementation Checklist

- [x] Remove `"image-pipeline"` from OptimizationStrategy type
- [x] Add validation that throws `ExportUnsupportedError` for unsupported cases
- [x] Remove Canvas rendering methods from `ExportEngineCLI`
- [x] Remove frame-based logic from `ffmpeg-handler.ts`
- [x] Update tests for new error behavior
- [x] All tests passing (11/11)
- [x] Lint and type checks passing

### 🔮 Future Enhancements (Option 2 Path)

If user demand requires supporting currently unsupported cases:

1. **FFmpeg overlay for images** - Use FFmpeg `-i image.png` + overlay filter
2. **FFmpeg complex filters for overlapping videos** - Use xstack filter
3. **Map Canvas effects to FFmpeg filters** - Audit and migrate effects

---

## Document Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-XX | 1.0 | Initial documentation - identified all Mode 3 code sections |
| 2025-01-XX | 1.1 | Added code review findings, verified line numbers, identified base class dependencies |
| 2025-11-25 | 2.0 | **Implementation complete** - Option 1 implemented, Mode 3 removed, documentation updated |

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
