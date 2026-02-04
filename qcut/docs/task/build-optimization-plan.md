# Build Optimization Plan: Code-Splitting & Bundle Size Reduction

**Created**: 2026-02-04
**Status**: Planning
**Priority**: High
**Estimated Total Effort**: 4-6 hours (broken into subtasks)

---

## Problem Statement

The QCut build produces a **3.8MB main bundle** due to:
1. **Dynamic/static import conflicts** - Stores are imported both ways, preventing code-splitting
2. **All stores bundled at initialization** - No lazy loading despite infrastructure existing
3. **Commented-out chunk configuration** - Manual chunks disabled in vite.config.ts

---

## Current State Analysis

### Bundle Composition
| Chunk | Size | Status |
|-------|------|--------|
| index.js (main) | 3,845 KB | Too large |
| vendor-react | 263 KB | OK |
| vendor-ui | 73 KB | OK |
| vendor-forms | 53 KB | OK |

### Root Cause: Circular Dependencies
The stores have circular dependencies handled with mixed import patterns:

```
timeline-store ←→ project-store ←→ media-store
      ↓                ↓               ↓
   scene-store   stickers-store   storage-service
```

**Pattern causing issues:**
- `media-store.ts:4` - Static import of `useTimelineStore`
- `project-store.ts:231` - Dynamic import of `useTimelineStore`
- Routes use static imports of stores that dynamically import each other

---

## Implementation Plan

### Subtask 1: Enable Vendor Chunks in Vite Config
**Time**: 30 minutes
**Risk**: Low

**Files to modify:**
- `apps/web/vite.config.ts` (lines 104-142)

**Changes:**
1. Uncomment the FFmpeg vendor chunk (lines 104-108):
```typescript
'vendor-ffmpeg': [
  '@ffmpeg/ffmpeg',
  '@ffmpeg/util',
],
```

2. Uncomment the AI features chunk (lines 128-132):
```typescript
'vendor-ai': [
  '@fal-ai/client',
],
```

**Expected Result**: ~300KB moved out of main bundle

**Verification:**
```bash
bun run build
# Check dist/assets/ for new vendor-ffmpeg and vendor-ai chunks
```

---

### Subtask 2: Fix Static/Dynamic Import Inconsistency in Stores
**Time**: 1-2 hours
**Risk**: Medium (may affect runtime behavior)

**Files to modify:**
- `apps/web/src/stores/media-store.ts` (line 4)
- `apps/web/src/stores/timeline-store.ts` (lines 24-25)
- `apps/web/src/stores/project-store.ts` (lines 7-10)

**Strategy**: Convert all cross-store imports to use the existing `lazy-stores.ts` utility

**Step 1**: Update `media-store.ts`
```typescript
// Before (line 4):
import { useTimelineStore } from "./timeline-store";

// After:
import { getTimelineStore } from "@/utils/lazy-stores";
// Then use: const timelineStore = await getTimelineStore();
```

**Step 2**: Ensure all store access uses lazy getters consistently

**Verification:**
```bash
bun run build
# Warnings about "dynamically imported by X but also statically imported by Y" should disappear
```

---

### Subtask 3: Convert Route-Level Static Imports to Dynamic
**Time**: 1 hour
**Risk**: Medium

**Files to modify:**
- `apps/web/src/routes/editor.$project_id.lazy.tsx` (line 6)
- `apps/web/src/routes/projects.lazy.tsx` (line 7)
- `apps/web/src/components/storage-provider.tsx` (line 4)

**Current (editor.$project_id.lazy.tsx):**
```typescript
import { useProjectStore } from "@/stores/project-store";
import { usePanelStore } from "@/stores/panel-store";
```

**Target**: Use React.lazy or dynamic imports with Suspense boundaries

**Verification:**
```bash
bun run build
# Main bundle should decrease; new route-specific chunks should appear
```

---

### Subtask 4: Create Feature-Based Manual Chunks
**Time**: 1 hour
**Risk**: Low

**Files to modify:**
- `apps/web/vite.config.ts` (lines 79-189)

**Add new chunks for feature isolation:**
```typescript
manualChunks: {
  // Existing vendor chunks...

  // Feature chunks
  'feature-editor-stores': [
    './src/stores/timeline-store',
    './src/stores/project-store',
    './src/stores/media-store',
    './src/stores/playback-store',
  ],
  'feature-export': [
    './src/lib/export-engine',
    './src/lib/export-engine-cli',
    './src/components/export-dialog',
  ],
  'feature-ai': [
    './src/lib/ai-video',
    './src/stores/text2image-store',
    './src/lib/fal-ai-client',
  ],
  'feature-stickers': [
    './src/stores/stickers-store',
    './src/stores/stickers-overlay-store',
  ],
}
```

**Verification:**
```bash
bun run build
# Check for new feature-* chunks in dist/assets/
```

---

### Subtask 5: Add Build Analysis Tooling
**Time**: 30 minutes
**Risk**: None

**Files to modify:**
- `apps/web/package.json` (add script)
- `apps/web/vite.config.ts` (add plugin)

**Add rollup-plugin-visualizer:**
```bash
bun add -D rollup-plugin-visualizer
```

**Update vite.config.ts:**
```typescript
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  // existing plugins...
  visualizer({
    filename: 'dist/bundle-analysis.html',
    open: false,
    gzipSize: true,
  }),
]
```

**Add npm script:**
```json
"scripts": {
  "build:analyze": "ANALYZE=true bun run build"
}
```

**Verification:**
```bash
bun run build:analyze
# Open dist/bundle-analysis.html in browser
```

---

### Subtask 6: Update Lazy-Stores Utility for Complete Coverage
**Time**: 1 hour
**Risk**: Low

**Files to modify:**
- `apps/web/src/utils/lazy-stores.ts`

**Add missing store getters:**
```typescript
// Add these functions:
export async function getSceneStore() { ... }
export async function getStickersOverlayStore() { ... }
export async function getPlaybackStore() { ... }
export async function getExportStore() { ... }
```

**Update existing stores to use these getters instead of direct dynamic imports**

**Verification:**
```bash
bun run test
bun run build
```

---

## Testing Strategy

### Unit Tests
- No new unit tests required for config changes
- Existing tests should continue to pass

### Integration Tests
```bash
# Run full test suite
bun run test

# Manual verification
bun run electron:dev
# Test: Project creation, timeline operations, export
```

### Build Verification
```bash
# Before optimization - record baseline
bun run build 2>&1 | tee build-before.log

# After each subtask
bun run build 2>&1 | tee build-after.log

# Compare chunk sizes
ls -la apps/web/dist/assets/*.js
```

---

## Expected Outcome

| Metric | Before | Target | Improvement |
|--------|--------|--------|-------------|
| Main bundle | 3,845 KB | < 2,000 KB | ~48% reduction |
| Build warnings | 12 import conflicts | 0 | 100% reduction |
| Initial load | All stores | Core only | Faster startup |

---

## Rollback Plan

If issues arise:
1. Revert vite.config.ts changes
2. Restore static imports in stores
3. Run `bun run build` to verify rollback

All changes are isolated to:
- Configuration files (vite.config.ts)
- Import statements (no logic changes)
- New utility functions (additive only)

---

## Files Reference

### Configuration
- `apps/web/vite.config.ts` - Rollup/chunk configuration
- `apps/web/package.json` - Build scripts

### Stores (circular dependency chain)
- `apps/web/src/stores/timeline-store.ts`
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/stores/media-store.ts`
- `apps/web/src/stores/scene-store.ts`
- `apps/web/src/stores/stickers-overlay-store.ts`

### Routes (static imports to convert)
- `apps/web/src/routes/editor.$project_id.lazy.tsx`
- `apps/web/src/routes/projects.lazy.tsx`
- `apps/web/src/routes/__root.tsx`

### Utilities
- `apps/web/src/utils/lazy-stores.ts` - Lazy loading utilities

### Providers (initialization chain)
- `apps/web/src/components/storage-provider.tsx`
- `apps/web/src/components/providers/editor-provider.tsx`
