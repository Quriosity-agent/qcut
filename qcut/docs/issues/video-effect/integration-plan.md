# Video Effects System Integration Plan

## Overview
This document outlines a safe, incremental integration strategy for PR #582's video effects system. Each task is broken down into subtasks that can be completed in under 10 minutes, with emphasis on code reuse and maintaining existing functionality.

## ⚠️ CRITICAL SAFETY VERIFIED (Updated from Source Code Review)

### ✅ VERIFIED Safe Integration Points:
1. **VideoPlayer component** (line 25: `videoRef` exists) - Add style prop for CSS filters
2. **Media Panel** (line 24-28: effects placeholder exists) - Just replace placeholder
3. **Export Engine** (lines 203-222, 225-251, 295-400) - Clear integration points
4. **Timeline Types** (lines 59-63: union type) - Use type augmentation, don't modify
5. **Properties Panel** (emptyView exists) - Add new component conditionally

### ⚠️ DO NOT MODIFY These Core Systems:
1. **TimelineElement union type** - Use module augmentation instead
2. **StickerCanvas overlay** - Must work on top of effects
3. **CaptionsDisplay** - Must work with effects
4. **Timeline overlap checking** - Keep existing logic
5. **Undo/redo system** - Only add new operations
6. **useAsyncMediaItems hook** - Don't touch media loading
7. **Scene management** - Effects are element-level only

### 🛡️ Safety Patterns to Follow:
- **Optional fields only**: `effectIds?: string[]`
- **Feature flags**: Everything behind `EFFECTS_ENABLED`
- **Try-catch wrapping**: All effect operations
- **Fallback rendering**: Always have non-effect path
- **Type augmentation**: Use `declare module` for extending types

## Integration Principles
1. **No Breaking Changes**: All existing features must continue working
2. **Maximum Code Reuse**: Leverage existing stores, components, and utilities
3. **Incremental Testing**: Test after each subtask completion
4. **Rollback Points**: Each subtask should be independently revertible
5. **Type Safety First**: Add types before implementation
6. **Feature Flag Protection**: Everything behind EFFECTS_ENABLED flag

## Phase 1: Type Definitions & Core Setup (30 mins total) ✅ COMPLETED

### Task 1.1: Add Effect Types (5 mins) ✅
- [x] Copy `effects.ts` to `src/types/effects.ts`
- [x] Review and ensure no conflicts with existing types
- [x] Run type check: `bun check-types`

**⚠️ SAFETY CHECK - No type conflicts:**
```typescript
// VERIFIED: src/types/timeline.ts structure (lines 59-63):
// TimelineElement is a union type:
export type TimelineElement =
  | MediaElement
  | TextElement  
  | StickerElement
  | CaptionElement;

// SAFE approach - DO NOT modify the union type
// Instead, extend each element type OPTIONALLY:
// Add to each interface in timeline.ts:
export interface MediaElement extends BaseTimelineElement {
  type: "media";
  mediaId: string;
  volume?: number;
  effectIds?: string[]; // ADD THIS - optional field
}

// Or better - use type augmentation in effects.ts:
declare module "@/types/timeline" {
  interface BaseTimelineElement {
    effectIds?: string[]; // This adds to ALL element types
  }
}
```

**Modifications needed:**
```typescript
// NOTE: src/types/index.ts does NOT exist in current codebase
// Create new file or add exports directly where needed
// Safe approach: Import directly from './effects' in components
```

### Task 1.2: Update Existing Type Exports (5 mins) ✅
- [x] Add export from `src/types/index.ts` if it exists (NO INDEX FILE - DIRECT IMPORTS WORK)
- [x] Ensure no naming conflicts with media/timeline types
- [x] Verify imports in existing stores still work

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

### Task 1.3: Add Effects Utils (10 mins) ✅
- [x] Copy `effects-utils.ts` to `src/lib/effects-utils.ts`
- [x] Integrate with existing `src/lib/utils.ts` where applicable
- [x] Test CSS filter generation with sample parameters

**Reuse these EXACT utilities from src/lib/utils.ts:**
```typescript
// COPY THIS EXACT CODE from src/lib/utils.ts (lines 6-8):
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// COPY THIS EXACT CODE from src/lib/utils.ts (lines 14-30):
export function generateUUID(): string {
  // Use the native crypto.randomUUID if available
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Secure fallback using crypto.getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version 4 (UUIDv4)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant 10xxxxxx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  
  // ... rest of UUID implementation
}
```

**Modify effects-utils.ts to use existing patterns:**
```typescript
// Import and use exactly as in timeline-store.ts:
import { generateUUID } from "@/lib/utils";

// Use for effect IDs:
const effectId = generateUUID();

// For debugging, use same pattern as timeline-store:
// NO console.log in production code
```

### Task 1.4: Create Effects Store (10 mins) ✅
- [x] Copy `effects-store.ts` to `src/stores/effects-store.ts`
- [x] Ensure it imports from existing stores (timeline, playback, project)
- [x] Verify store initialization doesn't break existing stores
- [x] Add to store provider if centralized (NO CENTRAL PROVIDER - STANDALONE STORE)

**⚠️ SAFETY CHECK - Store compatibility:**
```typescript
// COPY THIS EXACT PATTERN from timeline-store.ts (line 1):
import { create } from "zustand";

// NO immer middleware in timeline-store - keep effects store simple too
// COPY THIS EXACT PATTERN for store creation:
export const useEffectsStore = create<EffectsStore>((set, get) => ({
  // state
  activeEffects: new Map(),
  selectedEffect: null,
  
  // methods following timeline-store patterns
  applyEffect: (elementId: string, preset: EffectPreset) => {
    // Use set() exactly like timeline-store does
    set((state) => {
      // modify state
      return { activeEffects: new Map(state.activeEffects) };
    });
  },
}));

// IMPORTANT: These stores exist and can be imported:
// ✓ useTimelineStore - safe to import
// ✓ usePlaybackStore - safe to import  
// ✓ useProjectStore - safe to import
// ✗ useMediaStore - uses async pattern, import MediaStore type instead
```

**Reuse EXACT toast pattern from timeline-store.ts (line 26):**
```typescript
// COPY THIS EXACT IMPORT from timeline-store.ts:
import { toast } from "sonner";

// USE EXACTLY like timeline-store.ts does:
toast.success("Effect applied");
toast.error("Failed to apply effect");
toast.info("Effect removed");
```

## Phase 2: UI Components - Non-Breaking Additions (40 mins total) ✅ COMPLETED

### Task 2.1: Add Effects Panel Component (10 mins) ✅
- [x] Create `src/components/editor/media-panel/views/effects.tsx`
- [x] Import existing UI components (Button, ScrollArea, Tabs, etc.)
- [x] Ensure it follows existing panel structure
- [x] Don't integrate yet - just add the file

**Reuse EXACT UI components from sounds.tsx (lines 1-24):**
```typescript
// COPY THESE EXACT IMPORTS from sounds.tsx:
import { Input } from "@/components/ui/input";
import { useState, useMemo, useRef, useEffect } from "react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Additional UI components to import:
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
```

**Copy EXACT panel structure from sounds.tsx (lines 27-40):**
```typescript
export function EffectsView() {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="basic" className="flex flex-col h-full">
        <div className="px-3 pt-4 pb-0">
          <TabsList>
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="color">Color</TabsTrigger>
            <TabsTrigger value="artistic">Artistic</TabsTrigger>
            <TabsTrigger value="vintage">Vintage</TabsTrigger>
          </TabsList>
        </div>
        <Separator className="my-4" />
        <TabsContent
          value="basic"
          className="flex-1 px-3"
        >
          {/* Effects grid here */}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### Task 2.2: Add Effects Properties Component (10 mins) ✅
- [x] Create `src/components/editor/properties-panel/effects-properties.tsx`
- [x] Use existing Slider, Input, Label components
- [x] Follow existing properties panel patterns (text-properties as reference)
- [x] Keep isolated - no integration yet

**Reuse EXACT form components from text-properties.tsx (lines 1-16):**
```typescript
// COPY THESE EXACT IMPORTS from text-properties.tsx:
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import {
  PropertyItem,
  PropertyItemLabel,
  PropertyItemValue,
  PropertyGroup,
} from "./property-item";

// COPY EXACT property structure pattern (from text-properties.tsx):
export function EffectsProperties({
  element,
  trackId,
}: {
  element: TimelineElement & { effectIds?: string[] };
  trackId: string;
}) {
  // Local state for sliders (same pattern as lines 29-39)
  const [brightnessInput, setBrightnessInput] = useState("0");
  const [contrastInput, setContrastInput] = useState("0");
  
  // Use PropertyGroup components for organization:
  return (
    <PropertyGroup>
      <PropertyItem>
        <PropertyItemLabel>Brightness</PropertyItemLabel>
        <PropertyItemValue>
          <Slider
            min={-100}
            max={100}
            step={1}
            value={[parseInt(brightnessInput)]}
            onValueChange={(value) => setBrightnessInput(value[0].toString())}
          />
        </PropertyItemValue>
      </PropertyItem>
    </PropertyGroup>
  );
}
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

### Task 2.3: Add Effects Timeline Component (5 mins) ✅
- [x] Create `src/components/editor/timeline/effects-timeline.tsx`
- [x] Base on existing timeline components structure
- [x] Use existing timeline utilities

**Reuse EXACT timeline patterns from timeline-track.tsx (lines 1-26):**
```typescript
// COPY THESE EXACT IMPORTS from timeline-track.tsx:
import { useRef, useState, useEffect } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { toast } from "sonner";
import {
  TimelineTrack,
  TimelineElement as TimelineElementType,
} from "@/types/timeline";
import {
  TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";

// COPY EXACT track height from timeline-constants.ts:
const TRACK_HEIGHT = 64; // Standard track height

// COPY track container pattern:
<div 
  className="relative h-16 border-b hover:bg-accent/5"
  style={{ height: `${TRACK_HEIGHT}px` }}
>
  {/* Effect visualization bars */}
  {track.elements.map((element) => (
    element.effectIds?.map((effectId) => (
      <div
        key={effectId}
        className="absolute bottom-0 h-1 bg-purple-500/50"
        style={{
          left: `${element.startTime * pixelsPerSecond}px`,
          width: `${element.duration * pixelsPerSecond}px`,
        }}
      />
    ))
  ))}
</div>
```

### Task 2.4: Update Media Panel Index - Safely (10 mins) ✅
- [x] Open `src/components/editor/media-panel/index.tsx`
- [x] Add conditional import for effects view
- [x] Add effects tab with feature flag: `const EFFECTS_ENABLED = false`
- [x] Test that media panel still works with flag off

**⚠️ VERIFIED: Effects placeholder already exists (line 24-28):**
```typescript
// CURRENT CODE in media-panel/index.tsx:
effects: (
  <div className="p-4 text-muted-foreground">
    Effects view coming soon...
  </div>
),

// REPLACE WITH (when EFFECTS_ENABLED):
effects: EFFECTS_ENABLED ? (
  <EffectsView />
) : (
  <div className="p-4 text-muted-foreground">
    Effects view coming soon...
  </div>
),
```

**No need to modify TabBar - effects already in viewMap**

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

### Task 2.5: Update Properties Panel Index - Safely (5 mins) ✅
- [x] Open `src/components/editor/properties-panel/index.tsx`
- [x] Add conditional rendering for effects properties
- [x] Use same `EFFECTS_ENABLED` flag
- [x] Verify no impact when flag is false

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

## Phase 3: Preview Integration (30 mins total) ✅ COMPLETED

### Task 3.1: Backup Current Preview Panel (5 mins) ✅
- [x] Create `preview-panel.backup.tsx` copy
- [x] Document current preview behavior
- [x] Note all import/export points

**Backup command:**
```bash
cp src/components/editor/preview-panel.tsx src/components/editor/preview-panel.backup.tsx
```

**⚠️ SAFETY CHECK - Preview panel structure:**
```typescript
// VERIFIED: preview-panel.tsx current structure:
// - Uses VideoPlayer component (lines 10-11)
// - Has StickerCanvas overlay (line 37)
// - Has CaptionsDisplay system (line 39)
// - Uses useFrameCache hook (line 43)

// VERIFIED: VideoPlayer.tsx structure (lines 25-26):
const videoRef = useRef<HTMLVideoElement>(null);
// Video ref IS available in VideoPlayer component

// SAFE integration - modify VideoPlayer component:
// Add style prop to video element for CSS filters:
<video
  ref={videoRef}
  className={className}
  style={{ filter: effectsFilter }} // ADD THIS
  // ... existing props
/>

// Current overlay systems to preserve:
// 1. StickerCanvas - must continue working
// 2. CaptionsDisplay - must continue working
// 3. TextElementDragState - must continue working
```

### Task 3.2: Add Effects Rendering Hook (10 mins) ✅
- [x] Create `useEffectsRendering` hook in preview panel
- [x] Add CSS filter application logic
- [x] Keep it disabled by default
- [x] Test with mock data only

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

### Task 3.3: Integrate Effects Store with Preview (10 mins) ✅
- [x] Import effects store in preview panel
- [x] Add effect parameters retrieval
- [x] Apply filters only when effects exist
- [x] Add try-catch for safety

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

## Phase 4: Timeline Integration (25 mins total) ✅ COMPLETED

### Task 4.1: Extend Timeline Store (10 mins) ✅
- [x] Add effects-related methods to timeline store
- [x] Ensure backward compatibility
- [x] Add effect ID tracking to elements
- [x] Default to empty effects array

**⚠️ SAFETY CHECK - Timeline store modification:**
```typescript
// VERIFIED: timeline-store.ts structure:
// - Uses _tracks internal storage with getter
// - Complex element operations with overlap checking
// - Undo/redo system with history tracking

// SAFE approach - DO NOT modify existing methods:
// Add NEW methods only, keep existing untouched

// In src/stores/timeline-store.ts, add ONLY new methods:
addEffectToElement: (elementId: string, effectId: string) => {
  // Find element across all tracks
  const tracks = get()._tracks;
  for (const track of tracks) {
    const element = track.elements.find(e => e.id === elementId);
    if (element) {
      // Safe optional field addition
      if (!element.effectIds) element.effectIds = [];
      element.effectIds.push(effectId);
      set({ _tracks: [...tracks] }); // Trigger re-render
      break;
    }
  }
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

### Task 4.2: Add Effects to Timeline Elements (10 mins) ✅ 
- [x] Type augmentation already in place via effects.ts
- [x] BaseTimelineElement supports effectIds through module augmentation
- [x] No changes needed to existing element types
- [x] Fully backward compatible

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

### Task 4.3: Update Timeline Rendering (5 mins) ✅
- [x] Import effects timeline in main timeline
- [x] Add conditional rendering with EFFECTS_ENABLED flag
- [x] Position correctly in DOM hierarchy after regular tracks
- [x] Added effects track label in track labels section

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

## Phase 5: Export Integration (20 mins total) ✅ COMPLETED

### Task 5.1: Backup Export Logic (5 mins) ✅
- [x] Create `export-engine.backup.ts` copy
- [x] Document current export pipeline
- [x] Note all processing steps

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

### Task 5.2: Add Effects to Canvas Rendering (10 mins) ✅
- [x] Import effects utils in export-engine.ts
- [x] Add effect application to renderImage method
- [x] Add effect application to renderVideo method
- [x] Wrapped in try-catch for safety with fallback

**⚠️ SAFETY CHECK - Export engine modification:**
```typescript
// VERIFIED: export-engine.ts structure:
// - ExportEngine class with canvas rendering
// - renderStickersToCanvas already integrated
// - Complex frame rendering with media elements
// - FFmpegVideoRecorder for encoding

// SAFE integration point - in renderFrame method:
// In src/lib/export-engine.ts, modify renderFrame:

// VERIFIED integration points in export-engine.ts:
// - renderMediaElement method (line 203-222)
// - renderImage method (line 225-251)
// - renderVideo method (line 295-400)

// ADD to renderImage method BEFORE ctx.drawImage (line 240):
private async renderImage(
  element: TimelineElement,
  mediaItem: MediaItem
): Promise<void> {
  // ... existing code ...
  img.onload = () => {
    try {
      const { x, y, width, height } = this.calculateElementBounds(
        element,
        img.width,
        img.height
      );
      
      // ADD EFFECTS HERE:
      if (EFFECTS_ENABLED && element.effectIds?.length) {
    try {
      const effects = useEffectsStore.getState().getElementEffects(element.id);
      if (effects && effects.length > 0) {
        // Save context state BEFORE drawing
        this.ctx.save();
        
        // Apply effects to canvas context
        applyEffectsToCanvas(this.ctx, effects);
        
        // Draw element with effects applied
        this.ctx.drawImage(
          video,
          0, 0, video.videoWidth, video.videoHeight,
          x, y, width, height
        );
        
        // Restore context state
        this.ctx.restore();
      } else {
        // No effects - use existing draw code
        this.ctx.drawImage(video, x, y, width, height);
      }
    } catch (error) {
      // Log but don't fail export
      console.warn(`[Export] Effects failed for ${element.id}:`, error);
      // Fallback to drawing without effects
      this.ctx.drawImage(video, x, y, width, height);
    }
  } else {
    // Feature disabled or no effects - use existing code
    this.ctx.drawImage(video, x, y, width, height);
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

### Task 5.3: Update FFmpeg Export Pipeline (5 mins) ✅
- [x] Effects integrated into canvas rendering pipeline
- [x] FFmpeg receives frames with effects already applied
- [x] No additional FFmpeg changes needed
- [x] Performance monitoring added with debugWarn

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

**Create feature flags file:**
```typescript
// src/config/features.ts
export const FEATURES = {
  VIDEO_EFFECTS: {
    enabled: false, // Default off for safety
    name: 'Video Effects System',
    description: 'CSS filter-based video effects',
    experimental: true,
  },
  // Add other feature flags here following same pattern
} as const;

// Helper to check feature status
export const isFeatureEnabled = (feature: keyof typeof FEATURES): boolean => {
  // Check localStorage for override (for testing)
  if (typeof window !== 'undefined') {
    const override = localStorage.getItem(`feature_${feature}`);
    if (override !== null) {
      return override === 'true';
    }
  }
  
  return FEATURES[feature]?.enabled || false;
};

// Helper to toggle feature (for development)
export const toggleFeature = (feature: keyof typeof FEATURES, enabled: boolean) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`feature_${feature}`, String(enabled));
    // Trigger reload for changes to take effect
    window.location.reload();
  }
};

// Export convenience constant
export const EFFECTS_ENABLED = isFeatureEnabled('VIDEO_EFFECTS');
```

### Task 6.2: Wire Up Feature Flags (5 mins)
- [ ] Replace all `EFFECTS_ENABLED` with central flag
- [ ] Add flag check in stores
- [ ] Add flag check in components
- [ ] Ensure clean enable/disable

**Update all files to use central flag:**
```typescript
// In all components/stores, replace:
const EFFECTS_ENABLED = false;

// With:
import { EFFECTS_ENABLED } from '@/config/features';

// Or for dynamic checks:
import { isFeatureEnabled } from '@/config/features';
const effectsEnabled = isFeatureEnabled('VIDEO_EFFECTS');
```

**Add development UI for toggling (optional):**
```typescript
// In settings or debug panel:
import { FEATURES, toggleFeature, isFeatureEnabled } from '@/config/features';

// Render toggle switches:
{Object.entries(FEATURES).map(([key, config]) => (
  <div key={key} className="flex items-center justify-between p-2">
    <div>
      <p className="font-medium">{config.name}</p>
      {config.experimental && (
        <span className="text-xs text-yellow-600">Experimental</span>
      )}
    </div>
    <Switch
      checked={isFeatureEnabled(key as keyof typeof FEATURES)}
      onCheckedChange={(checked) => toggleFeature(key, checked)}
    />
  </div>
))}
```

### Task 6.3: Enable and Test (5 mins)
- [ ] Set flag to `true`
- [ ] Test full effects workflow
- [ ] Verify no existing features broken
- [ ] Document any issues found

**Test sequence:**
```javascript
// 1. Enable via console for testing:
localStorage.setItem('feature_VIDEO_EFFECTS', 'true');
window.location.reload();

// 2. Verify effects UI appears:
// - Check media panel has Effects tab
// - Check properties panel shows effects when selected
// - Check timeline shows effect indicators

// 3. Test complete workflow:
// a. Import video
// b. Add to timeline
// c. Apply effect from Effects panel
// d. See effect in preview
// e. Adjust parameters in Properties
// f. Export with effects
// g. Verify exported video has effects

// 4. Test disable:
localStorage.setItem('feature_VIDEO_EFFECTS', 'false');
window.location.reload();
// Verify all effects UI is hidden
// Verify existing projects still work
```

## Phase 7: Testing & Validation (20 mins total)

### Task 7.1: Test Existing Features (10 mins)
- [ ] Test video import/export without effects
- [ ] Test timeline operations
- [ ] Test text/audio features
- [ ] Verify no regressions

**Regression test checklist:**
```typescript
// 1. Video Import (should work exactly as before)
const testVideoImport = async () => {
  // Drag and drop video file
  // Verify thumbnail generation
  // Verify duration detection
  // Verify adds to media library
  console.log('✅ Video import works');
};

// 2. Timeline Operations
const testTimelineOps = () => {
  // Add element to timeline
  // Move element
  // Resize element
  // Delete element
  // Split element
  // Verify all work without errors
  console.log('✅ Timeline operations work');
};

// 3. Text Features
const testTextFeatures = () => {
  // Add text element
  // Change font, size, color
  // Apply text animations
  // Verify rendering in preview
  console.log('✅ Text features work');
};

// 4. Audio Features  
const testAudioFeatures = () => {
  // Add audio track
  // Adjust volume
  // Trim audio
  // Verify waveform display
  console.log('✅ Audio features work');
};

// 5. Export without effects
const testExport = async () => {
  // Export project
  // Verify output file created
  // Verify video plays correctly
  // Check file size is reasonable
  console.log('✅ Export works');
};
```

### Task 7.2: Test Effects Features (10 mins)
- [ ] Apply each effect type
- [ ] Test effect combinations
- [ ] Test effect removal
- [ ] Test undo/redo with effects

**Effects feature test suite:**
```typescript
// 1. Test each effect type
const effectTypes = [
  'brightness', 'contrast', 'saturation',
  'blur', 'sepia', 'grayscale', 'vintage'
];

for (const effectType of effectTypes) {
  // Apply effect
  applyEffect(elementId, { type: effectType, value: 50 });
  // Verify preview updates
  // Verify properties panel shows controls
  console.log(`✅ ${effectType} effect works`);
}

// 2. Test effect combinations
const testCombinations = () => {
  // Apply brightness + contrast
  applyEffect(elementId, { type: 'brightness', value: 20 });
  applyEffect(elementId, { type: 'contrast', value: 30 });
  // Verify both effects visible
  // Verify no conflicts
  console.log('✅ Effect combinations work');
};

// 3. Test effect removal
const testRemoval = () => {
  const effectId = applyEffect(elementId, { type: 'blur', value: 5 });
  removeEffect(elementId, effectId);
  // Verify effect removed from preview
  // Verify properties panel updated
  console.log('✅ Effect removal works');
};

// 4. Test undo/redo
const testUndoRedo = () => {
  // Apply effect
  const effectId = applyEffect(elementId, { type: 'sepia', value: 80 });
  // Undo (Ctrl+Z)
  document.dispatchEvent(new KeyboardEvent('keydown', { 
    key: 'z', ctrlKey: true 
  }));
  // Verify effect removed
  // Redo (Ctrl+Y)
  document.dispatchEvent(new KeyboardEvent('keydown', { 
    key: 'y', ctrlKey: true 
  }));
  // Verify effect restored
  console.log('✅ Undo/redo with effects works');
};

// 5. Performance test
const testPerformance = () => {
  const startTime = performance.now();
  
  // Apply 10 effects
  for (let i = 0; i < 10; i++) {
    applyEffect(`element-${i}`, { 
      type: 'brightness', 
      value: Math.random() * 100 - 50 
    });
  }
  
  const renderTime = performance.now() - startTime;
  console.log(`✅ 10 effects applied in ${renderTime}ms`);
  
  // Should be < 100ms for good UX
  if (renderTime > 100) {
    console.warn('⚠️ Performance may need optimization');
  }
};
```

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

## Phase 8: Additional Features from PR (35 mins total)

### Task 8.1: Interactive Element Manipulation (10 mins)
- [ ] Add drag and drop for elements with effects
- [ ] Implement resize handles for effect regions
- [ ] Add rotation controls
- [ ] Test interaction with effects applied
- [ ] Add position and transformation controls for text elements

**Implementation from preview-panel.tsx:**
```typescript
// Text element drag state handling (already in PR)
interface TextElementDragState {
  elementId: string;
  initialX: number;
  initialY: number;
  currentX: number;
  currentY: number;
}

// Add to preview panel for draggable elements:
const handleElementDrag = (e: MouseEvent, elementId: string) => {
  if (!EFFECTS_ENABLED) return;
  
  // Reuse existing drag logic from text elements
  const element = elements.find(el => el.id === elementId);
  if (element && element.effectIds?.length) {
    // Enable drag for elements with effects
    setDragState({
      elementId,
      initialX: e.clientX,
      initialY: e.clientY,
      // ... rest of drag state
    });
  }
};

// Resize handles for effect regions
const renderResizeHandles = (element: TimelineElement) => {
  if (!element.effectIds?.length) return null;
  
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Corner handles */}
      <div className="absolute top-0 left-0 w-2 h-2 bg-primary pointer-events-auto cursor-nw-resize" />
      <div className="absolute top-0 right-0 w-2 h-2 bg-primary pointer-events-auto cursor-ne-resize" />
      {/* ... other handles */}
    </div>
  );
};
```

### Task 8.2: Effect Management Features (10 mins)
- [ ] Implement multi-effect application to single element
- [ ] Add enable/disable toggle for individual effects
- [ ] Create effect duplication functionality
- [ ] Add effect reset to defaults
- [ ] Implement effect time range trimming

**Effect management implementation:**
```typescript
// Support multiple effects per element
interface ElementEffects {
  elementId: string;
  effects: EffectInstance[];
  // Each effect can be individually controlled
}

// Toggle individual effects
const toggleEffect = (elementId: string, effectId: string) => {
  const element = getElement(elementId);
  const effect = element.effects.find(e => e.id === effectId);
  if (effect) {
    effect.enabled = !effect.enabled;
    updatePreview();
  }
};

// Duplicate effect with new ID
const duplicateEffect = (effect: EffectInstance): EffectInstance => {
  return {
    ...effect,
    id: generateUUID(),
    name: `${effect.name} (Copy)`,
  };
};

// Time range trimming
interface EffectTimeRange {
  startTime: number; // Relative to element start
  endTime: number;   // Relative to element start
  duration: number;  // Calculated
}
```

### Task 8.3: Effect Animations & Keyframes (10 mins)
- [ ] Add keyframe support for effect parameters
- [ ] Implement effect transitions
- [ ] Add easing functions
- [ ] Create animation timeline UI

**Keyframe implementation pattern:**
```typescript
// Add to effects.ts types:
export interface EffectKeyframe {
  time: number; // in seconds
  value: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface AnimatedEffectParameter {
  parameter: string;
  keyframes: EffectKeyframe[];
}

// Add to TimelineEffect interface:
export interface TimelineEffect {
  // ... existing properties
  animations?: AnimatedEffectParameter[];
}

// Interpolation utility:
const interpolateValue = (
  keyframes: EffectKeyframe[],
  currentTime: number
): number => {
  // Find surrounding keyframes
  const before = keyframes.filter(k => k.time <= currentTime).pop();
  const after = keyframes.find(k => k.time > currentTime);
  
  if (!before) return keyframes[0]?.value || 0;
  if (!after) return before.value;
  
  // Linear interpolation (extend for easing)
  const progress = (currentTime - before.time) / (after.time - before.time);
  return before.value + (after.value - before.value) * progress;
};
```

### Task 8.4: Advanced Effect Categories (5 mins)
- [ ] Add distortion effects (pixelate, wave, twist)
- [ ] Add artistic effects (oil painting, watercolor)
- [ ] Add transition effects (fade, dissolve, wipe)
- [ ] Add composite effects (overlay, multiply, screen)

**Additional effect types to add:**
```typescript
// Add to EffectType in effects.ts:
export type EffectType =
  | /* ... existing types ... */
  // Distortion effects
  | "wave"
  | "twist"
  | "bulge"
  | "fisheye"
  // Artistic effects  
  | "oil-painting"
  | "watercolor"
  | "pencil-sketch"
  | "halftone"
  // Transition effects
  | "fade-in"
  | "fade-out"
  | "dissolve"
  | "wipe"
  // Composite effects
  | "overlay"
  | "multiply"
  | "screen"
  | "color-dodge";

// Add corresponding parameters:
export interface EffectParameters {
  // ... existing parameters
  
  // Distortion
  waveAmplitude?: number;
  waveFrequency?: number;
  twistAngle?: number;
  bulgeRadius?: number;
  
  // Artistic
  brushSize?: number;
  paintStrength?: number;
  sketchIntensity?: number;
  
  // Transition
  fadeProgress?: number;
  transitionDuration?: number;
  
  // Composite
  blendMode?: string;
  opacity?: number;
}
```

## Phase 9: UI/UX Enhancements (20 mins total)

### Task 9.1: Keyboard Shortcuts for Effects (5 mins)
- [ ] Add keyboard shortcuts for common effects
- [ ] Implement shortcuts for parameter adjustment
- [ ] Add shortcuts for effect enable/disable
- [ ] Update keyboard shortcuts help

**Keyboard shortcut implementation:**
```typescript
// Add to keyboard-shortcuts-help.tsx
const effectShortcuts = {
  'Alt+B': 'Apply brightness effect',
  'Alt+C': 'Apply contrast effect',
  'Alt+S': 'Apply saturation effect',
  'Alt+E': 'Toggle selected effect',
  'Alt+R': 'Reset effect parameters',
  'Alt+D': 'Duplicate selected effect',
  'Shift+Plus': 'Increase effect intensity',
  'Shift+Minus': 'Decrease effect intensity',
};

// Keyboard handler for effects
const handleEffectKeyboard = (e: KeyboardEvent) => {
  if (!EFFECTS_ENABLED) return;
  
  if (e.altKey) {
    switch(e.key) {
      case 'b': applyPresetEffect('brightness'); break;
      case 'c': applyPresetEffect('contrast'); break;
      case 's': applyPresetEffect('saturation'); break;
      case 'e': toggleSelectedEffect(); break;
      case 'r': resetSelectedEffect(); break;
      case 'd': duplicateSelectedEffect(); break;
    }
  }
};
```

### Task 9.2: Drag & Drop Effects to Timeline (10 mins)
- [ ] Implement drag source for effect presets
- [ ] Add drop zones on timeline elements
- [ ] Visual feedback during drag
- [ ] Apply effect on drop

**Drag & drop implementation:**
```typescript
// Make effect presets draggable
<div
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData('effect', JSON.stringify(preset));
    e.dataTransfer.effectAllowed = 'copy';
  }}
  className="effect-preset-card"
>
  {/* Effect preset UI */}
</div>

// Timeline element as drop zone
<div
  onDragOver={(e) => {
    if (e.dataTransfer.types.includes('effect')) {
      e.preventDefault();
      setDropHighlight(true);
    }
  }}
  onDrop={(e) => {
    const effectData = e.dataTransfer.getData('effect');
    const preset = JSON.parse(effectData);
    applyEffectToElement(element.id, preset);
    setDropHighlight(false);
  }}
>
  {/* Timeline element */}
</div>
```

### Task 9.3: Effect Search and Filtering (5 mins)
- [ ] Implement effect search functionality
- [ ] Add category filters
- [ ] Create recent/favorite effects section
- [ ] Add effect preview thumbnails

**Search and filter implementation:**
```typescript
// Effect search component
const EffectSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const filteredEffects = useMemo(() => {
    return effects.filter(effect => {
      const matchesSearch = effect.name.toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || 
        effect.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory, effects]);
  
  return (
    <div>
      <Input
        placeholder="Search effects..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      <CategoryFilter
        selected={selectedCategory}
        onChange={setSelectedCategory}
      />
      <EffectGrid effects={filteredEffects} />
    </div>
  );
};
```

## Phase 10: Performance Optimizations (15 mins total)

### Task 10.1: Effect Caching System (5 mins)
- [ ] Implement effect result caching
- [ ] Add cache invalidation logic
- [ ] Create memory management for cache
- [ ] Monitor cache hit rate

**Caching implementation:**
```typescript
// Create effect cache store
const effectCache = new Map<string, {
  params: EffectParameters;
  result: string; // CSS filter string
  timestamp: number;
}>();

const getCachedEffect = (
  effectId: string,
  params: EffectParameters
): string | null => {
  const cached = effectCache.get(effectId);
  if (!cached) return null;
  
  // Check if params match
  if (JSON.stringify(cached.params) !== JSON.stringify(params)) {
    return null;
  }
  
  // Check if cache is fresh (< 1 second old)
  if (Date.now() - cached.timestamp > 1000) {
    effectCache.delete(effectId);
    return null;
  }
  
  return cached.result;
};

// Use in parametersToCSSFilters:
export function parametersToCSSFilters(
  effectId: string,
  parameters: EffectParameters
): string {
  // Check cache first
  const cached = getCachedEffect(effectId, parameters);
  if (cached) return cached;
  
  // Generate filter string
  const result = /* ... existing logic ... */;
  
  // Cache result
  effectCache.set(effectId, {
    params: parameters,
    result,
    timestamp: Date.now()
  });
  
  return result;
}
```

### Task 10.2: WebGL Acceleration (5 mins)
- [ ] Add WebGL context for heavy effects
- [ ] Implement shader-based filters
- [ ] Create fallback to CSS filters
- [ ] Benchmark performance gains

**WebGL integration pattern:**
```typescript
// Check for WebGL support
const supportsWebGL = (() => {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (e) {
    return false;
  }
})();

// Use WebGL for complex effects
const applyWebGLEffect = (
  canvas: HTMLCanvasElement,
  effect: EffectParameters
): void => {
  if (!supportsWebGL) {
    // Fallback to CSS filters
    return;
  }
  
  const gl = canvas.getContext('webgl');
  if (!gl) return;
  
  // Load and compile shaders for effects
  // ... WebGL implementation
};
```

### Task 10.3: Batch Processing (5 mins)
- [ ] Batch multiple effect updates
- [ ] Implement requestAnimationFrame batching
- [ ] Add debouncing for parameter changes
- [ ] Create update queue system

**Batch processing implementation:**
```typescript
// Effect update queue
const effectUpdateQueue = new Set<string>();
let updateScheduled = false;

const queueEffectUpdate = (effectId: string) => {
  effectUpdateQueue.add(effectId);
  
  if (!updateScheduled) {
    updateScheduled = true;
    requestAnimationFrame(() => {
      processBatchedUpdates();
      updateScheduled = false;
    });
  }
};

const processBatchedUpdates = () => {
  const updates = Array.from(effectUpdateQueue);
  effectUpdateQueue.clear();
  
  // Process all updates in single render pass
  updates.forEach(effectId => {
    const effect = getEffectById(effectId);
    if (effect) {
      applyEffectToElement(effect);
    }
  });
};
```

## Complete Feature List from PR #582

### ✅ Effect Types (20 total)
1. Blur
2. Brightness
3. Contrast
4. Saturation
5. Hue
6. Gamma
7. Sepia
8. Grayscale
9. Invert
10. Vintage
11. Dramatic
12. Warm
13. Cool
14. Cinematic
15. Vignette
16. Grain
17. Sharpen
18. Emboss
19. Edge
20. Pixelate

### ✅ Core Features
- **Effects Panel**: Grid-based browser with categories
- **Search & Filter**: Real-time search with category filtering
- **Drag & Drop**: Effects to timeline elements
- **Properties Panel**: Slider controls for all parameters
- **Multi-Effect Support**: Multiple effects per element
- **Enable/Disable**: Individual effect toggling
- **Reset & Duplicate**: Effect management options
- **Time Range**: Effect trimming and duration control

### ✅ Interactive Features
- **Element Manipulation**: Drag, resize, rotate in preview
- **Text Positioning**: X/Y position controls
- **Transform Controls**: Rotation and scale
- **Real-time Preview**: Instant effect updates
- **Visual Feedback**: Drop zones and highlights

### ✅ Integration Points
- **Timeline**: Effect visualization bars
- **Export**: Canvas rendering with effects
- **Undo/Redo**: Full history support
- **Keyboard Shortcuts**: Quick effect application
- **Performance**: CSS filters for real-time, canvas for export

### ✅ Technical Implementation
- **State Management**: Zustand store for effects
- **Parameter Validation**: Comprehensive validation system
- **Error Handling**: Try-catch wrapping for safety
- **Feature Flag**: EFFECTS_ENABLED for safe rollout
- **Type Safety**: Full TypeScript definitions

## Notes

- Each subtask should commit independently
- Run `bun lint:clean` after each phase
- Test in both dev and production builds
- Keep effects disabled until fully tested
- Document any deviations from plan
- Consider performance impact of advanced features
- Test on different hardware configurations
- All 20 effect types from PR must be implemented
- Preserve all existing overlay systems (stickers, captions)