# Error Handling Improvement Plan - QCut Video Editor

## Executive Summary

This document outlines a systematic plan to improve error handling across QCut, migrating from console.error patterns to the comprehensive error-handler system. Each task is designed to be completed in **under 10 minutes** for rapid incremental improvement.

**Current State:** 
- ✅ Infrastructure ready (error-handler.ts, ErrorBoundary)
- ⚠️ Only 11/300+ files using new system
- 🔴 87 console.error calls remaining
- 🔴 256 try-catch blocks need review

**Goal:** Achieve 80% adoption of proper error handling within 2 weeks through quick, targeted improvements.

---

## ⚠️ CRITICAL SAFETY RULES

### DO NOT BREAK EXISTING FEATURES
1. **ALWAYS preserve `throw error`** statements - they maintain error propagation
2. **ALWAYS keep `finally` blocks** intact - they handle cleanup
3. **NEVER remove error re-throwing** unless you understand the caller's expectations
4. **ALWAYS maintain existing return values** - some functions return null/undefined on error
5. **TEST each change** before moving to the next file

### Safe Migration Pattern
```typescript
// ✅ SAFE: Adds notification while preserving behavior
} catch (error) {
  handleError(error, context);  // Add user notification
  throw error;                  // KEEP: Preserve error propagation
} finally {
  cleanup();                     // KEEP: Preserve cleanup
}

// ❌ UNSAFE: Breaks error propagation
} catch (error) {
  handleError(error, context);  // Missing throw - breaks callers!
}

// ❌ UNSAFE: Double notification
} catch (error) {
  handleError(error, context);  // Shows toast
  toast.error("Error!");         // Duplicate notification - remove this!
}
```

### When to use `showToast: false`
- System/migration errors during startup
- Background operations (auto-save, polling)
- Errors already shown by parent component
- Development-only logging

---

## Phase 1: Critical User-Facing Operations (Day 1-2)
*Fix errors that directly impact user experience*

### Task 1.1: Timeline Element Operations (8 min)
**File:** `components/editor/timeline/timeline-element.tsx`
**Lines:** 247-251
**Current Issue:** Console.error with manual toast duplication
```typescript
// BEFORE (Current code at line 247-251):
} catch (error) {
  console.error("Unexpected error replacing clip:", error);
  toast.error(
    `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`
  );
} finally {
  cleanup();
}

// AFTER (Improved version):
} catch (error) {
  // Import at top: import { handleMediaProcessingError } from '@/lib/error-handler';
  handleMediaProcessingError(error, "Replace clip", { 
    trackId: track.id, 
    elementId: element.id 
  });
  // Note: handleMediaProcessingError already shows toast, no need for duplicate
} finally {
  cleanup(); // IMPORTANT: Keep cleanup to prevent memory leaks
}
```
**Safety:** ✅ Preserves cleanup() in finally block, maintains error feedback
**Impact:** Prevents data loss during clip replacement, cleaner error messages

### Task 1.2: FFmpeg Operations (7 min)
**File:** `lib/ffmpeg-utils.ts`
**Lines:** 356, 469, and others
**Current Issue:** Multiple console.error calls for FFmpeg failures
```typescript
// BEFORE (Current code at line 356):
} catch (error) {
  console.error("[FFmpeg] Thumbnail generation failed:", error);
  // Cleanup on error
  try {
    await ffmpeg.deleteFile(inputName);
  } catch (cleanupError) {
    // Ignore cleanup errors
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch (cleanupError) {
    // Ignore cleanup errors
  }
  throw error; // Re-throws error - good!
}

// AFTER (Improved version):
} catch (error) {
  // Import at top: import { handleMediaProcessingError } from '@/lib/error-handler';
  handleMediaProcessingError(error, "Generate thumbnail", {
    videoFile: videoFile.name,
    timeInSeconds
  });
  
  // Cleanup on error - KEEP THIS!
  try {
    await ffmpeg.deleteFile(inputName);
  } catch (cleanupError) {
    // Ignore cleanup errors
  }
  try {
    await ffmpeg.deleteFile(outputName);
  } catch (cleanupError) {
    // Ignore cleanup errors
  }
  
  throw error; // IMPORTANT: Keep re-throwing for caller handling
}
```
**Safety:** ✅ Preserves cleanup logic, maintains error propagation with throw
**Impact:** Clear FFmpeg error messages while maintaining error flow

### Task 1.3: Storage Adapters (9 min)
**Files:** `lib/storage/localstorage-adapter.ts`, `lib/storage/electron-adapter.ts`
**Lines:** LocalStorage: 41-46, 56-61, 77-78 | Similar pattern in electron-adapter
**Current Issue:** Console.error then re-throws - needs user notification
```typescript
// BEFORE (localstorage-adapter.ts line 40-47):
} catch (error) {
  console.error(
    "[DEBUG] LocalStorageAdapter: Error setting key:",
    key,
    error
  );
  throw error; // Re-throws but user doesn't see friendly message
}

// AFTER (Improved version):
} catch (error) {
  // Import at top: import { handleStorageError } from '@/lib/error-handler';
  handleStorageError(error, "Save data to local storage", { 
    key,
    operation: 'set'
  });
  throw error; // IMPORTANT: Keep throw for caller error handling
}

// Similar pattern for remove() and list() methods
```
**Safety:** ✅ Preserves error propagation (throw), adds user notification
**Impact:** Users informed of storage issues while maintaining error flow

### Task 1.4: Export Engine (8 min)
**File:** `lib/export-engine-optimized.ts`
**Current Issue:** Export failures show cryptic messages
```typescript
// Add import:
import { handleExportError } from '@/lib/error-handler';

// Replace console.error in export methods
handleExportError(error, "Video export", { 
  format: exportConfig.format,
  resolution: exportConfig.resolution 
});
```
**Impact:** Clear export failure feedback

### Task 1.5: AI Service Clients (10 min)
**Files:** `lib/ai-video-client.ts`, `lib/fal-ai-client.ts`, `lib/image-edit-client.ts`
**Current Issue:** API failures show technical errors
```typescript
// Add import:
import { handleAIServiceError } from '@/lib/error-handler';

// Replace console.error patterns
handleAIServiceError(error, "Generate AI video", { 
  provider: "fal.ai",
  operation: jobType 
});
```
**Impact:** User-friendly AI service error messages

---

## Phase 2: Store Operations (Day 3-4)
*Fix state management errors*

### Task 2.1: Media Store (6 min)
**File:** `stores/media-store.ts`
**Pattern:** Add error handling to all async operations
```typescript
// Template for each async method:
async addMediaItem(projectId: string, item: MediaItem) {
  try {
    // existing code
  } catch (error) {
    handleError(error, {
      operation: "Add media item",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.HIGH,
      metadata: { projectId, itemType: item.type }
    });
    throw error; // Re-throw for caller handling
  }
}
```

### Task 2.2: Project Store (7 min)
**File:** `stores/project-store.ts`
**Focus:** Save/load operations
```typescript
// Add comprehensive error handling to:
- saveProject()
- loadProject()
- autoSave()
- exportProject()
```

### Task 2.3: Timeline Store (8 min)
**File:** `stores/timeline-store.ts`
**Note:** Already partially migrated, complete the adoption
```typescript
// Find remaining console.error calls
// Replace with appropriate handleError calls
```

---

## Phase 3: Silent Failures (Day 5-6)
*Fix operations that fail without any feedback*

### Task 3.1: Empty Catch Blocks (5 min each)
**Files to check:**
```bash
# Find empty catch blocks:
rg "catch.*\{[\s]*\}" --multiline

# Add minimal error logging:
} catch (error) {
  handleError(error, {
    operation: "Migration",
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.LOW,
    showToast: false // Don't spam users
  });
}
```

### Task 3.2: Keybindings Store (5 min)
**File:** `stores/keybindings-store.ts`
**Lines:** 21-23
**Current Issue:** Empty catch block silently ignores migration errors
```typescript
// BEFORE (Current code at line 21-23):
} catch {
  /* best-effort migration */
}

// AFTER (Improved version):
} catch (error) {
  // Import at top: import { handleError, ErrorCategory, ErrorSeverity } from '@/lib/error-handler';
  // Log migration failure but don't block app startup
  handleError(error, {
    operation: "Migrate keybindings from old storage format",
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.LOW,
    showToast: false // Don't spam users on startup
  });
  // Continue with default keybindings - app still works!
}
```
**Safety:** ✅ Non-blocking error, app continues with defaults
**Impact:** Migration errors tracked without disrupting user experience

### Task 3.3: Component Mount Errors (8 min)
**Pattern:** Add error boundaries to complex components
```typescript
// Wrap risky components:
export default withErrorBoundary(TimelineComponent, {
  isolate: true,
  fallback: TimelineErrorFallback
});
```

---

## Phase 4: Developer Experience (Day 7)
*Improve debugging and monitoring*

### Task 4.1: Add Error Context Helper (10 min)
**Create:** `lib/error-context.ts`
```typescript
// Utility to capture common context
export const getErrorContext = () => ({
  projectId: useProjectStore.getState().activeProject?.id,
  timestamp: Date.now(),
  sessionId: getSessionId(),
  userAgent: navigator.userAgent
});

// Use in error handlers:
handleError(error, {
  ...baseContext,
  metadata: getErrorContext()
});
```

### Task 4.2: Error Reporting Hook (9 min)
**Create:** `hooks/use-error-reporter.ts`
```typescript
export const useErrorReporter = (componentName: string) => {
  return useCallback((error: unknown, operation: string) => {
    handleError(error, {
      operation: `${componentName}: ${operation}`,
      category: ErrorCategory.UI,
      severity: ErrorSeverity.MEDIUM
    });
  }, [componentName]);
};
```

### Task 4.3: Async Operation Wrapper (8 min)
**Add to:** `lib/error-handler.ts`
```typescript
export const safeAsync = async <T>(
  fn: () => Promise<T>,
  errorContext: Partial<ErrorContext>
): Promise<T | null> => {
  try {
    return await fn();
  } catch (error) {
    handleError(error, {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      ...errorContext
    });
    return null;
  }
};
```

---

## Implementation Strategy

### Quick Win Approach
1. **Start with highest impact** (Phase 1) - User-facing operations
2. **Use find-and-replace** for common patterns
3. **Test each change** in isolation
4. **Commit frequently** - One file per commit

### Migration Pattern
```typescript
// Step 1: Add import
import { handleError, ErrorCategory, ErrorSeverity } from '@/lib/error-handler';

// Step 2: Find console.error
// Search: console\.error\((.*)\)

// Step 3: Replace with appropriate handler
handleError(error, {
  operation: "Description",
  category: ErrorCategory.APPROPRIATE,
  severity: ErrorSeverity.LEVEL
});
```

### Testing Checklist
- [ ] Error shows toast notification
- [ ] Error includes helpful message
- [ ] Error has unique ID
- [ ] Original functionality preserved
- [ ] No console.error remains

---

## Success Metrics

### Week 1 Goals
- ✅ 20+ files migrated
- ✅ All critical user operations covered
- ✅ Zero silent failures in export/save
- ✅ 50% reduction in console.error calls

### Week 2 Goals
- ✅ 50+ files migrated
- ✅ All stores using error handler
- ✅ Error boundaries on major components
- ✅ 90% reduction in console.error calls

### Tracking Progress
```bash
# Count remaining console.error
rg "console\.error" --count-matches | wc -l

# Count files using error-handler
rg "from.*error-handler" --files-with-match | wc -l

# Find remaining silent catches
rg "catch.*\{[\s]*\}" --multiline
```

---

## Priority Order (First 10 Tasks)

1. **timeline-element.tsx** - Clip operations (8 min) ⭐⭐⭐⭐⭐
2. **ffmpeg-utils.ts** - Video processing (7 min) ⭐⭐⭐⭐⭐
3. **localstorage-adapter.ts** - Storage (5 min) ⭐⭐⭐⭐⭐
4. **electron-adapter.ts** - Storage (4 min) ⭐⭐⭐⭐⭐
5. **export-engine-optimized.ts** - Export (8 min) ⭐⭐⭐⭐
6. **ai-video-client.ts** - AI services (6 min) ⭐⭐⭐⭐
7. **media-store.ts** - Media operations (6 min) ⭐⭐⭐⭐
8. **project-store.ts** - Project save/load (7 min) ⭐⭐⭐⭐
9. **keybindings-store.ts** - Silent failure (5 min) ⭐⭐⭐
10. **timeline-store.ts** - Complete migration (8 min) ⭐⭐⭐

**Total time for top 10:** ~64 minutes

---

## Long-term Recommendations

1. **Add Sentry Integration** (30 min)
   - Track errors in production
   - Get real user metrics
   - Identify error patterns

2. **Create Error Dashboard** (45 min)
   - Show error frequency
   - Track resolution time
   - Monitor error categories

3. **Implement Error Recovery** (2 hours)
   - Auto-save before risky operations
   - Rollback mechanisms
   - Graceful degradation

4. **Add E2E Error Tests** (1 hour)
   - Test error boundaries
   - Verify toast notifications
   - Ensure no data loss

---

## Verification Checklist

### Before Starting Each Task
- [ ] Read the current code completely
- [ ] Identify all error handling patterns (try/catch/finally)
- [ ] Check if error is re-thrown (`throw error`)
- [ ] Look for cleanup code that must be preserved
- [ ] Check for existing toast notifications to avoid duplicates

### After Each Change
- [ ] Run the app: `bun dev`
- [ ] Test the specific feature that was modified
- [ ] Verify error shows appropriate toast notification
- [ ] Confirm no duplicate error messages appear
- [ ] Check console for any new errors
- [ ] Ensure feature still works as expected

### Common Pitfalls to Avoid
1. **Removing `throw error`** - Breaks error propagation chain
2. **Duplicate toasts** - handleError already shows toast
3. **Removing cleanup code** - Causes memory leaks
4. **Wrong error category** - Use appropriate category for context
5. **Always showing toast** - Some errors should be silent

---

## Appendix: Common Error Categories

| Operation Type | Category | Severity | Show Toast | Re-throw? |
|---------------|----------|----------|------------|-----------|
| File save/load | STORAGE | HIGH | Yes | Yes |
| Video export | EXPORT | CRITICAL | Yes | No* |
| AI generation | AI_SERVICE | MEDIUM | Yes | Sometimes |
| FFmpeg ops | MEDIA_PROCESSING | HIGH | Yes | Yes |
| Network calls | NETWORK | MEDIUM | Yes | Sometimes |
| Validation | VALIDATION | LOW | Sometimes | No |
| System/migration | SYSTEM | LOW | No | No |
| UI interactions | UI | MEDIUM | Yes | No |

*Export errors typically handled at top level, no re-throw needed

---

## Quick Reference: Import Statements

```typescript
// Most common import
import { handleError, ErrorCategory, ErrorSeverity } from '@/lib/error-handler';

// Specific error type handlers
import { 
  handleMediaProcessingError,
  handleStorageError,
  handleAIServiceError,
  handleExportError,
  handleNetworkError,
  handleValidationError 
} from '@/lib/error-handler';
```

---

*Created: 2025-01-29*
*Updated: 2025-01-29 - Added safety rules and verification*
*Target Completion: 2 weeks*
*Estimated Total Time: ~5 hours (in 10-minute increments)*