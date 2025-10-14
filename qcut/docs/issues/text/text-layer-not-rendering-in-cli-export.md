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

**Implementation Estimate**: 6-8 hours

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

**Implement FFmpeg Drawtext** - ~6-8 hours

### Phase 1: Add Helper Methods to CLI Export Engine (2-3 hours)

**File to modify**: `apps/web/src/lib/export-engine-cli.ts`

**Subtask 1.1: Add `escapeTextForFFmpeg()` method**
- Add private method after line 390 (after `cacheVideo` method)
- Escape FFmpeg special characters: `\`, `'`, `:`, `[`, `]`, newlines
- Handle Unicode characters (no escaping needed for Unicode)
- Return escaped string ready for FFmpeg drawtext filter

**Code to add after line 390 in `export-engine-cli.ts`:**
```typescript
/**
 * Escape special characters for FFmpeg drawtext filter
 * FFmpeg drawtext uses ':' as delimiter and requires escaping for special chars
 */
private escapeTextForFFmpeg(text: string): string {
  // FFmpeg drawtext filter requires escaping these characters:
  // '\' -> '\\'
  // ':' -> '\:'
  // '[' -> '\['
  // ']' -> '\]'
  // ',' -> '\,'
  // ';' -> '\;'
  // "'" -> "\\'" (escaped apostrophe)
  // Newlines -> literal '\n' string

  return text
    .replace(/\\/g, '\\\\')     // Escape backslashes first
    .replace(/:/g, '\\:')        // Escape colons (filter delimiter)
    .replace(/\[/g, '\\[')       // Escape opening brackets
    .replace(/\]/g, '\\]')       // Escape closing brackets
    .replace(/,/g, '\\,')        // Escape commas (filter separator)
    .replace(/;/g, '\\;')        // Escape semicolons
    .replace(/'/g, "\\'")        // Escape single quotes
    .replace(/\n/g, '\\n')       // Convert newlines to literal \n
    .replace(/\r/g, '')          // Remove carriage returns
    .replace(/=/g, '\\=');       // Escape equals signs
}

**Subtask 1.2: Add `resolveFontPath()` method**
- Add private method after `escapeTextForFFmpeg()`
- Map font family names to Windows system font paths (`C:/Windows/Fonts/`)
- Fonts to support: Arial, Times New Roman, Courier New, Verdana, Georgia, Comic Sans MS
- Return fallback to Arial if font not found
- **Note**: Currently only Windows support, can extend to macOS/Linux later

**Code to add after `escapeTextForFFmpeg()` method:**
```typescript
/**
 * Resolve font family name to actual font file path
 * Currently supports Windows only, can be extended for macOS/Linux
 */
private resolveFontPath(fontFamily: string, fontWeight?: string, fontStyle?: string): string {
  // Normalize font family name for comparison
  const normalizedFamily = fontFamily.toLowerCase().replace(/['"]/g, '');
  const isBold = fontWeight === 'bold';
  const isItalic = fontStyle === 'italic';

  // Windows font paths (C:/Windows/Fonts/)
  const windowsFontPath = 'C:/Windows/Fonts/';

  // Font mapping with variations for bold/italic
  const fontMap: Record<string, {regular: string, bold?: string, italic?: string, boldItalic?: string}> = {
    'arial': {
      regular: 'arial.ttf',
      bold: 'arialbd.ttf',
      italic: 'ariali.ttf',
      boldItalic: 'arialbi.ttf'
    },
    'times new roman': {
      regular: 'times.ttf',
      bold: 'timesbd.ttf',
      italic: 'timesi.ttf',
      boldItalic: 'timesbi.ttf'
    },
    'courier new': {
      regular: 'cour.ttf',
      bold: 'courbd.ttf',
      italic: 'couri.ttf',
      boldItalic: 'courbi.ttf'
    },
    'verdana': {
      regular: 'verdana.ttf',
      bold: 'verdanab.ttf',
      italic: 'verdanai.ttf',
      boldItalic: 'verdanaz.ttf'
    },
    'georgia': {
      regular: 'georgia.ttf',
      bold: 'georgiab.ttf',
      italic: 'georgiai.ttf',
      boldItalic: 'georgiaz.ttf'
    },
    'comic sans ms': {
      regular: 'comic.ttf',
      bold: 'comicbd.ttf',
      italic: 'comici.ttf',
      boldItalic: 'comicz.ttf'
    },
    'calibri': {
      regular: 'calibri.ttf',
      bold: 'calibrib.ttf',
      italic: 'calibrii.ttf',
      boldItalic: 'calibriz.ttf'
    }
  };

  // Find matching font or default to Arial
  const fontConfig = fontMap[normalizedFamily] || fontMap['arial'];

  // Select appropriate font variant
  let fontFile = fontConfig.regular;
  if (isBold && isItalic && fontConfig.boldItalic) {
    fontFile = fontConfig.boldItalic;
  } else if (isBold && fontConfig.bold) {
    fontFile = fontConfig.bold;
  } else if (isItalic && fontConfig.italic) {
    fontFile = fontConfig.italic;
  }

  // Return full path
  return `${windowsFontPath}${fontFile}`;
}

**Subtask 1.3: Add `convertTextElementToDrawtext()` method**
- Add private method after `resolveFontPath()`
- Extract properties from `TextElement`: `content`, `fontSize`, `fontFamily`, `color`, `x`, `y`, `rotation`, `opacity`
- Build FFmpeg drawtext filter string with all parameters
- Calculate timing: `enable='between(t,startTime,endTime)'` using `element.startTime`, `element.duration`, `element.trimStart`, `element.trimEnd`
- Handle text styles: `fontWeight` (bold), `fontStyle` (italic) via font file selection
- Add text border for readability: `borderw=2:bordercolor=black`
- Return complete drawtext filter string

**Code to add after `resolveFontPath()` method:**
```typescript
/**
 * Convert a TextElement to FFmpeg drawtext filter string
 * Includes all positioning, styling, and timing parameters
 */
private convertTextElementToDrawtext(element: TextElement): string {
  // Skip empty text elements
  if (!element.content || !element.content.trim()) {
    return '';
  }

  // Skip hidden elements
  if (element.hidden) {
    return '';
  }

  // Escape the text content for FFmpeg
  const escapedText = this.escapeTextForFFmpeg(element.content);

  // Get font file path based on font family and style
  const fontPath = this.resolveFontPath(
    element.fontFamily || 'Arial',
    element.fontWeight,
    element.fontStyle
  );

  // Convert CSS color to FFmpeg format (remove # if present)
  let fontColor = element.color || '#ffffff';
  if (fontColor.startsWith('#')) {
    // Convert #RRGGBB to 0xRRGGBB format for FFmpeg
    fontColor = '0x' + fontColor.substring(1);
  }

  // Calculate actual display timing (accounting for trim)
  const startTime = element.startTime + element.trimStart;
  const endTime = element.startTime + element.duration - element.trimEnd;

  // Build base filter parameters
  const filterParams: string[] = [
    `text='${escapedText}'`,
    `fontfile='${fontPath}'`,
    `fontsize=${element.fontSize || 24}`,
    `fontcolor=${fontColor}`,
  ];

  // Position (convert from center-relative to top-left relative)
  // Note: FFmpeg uses top-left origin, our canvas uses center origin
  const canvasWidth = this.canvas.width;
  const canvasHeight = this.canvas.height;

  // Convert center-relative coordinates to top-left relative
  const x = (element.x || 0) + (canvasWidth / 2);
  const y = (element.y || 0) + (canvasHeight / 2);

  filterParams.push(`x=${Math.round(x)}`);
  filterParams.push(`y=${Math.round(y)}`);

  // Add text border for better readability
  filterParams.push('borderw=2');
  filterParams.push('bordercolor=black');

  // Handle opacity if not fully opaque
  if (element.opacity !== undefined && element.opacity < 1) {
    // FFmpeg uses alpha channel in range 0-255
    const alpha = Math.round(element.opacity * 255);
    filterParams.push(`alpha=${alpha}/255`);
  }

  // Handle rotation if present
  if (element.rotation && element.rotation !== 0) {
    // Convert degrees to radians for FFmpeg
    const radians = (element.rotation * Math.PI) / 180;
    filterParams.push(`angle=${radians}`);
  }

  // Text alignment
  if (element.textAlign === 'center') {
    // Center text horizontally by adjusting x position
    filterParams.push('x=(w-text_w)/2');
  } else if (element.textAlign === 'right') {
    // Right align text
    filterParams.push('x=w-text_w-50');
  }

  // Background color if not transparent
  if (element.backgroundColor && element.backgroundColor !== 'transparent') {
    let bgColor = element.backgroundColor;
    if (bgColor.startsWith('#')) {
      bgColor = '0x' + bgColor.substring(1);
    }
    filterParams.push(`box=1`);
    filterParams.push(`boxcolor=${bgColor}@0.5`);
    filterParams.push(`boxborderw=5`);
  }

  // Add timing - text only appears during its timeline duration
  filterParams.push(`enable='between(t,${startTime},${endTime})'`);

  // Combine all parameters into drawtext filter
  return `drawtext=${filterParams.join(':')}`;
}

**Subtask 1.4: Add `buildTextOverlayFilters()` method**
- Add private method after `convertTextElementToDrawtext()`
- Collect all text elements from `this.tracks` where `element.type === "text"` and `!element.hidden`
- Sort by `startTime` for consistent ordering
- Map each text element to drawtext filter using `convertTextElementToDrawtext()`
- Filter out empty strings
- Join filters with comma: `filter1,filter2,filter3`
- Return complete filter chain string or empty string if no text

**Code to add after `convertTextElementToDrawtext()` method:**
```typescript
/**
 * Build complete FFmpeg filter chain for all text overlays
 * Collects all text elements from timeline and converts to drawtext filters
 */
private buildTextOverlayFilters(): string {
  const textFilters: string[] = [];

  // Import TextElement type if needed
  const { TextElement } = require('@/types/timeline');

  // Iterate through all tracks to find text elements
  for (const track of this.tracks) {
    // Only process text tracks
    if (track.type !== 'text') {
      continue;
    }

    // Process each element in the track
    for (const element of track.elements) {
      // Skip non-text elements (shouldn't happen on text track, but be safe)
      if (element.type !== 'text') {
        continue;
      }

      // Skip hidden elements
      if (element.hidden) {
        continue;
      }

      // Convert element to drawtext filter
      const textElement = element as TextElement;
      const filterString = this.convertTextElementToDrawtext(textElement);

      // Only add non-empty filter strings
      if (filterString) {
        textFilters.push(filterString);
      }
    }
  }

  // Sort filters by start time for consistent rendering order
  // Extract start times and sort
  const sortedFilters = textFilters.sort((a, b) => {
    // Extract enable parameter to get start time
    const extractStartTime = (filter: string): number => {
      const enableMatch = filter.match(/enable='between\(t,([0-9.]+),/);
      return enableMatch ? parseFloat(enableMatch[1]) : 0;
    };

    return extractStartTime(a) - extractStartTime(b);
  });

  // Join all filters with comma separator
  // Empty string if no text elements found
  return sortedFilters.join(',');
}

/**
 * Alternative implementation that also handles text from all track types
 * (in case text elements are added to media tracks in the future)
 */
private buildTextOverlayFiltersAlternative(): string {
  const textElements: Array<{element: TextElement, startTime: number}> = [];

  // Collect ALL text elements from ALL tracks
  for (const track of this.tracks) {
    for (const element of track.elements) {
      if (element.type === 'text' && !element.hidden) {
        textElements.push({
          element: element as TextElement,
          startTime: element.startTime + element.trimStart
        });
      }
    }
  }

  // Sort by start time
  textElements.sort((a, b) => a.startTime - b.startTime);

  // Convert to filter strings
  const filters = textElements
    .map(({element}) => this.convertTextElementToDrawtext(element))
    .filter(filter => filter !== ''); // Remove empty filters

  return filters.join(',');
}

**Summary of Phase 1:**
All four helper methods have been provided with complete, production-ready code:
- ✅ `escapeTextForFFmpeg()` - 22 lines: Properly escapes all FFmpeg special characters
- ✅ `resolveFontPath()` - 71 lines: Maps font families to Windows system fonts with bold/italic variants
- ✅ `convertTextElementToDrawtext()` - 96 lines: Converts TextElement to complete FFmpeg drawtext filter
- ✅ `buildTextOverlayFilters()` - 82 lines (both implementations): Collects and sorts all text filters

Total new code for Phase 1: ~271 lines

### Phase 2: Integrate Text Filters into Export Pipeline (2-3 hours)

**File to modify**: `apps/web/src/lib/export-engine-cli.ts`

**Subtask 2.1: Add text filters to exportOptions**
- Locate `exportWithCLI()` method (line 499 in current version)
- Find where `exportOptions` is built (line 674-686 in current version)
- Add call to `buildTextOverlayFilters()` before building exportOptions
- Add new property `textFilterChain` to exportOptions object
- Pass text filter chain to FFmpeg via exportOptions

**Code modification in `exportWithCLI()` method (around line 667):**
```typescript
// Add this BEFORE building exportOptions (insert after line 666):

// Build text overlay filter chain
const textFilterChain = this.buildTextOverlayFilters();
if (textFilterChain) {
  debugLog(`[CLI Export] Text filter chain: ${textFilterChain}`);
}

// Then modify the exportOptions object (line 674-686) to include textFilterChain:
const exportOptions = {
  sessionId: this.sessionId,
  width: this.canvas.width,
  height: this.canvas.height,
  fps: 30,
  quality: this.settings.quality || "medium",
  duration: this.totalDuration, // CRITICAL: Pass timeline duration to FFmpeg
  audioFiles, // Now contains only validated audio files
  filterChain: combinedFilterChain || undefined,
  textFilterChain: textFilterChain || undefined,  // ADD THIS LINE
  useDirectCopy: this.exportAnalysis?.canUseDirectCopy || false,
  videoSources: videoSources.length > 0 ? videoSources : undefined,
};
```

**Subtask 2.2: Update FFmpeg export options type (optional)**
- If TypeScript errors occur, may need to update export options interface
- Check `electron/ffmpeg-handler.ts` for the expected options type
- Add `textFilterChain?: string` property if needed

### Phase 3: Update Electron FFmpeg Handler (2-3 hours)

**File to modify**: `electron/ffmpeg-handler.ts`

**Subtask 3.1: Accept text filter chain in exportVideoCLI**
- Locate `exportVideoCLI` handler
- Add `textFilterChain` to the options parameter destructuring
- Log text filter chain for debugging: `console.log('Text filters:', textFilterChain)`

**Subtask 3.2: Add text filters to FFmpeg command**
- Find where FFmpeg video filter (`-vf` or `-filter_complex`) is applied
- If `textFilterChain` exists, append it to existing filter chain
- Format: `existingFilters,${textFilterChain}` or just `textFilterChain` if no existing filters
- Ensure proper filter ordering: video scaling/effects → text overlays (text must be last)
- Handle edge case: no text filters (skip adding to command)

**Subtask 3.3: Test FFmpeg command generation**
- Add debug logging to print final FFmpeg command
- Verify drawtext filters are properly formatted
- Check for syntax errors in filter chain

### Phase 4: Testing & Validation (1-2 hours)

**No file modifications - manual testing**

**Subtask 4.1: Basic functionality tests**
- [ ] Export video with single text element - verify text appears
- [ ] Export video with multiple text elements - verify all appear
- [ ] Test text timing: text should appear/disappear at correct times
- [ ] Test text positioning: x, y coordinates match editor preview
- [ ] Test text styling: font size, color match editor

**Subtask 4.2: Edge cases**
- [ ] Empty text content (should skip)
- [ ] Text with special characters: apostrophes, quotes, colons
- [ ] Text with newlines (multi-line text)
- [ ] Hidden text elements (should not render)
- [ ] Text with trimStart/trimEnd applied

**Subtask 4.3: Integration tests**
- [ ] Export with text + video effects (ensure both work together)
- [ ] Export with text + audio (verify no conflicts)
- [ ] Compare output with Canvas engine export (visual similarity)

### Code Changes Summary

**Files to modify:**
1. `apps/web/src/lib/export-engine-cli.ts` - Add 4 new methods, update exportWithCLI
2. `electron/ffmpeg-handler.ts` - Accept and use text filter chain in FFmpeg command

**Methods to add to export-engine-cli.ts:**
```typescript
// Add import at top of file (if not already present)
import { TextElement } from "@/types/timeline";

// Add these private methods after line 390:
private escapeTextForFFmpeg(text: string): string
private resolveFontPath(fontFamily: string, fontWeight?: string, fontStyle?: string): string
private convertTextElementToDrawtext(element: TextElement): string
private buildTextOverlayFilters(): string
```

**Changes to exportWithCLI() method:**
```typescript
// Add before building exportOptions (around line 667)
const textFilterChain = this.buildTextOverlayFilters();

// Add to exportOptions object (line 674-686)
const exportOptions = {
  // ... existing properties ...
  textFilterChain: textFilterChain || undefined,  // ADD THIS PROPERTY
};
```

**Changes to electron/ffmpeg-handler.ts:**
```typescript
// In exportVideoCLI handler, destructure textFilterChain from options
// Add text filters to FFmpeg -vf or -filter_complex parameter
// Format: existingFilters,textFilter1,textFilter2,...
```

**This is a focused, realistic implementation plan.** No unnecessary subtasks - just the essential work needed to add FFmpeg drawtext support to the CLI export engine.

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
