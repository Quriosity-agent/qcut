# Timeline Caching Integration - Commit e222f15

## Overview
This commit implements timeline caching with visual cache indicators to improve playback performance and provide user feedback about rendering status.

**Commit**: [e222f15d1dd50aa50be8c7424d86aa7fedf0defc](https://github.com/OpenCut-app/OpenCut/commit/e222f15d1dd50aa50be8c7424d86aa7fedf0defc)
**Date**: Referenced from OpenCut repository
**Feature**: Timeline frame caching with cache status indicator
**Branch**: `feature/timeline-caching-indicator`

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

### Required Adaptations

#### 1. Canvas Rendering System
**Current Gap**: Our preview panel doesn't use canvas for timeline rendering
**Solution**: 
- Implement a `renderTimelineFrame` function
- Add canvas element to preview panel
- Create offscreen rendering capability

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

### Implementation Plan

#### Phase 1: Foundation (2-3 hours)
1. Create canvas rendering system in preview panel
2. Implement `renderTimelineFrame` function
3. Set up offscreen canvas support

#### Phase 2: Caching System (2-3 hours)
1. Adapt and create `use-frame-cache.ts` hook
2. Integrate with our media store and timeline store
3. Add cache invalidation logic

#### Phase 3: UI Integration (1-2 hours)
1. Create `timeline-cache-indicator.tsx` component
2. Extract and create `timeline-marker.tsx`
3. Add cache indicator to timeline ruler
4. Style according to our theme

#### Phase 4: Optimization (1-2 hours)
1. Implement pre-rendering strategy
2. Fine-tune cache parameters
3. Add performance monitoring

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

## Next Steps

1. ✅ Analyze current codebase structure
2. Create canvas rendering foundation
3. Implement frame cache hook
4. Add cache indicator UI
5. Test and optimize performance