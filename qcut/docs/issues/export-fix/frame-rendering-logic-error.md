# Export Frame Rendering Logic Error

## Issue Summary

Export fails with error: **"No frame files found in: C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1760314550216\frames"**

## Error Analysis

### The Problem

The export system has a **contradictory logic flow** that causes it to skip frame rendering while also disabling direct video copy optimization. This leaves FFmpeg with no frames to process.

### Console Log Flow (from console_v2.md)

```
Line 419: 🔍 [EXPORT ANALYSIS] Video localPath validation: Object
Line 420: ⚠️ [EXPORT ANALYSIS] Some videos lack localPath - direct copy disabled
Line 421: 📝 [EXPORT ANALYSIS] Videos without localPath: Array(1)

Line 424: 📝 [EXPORT OPTIMIZATION] Strategy: image-pipeline
Line 638: ⚡ [EXPORT OPTIMIZATION] Skipping frame rendering - using direct video copy!

Line 426: 🎬 [EXPORT OPTIMIZATION] Sending to FFmpeg with useDirectCopy = false

Line 428-432: ❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED!
Error: No frame files found in: C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1760314550216\frames
```

## Root Cause

### Contradictory Logic in Export Pipeline

1. **Analysis Phase** (export-analysis.ts:420)
   - Detects videos missing `localPath` property
   - Correctly disables direct copy optimization
   - Returns analysis indicating direct copy is NOT possible

2. **Rendering Phase** (export-engine-cli.ts:638)
   - **INCORRECTLY** skips frame rendering
   - Logs: "Skipping frame rendering - using direct video copy!"
   - This is wrong because analysis already disabled direct copy

3. **Export Phase** (export-engine-cli.ts:1092)
   - Sends to FFmpeg with `useDirectCopy = false`
   - FFmpeg expects frame files (since direct copy is disabled)
   - **No frames exist** because rendering was skipped
   - **Export fails**

## The Bug

**Location**: `export-engine-cli.ts:638`

The code decides to skip frame rendering based on an incorrect assumption. Even though the analysis phase determined direct copy isn't possible, the rendering phase still skips generating frames.

### What Should Happen

```
IF analysis says direct copy is possible AND all videos have localPath:
  → Skip frame rendering
  → Use direct video copy

ELSE:
  → Render all frames
  → Use frame-based FFmpeg export
```

### What Actually Happens

```
IF strategy is "image-pipeline":
  → Skip frame rendering (WRONG!)
  → useDirectCopy = false
  → FFmpeg looks for frames that don't exist
  → CRASH
```

## Affected Code Files

- `qcut/apps/web/src/lib/ai-video-client.ts` (likely the main export logic)
- Export analysis logic (export-analysis.ts)
- Export engine CLI implementation (export-engine-cli.ts)
- Effects store integration (effects-store.ts)

## Solution Required

The rendering decision logic needs to be fixed to:

1. **Only skip frame rendering** when BOTH conditions are true:
   - Analysis confirms direct copy is possible
   - All videos have valid `localPath`

2. **Always render frames** when:
   - Any video lacks `localPath`
   - Effects are applied to videos
   - Direct copy optimization is disabled

## Related Files

- Console output: `console_v2.md`
- Main export client: `qcut/apps/web/src/lib/ai-video-client.ts`
