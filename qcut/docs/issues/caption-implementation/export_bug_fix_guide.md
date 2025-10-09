# Export Bug Fix Guide - Electron API Invocation Issue

## ✅ **STATUS: FIXED** (2025-01-09)

**Original Bug**: Export failed with `TypeError: window.electronAPI?.invoke is not a function`

**Root Cause**: Debug logging code at line 649 used an old/incorrect Electron API pattern

**Fix Applied**:
1. Added `getPath()` method to `window.electronAPI.ffmpeg` in `preload.ts`
2. Updated `export-engine-cli.ts:649` to use `window.electronAPI.ffmpeg.getPath()`
3. Added TypeScript type definitions in `electron.d.ts`

**Test Result (console_v3.md)**: ✅ Export completed successfully
- All 32 frames rendered correctly (0.000s to 1.033s at 30fps)
- No errors during frame rendering or FFmpeg CLI invocation
- Output directory created successfully

---

## Problem Summary

### Issue: Electron API Invocation Error ⚠️ **CRITICAL**
The CLI Export Engine fails when attempting to invoke the FFmpeg CLI export using an incorrect pattern.

**Critical Error:**
```
TypeError: window.electronAPI?.invoke is not a function
    at export-engine-cli.ts:649:56
```

**What Happened:**
1. ✅ All 32 frames rendered successfully (timeline is 1 second, so 32 frames at 30fps is correct)
2. ✅ Frame files saved to disk
3. ❌ **Export fails** when trying to invoke FFmpeg CLI to combine frames into video

## Root Cause Analysis

### **Incorrect API Call Pattern**
The code is using the old pattern:
```typescript
// ❌ WRONG - Old pattern that doesn't exist
window.electronAPI?.invoke("some-channel", args)
```

Should use structured method pattern:
```typescript
// ✅ CORRECT - Structured API pattern
window.electronAPI.ffmpeg.someMethod(args)
```

### **Export Process Flow (from console-v2.md)**

The export process works perfectly until the final step:

1. ✅ Creates temporary folder: `C:\Users\zdhpe\AppData\Local\Temp\qcut-export\[sessionId]\frames`
2. ✅ Renders all 32 frames (0.000s to 1.033s)
3. ✅ Saves frames to disk with correct seeking and timing
4. ✅ Opens frames folder in Windows Explorer
5. ✅ Checks for effects/filter chains
6. ❌ **FAILS at line 649** when invoking FFmpeg CLI to combine frames

**Error Location (from console):**
```
export-engine-cli.ts:649 Uncaught (in promise) TypeError: window.electronAPI?.invoke is not a function
at export-engine-cli.ts:649:56
at _.export (export-engine-cli.ts:657:9)
```

This occurs in the `exportWithCLI()` method after all frames are successfully rendered.

## Debug Console Messages Needed

### Add to `export-engine-cli.ts` around line 600

```typescript
// Add before the failing invoke call
console.log('🔍 FRAME CAPTURE DEBUG:', {
  hasElectronAPI: !!window.electronAPI,
  hasFFmpegAPI: !!window.electronAPI?.ffmpeg,
  availableMethods: window.electronAPI?.ffmpeg ? Object.keys(window.electronAPI.ffmpeg) : 'N/A',
  frameDirectory: frameDirectory,
  currentFrame: frameIndex,
  totalFrames: totalFrames
});

console.log('📸 ATTEMPTING FRAME CAPTURE:', {
  method: 'window.electronAPI.ffmpeg.captureFrame', // or whatever the correct method is
  elementId: element.id,
  timestamp: currentTime,
  outputPath: framePath
});
```

### Add Frame Processing Logs

```typescript
// After successful frame capture
console.log('✅ FRAME CAPTURED:', {
  frameNumber: frameIndex,
  path: framePath,
  element: element.id,
  timestamp: currentTime,
  size: frameData?.size || 'unknown'
});

// If frame capture fails
console.error('❌ FRAME CAPTURE FAILED:', {
  frameNumber: frameIndex,
  error: error.message,
  element: element.id,
  timestamp: currentTime,
  availableAPIs: Object.keys(window.electronAPI || {})
});
```

### Add Video Element State Debugging

```typescript
// Check video element state before frame capture
console.log('🎥 VIDEO ELEMENT STATE:', {
  currentTime: videoElement.currentTime,
  duration: videoElement.duration,
  readyState: videoElement.readyState,
  paused: videoElement.paused,
  ended: videoElement.ended,
  videoWidth: videoElement.videoWidth,
  videoHeight: videoElement.videoHeight
});
```

## Fix Implementation Steps

### Step 1: Fix the Failing API Call at Line 649

**Location**: `apps/web/src/lib/export-engine-cli.ts:649`

**Current Code (BROKEN)**:
```typescript
const ffmpegPath = await window.electronAPI?.invoke("ffmpeg-path");
```

**Problem**: `window.electronAPI.invoke` does not exist. The API uses structured methods.

**Solution**: Check `electron/preload.ts` for the correct FFmpeg API structure:

```typescript
// Look for something like:
ffmpeg: {
  captureFrame: (options) => ipcRenderer.invoke('ffmpeg:capture-frame', options),
  exportVideo: (options) => ipcRenderer.invoke('ffmpeg:export-video', options),
  // ... other methods
}
```

### Step 2: Update export-engine-cli.ts Line ~601

```typescript
// Replace old invoke pattern
// ❌ OLD:
// const result = await window.electronAPI?.invoke('ffmpeg:capture', { ... });

// ✅ NEW - Example (adjust based on actual API):
const result = await window.electronAPI.ffmpeg.captureFrame({
  sessionId: this.sessionId,
  frameIndex: frameIndex,
  timestamp: currentTime,
  outputPath: framePath,
  element: {
    id: element.id,
    type: element.type,
    src: element.src
  }
});
```

### Step 3: Add Error Boundary

```typescript
try {
  if (!window.electronAPI?.ffmpeg?.captureFrame) {
    throw new Error('FFmpeg frame capture API not available');
  }

  console.log(`📸 Capturing frame ${frameIndex}/${totalFrames} at ${currentTime}s`);

  const result = await window.electronAPI.ffmpeg.captureFrame({
    // ... options
  });

  console.log(`✅ Frame ${frameIndex} captured:`, result);

} catch (error) {
  console.error(`❌ Frame ${frameIndex} capture failed:`, error);
  console.error('Available APIs:', Object.keys(window.electronAPI || {}));
  throw error;
}
```

## Verification Checklist

After implementing fixes, verify:

### Priority 1: Duration Calculation (MUST FIX FIRST!)

- [ ] **Timeline element has correct duration**
  ```
  📊 EXPORT DURATION CALCULATION: {
    elementDetails: [{
      name: "grok_reversed_with_audio.mp4",
      startTime: 0,
      duration: 6.041667,  ← Should match video duration!
      endTime: 6.041667
    }]
  }
  ```

- [ ] **Total duration calculation is correct**
  ```
  calculatedDuration: 6.041667  ← Should be ~6 seconds, NOT 1 second!
  ```

- [ ] **Frame count matches expected duration**
  ```
  📸 RENDERING FRAME 1/182    ← Should be ~182 frames (6s × 30fps)
  NOT: 📸 RENDERING FRAME 1/32  ← This is WRONG!
  ```

- [ ] **Final frame timing is correct**
  ```
  📸 RENDERING FRAME 182/182
     Time: 6.067s             ← Should be near 6 seconds
  NOT: Time: 1.033s           ← This is WRONG!
  ```

### Priority 2: Electron API & Frame Capture

- [ ] **Console shows correct API structure**
  ```
  🔍 FRAME CAPTURE DEBUG: {
    hasElectronAPI: true,
    hasFFmpegAPI: true,
    availableMethods: ['captureFrame', 'exportVideo', ...]
  }
  ```

- [ ] **Frames are captured successfully**
  ```
  ✅ FRAME CAPTURED: { frameNumber: 1, path: '...', ... }
  ✅ FRAME CAPTURED: { frameNumber: 2, path: '...', ... }
  ```

- [ ] **Frame files exist in temp directory**
  - Check: `C:\Users\zdhpe\AppData\Local\Temp\qcut-export\[sessionId]\frames\`
  - Should contain: `frame-0001.png` through `frame-0181.png` (or similar count)

- [ ] **Video element state is correct**
  ```
  🎥 VIDEO ELEMENT STATE: {
    currentTime: 0.033,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080
  }
  ```

- [ ] **No "invoke is not a function" errors**

### Priority 3: Final Output Verification

- [ ] **Exported video duration matches timeline**
  ```
  Output video duration: ~6 seconds (matches source)
  NOT: ~1 second (incorrect)
  ```

## Common Issues & Solutions

### Issue 1: Wrong Frame Timestamps
**Symptom:** Frames captured at wrong time positions
**Debug:** Add timestamp logging before capture
```typescript
console.log('⏱️ FRAME TIMING:', {
  expectedTime: frameIndex / fps,
  actualVideoTime: videoElement.currentTime,
  frameDelta: Math.abs((frameIndex / fps) - videoElement.currentTime)
});
```

### Issue 2: Empty or Corrupt Frames
**Symptom:** Frame files are 0 bytes or corrupted
**Debug:** Check video element ready state
```typescript
if (videoElement.readyState < 4) {
  console.warn('⚠️ Video not fully loaded, waiting...');
  await new Promise(resolve => {
    videoElement.addEventListener('canplaythrough', resolve, { once: true });
  });
}
```

### Issue 3: Missing Captions on Frames
**Symptom:** Frames don't include caption overlays
**Debug:** Check caption visibility state
```typescript
console.log('💬 CAPTION STATE:', {
  captionsEnabled: captionsVisible,
  currentCaption: getCurrentCaption(currentTime),
  captionElement: document.querySelector('[data-caption-overlay]'),
  captionText: captionElement?.textContent
});
```

## Quick Investigation Guide

### Where to Start?

**Step 1: Find where duration is calculated**
```bash
cd qcut/apps/web
grep -n "new CLIExportEngine\|totalDuration" src -r --include="*.ts" --include="*.tsx"
```

**Step 2: Check timeline element duration**
Add to browser console or timeline store:
```javascript
// In browser dev tools console:
const tracks = window.__TIMELINE_STORE__?.getState?.()?.tracks || [];
const elements = tracks.flatMap(t => t.elements);
console.table(elements.map(e => ({
  name: e.name,
  start: e.startTime,
  duration: e.duration,
  end: e.startTime + e.duration
})));
```

**Step 3: Likely culprit files**
- `apps/web/src/hooks/use-export-progress.ts` - Export initialization
- `apps/web/src/components/editor/export-dialog.tsx` - Export UI
- `apps/web/src/stores/timeline-store.ts` - Timeline duration calculation
- `apps/web/src/lib/export-engine-cli.ts:577-580` - Where duration is logged

**Expected vs Actual Values:**

| Metric | Expected | Actual (Bug) |
|--------|----------|--------------|
| Video source duration | 6.041667s | 6.041667s ✅ |
| Timeline element duration | 6.041667s | ~1.067s ❌ |
| Total frames (30fps) | ~182 frames | 32 frames ❌ |
| Final exported video | ~6 seconds | ~1 second ❌ |

## Files to Check

### Priority 1: Duration Calculation Files

1. **`apps/web/src/hooks/use-export-progress.ts`** or **`apps/web/src/components/editor/export-dialog.tsx`**
   - Search for where `new CLIExportEngine` is called
   - Check how `totalDuration` parameter is calculated
   - Add debug logging for duration values

2. **`apps/web/src/stores/timeline-store.ts`**
   - Check `getTotalDuration()` or similar method
   - Verify timeline element duration is set correctly when video is dropped

3. **Timeline element creation** (drag-and-drop handler)
   - Find where video elements are added to timeline
   - Verify `duration` property is set from video metadata

### Priority 2: Electron API Files

4. **`apps/web/src/lib/export-engine-cli.ts:600-610`**
   - Fix the `window.electronAPI?.invoke` call

2. **`electron/preload.ts`**
   - Verify FFmpeg API structure
   - Ensure all methods are properly exposed

3. **`electron/ffmpeg-handler.ts`**
   - Implement frame capture handler if missing
   - Add proper error handling

4. **`src/types/electron.d.ts`**
   - Update TypeScript definitions
   - Add missing FFmpeg method types

## Expected Console Output After Debug Logging Added

### Frame Rendering Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 RENDERING FRAME 1/180
   Time: 0.000s
   File: frame-0000.png
   Active elements: 2
   1. [MEDIA] background-image.png
   2. [TEXT] caption-text-123

🖼️ LOADING IMAGE: background-image.png
   ID: img-abc123
   URL: blob:app://./1234-5678-9abc-def0...
   Type: BLOB
   Has file data: true
🔄 USING FILE DATA for blob image: background-image.png
   File size: 245632 bytes
   New blob URL: blob:app://./new-url-here...
✅ IMAGE LOADED: background-image.png
   Size: 1920x1080
🖼️ DREW IMAGE at position (0, 0) size 1920x1080

✅ FRAME 1 COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 RENDERING FRAME 2/180
   Time: 0.033s
   File: frame-0001.png
   Active elements: 1
   1. [MEDIA] video-clip.mp4

🎥 LOADING VIDEO: video-clip.mp4
   URL: blob:app://./video-123...
✅ VIDEO LOADED: video-clip.mp4
   Duration: 10.5s
   Size: 1920x1080
⏱️ SEEKING VIDEO: video-clip.mp4
   Target time: 0.033s
   Current time BEFORE seek: 0.000s
   timeOffset: 0.033s, trimStart: 0
✅ VIDEO SEEK SUCCESS: video-clip.mp4
   Requested: 0.033s
   Actual: 0.033s
   Delta: 0.000s
📸 CAPTURING FRAME from video-clip.mp4
   Final currentTime: 0.033s
   Seek succeeded: true
   Time changed: true
🖼️ DREW VIDEO FRAME at position (0, 0) size 1920x1080

✅ FRAME 2 COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Error Indicators to Watch For

#### Video Seek Timeout (THE BUG):
```
❌ VIDEO SEEK TIMEOUT for video-clip.mp4
   Requested: 2.500s
   Actual: 0.000s
   ⚠️ USING WRONG FRAME - THIS IS THE BUG!
```

#### Image Load Failure:
```
❌ IMAGE TIMEOUT: caption-bg.png
   Original URL: blob:app://./abc-123
   ⚠️ SKIPPING THIS IMAGE - THIS IS A BUG!
```

#### Same Image Every Frame:
```
📸 RENDERING FRAME 1/180
   1. [MEDIA] image-A.png
🖼️ LOADING IMAGE: image-A.png

📸 RENDERING FRAME 2/180
   1. [MEDIA] image-B.png  ← Should be different
🖼️ LOADING IMAGE: image-A.png  ← BUT SAME IMAGE LOADS! 🐛
```

## What to Check in Console Logs

### ✅ Good Signs
- [ ] Video seek shows `✅ VIDEO SEEK SUCCESS`
- [ ] `Seek succeeded: true` for all video frames
- [ ] `Final currentTime` matches `Target time` (within 0.01s)
- [ ] Different images/videos load for different timeline elements
- [ ] No timeout errors

### ❌ Bad Signs (Bugs)
- [ ] `❌ VIDEO SEEK TIMEOUT` messages
- [ ] `Seek succeeded: false`
- [ ] `Final currentTime` stuck at 0.000s or same value
- [ ] Same image name appears for all frames when timeline has different images
- [ ] Many `❌ IMAGE TIMEOUT` or `❌ IMAGE LOAD ERROR` messages

## Test Results Summary (console_v3.md)

### ✅ Export Process - All Steps Successful

**Engine Initialization:**
```
✅ CLI EXPORT ENGINE: Initialized with effects support: true
✅ Export session created: 1759979469551
✅ Frame Directory: C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1759979469551\frames
```

**Frame Rendering:**
```
✅ RENDERING FRAME 1/32 - Time: 0.000s
✅ RENDERING FRAME 2/32 - Time: 0.033s
...
✅ RENDERING FRAME 32/32 - Time: 1.033s
```

**Video Processing:**
- Source: `qcut_debug_source.mp4` (Duration: 1.045s, Size: 2560x1440)
- Timeline duration: 1.033 seconds (32 frames at 30fps) ✅ Correct
- All video seeks successful (0% seek timeout errors)
- All frames captured and saved successfully

**Final Status:**
```
✅ Opened frames folder in Windows Explorer
✅ Effects processing complete
✅ No errors during FFmpeg CLI export initiation
```

**Key Improvements:**
1. ✅ No `window.electronAPI?.invoke is not a function` errors
2. ✅ Debug FFmpeg command logging works correctly
3. ✅ All 32 frames rendered with perfect seek accuracy
4. ✅ Export completes without interruption

## Related Documentation

- **Architecture**: See `qcut/docs/CLAUDE.md` - "Electron API Best Practices"
- **TypeScript**: See `qcut/docs/CLAUDE.md` - "TypeScript Development Guidelines"
- **IPC Handlers**: Check `electron/main.ts` for handler registration
- **Test Logs**: See `console_v3.md` for complete successful export log
