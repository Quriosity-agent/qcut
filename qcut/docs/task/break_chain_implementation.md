# Breaking Component Chain Reaction - Implementation Plan

## Problem Analysis
The component chain reaction is: **PreviewToolbar → TimelinePlayhead → TimelineTrack → AudioPlayer**

Root cause: `currentTime` updates at 60fps from playback store, triggering all components.

## Solution Strategy

### Phase 1: Debounce UI Updates (5 min) ✅
- [x] Create `use-debounced-playback.ts` hook - DONE
- [x] Update PreviewToolbar to use debounced time - DONE
- [x] Add memo wrapper to PreviewToolbar - DONE

### Phase 2: Optimize TimelinePlayhead (10 min) ✅
**File**: `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- [x] Split visual position updates from state updates - Using RAF loop
- [x] Use RAF for smooth animation without re-renders - 60fps animation without React
- [x] Remove unnecessary dependencies from useEffect - Using refs for state

### Phase 3: Isolate TimelineTrack Updates (10 min) ✅
**File**: `apps/web/src/components/editor/timeline/timeline-track.tsx`
- [x] Remove currentTime subscription when not dragging - Only subscribes during drag
- [x] Use local state for drag operations - Created getCurrentTimeForSplit()
- [x] Memoize track element rendering - Already memoized

### Phase 4: Fix AudioPlayer Sync (5 min) ✅
**File**: `apps/web/src/components/ui/audio-player.tsx`
- [x] Use ref-based audio sync instead of state - All state in refs
- [x] Update audio position without re-rendering component - RAF loop for updates

### Phase 5: Update Preview Panel (5 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
- [ ] Use debounced time for UI display
- [ ] Keep exact time only for video element

## Testing Strategy
1. Run build after each phase
2. Check console for rapid re-rendering warnings
3. Verify playback still works smoothly
4. Test drag operations still function

## Success Criteria
- No more "rapid re-rendering" warnings (< 50ms)
- Playback remains smooth
- Timeline interactions still responsive
- Build completes without errors

## Implementation Results

### ✅ Phases Completed (1-4)

**Phase 1: Debounced UI Updates**
- Created `use-debounced-playback.ts` hook reducing updates from 60fps to 10fps
- Added memo wrapper to PreviewToolbar
- Broke initial chain at the source

**Phase 2: TimelinePlayhead Optimization**
- Implemented RAF-based animation loop for smooth 60fps movement
- Position updates via CSS transform without React re-renders
- All state stored in refs to prevent render cascades

**Phase 3: TimelineTrack Isolation**
- Removed currentTime subscription except during drag operations
- Created `getCurrentTimeForSplit()` for on-demand time access
- Prevented 60fps re-renders during normal playback

**Phase 4: AudioPlayer RAF Sync**
- Converted all state to refs (no re-renders on state change)
- RAF loop syncs audio position during playback
- Direct audio element control without React involvement

### 🎯 Performance Improvements

**Before Optimization:**
- Components re-rendering at 60fps during playback
- Chain reaction: PreviewToolbar → TimelinePlayhead → TimelineTrack → AudioPlayer
- Console filled with "rapid re-rendering" warnings

**After Optimization:**
- UI components update at 10fps (smooth enough for display)
- Critical animations run at 60fps via RAF (no React re-renders)
- Audio sync handled outside React render cycle
- Drag operations isolated from playback updates

### 📊 Build Status: ✅ All Successful