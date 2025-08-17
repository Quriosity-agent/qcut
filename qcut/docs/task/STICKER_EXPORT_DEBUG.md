# Sticker Export Debug Guide

**Problem**: Preview sticker works but exporting sticker doesn't work

## Current Status (Updated)

✅ **FIXES APPLIED**:
- Fixed double filtering bug in `sticker-export-helper.ts` 
- Added detailed debug logging to export engine
- Fixed SVG sticker preview issue (data URLs vs blob URLs)
- Enhanced error logging with sticker details

❌ **STILL BROKEN**: Stickers show in preview but NOT in exported video frames

## Updated Issue Analysis

Based on testing, the issue persists even after fixes. **Stickers appear correctly in preview but are missing from each exported frame**. This suggests the problem is in the frame-by-frame rendering during export, not in sticker detection.

## Root Causes (Updated with Source Code Analysis)

### 1. **Export Engine Integration** ✅ Has Error Handling
- **Location**: `apps/web/src/lib/export-engine.ts:384-413`
- **Current Code**: Export engine calls `renderOverlayStickers()` with try/catch that continues export on failure
- **Issue**: Errors are silently caught and logged, stickers may fail without stopping export
- **Problem**: Need to identify WHY stickers fail during export (not IF they fail)

### 2. **Sticker Helper Export** ⚠️ Double Filtering Issue
- **Location**: `apps/web/src/lib/stickers/sticker-export-helper.ts:31-74`
- **Issue**: `renderStickersToCanvas()` filters stickers by time AGAIN even though export engine already does this
- **Problem**: Double filtering in `StickerExportHelper.renderStickersToCanvas()` (lines 40-44) and `useStickersOverlayStore.getVisibleStickersAtTime()` (lines 581-590)

### 3. **Store State Access** ✅ Implementation Looks Correct
- **Location**: `apps/web/src/stores/stickers-overlay-store.ts:581-590`
- **Implementation**: `getVisibleStickersAtTime()` filters by timing and sorts by z-index
- **Logic**: `time >= startTime && time <= endTime` with defaults `startTime = 0, endTime = Infinity`
- **Status**: Logic appears correct, unlikely to be the root cause

## Frame-by-Frame Export Debugging

### URGENT: Track Each Frame Sticker Rendering

The issue is that stickers are being detected but not drawn to each frame. We need to verify sticker rendering happens on every frame:

```typescript
// ENHANCED DEBUG: Add to export-engine.ts renderFrame() method around line 667
debugLog(`[FRAME_DEBUG] Frame ${frame + 1}/${totalFrames} at time ${currentTime.toFixed(3)}s`);

// ENHANCED DEBUG: In renderOverlayStickers method (already added)
debugLog(`[STICKER_FRAME] Frame time: ${currentTime.toFixed(3)}s`);
debugLog(`[STICKER_FRAME] Found ${visibleStickers.length} stickers for this frame`);
debugLog(`[STICKER_FRAME] Sticker IDs:`, visibleStickers.map(s => s.id));

// ENHANCED DEBUG: In sticker-export-helper.ts renderSticker method  
debugLog(`[STICKER_DRAW] Drawing sticker ${sticker.id} at (${x.toFixed(1)}, ${y.toFixed(1)}) size ${width.toFixed(1)}x${height.toFixed(1)}`);
debugLog(`[STICKER_DRAW] Image loaded:`, img.complete, 'Image src:', img.src.substring(0, 50) + '...');

// ENHANCED DEBUG: After canvas drawImage call
debugLog(`[STICKER_DRAW] ✅ Drew sticker ${sticker.id} to canvas`);
```

### Canvas Validation for Each Frame

Add canvas content verification to ensure stickers are actually drawn:

```typescript
// ENHANCED DEBUG: Add after renderOverlayStickers call in renderFrame
const imageData = this.ctx.getImageData(0, 0, 100, 100); // Sample top-left corner
const hasContent = Array.from(imageData.data).some((value, index) => 
  index % 4 !== 3 && value > 10 // Check RGB channels, ignore alpha
);
debugLog(`[FRAME_CANVAS] Frame ${frame + 1} has visible content:`, hasContent);
```

## Debugging Steps (Updated)

### Step 1: ✅ COMPLETED - Export Logs Added
Debug logging has been implemented and shows sticker detection.

### Step 2: ✅ COMPLETED - Detailed Logging Added  
Enhanced debug logging shows stickers are found during export.

### Step 3: ✅ COMPLETED - Double Filtering Fixed
Removed redundant filtering in sticker-export-helper.ts.

### Step 4: 🔍 ACTIVE - Frame-by-Frame Analysis
**Current Focus**: Verify stickers are actually drawn to canvas on each frame.

**Check these logs during export**:
- `[FRAME_DEBUG]` - Frame progression
- `[STICKER_FRAME]` - Stickers found per frame  
- `[STICKER_DRAW]` - Individual sticker drawing
- `[FRAME_CANVAS]` - Canvas content validation

## Applied Fixes Status

### Fix 1: ✅ COMPLETED - Remove Double Filtering  
**Status**: Fixed in `sticker-export-helper.ts` lines 39-41
```typescript
// BEFORE: Double filtering (FIXED)
// AFTER: Only sorts stickers by z-index
const sortedStickers = stickers.sort((a, b) => a.zIndex - b.zIndex);
```

### Fix 2: ✅ COMPLETED - Enhanced Debug Logging
**Status**: Added comprehensive logging in `export-engine.ts`
```typescript
// ADDED: Detailed sticker detection logging
debugLog(`[STICKER_DEBUG] Time: ${currentTime}, Found ${visibleStickers.length} stickers`);
debugLog(`[STICKER_DEBUG] All stickers in store:`, Array.from(stickersStore.overlayStickers.values()));
debugLog(`[STICKER_DEBUG] Visible stickers:`, visibleStickers);
```

### Fix 3: ✅ COMPLETED - SVG Preview Issues
**Status**: Fixed SVG data URL handling in `media-store.ts` and `image-utils.ts`
```typescript
// ADDED: SVG-specific data URL handling instead of blob URLs
if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
  const text = await file.text();
  displayUrl = `data:image/svg+xml;base64,${btoa(text)}`;
}
```

### Fix 4: ✅ COMPLETED - Frame-by-Frame Canvas Debugging
**Status**: Added comprehensive frame-by-frame debugging to track every step of sticker rendering

**Debug Additions Implemented**:
1. ✅ Frame progression logging in `export-engine.ts:678`
2. ✅ Canvas content validation after sticker drawing in `export-engine.ts:420-425`
3. ✅ Individual sticker draw verification in `sticker-export-helper.ts:95-97, 118-119`
4. ✅ Enhanced sticker frame detection in `export-engine.ts:392-394`

## Current Testing Strategy

### 1. **Frame-by-Frame Export Analysis** 🔍 ACTIVE
**Goal**: Verify each frame during export actually has stickers drawn to canvas

**Console Logs to Monitor**:
```
[FRAME_DEBUG] Frame 1/90 at time 0.000s
[STICKER_FRAME] Frame time: 0.000s  
[STICKER_FRAME] Found 1 stickers for this frame
[STICKER_FRAME] Sticker IDs: ['sticker-12345']
[STICKER_DRAW] Drawing sticker sticker-12345 at (250.0, 150.0) size 64.0x64.0
[STICKER_DRAW] Image loaded: true Image src: data:image/svg+xml;base64,PHN2ZyB4bWxu...
[STICKER_DRAW] ✅ Drew sticker sticker-12345 to canvas
[FRAME_CANVAS] Frame 1 has visible content: true
```

### 2. **Expected vs Actual Behavior**
- ✅ **Expected**: Stickers appear in preview and export  
- ❌ **Actual**: Stickers appear in preview but missing from export
- 🔍 **Investigation**: Stickers detected during export but not visible in final video

### 3. **Progressive Debugging Steps**
1. ✅ **Sticker Detection**: Confirmed stickers are found during export
2. ✅ **Double Filtering**: Fixed redundant filtering bug
3. ✅ **SVG URLs**: Fixed data URL vs blob URL issues
4. 🚧 **Canvas Drawing**: Need to verify actual canvas drawing per frame
5. ⏸️ **Image Loading**: Check if sticker images load properly during export
6. ⏸️ **Canvas Capture**: Verify export captures sticker-modified canvas

## Implementation Priority (Updated)

1. **URGENT**: Add frame-by-frame canvas debugging to verify sticker drawing
2. **HIGH**: Check image loading status during export process  
3. **MEDIUM**: Validate canvas capture includes sticker overlays
4. **LOW**: Performance optimization with image preloading

## Files Modified ✅

1. ✅ `qcut/apps/web/src/lib/stickers/sticker-export-helper.ts:39-41` - Fixed double filtering
2. ✅ `qcut/apps/web/src/lib/export-engine.ts:391-394` - Added debug logging  
3. ✅ `qcut/apps/web/src/lib/export-engine.ts:418-420` - Enhanced error logging
4. ✅ `qcut/apps/web/src/stores/media-store.ts:351-369` - Fixed SVG data URLs
5. ✅ `qcut/apps/web/src/lib/image-utils.ts:24-57` - Fixed SVG image loading

## Frame-by-Frame Debugging IMPLEMENTED ✅

All debugging has been successfully implemented and build tested:

### **Debug Logs Now Available During Export:**

1. **Frame Progression**: `[FRAME_DEBUG] Frame X/Y at time Z.ZZZs`
2. **Sticker Detection**: `[STICKER_FRAME] Found X stickers for this frame`
3. **Sticker IDs**: `[STICKER_FRAME] Sticker IDs: ['id1', 'id2']`
4. **Drawing Process**: `[STICKER_DRAW] Drawing sticker ID at (x, y) size WxH`
5. **Image Status**: `[STICKER_DRAW] Image loaded: true/false`
6. **Draw Completion**: `[STICKER_DRAW] ✅ Drew sticker ID to canvas`
7. **Canvas Validation**: `[FRAME_CANVAS] Canvas has visible content: true/false`

### **How to Use:**
1. Open browser dev tools console
2. Start video export with stickers
3. Monitor console for the debug patterns above
4. Identify exactly where sticker rendering fails

### **Expected Console Output Pattern:**
```
[FRAME_DEBUG] Frame 1/90 at time 0.000s
[STICKER_FRAME] Frame time: 0.000s
[STICKER_FRAME] Found 1 stickers for this frame
[STICKER_FRAME] Sticker IDs: ['sticker-12345']
[STICKER_DRAW] Drawing sticker sticker-12345 at (250.0, 150.0) size 64.0x64.0
[STICKER_DRAW] Image loaded: true Image src: data:image/svg+xml;base64,PHN2ZyB4bWxu...
[STICKER_DRAW] ✅ Drew sticker sticker-12345 to canvas
[FRAME_CANVAS] Canvas has visible content after stickers: true
```

This comprehensive debugging will pinpoint exactly where the sticker export pipeline breaks down.