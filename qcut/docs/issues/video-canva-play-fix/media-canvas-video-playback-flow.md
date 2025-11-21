# Media Canvas Video Playback Function Flow

## Overview

This document describes the complete function flow for playing videos on the media canvas in OpenCut. The system uses a coordinated event-driven architecture to synchronize multiple video players with the timeline playhead position.

---

## 1. Core Architecture Components

### 1.1 Preview Panel
**Location:** `apps/web/src/components/editor/preview-panel.tsx`

The main container that renders all media elements on the canvas:
- Manages canvas dimensions and scaling
- Calculates which elements are active at current playback time
- Renders videos, images, text, captions, stickers, and effects
- Handles blur background effects
- Coordinates playback across all video players

**Key responsibilities:**
```typescript
// Lines 125-1035
- previewRef: Main container reference
- previewDimensions: Calculated width/height with aspect ratio
- activeElements: Elements visible at currentTime
- renderElement(): Renders each media type appropriately
- renderBlurBackground(): Blur effect for backgrounds
```

### 1.2 Video Player Component
**Location:** `apps/web/src/components/ui/video-player.tsx`

HTML5 video element wrapper with custom event synchronization:
- Listens to playback events (seek, update, speed)
- Syncs video.currentTime with timeline position
- Handles trim offsets for clipped videos
- Manages volume and playback speed
- Cleans up blob URLs on unmount

**Event sync mechanism:**
```typescript
// Lines 37-95
window.addEventListener("playback-seek", handleSeekEvent);
window.addEventListener("playback-update", handleUpdateEvent);
window.addEventListener("playback-speed", handleSpeed);

// Time calculation with trim support:
const videoTime = Math.max(trimStart,
  Math.min(clipDuration - trimEnd,
    timelineTime - clipStartTime + trimStart));
```

### 1.3 Playback Store
**Location:** `apps/web/src/stores/playback-store.ts`

Zustand store managing global playback state:

```typescript
interface PlaybackState {
  isPlaying: boolean;      // Play/pause state
  currentTime: number;     // Timeline position (seconds)
  duration: number;        // Total duration
  volume: number;          // Volume (0-1)
  muted: boolean;          // Mute state
  speed: number;           // Playback speed (0.1-2.0)
}

// Core methods:
- play(): Starts requestAnimationFrame timer
- pause(): Stops timer
- toggle(): Play/pause toggle
- seek(time): Jump to specific time
- setSpeed(speed): Change playback rate
- setVolume(volume): Adjust volume
```

**Playback timer using requestAnimationFrame:**
```typescript
// Lines 24-78
const updateTime = () => {
  const delta = (now - lastUpdate) / 1000;
  const newTime = currentTime + delta * speed;

  window.dispatchEvent(new CustomEvent("playback-update", {
    detail: { time: newTime }
  }));

  playbackTimer = requestAnimationFrame(updateTime);
};
```

---

## 2. Playback Flow Sequence

### Step 1: User Initiates Playback
**Console (when debugging):** `console.log("step 1: user initiated playback", { action: "play" | "pause" | "toggle" })`
- User clicks **Play** button or presses **Spacebar**
- `usePlaybackStore.play()` is called
- **File:** `apps/web/src/stores/playback-store.ts` (Lines 24-78)
- **Location:** Play button click handler or keyboard event listener

### Step 2: Playback Store Starts Timer
**Console (when debugging):** `console.log("step 2: playback timer started", { isPlaying: true, currentTime, speed })`
- Sets `isPlaying = true`
- Starts `requestAnimationFrame` loop
- Timer calculates new time each frame: `newTime = currentTime + deltaTime * speed`
- **File:** `apps/web/src/stores/playback-store.ts` (play() method)

### Step 3: Event Dispatch
**Console (when debugging):** `console.log("step 3: playback-update event dispatched", { time: newTime, delta, speed })`
- Every frame, store dispatches `playback-update` event with current time
- All video players listen to this event
- **File:** `apps/web/src/stores/playback-store.ts` (updateTime() function inside play())
- **Event:** `window.dispatchEvent(new CustomEvent("playback-update", { detail: { time: newTime } }))`

### Step 4: Video Players Sync
**Console (when debugging):** `console.log("step 4: video player synced", { videoId, timelineTime, videoTime, trimStart, clipStartTime })`
- Each VideoPlayer component receives event
- Updates `video.currentTime` to match timeline position
- Accounts for trim start/end offsets
- Video plays smoothly
- **File:** `apps/web/src/components/ui/video-player.tsx` (handleUpdateEvent function, Lines 37-95)
- **Calculation:** `videoTime = Math.max(trimStart, Math.min(clipDuration - trimEnd, timelineTime - clipStartTime + trimStart))`

### Step 5: Preview Panel Updates
**Console (when debugging):** `console.log("step 5: preview panel updated", { currentTime, activeElementsCount, hasEffects })`
- Re-renders based on `currentTime` from store
- Calculates `activeElements` (elements visible at current time)
- Renders each active element on canvas
- Applies effects, transforms, and opacity
- **File:** `apps/web/src/components/editor/preview-panel.tsx` (Lines 396-423 for activeElements calculation, Lines 691-873 for rendering)

### Step 6: Timeline Playhead Updates
**Console (when debugging):** `console.log("step 6: timeline playhead updated", { currentTime, playheadPosition, shouldAutoScroll })`
- Visual playhead indicator moves along timeline
- Auto-scrolls timeline to keep playhead visible
- Shows current time in toolbar
- **File:** `apps/web/src/components/editor/timeline/timeline-playhead.tsx` and `apps/web/src/hooks/use-timeline-playhead.ts` (Lines 218-256 for auto-scroll)

---

## 3. Seeking Flow

### User Seeks (Playhead Drag or Click)

**Step 7: User Initiates Seek**
**Console (when debugging):** `console.log("step 7: user initiated seek", { mouseX, rawTime, snappedTime, projectFps })`
- User drags playhead or clicks on timeline
- Mouse position calculated and converted to time
- **File:** `apps/web/src/hooks/use-timeline-playhead.ts` (Lines 42-68)
- **Calculation:** `rawTime = mouseX / (50 * zoomLevel)` then `snappedTime = snapTimeToFrame(rawTime, projectFps)`

**Step 8: Playback Store Processes Seek**
**Console (when debugging):** `console.log("step 8: playback store seek", { oldTime: currentTime, newTime: time })`
- Updates `currentTime` state
- Dispatches `playback-seek` event
- **File:** `apps/web/src/stores/playback-store.ts` (seek() method)
- **Event:** `window.dispatchEvent(new CustomEvent("playback-seek", { detail: { time } }))`

**Step 9: Video Players Jump to Position**
**Console (when debugging):** `console.log("step 9: video player seeked", { videoId, timelineTime, calculatedVideoTime, wasPlaying })`
- Receive `playback-seek` event
- Immediately jump to new time
- Update video frames
- **File:** `apps/web/src/components/ui/video-player.tsx` (handleSeekEvent function)
- **Action:** `videoRef.current.currentTime = calculatedVideoTime`

**Step 10: Preview Panel Re-renders**
**Console (when debugging):** `console.log("step 10: preview panel re-rendered after seek", { newTime, newActiveElementsCount })`
- Re-calculates `activeElements` at new time
- Re-renders canvas with updated elements
- **File:** `apps/web/src/components/editor/preview-panel.tsx` (useEffect triggered by currentTime change)

---

## 4. Active Elements Calculation

### Step 11: Calculate Active Elements at Current Time
**Console (when debugging):** `console.log("step 11: calculating active elements", { currentTime, totalTracks, totalElements, calculatedActiveCount })`
**Location:** `preview-panel.tsx` (Lines 396-423)

This step determines which media elements should be visible/playing at the current playback time:

```typescript
const getActiveElements = useCallback((): ActiveElement[] => {
  const activeElements: ActiveElement[] = [];

  tracks.forEach((track) => {
    track.elements.forEach((element) => {
      const elementStart = element.startTime;
      const elementEnd = element.startTime +
        (element.duration - element.trimStart - element.trimEnd);

      // Element is active if currentTime is within its range
      if (currentTime >= elementStart && currentTime < elementEnd) {
        activeElements.push({
          element,
          track,
          mediaItem: findMediaItem(element.mediaId)
        });
      }
    });
  });

  return activeElements;
}, [tracks, currentTime, mediaItems]);
```

**Triggered by:** Changes to `currentTime`, `tracks`, or `mediaItems`
**File:** `apps/web/src/components/editor/preview-panel.tsx`
**Calculation:** Element is active when `currentTime >= elementStart && currentTime < elementEnd`

---

## 5. Element Rendering

### Step 12: Render Each Active Element
**Console (when debugging):** `console.log("step 12: rendering element", { elementId, elementType, mediaType, hasEffects, opacity, transform })`
**Location:** `preview-panel.tsx` (Lines 691-873)

For each active element, the appropriate renderer is invoked based on media type:

#### Video Elements (Step 12a)
**Console (when debugging):** `console.log("step 12a: rendering video element", { elementId, src, clipStartTime, trimStart, trimEnd, clipDuration, filterStyle, opacity, scale })`
```typescript
if (mediaItem.type === "video") {
  return (
    <VideoPlayer
      src={source.src}
      clipStartTime={element.startTime}
      trimStart={element.trimStart}
      trimEnd={element.trimEnd}
      clipDuration={element.duration}
      style={{
        filter: filterStyle,  // CSS effects
        opacity: element.opacity,
        transform: `scale(${element.scale})`
      }}
    />
  );
}
```
**File:** `apps/web/src/components/editor/preview-panel.tsx`
**Applies:** CSS filters (effects), opacity, scale transformations

#### Text Elements (Step 12b)
**Console (when debugging):** `console.log("step 12b: rendering text element", { elementId, text, position: { x, y }, rotation, opacity, fontSize, fontFamily, color })`
```typescript
if (element.type === "text") {
  return (
    <div style={{
      position: 'absolute',
      left: `${50 + (element.x / canvasSize.width) * 100}%`,
      top: `${50 + (element.y / canvasSize.height) * 100}%`,
      transform: `translate(-50%, -50%) rotate(${element.rotation}deg)`,
      opacity: element.opacity,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      color: element.color,
    }}>
      {element.text}
    </div>
  );
}
```
**File:** `apps/web/src/components/editor/preview-panel.tsx`
**Calculation:** Position as percentage: `50 + (element.x / canvasSize.width) * 100`

---

## 6. Event System

The playback system uses three custom events for coordination:

### playback-seek (Event)
**Console (when debugging):** `console.log("event: playback-seek dispatched", { time, source: "timeline-drag" | "playhead-click" })`
**Triggered when:** User drags playhead or clicks timeline
**Purpose:** Immediate time jump across all video players
**File:** `apps/web/src/stores/playback-store.ts` (seek() method)
```typescript
window.dispatchEvent(new CustomEvent("playback-seek", {
  detail: { time: 5.5 }
}));
```
**Listeners:** All VideoPlayer components (handleSeekEvent in video-player.tsx)

### playback-update (Event)
**Console (when debugging):** `console.log("event: playback-update dispatched", { time, delta, speed, frameNumber })`
**Triggered when:** Every frame during playback (requestAnimationFrame)
**Purpose:** Continuous time updates for smooth playback
**File:** `apps/web/src/stores/playback-store.ts` (updateTime() function inside play())
```typescript
window.dispatchEvent(new CustomEvent("playback-update", {
  detail: { time: 2.3 }
}));
```
**Frequency:** ~60 times per second during playback
**Listeners:** All VideoPlayer components (handleUpdateEvent in video-player.tsx)

### playback-speed (Event)
**Console (when debugging):** `console.log("event: playback-speed dispatched", { speed, previousSpeed })`
**Triggered when:** User changes playback speed slider
**Purpose:** Update video playback rate across all players
**File:** `apps/web/src/stores/playback-store.ts` (setSpeed() method)
```typescript
window.dispatchEvent(new CustomEvent("playback-speed", {
  detail: { speed: 1.5 }
}));
```
**Valid Range:** 0.1 to 2.0
**Listeners:** All VideoPlayer components (handleSpeed in video-player.tsx)

---

## 7. Timeline Components

### Timeline Playhead
**Location:** `components/editor/timeline/timeline-playhead.tsx`

Visual indicator showing current playback position:
- Red vertical line across all tracks
- Draggable for seeking
- Auto-scrolls during playback
- Shows time indicator dot

### Timeline Playhead Hook
**Location:** `hooks/use-timeline-playhead.ts`

Handles interaction logic:

```typescript
// Lines 42-68: Scrubbing
const handleScrub = (e: MouseEvent) => {
  const rawTime = (mouseX / (50 * zoomLevel));
  const projectFps = activeProject?.fps || 30;
  const time = snapTimeToFrame(rawTime, projectFps);
  seek(time);
};

// Lines 218-256: Auto-scroll
// Keeps playhead visible by scrolling timeline container
```

---

## 8. Playback Controls

### Preview Toolbar
**Location:** `components/editor/preview-panel-components.tsx`

Provides UI controls:
- **Play/Pause** toggle button
- **Skip backward** (-1 second)
- **Skip forward** (+1 second)
- **Timeline scrubber** for seeking
- **Time display** (current/total in MM:SS format)
- **Fullscreen** toggle

**Keyboard shortcuts:**
- `Space`: Play/Pause
- `Left Arrow`: Skip backward
- `Right Arrow`: Skip forward

---

## 9. Advanced Features

### Frame Caching
**Location:** `preview-panel.tsx` (Lines 172-486)

Improves performance by pre-rendering frames:
- Caches frames during idle time
- Uses OffscreenCanvas for background rendering
- Reduces re-render overhead during playback

### Effects Rendering
**Location:** `preview-panel.tsx` (Lines 65-123)

Applies visual effects via CSS filters:
```typescript
const { filterStyle, hasEffects } = useEffectsRendering(
  element.id,
  EFFECTS_ENABLED
);

// Applied to video:
<VideoPlayer style={{ filter: filterStyle }} />
```

Supported effects:
- Brightness, Contrast, Saturation
- Blur, Sharpness
- Hue rotation
- Grayscale, Sepia, Invert

### Blur Background
**Location:** `preview-panel.tsx` (Lines 600-689)

Renders blurred version of video behind main content:
- Creates cinematic letterbox effect
- Fills empty space in different aspect ratios
- Synchronized with main video playback

---

## 10. Layout Integration

### Panel Layouts
**Location:** `components/editor/panel-layouts.tsx`

The preview panel is positioned in the center of the default layout:

```
DefaultLayout:
├── Top Panel (30-85% height)
│   ├── MediaPanel (left, 15-40% width)
│   ├── PreviewPanel (center, 30-100% width) ← VIDEO CANVAS
│   └── PropertiesPanel (right, 15-40% width)
└── Bottom Panel (15-70% height)
    └── Timeline
```

---

## 11. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   PLAYBACK FLOW DIAGRAM                      │
└─────────────────────────────────────────────────────────────┘

User Action (Play/Pause/Seek)
        ↓
Playback Store (usePlaybackStore)
  ├─ play() → Start RAF timer
  ├─ pause() → Stop timer
  └─ seek(time) → Jump to time
        ↓
Event Dispatch
  ├─ playback-update (continuous)
  ├─ playback-seek (explicit jump)
  └─ playback-speed (rate change)
        ↓
Video Players (VideoPlayer components)
  └─ Update video.currentTime
        ↓
Preview Panel (PreviewPanel)
  ├─ Calculate activeElements
  ├─ Render each element
  └─ Apply effects & transforms
        ↓
Timeline Playhead (TimelinePlayhead)
  ├─ Update position indicator
  └─ Auto-scroll timeline
        ↓
Canvas Display
  └─ Synchronized video playback
```

---

## 12. Key Files Reference

| File | Purpose |
|------|---------|
| `preview-panel.tsx` | Main canvas rendering & element orchestration |
| `video-player.tsx` | HTML5 video wrapper with event sync |
| `playback-store.ts` | Global playback state & RAF timer |
| `timeline-playhead.tsx` | Visual playhead indicator component |
| `use-timeline-playhead.ts` | Scrubbing & auto-scroll logic |
| `timeline-store.ts` | Track & element state management |
| `panel-layouts.tsx` | UI layout configuration |
| `preview-panel-components.tsx` | Toolbar & fullscreen controls |

---

## 13. Performance Considerations

### requestAnimationFrame Timer
- Provides smooth 60fps updates
- More efficient than setInterval
- Automatically pauses when tab inactive

### Event-Driven Sync
- Decouples video players from store updates
- Allows multiple videos to sync independently
- Prevents direct DOM manipulation

### Memoization
- `activeElements` calculated only when currentTime or tracks change
- Reduces unnecessary re-renders
- Uses React useMemo and useCallback

### Frame Caching
- Pre-renders frames during idle time
- Reduces real-time rendering overhead
- Improves scrubbing performance

---

## 14. Common Issues & Solutions

### Video Sync Drift
**Problem:** Videos slowly drift out of sync during long playback
**Solution:** Use `playback-seek` periodically to re-sync

### Trim Offset Errors
**Problem:** Trimmed videos play from wrong position
**Solution:** VideoPlayer correctly calculates: `videoTime = timelineTime - clipStartTime + trimStart`

### Multiple Video Coordination
**Problem:** Multiple videos on different tracks don't sync
**Solution:** All VideoPlayer components listen to same global events

### Performance with Many Videos
**Problem:** Preview lags with 10+ simultaneous videos
**Solution:** Frame caching + lazy loading of off-screen elements

---

## Conclusion

The media canvas video playback system uses a coordinated event-driven architecture where:
1. **Playback Store** manages time via requestAnimationFrame
2. **Events** synchronize all video players
3. **Preview Panel** calculates and renders active elements
4. **Timeline Playhead** provides visual feedback and seeking

This design ensures frame-accurate playback with real-time preview synchronization across all media elements on the canvas.

---

## 15. Console v5 Debug Analysis - Canvas Video Playback Issues

### Date: 2025-11-21
### Issue: Canvas displays single static image instead of playing video

### Enhanced Console Logging Strategy

To properly debug why the canvas shows only a single frame instead of continuous video playback, the console messages have been enhanced to log detailed object properties instead of generic "Object" strings.

#### Key Metrics to Track:

**Video Element State:**
- `readyState`: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
- `networkState`: 0=EMPTY, 1=IDLE, 2=LOADING, 3=NO_SOURCE
- `currentTime`: Actual video playback position
- `duration`: Total video length
- `paused`: Whether video is currently paused
- `seeking`: Whether video is performing a seek operation

**Synchronization State:**
- `timelineTime`: Current position on timeline (from playback store)
- `videoTime`: Calculated position for video element (accounting for trim/clip)
- `delta`: Time elapsed since last frame update
- `frameNumber`: Current animation frame count

**Rendering State:**
- `activeElementsCount`: Number of elements being rendered
- `videoReadyState`: Ready state at render time
- `videoPaused`: Whether video is paused at render time
- `canvasContext`: Whether canvas 2D context exists

### Critical Findings from Console v5

#### Finding 1: Video readyState Insufficient for Playback
**Observation:**
```javascript
[CANVAS-VIDEO] play() failed {
  error: "DOMException: The play() request was interrupted",
  videoState: { readyState: 1, paused: true },
  reason: "Video metadata loaded but not enough data to play"
}
```

**Analysis:**
- `play()` is being called when `readyState: 1` (HAVE_METADATA)
- Videos need `readyState: 3` (HAVE_FUTURE_DATA) or `4` (HAVE_ENOUGH_DATA) to play smoothly
- Attempting to play before sufficient buffering causes interruptions

**Impact:** Video fails to start playing, resulting in static first frame display

#### Finding 2: Play Promise Interruption Pattern
**Observation:**
```
Frame 1: [CANVAS-VIDEO] play() { playPromise: "pending" }
Frame 2: [re-render triggered by playback-update]
Frame 2: [CANVAS-VIDEO] play() failed { error: "interrupted by new load request" }
```

**Analysis:**
- React re-renders occur 60 times per second (on every `playback-update` event)
- Each re-render may unmount/remount the VideoPlayer component
- New render interrupts the previous play() promise before it resolves
- Creates a cycle: play() → re-render → play() fails → repeat

**Impact:** Videos never successfully start playing due to constant interruption

#### Finding 3: Missing Canvas drawImage() Calls
**Observation:**
- Console shows `step 12a: rendering video element` repeatedly
- No corresponding canvas `drawImage()` calls logged
- Videos rendered as DOM elements, not drawn to canvas

**Analysis:**
- Current implementation appears to render `<VideoPlayer>` components in the DOM
- Canvas may only capture initial snapshot, not continuous frames
- No animation loop drawing video frames to canvas context

**Impact:** Canvas shows static image from initial render, not live video playback

#### Finding 4: High Re-render Frequency
**Observation:**
```javascript
// 60 times per second:
preview-panel.tsx:927 step 12a: rendering video element {
  elementId: "elem-abc123",
  videoReadyState: 1 → 2 → 1 → 2 (fluctuating)
}
```

**Analysis:**
- Preview panel re-renders on every `playback-update` event (~60fps)
- Each render recalculates active elements and re-renders all videos
- Video `readyState` fluctuates between states during rapid re-renders
- Prevents video element from stabilizing into playable state

**Impact:** Excessive re-rendering prevents videos from reaching stable playback state

### Recommended Fixes

#### Fix 1: Wait for Video Ready State Before Playing
**Location:** `apps/web/src/components/ui/video-player.tsx`

```typescript
// Current (problematic):
videoRef.current.play();

// Improved:
const playWhenReady = () => {
  if (videoRef.current.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    videoRef.current.play().catch(err => {
      console.error('[CANVAS-VIDEO] play() failed', {
        error: err.message,
        videoState: {
          currentTime: videoRef.current.currentTime,
          readyState: videoRef.current.readyState,
          networkState: videoRef.current.networkState,
          paused: videoRef.current.paused
        }
      });
    });
  } else {
    videoRef.current.addEventListener('canplay', () => {
      videoRef.current.play();
    }, { once: true });
  }
};
```

#### Fix 2: Prevent VideoPlayer Re-renders with React.memo()
**Location:** `apps/web/src/components/ui/video-player.tsx`

```typescript
export const VideoPlayer = React.memo(({
  src,
  clipStartTime,
  trimStart,
  // ... other props
}) => {
  // Component implementation
}, (prevProps, nextProps) => {
  // Only re-render if critical props change
  return (
    prevProps.src === nextProps.src &&
    prevProps.clipStartTime === nextProps.clipStartTime &&
    prevProps.trimStart === nextProps.trimStart &&
    prevProps.trimEnd === nextProps.trimEnd
  );
});
```

#### Fix 3: Implement Canvas-Based Video Rendering
**Location:** `apps/web/src/components/editor/preview-panel.tsx`

Instead of rendering `<VideoPlayer>` DOM elements, draw video frames directly to canvas:

```typescript
// In preview panel render loop:
const drawVideoToCanvas = (videoElement: HTMLVideoElement, ctx: CanvasRenderingContext2D) => {
  const draw = () => {
    if (!videoElement.paused && !videoElement.ended) {
      ctx.drawImage(
        videoElement,
        0, 0, // source x, y
        videoElement.videoWidth, videoElement.videoHeight, // source width, height
        destX, destY, // destination x, y
        destWidth, destHeight // destination width, height
      );

      console.log('step 13: drawing to canvas', {
        videoId: videoElement.id,
        currentTime: videoElement.currentTime,
        readyState: videoElement.readyState,
        frameDrawn: true
      });

      requestAnimationFrame(draw);
    }
  };

  requestAnimationFrame(draw);
};
```

**Benefits:**
- Eliminates DOM re-render interruptions
- Better performance with multiple videos
- True canvas-based rendering (not DOM overlay)
- Consistent frame updates

#### Fix 4: Use Stable Keys for VideoPlayer Components
**Location:** `apps/web/src/components/editor/preview-panel.tsx`

Ensure VideoPlayer components use stable keys to prevent unmounting:

```typescript
// Current (if unstable):
<VideoPlayer key={`${element.id}-${currentTime}`} />

// Improved (stable key):
<VideoPlayer key={element.id} />
```

### Testing Recommendations

After implementing fixes, verify with enhanced logging:

1. **Verify readyState progression:**
   ```
   readyState: 0 → 1 → 2 → 3 → 4 (smooth progression)
   play() called only when readyState >= 3
   ```

2. **Verify no play() interruptions:**
   ```
   [CANVAS-VIDEO] play() { playPromise: "pending" }
   [CANVAS-VIDEO] play() started successfully
   [No interruption errors]
   ```

3. **Verify canvas drawing:**
   ```
   step 13: drawing to canvas { frameDrawn: true, currentTime: 0.033 }
   step 13: drawing to canvas { frameDrawn: true, currentTime: 0.066 }
   [Continuous frame draws]
   ```

4. **Verify stable re-renders:**
   ```
   VideoPlayer mounted: elem-abc123
   [No unmount/remount during playback]
   VideoPlayer unmounted: elem-abc123 [only when element leaves timeline]
   ```

### Root Cause Summary

The canvas displays a static image instead of playing video due to a combination of:

1. **Premature play() calls** before video has buffered sufficient data
2. **Excessive React re-renders** (60fps) unmounting/remounting video elements
3. **Missing canvas frame drawing** - videos rendered as DOM elements, not drawn to canvas
4. **Interrupted play() promises** due to component lifecycle during rapid re-renders

The enhanced console logging provides detailed insights into video element state, synchronization timing, and rendering patterns necessary to diagnose and fix these issues.
