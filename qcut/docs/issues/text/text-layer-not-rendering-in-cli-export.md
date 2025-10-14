# Issue: Text Layers Not Rendering in CLI FFmpeg Export

**Status**: 🔴 Critical Issue
**Priority**: High
**Affects**: Electron users (desktop app)
**Created**: 2025-01-14

## Problem Summary

Text layers added to the timeline are **not being rendered** in the exported video when using the **CLI FFmpeg export engine** (Electron environment). Users can add text to their projects in the editor, but the text is completely missing from the final exported video.

## Root Cause

The CLI FFmpeg export engine (`export-engine-cli.ts`) uses native FFmpeg commands to quickly concatenate video and audio segments, but **does not implement text overlay functionality** using FFmpeg's `drawtext` filter. Text rendering is currently only implemented in the Canvas-based export engines (Standard and Optimized), which are slower but support full composition features.

## Solution

**FFmpeg has native `drawtext` filter support.** The proper fix is to implement text rendering in the CLI engine using FFmpeg's built-in `drawtext` filter. This maintains performance while adding full text support. See [implementation details](#solution) below.

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

## Solution

### Add FFmpeg Drawtext Filter Support to CLI Engine ⭐ **REQUIRED**

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

## Implementation Plan

**Implement FFmpeg Drawtext** - ~8-12 hours

### Phase 1: Convert Canvas/Timeline Text to FFmpeg Parameters (3-4 hours)

**Subtask 1.1: Analyze Current Canvas Text Rendering**
- Study how text is currently rendered in Canvas engines (`export-engine-optimized.ts` lines 363-400)
- Document text element properties: `content`, `x`, `y`, `fontSize`, `fontFamily`, `color`, `rotation`
- Understand how text timing works in timeline: `startTime`, `duration`, `trimStart`, `trimEnd`
- Map Canvas text properties to FFmpeg drawtext parameters

**Subtask 1.2: Create Text-to-FFmpeg Converter**
- Implement `convertTextElementToDrawtext()` function
- Convert text positioning: Canvas coordinates → FFmpeg x/y coordinates
- Convert text styling: Canvas font/color → FFmpeg fontsize/fontcolor/fontfile
- Handle text rotation: Canvas rotation → FFmpeg rotation parameter
- Add default values and fallbacks for missing properties

**Subtask 1.3: Handle Text Timing from Timeline**
- Extract text timing from timeline element: `element.startTime` and `element.duration`
- Convert timeline timestamps to FFmpeg `enable='between(t,start,end)'` filter
- Handle text trimming: account for `trimStart` and `trimEnd` in timing calculations
- Ensure timing matches what user sees in editor preview

### Phase 2: Build FFmpeg Filter Chain (2-3 hours)

**Subtask 2.1: Implement Filter Builder**
- Create `buildTextOverlayFilter()` method in CLI export engine
- Detect all text elements from timeline tracks
- Sort text layers by z-index/track order (bottom to top rendering)
- Generate drawtext filter for each text element
- Chain multiple filters using comma separation

**Subtask 2.2: Handle Special Characters**
- Implement `escapeTextForFFmpeg()` function
- Escape FFmpeg special characters: `\`, `'`, `:`, `[`, `]`
- Handle newlines in text content (`\n`)
- Support Unicode characters and emojis
- Test with various special characters

**Subtask 2.3: Handle Font Files**
- Map font family names to system font paths
- Windows fonts path: `C:/Windows/Fonts/`
- Handle common fonts: Arial, Times New Roman, Courier, etc.
- Provide fallback font if specified font not found
- Add font path resolution for Electron environment

### Phase 3: Integrate into CLI Export Engine (2-3 hours)

**Subtask 3.1: Detect Text Layers in Timeline**
- Scan timeline tracks for text elements before export
- Check if any text layers exist: `track.elements.some(el => el.type === "text")`
- Log text layer detection for debugging
- Store text elements for filter generation

**Subtask 3.2: Add Text Filters to FFmpeg Command**
- Locate where video filters are applied in CLI export engine
- Insert text overlay filters into FFmpeg filter chain
- Combine with existing filters (transitions, effects)
- Proper filter ordering: video effects → text overlays
- Handle case with no text layers (skip text filters)

**Subtask 3.3: Integration Testing**
- Test FFmpeg command generation with text filters
- Verify filter syntax is correct
- Test with actual FFmpeg CLI execution
- Debug any FFmpeg errors related to drawtext

### Phase 4: Testing & Validation (1-2 hours)

**Subtask 4.1: Basic Text Rendering Tests**
- [ ] Single text layer at fixed position
- [ ] Multiple text layers at different positions
- [ ] Overlapping text layers (z-index ordering)
- [ ] Text with different fonts and sizes
- [ ] Text with different colors

**Subtask 4.2: Text Timing Tests**
- [ ] Text appearing at specific time (startTime)
- [ ] Text disappearing at specific time (startTime + duration)
- [ ] Multiple text layers with different timing
- [ ] Text with trimStart/trimEnd applied

**Subtask 4.3: Special Cases**
- [ ] Text with special characters: quotes, colons, slashes
- [ ] Text with Unicode characters and emojis
- [ ] Text with newlines (multi-line text)
- [ ] Very long text content (>200 characters)
- [ ] Empty or whitespace-only text (should skip)

**Subtask 4.4: Integration Tests**
- [ ] Export video with text + video clips
- [ ] Export video with text + transitions
- [ ] Export video with text + video effects
- [ ] Verify text timing matches editor preview
- [ ] Compare output with Canvas engine (visual parity)

### Expected Code Structure

```typescript
// In export-engine-cli.ts

/**
 * Convert text element to FFmpeg drawtext filter
 */
private convertTextElementToDrawtext(element: TimelineElement): string {
  if (element.type !== "text" || !element.content?.trim()) return "";

  // Extract properties
  const text = this.escapeTextForFFmpeg(element.content);
  const x = element.x ?? 50;
  const y = element.y ?? 50;
  const fontSize = element.fontSize ?? 24;
  const fontColor = element.color ?? "white";
  const fontFamily = element.fontFamily ?? "Arial";

  // Resolve font file path
  const fontFile = this.resolveFontPath(fontFamily);

  // Calculate timing
  const startTime = element.startTime + (element.trimStart ?? 0);
  const endTime = startTime + element.duration - (element.trimEnd ?? 0);

  // Build drawtext filter
  return `drawtext=` +
    `fontfile='${fontFile}':` +
    `text='${text}':` +
    `fontsize=${fontSize}:` +
    `fontcolor=${fontColor}:` +
    `x=${x}:` +
    `y=${y}:` +
    `borderw=2:` +
    `bordercolor=black:` +
    `enable='between(t,${startTime},${endTime})'`;
}

/**
 * Build complete text overlay filter chain
 */
private buildTextOverlayFilter(tracks: TimelineTrack[]): string {
  const textElements: TimelineElement[] = [];

  // Collect all text elements from timeline
  for (const track of tracks) {
    for (const element of track.elements) {
      if (element.type === "text" && !element.hidden) {
        textElements.push(element);
      }
    }
  }

  if (textElements.length === 0) return "";

  // Sort by z-index/track order
  textElements.sort((a, b) => (a.startTime - b.startTime));

  // Convert each to drawtext filter
  const filters = textElements
    .map(el => this.convertTextElementToDrawtext(el))
    .filter(f => f !== "");

  return filters.join(',');
}

/**
 * Escape text for FFmpeg
 */
private escapeTextForFFmpeg(text: string): string {
  return text
    .replace(/\\/g, '\\\\')   // Escape backslash
    .replace(/'/g, "\\'")      // Escape single quote
    .replace(/:/g, '\\:')      // Escape colon
    .replace(/\[/g, '\\[')     // Escape left bracket
    .replace(/\]/g, '\\]');    // Escape right bracket
}

/**
 * Resolve font family to system font path
 */
private resolveFontPath(fontFamily: string): string {
  const fontMap: Record<string, string> = {
    'Arial': 'C:/Windows/Fonts/arial.ttf',
    'Times New Roman': 'C:/Windows/Fonts/times.ttf',
    'Courier New': 'C:/Windows/Fonts/cour.ttf',
    // Add more fonts as needed
  };

  return fontMap[fontFamily] || fontMap['Arial'];
}

/**
 * Integrate text filters into FFmpeg command
 */
async exportVideo(tracks: TimelineTrack[], ...): Promise<void> {
  // ... existing code ...

  // Build text overlay filters
  const textFilter = this.buildTextOverlayFilter(tracks);

  // Add to FFmpeg filter chain
  if (textFilter) {
    filterComplex += `,${textFilter}`;
  }

  // ... rest of export logic ...
}
```

**This is the complete solution.** Once implemented, the CLI engine will have full text support with native FFmpeg performance. Text rendering will match what users see in the canvas/timeline preview, with proper timing and styling.

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
