# Timeline 10-Second Limitation Analysis

## Overview

The QCut video editor currently enforces a **10-second minimum timeline duration**, which can be limiting for users wanting to create shorter videos or work with precise timing. This document analyzes the root causes of this limitation and provides a comprehensive solution to remove it while maintaining system stability.

## Why the Timeline is Limited to 10 Seconds

### Root Causes

The 10-second limitation stems from multiple interconnected constraints across the codebase:

#### 1. **Timeline UI Minimum Duration** (`apps/web/src/components/editor/timeline/index.tsx:347`)
```typescript
setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
```
- **Purpose**: Prevents timeline UI from becoming too narrow to interact with
- **Impact**: Empty timelines always start at 10 seconds minimum
- **Location**: `timeline/index.tsx:347`

#### 2. **AI Video Model Constraints** (`apps/web/src/components/editor/media-panel/views/ai-constants.ts`)
```typescript
max_duration: 10, // All AI video models capped at 10 seconds
```
- **Affected Models**: Kling V2, Seedance, WAN 2.5, all avatar models
- **Purpose**: API limitations from video generation services
- **Impact**: Generated AI videos cannot exceed 10 seconds

#### 3. **FFmpeg Export Hardcoded Limit** (`electron/ffmpeg-handler.ts:681`)
```typescript
"-t", "10", // Limit to 10 seconds to avoid issues
```
- **Purpose**: Prevents export timeouts and memory issues
- **Impact**: All video exports are truncated to 10 seconds maximum
- **Location**: `ffmpeg-handler.ts:681`

#### 4. **AI Video Client Duration Mapping** (`apps/web/src/lib/ai-video-client.ts:132`)
```typescript
payload.duration = requestedDuration >= 10 ? "10" : "6";
```
- **Purpose**: Maps user input to API-accepted values
- **Impact**: All durations ≥10 seconds get capped at 10 seconds

### Secondary Contributing Factors

#### 5. **Playback Store Logic** (`stores/playback-store.ts:42`)
```typescript
// Stop at actual content end, not timeline duration (which has 10s minimum)
```
- **Purpose**: Comments indicate awareness of the 10-second minimum
- **Impact**: Playback logic designed around this assumption

#### 6. **Timeline Buffer Calculation** (`timeline/index.tsx:138`)
```typescript
const dynamicBuffer = Math.max(60, (duration || 0) * 0.1);
```
- **Purpose**: Ensures adequate UI buffer space
- **Impact**: Creates additional visual padding beyond actual content

## Technical Impact Analysis

### Current Behavior
1. **Empty Timeline**: Always shows 10 seconds minimum
2. **Short Content**: Content < 10 seconds still shows 10-second timeline
3. **Export Process**: All exports truncated to 10 seconds maximum
4. **AI Generation**: Cannot generate videos longer than 10 seconds
5. **User Experience**: Confusing for users wanting shorter videos

### Performance Implications
- **Memory Usage**: Longer timelines require more rendering calculations
- **Export Speed**: 10-second limit actually improves export performance
- **UI Responsiveness**: Shorter timelines reduce DOM complexity

## Step-by-Step Solution to Extend Timeline (Without Breaking Features)

### Phase 1: Remove Hard Export Limit (Critical)

#### Step 1.1: Update FFmpeg Handler
**File**: `electron/ffmpeg-handler.ts`

**Location**: Lines 672-690 (buildFFmpegArgs function)

**Current Implementation**:
```typescript
// Video codec settings
args.push(
  "-c:v",
  "libx264",
  "-preset",
  preset,
  "-crf",
  crf,
  "-t",
  "10", // Limit to 10 seconds to avoid issues
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  outputFile
);
```

**Detailed Implementation Plan**:

1. **Add Duration Parameter to IPC Interface**:
   ```typescript
   // In electron/main.ts - Update IPC handler signature
   ipcMain.handle("export:video", async (event, options: {
     sessionId: string;
     duration: number; // Add this parameter
     width: number;
     height: number;
     fps: number;
     quality: 'high' | 'medium' | 'low';
   }) => {
     // Pass duration to buildFFmpegArgs
     const args = buildFFmpegArgs({
       ...options,
       duration: Math.min(Math.max(options.duration, 0.1), 600) // Validate: 0.1s min, 10min max
     });
     // ... rest of implementation
   });
   ```

2. **Update buildFFmpegArgs Function**:
   ```typescript
   function buildFFmpegArgs({
     sessionId,
     duration, // Add this parameter
     width,
     height,
     fps,
     preset = "ultrafast",
     crf = "23",
   }: {
     sessionId: string;
     duration: number; // New required parameter
     width: number;
     height: number;
     fps: number;
     preset?: string;
     crf?: string;
   }): string[] {
     // ... existing code ...

     // Video codec settings with dynamic duration
     args.push(
       "-c:v",
       "libx264",
       "-preset",
       preset,
       "-crf",
       crf,
       "-t",
       Math.min(duration, 600).toString(), // Cap at 10 minutes, convert to string
       "-pix_fmt",
       "yuv420p",
       "-movflags",
       "+faststart",
       outputFile
     );

     return args;
   }
   ```

3. **Add Timeout Handling for Long Exports**:
   ```typescript
   // In electron/ffmpeg-handler.ts - Add timeout wrapper
   async function executeFFmpegWithTimeout(args: string[], duration: number): Promise<void> {
     const timeoutMs = Math.min(duration * 10000, 600000); // 10s per video second, max 10min

     return new Promise((resolve, reject) => {
       const timeoutId = setTimeout(() => {
         reject(new Error(`Export timeout after ${timeoutMs / 1000} seconds`));
       }, timeoutMs);

       // Execute FFmpeg process
       executeFFmpeg(args)
         .then(() => {
           clearTimeout(timeoutId);
           resolve();
         })
         .catch((error) => {
           clearTimeout(timeoutId);
           reject(error);
         });
     });
   }
   ```

#### Step 1.2: Update Export Engine
**File**: `apps/web/src/lib/export-engine.ts`

**Location**: Lines 59, 86, 131, 681 (ExportEngine class)

**Current Implementation Analysis**:
```typescript
export class ExportEngine {
  protected totalDuration: number; // Line 59 - stores timeline duration

  constructor(
    // ... other params
    totalDuration: number // Line 80 - accepts duration from timeline
  ) {
    this.totalDuration = totalDuration; // Line 86 - assigns duration
  }

  protected getTotalFrames(): number {
    return Math.ceil(this.totalDuration * this.fps); // Line 131 - calculates frames
  }

  getDuration(): number {
    return this.totalDuration; // Line 681 - returns duration to callers
  }
}
```

**Detailed Implementation Plan**:

1. **Update Constructor to Validate Duration**:
   ```typescript
   constructor(
     canvas: HTMLCanvasElement,
     ctx: CanvasRenderingContext2D,
     tracks: TimelineTrack[],
     mediaItems: MediaItem[],
     totalDuration: number, // Keep existing parameter
     fps: number = 30,
     width: number = 1920,
     height: number = 1080,
     settings: Partial<ExportSettings> = {}
   ) {
     // Validate and clamp duration to reasonable limits
     const validatedDuration = this.validateDuration(totalDuration);

     this.canvas = canvas;
     this.ctx = ctx;
     this.tracks = tracks;
     this.mediaItems = mediaItems;
     this.totalDuration = validatedDuration; // Use validated duration
     this.fps = fps;
     this.width = width;
     this.height = height;
     this.settings = { ...defaultSettings, ...settings };

     console.log(`[ExportEngine] Initialized with duration: ${validatedDuration.toFixed(3)}s (original: ${totalDuration.toFixed(3)}s)`);
   }

   private validateDuration(duration: number): number {
     const minDuration = 0.1; // 100ms minimum
     const maxDuration = 600; // 10 minutes maximum

     if (duration <= 0) {
       console.warn(`[ExportEngine] Invalid duration ${duration}s, using minimum ${minDuration}s`);
       return minDuration;
     }

     if (duration > maxDuration) {
       console.warn(`[ExportEngine] Duration ${duration}s exceeds maximum ${maxDuration}s, clamping to maximum`);
       return maxDuration;
     }

     return duration;
   }
   ```

2. **Update Export Method to Pass Duration to Electron**:
   ```typescript
   async export(): Promise<void> {
     // ... existing setup code ...

     // Calculate actual content duration vs timeline duration
     const actualContentDuration = this.calculateActualContentDuration();
     const exportDuration = Math.min(actualContentDuration || this.totalDuration, 600);

     console.log(`[ExportEngine] Export duration: ${exportDuration.toFixed(3)}s (timeline: ${this.totalDuration.toFixed(3)}s, content: ${actualContentDuration.toFixed(3)}s)`);

     // ... frame rendering loop ...

     // Pass duration to Electron for FFmpeg processing
     if (window.electronAPI?.ffmpeg?.export) {
       await window.electronAPI.ffmpeg.export({
         sessionId: this.sessionId,
         duration: exportDuration, // Pass validated duration
         width: this.width,
         height: this.height,
         fps: this.fps,
         quality: this.settings.quality || 'medium'
       });
     }
   }

   private calculateActualContentDuration(): number {
     // Calculate the actual end time of all timeline content
     let maxEndTime = 0;

     for (const track of this.tracks) {
       for (const element of track.elements) {
         const elementEnd = element.startTime +
           (element.duration - element.trimStart - element.trimEnd);
         maxEndTime = Math.max(maxEndTime, elementEnd);
       }
     }

     return maxEndTime;
   }
   ```

3. **Update Progress Calculation for Variable Duration**:
   ```typescript
   // In export method's frame rendering loop
   for (let frame = 0; frame < this.getTotalFrames(); frame++) {
     const timeInSeconds = frame / this.fps;

     // ... render frame ...

     // Calculate progress based on actual export duration
     const progress = Math.min((timeInSeconds / this.totalDuration) * 100, 100);

     // Enhanced progress logging for long exports
     if (this.totalDuration > 60 && frame % (this.fps * 5) === 0) { // Log every 5 seconds for long videos
       const elapsedTime = (Date.now() - startTime) / 1000;
       const avgTimePerSecond = elapsedTime / Math.max(timeInSeconds, 0.1);
       const estimatedTotal = avgTimePerSecond * this.totalDuration;
       const remainingTime = Math.max(estimatedTotal - elapsedTime, 0);

       console.log(`[ExportEngine] Long export progress: ${progress.toFixed(1)}% (${timeInSeconds.toFixed(1)}s/${this.totalDuration.toFixed(1)}s) - Est. ${remainingTime.toFixed(0)}s remaining`);
     }

     // ... emit progress ...
   }
   ```

### Phase 2: Make Timeline UI Flexible

#### Step 2.1: Dynamic Timeline Duration Management
**File**: `apps/web/src/components/editor/timeline/index.tsx`

**Location**: Lines 345-348 (useEffect for duration update)

**Current Implementation**:
```typescript
// Update timeline duration when tracks change
useEffect(() => {
  const totalDuration = getTotalDuration();
  setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
}, [setDuration, getTotalDuration]);
```

**Detailed Implementation Plan**:

1. **Create Timeline Duration Utility Functions**:
   ```typescript
   // Add to apps/web/src/lib/timeline-duration-utils.ts (new file)
   export const TIMELINE_DURATION_LIMITS = {
     MIN_EMPTY_TIMELINE: 5, // 5 seconds for empty timeline (UI usability)
     MIN_WITH_CONTENT: 2, // 2 seconds minimum when content exists
     MAX_DURATION: 600, // 10 minutes maximum
     BUFFER_PERCENTAGE: 0.1, // 10% buffer for editing
   } as const;

   export function calculateTimelineDuration(contentDuration: number): number {
     // If no content, use minimum for UI usability
     if (contentDuration <= 0) {
       return TIMELINE_DURATION_LIMITS.MIN_EMPTY_TIMELINE;
     }

     // Calculate with buffer for editing convenience
     const bufferedDuration = contentDuration * (1 + TIMELINE_DURATION_LIMITS.BUFFER_PERCENTAGE);

     // Apply minimum and maximum constraints
     const minDuration = Math.max(bufferedDuration, TIMELINE_DURATION_LIMITS.MIN_WITH_CONTENT);
     const finalDuration = Math.min(minDuration, TIMELINE_DURATION_LIMITS.MAX_DURATION);

     return finalDuration;
   }

   export function validateTimelineDuration(duration: number): {
     isValid: boolean;
     clampedDuration: number;
     warnings: string[];
   } {
     const warnings: string[] = [];
     let clampedDuration = duration;

     if (duration < TIMELINE_DURATION_LIMITS.MIN_WITH_CONTENT) {
       warnings.push(`Duration ${duration.toFixed(2)}s is too short, using minimum ${TIMELINE_DURATION_LIMITS.MIN_WITH_CONTENT}s`);
       clampedDuration = TIMELINE_DURATION_LIMITS.MIN_WITH_CONTENT;
     }

     if (duration > TIMELINE_DURATION_LIMITS.MAX_DURATION) {
       warnings.push(`Duration ${duration.toFixed(2)}s exceeds maximum ${TIMELINE_DURATION_LIMITS.MAX_DURATION}s, clamping to maximum`);
       clampedDuration = TIMELINE_DURATION_LIMITS.MAX_DURATION;
     }

     return {
       isValid: warnings.length === 0,
       clampedDuration,
       warnings
     };
   }
   ```

2. **Update Timeline Component**:
   ```typescript
   // In apps/web/src/components/editor/timeline/index.tsx
   import { calculateTimelineDuration } from "@/lib/timeline-duration-utils";

   // Replace the existing useEffect (line 345-348)
   useEffect(() => {
     const contentDuration = getTotalDuration();
     const calculatedDuration = calculateTimelineDuration(contentDuration);

     // Log duration changes for debugging
     if (calculatedDuration !== duration) {
       console.log(`[Timeline] Duration updated: ${duration?.toFixed(3)}s → ${calculatedDuration.toFixed(3)}s (content: ${contentDuration.toFixed(3)}s)`);
     }

     setDuration(calculatedDuration);
   }, [setDuration, getTotalDuration, duration]);
   ```

3. **Update Timeline Store to Support Dynamic Duration**:
   ```typescript
   // In apps/web/src/stores/timeline-store.ts
   // Add method to recalculate timeline duration when elements change

   recalculateTimelineDuration: () => {
     const totalContentDuration = get().getTotalDuration();
     const newTimelineDuration = calculateTimelineDuration(totalContentDuration);

     // Notify timeline component of duration change
     // This will trigger the useEffect in timeline/index.tsx
     const currentState = get();

     // Emit timeline duration change event for any listeners
     if (typeof window !== 'undefined') {
       window.dispatchEvent(new CustomEvent('timeline-duration-changed', {
         detail: {
           contentDuration: totalContentDuration,
           timelineDuration: newTimelineDuration,
           previousDuration: currentState.duration
         }
       }));
     }

     return newTimelineDuration;
   },

   // Update existing methods that modify timeline content
   addElement: (...args) => {
     // ... existing addElement logic ...

     // Recalculate timeline duration after adding element
     get().recalculateTimelineDuration();
   },

   removeElement: (...args) => {
     // ... existing removeElement logic ...

     // Recalculate timeline duration after removing element
     get().recalculateTimelineDuration();
   },

   updateElementDuration: (trackId, elementId, duration, pushHistory = true) => {
     // ... existing updateElementDuration logic ...

     // Recalculate timeline duration after duration change
     get().recalculateTimelineDuration();
   },
   ```

#### Step 2.2: Enhanced Timeline Buffer Calculation
**File**: `apps/web/src/components/editor/timeline/index.tsx`

**Location**: Line 138 (dynamicBuffer calculation)

**Current Implementation**:
```typescript
const dynamicBuffer = Math.max(60, (duration || 0) * 0.1); // Buffer is 60s or 10% of duration, whichever is greater
```

**Detailed Implementation Plan**:

```typescript
// Replace existing buffer calculation with adaptive approach
const calculateTimelineBuffer = (duration: number, contentDuration: number) => {
  // Base buffer depends on duration and content density
  const baseBufferPercentage = 0.1; // 10% buffer
  const minBuffer = 30; // 30 seconds minimum buffer
  const maxBuffer = 120; // 2 minutes maximum buffer

  // Calculate buffer based on content vs timeline ratio
  const contentRatio = contentDuration > 0 ? contentDuration / duration : 0;

  if (contentRatio < 0.5) {
    // Sparse content needs more buffer for UI usability
    return Math.min(Math.max(duration * 0.2, minBuffer), maxBuffer);
  } else if (contentRatio > 0.9) {
    // Dense content needs less buffer
    return Math.min(Math.max(duration * 0.05, 15), maxBuffer);
  } else {
    // Standard buffer calculation
    return Math.min(Math.max(duration * baseBufferPercentage, minBuffer), maxBuffer);
  }
};

// Apply new buffer calculation
const totalDuration = getTotalDuration();
const dynamicBuffer = calculateTimelineBuffer(duration || 0, totalDuration);
```

#### Step 2.3: Enhanced Timeline Zoom for Variable Duration
**File**: `apps/web/src/hooks/use-timeline-zoom.ts`

**Location**: Lines 24-25 (zoom level adjustment logic)

**Current Implementation**:
```typescript
const handleWheel = useCallback((e: React.WheelEvent) => {
  // Only zoom if user is using pinch gesture (ctrlKey or metaKey is true)
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15; // Fixed zoom increment
    setZoomLevel((prev) => Math.max(0.1, Math.min(10, prev + delta)));
  }
  // ... rest of implementation
}, []);
```

**Detailed Implementation Plan**:

1. **Add Dynamic Zoom Level Support**:
   ```typescript
   // Update the hook interface to accept timeline duration
   interface UseTimelineZoomProps {
     containerRef: RefObject<HTMLDivElement>;
     timelineDuration?: number; // Add timeline duration
     isInTimeline?: boolean;
   }

   export function useTimelineZoom({
     containerRef,
     timelineDuration = 60, // Default to 60 seconds
     isInTimeline = false,
   }: UseTimelineZoomProps): UseTimelineZoomReturn {
     // Calculate adaptive zoom parameters based on duration
     const zoomConfig = useMemo(() => getZoomConfigForDuration(timelineDuration), [timelineDuration]);

     const [zoomLevel, setZoomLevel] = useState(zoomConfig.initialZoom);

     const handleWheel = useCallback((e: React.WheelEvent) => {
       if (e.ctrlKey || e.metaKey) {
         e.preventDefault();

         // Use adaptive zoom increment based on current zoom and duration
         const zoomIncrement = calculateZoomIncrement(zoomLevel, timelineDuration);
         const delta = e.deltaY > 0 ? -zoomIncrement : zoomIncrement;

         setZoomLevel((prev) => Math.max(zoomConfig.minZoom, Math.min(zoomConfig.maxZoom, prev + delta)));
       }
       // ... rest of implementation
     }, [zoomLevel, timelineDuration, zoomConfig]);

     return { zoomLevel, setZoomLevel, handleWheel };
   }
   ```

2. **Create Adaptive Zoom Configuration**:
   ```typescript
   // Add to apps/web/src/lib/timeline-zoom-utils.ts (new file)
   interface ZoomConfig {
     minZoom: number;
     maxZoom: number;
     initialZoom: number;
     snapPoints: number[];
     incrementSize: number;
   }

   export function getZoomConfigForDuration(duration: number): ZoomConfig {
     if (duration <= 5) {
       // Short videos: need high precision zoom
       return {
         minZoom: 0.5,
         maxZoom: 20,
         initialZoom: 2,
         snapPoints: [0.5, 1, 2, 5, 10, 15, 20],
         incrementSize: 0.25
       };
     } else if (duration <= 30) {
       // Medium videos: balanced zoom range
       return {
         minZoom: 0.2,
         maxZoom: 10,
         initialZoom: 1,
         snapPoints: [0.2, 0.5, 1, 2, 4, 6, 8, 10],
         incrementSize: 0.2
       };
     } else if (duration <= 300) {
       // Long videos: wide view priority
       return {
         minZoom: 0.05,
         maxZoom: 4,
         initialZoom: 0.3,
         snapPoints: [0.05, 0.1, 0.25, 0.5, 1, 2, 4],
         incrementSize: 0.1
       };
     } else {
       // Very long videos: emphasis on overview
       return {
         minZoom: 0.01,
         maxZoom: 2,
         initialZoom: 0.1,
         snapPoints: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
         incrementSize: 0.05
       };
     }
   }

   export function calculateZoomIncrement(currentZoom: number, duration: number): number {
     const config = getZoomConfigForDuration(duration);

     // Variable increment based on current zoom level
     if (currentZoom < 0.1) {
       return config.incrementSize * 0.5; // Smaller increments at very low zoom
     } else if (currentZoom > 5) {
       return config.incrementSize * 2; // Larger increments at high zoom
     } else {
       return config.incrementSize;
     }
   }

   // Zoom to fit content utility
   export function calculateZoomToFitContent(
     containerWidth: number,
     contentDuration: number,
     pixelsPerSecond: number = 50
   ): number {
     const requiredWidth = contentDuration * pixelsPerSecond;
     const zoomToFit = containerWidth / requiredWidth;

     // Clamp to reasonable bounds
     return Math.max(0.01, Math.min(10, zoomToFit));
   }
   ```

3. **Add Zoom Preset Controls**:
   ```typescript
   // Add to timeline toolbar component
   const ZoomControls = ({
     currentZoom,
     onZoomChange,
     timelineDuration
   }: {
     currentZoom: number;
     onZoomChange: (zoom: number) => void;
     timelineDuration: number;
   }) => {
     const zoomConfig = getZoomConfigForDuration(timelineDuration);

     return (
       <div className="flex items-center gap-1">
         <Button
           size="sm"
           variant="ghost"
           onClick={() => onZoomChange(zoomConfig.snapPoints[0])}
           title="Zoom out to minimum"
         >
           <ZoomOut className="w-4 h-4" />
         </Button>

         <Select value={currentZoom.toString()} onValueChange={(value) => onZoomChange(Number(value))}>
           <SelectTrigger className="w-20">
             <SelectValue />
           </SelectTrigger>
           <SelectContent>
             {zoomConfig.snapPoints.map((zoom) => (
               <SelectItem key={zoom} value={zoom.toString()}>
                 {Math.round(zoom * 100)}%
               </SelectItem>
             ))}
           </SelectContent>
         </Select>

         <Button
           size="sm"
           variant="ghost"
           onClick={() => {
             const fitZoom = calculateZoomToFitContent(800, timelineDuration); // Assume 800px container
             onZoomChange(fitZoom);
           }}
           title="Zoom to fit content"
         >
           Fit
         </Button>

         <Button
           size="sm"
           variant="ghost"
           onClick={() => onZoomChange(zoomConfig.snapPoints[zoomConfig.snapPoints.length - 1])}
           title="Zoom in to maximum"
         >
           <ZoomIn className="w-4 h-4" />
         </Button>
       </div>
     );
   };
   ```

### Phase 3: Update AI Video Constraints (Optional)

#### Step 3.1: Make AI Duration Limits Configurable
**File**: `apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Current Approach**:
```typescript
max_duration: 10, // Fixed for all models
```

**Proposed Enhancement**:
```typescript
// Model-specific limits based on API capabilities
max_duration: {
  default: 10,
  premium: 30, // If premium tier supports longer videos
  enterprise: 60
},
```

#### Step 3.2: Add User Settings for AI Limits
**File**: `apps/web/src/stores/settings-store.ts` (new file)

```typescript
interface AISettings {
  maxDuration: number; // User-configurable max duration
  qualityPreference: 'speed' | 'quality';
  costLimitPerVideo: number;
}
```

### Phase 4: Enhanced User Experience

#### Step 4.1: Add Timeline Duration Controls
**Location**: Timeline toolbar

**New UI Component**:
```typescript
<TimelineDurationControl
  currentDuration={duration}
  contentDuration={totalDuration}
  onDurationChange={setDuration}
  minDuration={2} // New minimum
  maxDuration={600} // 10 minutes
/>
```

#### Step 4.2: Export Duration Validation
**File**: `apps/web/src/hooks/use-export-validation.ts`

**Add Validation Logic**:
```typescript
const validateExportDuration = (duration: number) => {
  const warnings = [];
  const errors = [];

  if (duration > 600) { // 10 minutes
    errors.push("Duration exceeds maximum limit of 10 minutes");
  } else if (duration > 300) { // 5 minutes
    warnings.push("Long exports may take significant time and memory");
  }

  if (duration < 0.1) { // 100ms
    errors.push("Duration too short for meaningful video export");
  }

  return { warnings, errors, isValid: errors.length === 0 };
};
```

## Migration Strategy & Testing

### Comprehensive Testing Strategy

#### 1. Unit Tests Updates
**Files to Update**:
- `apps/web/src/stores/__tests__/timeline-store.test.ts`
- `apps/web/src/test/lib-tests/timeline.test.ts`
- `apps/web/src/hooks/__tests__/use-timeline-zoom.test.ts` (new)

**Test Cases to Add**:
```typescript
// In timeline-store.test.ts - Add variable duration tests
describe('Variable Timeline Duration', () => {
  it('should set minimum duration for empty timeline', () => {
    const { result } = renderHook(() => useTimelineStore());

    // Empty timeline should use 5-second minimum (not 10)
    expect(result.current.calculateTimelineDuration(0)).toBe(5);
  });

  it('should add buffer to content duration', () => {
    const { result } = renderHook(() => useTimelineStore());

    // 3-second content should get ~10% buffer
    const contentDuration = 3;
    const timelineDuration = result.current.calculateTimelineDuration(contentDuration);
    expect(timelineDuration).toBeGreaterThan(contentDuration);
    expect(timelineDuration).toBeLessThan(contentDuration * 1.2);
  });

  it('should cap timeline at 10 minutes maximum', () => {
    const { result } = renderHook(() => useTimelineStore());

    // 15-minute content should be capped at 10 minutes
    expect(result.current.calculateTimelineDuration(900)).toBe(600);
  });

  it('should handle duration updates when elements change', () => {
    const { result } = renderHook(() => useTimelineStore());

    // Add element and verify duration recalculation
    act(() => {
      result.current.addElement({
        trackId: 'main',
        element: createMockElement({ duration: 30 })
      });
    });

    // Timeline duration should be > 30 (with buffer) but < 600
    const duration = result.current.recalculateTimelineDuration();
    expect(duration).toBeGreaterThan(30);
    expect(duration).toBeLessThan(600);
  });
});
```

#### 2. Integration Tests
**Files to Update**:
- `apps/web/src/test/integration/timeline-element.test.ts`
- `apps/web/src/test/integration/new-video-models.test.ts`

**Test Scenarios**:
```typescript
// Export duration integration tests
describe('Export Duration Integration', () => {
  const testDurations = [0.5, 2, 30, 120, 300, 600];

  testDurations.forEach(duration => {
    it(`should export ${duration}s video successfully`, async () => {
      // Create timeline with specific duration
      const timeline = createTestTimeline(duration);

      // Perform export
      const exportEngine = new ExportEngine(/* ... */, duration);
      const result = await exportEngine.export();

      // Verify exported video duration matches expected
      expect(result.actualDuration).toBeCloseTo(duration, 1);
    });
  });

  it('should handle export timeout for long videos', async () => {
    // Test export timeout handling
    const timeline = createTestTimeline(600); // 10 minutes
    const exportEngine = new ExportEngine(/* ... */, 600);

    // Should complete within reasonable time
    const startTime = Date.now();
    await exportEngine.export();
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(600000); // Less than 10 minutes to export 10 minutes
  });
});
```

#### 3. Performance Tests
**Files to Create**:
- `apps/web/src/test/performance/timeline-performance.test.ts`

```typescript
// Timeline performance benchmarks
describe('Timeline Performance', () => {
  it('should maintain <16ms render time for long timelines', async () => {
    const longTimeline = createTestTimeline(600); // 10 minutes
    const component = render(<TimelineComponent timeline={longTimeline} />);

    // Measure render performance
    const startTime = performance.now();
    component.rerender(<TimelineComponent timeline={longTimeline} />);
    const renderTime = performance.now() - startTime;

    expect(renderTime).toBeLessThan(16); // 60fps = 16.67ms per frame
  });

  it('should handle zoom operations smoothly', () => {
    const { result } = renderHook(() => useTimelineZoom({
      containerRef: createRef(),
      timelineDuration: 300
    }));

    // Perform multiple zoom operations
    const startTime = performance.now();
    for (let i = 0; i < 100; i++) {
      act(() => {
        result.current.setZoomLevel(prev => prev * 1.1);
      });
    }
    const totalTime = performance.now() - startTime;

    expect(totalTime).toBeLessThan(100); // Should complete in <100ms
  });
});
```

### Backward Compatibility Strategy

#### 1. Project Schema Migration
**File**: `apps/web/src/stores/project-store.ts`

```typescript
// Add project schema versioning for timeline duration changes
interface ProjectV2 {
  version: 2;
  timelineDurationMode: 'legacy' | 'flexible'; // Migration flag
  minTimelineDuration: number; // Store user preference
  maxTimelineDuration: number;
}

// Migration function for existing projects
const migrateProjectToV2 = (project: ProjectV1): ProjectV2 => {
  return {
    ...project,
    version: 2,
    timelineDurationMode: 'legacy', // Keep old behavior for existing projects
    minTimelineDuration: 10, // Maintain 10-second minimum for existing projects
    maxTimelineDuration: 600,
  };
};
```

#### 2. Feature Flag System
**File**: `apps/web/src/config/feature-flags.ts`

```typescript
export const FEATURE_FLAGS = {
  FLEXIBLE_TIMELINE_DURATION: {
    enabled: true,
    rolloutPercentage: 100,
    eligibleProjectVersions: [2], // Only for new projects initially
  },
  EXTENDED_EXPORT_DURATION: {
    enabled: true,
    rolloutPercentage: 50, // Gradual rollout
    requiresUserOptIn: true,
  },
} as const;

// Usage in timeline component
const useFlexibleDuration = () => {
  const project = useProjectStore(state => state.activeProject);
  const flag = FEATURE_FLAGS.FLEXIBLE_TIMELINE_DURATION;

  return flag.enabled &&
         project?.version >= 2 &&
         project?.timelineDurationMode === 'flexible';
};
```

#### 3. User Settings Migration
**File**: `apps/web/src/stores/settings-store.ts` (new)

```typescript
interface UserSettings {
  timeline: {
    defaultMinDuration: number; // User preference
    preferredZoomBehavior: 'auto' | 'manual';
    enableLongVideoExport: boolean; // Explicit opt-in
  };
  export: {
    maxAllowedDuration: number;
    warnOnLongExports: boolean;
  };
}

const defaultSettings: UserSettings = {
  timeline: {
    defaultMinDuration: 5, // New default for new users
    preferredZoomBehavior: 'auto',
    enableLongVideoExport: false, // Require opt-in
  },
  export: {
    maxAllowedDuration: 300, // 5 minutes default, upgradeable to 10
    warnOnLongExports: true,
  },
};
```

### Phased Rollout Strategy

#### Phase 1: Infrastructure Changes (Week 1-2)
**Files Modified**:
- `electron/ffmpeg-handler.ts` - Remove hard 10s limit
- `apps/web/src/lib/export-engine.ts` - Add duration validation
- `apps/web/src/lib/timeline-duration-utils.ts` - New utility functions

**User Impact**: None (changes are internal)
**Testing**: Unit tests, export validation tests
**Rollback**: Simple revert of duration parameter changes

#### Phase 2: Timeline UI Flexibility (Week 3-4)
**Files Modified**:
- `apps/web/src/components/editor/timeline/index.tsx` - Dynamic duration
- `apps/web/src/hooks/use-timeline-zoom.ts` - Adaptive zoom
- `apps/web/src/stores/timeline-store.ts` - Duration recalculation

**User Impact**: Visible timeline duration changes
**Testing**: Integration tests, UI responsiveness tests
**Feature Flag**: `FLEXIBLE_TIMELINE_DURATION` enabled for new projects only

#### Phase 3: Enhanced User Controls (Week 5-6)
**Files Added**:
- `apps/web/src/components/editor/timeline/duration-controls.tsx`
- `apps/web/src/stores/settings-store.ts`
- Enhanced export validation

**User Impact**: New user controls and settings
**Testing**: End-to-end tests, user acceptance testing
**Feature Flag**: Full rollout with user opt-in for extended exports

### Long-Term Support Considerations

#### 1. Performance Monitoring
```typescript
// Add performance tracking for long timelines
const useTimelinePerformanceMonitor = (duration: number) => {
  useEffect(() => {
    if (duration > 300) { // Monitor videos > 5 minutes
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const longTasks = entries.filter(entry => entry.duration > 50);

        if (longTasks.length > 0) {
          console.warn(`[Timeline] Long tasks detected for ${duration}s timeline:`, longTasks);
          // Report to analytics/monitoring service
        }
      });

      observer.observe({ entryTypes: ['longtask'] });
      return () => observer.disconnect();
    }
  }, [duration]);
};
```

#### 2. Memory Management
```typescript
// Enhanced memory monitoring for long exports
const useExportMemoryManager = (duration: number) => {
  useEffect(() => {
    if (duration > 180) { // > 3 minutes
      const checkMemory = () => {
        if ('memory' in performance) {
          const memory = (performance as any).memory;
          const usedMB = memory.usedJSHeapSize / 1024 / 1024;
          const limitMB = memory.jsHeapSizeLimit / 1024 / 1024;

          if (usedMB > limitMB * 0.8) {
            console.warn(`[Export] High memory usage: ${usedMB.toFixed(1)}MB / ${limitMB.toFixed(1)}MB`);
            // Trigger garbage collection or optimize frames
          }
        }
      };

      const interval = setInterval(checkMemory, 5000);
      return () => clearInterval(interval);
    }
  }, [duration]);
};
```

#### 3. Error Recovery
```typescript
// Robust error handling for extended operations
export class ExtendedTimelineManager {
  private static readonly CHECKPOINT_INTERVAL = 30; // seconds

  async handleLongOperation(duration: number, operation: () => Promise<void>) {
    const checkpoints = Math.ceil(duration / this.CHECKPOINT_INTERVAL);

    for (let i = 0; i < checkpoints; i++) {
      try {
        await operation();
      } catch (error) {
        console.error(`[Timeline] Operation failed at checkpoint ${i}:`, error);

        // Attempt recovery strategies
        if (error instanceof MemoryError) {
          await this.freeMemory();
          continue;
        }

        if (error instanceof TimeoutError) {
          await this.increaseTimeout();
          continue;
        }

        throw error; // Re-throw if no recovery possible
      }
    }
  }
}

## Benefits After Implementation

### User Experience Improvements
- ✅ Create videos shorter than 10 seconds
- ✅ Support for longer videos up to 10 minutes
- ✅ More precise editing for short-form content
- ✅ Cleaner timeline UI for brief videos
- ✅ Faster exports for short content
- ✅ Professional workflow support for various video lengths

### Technical Benefits
- ✅ More flexible architecture
- ✅ Better performance for short videos
- ✅ Reduced memory usage for minimal projects
- ✅ Enhanced zoom capabilities
- ✅ Future-proof for varying content lengths

### Risk Mitigation
- ✅ Maintains stability through gradual rollout
- ✅ Preserves existing functionality
- ✅ Adds proper validation and error handling
- ✅ Includes performance safeguards

## Implementation Priority

### High Priority (Phase 1)
- Remove FFmpeg export limit
- Update export engine duration handling
- Add export validation

### Medium Priority (Phase 2)
- Make timeline UI flexible
- Enhance zoom for short content
- Add duration controls

### Low Priority (Phase 3)
- AI model constraint improvements
- Advanced user settings
- Premium feature differentiation

---

*This analysis provides a complete roadmap for removing the 10-second timeline limitation while maintaining system stability and user experience quality.*