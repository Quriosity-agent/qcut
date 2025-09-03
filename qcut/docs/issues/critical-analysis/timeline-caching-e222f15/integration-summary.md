# Timeline Caching Integration - Commit e222f15

## Overview
This commit implements timeline caching with visual cache indicators to improve playback performance and provide user feedback about rendering status.

**Commit**: [e222f15d1dd50aa50be8c7424d86aa7fedf0defc](https://github.com/OpenCut-app/OpenCut/commit/e222f15d1dd50aa50be8c7424d86aa7fedf0defc)
**Date**: Referenced from OpenCut repository
**Feature**: Timeline frame caching with cache status indicator

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

## Integration Considerations

### For Our Codebase

1. **Dependencies to Add**:
   - Create `use-frame-cache.ts` hook
   - Add cache indicator components

2. **Store Integration**:
   - May need to sync with playback store
   - Consider timeline store updates

3. **Performance Tuning**:
   - Adjust cache size based on memory constraints
   - Tune pre-render distances for our use case

4. **Visual Design**:
   - Match cache indicator to our theme
   - Consider additional visual feedback options

## Next Steps

1. Analyze our current rendering pipeline
2. Implement the frame cache hook
3. Add cache indicator to timeline
4. Test performance improvements
5. Fine-tune cache parameters