# Timeline Caching Integration - Commit e222f15

## Overview
This commit implements timeline caching with visual cache indicators to improve playback performance and provide user feedback about rendering status.

**Commit**: [e222f15d1dd50aa50be8c7424d86aa7fedf0defc](https://github.com/OpenCut-app/OpenCut/commit/e222f15d1dd50aa50be8c7424d86aa7fedf0defc)
**Date**: Referenced from OpenCut repository
**Feature**: Timeline frame caching with cache status indicator
**Branch**: `feature/timeline-caching-indicator`

## Quick Reference Table

| Task | Our Repo File | Fetched Reference | Action |
|------|--------------|-------------------|--------|
| Canvas Rendering | `apps/web/src/components/editor/preview-panel.tsx` | `preview-panel.tsx` (lines 463-631) | Modify |
| Timeline Renderer | `apps/web/src/lib/timeline-renderer.ts` | `preview-panel.tsx` (lines 525-631) | Create |
| Frame Cache Hook | `apps/web/src/hooks/use-frame-cache.ts` | `use-frame-cache.ts` (complete) | Create |
| Cache Indicator | `apps/web/src/components/editor/timeline/timeline-cache-indicator.tsx` | `timeline-cache-indicator.tsx` (complete) | Create |
| Timeline Marker | `apps/web/src/components/editor/timeline/timeline-marker.tsx` | `timeline-marker.tsx` (complete) | Create |
| Timeline Integration | `apps/web/src/components/editor/timeline/index.tsx` | `timeline-index.tsx` (lines 685-695) | Modify |

## Modified Files

### 1. **preview-panel.tsx** (Modified)
- Added frame caching logic to avoid re-rendering unchanged frames
- Implements pre-rendering of nearby frames during scrubbing
- Uses `useFrameCache` hook for cache management
- Caches rendered frames as ImageData for fast retrieval
- Invalidates cache when timeline changes

### 2. **timeline/index.tsx** (Modified)
- Added `TimelineCacheIndicator` component to show cache status
- Extracted timeline markers into separate `TimelineMarker` component
- Synchronized scrolling between ruler and tracks
- Added cache status retrieval via `getRenderStatus`

### 3. **timeline-cache-indicator.tsx** (New)
- Visual indicator showing cached vs non-cached segments
- Samples timeline at 0.1 second intervals
- Displays cached segments with primary color
- Non-cached segments shown with border color
- Provides tooltips for cache status

### 4. **timeline-marker.tsx** (New)
- Extracted timeline marker rendering logic
- Handles time formatting for different scales
- Maintains visual hierarchy for main vs sub-markers

### 5. **use-frame-cache.ts** (New)
- Custom hook for managing frame cache
- Implements LRU cache with configurable size
- Provides methods:
  - `getCachedFrame`: Retrieve cached frame
  - `cacheFrame`: Store rendered frame
  - `invalidateCache`: Clear all cached frames
  - `preRenderNearbyFrames`: Background pre-rendering
  - `getRenderStatus`: Check cache status for a frame

## Key Features

### 1. Frame Caching System
```typescript
// Cache structure
interface CacheEntry {
  imageData: ImageData;
  tracks: TimelineTrack[];
  mediaFiles: MediaFile[];
  project: TProject | null;
}

// Cache key generation
const getCacheKey = (
  time: number,
  tracks: TimelineTrack[],
  mediaFiles: MediaFile[],
  project: TProject | null
): string
```

### 2. Cache Indicator UI
- Horizontal line above timeline ruler
- Color coding:
  - **Primary color**: Cached segments (fast playback)
  - **Border color**: Non-cached segments (will render)
- Real-time updates as frames are cached

### 3. Pre-rendering Strategy
- **During scrubbing**: Pre-renders 5 frames before/after current position
- **During playback**: Pre-renders 1 frame ahead
- Background rendering doesn't block UI

### 4. Cache Invalidation
Automatically invalidates when:
- Timeline tracks change
- Media files are modified
- Project background settings change

## Implementation Benefits

1. **Performance**: 
   - Eliminates redundant rendering
   - Instant playback for cached frames
   - Smoother scrubbing experience

2. **User Feedback**:
   - Visual indication of rendering status
   - Helps users understand performance
   - Shows optimization opportunities

3. **Memory Management**:
   - LRU eviction strategy
   - Configurable cache size
   - Automatic cleanup on invalidation

## Integration Analysis for Our Codebase

### Current Architecture Differences

#### Our Implementation
- **Preview Panel**: `apps/web/src/components/editor/preview-panel.tsx`
  - Uses `VideoPlayer` and `AudioPlayer` components
  - No canvas-based rendering currently
  - Uses `mediaItems` from async media store
  - Has text element dragging support
  - Includes sticker overlay and captions display

- **Timeline Component**: `apps/web/src/components/editor/timeline/index.tsx`
  - Already has ruler and playhead implementation
  - Uses `TIMELINE_CONSTANTS` from `constants/timeline-constants.ts`
  - Has selection box and snap indicator features
  - Supports drag & drop for media files
  - Uses Zustand stores for state management

#### OpenCut Implementation (fetched)
- Uses `renderTimelineFrame` function for canvas rendering
- Implements offscreen canvas for performance
- Has sophisticated caching with ImageData
- Pre-renders nearby frames asynchronously

### Required Adaptations (Based on Our Codebase Analysis)

#### 1. Canvas Rendering System
**Current Implementation**: Our preview panel uses React components for rendering:
- `VideoPlayer` component for video elements
- `<img>` tags for image elements  
- `<div>` elements for text overlays
- `StickerCanvas` and `CaptionsDisplay` overlays

**IMPORTANT**: Adding canvas rendering should NOT replace existing components
**Solution**: 
- Add a secondary canvas layer for caching WITHOUT removing existing rendering
- Canvas will capture the current frame composition
- Keep all existing interactive elements (text dragging, etc.)

#### 2. Cache Hook Integration
**Files to Create**:
```typescript
// apps/web/src/hooks/use-frame-cache.ts
- Adapt the fetched implementation
- Use our existing types from @/types/timeline
- Integrate with our media store structure
```

#### 3. Cache Indicator Component
**Files to Create**:
```typescript
// apps/web/src/components/editor/timeline/timeline-cache-indicator.tsx
- Adapt styling to our existing theme
- Use our TIMELINE_CONSTANTS
- Integrate with our timeline ruler
```

#### 4. Timeline Marker Extraction
**Refactor Needed**:
- Extract timeline marker rendering logic from `timeline/index.tsx`
- Create `timeline-marker.tsx` component
- This will clean up the timeline component

### Implementation Plan with File References

#### Phase 1: Foundation (2-3 hours → 12-18 tasks @ 10 min each)

##### Task 1.1: Install DOM capture library (10 min)
**Action**: Install html2canvas dependency
```bash
cd apps/web && npm install html2canvas @types/html2canvas
```

##### Task 1.2: Add canvas refs to preview panel (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: After line 56 (with other refs)
```typescript
const canvasRef = useRef<HTMLCanvasElement>(null);
const cacheCanvasRef = useRef<HTMLCanvasElement>(null);
```

##### Task 1.3: Add hidden canvas element (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: After line 636 (after CaptionsDisplay)
```jsx
<canvas
  ref={cacheCanvasRef}
  style={{ display: 'none' }}
  width={previewDimensions.width}
  height={previewDimensions.height}
/>
```

##### Task 1.4: Create timeline-renderer.ts file structure (10 min)
**File**: `apps/web/src/lib/timeline-renderer.ts` (new)
```typescript
import html2canvas from 'html2canvas';

export interface CaptureOptions {
  width: number;
  height: number;
  backgroundColor?: string;
}

// Basic structure - implementation in next task
export async function captureFrameToCanvas(
  previewElement: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  // TODO: Implement in Task 1.5
  return null;
}
```

##### Task 1.5: Implement captureFrameToCanvas function (10 min)
**File**: `apps/web/src/lib/timeline-renderer.ts`
```typescript
export async function captureFrameToCanvas(
  previewElement: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  try {
    const canvas = await html2canvas(previewElement, {
      width: options.width,
      height: options.height,
      backgroundColor: options.backgroundColor || '#000000',
      logging: false,
      useCORS: true,
    });
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    return ctx.getImageData(0, 0, options.width, options.height);
  } catch (error) {
    console.error('Failed to capture frame:', error);
    return null;
  }
}
```

##### Task 1.6: Add capture trigger in preview panel (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: Add useEffect after line 176
```typescript
import { captureFrameToCanvas } from '@/lib/timeline-renderer';

// Add after other useEffects
useEffect(() => {
  if (!previewRef.current || !cacheCanvasRef.current) return;
  // Capture will be triggered by cache hook in Phase 2
}, [currentTime, tracks]);
```

#### Phase 2: Caching System (2-3 hours → 12-18 tasks @ 10 min each)

##### Task 2.1: Create use-frame-cache.ts file structure (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts` (new)
```typescript
import { useRef, useCallback } from "react";
import { TimelineTrack, TimelineElement } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store-types";

interface CachedFrame {
  imageData: ImageData;
  timelineHash: string;
  timestamp: number;
}

export function useFrameCache(options = {}) {
  const { maxCacheSize = 300 } = options;
  const frameCacheRef = useRef(new Map<number, CachedFrame>());
  
  // TODO: Implement methods in subsequent tasks
  return {
    getCachedFrame: () => null,
    cacheFrame: () => {},
    invalidateCache: () => {},
    getRenderStatus: () => "not-cached" as const,
  };
}
```

##### Task 2.2: Implement getTimelineHash function (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
```typescript
const getTimelineHash = useCallback((
  time: number,
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  activeProject: any
): string => {
  // Create hash from active elements at current time
  const activeElements = tracks.flatMap(track => 
    track.elements.filter(el => {
      const start = el.startTime;
      const end = el.startTime + el.duration - el.trimStart - el.trimEnd;
      return time >= start && time < end;
    })
  );
  
  return JSON.stringify({
    time,
    elements: activeElements.map(e => e.id),
    bg: activeProject?.backgroundColor
  });
}, []);
```

##### Task 2.3: Implement getCachedFrame method (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
```typescript
const getCachedFrame = useCallback((
  time: number,
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  activeProject: any
): ImageData | null => {
  const frameTime = Math.round(time * 30) / 30; // 30fps resolution
  const cached = frameCacheRef.current.get(frameTime);
  
  if (!cached) return null;
  
  const currentHash = getTimelineHash(time, tracks, mediaItems, activeProject);
  if (cached.timelineHash !== currentHash) {
    frameCacheRef.current.delete(frameTime);
    return null;
  }
  
  return cached.imageData;
}, [getTimelineHash]);
```

##### Task 2.4: Implement cacheFrame method (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
```typescript
const cacheFrame = useCallback((
  time: number,
  imageData: ImageData,
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  activeProject: any
): void => {
  const frameTime = Math.round(time * 30) / 30;
  const hash = getTimelineHash(time, tracks, mediaItems, activeProject);
  
  // LRU eviction if cache is full
  if (frameCacheRef.current.size >= maxCacheSize) {
    const firstKey = frameCacheRef.current.keys().next().value;
    frameCacheRef.current.delete(firstKey);
  }
  
  frameCacheRef.current.set(frameTime, {
    imageData,
    timelineHash: hash,
    timestamp: Date.now()
  });
}, [getTimelineHash, maxCacheSize]);
```

##### Task 2.5: Implement invalidateCache method (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
```typescript
const invalidateCache = useCallback((): void => {
  frameCacheRef.current.clear();
}, []);

const getRenderStatus = useCallback((
  time: number,
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  activeProject: any
): "cached" | "not-cached" => {
  const frameTime = Math.round(time * 30) / 30;
  return frameCacheRef.current.has(frameTime) ? "cached" : "not-cached";
}, []);
```

##### Task 2.6: Wire up cache hook in preview panel (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: Add import after line 39 (after existing imports)
```typescript
import { useFrameCache } from '@/hooks/use-frame-cache';
```
**Location**: Inside component, after line 76 (after dragState)
```typescript
// Frame caching - non-intrusive addition
const { getCachedFrame, cacheFrame, invalidateCache } = useFrameCache();
```
**Safety Verification**:
- ✅ Hook is called unconditionally (React rules)
- ✅ Placed after existing state to maintain order
- ✅ Does not modify any existing state or refs
- ✅ Isolated from drag state and other hooks

##### Task 2.7: Add cache invalidation effect (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: Add after line 177 (after isExpanded effect, before dragState effect)
```typescript
// Invalidate cache when timeline changes - runs independently
useEffect(() => {
  invalidateCache();
}, [tracks, mediaItems, activeProject?.backgroundColor, invalidateCache]);
```
**Safety Verification**:
- ✅ Effect runs independently of existing effects
- ✅ Does not modify DOM or state
- ✅ Only clears internal cache Map
- ✅ No interference with drag operations (next effect at line 178)

##### Task 2.8: Implement frame capture and caching (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: Add after line 231 (after dragState effect)
```typescript
// Capture and cache frames after render - non-blocking
useEffect(() => {
  // Skip during playback and drag to avoid performance impact
  if (isPlaying || dragState.isDragging) return;
  
  const captureAndCache = async () => {
    if (!previewRef.current || activeElements.length === 0) return;
    
    // Check if already cached
    const cached = getCachedFrame(currentTime, tracks, mediaItems, activeProject);
    if (cached) return;
    
    // Delay to ensure render is complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Skip if component unmounted or state changed
    if (!previewRef.current) return;
    
    // Capture and cache
    const imageData = await captureFrameToCanvas(previewRef.current, {
      width: previewDimensions.width,
      height: previewDimensions.height,
      backgroundColor: activeProject?.backgroundColor || '#000000',
    });
    
    if (imageData) {
      cacheFrame(currentTime, imageData, tracks, mediaItems, activeProject);
    }
  };
  
  // Use requestIdleCallback for non-blocking capture
  const id = requestIdleCallback(() => captureAndCache(), { timeout: 1000 });
  return () => cancelIdleCallback(id);
}, [
  currentTime, 
  tracks, 
  mediaItems, 
  activeProject,
  previewDimensions.width,
  previewDimensions.height,
  isPlaying,
  dragState.isDragging,
  activeElements.length,
  getCachedFrame,
  cacheFrame
]);
```
**Safety Verification**:
- ✅ Only runs when not playing (preserves playback performance)
- ✅ Skips during drag operations (preserves drag smoothness)
- ✅ Uses requestIdleCallback (non-blocking)
- ✅ Checks activeElements to avoid unnecessary captures
- ✅ Waits for render completion with setTimeout
- ✅ Has timeout to prevent hanging
- ✅ Proper cleanup with cancelIdleCallback

#### Phase 3: UI Integration (1-2 hours → 6-12 tasks @ 10 min each)

##### Task 3.1: Create `timeline-cache-indicator.tsx` component
**Our Repo Files to Create**:
- `apps/web/src/components/editor/timeline/timeline-cache-indicator.tsx` - New component

**Reference from Fetched Commit**:
- `timeline-caching-e222f15/timeline-cache-indicator.tsx` (complete file) - Full implementation

**Required Imports Update**:
```typescript
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { MediaItem } from "@/stores/media-store-types";
```

##### Task 3.2: Extract and create `timeline-marker.tsx`
**Our Repo Files to Modify**:
- `apps/web/src/components/editor/timeline/index.tsx` (lines 693-749) - Extract marker logic

**Our Repo Files to Create**:
- `apps/web/src/components/editor/timeline/timeline-marker.tsx` - New component

**Reference from Fetched Commit**:
- `timeline-caching-e222f15/timeline-marker.tsx` (complete file) - Target structure

##### Task 3.3: Add cache indicator to timeline ruler
**Our Repo Files to Modify**:
- `apps/web/src/components/editor/timeline/index.tsx` - Add TimelineCacheIndicator

**Current Timeline Ruler Structure (lines 677-788)**:
```jsx
<ScrollArea className="w-full" ref={rulerScrollRef}>
  <div ref={rulerRef} className="relative h-10 select-none cursor-default">
    {/* Time markers - lines 686-763 */}
    {/* Bookmark markers - lines 765-787 */}
  </div>
</ScrollArea>
```

**Integration Point (line 686, before time markers)**:
```typescript
// Add cache indicator as first child of ruler div
<div ref={rulerRef} className="relative h-10 select-none cursor-default">
  {/* ADD HERE: Cache indicator */}
  <TimelineCacheIndicator
    duration={duration}
    zoomLevel={zoomLevel}
    tracks={tracks}
    mediaFiles={mediaItems} // Using our mediaItems
    activeProject={activeProject}
    getRenderStatus={getRenderStatus} // From useFrameCache hook
  />
  {/* Existing time markers */}
  {(() => { ... })()}
  {/* Existing bookmark markers */}
  {(() => { ... })()}
</div>
```

##### Task 3.4: Style according to our theme
**Our Repo Files to Modify**:
- `apps/web/src/components/editor/timeline/timeline-cache-indicator.tsx` - Adjust classes

**Styling Updates**:
```typescript
// Use our existing color scheme
className={cn(
  "absolute top-0 h-px",
  segment.cached ? "bg-primary" : "bg-border"
)}
```

#### Phase 4: Optimization (1-2 hours → 6 tasks @ 10 min each)

##### Task 4.1: Implement pre-rendering for nearby frames (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
**Reference**: `timeline-caching-e222f15/use-frame-cache.ts` (lines 242-309)
**Location**: Add method to hook
```typescript
const preRenderNearbyFrames = useCallback(async (
  currentTime: number,
  renderFunction: (time: number) => Promise<ImageData>,
  range: number = 2 // seconds before and after
) => {
  const framesToPreRender: number[] = [];
  
  // Calculate frames to pre-render
  for (let offset = -range; offset <= range; offset += 1 / cacheResolution) {
    const time = currentTime + offset;
    if (time < 0) continue;
    
    if (!isFrameCached(time, tracks, mediaFiles, activeProject)) {
      framesToPreRender.push(time);
    }
  }
  
  // Pre-render during idle time
  for (const time of framesToPreRender.slice(0, 30)) { // Limit to 30 frames
    requestIdleCallback(async () => {
      try {
        const imageData = await renderFunction(time);
        cacheFrame(time, imageData, tracks, mediaFiles, activeProject);
      } catch (error) {
        console.warn(`Pre-render failed for time ${time}:`, error);
      }
    });
  }
}, [isFrameCached, cacheFrame, cacheResolution, tracks, mediaFiles, activeProject]);
```

##### Task 4.2: Add offscreen canvas optimization (10 min)
**File**: `apps/web/src/lib/canvas-utils.ts`
**Location**: Update captureFrameToCanvas function
```typescript
// Create offscreen canvas for better performance
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenContext: OffscreenCanvasRenderingContext2D | null = null;

export async function captureFrameToCanvas(
  element: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  try {
    // Use offscreen canvas if available
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!offscreenCanvas || 
          offscreenCanvas.width !== options.width || 
          offscreenCanvas.height !== options.height) {
        offscreenCanvas = new OffscreenCanvas(options.width, options.height);
        offscreenContext = offscreenCanvas.getContext('2d');
      }
      
      if (offscreenContext) {
        // Use html2canvas to render to offscreen canvas
        const canvas = await html2canvas(element, {
          canvas: offscreenCanvas as any,
          width: options.width,
          height: options.height,
          backgroundColor: options.backgroundColor,
          logging: false,
        });
        
        return offscreenContext.getImageData(0, 0, options.width, options.height);
      }
    }
    
    // Fallback to regular canvas
    return await captureWithRegularCanvas(element, options);
  } catch (error) {
    console.error('Frame capture failed:', error);
    return null;
  }
}
```

##### Task 4.3: Implement smart cache eviction (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
**Reference**: `timeline-caching-e222f15/use-frame-cache.ts` (lines 200-211)
**Location**: Update cacheFrame method
```typescript
// Smarter LRU eviction based on access patterns
if (frameCacheRef.current.size >= maxCacheSize) {
  const entries = Array.from(frameCacheRef.current.entries());
  
  // Sort by timestamp and distance from current time
  entries.sort((a, b) => {
    const aDistance = Math.abs(a[0] - time);
    const bDistance = Math.abs(b[0] - time);
    const aAge = Date.now() - a[1].timestamp;
    const bAge = Date.now() - b[1].timestamp;
    
    // Prioritize keeping frames near current time (within 5 seconds)
    if (aDistance < 5 && bDistance >= 5) return -1;
    if (bDistance < 5 && aDistance >= 5) return 1;
    
    // Otherwise evict oldest
    return bAge - aAge;
  });
  
  // Remove oldest 20% of entries
  const toRemove = Math.floor(entries.length * 0.2);
  for (let i = 0; i < toRemove; i++) {
    frameCacheRef.current.delete(entries[i][0]);
  }
}
```

##### Task 4.4: Add performance monitoring (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
**Location**: Add performance tracking to hook
```typescript
interface CacheMetrics {
  hits: number;
  misses: number;
  avgCaptureTime: number;
  captureCount: number;
}

const metricsRef = useRef<CacheMetrics>({
  hits: 0,
  misses: 0,
  avgCaptureTime: 0,
  captureCount: 0
});

// Update getCachedFrame to track hits/misses
const getCachedFrame = useCallback((/* params */) => {
  const frameKey = Math.floor(time * cacheResolution);
  const cached = frameCacheRef.current.get(frameKey);
  
  if (cached && cached.timelineHash === currentHash) {
    metricsRef.current.hits++;
    return cached.imageData;
  } else {
    metricsRef.current.misses++;
    return null;
  }
}, [/* deps */]);

// Track capture performance
const cacheFrame = useCallback((/* params */) => {
  const startTime = performance.now();
  // ... existing caching logic ...
  
  const captureTime = performance.now() - startTime;
  metricsRef.current.captureCount++;
  metricsRef.current.avgCaptureTime = 
    (metricsRef.current.avgCaptureTime * (metricsRef.current.captureCount - 1) + captureTime) 
    / metricsRef.current.captureCount;
}, [/* deps */]);

// Expose metrics in return
return {
  // ... existing returns
  cacheMetrics: metricsRef.current,
  cacheHitRate: metricsRef.current.hits / (metricsRef.current.hits + metricsRef.current.misses)
};
```

##### Task 4.5: Add cache warming on idle (10 min)
**File**: `apps/web/src/components/editor/preview-panel.tsx`
**Location**: Add after line 500 (after main component logic)
```typescript
// Warm cache during idle time
useEffect(() => {
  if (!isPlaying && previewRef.current) {
    const warmCache = () => {
      // Only warm cache if user has been idle for 100ms
      preRenderNearbyFrames(
        currentTime,
        async (time) => {
          if (!previewRef.current) throw new Error("No preview element");
          
          // Capture frame at specified time
          // First update timeline to that time (without triggering re-render)
          const imageData = await captureFrameToCanvas(previewRef.current, {
            width: previewDimensions.width,
            height: previewDimensions.height,
            backgroundColor: activeProject?.backgroundColor || '#000000',
          });
          
          if (!imageData) throw new Error("Failed to capture frame");
          return imageData;
        },
        3 // Pre-render 3 seconds ahead/behind
      );
    };
    
    const timeoutId = setTimeout(warmCache, 100);
    return () => clearTimeout(timeoutId);
  }
}, [
  currentTime, 
  isPlaying, 
  preRenderNearbyFrames,
  previewDimensions,
  activeProject?.backgroundColor
]);
```

##### Task 4.6: Add cache persistence option (10 min)
**File**: `apps/web/src/hooks/use-frame-cache.ts`
**Location**: Add optional IndexedDB persistence
```typescript
import { openDB } from 'idb';

interface FrameCacheOptions {
  maxCacheSize?: number;
  cacheResolution?: number;
  persist?: boolean; // New option for persistence
}

// Save cache to IndexedDB
const saveToIndexedDB = useCallback(async () => {
  if (!options.persist) return;
  
  try {
    const db = await openDB('frame-cache', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('frames')) {
          db.createObjectStore('frames');
        }
      }
    });
    
    // Convert Map to array for storage
    const cacheArray = Array.from(frameCacheRef.current.entries()).map(
      ([key, value]) => ({
        key,
        imageData: value.imageData,
        timelineHash: value.timelineHash,
        timestamp: value.timestamp
      })
    );
    
    await db.put('frames', cacheArray, 'cache-snapshot');
  } catch (error) {
    console.warn('Failed to persist cache:', error);
  }
}, [options.persist]);

// Restore cache from IndexedDB on mount
const restoreFromIndexedDB = useCallback(async () => {
  if (!options.persist) return;
  
  try {
    const db = await openDB('frame-cache', 1);
    const cacheArray = await db.get('frames', 'cache-snapshot');
    
    if (cacheArray && Array.isArray(cacheArray)) {
      frameCacheRef.current.clear();
      for (const item of cacheArray) {
        frameCacheRef.current.set(item.key, {
          imageData: item.imageData,
          timelineHash: item.timelineHash,
          timestamp: item.timestamp
        });
      }
    }
  } catch (error) {
    console.warn('Failed to restore cache:', error);
  }
}, [options.persist]);

// Add restore on mount
useEffect(() => {
  if (options.persist) {
    restoreFromIndexedDB();
  }
}, []);

// Add save on significant changes
useEffect(() => {
  if (options.persist && frameCacheRef.current.size > 0) {
    const debounceTimer = setTimeout(saveToIndexedDB, 1000);
    return () => clearTimeout(debounceTimer);
  }
}, [frameCacheRef.current.size, saveToIndexedDB]);
```

### Key Differences to Address

1. **Media Handling**:
   - OpenCut: Uses `MediaFile[]` type
   - Ours: Uses `MediaItem[]` from async store
   - Need adapter functions

2. **Project Structure**:
   - OpenCut: `TProject` type
   - Ours: Different project structure in `useProjectStore`
   - Map relevant fields

3. **Timeline Types**:
   - Both use similar `TimelineTrack` and `TimelineElement` types
   - Our implementation has additional sticker and caption tracks

4. **Rendering Pipeline**:
   - Need to build canvas-based rendering from scratch
   - Can leverage existing element positioning logic

### Performance Considerations

1. **Memory Usage**:
   - Default cache size: 300 frames (10 seconds at 30fps)
   - Estimate: ~50-100MB for 1080p frames
   - Add memory monitoring

2. **Pre-rendering Strategy**:
   - Scrubbing: 5 frames before/after
   - Playback: 1-2 frames ahead
   - Adjust based on performance testing

3. **Cache Invalidation**:
   - Track changes
   - Media file changes
   - Project settings changes
   - Text element updates
   - Sticker modifications

### Testing Strategy

1. **Performance Tests**:
   - Measure render time with/without cache
   - Monitor memory usage
   - Test different cache sizes

2. **UI Tests**:
   - Verify cache indicator accuracy
   - Test cache invalidation scenarios
   - Ensure smooth scrolling

3. **Integration Tests**:
   - Test with various media types
   - Verify sticker/caption compatibility
   - Test with different timeline lengths

## Safety Considerations to Prevent Breaking Existing Features

### Critical Points to Maintain:

1. **Preview Panel Rendering**:
   - ✅ KEEP all existing React components (VideoPlayer, AudioPlayer, img, div)
   - ✅ KEEP text element dragging functionality (lines 419-465)
   - ✅ KEEP StickerCanvas overlay (line 624-627)
   - ✅ KEEP CaptionsDisplay overlay (lines 630-635)
   - ❌ DO NOT replace DOM rendering with canvas-only rendering

2. **Timeline Interactions**:
   - ✅ KEEP existing ruler click handlers (line 684: onMouseDown)
   - ✅ KEEP bookmark markers interactive (lines 777-780: onClick)
   - ✅ KEEP time marker rendering logic (lines 686-763)
   - ✅ Cache indicator should be non-interactive (pointer-events-none)

3. **State Management**:
   - ✅ Cache invalidation should not trigger unnecessary re-renders
   - ✅ Keep existing store subscriptions unchanged
   - ✅ Add cache operations as side effects only

4. **Media Store Compatibility**:
   - Our code uses `MediaItem[]` from `useAsyncMediaItems()`
   - Fetched code uses `MediaFile[]`
   - Create adapter: `mediaItemsToMediaFiles(items: MediaItem[]): MediaFile[]`

### Implementation Safety Checklist:

- [ ] Canvas rendering captures DOM, doesn't replace it
- [ ] All interactive elements remain functional
- [ ] Text dragging still works
- [ ] Video/Audio players continue to work
- [ ] Sticker and caption overlays render correctly
- [ ] Timeline scrolling and zoom unchanged
- [ ] Playhead movement unaffected
- [ ] No performance regression for non-cached frames

## File Mapping Summary

### Files to Create (New)
1. `apps/web/src/lib/timeline-renderer.ts` - Timeline frame rendering logic
2. `apps/web/src/hooks/use-frame-cache.ts` - Frame caching hook
3. `apps/web/src/components/editor/timeline/timeline-cache-indicator.tsx` - Cache indicator UI
4. `apps/web/src/components/editor/timeline/timeline-marker.tsx` - Extracted marker component
5. `apps/web/src/lib/performance-monitor.ts` - Performance tracking

### Files to Modify (Existing)
1. `apps/web/src/components/editor/preview-panel.tsx` - Add canvas rendering
2. `apps/web/src/components/editor/timeline/index.tsx` - Integrate cache indicator
3. `apps/web/src/stores/timeline-store.ts` - Cache-related actions
4. `apps/web/src/stores/media-store.ts` - Cache invalidation triggers

### Reference Files from Fetched Commit
All reference files are located in: `docs/issues/critical-analysis/timeline-caching-e222f15/`
- `preview-panel.tsx` - Complete canvas implementation reference
- `timeline-index.tsx` - Timeline integration reference
- `timeline-cache-indicator.tsx` - Ready to adapt
- `timeline-marker.tsx` - Ready to adapt
- `use-frame-cache.ts` - Complete hook implementation

## Recommended Implementation Approach

### Why DOM Capture Instead of Canvas Rendering:

Our codebase uses React components for rendering (VideoPlayer, AudioPlayer, etc.) rather than direct canvas drawing. To implement caching without breaking these features:

1. **Use DOM-to-Canvas Capture**:
   - Install: `npm install html2canvas` or similar library
   - Capture the preview div content to canvas
   - Cache the captured ImageData
   - This preserves all existing functionality

2. **Alternative: Hybrid Approach**:
   - Keep React components for interactive elements
   - Use canvas only for static frame caching
   - Overlay cached frames behind interactive elements

3. **Progressive Enhancement**:
   - Start with basic frame caching
   - Add pre-rendering later
   - Optimize based on performance metrics

### Migration Path:

1. **Phase 1**: Add caching without changing rendering (2 hours)
   - Add html2canvas for DOM capture
   - Implement basic cache storage
   - Test with existing elements

2. **Phase 2**: Add cache indicators (1 hour)
   - Visual feedback for users
   - Performance monitoring

3. **Phase 3**: Optimize (2 hours)
   - Pre-rendering strategy
   - Memory management
   - Performance tuning

## Next Steps

1. ✅ Analyze current codebase structure
2. ✅ Create detailed implementation plan with file references
3. ✅ Identify safety considerations
4. Install html2canvas for DOM capture
5. Create canvas rendering foundation (DOM capture approach)
6. Implement frame cache hook
7. Add cache indicator UI
8. Test and optimize performance

## Implementation Checklist

### Phase 1: Foundation
- [ ] Add canvas element to preview-panel.tsx
- [ ] Create timeline-renderer.ts with renderTimelineFrame function
- [ ] Implement offscreen canvas support
- [ ] Test basic canvas rendering

### Phase 2: Caching System  
- [ ] Create use-frame-cache.ts hook
- [ ] Add cache invalidation to stores
- [ ] Implement getTimelineHash function
- [ ] Test cache hit/miss logic

### Phase 3: UI Integration
- [ ] Create timeline-cache-indicator.tsx
- [ ] Extract and create timeline-marker.tsx
- [ ] Add indicator to timeline ruler
- [ ] Style components with our theme

### Phase 4: Optimization (6 tasks @ 10 min each)
- [ ] Task 4.1: Implement pre-rendering for nearby frames
- [ ] Task 4.2: Add offscreen canvas optimization
- [ ] Task 4.3: Implement smart cache eviction
- [ ] Task 4.4: Add performance monitoring
- [ ] Task 4.5: Add cache warming on idle
- [ ] Task 4.6: Add cache persistence option