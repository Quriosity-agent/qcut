# Infinite Loop Fix Implementation Plan

Based on v10 log analysis, this plan addresses the systemic rapid re-rendering issue affecting all components through shared state management fixes.

## 🎯 **OVERVIEW**
- **Root Cause**: Unstable Zustand selectors causing cascading component updates
- **Impact**: ALL components rendering within 0-30ms intervals
- **Strategy**: Fix selectors, upgrade library, isolate components, add debouncing
- **Estimated Total Time**: 90 minutes (9 subtasks × 10 minutes each)

---

## 📋 **IMPLEMENTATION TASKS**

### **Task 1: Audit Timeline Store Selectors (10 min)**
**File**: `apps/web/src/stores/timeline-store.ts`

**Problem**: Timeline store likely has unstable selectors causing TimelinePlayhead and TimelineTrack rapid renders

**Action**:
- Review all selector functions for object/array recreation
- Look for functions returned from selectors
- Check for computed values that recreate on every access

**Expected Fix**: Identify 3-5 unstable selectors that need memoization

---

### **Task 2: Fix Timeline Component Selectors (10 min)**  
**Files**: 
- `apps/web/src/components/editor/timeline/index.tsx`
- `apps/web/src/components/editor/timeline/timeline-playhead.tsx` 
- `apps/web/src/components/editor/timeline/timeline-track.tsx`

**Problem**: Components using unstable selectors from timeline store

**Action**:
```typescript
// BEFORE (creates new object every render)
const { tracks, selectedElements } = useTimelineStore(s => ({ 
  tracks: s.tracks, 
  selectedElements: s.selectedElements 
}));

// AFTER (stable primitive selections)
const tracks = useTimelineStore(s => s.tracks);
const selectedElements = useTimelineStore(s => s.selectedElements);
```

**Expected Fix**: Replace 5-8 object destructuring selectors with stable primitives

---

### **Task 3: Fix Playback Store Selectors (10 min)**
**File**: `apps/web/src/stores/playback-store.ts`

**Problem**: Playback store selectors affecting PreviewPanel, MediaPanel rapid renders

**Action**:
- Check `currentTime`, `duration`, `isPlaying` selectors
- Look for computed playback state objects
- Ensure function references are stable

**Expected Fix**: Memoize 2-3 computed selectors causing updates

---

### **Task 4: Fix Panel Component Store Usage (10 min)**
**Files**:
- `apps/web/src/components/editor/media-panel/index.tsx`
- `apps/web/src/components/editor/preview-panel.tsx`
- `apps/web/src/components/editor/properties-panel/index.tsx`

**Problem**: Panel components using multiple unstable store selectors

**Action**:
```typescript
// BEFORE (multiple store calls with object creation)
const playbackState = usePlaybackStore(s => ({ 
  time: s.currentTime, 
  playing: s.isPlaying 
}));

// AFTER (individual stable selectors)  
const currentTime = usePlaybackStore(s => s.currentTime);
const isPlaying = usePlaybackStore(s => s.isPlaying);
```

**Expected Fix**: Replace 6-10 complex selectors across 3 panel components

---

### **Task 5: Add React.memo to High-Render Components (10 min)**
**Files**:
- `apps/web/src/components/editor/timeline/timeline-track.tsx`
- `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- `apps/web/src/components/ui/audio-player.tsx`

**Problem**: Components re-rendering unnecessarily due to parent updates

**Action**:
```typescript
// BEFORE
export function TimelineTrack({ trackId }) {
  // component logic
}

// AFTER  
export const TimelineTrack = React.memo(function TimelineTrack({ trackId }) {
  // component logic
});
```

**Expected Fix**: Add memoization to 3-4 frequently rendering components

---

### **Task 6: Upgrade react-resizable-panels Library (10 min)**
**File**: `apps/web/package.json`

**Problem**: Current version 2.1.7 has known "Maximum update depth exceeded" bugs

**Action**:
```bash
cd apps/web
bun remove react-resizable-panels
bun add react-resizable-panels@^3.0.4
```

**Verification**: Check if component `al` infinite loop warning disappears

**Expected Fix**: Eliminate remaining react-resizable-panels infinite loop

---

### **Task 7: Add Debouncing to Timeline Updates (10 min)**
**File**: `apps/web/src/hooks/use-timeline-playhead.ts`

**Problem**: Timeline updates triggering too frequently causing render cascades

**Action**:
```typescript
import { useDeferredValue } from 'react';

// BEFORE
const currentTime = usePlaybackStore(s => s.currentTime);

// AFTER (debounced updates)
const currentTimeRaw = usePlaybackStore(s => s.currentTime);
const currentTime = useDeferredValue(currentTimeRaw);
```

**Expected Fix**: Reduce timeline update frequency by 50-70%

---

### **Task 8: Isolate Audio Components State (10 min)**
**Files**:
- `apps/web/src/components/editor/audio-waveform.tsx`
- `apps/web/src/components/ui/audio-player.tsx`

**Problem**: Audio components caught in main UI render cycles

**Action**:
- Move audio-specific state to local useState instead of global stores
- Use useCallback for audio event handlers
- Add useMemo for expensive audio calculations

**Expected Fix**: Isolate audio renders from main UI update cycles

---

### **Task 9: Test and Validate Fixes (10 min)**
**Files**: All modified files

**Action**:
1. **Build and Test**:
   ```bash
   cd qcut
   bun run build
   bun run electron:dev
   ```

2. **Create v11 Log**: Check console for:
   - Elimination of "Maximum update depth exceeded" warnings
   - Reduced rapid re-rendering messages
   - Normal component render counts (1-3 per component)

3. **Performance Check**:
   - Test panel resizing smoothness
   - Test timeline scrubbing performance  
   - Test audio playback responsiveness

**Expected Result**: Clean console with no infinite loop warnings and normal render patterns

---

## 🎯 **SUCCESS CRITERIA**

### **Before (v10 logs)**:
- ❌ "Maximum update depth exceeded" warnings
- ❌ 5-12 rapid renders per component (0-30ms intervals)
- ❌ All components rendering in synchronized bursts

### **After (v11 target)**:
- ✅ No infinite loop warnings
- ✅ 1-3 renders per component on startup
- ✅ Independent component rendering (no synchronized bursts)
- ✅ Smooth panel resizing and timeline interaction

---

## 📁 **FILES TO MODIFY SUMMARY**

| Component | File Path | Task |
|-----------|-----------|------|
| Timeline Store | `apps/web/src/stores/timeline-store.ts` | Task 1 |
| Timeline Components | `apps/web/src/components/editor/timeline/*.tsx` | Task 2 |
| Playback Store | `apps/web/src/stores/playback-store.ts` | Task 3 |
| Panel Components | `apps/web/src/components/editor/*-panel/*.tsx` | Task 4 |
| High-Render Components | `apps/web/src/components/editor/timeline/*.tsx` | Task 5 |
| Package Dependencies | `apps/web/package.json` | Task 6 |
| Timeline Hooks | `apps/web/src/hooks/use-timeline-playhead.ts` | Task 7 |
| Audio Components | `apps/web/src/components/*/audio*.tsx` | Task 8 |
| All Modified Files | Various | Task 9 |

---

## ⏱️ **EXECUTION ORDER**

**Phase 1 (30 min)**: Store Analysis & Fixes
- Task 1: Audit Timeline Store Selectors  
- Task 2: Fix Timeline Component Selectors
- Task 3: Fix Playback Store Selectors

**Phase 2 (30 min)**: Component Optimizations  
- Task 4: Fix Panel Component Store Usage
- Task 5: Add React.memo to High-Render Components
- Task 6: Upgrade react-resizable-panels Library

**Phase 3 (30 min)**: Advanced Optimizations & Testing
- Task 7: Add Debouncing to Timeline Updates
- Task 8: Isolate Audio Components State  
- Task 9: Test and Validate Fixes

---

## 🚨 **ROLLBACK PLAN**

If any task causes breaking changes:

1. **Immediate Rollback**:
   ```bash
   git checkout HEAD~1  # Revert last commit
   ```

2. **Selective Rollback**:
   ```bash
   git checkout HEAD -- <file_path>  # Revert specific file
   ```

3. **Library Rollback**:
   ```bash
   bun remove react-resizable-panels
   bun add react-resizable-panels@2.1.7
   ```

Each task should be committed separately to enable granular rollbacks.