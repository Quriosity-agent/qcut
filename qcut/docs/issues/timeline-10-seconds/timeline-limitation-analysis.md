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
**File**: `electron/ffmpeg-handler.ts:681`

**Current Code**:
```typescript
"-t", "10", // Limit to 10 seconds to avoid issues
```

**Proposed Fix**:
```typescript
"-t", duration.toString(), // Use actual video duration
```

**Implementation Details**:
- Pass actual video duration from the export request
- Add validation to ensure duration > 0
- Add timeout handling for very long exports (>10 minutes)
- Implement progress callbacks for long exports
- Set maximum timeline duration to 10 minutes (600 seconds) for performance

#### Step 1.2: Update Export Engine
**File**: `apps/web/src/lib/export-engine.ts`

**Add Dynamic Duration Support**:
```typescript
// Calculate actual content duration with 10-minute maximum
const contentDuration = getTotalContentDuration();
const actualDuration = Math.min(Math.max(contentDuration, 1), 600); // Min 1 second, Max 10 minutes
// Pass to FFmpeg handler
await ffmpegHandler.export({ duration: actualDuration, ...otherOptions });
```

### Phase 2: Make Timeline UI Flexible

#### Step 2.1: Dynamic Minimum Timeline Duration
**File**: `apps/web/src/components/editor/timeline/index.tsx:347`

**Current Code**:
```typescript
setDuration(Math.max(totalDuration, 10)); // Minimum 10 seconds for empty timeline
```

**Proposed Fix**:
```typescript
// Dynamic duration with both minimum and maximum constraints
const minDuration = getMinimumTimelineDuration(totalDuration);
const maxDuration = 600; // 10 minutes maximum
setDuration(Math.min(Math.max(totalDuration, minDuration), maxDuration));

function getMinimumTimelineDuration(contentDuration: number): number {
  // If no content, minimum for UI usability (5 seconds)
  if (contentDuration === 0) return 5;

  // If content exists, add small buffer for editing
  return Math.max(contentDuration * 1.1, 2); // 10% buffer, minimum 2 seconds
}
```

#### Step 2.2: Improve Timeline Zoom for Short Content
**File**: `apps/web/src/hooks/use-timeline-zoom.ts`

**Add Enhanced Zoom for Variable Duration**:
```typescript
// Enhanced zoom levels for both short and long content
const getZoomLevelsForDuration = (duration: number) => {
  if (duration < 5) {
    return [0.1, 0.25, 0.5, 1, 2, 5, 10]; // More granular zoom for short videos
  } else if (duration > 300) { // > 5 minutes
    return [0.01, 0.05, 0.1, 0.25, 0.5, 1]; // Wider zoom for long videos
  }
  return [0.1, 0.5, 1, 2, 4, 8]; // Standard zoom levels
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

### Testing Strategy
1. **Unit Tests**: Update timeline store tests to support variable durations
2. **Integration Tests**: Test export process with various durations (0.5s, 2s, 30s, 120s, 300s, 600s)
3. **Performance Tests**: Ensure UI remains responsive with longer timelines
4. **User Testing**: Validate UX with content creators using short-form video

### Backward Compatibility
- **Default Behavior**: New projects still start with reasonable timeline length (5s instead of 10s)
- **Existing Projects**: Maintain current behavior for projects created with 10s minimum
- **Migration Flag**: Add project setting to opt into new flexible timeline system

### Rollout Phases
1. **Phase 1**: Backend export fixes (hidden from users)
2. **Phase 2**: UI timeline flexibility (user-visible improvement)
3. **Phase 3**: Advanced controls and AI enhancements (power user features)

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