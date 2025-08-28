# Error Handling Migration Guide

This guide shows how to migrate from `console.error` patterns to our new enhanced error handling system.

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

- [ ] Replace all `console.error` calls with appropriate error handlers
- [ ] Add error boundaries around critical components  
- [ ] Update async operations to use enhanced error handling
- [ ] Test error scenarios to ensure user notifications work
- [ ] Verify error IDs are being generated and logged properly