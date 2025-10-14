# Issue: Text Layers Not Rendering in CLI FFmpeg Export

**Status**: 🔴 Critical Issue
**Priority**: High
**Affects**: Electron users (desktop app)
**Created**: 2025-01-14

## Problem Summary

Text layers added to the timeline are **not being rendered** in the exported video when using the **CLI FFmpeg export engine** (Electron environment). Users can add text to their projects in the editor, but the text is completely missing from the final exported video.

## Root Cause

The CLI FFmpeg export engine (`export-engine-cli.ts`) uses native FFmpeg commands to quickly concatenate video and audio segments, but **does not implement text overlay functionality**. Text rendering is only implemented in the Canvas-based export engines (Standard and Optimized), which are slower but support full composition features.

### Current Engine Selection Logic

```typescript
// From export-engine-factory.ts lines 96-110
if (this.isElectron() && !forceRegularEngine) {
  // Electron environment - automatically uses CLI FFmpeg
  return {
    engineType: ExportEngineType.CLI,
    reason: "Electron environment - using native CLI FFmpeg for best performance and stability",
    capabilities,
    estimatedPerformance: "high",
  };
}
```

**The Issue**: CLI engine is automatically selected for Electron users for performance, but it skips all text layer processing.

## Technical Details

### Where Text Rendering Works

**Canvas-based engines** (`export-engine-optimized.ts` lines 363-400):
```typescript
// Batch render text elements
private renderTextBatch(
  textBatch: TimelineElement[],
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
): void {
  // Group by similar styling to reduce context changes
  const styleGroups = new Map<string, TimelineElement[]>();

  for (const element of textBatch) {
    if (element.type !== "text") continue;

    const styleKey = `${element.fontFamily}-${element.fontSize}-${element.color}`;
    if (!styleGroups.has(styleKey)) {
      styleGroups.set(styleKey, []);
    }
    styleGroups.get(styleKey)!.push(element);
  }

  // Render each style group
  for (const [styleKey, elements] of styleGroups) {
    const firstElement = elements[0];
    if (firstElement.type !== "text") continue;

    // Set style once for the group
    ctx.fillStyle = firstElement.color || "#ffffff";
    ctx.font = `${firstElement.fontSize || 24}px ${firstElement.fontFamily || "Arial"}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Render all elements with this style
    for (const element of elements) {
      if (element.type !== "text" || !element.content?.trim()) continue;
      const x = element.x || 50;
      const y = element.y || 50;
      ctx.fillText(element.content, x, y);
    }
  }
}
```

### Where Text Rendering is Missing

**CLI FFmpeg engine** (`export-engine-cli.ts`):
- ❌ **No text layer detection**
- ❌ **No FFmpeg drawtext filter usage**
- ❌ **No text overlay composition**
- Only handles: video/audio concatenation, transitions, and video effects

## Impact

### User Experience
- **Severe usability issue**: Users add text layers that appear in the editor preview but disappear in the final export
- **No warning or error**: The export completes "successfully" but text is silently omitted
- **Data loss**: User's creative work (text content, positioning, styling) is lost

### Affected Workflows
1. Video with title cards or captions
2. Tutorial videos with text overlays
3. Social media content with branded text
4. Any project using the text layer feature

## Reproduction Steps

1. Create a new project in QCut (Electron/desktop app)
2. Add a video to the timeline
3. Add a text layer with content (e.g., "Hello World")
4. Position and style the text layer
5. Export the video
6. **Result**: Exported video contains no text - only the original video

## Current Workaround

Users can force the Canvas-based export engine by setting a localStorage flag:

```javascript
// In Browser DevTools Console
localStorage.setItem('qcut_force_regular_engine', 'true');
```

**From `export-engine-factory.ts` lines 87-94:**
```typescript
// DEBUG OVERRIDE: Allow forcing regular engine for sticker debugging
const forceRegularEngine =
  localStorage.getItem("qcut_force_regular_engine") === "true";

if (forceRegularEngine) {
  debugLog(
    "[ExportEngineFactory] 🔧 DEBUG OVERRIDE: Forcing regular export engine"
  );
}
```

### Limitations of Workaround
- **Not user-friendly**: Requires technical knowledge
- **Performance cost**: Canvas engines are significantly slower (10-20x slower for large projects)
- **Not persistent**: Must be set every time the app restarts
- **Hidden feature**: Not documented or exposed in UI

## Proposed Solutions

### Solution 1: Add FFmpeg Drawtext Filter Support to CLI Engine ⭐ **REQUIRED & RECOMMENDED**

**This is the proper solution.** FFmpeg has native `drawtext` filter support that can handle text overlays efficiently. Implement this filter in the CLI export engine to render text layers directly via FFmpeg commands.

**Why This is the Best Solution:**
- ✅ **FFmpeg natively supports text rendering** - No need for Canvas fallbacks
- ✅ **Maintains CLI engine performance** - Native FFmpeg rendering is fast
- ✅ **Proper architecture** - Keeps all rendering in one pipeline
- ✅ **Feature-complete for 90% of use cases** - Handles positioning, styling, timing, animations
- ✅ **No engine switching needed** - CLI engine remains the default for Electron

**FFmpeg Drawtext Capabilities:**
```bash
# Basic text with positioning
drawtext=text='Hello World':fontsize=24:fontcolor=white:x=100:y=100

# Text with outline and shadow
drawtext=text='Title':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:shadowx=2:shadowy=2

# Centered text
drawtext=text='Centered':x=(w-text_w)/2:y=(h-text_h)/2

# Timed text (show only during specific duration)
drawtext=text='Intro':enable='between(t,0,5)'

# Custom font
drawtext=fontfile=/path/to/font.ttf:text='Custom Font':fontsize=36

# Multiple text layers (chain filters)
drawtext=text='Top':y=50,drawtext=text='Bottom':y=h-50
```

**What FFmpeg Can Do:**
- ✅ Custom fonts (via fontfile parameter)
- ✅ Font size, color, positioning
- ✅ Text borders/outlines
- ✅ Text shadows
- ✅ Background boxes
- ✅ Text timing (show/hide at specific times)
- ✅ Dynamic text (timestamps, frame numbers)
- ✅ Text animation (movement, fade in/out)
- ✅ Multiple text layers
- ✅ Special characters and Unicode

**Implementation Requirements:**
1. Parse text elements from timeline tracks
2. Convert text properties to FFmpeg drawtext parameters
3. Build filter chain for multiple text layers
4. Handle text timing (enable/disable based on startTime/duration)
5. Escape special FFmpeg characters in text content
6. Handle font file paths (system fonts in Electron)

**Implementation Estimate**: 8-12 hours

**Example Implementation:**
```typescript
// In export-engine-cli.ts
private buildTextOverlayFilter(textElements: TimelineElement[]): string {
  const drawTextFilters: string[] = [];

  for (const element of textElements) {
    if (element.type !== "text" || !element.content) continue;

    const escapedText = this.escapeTextForFFmpeg(element.content);

    const filter = `drawtext=` +
      `text='${escapedText}':` +
      `fontsize=${element.fontSize || 24}:` +
      `fontcolor=${element.color || 'white'}:` +
      `x=${element.x || 50}:` +
      `y=${element.y || 50}:` +
      `borderw=2:bordercolor=black:` +
      `enable='between(t,${element.startTime},${element.startTime + element.duration})'`;

    drawTextFilters.push(filter);
  }

  return drawTextFilters.join(',');
}
```

### Solution 2: Hybrid Export Mode

Use CLI engine for video/audio processing, then add a Canvas-based text overlay pass.

**Pros:**
- Best of both worlds (speed + full text features)
- Maintains Canvas text rendering capabilities

**Cons:**
- Complex architecture (two-pass export)
- Slower than pure CLI (but faster than pure Canvas)
- Increased code complexity

**Implementation Estimate**: 12-16 hours

### Solution 3: Automatic Engine Fallback Detection

Detect if timeline contains text layers and automatically fallback to Canvas engine.

**Pros:**
- Simple implementation
- Zero configuration needed
- Clear logic

**Cons:**
- Performance hit for projects with text
- Users lose CLI speed benefits
- No middle ground

**Implementation Estimate**: 2-4 hours

**Example implementation:**
```typescript
async getEngineRecommendation(
  settings: ExportSettings,
  duration: number,
  tracks: TimelineTrack[] // NEW: Add tracks parameter
): Promise<EngineRecommendation> {
  // Check if any tracks contain text elements
  const hasTextLayers = tracks.some(track =>
    track.elements.some(el => el.type === "text")
  );

  if (this.isElectron() && !forceRegularEngine && !hasTextLayers) {
    // Use CLI engine only if no text layers
    return {
      engineType: ExportEngineType.CLI,
      reason: "Electron environment - using CLI FFmpeg (no text layers)",
      capabilities,
      estimatedPerformance: "high",
    };
  }

  if (hasTextLayers) {
    debugLog("[ExportEngineFactory] Text layers detected - using Canvas engine");
    // Fall through to Canvas engine selection
  }

  // ... rest of engine selection logic
}
```

### Solution 4: Add User Setting for Engine Selection

Add UI option to let users choose between "Fast Export" (CLI, no text) and "Full Quality Export" (Canvas, with text).

**Pros:**
- User control
- Clear expectations
- Simple implementation

**Cons:**
- Requires UI changes
- User must understand trade-offs
- May confuse users

**Implementation Estimate**: 4-6 hours

## Recommended Implementation Plan

**Phase 1: Implement FFmpeg Drawtext (Solution 1)** - ~8-12 hours ⭐ **PRIMARY SOLUTION**
1. Add text element detection in CLI export engine
2. Implement `buildTextOverlayFilter()` method to generate drawtext filters
3. Implement `escapeTextForFFmpeg()` for special character handling
4. Add text timing support using `enable='between(t,start,end)'`
5. Handle font paths for system fonts in Electron
6. Build filter chain for multiple text layers
7. Integrate text filters into existing FFmpeg command pipeline
8. Test with various text layer configurations:
   - Single text layer
   - Multiple overlapping text layers
   - Different fonts, sizes, colors
   - Special characters and Unicode
   - Text timing and animations

**This is the complete solution.** Once implemented, the CLI engine will have full text support with native FFmpeg performance. No fallbacks or engine switching needed.

## Related Files

- **Export Engine Factory**: `apps/web/src/lib/export-engine-factory.ts`
- **CLI Export Engine**: `apps/web/src/lib/export-engine-cli.ts`
- **Optimized Export Engine**: `apps/web/src/lib/export-engine-optimized.ts`
- **Standard Export Engine**: `apps/web/src/lib/export-engine.ts`
- **Export Dialog**: `apps/web/src/components/export-dialog.tsx`

## Testing Checklist

- [ ] Export video with single text layer
- [ ] Export video with multiple text layers at different times
- [ ] Export video with overlapping text layers
- [ ] Export video with various text styles (fonts, sizes, colors)
- [ ] Export video with special characters in text
- [ ] Export video with very long text content
- [ ] Test in Electron environment
- [ ] Test in browser environment
- [ ] Verify no performance regression
- [ ] Verify text timing accuracy

## Additional Notes

### Why CLI Engine Was Chosen

The CLI FFmpeg engine was implemented for performance reasons:
- **10-20x faster** than Canvas rendering for large projects
- **Lower memory usage** (no frame-by-frame Canvas compositing)
- **Better stability** (native FFmpeg is battle-tested)
- **Essential for longer videos** (>5 minutes)

### Why This Wasn't Caught Earlier

1. **Recent feature addition**: Text layers may have been added after CLI engine
2. **Separate code paths**: Canvas and CLI engines developed independently
3. **Limited testing**: May not have tested text layers in Electron environment
4. **Silent failure**: No error thrown, just missing text in output

### Similar Issues to Watch For

- **Stickers/overlays**: CLI engine may also skip sticker layers
- **Drawing annotations**: CLI engine doesn't support canvas drawings
- **Custom effects**: Any Canvas-only features will be missing in CLI export

---

**Last Updated**: 2025-01-14
**Assignee**: TBD
**Related Issues**: None yet
