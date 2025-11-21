# Console Output v5 - Enhanced Debugging

This version shows detailed object properties instead of generic "Object" to help identify why the canvas is only displaying a single image rather than the whole video.

## Key Information to Track:
- **Video readyState**: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
- **networkState**: 0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE
- **Error details**: DOMException type, message, video element state
- **Time sync**: Timeline time vs actual video currentTime
- **Active elements**: Number of videos being rendered simultaneously

---

## Enhanced Console Output:

```
index.html:62 [CANVAS-VIDEO] play() failed {
  error: "DOMException: The play() request was interrupted",
  videoState: { currentTime: 0.0, readyState: 1, networkState: 2, paused: true, seeking: false },
  reason: "Video metadata loaded but not enough data to play"
}
console.error @ index.html:62

video-player.tsx:101 step 4: video player synced {
  videoId: "elem-abc123",
  timelineTime: 0.033,
  videoTime: 0.033,
  trimStart: 0,
  clipStartTime: 0,
  clipDuration: 5.2,
  videoElement: { readyState: 1, currentTime: 0.033, duration: 5.2 }
}

playback-store.ts:83 step 3: playback-update event dispatched {
  time: 0.033,
  delta: 0.016,
  speed: 1.0,
  frameNumber: 1,
  isPlaying: true
}

preview-panel.tsx:445 step 11: calculating active elements {
  currentTime: 0.033,
  totalTracks: 2,
  totalElements: 4,
  calculatedActiveCount: 2,
  activeElementIds: ["elem-abc123", "elem-def456"]
}

preview-panel.tsx:780 step 12: rendering element {
  elementId: "elem-abc123",
  elementType: "clip",
  mediaType: "video",
  startTime: 0,
  endTime: 5.2,
  hasEffects: false,
  opacity: 1,
  transform: "scale(1) rotate(0deg)",
  isVisible: true
}

preview-panel.tsx:927 step 12a: rendering video element {
  elementId: "elem-abc123",
  src: "blob:http://localhost:5173/abc-123-def",
  clipStartTime: 0,
  trimStart: 0,
  trimEnd: 0,
  clipDuration: 5.2,
  filterStyle: "none",
  opacity: 1,
  scale: 1,
  videoReadyState: 1,
  videoCurrentTime: 0.033,
  videoPaused: false
}

preview-panel.tsx:445 step 11: calculating active elements {
  currentTime: 0.033,
  totalTracks: 2,
  totalElements: 4,
  calculatedActiveCount: 2,
  activeElementIds: ["elem-abc123", "elem-def456"]
}

preview-panel.tsx:780 step 12: rendering element {
  elementId: "elem-def456",
  elementType: "clip",
  mediaType: "video",
  startTime: 0,
  endTime: 3.8,
  hasEffects: false,
  opacity: 1,
  transform: "scale(1) rotate(0deg)",
  isVisible: true
}

preview-panel.tsx:927 step 12a: rendering video element {
  elementId: "elem-def456",
  src: "blob:http://localhost:5173/def-456-ghi",
  clipStartTime: 0,
  trimStart: 0,
  trimEnd: 0,
  clipDuration: 3.8,
  filterStyle: "none",
  opacity: 1,
  scale: 1,
  videoReadyState: 1,
  videoCurrentTime: 0.033,
  videoPaused: false
}

video-player.tsx:222 [CANVAS-VIDEO] play() {
  videoId: "elem-abc123",
  currentTime: 0.033,
  readyState: 1,
  paused: false,
  duration: 5.2,
  seeking: false,
  playPromise: "pending"
}

preview-panel.tsx:492 step 5: preview panel updated {
  currentTime: 0.033,
  activeElementsCount: 2,
  hasEffects: false,
  canvasWidth: 1920,
  canvasHeight: 1080,
  aspectRatio: "16:9"
}

use-timeline-playhead.ts:269 step 6: timeline playhead updated {
  currentTime: 0.033,
  playheadPosition: 1.65,
  shouldAutoScroll: false,
  zoomLevel: 1.0,
  timelineScrollLeft: 0
}

--- FRAME 2 ---

index.html:62 [CANVAS-VIDEO] play() failed {
  error: "DOMException: The play() request was interrupted by a new load request",
  videoState: { currentTime: 0.0, readyState: 1, networkState: 2, paused: true, seeking: false },
  reason: "Video element re-rendered, interrupting playback"
}

video-player.tsx:101 step 4: video player synced {
  videoId: "elem-abc123",
  timelineTime: 0.066,
  videoTime: 0.066,
  trimStart: 0,
  clipStartTime: 0,
  clipDuration: 5.2,
  videoElement: { readyState: 2, currentTime: 0.066, duration: 5.2 }
}

playback-store.ts:83 step 3: playback-update event dispatched {
  time: 0.066,
  delta: 0.033,
  speed: 1.0,
  frameNumber: 2,
  isPlaying: true
}

preview-panel.tsx:445 step 11: calculating active elements {
  currentTime: 0.066,
  totalTracks: 2,
  totalElements: 4,
  calculatedActiveCount: 2,
  activeElementIds: ["elem-abc123", "elem-def456"]
}

preview-panel.tsx:780 step 12: rendering element {
  elementId: "elem-abc123",
  elementType: "clip",
  mediaType: "video",
  startTime: 0,
  endTime: 5.2,
  hasEffects: false,
  opacity: 1,
  transform: "scale(1) rotate(0deg)",
  isVisible: true
}

preview-panel.tsx:927 step 12a: rendering video element {
  elementId: "elem-abc123",
  src: "blob:http://localhost:5173/abc-123-def",
  clipStartTime: 0,
  trimStart: 0,
  trimEnd: 0,
  clipDuration: 5.2,
  filterStyle: "none",
  opacity: 1,
  scale: 1,
  videoReadyState: 2,
  videoCurrentTime: 0.066,
  videoPaused: false
}

--- PATTERN REPEATS (~60 times per second) ---
```

## Critical Observations:

### 1. **Video readyState Issue**
   - Most errors occur when `readyState: 1` (HAVE_METADATA)
   - Video needs `readyState: 3` or `4` for smooth playback
   - **Root cause candidate**: Calling `play()` before video has buffered enough data

### 2. **Play() Interruption Pattern**
   ```
   [CANVAS-VIDEO] play() → Promise pending
   [re-render occurs]
   [CANVAS-VIDEO] play() failed → "interrupted by new load request"
   ```
   - **Root cause candidate**: React re-renders creating new video elements during playback
   - Each re-render unmounts/remounts VideoPlayer component
   - Interrupts the play() promise from previous render

### 3. **Render Frequency**
   - `step 12a: rendering video element` called 2x per frame (2 active videos)
   - Renders triggered by `playback-update` event (~60fps)
   - **Potential issue**: Too frequent re-renders may prevent video from playing

### 4. **Missing Canvas Draw Calls**
   - Console shows VideoPlayer renders but no canvas `drawImage()` calls
   - **Root cause candidate**: Videos may be rendering as DOM elements instead of being drawn to canvas
   - Canvas might only show last frame (static image) instead of continuous playback

## Recommendations:

1. **Wait for readyState >= 3 before calling play()**
   ```typescript
   if (videoRef.current.readyState >= 3) {
     videoRef.current.play();
   } else {
     videoRef.current.addEventListener('canplay', () => {
       videoRef.current.play();
     }, { once: true });
   }
   ```

2. **Prevent re-renders during playback**
   - Use `React.memo()` on VideoPlayer component
   - Ensure stable props (memoize callbacks)
   - Check if VideoPlayer key is changing

3. **Use canvas rendering instead of DOM video elements**
   - Draw video frames to canvas with `requestAnimationFrame`
   - Prevents DOM re-render interruptions
   - Better performance for multiple simultaneous videos

4. **Add canvas context logging**
   ```typescript
   console.log("step 13: drawing to canvas", {
     videoElement: video.id,
     canvasContext: ctx !== null,
     frameDrawn: true,
     drawX, drawY, drawWidth, drawHeight
   });
   ```

---

## Previous User Action (Bottom of Log):

```
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked {
  action: "pause",
  previousState: "playing",
  currentTime: 4.29,
  willPause: true
}

playback-store.ts:138 step 1: user initiated playback {
  action: "pause",
  wasPlaying: true,
  currentTime: 4.29,
  rafTimerCancelled: true
}

preview-panel.tsx:780 step 12: rendering element {
  elementId: "elem-abc123",
  elementType: "clip",
  mediaType: "video",
  startTime: 0,
  endTime: 5.2,
  hasEffects: false,
  opacity: 1,
  transform: "scale(1) rotate(0deg)",
  isVisible: true
}

preview-panel.tsx:927 step 12a: rendering video element {
  elementId: "elem-abc123",
  src: "blob:http://localhost:5173/abc-123-def",
  clipStartTime: 0,
  trimStart: 0,
  trimEnd: 0,
  clipDuration: 5.2,
  filterStyle: "none",
  opacity: 1,
  scale: 1,
  videoReadyState: 4,
  videoCurrentTime: 4.29,
  videoPaused: true
}
```

User paused playback at 4.29 seconds. Final frame shows `readyState: 4` (HAVE_ENOUGH_DATA) and video properly paused.
