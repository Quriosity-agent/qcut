# React Error #185 Fix - Infinite Render Loop

## Bug Summary

**Error:** `Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.`

**Affected Components:**
- `RemotionView` (`apps/web/src/components/editor/media-panel/views/remotion/index.tsx`)
- `FolderImportDialog` (`apps/web/src/components/editor/media-panel/views/remotion/folder-import-dialog.tsx`)

**Symptom:** Clicking on the Remotion panel tab caused the app to crash with React Error #185.

## Root Cause

Three issues caused infinite re-renders when using Zustand stores:

### 1. Destructuring Entire Store
```typescript
// BAD - Returns new object reference on every store update
const { importFromFolder, refreshFolder } = useRemotionStore();
```

### 2. Array Selectors Creating New References
```typescript
// BAD - Array.from() creates new array on every call
const components = useRemotionStore((state) =>
  Array.from(state.registeredComponents.values())
);
```

### 3. Function References in useEffect Dependencies
```typescript
// BAD - initialize changes reference on every render
const initialize = useRemotionStore((state) => state.initialize);

useEffect(() => {
  initialize(); // Triggers re-render, new initialize ref, triggers effect again...
}, [initialize]); // Infinite loop!
```

## Solution

### Fix 1: Use `getState()` for Action Functions
```typescript
// GOOD - Stable reference, doesn't trigger re-renders
const importFromFolder = useRemotionStore.getState().importFromFolder;
const refreshFolder = useRemotionStore.getState().refreshFolder;
const removeFolder = useRemotionStore.getState().removeFolder;
```

### Fix 2: Use `useShallow` for Array Selectors
```typescript
import { useShallow } from "zustand/react/shallow";

// GOOD - Shallow comparison prevents re-renders when array contents unchanged
const importedFolders = useRemotionStore(
  useShallow((state) => Array.from(state.importedFolders.values()))
);

const allComponents = useRemotionStore(useShallow(selectAllComponents));
```

### Fix 3: Use Individual Selectors for Primitives
```typescript
// GOOD - Primitives have stable references
const isLoading = useRemotionStore((state) => state.isLoading);
const isInitialized = useRemotionStore((state) => state.isInitialized);
const isFolderImporting = useRemotionStore((state) => state.isFolderImporting);
```

### Fix 4: Remove Functions from useEffect Dependencies
```typescript
// Get function via getState() outside the effect
const initialize = useRemotionStore.getState().initialize;

useEffect(() => {
  if (!isInitialized && !isLoading) {
    initialize();
  }
}, [isInitialized, isLoading]); // No function in deps!
```

## Additional Fix: Vite Config

Added `process.env.NODE_ENV` polyfill for `@babel/types` compatibility:

```typescript
// apps/web/vite.config.ts
define: {
  global: "globalThis",
  "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
},
```

## Testing

### Manual Testing

1. Start the dev server:
   ```bash
   bun run dev
   ```

2. Navigate to `http://localhost:5173`

3. Create a new project

4. Click on the **Remotion** tab in the sidebar

5. **Expected:** Panel loads with components, no errors
   **Before fix:** React Error #185, app crashes

### Debug Logging

The RemotionView component includes debug logging:

```typescript
const renderCountRef = useRef(0);
renderCountRef.current++;
console.log(
  `[RemotionView] Render #${renderCountRef.current} - components: ${allComponents.length}`
);

if (renderCountRef.current > 10) {
  console.warn("[RemotionView] WARNING: High render count detected!");
}
```

**Expected console output:**
```
[RemotionView] Render #1 - components: 14, isInitialized: true, isLoading: false
[RemotionView] Render #2 - components: 14, isInitialized: true, isLoading: false
[RemotionView] Render #3 - components: 14, isInitialized: true, isLoading: false
```

**Before fix (infinite loop):**
```
[RemotionView] Render #1 ...
[RemotionView] Render #2 ...
...
[RemotionView] Render #50 ...
[RemotionView] WARNING: High render count detected!
Error: Maximum update depth exceeded
```

### E2E Test

Location: `apps/web/src/test/e2e/remotion-panel-stability.e2e.ts`

```bash
bun run test -- remotion-panel-stability
```

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/src/components/editor/media-panel/views/remotion/index.tsx` | Use `useShallow`, `getState()`, individual selectors |
| `apps/web/src/components/editor/media-panel/views/remotion/folder-import-dialog.tsx` | Use `useShallow`, `getState()` for actions |
| `apps/web/vite.config.ts` | Add `process.env.NODE_ENV` polyfill |

## Commits

- `01364a70` - fix: resolve React Error #185 infinite loop in Remotion panel
- `58dc1c64` - docs: update README with current project status

## Prevention

When using Zustand stores:

1. **Never destructure** the entire store without a selector
2. **Use `useShallow`** for selectors that return arrays or objects
3. **Use `getState()`** for action functions used in useEffect
4. **Use individual selectors** for primitive values
5. **Avoid functions in useEffect deps** - get them via `getState()` instead
