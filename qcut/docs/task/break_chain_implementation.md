# Breaking Component Chain Reaction - Implementation Plan

## Problem Analysis
The component chain reaction is: **PreviewToolbar → TimelinePlayhead → TimelineTrack → AudioPlayer**

Root cause: `currentTime` updates at 60fps from playback store, triggering all components.

## Solution Strategy

### Phase 1: Debounce UI Updates (5 min)
- [x] Create `use-debounced-playback.ts` hook - DONE
- [x] Update PreviewToolbar to use debounced time - DONE
- [x] Add memo wrapper to PreviewToolbar - DONE

### Phase 2: Optimize TimelinePlayhead (10 min)
**File**: `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- [ ] Split visual position updates from state updates
- [ ] Use RAF for smooth animation without re-renders
- [ ] Remove unnecessary dependencies from useEffect

### Phase 3: Isolate TimelineTrack Updates (10 min)
**File**: `apps/web/src/components/editor/timeline/timeline-track.tsx`
- [ ] Remove currentTime subscription when not dragging
- [ ] Use local state for drag operations
- [ ] Memoize track element rendering

### Phase 4: Fix AudioPlayer Sync (5 min)
**File**: `apps/web/src/components/ui/audio-player.tsx`
- [ ] Use ref-based audio sync instead of state
- [ ] Update audio position without re-rendering component

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