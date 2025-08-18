# Infinite Render Loop Investigation Guide

## Error Pattern
```
Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
```

## Potential Sources to Investigate

### 1. Timeline Components
**Priority: HIGH** ⚠️

#### Files to Check:
- [ ] `apps/web/src/components/editor/timeline/index.tsx`
  - **Issue**: `getTotalDuration` function reference might be unstable
  - **Line**: ~324-329 (useEffect with getTotalDuration)
  - **Fix Applied**: Changed dependency from function to `tracks` array
  - **Verification**: Check if error persists after fix

- [ ] `apps/web/src/components/editor/timeline/timeline-track.tsx`
  - **Check for**: useEffect hooks with object/function dependencies
  - **Look for**: setState calls inside useEffect

- [ ] `apps/web/src/components/editor/timeline/timeline-element.tsx`
  - **Check for**: Resize/drag handlers creating new references
  - **Look for**: useEffect with inline functions

### 2. AI Generation Components  
**Priority: HIGH** ⚠️

#### Files to Check:
- [ ] `apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Issue**: Component was updating every second due to elapsed time
  - **Fix Applied**: Added React.memo wrapper
  - **Verification**: Check if memo is working correctly

- [ ] `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
  - **Issue**: Elapsed time timer updating state every second
  - **Fix Applied**: Reduced update frequency to 5 seconds
  - **Line**: ~96-111
  - **Verification**: Check if timer still causes issues

### 3. Store Subscriptions
**Priority: MEDIUM** ⚠️

#### Files to Check:
- [ ] `apps/web/src/stores/timeline-store.ts`
  - **Check for**: Computed getters that create new references
  - **Look for**: Functions returned from selectors

- [ ] `apps/web/src/stores/playback-store.ts`
  - **Check for**: Frequent state updates (currentTime)
  - **Look for**: Animation frame loops

- [ ] `apps/web/src/stores/panel-store.ts`
  - **Check for**: Panel width updates triggering re-renders

### 4. Audio/Video Components
**Priority: MEDIUM** ⚠️

#### Files to Check:
- [ ] `apps/web/src/components/editor/audio-waveform.tsx`
  - **Issue**: WaveSurfer initialization/cleanup
  - **Fix Applied**: Added proper cleanup and error handling
  - **Verification**: Check for memory leaks

- [ ] `apps/web/src/components/editor/preview-panel.tsx`
  - **Check for**: Video element updates
  - **Look for**: currentTime updates in useEffect

### 5. Panel Resize Components
**Priority: LOW**

#### Files to Check:
- [ ] `apps/web/src/components/editor/media-panel/index.tsx`
  - **Check for**: Panel resize handlers
  - **Look for**: Width calculations in useEffect

## Verification Steps

### Step 1: Add Debug Logging
Add this to suspected components:
```typescript
useEffect(() => {
  console.log(`[ComponentName] Effect triggered at ${Date.now()}`);
  // existing effect code
}, [dependencies]);
```

### Step 2: Check Dependency Stability
For each useEffect, verify:
1. No inline objects: `{}` or `[]`
2. No inline functions: `() => {}`
3. No unstable references from stores
4. Proper memoization of callbacks

### Step 3: Common Patterns to Fix

#### Pattern 1: Unstable Function References
```typescript
// BAD
const someFunction = () => { /* ... */ };
useEffect(() => {
  someFunction();
}, [someFunction]); // Creates infinite loop

// GOOD
const someFunction = useCallback(() => { /* ... */ }, []);
useEffect(() => {
  someFunction();
}, [someFunction]); // Stable reference
```

#### Pattern 2: Object Dependencies
```typescript
// BAD
useEffect(() => {
  // ...
}, [{ key: value }]); // New object every render

// GOOD
const config = useMemo(() => ({ key: value }), [value]);
useEffect(() => {
  // ...
}, [config]); // Stable reference
```

#### Pattern 3: Store Selectors
```typescript
// BAD
const getData = useStore(s => s.getData); // Function recreated
useEffect(() => {
  getData();
}, [getData]); // Infinite loop

// GOOD
const data = useStore(s => s.data); // Select data directly
useEffect(() => {
  // use data
}, [data]); // Stable value
```

## Testing Strategy

1. **Isolate Components**: Comment out components one by one
2. **Monitor Console**: Look for rapid repeated logs
3. **React DevTools**: Use Profiler to identify components rendering excessively
4. **Add Breakpoints**: Set breakpoints in useEffect to catch loops

## Current Status

### Fixed Issues:
- ✅ AI generation elapsed time timer (reduced frequency)
- ✅ Timeline getTotalDuration dependency (using tracks instead)
- ✅ AudioWaveform cleanup and memoization
- ✅ AiView component memoization
- ✅ Timeline component verified (only 10 renders - NOT the issue)

### Console Output Analysis:
```
[Timeline] Render #1-#3: Initial renders (normal)
[Timeline] Duration update from 0 to 10 (expected)
Maximum update depth exceeded at fl (minified component)
[Timeline] Render #4-#10: Normal stabilization
```

### Pending Investigation:
- ⚠️ Component `fl` in minified build still showing errors (NOT Timeline)
- ⚠️ Need to identify what `fl` maps to in source code
- ⚠️ Error occurs AFTER Timeline renders, suggesting different component

## Complete List of Files with useEffect Hooks

### High Priority Files (Core Editor Components)
1. [ ] `components/editor/timeline/index.tsx` - **Main timeline component**
2. [ ] `components/editor/timeline/timeline-track.tsx` - Track rendering
3. [ ] `components/editor/timeline/timeline-playhead.tsx` - Playhead updates
4. [ ] `components/editor/preview-panel.tsx` - Video preview updates
5. [ ] `components/editor/audio-waveform.tsx` - Audio visualization
6. [ ] `routes/editor.$project_id.lazy.tsx` - Main editor route

### Medium Priority Files (Media Panel)
7. [ ] `components/editor/media-panel/views/ai.tsx` - AI generation view
8. [ ] `components/editor/media-panel/views/use-ai-generation.ts` - AI hook
9. [ ] `components/editor/media-panel/views/use-ai-history.ts` - AI history
10. [ ] `components/editor/media-panel/views/sounds.tsx` - Sound effects
11. [ ] `components/editor/media-panel/views/media.tsx` - Media library
12. [ ] `components/editor/media-panel/views/stickers.tsx` - Stickers panel

### Hooks with useEffect (Check for Infinite Loops)
13. [ ] `hooks/use-timeline-playhead.ts` - **Playhead position updates**
14. [ ] `hooks/use-timeline-element-resize.ts` - Element resize handling
15. [ ] `hooks/use-timeline-zoom.ts` - Zoom level changes
16. [ ] `hooks/use-async-media-store.ts` - Media store loading
17. [ ] `hooks/use-async-ffmpeg.ts` - FFmpeg initialization
18. [ ] `hooks/use-sound-search.ts` - Sound search API calls
19. [ ] `hooks/use-export-settings.ts` - Export configuration
20. [ ] `hooks/use-debounce.ts` - Debounced values
21. [ ] `hooks/use-blob-image.ts` - Blob URL management

### Stickers Overlay Components
22. [ ] `components/editor/stickers-overlay/StickerCanvas.tsx`
23. [ ] `components/editor/stickers-overlay/AutoSave.tsx`
24. [ ] `components/editor/stickers-overlay/hooks/useStickerDrag.ts`

### Other Components to Check
25. [ ] `components/storage-provider.tsx` - Storage initialization
26. [ ] `components/editor-provider.tsx` - Editor context
27. [ ] `components/onboarding.tsx` - Onboarding flow
28. [ ] `components/export-canvas.tsx` - Export rendering

## Verification Script

### Timeline Component Debug Logging (ADDED)

The following debug code has been added to `apps/web/src/components/editor/timeline/index.tsx`:

```typescript
// Debug: Track render count to detect infinite loops
const renderCount = useRef(0);
const lastRenderTime = useRef(Date.now());

useEffect(() => {
  renderCount.current++;
  const now = Date.now();
  const timeSinceLastRender = now - lastRenderTime.current;
  lastRenderTime.current = now;
  
  // Log every 10 renders or if rendering too fast (< 100ms between renders)
  if (renderCount.current % 10 === 0 || timeSinceLastRender < 100) {
    console.log(`[Timeline] Render #${renderCount.current} at ${new Date().toISOString()} (${timeSinceLastRender}ms since last)`);
    if (timeSinceLastRender < 50) {
      console.warn(`[Timeline] ⚠️ Rapid re-rendering detected! Only ${timeSinceLastRender}ms between renders`);
    }
  }
  
  // Alert if excessive renders
  if (renderCount.current > 100) {
    console.error(`[Timeline] ❌ EXCESSIVE RENDERS: ${renderCount.current} renders detected!`);
    if (renderCount.current === 101) {
      console.trace('[Timeline] Stack trace for excessive renders:');
    }
  }
});

// Also added to duration update effect:
useEffect(() => {
  console.log('[Timeline] Duration update effect triggered');
  const totalDuration = getTotalDuration();
  const newDuration = Math.max(totalDuration, 10);
  console.log(`[Timeline] Setting duration from ${duration} to ${newDuration}`);
  
  // Only update if duration actually changed to prevent loops
  if (Math.abs(duration - newDuration) > 0.001) {
    setDuration(newDuration);
  } else {
    console.log('[Timeline] Duration unchanged, skipping update');
  }
}, [tracks, getTotalDuration, setDuration, duration]);
```

### Generic Debug Code for Other Components

Add this to other suspected components:

```typescript
// Add to top of component
const renderCount = useRef(0);
useEffect(() => {
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error(`[ComponentName] Excessive renders: ${renderCount.current}`);
    console.trace();
  }
});
```

## Next Steps

1. Build with source maps: `bun run build --sourcemap`
2. Use Chrome DevTools to map `hl` to source component
3. Add extensive logging to Timeline and AI components
4. Test each fix in isolation

## Command to Run Tests
```bash
# Development mode with better error messages
bun run electron:dev

# Production build to replicate exact error
bun run build && bun run electron
```

## Tracking Progress

Use this checklist to track which files have been verified:
- ✅ = Verified and fixed
- ⚠️ = Issues found, needs fix
- ✓ = Verified, no issues
- ❌ = Known problem, not yet fixed