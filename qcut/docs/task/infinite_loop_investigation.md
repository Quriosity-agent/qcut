# Infinite Render Loop Investigation Guide

## 📊 INVESTIGATION SUMMARY

**🔴 Problem**: Infinite render loop warning in QCut video editor
**🎯 Root Cause**: ResizablePanel system from `react-resizable-panels` library
**📍 Location**: Component `fl` in MediaPanel container during layout initialization
**⚡ Status**: Root cause identified, fix in progress

### **Investigation Timeline:**
- **v1-v4**: Fixed CSP, useEffect dependencies, React optimizations
- **v5**: Systematically tested all major UI components (all SAFE)
- **v6**: Tested TimelinePlayhead and complex components (all SAFE) 
- **v7**: Tested root components EditorPage & EditorProvider (all SAFE)
- **v8**: Added hook debugging - **BREAKTHROUGH**: No hooks show excessive renders
- **Result**: Component `fl` identified as ResizablePanel causing infinite loop

## Error Pattern
```
Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
    at fl (ResizablePanel component)
    at jc (MediaPanel container)  
    at Panel/PanelGroup (react-resizable-panels)
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

### 🚨 V10 BREAKTHROUGH - PANEL NORMALIZATION FIX SUCCESSFUL!
```
Warning: Maximum update depth exceeded at al 
(file:///editor._project_id.lazy-DPQruEQc.js:13:102801)
```

**✅ PANEL NORMALIZATION FIX PARTIALLY SUCCESSFUL:**
- ✅ **Component changed from `fl` to `al`** - Different component now causing the issue
- ✅ **Panel normalization removal** reduced the problem but didn't eliminate it completely
- ❌ **New culprit identified** - Component `al` is still triggering infinite loops
- ❌ **Rapid re-rendering detected** across ALL components - systemic issue remains

**🔍 V10 ANALYSIS - CRITICAL EVIDENCE:**
- ❌ **ALL components showing rapid re-rendering** - MediaPanel, PreviewPanel, PropertiesPanel, TimelinePlayhead, etc.
- ❌ **Renders happening within 0-30ms intervals** - This indicates a broader state management issue
- ❌ **Multiple components rendering simultaneously** - Suggests shared state causing cascading updates
- ❌ **Pattern shows 1-12 renders per component** - Not infinite, but excessive

**🔍 V10 NEW PATTERN DISCOVERED:**
- 🚨 **Rapid re-rendering burst at startup** (lines 1-27) - MediaPanel, PreviewPanel, PropertiesPanel render 3-4 times in quick succession
- 🚨 **Component chains triggering together** - When one renders, others follow within milliseconds
- 🚨 **Timeline components also affected** - TimelinePlayhead, TimelineTrack showing rapid renders
- 🚨 **Audio components caught in the loop** - AudioPlayer, AudioWaveform also rapid rendering

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

## 🎯 NEXT STEPS - Focus on ResizablePanel System:

**CONFIRMED TARGET:** ResizablePanel components are causing the infinite loop

### **Immediate Actions:**
1. **Examine ResizablePanel usage** in EditorPage layout (lines 214-280)
2. **Check react-resizable-panels library** for known issues with panel size calculations
3. **Look for useEffect dependencies** in panel onResize handlers
4. **Add debug logging** to all panel onResize callbacks

### **Likely Root Cause:**
- Panel size calculations creating dependency loops
- onResize callbacks triggering state updates that cause re-renders
- Unstable panel size references in useEffect dependencies

## 🔴 Component 'fl' IDENTIFIED:
- **ResizablePanel component** from react-resizable-panels library
- **Triggers during layout initialization** when panels calculate sizes
- **Located in MediaPanel container** (component `jc`)
- **Caused by panel size/resize handling**

## 🎯 NEXT INVESTIGATION STEPS - Shared State Analysis

### **COMPLETED STEPS:**
- ✅ **Step 1**: Panel onResize handlers analyzed - callbacks working correctly
- ✅ **Step 2**: Added debug logging to all panel callbacks - no excessive calls detected  
- ✅ **Step 3**: Fixed normalizeHorizontalPanels dependency - **PARTIALLY SUCCESSFUL** (changed component from `fl` to `al`)
- ✅ **Step 4**: Confirmed panel setters are stable and properly wrapped in useCallback
- ✅ **Step 5**: Library version investigation - react-resizable-panels v2.1.7 has known issues, latest is v3.0.4

### **NEW INVESTIGATION TARGET - Shared State Management:**

**🔍 Evidence from v10 Logs:**
- **BREAKTHROUGH**: Panel normalization fix changed the problematic component from `fl` to `al`
- **NEW PROBLEM**: ALL components showing rapid re-rendering (0-30ms intervals)
- **ROOT CAUSE**: Shared state causing cascading updates across entire component tree
- **PATTERN**: Components render in groups, suggesting shared dependencies

### **Step 1: Identify Shared State Dependencies** 🎯
```typescript
// Focus on stores used by multiple components:
1. useTimelineStore - Used by Timeline, TimelinePlayhead, TimelineTrack
2. usePlaybackStore - Used by PreviewPanel, TimelinePlayhead, MediaPanel
3. useProjectStore - Used by EditorPage and most child components
4. usePanelStore - Used by all panel components
```

### **Step 2: Check for Unstable Selectors** 🎯
```typescript
// Look for selector patterns that recreate objects/functions:
// BAD:
const data = useStore(s => ({ tracks: s.tracks, time: s.time })); // New object every render
const handler = useStore(s => s.getHandler); // Function reference

// GOOD:
const tracks = useStore(s => s.tracks); // Primitive/stable reference
const time = useStore(s => s.time);
```

### **Step 3: Analyze Component Mount/Update Chain** 🎯
```typescript
// Based on v10 logs, investigate why these render together:
1. MediaPanel → PreviewPanel → PropertiesPanel (synchronized renders)
2. TimelinePlayhead → TimelineTrack (coupled updates)
3. AudioPlayer → AudioWaveform (audio chain updates)
```

### **Step 4: Test Zustand Store Isolation** 🎯
```typescript
// Temporarily disable store subscriptions to isolate:
1. Comment out useTimelineStore calls in Timeline components
2. Use static data instead of store subscriptions
3. Test if rapid rendering stops
```

## 🚨 HIGH PRIORITY FIXES

### **IMMEDIATE ACTIONS REQUIRED:**

1. **🔥 CRITICAL: Fix Shared State Selectors**
   - Audit all Zustand store selectors for object/function recreation
   - Replace unstable selectors with stable primitive selections
   - Add selector memoization where needed

2. **📦 LIBRARY UPGRADE**
   - Upgrade react-resizable-panels from v2.1.7 to v3.0.4
   - Test if library upgrade resolves remaining "al" component infinite loop

3. **⚡ COMPONENT ISOLATION**
   - Break dependency chains between MediaPanel → PreviewPanel → PropertiesPanel
   - Isolate Timeline component updates from main UI updates
   - Add React.memo to prevent unnecessary re-renders

4. **🛡️ STATE UPDATE DEBOUNCING**
   - Add debouncing to rapid state updates (especially timeline/playback)
   - Implement update batching for related state changes
   - Use React 18's automatic batching more effectively

## Command to Run Tests
```bash
# Development mode with detailed logging
bun run electron:dev

# Production build to verify fix
bun run build && bun run electron
```

## v11 Analysis - CRITICAL: Tasks 1-6 Failed, Maximum Update Depth Error

The v11 logs reveal that **Tasks 1-6 implementation FAILED** - the optimization attempts have escalated the issue to React's maximum update depth limit.

### Critical Errors Found
1. **Maximum update depth exceeded** (line 54): React threw fatal error due to infinite setState calls
2. **getSnapshot infinite loop warning** (line 3): Still occurring despite selector fixes
3. **useEffect dependency array issue** (line 65): "Maximum update depth" in useEffect with changing dependencies

### Failure Analysis
- **Tasks 1-6 made the problem WORSE**, not better
- The store selector fixes created **NEW infinite loops** instead of fixing existing ones
- React is now **crashing with fatal errors** instead of just warnings

### Root Cause Evolution
**Original**: Panel library rapid re-rendering (0-30ms intervals)
**Current**: Store selector infinite loops causing React to hit maximum update depth

### Immediate Priority
**URGENT**: Revert all store selector changes from Tasks 1-6 and find the **actual source** of the infinite loops before attempting optimization.

## v12 Analysis - POST-REVERT: Original Problem Confirmed, Component Pattern Identified

The v12 logs confirm that **reverting Tasks 1-6 was successful** - we're back to the original problem state without the fatal React crashes.

### Key Findings
1. **Maximum update depth warning returned** (line 1): Back to `al` component warnings, not fatal crashes
2. **Original rapid re-rendering pattern restored** (lines 55-136): Multiple components rendering 1-50ms intervals
3. **Component interaction pattern identified**: PreviewToolbar → TimelinePlayhead → TimelineTrack cascade

### Specific Component Behavior Observed
- **PreviewToolbar**: 11 renders in rapid succession (12-33ms intervals)
- **TimelinePlayhead**: 4 renders triggered by PreviewToolbar changes
- **TimelineTrack**: Multiple track instances showing synchronized rendering (0-38ms intervals)
- **AudioPlayer**: 2 renders during component cascade

### Critical Pattern Discovery
**Component Chain Reaction**: PreviewToolbar renders trigger TimelinePlayhead, which triggers TimelineTrack instances, creating a cascade effect where each component change triggers others in rapid succession.

### Root Cause Narrowed Down
The issue is **NOT in store selectors** but in **component interdependencies** - when one timeline component updates, it triggers a chain reaction across related components.

## Investigation Status
- ✅ **Root Cause Identified**: Shared state management causing cascading component updates
- ✅ **Panel Normalization Fix**: Partially successful - changed problematic component from `fl` to `al` 
- ✅ **Library Issues Confirmed**: react-resizable-panels v2.1.7 has known "Maximum update depth exceeded" bugs
- ❌ **Broader Issue Discovered**: ALL components showing rapid re-rendering (0-30ms intervals)
- ✅ **REVERT SUCCESSFUL**: Tasks 1-6 reverted, back to original problem state without crashes
- 🎯 **NEW DISCOVERY**: Component chain reaction pattern identified (PreviewToolbar → TimelinePlayhead → TimelineTrack)
- 🎯 **REFINED TARGET**: Component interdependencies causing cascade re-rendering, not store selectors
- 🎯 **Next**: Break component dependency chain to prevent cascade re-rendering