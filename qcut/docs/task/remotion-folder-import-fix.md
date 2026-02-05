# Fix Remotion Folder Import - Missing Component Loading

**Created**: 2026-02-05
**Status**: TODO
**Priority**: High

---

## Problem Summary

When uploading a Remotion folder to the Remotion panel, components are scanned and registered but the actual bundled code is **never loaded as React components**. The 404 error occurs because:

1. ✅ Folder is scanned - compositions are found
2. ✅ esbuild bundles the code successfully
3. ✅ Components are registered in the store (appear in UI)
4. ❌ **Bundled code is never converted to actual React components**
5. ❌ Each component has `component: () => null` (placeholder never replaced)
6. ❌ When Player tries to render, it gets the placeholder, causing 404s

---

## Root Cause

In `component-loader.ts` (lines ~720-750), components are registered with a placeholder:

```typescript
const componentDef: RemotionComponentDefinition = {
  id: componentId,
  name: composition.name,
  // ... metadata ...
  component: () => null,  // ← PLACEHOLDER - never replaced!
  source: "imported",
  folderPath,
};
```

The `loadBundledComponent()` function in `dynamic-loader.ts` **exists but is never called**.

---

## Files to Modify

| File | Location | Purpose |
|------|----------|---------|
| `component-loader.ts` | `apps/web/src/lib/remotion/` | Integrate dynamic loading |
| `dynamic-loader.ts` | `apps/web/src/lib/remotion/` | Fix dependency injection |
| `remotion-store.ts` | `apps/web/src/stores/` | Update registration flow |

---

## Implementation Steps

### Step 1: Update component-loader.ts

After bundling completes, call `loadBundledComponent()` with the bundled code:

```typescript
// In loadComponentsFromFolder(), after getting bundle results:
import { loadBundledComponent } from "./dynamic-loader";

// For each successful bundle result:
const actualComponent = await loadBundledComponent(bundleResult.bundledCode);

const componentDef: RemotionComponentDefinition = {
  // ... metadata ...
  component: actualComponent,  // Use actual component, not placeholder
};
```

### Step 2: Fix dynamic-loader.ts for dependencies

The bundled code needs React and Remotion available. Recommended approach - inject globals:

```typescript
// Set up globals before loading
window.React = React;
window.Remotion = Remotion;
```

### Step 3: Update remotion-store.ts

Make `importFromFolder` await the component loading:

```typescript
// Ensure components are fully loaded before marking complete
const loadedComponents = await loadComponentsFromFolder(folderPath);
// Only register components that loaded successfully
```

---

## Verification Checklist

- [ ] Run `bun run electron`
- [ ] Go to Remotion panel
- [ ] Drop a valid Remotion project folder (e.g., test fixtures)
- [ ] Console shows: `[RemotionFolder] ✅ Loaded component: HelloWorld`
- [ ] Component appears in list with preview thumbnail
- [ ] Drag component to timeline - should render without 404

---

## Related Files

- `apps/web/src/components/editor/media-panel/views/remotion/folder-import-dialog.tsx`
- `electron/remotion-folder-handler.ts`
- `electron/remotion-bundler.ts`
- `electron/remotion-composition-parser.ts`
- `apps/web/src/test/e2e/remotion-folder-import.e2e.ts`

---

## Notes

The E2E tests for folder import pass because they only test the IPC layer (scan, validate, import API calls). They don't test that the actual React components are loaded and renderable.
