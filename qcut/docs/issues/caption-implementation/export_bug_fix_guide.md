# Export Bug Fix Guide - Frame Capture & Electron API Issue

## Problem Summary

The CLI Export Engine fails when attempting to export video due to an incorrect Electron API invocation method. The error occurs at the frame capture stage where `window.electronAPI?.invoke` is not a function.

**Critical Error:**
```
TypeError: window.electronAPI?.invoke is not a function
    at export-engine-cli.ts:601:56
```

## Root Cause Analysis

### 1. **Incorrect API Call Pattern**
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

### 2. **Frame Capture Flow Issues**

From console logs (lines 34-40), the export process:
1. ✅ Creates temporary folder successfully
2. ✅ Initializes frame directory: `C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1759895540812\frames`
3. ✅ Checks effects store (lines 41-42, 78, 113)
4. ✅ Builds filter chains (lines 115-124)
5. ❌ **FAILS** at frame capture invocation (line 135)

The frames are likely being generated but cannot be processed because the Electron API call fails.

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

### Step 1: Identify Correct Electron API Method

Check `electron/preload.ts` for the actual FFmpeg API structure:

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
  - Should contain: `frame-0001.png`, `frame-0002.png`, etc.

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

## Files to Check

1. **`apps/web/src/lib/export-engine-cli.ts:600-610`**
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

## Related Documentation

- **Architecture**: See `qcut/docs/CLAUDE.md` - "Electron API Best Practices"
- **TypeScript**: See `qcut/docs/CLAUDE.md` - "TypeScript Development Guidelines"
- **IPC Handlers**: Check `electron/main.ts` for handler registration
