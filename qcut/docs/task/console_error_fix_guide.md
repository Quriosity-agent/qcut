# Console Error Fix Guide

## Overview
This document provides solutions for console errors encountered in QCut without breaking existing functionality. Each fix is designed to be backwards-compatible and safe to implement.

## Relationship to Recent Sound Feature Changes
The recent sound search implementation (commits 9fafe88, 343ea45) **partially addressed CSP issues** but missed a critical configuration:
- ✅ **Fixed**: Added Freesound domains to CSP for external API access
- ✅ **Working**: Sound search via IPC is successful (as shown in console logs)
- ❌ **Still Broken**: `blob:` URLs not allowed in `connect-src` directive
- ❌ **Impact**: WaveSurfer cannot fetch blob URLs for local audio files in timeline

The sound search feature works because it uses external URLs (https://cdn.freesound.org), but local audio files using blob URLs still fail.

## Related Source Files
- **Timeline Components**: 
  - `apps/web/src/components/editor/timeline/index.tsx`
  - `apps/web/src/components/editor/timeline/timeline-track.tsx`
  - `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- **Audio Waveform**: `apps/web/src/components/editor/audio-waveform.tsx`
- **CSP Configuration**:
  - `electron/main.js:131-151` (Electron CSP headers)
  - `apps/web/index.html:6` (HTML meta tag CSP)

## Error 1: Maximum Update Depth Exceeded

### Error Message
```
Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
```

### Root Cause
The component at `editor._project_id.lazy-BkeLrXjp.js:13:102850` (component `hl`) has a useEffect hook that triggers state updates in an infinite loop.

### Fix Strategy
1. **Identify the problematic useEffect hook** in the timeline component
2. **Add proper dependency arrays** to prevent infinite re-renders
3. **Use memoization** for objects/arrays that are recreated on every render

### Implementation Steps

#### Step 1: Locate the Component
The error trace points to a component in the timeline system. Check these specific files:
- `apps/web/src/components/editor/timeline/index.tsx`
- `apps/web/src/components/editor/timeline/timeline-track.tsx`
- `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- Look for useEffect hooks without dependency arrays or with unstable dependencies

#### Step 2: Common Patterns to Fix

**Pattern A: Missing Dependency Array**
```typescript
// ❌ BAD - Runs on every render
useEffect(() => {
  setSomeState(value);
});

// ✅ GOOD - Runs only when value changes
useEffect(() => {
  setSomeState(value);
}, [value]);
```

**Pattern B: Object/Array Dependencies**
```typescript
// ❌ BAD - Object recreated every render
const config = { key: value };
useEffect(() => {
  doSomething(config);
}, [config]); // Will trigger every render

// ✅ GOOD - Memoized object
const config = useMemo(() => ({ key: value }), [value]);
useEffect(() => {
  doSomething(config);
}, [config]); // Only triggers when value changes
```

**Pattern C: Function Dependencies**
```typescript
// ❌ BAD - Function recreated every render
const handleUpdate = () => {
  updateState(data);
};
useEffect(() => {
  handleUpdate();
}, [handleUpdate]); // Infinite loop

// ✅ GOOD - Memoized callback
const handleUpdate = useCallback(() => {
  updateState(data);
}, [data]);
useEffect(() => {
  handleUpdate();
}, [handleUpdate]);
```

## Error 2: Content Security Policy (CSP) Blob URL Violation

### Error Messages
```
Refused to connect to 'blob:<URL>' because it violates the following Content Security Policy directive: "connect-src 'self' app: ..."
Fetch API cannot load blob:file:///eb6acfd6-fed0-46ff-a06e-79de8166f7f2. Refused to connect because it violates the document's Content Security Policy.
WaveSurfer error: TypeError: Failed to fetch. Refused to connect because it violates the document's Content Security Policy.
```

### Root Cause
The application's CSP doesn't allow fetching from blob URLs, which WaveSurfer needs for audio processing.

### Fix Strategy
Update the CSP to allow blob URLs while maintaining security.

### Implementation Steps

#### Step 1: Update CSP in Electron Main Process
In `electron/main.js:143-149`, update the CSP header to include blob URLs:

```javascript
// Find the CSP configuration
win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "media-src 'self' blob: data:; " +
        // CURRENT (from sound fix commit 9fafe88) - Missing blob:
        // "connect-src 'self' app: http://localhost:8080 ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com https://fal.run https://fal.media https://v3.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com https://freesound.org https://cdn.freesound.org; "
        
        // FIXED - Add blob: to connect-src
        "connect-src 'self' blob: app: http://localhost:8080 ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com https://fal.run https://fal.media https://v3.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com https://freesound.org https://cdn.freesound.org; "
      ]
    }
  });
});
```

#### Step 2: Alternative - Update HTML Meta Tag
The CSP is also set in `apps/web/index.html:6`. Update the meta tag:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' 'unsafe-eval'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: blob: https:; 
               media-src 'self' blob: data:; 
               connect-src 'self' blob: app: http://localhost:8080 ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com https://fal.run https://fal.media https://v3.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com https://freesound.org https://cdn.freesound.org;">
```

#### Step 3: WaveSurfer-Specific Fix
If updating CSP is not desired, modify WaveSurfer initialization in `apps/web/src/components/editor/audio-waveform.tsx` to use alternative loading:

```typescript
// Instead of blob URLs, use base64 or direct file paths
const wavesurfer = WaveSurfer.create({
  container: containerRef.current,
  waveColor: '#4F4F4F',
  progressColor: '#383351',
  backend: 'MediaElement', // Use MediaElement instead of WebAudio
  mediaControls: false,
  // Avoid blob URL creation
  peaks: audioData ? audioData.peaks : undefined,
});

// Load audio differently
if (audioUrl.startsWith('blob:')) {
  // Convert blob URL to base64 or use IPC to get file path
  const response = await fetch(audioUrl);
  const blob = await response.blob();
  const reader = new FileReader();
  reader.onloadend = () => {
    wavesurfer.load(reader.result); // Load as base64
  };
  reader.readAsDataURL(blob);
} else {
  wavesurfer.load(audioUrl);
}
```

## Error 3: WaveSurfer Initialization Failures

### Related to CSP Issue
The WaveSurfer errors are a direct consequence of the CSP blob URL restriction. Fixing the CSP will resolve these errors.

### Additional Fallback Handling
Add error handling in `apps/web/src/components/editor/audio-waveform.tsx` to gracefully degrade when WaveSurfer fails:

```typescript
const initializeWaveSurfer = async () => {
  try {
    const wavesurfer = WaveSurfer.create(config);
    await wavesurfer.load(audioUrl);
    setWaveformReady(true);
  } catch (error) {
    console.warn('WaveSurfer initialization failed, using fallback audio player', error);
    // Fallback to simple HTML5 audio
    setUseFallbackPlayer(true);
  }
};

// Render fallback UI
if (useFallbackPlayer) {
  return (
    <audio 
      ref={audioRef}
      src={audioUrl}
      controls={false}
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleMetadataLoad}
    />
  );
}
```

## Testing Guide

### Pre-Implementation Checklist
1. ✅ Backup current working state
2. ✅ Note current functionality that works
3. ✅ Test in development mode first
4. ✅ Test in production build

### Testing Steps
1. **Test Maximum Update Depth Fix**
   - Open editor with a project
   - Add media to timeline
   - Verify no infinite render warnings in console
   - Check React DevTools Profiler for render loops

2. **Test CSP Blob URL Fix**
   - Drag audio file to timeline
   - Verify waveform displays correctly
   - Check console for CSP violations
   - Test audio playback

3. **Regression Testing**
   - Verify sound search still works
   - Test video playback
   - Check timeline operations (drag, drop, resize)
   - Ensure export functionality unchanged

### Rollback Plan
If issues occur:
1. Revert CSP changes in `electron/main.js`
2. Restore original useEffect hooks
3. Remove WaveSurfer fallback code
4. Clear browser cache and restart Electron

## Implementation Priority

1. **High Priority**: Fix CSP blob URL issue
   - Blocks audio waveform functionality
   - Simple configuration change
   - Low risk of breaking changes

2. **Medium Priority**: Fix maximum update depth warning
   - Performance impact but not blocking
   - Requires careful code analysis
   - Medium risk if done incorrectly

3. **Low Priority**: Add WaveSurfer fallbacks
   - Nice-to-have resilience feature
   - Only needed if CSP can't be modified

## Notes
- All fixes maintain backwards compatibility
- No existing features should break
- Each fix can be implemented independently
- Test thoroughly in both dev and production builds

## Quick Reference - File Locations

### Maximum Update Depth Files
- `apps/web/src/components/editor/timeline/index.tsx` - Main timeline component
- `apps/web/src/components/editor/timeline/timeline-track.tsx` - Track component with drag/drop
- `apps/web/src/components/editor/timeline/timeline-playhead.tsx` - Playhead position component

### CSP Configuration Files  
- `electron/main.js:143-149` - Electron CSP header configuration
- `apps/web/index.html:6` - HTML meta tag CSP definition

### WaveSurfer Audio Files
- `apps/web/src/components/editor/audio-waveform.tsx` - WaveSurfer implementation

### Note on CSP and Sound Feature
Currently, the CSP in both files already includes `blob:` in `default-src`, `media-src`, and other directives, but NOT in `connect-src`. The fix requires adding `blob:` to the `connect-src` directive specifically.

**Timeline of CSP Changes:**
1. **Commit 9fafe88** (Sound fix): Added Freesound domains to `connect-src` for external sound search
2. **Still Missing**: `blob:` in `connect-src` for local audio file waveforms
3. **Result**: Sound search works (uses https URLs), but local audio waveforms fail (need blob URLs)