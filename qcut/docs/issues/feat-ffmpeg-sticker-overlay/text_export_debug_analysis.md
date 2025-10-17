# Text Export Debug Analysis

## 1. What is Happening

Based on console logs from `text_export_console.md`, the text export process is working **CORRECTLY** but **SLOWLY** because it's using the **image pipeline** instead of direct copy optimization.

### Current Flow:
1. ✅ Text filter chain is generated successfully (line 418-421)
2. ✅ Text is being rendered by FFmpeg CLI drawtext (NOT canvas)
3. ❌ **SLOW**: 58 frames are being rendered to disk individually (line 354)
4. ✅ FFmpeg export completes in 2.89s (line 439)

### Key Evidence:
```
Line 355: Canvas text rendering: DISABLED (using FFmpeg)
Line 419: Text filter chain: drawtext=text='Default text':fontsize=48...
Line 421: Text will be rendered by FFmpeg CLI (not canvas)
Line 354: Starting frame rendering: 58 frames
```

---

## 2. Console Messages to Identify the Bug

### Add these console messages to track the slowdown:

#### A. Track why image pipeline is chosen (export-analysis.ts)
```typescript
// In analyzeTimelineForExport function
console.log('🔍 [EXPORT ANALYSIS BUG] Checking optimization eligibility:');
console.log(`   - Has text elements: ${hasTextElements}`);
console.log(`   - Has stickers: ${hasStickers}`);
console.log(`   - Has effects: ${hasEffects}`);
console.log(`   - Has image elements: ${hasImageElements}`);
console.log(`   - Multiple videos: ${hasMultipleVideoSources}`);
console.log(`   - Overlapping videos: ${hasOverlappingVideos}`);
console.log(`   - CAN use direct copy: ${canUseDirectCopy}`);
console.log(`   - REASON: ${reason}`);
```

**File**: `qcut/apps/web/src/lib/export-analysis.ts`

#### B. Track frame-by-frame rendering overhead (export-engine-cli.ts)
```typescript
// In renderFramesToDisk function
const renderStart = Date.now();

for (let frame = 0; frame < totalFrames; frame++) {
  const frameStart = Date.now();

  await this.renderFrame(currentTime);
  await this.saveFrameToDisk(frameName, currentTime);

  const frameTime = Date.now() - frameStart;

  // Log slow frames
  if (frameTime > 100) {
    console.warn(`⚠️ [FRAME RENDERING] Slow frame ${frame}: ${frameTime}ms`);
  }
}

const totalRenderTime = ((Date.now() - renderStart) / 1000).toFixed(2);
console.log(`⏱️ [FRAME RENDERING] Total frame rendering time: ${totalRenderTime}s`);
console.log(`⏱️ [FRAME RENDERING] Average per frame: ${(totalRenderTime * 1000 / totalFrames).toFixed(2)}ms`);
```

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts` (lines 1301-1332)

#### C. Track FFmpeg filter application (export-engine-cli.ts)
```typescript
// In exportWithCLI function, after building filter chains
console.log('🎬 [FILTER CHAIN DEBUG] ============================================');
console.log(`   - Video effects filter: ${combinedFilterChain || 'NONE'}`);
console.log(`   - Text overlay filter: ${textFilterChain || 'NONE'}`);
console.log(`   - Sticker overlay filter: ${stickerFilterChain || 'NONE'}`);
console.log(`   - Total filter complexity: ${(combinedFilterChain?.length || 0) + (textFilterChain?.length || 0) + (stickerFilterChain?.length || 0)} chars`);
console.log('🎬 [FILTER CHAIN DEBUG] ============================================');
```

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts` (after line 1637)

---

## 3. Why Text is NOT Rendered (Answer: IT IS!)

**Text IS being rendered correctly by FFmpeg drawtext filter.**

Evidence from console logs:
- Line 419: `Text filter chain: drawtext=text='Default text':fontsize=48:fontcolor=0xffffff:fontfile=C:/Windows/Fonts/arial.ttf...`
- Line 421: `Text will be rendered by FFmpeg CLI (not canvas)`
- Line 432: `Text elements: YES (using FFmpeg drawtext)`

### The confusion:
Text is rendered, but the export is slow because:
1. **58 frames are rendered individually** to PNG files (canvas → disk)
2. **Each frame is saved as a separate file** (slow I/O)
3. **FFmpeg then processes all 58 PNGs** + applies text filter
4. **Total time: 2.89s for 1.93s video** (frame rendering overhead)

---

## 4. Do We Use FFmpeg CLI for Text? Why So Slow?

### Yes, FFmpeg CLI is used for text rendering

**Process breakdown:**

```
Step 1: Frame Rendering (SLOW - 58 frames)
  ├─ Render frame 0 → save to disk (frame-0000.png)
  ├─ Render frame 1 → save to disk (frame-0001.png)
  ├─ ...
  └─ Render frame 57 → save to disk (frame-0057.png)
  Time: ~2-3 seconds for 58 frames

Step 2: FFmpeg Processing (FAST)
  ├─ Read all PNGs: ffmpeg -framerate 30 -i frame-%04d.png
  ├─ Apply text filter: drawtext=text='Default text'...
  └─ Encode to MP4: -c:v libx264 -crf 23
  Time: ~2.89s (includes frame reading)
```

### Why is it slow?

**Root Cause**: Image Pipeline Overhead

1. **Canvas Rendering**: Each frame is rendered on HTML canvas (even without text)
2. **PNG Encoding**: Each frame is converted to PNG (base64 → Buffer)
3. **Disk I/O**: 58 individual file writes
4. **FFmpeg Input**: Reading 58 PNG files from disk

### Optimization opportunity:

If we could use **direct copy mode**, the process would be:
```
Step 1: Direct Copy (FAST)
  └─ Use existing video file directly
  Time: 0s (no frame rendering)

Step 2: FFmpeg Processing (FAST)
  ├─ Copy video stream: -c:v copy
  ├─ Apply text overlay: -vf drawtext=...
  └─ Encode to MP4: -c:v libx264
  Time: ~0.5-1s
```

### Current limitation:

**Direct copy is disabled when text is present** (line 1663 in export-engine-cli.ts):
```typescript
useDirectCopy: !!(this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters)
```

This is by design because FFmpeg's `-c:v copy` (stream copy) cannot apply filters. When text/stickers are present, we MUST re-encode the video.

However, we could optimize by:
1. **Skipping frame rendering** if we have a single video source
2. **Using the video file directly** as FFmpeg input
3. **Applying text filter during encoding** (instead of reading PNGs)

---

## 5. Relevant File Paths

### Core Export Logic
- `qcut/apps/web/src/lib/export-engine-cli.ts` - Main CLI export engine (frame rendering, FFmpeg invocation)
- `qcut/apps/web/src/lib/export-analysis.ts` - Export optimization analysis (determines image vs direct copy)
- `qcut/apps/web/src/lib/export-engine-factory.ts` - Engine selection logic

### FFmpeg Integration
- `qcut/electron/ffmpeg-handler.ts` - Electron IPC handlers for FFmpeg operations
- `qcut/apps/web/src/types/electron.d.ts` - TypeScript definitions for Electron API

### Text Rendering
- `qcut/apps/web/src/lib/export-engine-cli.ts:672-726` - `buildTextOverlayFilters()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:549-666` - `convertTextElementToDrawtext()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:297-317` - `renderTextElementCLI()` function (canvas text - disabled)

### Frame Rendering
- `qcut/apps/web/src/lib/export-engine-cli.ts:1301-1332` - `renderFramesToDisk()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:1334-1439` - `saveFrameToDisk()` function

### Export Configuration
- `qcut/apps/web/src/lib/export-engine-cli.ts:1441-1729` - `exportWithCLI()` function
- `qcut/apps/web/src/hooks/use-export-progress.ts` - Export UI hook with engine selection

---

## Summary

| Aspect | Status | Details |
|--------|--------|---------|
| **Text rendering method** | ✅ Correct | Using FFmpeg drawtext filter (not canvas) |
| **Filter chain generation** | ✅ Working | Text filter properly generated |
| **Export completion** | ✅ Success | Video exported successfully |
| **Performance** | ❌ Slow | Image pipeline overhead (58 frame writes) |
| **Root cause** | Image pipeline | Direct copy disabled when text present |
| **Optimization needed** | Use video file directly | Skip frame rendering for single video + text |

### Recommendation:

Implement **hybrid optimization**: Use video file directly as FFmpeg input (instead of rendering frames) when:
- Single video source
- Text/sticker overlays present
- No video effects applied

This would eliminate frame rendering overhead while still allowing text/sticker filters.
