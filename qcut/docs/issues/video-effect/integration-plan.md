# Video Effects System Integration Plan

## Overview
This document outlines a safe, incremental integration strategy for PR #582's video effects system. Each task is broken down into subtasks that can be completed in under 10 minutes, with emphasis on code reuse and maintaining existing functionality.

## Integration Principles
1. **No Breaking Changes**: All existing features must continue working
2. **Maximum Code Reuse**: Leverage existing stores, components, and utilities
3. **Incremental Testing**: Test after each subtask completion
4. **Rollback Points**: Each subtask should be independently revertible
5. **Type Safety First**: Add types before implementation

## Phase 1: Type Definitions & Core Setup (30 mins total)

### Task 1.1: Add Effect Types (5 mins)
- [ ] Copy `effects.ts` to `src/types/effects.ts`
- [ ] Review and ensure no conflicts with existing types
- [ ] Run type check: `bun check-types`

**Code to reuse from existing codebase:**
```typescript
// From src/types/timeline.ts - follow similar pattern
export interface TimelineElement {
  id: string;
  type: ElementType;
  // ... existing properties
}

// Add to effects.ts following same pattern:
export interface TimelineEffect {
  id: string;
  elementId: string; // links to TimelineElement.id
  // ... effect properties
}
```

**Modifications needed:**
```typescript
// In src/types/index.ts (if exists), add:
export * from './effects';
```

### Task 1.2: Update Existing Type Exports (5 mins)
- [ ] Add export from `src/types/index.ts` if it exists
- [ ] Ensure no naming conflicts with media/timeline types
- [ ] Verify imports in existing stores still work

**Check for conflicts with:**
```typescript
// src/types/media.ts
MediaType, MediaElement // ensure no Effect conflicts

// src/types/timeline.ts  
ElementType, TimelineElement // ensure compatible
```

**Safe integration pattern:**
```typescript
// Instead of modifying existing types, extend them:
import { TimelineElement } from './timeline';

export interface TimelineElementWithEffects extends TimelineElement {
  effectIds?: string[]; // optional to maintain compatibility
}
```

### Task 1.3: Add Effects Utils (10 mins)
- [ ] Copy `effects-utils.ts` to `src/lib/effects-utils.ts`
- [ ] Integrate with existing `src/lib/utils.ts` where applicable
- [ ] Test CSS filter generation with sample parameters

**Reuse these existing utilities:**
```typescript
// From src/lib/utils.ts
import { generateUUID } from '@/lib/utils';
// Already used in timeline-store.ts for IDs

// From src/lib/utils.ts - cn() for className merging
import { cn } from '@/lib/utils';
```

**Modify effects-utils.ts to use existing patterns:**
```typescript
// Change any custom ID generation to:
const effectId = generateUUID();

// For debugging, follow existing pattern from export.ts:
if (process.env.NODE_ENV === 'development') {
  console.log('[Effects] Applied filter:', filterString);
}
```

### Task 1.4: Create Effects Store (10 mins)
- [ ] Copy `effects-store.ts` to `src/stores/effects-store.ts`
- [ ] Ensure it imports from existing stores (timeline, playback, project)
- [ ] Verify store initialization doesn't break existing stores
- [ ] Add to store provider if centralized

**Reuse Zustand patterns from existing stores:**
```typescript
// From src/stores/timeline-store.ts - copy structure:
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// From src/stores/editor-store.ts - copy subscription pattern:
export const useEditorStore = create<EditorStore>()(
  subscribeWithSelector(
    devtools(
      immer((set, get) => ({
        // state and methods
      }))
    )
  )
);
```

**Reuse toast pattern:**
```typescript
// From src/stores/timeline-store.ts
import { toast } from 'sonner';
// Already used for: toast.success(), toast.error(), toast.info()
```

## Phase 2: UI Components - Non-Breaking Additions (40 mins total)

### Task 2.1: Add Effects Panel Component (10 mins)
- [ ] Create `src/components/editor/media-panel/views/effects.tsx`
- [ ] Import existing UI components (Button, ScrollArea, Tabs, etc.)
- [ ] Ensure it follows existing panel structure
- [ ] Don't integrate yet - just add the file

**Reuse UI components exactly as used in other panels:**
```typescript
// From src/components/editor/media-panel/views/sounds.tsx
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";

// Reuse the search pattern from sounds.tsx:
const [searchQuery, setSearchQuery] = useState("");
// Same search UI structure with Search icon
```

**Copy panel structure from existing views:**
```typescript
// Follow structure from media-panel/views/media.tsx:
export function EffectsView() {
  return (
    <div className="flex flex-col h-full">
      {/* Search Bar - copy from sounds.tsx */}
      <div className="p-4 border-b">
        {/* ... */}
      </div>
      
      {/* Content area with ScrollArea */}
      <ScrollArea className="flex-1">
        {/* ... */}
      </ScrollArea>
    </div>
  );
}
```

### Task 2.2: Add Effects Properties Component (10 mins)
- [ ] Create `src/components/editor/properties-panel/effects-properties.tsx`
- [ ] Use existing Slider, Input, Label components
- [ ] Follow existing properties panel patterns (text-properties as reference)
- [ ] Keep isolated - no integration yet

**Reuse form components from text-properties:**
```typescript
// From src/components/editor/properties-panel/text-properties.tsx
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Copy the property group structure:
<div className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="brightness">Brightness</Label>
    <Slider
      id="brightness"
      min={-100}
      max={100}
      step={1}
      value={[brightness]}
      onValueChange={(value) => handleChange('brightness', value[0])}
    />
  </div>
</div>
```

**Reuse the update pattern from text-properties-store:**
```typescript
// Pattern from useTextPropertiesStore
const handleChange = (property: string, value: any) => {
  // Debounce updates like in text-properties
  debounce(() => {
    updateEffectParameter(property, value);
  }, 100);
};
```

### Task 2.3: Add Effects Timeline Component (5 mins)
- [ ] Create `src/components/editor/timeline/effects-timeline.tsx`
- [ ] Base on existing timeline components structure
- [ ] Use existing timeline utilities

**Reuse timeline track patterns:**
```typescript
// From src/components/editor/timeline/timeline-track.tsx
import { cn } from "@/lib/utils";
import { useTimelineStore } from "@/stores/timeline-store";

// Use same track height and styling:
const TRACK_HEIGHT = 64; // from timeline constants

// Copy the track container pattern:
<div 
  className={cn(
    "relative h-16 border-b",
    "hover:bg-accent/5"
  )}
>
  {/* Effect bars here */}
</div>
```

### Task 2.4: Update Media Panel Index - Safely (10 mins)
- [ ] Open `src/components/editor/media-panel/index.tsx`
- [ ] Add conditional import for effects view
- [ ] Add effects tab with feature flag: `const EFFECTS_ENABLED = false`
- [ ] Test that media panel still works with flag off

**Current structure to modify:**
```typescript
// src/components/editor/media-panel/index.tsx
const tabs = [
  { id: "media", label: "Media", icon: Film },
  { id: "text", label: "Text", icon: Type },
  { id: "sounds", label: "Sounds", icon: Music },
  // Add conditionally:
  ...(EFFECTS_ENABLED ? [
    { id: "effects", label: "Effects", icon: Sparkles }
  ] : [])
];
```

**Safe lazy loading pattern:**
```typescript
// Add to imports (lazy load for safety):
const EffectsView = React.lazy(() => 
  EFFECTS_ENABLED 
    ? import('./views/effects')
    : Promise.resolve({ default: () => null })
);

// In render, add case:
{activeTab === "effects" && EFFECTS_ENABLED && (
  <React.Suspense fallback={<div>Loading...</div>}>
    <EffectsView />
  </React.Suspense>
)}
```

### Task 2.5: Update Properties Panel Index - Safely (5 mins)
- [ ] Open `src/components/editor/properties-panel/index.tsx`
- [ ] Add conditional rendering for effects properties
- [ ] Use same `EFFECTS_ENABLED` flag
- [ ] Verify no impact when flag is false

**Pattern to follow from properties panel:**
```typescript
// Current structure in properties-panel/index.tsx:
if (selectedElement?.type === 'text') {
  return <TextProperties />;
}

// Add after existing conditions:
if (EFFECTS_ENABLED && selectedElement && hasEffects(selectedElement)) {
  return <EffectsProperties elementId={selectedElement.id} />;
}

// Helper to check effects safely:
const hasEffects = (element: TimelineElement) => {
  if (!EFFECTS_ENABLED) return false;
  const effects = useEffectsStore.getState().getElementEffects(element.id);
  return effects && effects.length > 0;
};
```

## Phase 3: Preview Integration (30 mins total)

### Task 3.1: Backup Current Preview Panel (5 mins)
- [ ] Create `preview-panel.backup.tsx` copy
- [ ] Document current preview behavior
- [ ] Note all import/export points

**Backup command:**
```bash
cp src/components/editor/preview-panel.tsx src/components/editor/preview-panel.backup.tsx
```

**Document these key integration points:**
```typescript
// Current video ref usage:
const videoRef = useRef<HTMLVideoElement>(null);

// Current canvas usage for overlays:
const canvasRef = useRef<HTMLCanvasElement>(null);

// Current playback store subscription:
const { currentTime, isPlaying } = usePlaybackStore();
```

### Task 3.2: Add Effects Rendering Hook (10 mins)
- [ ] Create `useEffectsRendering` hook in preview panel
- [ ] Add CSS filter application logic
- [ ] Keep it disabled by default
- [ ] Test with mock data only

**Create hook following existing patterns:**
```typescript
// Similar to existing hooks like useVideoPlayer
import { useEffect, useRef } from 'react';
import { useEffectsStore } from '@/stores/effects-store';
import { parametersToCSSFilters } from '@/lib/effects-utils';

function useEffectsRendering(elementId: string | null, enabled = false) {
  const effects = useEffectsStore(state => 
    elementId ? state.getElementEffects(elementId) : []
  );
  
  // Follow pattern from useVideoPlayer hook
  useEffect(() => {
    if (!enabled || !elementId) return;
    
    // Apply effects logic here
  }, [enabled, elementId, effects]);
  
  return { filterStyle: enabled ? parametersToCSSFilters(effects) : '' };
}
```

### Task 3.3: Integrate Effects Store with Preview (10 mins)
- [ ] Import effects store in preview panel
- [ ] Add effect parameters retrieval
- [ ] Apply filters only when effects exist
- [ ] Add try-catch for safety

**Safe integration with existing preview code:**
```typescript
// In preview-panel.tsx, after existing imports:
import { useEffectsStore } from '@/stores/effects-store';
import { parametersToCSSFilters } from '@/lib/effects-utils';

// Inside component, near other store hooks:
const { selectedElementId } = useTimelineStore();
const elementEffects = useEffectsStore(state => 
  EFFECTS_ENABLED && selectedElementId 
    ? state.getElementEffects(selectedElementId) 
    : []
);

// Apply to video element safely:
const videoStyle = useMemo(() => {
  if (!EFFECTS_ENABLED || !elementEffects.length) return {};
  
  try {
    const filters = parametersToCSSFilters(elementEffects);
    return { filter: filters };
  } catch (error) {
    console.error('[Effects] Failed to apply filters:', error);
    return {};
  }
}, [elementEffects]);

// Apply to video element:
<video 
  ref={videoRef}
  style={videoStyle}
  // ... existing props
/>
```

### Task 3.4: Test Preview with Sample Effect (5 mins)
- [ ] Manually add a test effect via console
- [ ] Verify preview updates correctly
- [ ] Check performance impact
- [ ] Ensure non-effect elements unchanged

**Test commands for console:**
```javascript
// Test in browser console:
// 1. Get store
const effectsStore = window.__ZUSTAND_DEVTOOLS__.stores.get('effects-store');

// 2. Add test effect
effectsStore.getState().applyEffect('test-element-id', {
  id: 'test-brightness',
  name: 'Test Brightness',
  parameters: { brightness: 20 }
});

// 3. Check if applied
console.log(effectsStore.getState().activeEffects);

// 4. Monitor performance
console.time('effect-render');
// Trigger re-render
console.timeEnd('effect-render'); // Should be < 16ms
```

## Phase 4: Timeline Integration (25 mins total)

### Task 4.1: Extend Timeline Store (10 mins)
- [ ] Add effects-related methods to timeline store
- [ ] Ensure backward compatibility
- [ ] Add effect ID tracking to elements
- [ ] Default to empty effects array

**Extend timeline store safely:**
```typescript
// In src/stores/timeline-store.ts, add to interface:
interface TimelineElement {
  // ... existing properties
  effectIds?: string[]; // Optional for backward compatibility
}

// Add methods following existing patterns:
addEffectToElement: (elementId: string, effectId: string) => {
  set((state) => {
    const element = state.elements.find(e => e.id === elementId);
    if (element) {
      element.effectIds = [...(element.effectIds || []), effectId];
    }
  });
},

removeEffectFromElement: (elementId: string, effectId: string) => {
  set((state) => {
    const element = state.elements.find(e => e.id === elementId);
    if (element && element.effectIds) {
      element.effectIds = element.effectIds.filter(id => id !== effectId);
    }
  });
},

// Follow existing pattern from moveElement, deleteElement, etc.
```

### Task 4.2: Update Timeline Renderer (10 mins)  
- [ ] Modify `timeline-renderer.ts` carefully
- [ ] Add effects visualization layer
- [ ] Keep it toggleable via flag
- [ ] Ensure no performance regression

**Add effects layer to existing renderer:**
```typescript
// In src/lib/timeline-renderer.ts
// Find the main render function (renderTimeline or similar)

// Add after existing element rendering:
if (EFFECTS_ENABLED && element.effectIds?.length) {
  // Reuse existing canvas context patterns
  ctx.save();
  
  // Draw effect indicator (following existing style)
  ctx.fillStyle = 'rgba(155, 89, 255, 0.3)'; // Purple for effects
  ctx.fillRect(
    element.startTime * pixelsPerSecond,
    trackY + TRACK_HEIGHT - 4,
    element.duration * pixelsPerSecond,
    4
  );
  
  // Add effect icon (reuse icon rendering pattern)
  if (showIcons) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9b59ff';
    ctx.fillText('✨', element.startTime * pixelsPerSecond + 4, trackY + 16);
  }
  
  ctx.restore();
}

// Performance optimization - cache if needed:
const effectsCache = useMemo(() => {
  if (!EFFECTS_ENABLED) return null;
  // Cache effect rendering data
}, [elements, EFFECTS_ENABLED]);
```

### Task 4.3: Connect Effects Timeline Component (5 mins)
- [ ] Import effects timeline in main timeline
- [ ] Add conditional rendering
- [ ] Position correctly in DOM hierarchy
- [ ] Test timeline still scrolls/zooms correctly

**Integration in timeline/index.tsx:**
```typescript
// In src/components/editor/timeline/index.tsx
import { EffectsTimeline } from './effects-timeline';

// Find where tracks are rendered, add after:
{EFFECTS_ENABLED && (
  <div className="relative">
    <EffectsTimeline 
      // Pass same props as other timeline components
      zoom={zoom}
      scrollLeft={scrollLeft}
      pixelsPerSecond={pixelsPerSecond}
    />
  </div>
)}

// Ensure it scrolls with timeline:
<div 
  className="overflow-x-auto overflow-y-hidden"
  onScroll={handleScroll} // Existing scroll handler
>
  {/* Existing tracks */}
  {EFFECTS_ENABLED && <EffectsTimeline />}
</div>
```

## Phase 5: Export Integration (20 mins total)

### Task 5.1: Backup Export Logic (5 mins)
- [ ] Create `export.backup.ts` copy
- [ ] Document current export pipeline
- [ ] Note all processing steps

**Backup and document:**
```bash
cp src/lib/export.ts src/lib/export.backup.ts
```

**Key export pipeline points to note:**
```typescript
// Current FFmpeg usage pattern:
const ffmpeg = await loadFFmpeg();

// Current canvas rendering:
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// Current frame processing loop:
for (let frame = 0; frame < totalFrames; frame++) {
  // Render frame
  await renderFrame(ctx, frame);
  // Add to FFmpeg
  ffmpeg.FS('writeFile', `frame${frame}.png`, imageData);
}
```

### Task 5.2: Add Effects to Export Pipeline (10 mins)
- [ ] Import effects utils in export.ts
- [ ] Add effect application step
- [ ] Wrap in try-catch for safety
- [ ] Log but don't fail on effect errors

**Safe integration with existing export:**
```typescript
// In src/lib/export.ts, add imports:
import { useEffectsStore } from '@/stores/effects-store';
import { applyEffectsToCanvas, resetCanvasFilters } from '@/lib/effects-utils';

// In the frame rendering loop, find where elements are drawn:
for (const element of elementsAtTime) {
  // Before drawing element:
  ctx.save();
  
  // Apply effects if enabled and present
  if (EFFECTS_ENABLED) {
    try {
      const effects = useEffectsStore.getState().getElementEffects(element.id);
      if (effects && effects.length > 0) {
        applyEffectsToCanvas(ctx, effects);
      }
    } catch (error) {
      console.warn(`[Export] Failed to apply effects for element ${element.id}:`, error);
      // Continue without effects - don't break export
    }
  }
  
  // Existing element drawing code:
  if (element.type === 'video') {
    ctx.drawImage(videoElement, x, y, width, height);
  } else if (element.type === 'text') {
    // ... existing text rendering
  }
  
  // Reset filters after drawing
  if (EFFECTS_ENABLED) {
    resetCanvasFilters(ctx);
  }
  ctx.restore();
}

// Performance monitoring:
const effectsStartTime = performance.now();
// ... effects code
console.log(`[Export] Effects processing took ${performance.now() - effectsStartTime}ms`);
```

### Task 5.3: Test Export with Effects (5 mins)
- [ ] Export video without effects - verify works
- [ ] Export video with effects - verify applied
- [ ] Check output quality
- [ ] Measure performance impact

**Test checklist:**
```javascript
// 1. Test without effects (baseline)
EFFECTS_ENABLED = false;
await exportVideo(project);
// Check: Output file size, quality, duration

// 2. Test with single effect
EFFECTS_ENABLED = true;
// Add brightness effect to one element
await exportVideo(project);
// Check: Effect visible in output

// 3. Test with multiple effects
// Add 3+ effects to different elements
await exportVideo(project);
// Check: All effects applied correctly

// 4. Performance comparison
console.time('export-without-effects');
EFFECTS_ENABLED = false;
await exportVideo(project);
console.timeEnd('export-without-effects');

console.time('export-with-effects');
EFFECTS_ENABLED = true;
await exportVideo(project);
console.timeEnd('export-with-effects');
// Difference should be < 20%
```

## Phase 6: Feature Activation (15 mins total)

### Task 6.1: Create Feature Flag System (5 mins)
- [ ] Add `src/config/features.ts`
- [ ] Add `ENABLE_VIDEO_EFFECTS` flag
- [ ] Default to `false` for safety
- [ ] Make it runtime toggleable
- **Reuses**: Common feature flag patterns

### Task 6.2: Wire Up Feature Flags (5 mins)
- [ ] Replace all `EFFECTS_ENABLED` with central flag
- [ ] Add flag check in stores
- [ ] Add flag check in components
- [ ] Ensure clean enable/disable
- **Pattern**: Centralized configuration

### Task 6.3: Enable and Test (5 mins)
- [ ] Set flag to `true`
- [ ] Test full effects workflow
- [ ] Verify no existing features broken
- [ ] Document any issues found
- **Validation**: Final integration test

## Phase 7: Testing & Validation (20 mins total)

### Task 7.1: Test Existing Features (10 mins)
- [ ] Test video import/export without effects
- [ ] Test timeline operations
- [ ] Test text/audio features
- [ ] Verify no regressions
- **Critical**: Ensures no breaking changes

### Task 7.2: Test Effects Features (10 mins)
- [ ] Apply each effect type
- [ ] Test effect combinations
- [ ] Test effect removal
- [ ] Test undo/redo with effects
- **Validation**: Confirms new features work

## Rollback Plan

If issues occur at any phase:

1. **Immediate Rollback** (2 mins)
   - Set `ENABLE_VIDEO_EFFECTS = false`
   - Restore backup files if modified
   - Clear effects store

2. **Partial Rollback** (5 mins)
   - Keep types and utils (non-breaking)
   - Disable UI components
   - Remove preview/export integration

3. **Full Rollback** (10 mins)
   - Git stash or reset changes
   - Restore from backups
   - Verify original functionality

## Success Metrics

- [ ] All existing tests pass
- [ ] No performance regression (< 5% impact)
- [ ] Effects apply in preview and export
- [ ] Clean enable/disable via feature flag
- [ ] No console errors in any workflow

## Code Reuse Checklist

### Components to Reuse
- ✅ All Radix UI components (Button, Tabs, ScrollArea, etc.)
- ✅ Existing toast notifications (sonner)
- ✅ UUID generation from utils
- ✅ Existing store patterns (Zustand)
- ✅ Timeline rendering utilities
- ✅ Export pipeline structure
- ✅ Panel layout patterns
- ✅ Drag and drop hooks
- ✅ Infinite scroll hooks

### Patterns to Follow
- ✅ Store subscription patterns
- ✅ Component composition patterns  
- ✅ Error handling patterns
- ✅ Type definition patterns
- ✅ Feature flag patterns
- ✅ Panel navigation patterns

## Risk Mitigation

### High Risk Areas
1. **Preview Performance**: Monitor frame rate
2. **Export Pipeline**: Test thoroughly
3. **Timeline Rendering**: Check for flicker
4. **Store Interactions**: Watch for conflicts

### Mitigation Strategies
- Add performance monitoring
- Implement progressive enhancement
- Use requestAnimationFrame wisely
- Cache computed values
- Debounce parameter updates

## Notes

- Each subtask should commit independently
- Run `bun lint:clean` after each phase
- Test in both dev and production builds
- Keep effects disabled until fully tested
- Document any deviations from plan