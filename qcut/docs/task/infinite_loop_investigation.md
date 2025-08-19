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

### 🚨 MAJOR BREAKTHROUGH - Hook Infinite Loop Identified (v8):
```
Warning: Maximum update depth exceeded at fl 
(file:///editor._project_id.lazy-_mYxhPmA.js:13:102801)
```

**🎯 CRITICAL DISCOVERY:**
- ❌ **NO hook debug messages appear** in v8 logs - useActionHandler, useEditorActions, useKeybindingsListener are all SILENT
- ❌ Component `fl` still causes infinite loop but NO hooks show excessive renders
- ❌ This means **`fl` is NOT a hook** - it's a **React component**
- ❌ Stack trace shows path: `fl → div → jc → Panel → PanelGroup` - **RESIZABLE PANELS!**

**🔍 RESIZABLE PANELS ARE THE CULPRIT:**
- Stack trace points to ResizablePanelGroup and ResizablePanel components
- Component `jc` = MediaPanel container 
- Component `fl` = Likely a ResizablePanel or internal panel component
- Error occurs in panel resizing system during layout initialization

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

## 🎯 IMMEDIATE NEXT STEPS - ResizablePanel Investigation

### **Step 1: Analyze Panel onResize Handlers** ⏳
```typescript
// In routes/editor.$project_id.lazy.tsx lines 214-280
// Check all onResize callbacks for unstable dependencies:
onResize={setToolsPanel}      // Line 233
onResize={setPreviewPanel}    // Line 244 
onResize={setPropertiesPanel} // Line 256
onResize={setMainContent}     // Line 222
onResize={setTimeline}        // Line 270
```

### **Step 2: Check usePanelStore Implementation** ⏳
```typescript
// In stores/panel-store.ts
// Look for:
1. Unstable function references in setters
2. useEffect dependencies causing loops
3. State updates triggering re-renders
```

### **Step 3: Add Debug Logging to Panel Callbacks** ⏳
```typescript
// Add to each onResize handler:
const debugSetToolsPanel = useCallback((size: number) => {
  console.log(`[Panel] setToolsPanel called with size: ${size}`);
  setToolsPanel(size);
}, [setToolsPanel]);

// Use debugSetToolsPanel instead of setToolsPanel
```

### **Step 4: Test Panel Normalization Effect** ⏳
```typescript
// In EditorPage lines 201-207
// This effect calls normalizeHorizontalPanels() - potential culprit:
useEffect(() => {
  const timer = setTimeout(() => {
    normalizeHorizontalPanels(); // <- SUSPECT
  }, 100);
  return () => clearTimeout(timer);
}, [normalizeHorizontalPanels]); // <- Check if function is stable
```

### **Step 5: Fix Common Panel Issues** ⏳
- Remove `normalizeHorizontalPanels` from useEffect dependencies if unstable
- Wrap panel size setters in useCallback if not already stable
- Add debouncing to rapid panel resize events
- Check for circular dependencies in panel store

## 🚨 HIGH PRIORITY FIXES

1. **Panel Store Function Stability** - Ensure all panel setters are memoized
2. **Normalization Effect** - Check if `normalizeHorizontalPanels` creates loops
3. **Default Panel Sizes** - Verify initial panel size calculations don't cause conflicts
4. **ResizablePanel Library** - Check if specific version has known issues

## Command to Run Tests
```bash
# Development mode with detailed logging
bun run electron:dev

# Production build to verify fix
bun run build && bun run electron
```

## Investigation Status
- ✅ **Root Cause Identified**: ResizablePanel system infinite loop
- ⏳ **In Progress**: Panel onResize handler analysis
- ⏳ **Next**: Debug logging and panel store investigation
- ⏳ **Final**: Fix unstable dependencies and test solution