# Error Handling Migration Guide

This guide shows how to migrate from `console.error` patterns to our new enhanced error handling system.

## Core Error Handling Files

### 🎯 **Main Implementation Files**
- `apps/web/src/lib/error-handler.ts` - Core error handling system with categories & severities
- `apps/web/src/components/error-boundary.tsx` - React Error Boundary component with fallback UI
- `apps/web/src/routes/__root.tsx:72-115` - Enhanced TanStack Router error handling
- `apps/web/src/lib/__tests__/error-handler.test.ts` - Test suite for error handling

### 🚨 **Files Still Using console.error (Needs Migration)**

**High Priority (Critical Operations):**
- `apps/web/src/stores/timeline-store.ts` - Timeline operations & media processing
- `apps/web/src/stores/text2image-store.ts` - AI text-to-image generation
- `apps/web/src/components/export-dialog.tsx` - Video export functionality

**Medium Priority (User-Facing Features):**
- `apps/web/src/components/editor/media-panel/views/sounds.tsx` - Sound library & downloads
- `apps/web/src/components/editor/media-panel/views/captions.tsx` - Caption generation
- `apps/web/src/components/editor/properties-panel/settings-view.tsx` - Settings persistence

**Low Priority (Utilities & Adapters):**
- `apps/web/src/lib/api-adapter.ts` - API request handling
- `apps/web/src/lib/fetch-github-stars.ts` - GitHub API integration

**Recently Migrated (Examples to Follow):**
- ✅ `apps/web/src/lib/ai-video-client.ts` - Shows AI service error migration pattern
- ✅ `apps/web/src/hooks/use-blob-image.ts` - Shows media processing error pattern

## Quick Reference

### Old Pattern (❌)
```typescript
try {
  // some operation
} catch (error) {
  console.error("Something failed:", error);
  // User has no idea what happened
}
```

### New Pattern (✅)
```typescript
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

try {
  // some operation
} catch (error) {
  handleError(error, {
    operation: "Descriptive Operation Name",
    category: ErrorCategory.APPROPRIATE_CATEGORY,
    severity: ErrorSeverity.APPROPRIATE_LEVEL,
    metadata: { /* relevant context */ }
  });
}
```

## Migration Examples

### 1. AI Service Errors

**📁 Example Files:**
- `apps/web/src/lib/ai-video-client.ts:120-145` - FAL API error handling
- `apps/web/src/stores/text2image-store.ts` - Text-to-image generation errors

```typescript
// ❌ Before
try {
  const result = await falAPI.generate(request);
} catch (error) {
  console.error("❌ FAL API Error:", error);
  return null;
}

// ✅ After  
import { handleAIServiceError } from "@/lib/error-handler";

try {
  const result = await falAPI.generate(request);
} catch (error) {
  handleAIServiceError(error, "AI Video Generation", {
    requestId: request.id,
    model: request.model
  });
  return null;
}
```

### 2. Media Processing Errors

**📁 Example Files:**
- `apps/web/src/hooks/use-blob-image.ts:42-56` - Blob conversion error handling
- `apps/web/src/stores/timeline-store.ts` - Timeline media processing

```typescript
// ❌ Before
try {
  const blob = await convertToBlob(url);
} catch (error) {
  console.error("Failed to convert image to blob:", error);
  setError("Failed to load image");
}

// ✅ After
import { handleMediaProcessingError } from "@/lib/error-handler";

try {
  const blob = await convertToBlob(url);
} catch (error) {
  const processedError = handleMediaProcessingError(error, "Image to Blob Conversion", {
    originalUrl: url,
    showToast: false // Optional: suppress user notification
  });
  setError(processedError.message);
}
```

### 3. Network Errors

**📁 Example Files:**
- `apps/web/src/lib/api-adapter.ts` - API request error handling
- `apps/web/src/lib/fetch-github-stars.ts` - External API calls

```typescript
// ❌ Before
try {
  const response = await fetch(url);
} catch (error) {
  console.error("Network request failed:", error);
}

// ✅ After
import { handleNetworkError } from "@/lib/error-handler";

try {
  const response = await fetch(url);
} catch (error) {
  handleNetworkError(error, "API Request", {
    url,
    method: 'GET'
  });
}
```

### 4. Storage Operations

**📁 Example Files:**
- `apps/web/src/components/editor/properties-panel/settings-view.tsx` - Settings persistence
- `apps/web/src/stores/editor-store.ts` - Project autosave errors

```typescript
// ❌ Before
try {
  await saveToStorage(data);
} catch (error) {
  console.error("Storage save failed:", error);
}

// ✅ After
import { handleStorageError } from "@/lib/error-handler";

try {
  await saveToStorage(data);
} catch (error) {
  handleStorageError(error, "Save Project Data", {
    dataType: 'project',
    size: data.length
  });
}
```

### 5. Export Operations (Critical)

**📁 Example Files:**
- `apps/web/src/components/export-dialog.tsx` - Main export dialog
- `apps/web/src/lib/ffmpeg-utils.ts` - FFmpeg export operations

```typescript
// ❌ Before
try {
  await exportVideo(settings);
} catch (error) {
  console.error("Export failed:", error);
}

// ✅ After
import { handleExportError } from "@/lib/error-handler";

try {
  await exportVideo(settings);
} catch (error) {
  handleExportError(error, "Video Export", {
    format: settings.format,
    resolution: settings.resolution,
    duration: settings.duration
  });
}
```

## Convenience Functions

Use these for common scenarios:

- `handleNetworkError()` - API calls, fetch operations
- `handleValidationError()` - Form validation, input checking
- `handleStorageError()` - IndexedDB, localStorage operations  
- `handleMediaProcessingError()` - Video/audio/image processing
- `handleAIServiceError()` - AI API calls
- `handleExportError()` - Video export operations

## Error Severity Guidelines

- **LOW**: Validation errors, non-critical UI issues
- **MEDIUM**: Network timeouts, recoverable API failures  
- **HIGH**: Storage failures, media processing errors
- **CRITICAL**: Export failures, system crashes

## Benefits of Migration

1. **User Experience**: Users see friendly error messages instead of silence
2. **Debugging**: Structured logging with error IDs and context
3. **Tracking**: Ready for integration with error tracking services
4. **Consistency**: Standardized error handling across the app
5. **Recovery**: Better error recovery patterns

## React Components with Error Boundaries

**📁 Implementation Files:**
- `apps/web/src/components/error-boundary.tsx` - Error boundary component & HOC
- `apps/web/src/routes/__root.tsx:180-195` - Root layout error boundary usage

Wrap critical components with error boundaries:

```typescript
import { withErrorBoundary } from "@/components/error-boundary";

const MyComponent = () => {
  // component logic
};

export default withErrorBoundary(MyComponent, {
  isolate: true, // Only affects this component
  onError: (error, errorInfo, errorId) => {
    // Custom error handling
  }
});
```

## Async Error Handling Hook

For async operations in components:

```typescript
import { useErrorHandler } from "@/lib/error-handler";

const MyComponent = () => {
  const { withErrorHandling } = useErrorHandler();
  
  const handleAsyncOperation = () => {
    withErrorHandling(
      async () => {
        // async operation
      },
      {
        operation: "My Async Operation",
        category: ErrorCategory.UI,
        severity: ErrorSeverity.MEDIUM
      }
    );
  };
};
```

## Migration Checklist

### Quick Wins (< 5 minutes each)
- [ ] Replace simple `console.error` calls with `handleError()`
- [ ] Import error handling functions in existing files
- [ ] Add basic error categories to existing try-catch blocks

### Medium Tasks (5-10 minutes each)
- [ ] Update API call error handling with proper metadata
- [ ] Add error boundaries to individual components
- [ ] Migrate storage operation error handling
- [ ] Update media processing error patterns

### Complex Tasks (10+ minutes - Break into subtasks)

#### 🔧 **Task: Migrate AI Service Error Handling (15-20 min)**

**📁 Target Files to Migrate:**
- `apps/web/src/lib/ai-video-client.ts` - Primary AI video client
- `apps/web/src/stores/text2image-store.ts` - Text-to-image generation
- `apps/web/src/components/editor/media-panel/views/captions.tsx` - Caption generation

Break down into:
1. **Subtask 1** (5 min): Audit all AI service calls in codebase
   - Search for fal API calls, OpenAI calls, etc.
   - Document current error patterns
2. **Subtask 2** (8 min): Replace error handling in 3-5 files at a time
   - Import `handleAIServiceError` from `@/lib/error-handler`
   - Add proper metadata (model, requestId, etc.)
   - Test one file before moving to next batch
3. **Subtask 3** (5 min): Verify all AI errors show user-friendly messages
   - Test error scenarios in dev environment
   - Check toast notifications appear correctly

#### 🔧 **Task: Implement Error Boundaries System-Wide (20-25 min)**

**📁 Critical Components to Wrap:**
- `apps/web/src/components/editor/timeline/` - Timeline components
- `apps/web/src/components/editor/video-player.tsx` - Video player
- `apps/web/src/components/export-dialog.tsx` - Export dialog
- `apps/web/src/components/editor/media-panel/` - Media panel sections

Break down into:
1. **Subtask 1** (8 min): Identify critical components that need isolation
   - Timeline components, video player, export dialog
   - Media upload areas, project loading sections
2. **Subtask 2** (10 min): Wrap components with error boundaries
   - Use `withErrorBoundary` HOC for 2-3 components at a time
   - Configure isolation settings and custom error handlers
   - Test that errors are contained properly
3. **Subtask 3** (5 min): Update root error boundary configuration
   - Ensure global boundary catches unhandled errors
   - Test error fallback UI displays correctly

#### 🔧 **Task: Migrate Export/Media Processing Errors (25-30 min)**

**📁 Export & Processing Files:**
- `apps/web/src/lib/ffmpeg-utils.ts` - FFmpeg processing
- `apps/web/src/components/export-dialog.tsx` - Export UI
- `apps/web/src/stores/timeline-store.ts` - Timeline operations
- `apps/web/src/hooks/use-blob-image.ts` - Image processing

Break down into:
1. **Subtask 1** (10 min): Audit export pipeline error handling
   - Check video export, audio export, thumbnail generation
   - Document all current console.error locations
2. **Subtask 2** (12 min): Implement enhanced error handling
   - Replace with `handleExportError` and `handleMediaProcessingError`
   - Add comprehensive metadata (format, duration, file size)
   - Test error scenarios with actual exports
3. **Subtask 3** (8 min): Add user-friendly recovery options
   - Show retry buttons for network-related failures
   - Provide format/quality reduction suggestions
   - Test that users can recover from failed exports

#### 🔧 **Task: Comprehensive Error Testing (15-20 min)**
Break down into:
1. **Subtask 1** (8 min): Test error scenarios manually
   - Disconnect network during API calls
   - Fill storage during save operations  
   - Use invalid media files for processing
2. **Subtask 2** (7 min): Verify error notifications and IDs
   - Check that toast messages appear for all scenarios
   - Verify error IDs are generated and logged
   - Test error boundary fallback UI
3. **Subtask 3** (5 min): Document any missing error handling
   - Create issues for any gaps found
   - Update migration checklist with additional items

### Validation Tasks (< 5 minutes each)
- [ ] Test network error scenarios (disconnect internet)
- [ ] Verify error IDs are generated and logged properly  
- [ ] Check that critical errors show recovery options
- [ ] Ensure error boundaries prevent app crashes
- [ ] Validate toast notifications appear for all error types

## 📋 **Subtask Management Tips**

### For Tasks > 10 Minutes:
1. **Always break into ≤10 minute subtasks**
2. **Complete and test each subtask before moving to next**
3. **Take 2-minute break between subtasks to avoid fatigue**
4. **Document any blockers or unexpected findings**

### Progress Tracking:
```markdown
Task: [Main Task Name]
├── ✅ Subtask 1: [Description] (5 min) - DONE
├── 🔄 Subtask 2: [Description] (8 min) - IN PROGRESS  
└── ⏳ Subtask 3: [Description] (5 min) - PENDING
```

### Quality Gates:
- Each subtask must include basic testing
- No subtask should break existing functionality
- Document any new patterns discovered during migration