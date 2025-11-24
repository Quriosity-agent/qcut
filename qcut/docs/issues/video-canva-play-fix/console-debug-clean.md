# Canvas Video Playback Debug - Clean Console Analysis

## Purpose
Identify why canvas is displaying a static image instead of playing video

## Key Finding
**The video is stuck in an infinite loop of trying to play but never succeeding**

---

## 🔴 Critical Pattern Detected (Repeats 60x/second)

```
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event
[CANVAS-VIDEO] 🧹 Cleaned up canplay listener
```

This pattern shows:
1. Video detects it's not ready (readyState < 3)
2. Sets up canplay event listener
3. Component immediately re-renders
4. Listener is cleaned up before video can load
5. Repeats endlessly

---

## 📊 Essential Console Messages Only

### User Action
```
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked
playback-store.ts:134 step 1: user initiated playback
playback-store.ts:28 step 2: playback timer started
```

### Video Playback Attempt (First Frame)
```
video-player.tsx:264 [CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event
  currentReadyState: 0 or 1 (HAVE_NOTHING or HAVE_METADATA)
  needsReadyState: 3 (HAVE_FUTURE_DATA)
```

### Immediate Cleanup (16ms later)
```
video-player.tsx:304 [CANVAS-VIDEO] 🧹 Cleaned up canplay listener
```

### Continuous Loop (Every ~16ms)
```
Frame 1:  ⏳ Video not ready, waiting for canplay event
Frame 1:  🧹 Cleaned up canplay listener
Frame 2:  ⏳ Video not ready, waiting for canplay event
Frame 2:  🧹 Cleaned up canplay listener
Frame 3:  ⏳ Video not ready, waiting for canplay event
Frame 3:  🧹 Cleaned up canplay listener
... (repeats 60 times per second)
```

---

## ❌ What's Missing (Never Appears)

These messages SHOULD appear but never do:

```
// Never seen:
[CANVAS-VIDEO] ✅ canplay event fired, attempting play
[CANVAS-VIDEO] ✅ play() succeeded
[CANVAS-VIDEO] ✅ Video ready, playing immediately

// Never reaches:
step 13: drawing to canvas
```

---

## 🎯 Root Cause

**Component re-renders are destroying event listeners before videos can load**

### Why It Happens:
1. **60fps Re-renders**: Component updates every 16ms due to playback-update events
2. **useEffect Cleanup**: Each re-render triggers cleanup, removing canplay listener
3. **Video Never Loads**: Video needs 100-500ms to buffer, but listener removed after 16ms
4. **Stuck Forever**: Video stays at readyState 0/1, never reaching 3/4

### Evidence:
- Pattern repeats exactly 60 times per second (matching frame rate)
- Cleanup always occurs ~16ms after setup
- No canplay events ever fire
- No successful play() calls

---

## 🛠️ Required Fix

**Must prevent re-renders from removing event listeners**

Options:
1. **React.memo()** - Prevent unnecessary re-renders
2. **Stable useEffect deps** - Don't re-run effect on every render
3. **Persistent listeners** - Use refs to maintain listeners across renders
4. **Separate video component** - Isolate video from re-rendering parent

---

## 📈 Success Criteria

When fixed, console should show:

```
[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event
// ... time passes (100-500ms) ...
[CANVAS-VIDEO] ✅ canplay event fired, attempting play
[CANVAS-VIDEO] ✅ play() succeeded
step 13: drawing to canvas { frameDrawn: true }
```

NOT:
```
⏳ waiting → 🧹 cleaned up → ⏳ waiting → 🧹 cleaned up (infinite loop)
```

---

## 📝 Debug Checklist

- [x] Problem #1 fix working (no play() failed errors)
- [ ] canplay event fires (never happens)
- [ ] play() succeeds (never happens)
- [ ] Canvas draws frames (never happens)
- [ ] Video actually plays (blocked by re-renders)

---

## 💡 Key Insight

**The fix for Problem #1 (readyState check) is working perfectly.**
**But Problem #2 (re-renders) prevents it from ever succeeding.**

The video correctly waits for ready state, but the wait is interrupted every 16ms, creating an infinite loop where the video can never become ready.