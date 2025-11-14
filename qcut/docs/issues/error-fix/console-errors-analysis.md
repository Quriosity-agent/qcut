# Console Errors Analysis and Fix Guide

**Generated**: 2025-11-14
**Status**: Active Issues
**Priority**: Medium

## Table of Contents

1. [Overview](#overview)
2. [Error Categories](#error-categories)
3. [Detailed Error Analysis](#detailed-error-analysis)
4. [How to Fix](#how-to-fix)
5. [Prevention Guidelines](#prevention-guidelines)

---

## Overview

This document analyzes console errors found during QCut video editor runtime. The errors are primarily **developer debugging artifacts** and **configuration issues** rather than critical runtime failures. However, they create noise in production logs and indicate areas for code cleanup.

**Impact Level**: Medium (functionality works, but logs are polluted)
**User Impact**: Minimal (no visible UI issues)
**Developer Impact**: High (debugging difficulty, unprofessional logging)

---

## Error Categories

| Category | Count | Severity | Files Affected |
|----------|-------|----------|----------------|
| **Misuse of console.error** | ~17 | Low | `storage-service.ts`, `index.html` |
| **Debug logging not removed** | ~12 | Low | `indexeddb-adapter.ts`, `storage-service.ts` |
| **React panel configuration** | 1 | Medium | `panel-layouts.tsx` |
| **React ref warnings** | 1 | Low | Radix UI components |
| **FAL AI API errors** | 2 | High | `fal-ai-client.ts` |

---

## Detailed Error Analysis

### 1. Console.error Misuse - StorageService.loadAllProjects

**Location**: `qcut/apps/web/src/lib/storage/storage-service.ts:86-89`

#### What is the Error?

```typescript
// Lines 86-89
console.log(
  `[StorageService] getProjectMediaAdapters called with projectId: ${projectId}`
);
console.trace("[StorageService] Call stack");
```

The browser displays these as `console.error` calls at `index.html:61`, but the source code uses `console.log` and `console.trace`. This appears to be a **webpack/vite bundler transformation** or **console interception** issue.

#### Why is it a Problem?

1. **Log Level Confusion**: Information messages appear as errors in DevTools
2. **Excessive Logging**: Prints every time project media adapters are accessed (4-6 times per project load)
3. **Stack Trace Pollution**: `console.trace` creates large stack dumps for routine operations
4. **Production Noise**: Debug code should not exist in production builds

#### Root Cause

Debug code added to track project ID usage patterns but never removed. The comment `// DEBUG: Track project IDs being used` confirms this was temporary debugging code.

---

### 2. IndexedDB Debug Logging

**Location**: `qcut/apps/web/src/lib/storage/indexeddb-adapter.ts:24-32`

#### What is the Error?

```typescript
// Lines 24-32
// DEBUG: Track database creation with stack trace
if (
  dbName.startsWith("video-editor-media-") ||
  dbName.startsWith("video-editor-timelines-")
) {
  const debugError = new Error("Stack trace for database creation");
  console.log(`[IndexedDBAdapter] Creating database: ${dbName}`);
  console.log("[IndexedDBAdapter] Call stack:", debugError.stack);
}
```

#### Why is it a Problem?

1. **Constructor Side Effects**: Logging in constructor creates noise on every instantiation
2. **Repeated Database Creation**: Same database is created multiple times for single project:
   - `video-editor-media-91792c80-b639-4b2a-bf54-6b7da08e2ff1` (appears 6+ times)
   - `video-editor-timelines-91792c80-b639-4b2a-bf54-6b7da08e2ff1` (appears 4+ times)
3. **Performance Impact**: Creating Error objects for stack traces is expensive
4. **Indicates Caching Issue**: Multiple instantiations suggest adapters aren't being reused

#### Secondary Issue

The repeated database creation suggests **missing singleton pattern** or **adapter caching** in StorageService. Each call to `getProjectMediaAdapters()` creates new adapter instances.

---

### 3. React Resizable Panel Configuration Error

**Location**: `qcut/apps/web/src/components/editor/panel-layouts.tsx:73-75`

#### What is the Error?

```
react-resizable-panels.browser.development.esm.js:1576 Panel ":r29:" has an invalid configuration:

default size should not be greater than max size
```

#### Why is it a Problem?

```typescript
// Lines 38-44: Normalization can exceed constraints
const total = toolsPanel + previewPanel + propertiesPanel;
const normalizationFactor = total !== 0 ? 100 / total : 1;

const normalizedTools =
  Math.round(toolsPanel * normalizationFactor * 100) / 100;

// Lines 72-75: Panel with maxSize constraint
<ResizablePanel
  defaultSize={normalizedTools}  // Can be > 40 after normalization
  minSize={15}
  maxSize={40}                   // Violated when normalizedTools > 40
  onResize={setToolsPanel}
  className="min-w-0"
>
```

**Scenario Example**:
- Initial state: `toolsPanel = 45`, `previewPanel = 30`, `propertiesPanel = 25`
- Total = 100, normalizationFactor = 1
- `normalizedTools = 45` → **Violates maxSize={40}**

#### Root Cause

The normalization logic doesn't respect individual panel constraints. It ensures the **total is 100%** but doesn't clamp values to their **min/max boundaries**.

---

### 4. React Ref Warning - Radix UI Components

**Location**: Various Radix UI primitives in `vendor-react-waUpj2M3.js`

#### What is the Error?

```
Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?

Check the render method of `Primitive.button.SlotClone`.
```

#### Why is it a Problem?

This is a **library incompatibility** between:
- Radix UI primitives (expecting ref forwarding)
- Custom button components not using `React.forwardRef()`

The component tree shows the issue originates from Radix's `Primitive.button.SlotClone` trying to pass a ref to a function component that doesn't accept it.

#### Impact

Minimal - Radix UI components work correctly despite the warning. The refs aren't critical for functionality, but the warning indicates non-idiomatic React patterns.

---

### 5. FAL AI API Errors

**Location**: `qcut/apps/web/src/lib/fal-ai-client.ts:214` and `:248`

#### What are the Errors?

**Error 1: HTTP 422 - Unprocessable Entity**
```
error-handler.ts:145 🚨 Error ERR-1763093918576-ZCBLZT [MEDIUM]
Operation: FAL AI API request
Category: ai_service
Original Error: Error: FAL AI API request failed: 422
```

**Error 2: Validation Error**
```
error-handler.ts:223 🚨 Error ERR-1763093918577-GUHOHF [MEDIUM]
Operation: Generate image with FAL AI model
Original Error: Error: Input should be 'jpeg', 'png' or 'webp', Field required
```

#### Why are they Problems?

**Error 1 Analysis** (lines 211-223 in fal-ai-client.ts):
```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  handleAIServiceError(
    new Error(`FAL AI API request failed: ${response.status}`),
    "FAL AI API request",
    { status: response.status, statusText: response.statusText, errorData }
  );
```

A 422 status indicates the API received the request but **validation failed**. Common causes:
- Missing required parameters
- Invalid parameter format
- Incorrect model configuration

**Error 2 Analysis** (lines 228-248):
```
Error: Input should be 'jpeg', 'png' or 'webp', Field required
```

The FAL AI model expects:
1. An `output_format` parameter with values: `'jpeg' | 'png' | 'webp'`
2. This parameter is **required** but not being provided

#### Root Cause

The `generateWithModel()` function (around line 510) likely has incomplete parameter handling:
- Missing `output_format` in request payload
- No validation before API call
- No default value fallback

---

## How to Fix

### Fix 1: Remove Debug Logging from storage-service.ts

**File**: `qcut/apps/web/src/lib/storage/storage-service.ts`

**Change** (lines 84-89):
```typescript
// BEFORE
private getProjectMediaAdapters(projectId: string) {
  // DEBUG: Track project IDs being used
  console.log(
    `[StorageService] getProjectMediaAdapters called with projectId: ${projectId}`
  );
  console.trace("[StorageService] Call stack");

  const mediaMetadataAdapter = new IndexedDBAdapter<MediaFileData>(
    `${this.config.mediaDb}-${projectId}`,
    "media-metadata",
    this.config.version
  );
  // ... rest of code
}

// AFTER
private getProjectMediaAdapters(projectId: string) {
  const mediaMetadataAdapter = new IndexedDBAdapter<MediaFileData>(
    `${this.config.mediaDb}-${projectId}`,
    "media-metadata",
    this.config.version
  );
  // ... rest of code
}
```

**Optional Enhancement**: Use the existing debug infrastructure:
```typescript
import { debugLog } from "@/lib/debug-config";

private getProjectMediaAdapters(projectId: string) {
  debugLog("storage", `Creating adapters for project: ${projectId}`);
  // ... rest of code
}
```

---

### Fix 2: Remove Debug Logging from indexeddb-adapter.ts

**File**: `qcut/apps/web/src/lib/storage/indexeddb-adapter.ts`

**Change** (lines 19-33):
```typescript
// BEFORE
constructor(dbName: string, storeName: string, version = 1) {
  this.dbName = dbName;
  this.storeName = storeName;
  this.version = version;

  // DEBUG: Track database creation with stack trace
  if (
    dbName.startsWith("video-editor-media-") ||
    dbName.startsWith("video-editor-timelines-")
  ) {
    const debugError = new Error("Stack trace for database creation");
    console.log(`[IndexedDBAdapter] Creating database: ${dbName}`);
    console.log("[IndexedDBAdapter] Call stack:", debugError.stack);
  }
}

// AFTER
constructor(dbName: string, storeName: string, version = 1) {
  this.dbName = dbName;
  this.storeName = storeName;
  this.version = version;
}
```

---

### Fix 3: Implement Adapter Caching (Recommended)

**File**: `qcut/apps/web/src/lib/storage/storage-service.ts`

Add caching to prevent repeated adapter instantiation:

```typescript
class StorageService {
  private projectsAdapter!: StorageAdapter<SerializedProject>;
  private config: StorageConfig;
  private isInitialized = false;

  // ADD: Adapter cache
  private adapterCache = new Map<string, {
    mediaMetadataAdapter: IndexedDBAdapter<MediaFileData>;
    mediaFilesAdapter: OPFSAdapter;
  }>();

  // MODIFY: Add caching logic
  private getProjectMediaAdapters(projectId: string) {
    // Return cached adapters if available
    if (this.adapterCache.has(projectId)) {
      return this.adapterCache.get(projectId)!;
    }

    // Create new adapters
    const mediaMetadataAdapter = new IndexedDBAdapter<MediaFileData>(
      `${this.config.mediaDb}-${projectId}`,
      "media-metadata",
      this.config.version
    );

    const mediaFilesAdapter = new OPFSAdapter(`media-files-${projectId}`);

    const adapters = { mediaMetadataAdapter, mediaFilesAdapter };

    // Cache for future use
    this.adapterCache.set(projectId, adapters);

    return adapters;
  }

  // ADD: Clear cache when project is deleted
  public clearProjectCache(projectId: string) {
    this.adapterCache.delete(projectId);
  }
}
```

**Benefits**:
- Reduces adapter instantiation from 6+ to 1 per project
- Eliminates redundant IndexedDB database opens
- Improves performance and reduces console noise

---

### Fix 4: Clamp Panel Sizes to Constraints

**File**: `qcut/apps/web/src/components/editor/panel-layouts.tsx`

**Change** (lines 34-44):
```typescript
// BEFORE
const total = toolsPanel + previewPanel + propertiesPanel;
const normalizationFactor = total !== 0 ? 100 / total : 1;

const normalizedTools =
  Math.round(toolsPanel * normalizationFactor * 100) / 100;
const normalizedPreview =
  Math.round(previewPanel * normalizationFactor * 100) / 100;
const normalizedProperties =
  Math.round((100 - normalizedTools - normalizedPreview) * 100) / 100;

// AFTER
const total = toolsPanel + previewPanel + propertiesPanel;
const normalizationFactor = total !== 0 ? 100 / total : 1;

// Helper to clamp value between min and max
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizedTools = clamp(
  Math.round(toolsPanel * normalizationFactor * 100) / 100,
  15,  // minSize
  40   // maxSize
);
const normalizedPreview = clamp(
  Math.round(previewPanel * normalizationFactor * 100) / 100,
  30,  // minSize
  100  // No explicit maxSize
);
const normalizedProperties = clamp(
  Math.round((100 - normalizedTools - normalizedPreview) * 100) / 100,
  15,  // minSize
  40   // maxSize
);
```

**Alternative Approach**: Use the panel store to enforce constraints:

```typescript
// In panel-store.ts
const clampPanelSize = (size: number, min: number, max: number) =>
  Math.max(min, Math.min(max, size));

export const usePanelStore = create<PanelStore>((set, get) => ({
  toolsPanel: 25,
  previewPanel: 50,
  propertiesPanel: 25,

  setToolsPanel: (size: number) =>
    set({ toolsPanel: clampPanelSize(size, 15, 40) }),

  setPreviewPanel: (size: number) =>
    set({ previewPanel: clampPanelSize(size, 30, 100) }),

  setPropertiesPanel: (size: number) =>
    set({ propertiesPanel: clampPanelSize(size, 15, 40) }),
}));
```

---

### Fix 5: Fix FAL AI Missing Parameters

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

**Locate** the `generateWithModel()` function (around line 510):

```typescript
// ADD default output_format parameter
async generateWithModel(params: {
  prompt: string;
  model: string;
  // ... other params
  output_format?: 'jpeg' | 'png' | 'webp';  // ADD THIS
}) {
  // ADD default value
  const requestParams = {
    ...params,
    output_format: params.output_format || 'jpeg',  // Default to jpeg
  };

  const result = await this.makeRequest<ImageGenerationResult>(
    endpoint,
    requestParams  // Use requestParams instead of params
  );

  return result;
}
```

**Validation Approach** (recommended):
```typescript
async generateWithModel(params: ImageGenParams) {
  // Validate required fields
  if (!params.output_format) {
    throw new Error('output_format is required: must be "jpeg", "png", or "webp"');
  }

  if (!['jpeg', 'png', 'webp'].includes(params.output_format)) {
    throw new Error(`Invalid output_format: ${params.output_format}`);
  }

  const result = await this.makeRequest<ImageGenerationResult>(
    endpoint,
    params
  );

  return result;
}
```

---

### Fix 6: Fix React Ref Warning (Optional)

**File**: Components that render Radix UI buttons with custom children

Ensure all custom button components use `React.forwardRef()`:

```typescript
// BEFORE
const CustomButton = ({ children, onClick }: ButtonProps) => (
  <button onClick={onClick}>{children}</button>
);

// AFTER
const CustomButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, onClick }, ref) => (
    <button ref={ref} onClick={onClick}>{children}</button>
  )
);
CustomButton.displayName = "CustomButton";
```

---

## Prevention Guidelines

### 1. Debug Logging Best Practices

**✅ DO:**
```typescript
import { debugLog, debugError } from "@/lib/debug-config";

// Centralized, controllable logging
debugLog("storage", "Creating adapters", { projectId });

// Production-safe conditional logging
if (import.meta.env.DEV) {
  console.log("Development-only debug info");
}
```

**❌ DON'T:**
```typescript
// Permanent debug logs in source
console.log("[DEBUG] Some value:", value);
console.trace("Tracking call stack");

// Production-visible debug code
// TODO: Remove this debug code
console.log("Debug info");
```

---

### 2. Code Review Checklist

Before merging, verify:
- [ ] No `console.log/trace/debug` statements (use debug infrastructure)
- [ ] No commented `// DEBUG:` or `// TODO: remove` code
- [ ] Panel constraints validated (min ≤ default ≤ max)
- [ ] API parameters validated before requests
- [ ] React components use `forwardRef` when needed
- [ ] No excessive adapter/service instantiation

---

### 3. Linting Rules to Add

Add to `.biome.json` or ESLint config:

```json
{
  "rules": {
    "no-console": ["warn", { "allow": ["error", "warn"] }],
    "no-debugger": "error",
    "react/display-name": "error",
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }]
  }
}
```

---

### 4. Development vs Production Builds

Ensure debug code is stripped in production:

**vite.config.ts**:
```typescript
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: ['log', 'debug', 'trace'],  // Keep error/warn
        drop_debugger: true,
      },
    },
  },
});
```

---

## Testing Verification

After applying fixes, verify:

1. **Console Output**: No error/warning messages during normal operation
2. **Panel Resizing**: All panels respect min/max constraints
3. **FAL AI Generation**: Image generation completes without 422 errors
4. **Performance**: Reduced IndexedDB operations (check DevTools → Application → Storage)
5. **Build Size**: Production build doesn't include debug code

**Test Commands**:
```bash
# Development mode
bun run electron:dev

# Production build
bun run build && bun run electron

# Check for debug artifacts in build
grep -r "console.log\|console.trace" dist/
```

---

## Related Files

- `qcut/apps/web/src/lib/storage/storage-service.ts` - Lines 86-89
- `qcut/apps/web/src/lib/storage/indexeddb-adapter.ts` - Lines 24-32
- `qcut/apps/web/src/components/editor/panel-layouts.tsx` - Lines 34-44, 72-75
- `qcut/apps/web/src/lib/fal-ai-client.ts` - Lines 214, 248, ~510
- `qcut/apps/web/src/lib/debug-config.ts` - Debug infrastructure
- `qcut/apps/web/src/stores/panel-store.ts` - Panel state management

---

## Summary

| Issue | Priority | Effort | Impact |
|-------|----------|--------|--------|
| Remove debug logging | High | 5 min | Clean console logs |
| Add adapter caching | Medium | 30 min | Performance improvement |
| Fix panel constraints | Medium | 15 min | Eliminate warning |
| Fix FAL AI parameters | High | 20 min | Fix image generation |
| Fix React refs | Low | 10 min | Eliminate warning |

**Total Estimated Time**: ~1.5 hours for all fixes

**Recommended Order**:
1. Fix FAL AI parameters (fixes user-facing feature)
2. Remove debug logging (improves developer experience)
3. Add adapter caching (performance)
4. Fix panel constraints (UX polish)
5. Fix React refs (code quality)
