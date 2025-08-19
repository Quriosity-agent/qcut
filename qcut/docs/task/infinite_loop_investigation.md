# Infinite Render Loop Investigation Guide

## Error Pattern
```
Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
```

## Potential Sources to Investigate

### ✅ COMPLETED - Fixed & Verified Components

#### Timeline Components:
- ✅ `apps/web/src/components/editor/timeline/index.tsx` - Fixed & 10 renders (SAFE)
- ✅ `apps/web/src/components/editor/timeline/timeline-track.tsx` - Multiple instances 2-6 renders (SAFE)

#### AI Generation Components:
- ✅ `apps/web/src/components/editor/media-panel/views/ai.tsx` - Fixed & Not rendering (SAFE)
- ✅ `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` - Fixed timer

#### Audio/Video Components:
- ✅ `apps/web/src/components/editor/audio-waveform.tsx` - Fixed & 3 renders (SAFE)
- ✅ `apps/web/src/components/editor/preview-panel.tsx` - 12 renders (SAFE)

#### Panel Components:
- ✅ `apps/web/src/components/editor/media-panel/index.tsx` - 7 renders (SAFE)
- ✅ `apps/web/src/components/ui/audio-player.tsx` - 3 renders (SAFE)

#### Other UI Components:
- ✅ `apps/web/src/components/editor/preview-panel-components.tsx` (PreviewToolbar) - 11 renders (SAFE)
- ✅ `apps/web/src/components/editor/properties-panel/index.tsx` - 11 renders (SAFE)

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

### ✅ Fixed Issues:
- ✅ AI generation elapsed time timer (reduced from 1s to 5s)
- ✅ Timeline getTotalDuration dependency (using tracks instead of function)
- ✅ AudioWaveform cleanup and memoization
- ✅ AiView component memoization

### ✅ ALL Major Components Verified SAFE (v5-v7 console logs):

**UI Components (v5):**
- **Timeline**: 10 renders ✅ | **MediaPanel**: 7 renders ✅ | **PreviewPanel**: 12 renders ✅
- **PropertiesPanel**: 11 renders ✅ | **PreviewToolbar**: 11 renders ✅ | **AudioPlayer**: 3 renders ✅  
- **TimelineTrack** (multiple): 2-8 renders each ✅ | **AudioWaveform**: 3 renders ✅

**Complex Components (v6):**
- **TimelinePlayhead**: 12 renders ✅ (NOT the culprit despite complex logic!)

**Root Components (v7):**
- **EditorProvider**: 9 renders ✅ | **EditorPage**: 7 renders ✅

### 🔴 Still Has Infinite Loop - Component 'fl' Mystery:
```
Warning: Maximum update depth exceeded at fl 
(file:///editor._project_id.lazy-CbOJ0Xqf.js:13:102893)
```

**CRITICAL FINDINGS:**
- ❌ Component `fl` is NOT any tested component (all show normal 2-12 renders)
- ❌ Error appears AFTER EditorProvider renders 5 times (v7 line 63-66)
- ❌ Must be a tiny utility component or third-party wrapper
- ❌ Likely candidates: Resizable panels, Dialog components, or small UI utilities

## Complete List of Files with useEffect Hooks

### ⚠️ NEW SUSPECTS - Small/Utility Components:
Since ALL major components are SAFE, `fl` must be:
1. **Resizable Panel Components** - Used throughout the layout
2. **Dialog/Modal Components** - Onboarding, alerts, etc.
3. **Small UI Utilities** - Tooltips, dropdowns, etc.
4. **Third-party library wrappers** - Radix UI, etc.

### ⚠️ HOOKS - NEED TESTING
11. [ ] `hooks/use-timeline-playhead.ts` - **Playhead position updates**
12. [ ] `hooks/use-timeline-element-resize.ts` - Element resize handling
13. [ ] `hooks/use-timeline-zoom.ts` - Zoom level changes
14. [ ] `hooks/use-async-media-store.ts` - Media store loading
15. [ ] `hooks/use-async-ffmpeg.ts` - FFmpeg initialization
16. [ ] `hooks/use-sound-search.ts` - Sound search API calls
17. [ ] `hooks/use-export-settings.ts` - Export configuration
18. [ ] `hooks/use-debounce.ts` - Debounced values
19. [ ] `hooks/use-blob-image.ts` - Blob URL management

### ⚠️ STICKERS OVERLAY - NEED TESTING
20. [ ] `components/editor/stickers-overlay/StickerCanvas.tsx`
21. [ ] `components/editor/stickers-overlay/AutoSave.tsx`
22. [ ] `components/editor/stickers-overlay/hooks/useStickerDrag.ts`

### ⚠️ OTHER COMPONENTS - NEED TESTING
23. [ ] `components/storage-provider.tsx` - Storage initialization
24. [ ] `components/editor-provider.tsx` - Editor context
25. [ ] `components/onboarding.tsx` - Onboarding flow
26. [ ] `components/export-canvas.tsx` - Export rendering

## 🎯 Next Investigation Strategy:

Since ALL major components are verified SAFE, we need to:

1. **Build with source maps**: `bun run build --sourcemap` to identify `fl`
2. **Check Resizable components** - They're used everywhere in the layout
3. **Check Dialog/Modal components** - Could be Onboarding or other dialogs
4. **Look for components with 2-letter names** that minify to `fl`

## 🔴 Component 'fl' Profile:
- **Renders early** (error at EditorProvider render #5)
- **Very small component** (short minified name)
- **NOT a major UI component** (all tested and safe)
- **Likely a utility or wrapper component**

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