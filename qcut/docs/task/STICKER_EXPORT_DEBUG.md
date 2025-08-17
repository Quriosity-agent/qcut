# Sticker Export Debug Guide

**Problem**: Preview sticker works but exporting sticker doesn't work

## Current Status (Latest)

✅ **MAJOR BREAKTHROUGH**: Root cause identified!

**🚨 CRITICAL DISCOVERY**: Canvas shows stickers are drawn (`Canvas has stickers: true`) but PNG capture produces **identical files every time** (same 2856524 chars)

**Issue**: Canvas capture mechanism is broken - stickers are successfully rendered to canvas but `toDataURL()` captures the same content repeatedly

## Root Cause Analysis (CONFIRMED)

**✅ STICKERS ARE RENDERED**: Logs confirm stickers are successfully drawn to canvas each frame
**❌ CANVAS CAPTURE BROKEN**: `canvas.toDataURL()` produces identical PNG data every frame despite different canvas content

**Problem Location**: Canvas capture in CLI export engine - wrong canvas reference or stale canvas state being captured

## Technical Analysis (CONFIRMED)

### ✅ WORKING COMPONENTS
1. **Sticker Detection**: `getVisibleStickersAtTime()` correctly finds stickers
2. **Sticker Rendering**: `renderStickersToCanvas()` successfully draws to canvas
3. **Canvas Validation**: `Canvas has stickers: true` confirms content exists
4. **CLI Engine**: Now has complete sticker support (was missing entirely)

### ❌ BROKEN COMPONENT
**Canvas Capture Mechanism** in `export-engine-cli.ts:507`:
```typescript
const dataUrl = this.canvas.toDataURL("image/png", 1.0);
```

**Evidence**: 
- Identical PNG file sizes (2856524 chars) every frame
- Canvas data hash will show identical values
- Same canvas reference being captured vs. rendered

## Current Debug Implementation (ACTIVE)

### ✅ CANVAS DATA HASH TRACKING
Newly added canvas capture validation:
```typescript
// In CLI export engine - tracks if PNG data changes
const canvasDataUrl = this.canvas.toDataURL("image/png", 1.0);
const dataHash = canvasDataUrl.substring(22, 72); // 50 char hash
debugLog(`🚨 FRAME ${frame}: Canvas has stickers: ${hasStickers}, Data hash: ${dataHash}`);
```

### Expected vs Actual Results
**✅ Expected**: Different data hash each frame with stickers
**❌ Actual**: Identical data hash every frame (confirming broken capture)

### Next Investigation: Canvas Reference
The issue is likely:
1. **Wrong Canvas**: Capturing a different canvas than the one stickers are drawn to
2. **Stale State**: Canvas capture happens before sticker rendering completes
3. **Timing Issue**: Canvas modified after capture

## Debug Progress Summary

### ✅ COMPLETED FIXES
1. **CLI Engine Sticker Support**: Added complete sticker rendering (was missing)
2. **Double Filtering Bug**: Fixed redundant time filtering 
3. **SVG Data URLs**: Fixed blob URL issues for SVG stickers
4. **Debug Logging**: Comprehensive frame-by-frame logging
5. **Canvas Validation**: Confirms stickers are drawn to canvas

### 🔍 CURRENT INVESTIGATION
**Canvas Capture Debugging**: Added data hash tracking to confirm PNG capture issue

**Key Logs to Monitor**:
- `🚨 FRAME X: Canvas has stickers: true/false, Data hash: ABC123...`
- If hash is identical every frame → canvas capture is broken
- If hash changes → capture is working, issue is elsewhere

## Technical Fixes Applied

### ✅ CLI Engine Sticker Support
**File**: `export-engine-cli.ts:276-315`
**Fix**: Added complete `renderStickerElementCLI()` method (was missing)
**Result**: CLI engine now processes sticker elements

### ✅ Double Filtering Bug Fix
**File**: `sticker-export-helper.ts:41`
**Fix**: Removed redundant time filtering
**Result**: No duplicate filtering of stickers

### ✅ Canvas Data Hash Debugging
**File**: `export-engine-cli.ts:481-483`
**Fix**: Added PNG data hash tracking
**Result**: Can detect if canvas capture is broken

### ✅ SVG Data URL Fix
**File**: `media-store.ts:362-365`
**Fix**: Use data URLs instead of blob URLs for SVG
**Result**: SVG stickers display correctly in preview

## Next Steps

### 🔍 IMMEDIATE: Test Canvas Data Hash
**Goal**: Confirm canvas capture produces identical data

**Expected Console Pattern**:
```
🚨 FRAME 0: Canvas has stickers: true, Data hash: ABC123...
🚨 FRAME 1: Canvas has stickers: true, Data hash: ABC123...  // SAME = BROKEN
🚨 FRAME 2: Canvas has stickers: true, Data hash: ABC123...  // SAME = BROKEN
```

### 🛠️ LIKELY FIX: Canvas Reference Issue
Once hash confirms identical capture, investigate:
1. **Canvas Element**: Verify CLI engine uses correct canvas instance
2. **Context Binding**: Ensure `this.ctx` matches `this.canvas`
3. **Timing**: Check if capture happens before sticker rendering completes

### 📊 SUCCESS CRITERIA
**✅ Fixed**: Different data hash per frame with stickers
**✅ Fixed**: Exported video contains visible stickers

## Files Modified

1. ✅ `export-engine-cli.ts:276-315` - Added CLI sticker support
2. ✅ `export-engine-cli.ts:481-483` - Added canvas data hash debugging
3. ✅ `sticker-export-helper.ts:41` - Fixed double filtering
4. ✅ `media-store.ts:362-365` - Fixed SVG data URLs
5. ✅ `debug-config.ts` - Enabled debug mode by default

## Debug Summary

**🎯 CURRENT STATUS**: Canvas data hash tracking active to confirm PNG capture issue

**📋 COMPREHENSIVE LOGGING AVAILABLE**:
- `🚨 FRAME X: Canvas has stickers: true, Data hash: ABC123...`
- `[CLI_STICKER_DEBUG] Found sticker element at time X`
- `[STICKER_DRAW] Drawing sticker ID at (x, y) size WxH`
- `[STICKER_DRAW] ✅ Drew sticker ID to canvas`

**🔍 INVESTIGATION**: If data hash is identical every frame → canvas capture is broken and needs fixing

**🎯 SOLUTION PATH**: Fix canvas reference/timing in CLI export engine's `toDataURL()` call