# Console v6 - Problems to Fix for Canvas Video Playback

## Date: 2025-11-21
## Issue: Canvas displays single static image instead of playing video

## 📊 CURRENT STATUS (After Problem #1 Fix):

### ✅ Progress Made:
- **Problem #1 partially fixed** - Videos now correctly wait for ready state
- **No more play() failed errors** - DOMException errors eliminated
- **Enhanced logging working** - Clear visibility into issues

### 🚨 Critical Blocker Discovered:
- **Problem #2 is preventing videos from playing!**
- **canplay event listeners removed before they can fire** (every 16ms)
- **Videos stuck at readyState 0/1 forever** - never get chance to buffer
- **Must fix Problem #2 immediately** for videos to work

### 📈 Console Evidence (consolev7):
```javascript
// GOOD: Fix detects video not ready ✅
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event

// BAD: Listener removed immediately! ❌
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener

// This repeats 60x per second - video never loads!
```

---

Based on the enhanced console logging implemented in v5 and updated after Problem #1 fix, we've identified the following critical problems that need to be fixed:

---

## 🔴 Critical Problems (Must Fix)

### 1. **Video Elements Not Ready for Playback** ✅ PARTIALLY FIXED - BLOCKED BY PROBLEM #2
**Problem:** Videos attempt to play when `readyState: 1` (HAVE_METADATA) instead of waiting for `readyState: 3` (HAVE_FUTURE_DATA) or `4` (HAVE_ENOUGH_DATA)

**FIX STATUS: ✅ Implemented, ⚠️ Blocked by re-renders**

**Original Evidence (FIXED):**
```javascript
// BEFORE FIX - consolev6 output:
[CANVAS-VIDEO] play() failed {
  error: "DOMException: The play() request was interrupted",
  videoState: { readyState: 1, paused: true }
}
```

**Current Evidence (AFTER FIX) - consolev7 output:**
```javascript
// Fix is working - no more play() failed errors!
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener  // <-- Problem: cleaned up immediately!
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener
// Pattern repeats 60x per second - canplay never fires!
```

**NEW ISSUE DISCOVERED:**
- ✅ Videos correctly detect they're not ready and wait
- ✅ No more play() failed DOMException errors
- ❌ **BUT:** canplay event listener is removed before video can load
- ❌ Videos never reach readyState >= 3 because listener is constantly removed/re-added

**Root Cause of Blocking:** Component re-renders every ~16ms (60fps), causing:
1. useEffect cleanup runs → removes canplay listener
2. New render → adds new canplay listener
3. Repeat before video can buffer → canplay event never fires
4. Video stuck at readyState 0 or 1 forever

**CRITICAL:** Must fix Problem #2 (React re-renders) for this fix to work!

**Relevant File Paths:**
- **Primary Location:** `qcut/apps/web/src/components/ui/video-player.tsx` (lines 227-251)
- **Trigger Point:** `qcut/apps/web/src/stores/playback-store.ts` (lines 131-140) - initiates playback
- **Re-render Source:** `qcut/apps/web/src/components/editor/preview-panel.tsx` (lines 492-500) - updates on every frame

**Why This Happens:**

1. **Immediate Play Attempt:**
   - When `isPlaying` state changes to `true`, the VideoPlayer component immediately calls `video.play()` in a useEffect hook
   - No check is performed to verify if the video has buffered sufficient data
   - Code at `video-player.tsx:228-238`:
   ```typescript
   if (isPlaying && isInClipRange) {
     console.log("[CANVAS-VIDEO] play()", {...});
     video.play()  // <-- Called immediately without readyState check
       .catch((err) => console.error(...));
   }
   ```

2. **HTML5 Video readyState Values:**
   - `0` = HAVE_NOTHING: No information available
   - `1` = HAVE_METADATA: Metadata loaded (duration, dimensions) but no video data
   - `2` = HAVE_CURRENT_DATA: Data for current playback position available
   - `3` = HAVE_FUTURE_DATA: Enough data to play forward
   - `4` = HAVE_ENOUGH_DATA: Enough data to play smoothly

3. **Race Condition:**
   - Video element created with `src` prop
   - React immediately triggers useEffect before video loads
   - `play()` called while `readyState === 1` (only metadata loaded)
   - Browser rejects play() promise with DOMException

4. **Compounded by Re-renders:**
   - Component re-renders 60 times per second (on every `playback-update` event)
   - Each re-render may create new video element or reset existing one
   - Video never gets chance to buffer to `readyState >= 3`

**Root Cause:** The code assumes video is ready to play immediately after mounting, but HTML5 video elements need time to buffer data before playback can begin.

**Impact:** Videos never start playing, showing only first frame

**Fix Required:**
- Add readyState check before calling play()
- Implement `canplay` or `canplaythrough` event listener
- Use promise-based approach with proper state management
- File: `video-player.tsx` lines 227-251

**Proposed Solution:**
```typescript
// video-player.tsx - Replace lines 227-251
useEffect(() => {
  const video = videoRef.current;
  if (!video) return;

  if (isPlaying && isInClipRange) {
    // Check if video is ready to play
    if (video.readyState >= 3) {
      video.play().catch(handlePlayError);
    } else {
      // Wait for video to be ready
      const handleCanPlay = () => {
        if (isPlaying && isInClipRange) {
          video.play().catch(handlePlayError);
        }
      };
      video.addEventListener('canplay', handleCanPlay, { once: true });
      return () => video.removeEventListener('canplay', handleCanPlay);
    }
  } else {
    video.pause();
  }
}, [isPlaying, isInClipRange, ...]);
```

---

### 2. **React Re-renders Interrupting Event Listeners** 🚨 CRITICAL BLOCKER - MUST FIX NOW!
**Problem:** Components re-render 60 times per second, causing video elements to constantly reset and removing event listeners before they can fire

**Updated Evidence from consolev7 (AFTER Problem #1 fix):**
```javascript
// This pattern repeats 60x per second:
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event  // Sets up listener
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener                 // Removed 16ms later!
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event  // Sets up new listener
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener                 // Removed again!
// Video NEVER gets chance to fire canplay event!
```

**Why This is Now THE Critical Issue:**
1. Problem #1 fix is working (videos wait for ready state)
2. BUT videos can never become ready because:
   - useEffect cleanup runs every ~16ms
   - canplay listener removed before video can buffer
   - Video element may be recreating on each render
   - Video stuck at readyState 0/1 forever

**Impact:**
- ❌ Videos never play (stuck waiting forever)
- ❌ canplay event never fires
- ❌ Problem #1 fix is completely blocked
- ❌ 60fps re-renders cause performance issues

**Fix Required URGENTLY:**
- Wrap VideoPlayer in React.memo() with proper comparison
- Stabilize component keys (ensure NO time-based values)
- Prevent useEffect from re-running on every render
- Consider using useRef to persist event listeners
- File: `video-player.tsx` (add React.memo wrapper)
- File: `preview-panel.tsx` lines 948-959 (check key stability)

---

### 3. **Missing Canvas Drawing Implementation**
**Problem:** Videos are rendered as DOM elements (`<video>` tags) instead of being drawn to canvas with `drawImage()`

**Evidence from Console:**
- No "step 13: drawing to canvas" logs present
- Only DOM element rendering logs visible
- VideoPlayer components render as HTML video elements

**Impact:** Canvas shows static snapshot, not live video frames

**Fix Required:**
- Implement requestAnimationFrame loop to draw video frames
- Use canvas.getContext('2d').drawImage(videoElement, ...)
- Add canvas drawing in preview-panel.tsx
- Create new canvas rendering system

---

### 4. **Excessive Component Re-rendering**
**Problem:** Preview panel and all child components re-render on every playback-update event (~60fps)

**Evidence from Console:**
```javascript
step 11: calculating active elements (60 times/second)
step 12: rendering element (60 times/second)
step 12a: rendering video element (60 times/second)
```

**Impact:** Performance degradation and state instability

**Fix Required:**
- Optimize activeElements calculation with better memoization
- Separate static UI from dynamic canvas rendering
- Throttle non-critical updates
- File: `preview-panel.tsx` lines 445-453

---

## 🟡 Important Problems (Should Fix)

### 5. **Unstable Video Element Keys**
**Problem:** VideoPlayer components may be using unstable keys causing unnecessary unmounting

**Potential Issue:**
```javascript
// If keys include time or other changing values:
<VideoPlayer key={`${element.id}-${currentTime}`} />
```

**Fix Required:**
- Ensure stable keys: `<VideoPlayer key={element.id} />`
- Verify no time-based or frequently changing values in keys

---

### 6. **Video State Synchronization Issues**
**Problem:** Timeline time and video currentTime can drift out of sync

**Evidence from Console:**
```javascript
step 4: video player synced {
  timelineTime: 2.033,
  videoTime: 2.066  // 33ms drift
}
```

**Fix Required:**
- Implement periodic re-synchronization
- Add drift correction algorithm
- File: `video-player.tsx` lines 87-113

---

### 7. **Event Listener Memory Leaks**
**Problem:** Multiple event listeners attached without proper cleanup

**Fix Required:**
- Ensure all event listeners are removed on unmount
- Use AbortController for better cleanup
- Check all useEffect cleanup functions

---

## 🟢 Performance Optimizations (Nice to Have)

### 8. **Implement Frame Caching**
**Problem:** No frame pre-rendering or caching system

**Fix Required:**
- Implement OffscreenCanvas for background rendering
- Cache frequently accessed frames
- Add predictive frame loading

---

### 9. **Optimize Console Logging**
**Problem:** Excessive console logging impacts performance

**Fix Required:**
- Add debug flag to enable/disable verbose logging
- Throttle high-frequency logs
- Use console.group() for better organization

---

### 10. **Bundle Size Optimization**
**Problem:** Main editor chunk is 1.7MB

**Fix Required:**
- Implement code splitting for editor components
- Lazy load heavy dependencies
- Optimize imports

---

## 📋 Implementation Priority Order

1. **Fix video readyState checking** (Problem #1)
   - Estimated time: 30 minutes
   - Impact: High
   - Complexity: Low

2. **Implement React.memo() on VideoPlayer** (Problem #2)
   - Estimated time: 1 hour
   - Impact: Critical
   - Complexity: Medium

3. **Add canvas drawing implementation** (Problem #3)
   - Estimated time: 2-3 hours
   - Impact: Critical
   - Complexity: High

4. **Optimize re-rendering** (Problem #4)
   - Estimated time: 2 hours
   - Impact: High
   - Complexity: Medium

5. **Fix component keys** (Problem #5)
   - Estimated time: 30 minutes
   - Impact: Medium
   - Complexity: Low

---

## 🧪 Testing Checklist

After implementing fixes, verify:

- [ ] Videos play without DOMException errors
- [ ] No "play() failed" messages in console
- [ ] Canvas shows video frames, not static image
- [ ] Smooth playback without stuttering
- [ ] Memory usage remains stable
- [ ] No component unmount/remount during playback
- [ ] Timeline and video stay synchronized
- [ ] Performance metrics: 60fps maintained

---

## 📊 Success Metrics

The fixes are successful when:

1. **Console shows:**
   ```javascript
   [CANVAS-VIDEO] play() { readyState: 4, playPromise: "resolved" }
   step 13: drawing to canvas { frameDrawn: true, fps: 60 }
   ```

2. **No errors containing:**
   - "play() failed"
   - "interrupted by new load request"
   - "readyState: 1"

3. **Performance:**
   - Canvas updates at 60fps
   - React DevTools shows minimal re-renders
   - Memory usage stable over time

---

## 🔗 Related Files

- `apps/web/src/components/ui/video-player.tsx`
- `apps/web/src/components/editor/preview-panel.tsx`
- `apps/web/src/stores/playback-store.ts`
- `apps/web/src/hooks/use-timeline-playhead.ts`

---

## 📝 Notes

- Enhanced logging is already implemented (v5)
- Build completes successfully with current code
- Issue is runtime behavior, not compilation
- Focus on Problems #1-3 for immediate fix

---

## 🚨 Console Output Analysis (Current State)

From the console output, we can see the repeated pattern:

1. **User clicks play** (line 123-124):
   ```
   [PLAYBACK] Play/Pause button clicked Object
   step 1: user initiated playback Object
   ```

2. **Timer starts** (line 125):
   ```
   step 2: playback timer started Object
   ```

3. **Video attempts to play** (line 130):
   ```
   [CANVAS-VIDEO] play() Object
   ```

4. **Play fails immediately** (line 132):
   ```
   [CANVAS-VIDEO] play() failed Object
   ```

5. **Pattern repeats 60 times per second** (lines 133-357)

This confirms all four critical problems are occurring simultaneously.