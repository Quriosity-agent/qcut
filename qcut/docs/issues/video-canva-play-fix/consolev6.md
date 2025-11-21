# Console v6 - Problems to Fix for Canvas Video Playback

## Date: 2025-11-21
## Issue: Canvas displays single static image instead of playing video

Based on the enhanced console logging implemented in v5, we've identified the following critical problems that need to be fixed:

---

## 🔴 Critical Problems (Must Fix)

### 1. **Video Elements Not Ready for Playback**
**Problem:** Videos attempt to play when `readyState: 1` (HAVE_METADATA) instead of waiting for `readyState: 3` (HAVE_FUTURE_DATA) or `4` (HAVE_ENOUGH_DATA)

**Evidence from Console:**
```javascript
[CANVAS-VIDEO] play() failed {
  error: "DOMException: The play() request was interrupted",
  videoState: { readyState: 1, paused: true }
}
```

**Impact:** Videos never start playing, showing only first frame

**Fix Required:**
- Implement `canplay` event listener before calling play()
- Check readyState >= 3 before attempting playback
- File: `video-player.tsx` lines 228-251

---

### 2. **React Re-renders Interrupting Play Promises**
**Problem:** Components re-render 60 times per second, causing video elements to unmount/remount and interrupting play() promises

**Evidence from Console:**
```javascript
Frame 1: [CANVAS-VIDEO] play() { playPromise: "pending" }
Frame 2: [re-render triggered by playback-update]
Frame 2: [CANVAS-VIDEO] play() failed { error: "interrupted by new load request" }
```

**Impact:** Continuous play() → fail cycle prevents video playback

**Fix Required:**
- Wrap VideoPlayer in React.memo() with proper comparison
- Stabilize component keys (remove currentTime from keys)
- Prevent unnecessary re-renders during playback
- File: `preview-panel.tsx` lines 948-959

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