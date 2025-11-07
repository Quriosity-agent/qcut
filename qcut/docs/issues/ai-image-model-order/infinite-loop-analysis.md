# Infinite Loop Error Analysis - Maximum Update Depth Exceeded

**Error Code**: ERR-1762493000061-ZDYTPZ
**Severity**: HIGH
**Category**: UI / React State Management
**Timestamp**: 2025-11-07T05:23:20.061Z
**Branch**: upscale

---

## Executive Summary

The application experiences a **critical infinite loop** caused by improper Zustand store selector usage in the `UpscaleSettings` component. The selector returns a new object reference on every render, triggering React's change detection infinitely until React's maximum update depth limit (50 nested updates) is exceeded.

---

## Error Message

```
Uncaught Error: Maximum update depth exceeded. This can happen when a component
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
React limits the number of nested updates to prevent infinite loops.
```

**React Warning:**
```
Warning: Maximum update depth exceeded. This can happen when a component calls
setState inside useEffect, but useEffect either doesn't have a dependency array,
or one of the dependencies changes on every render.
```

**Zustand Warning:**
```
Warning: The result of getSnapshot should be cached to avoid an infinite loop
    at Sw (upscale-settings component)
```

---

## Root Cause Analysis

### The Problem

In `upscale-settings.tsx` lines 21-26, the component uses a Zustand selector that creates a **new object on every render**:

```typescript
const { upscaleSettings, setUpscaleSettings } = useText2ImageStore(
  (state) => ({
    upscaleSettings: state.upscaleSettings,      // ❌ New object created
    setUpscaleSettings: state.setUpscaleSettings, // ❌ every single render
  })
);
```

### Why This Causes an Infinite Loop

1. **First Render**: Component mounts, selector runs and returns `{ upscaleSettings, setUpscaleSettings }`
2. **React Comparison**: React compares the new object with the previous one using `Object.is()`
3. **Reference Inequality**: Even though the values inside are the same, the object reference is different: `{} !== {}`
4. **Re-render Triggered**: React detects a "change" and schedules a re-render
5. **Selector Runs Again**: On re-render, selector creates another new object
6. **Loop Continues**: Steps 2-5 repeat infinitely until React hits its limit (50 nested updates)
7. **React Crashes**: "Maximum update depth exceeded" error thrown

### Visual Representation

```
┌─────────────────────────────────────────────────────────────┐
│  Render Cycle #1                                            │
│  ┌────────────────────────────────────────────────┐         │
│  │ Selector returns: { upscaleSettings, setter }  │         │
│  │ Object reference: 0x1234                       │         │
│  └────────────────────────────────────────────────┘         │
│                        │                                     │
│                        ▼                                     │
│  ┌────────────────────────────────────────────────┐         │
│  │ React compares: 0x1234 !== 0x5678 (previous)  │         │
│  │ Result: DIFFERENT → Schedule Re-render         │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Render Cycle #2                                            │
│  ┌────────────────────────────────────────────────┐         │
│  │ Selector returns: { upscaleSettings, setter }  │         │
│  │ Object reference: 0x5678 (NEW!)                │         │
│  └────────────────────────────────────────────────┘         │
│                        │                                     │
│                        ▼                                     │
│  ┌────────────────────────────────────────────────┐         │
│  │ React compares: 0x5678 !== 0x1234 (previous)  │         │
│  │ Result: DIFFERENT → Schedule Re-render         │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
                    ... repeats ...
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Render Cycle #50                                           │
│  ┌────────────────────────────────────────────────┐         │
│  │ React: "Maximum update depth exceeded!"        │         │
│  │ 🚨 CRASH                                        │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## Function Call Chain Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    Application Startup                           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Route: /editor/:project_id                                      │
│  File: editor._project_id.lazy.tsx                               │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Component: <Text2ImageView />                                   │
│  File: text2image.tsx:53                                         │
│                                                                   │
│  Responsibilities:                                               │
│  • Manages model type selection (generation/edit/upscale)       │
│  • Renders conditional UI based on modelType state              │
│  • Subscribes to text2image-store (line 76)                     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Conditional Render: {modelType === "upscale" && ...}           │
│  File: text2image.tsx:549                                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Component: <UpscaleSettings />                                  │
│  File: upscale-settings.tsx:20                                   │
│                                                                   │
│  ⚠️  PROBLEMATIC SELECTOR (lines 21-26):                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ useText2ImageStore(                                        │ │
│  │   (state) => ({                     ← Creates new object!  │ │
│  │     upscaleSettings: state.upscaleSettings,                │ │
│  │     setUpscaleSettings: state.setUpscaleSettings,          │ │
│  │   })                                                       │ │
│  │ )                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  On Every Render:                                                │
│  1. Selector function executes                                   │
│  2. Returns NEW object { ... }                                   │
│  3. React detects reference change                               │
│  4. Triggers re-render                                           │
│  5. GOTO step 1 → INFINITE LOOP                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Zustand Store: text2image-store.ts                              │
│                                                                   │
│  Store State Structure:                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ interface Text2ImageStore {                                │ │
│  │   modelType: "generation" | "edit" | "upscale"             │ │
│  │   upscaleSettings: UpscaleSettings                         │ │
│  │   setUpscaleSettings: (settings) => void                   │ │
│  │   ...                                                      │ │
│  │ }                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Issue: setUpscaleSettings uses computeUpscaleSettings()         │
│  which may trigger state updates during render                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Render Loop Propagation                                         │
│                                                                   │
│  <UpscaleSettings /> re-renders →                                │
│  <Text2ImageView /> re-renders →                                 │
│  Entire editor panel re-renders →                                │
│  Performance degradation & crash                                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  🚨 React Error Boundary Triggered                               │
│                                                                   │
│  Error: Maximum update depth exceeded                            │
│  Location: index.mjs:390:66                                      │
│  Category: ui                                                    │
│  Severity: HIGH                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Relevant File Paths

### 🔴 Critical Files (Direct Cause)

1. **`qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx`**
   - **Lines 21-26**: Problematic selector that creates new objects
   - **Issue**: Returns `{ upscaleSettings, setUpscaleSettings }` on every render
   - **Impact**: Direct cause of infinite loop

2. **`qcut/apps/web/src/stores/text2image-store.ts`**
   - **Lines 26-60**: `computeUpscaleSettings()` function
   - **Lines 200-250**: Store definition with `upscaleSettings` state
   - **Lines 536-538**: Recently fixed const assertion (from previous build errors)
   - **Issue**: Store updates may trigger component re-renders

### 🟡 Contributing Files (Indirect)

3. **`qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx`**
   - **Line 29**: Imports `useText2ImageStore`
   - **Line 76**: Subscribes to store (multiple state slices)
   - **Line 549**: Conditional render of `<UpscaleSettings />`
   - **Issue**: Parent component that renders the problematic child

4. **`qcut/apps/web/src/components/editor/media-panel/views/use-upscale-generation.ts`**
   - **Line 9**: Uses selector `(state) => state.upscaleImage` (correct usage)
   - **Issue**: None - this file demonstrates correct selector usage

5. **`qcut/apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`**
   - **Lines 1-71**: Model type selector component
   - **Line 52**: Recently fixed variant prop (from previous build errors)
   - **Issue**: None - but part of the same feature area

### 🟢 Reference Files (Correct Patterns)

6. **`qcut/apps/web/src/lib/upscale-models.ts`**
   - Upscale model definitions and types
   - **No issues** - pure data/types

7. **`qcut/apps/web/src/lib/image-edit-client.ts`**
   - FAL.ai upscale API client
   - **No issues** - API integration layer

---

## Stack Trace Analysis

### Minified Component Mapping

The error occurs in production builds with minified code. Here's the mapping:

| Minified Name | Source Component | Location |
|--------------|------------------|----------|
| `Sw` | `UpscaleSettings` | `upscale-settings.tsx:20` |
| `lt` | Error boundary wrapper | `index.tsx` |
| `oo` | Router component | TanStack Router |
| `eo` | Layout component | Editor layout |

### Key Stack Trace Points

```typescript
// Production error stack (minified):
at Sw (editor._project_id.lazy-DoafIkzB.js:101:177897)  // ← UpscaleSettings
at lt (index-DFSoXJ08.js:7:5410)                        // ← Error boundary
at oo (index-DFSoXJ08.js:7:6789)                        // ← Router
at eo (index-DFSoXJ08.js:5:18501)                       // ← Editor layout

// React's render loop detection:
at UF (react-dom.development.js:27331:11)               // ← Update depth check
at wn (react-dom.development.js:25514:3)                // ← Render scheduler
at L3 (react-dom.development.js:16708:7)                // ← State update queue
```

---

## Solution: Split into Separate Subscriptions

Subscribe to each piece of state independently:

```typescript
export function UpscaleSettings({ className }: UpscaleSettingsProps) {
  // Each subscription returns a primitive/stable reference
  const upscaleSettings = useText2ImageStore((state) => state.upscaleSettings);
  const setUpscaleSettings = useText2ImageStore((state) => state.setUpscaleSettings);

  // Rest of component...
}
```

**How it works**: Each subscription returns a single value. Function references are stable in Zustand stores, so `setUpscaleSettings` won't change between renders.

---

## Why This Solution is Best

1. ✅ **Simple**: No additional dependencies (no need to import `shallow`)
2. ✅ **Performant**: Only re-renders when `upscaleSettings` changes
3. ✅ **Type-safe**: TypeScript infers types correctly
4. ✅ **Consistent**: Matches pattern used in `use-upscale-generation.ts:9`
5. ✅ **Readable**: Clear and explicit about what state is being used

---

## Implementation Subtasks

### 📋 Task Breakdown

#### 1. **Locate the File**
   - **Path**: `qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx`
   - **Lines**: 21-26
   - **Component**: `UpscaleSettings`

#### 2. **Identify the Problematic Code**
   ```typescript
   // Current problematic code (lines 21-26)
   const { upscaleSettings, setUpscaleSettings } = useText2ImageStore(
     (state) => ({
       upscaleSettings: state.upscaleSettings,
       setUpscaleSettings: state.setUpscaleSettings,
     })
   );
   ```

#### 3. **Apply the Fix**
   Replace the above code with:
   ```typescript
   // Fixed code - split subscriptions
   const upscaleSettings = useText2ImageStore((state) => state.upscaleSettings);
   const setUpscaleSettings = useText2ImageStore((state) => state.setUpscaleSettings);
   ```

#### 4. **Verify Type Imports**
   - Ensure `useText2ImageStore` is imported correctly
   - No additional imports needed (no `shallow` required)

#### 5. **Test in Development Mode**
   - [ ] Run `bun dev`
   - [ ] Navigate to editor view
   - [ ] Switch to "Upscale" model type
   - [ ] Verify no console errors
   - [ ] Check React DevTools for re-render loops

#### 6. **Test Functionality**
   - [ ] Adjust scale factor buttons
   - [ ] Move denoise slider
   - [ ] Move creativity slider (if available)
   - [ ] Toggle overlapping tiles switch (if available)
   - [ ] Verify all settings update correctly

#### 7. **Build Verification**
   - [ ] Run `bun run build`
   - [ ] Ensure TypeScript compilation succeeds
   - [ ] Check for any new type errors

#### 8. **Production Testing**
   - [ ] Run `bun run electron`
   - [ ] Test in production build
   - [ ] Verify no performance issues
   - [ ] Check console for runtime errors

#### 9. **Cross-Component Verification**
   - [ ] Verify `text2image.tsx` still works
   - [ ] Check model type switching works
   - [ ] Ensure upscale functionality integrates properly

#### 10. **Git Commit**
   - [ ] Stage the changes: `git add upscale-settings.tsx`
   - [ ] Commit with clear message: `fix: resolve infinite loop in UpscaleSettings component`
   - [ ] Include reference to error: `Fixes maximum update depth exceeded error`

---

## Code Diff

**File**: `qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx`

```diff
  export function UpscaleSettings({ className }: UpscaleSettingsProps) {
-   const { upscaleSettings, setUpscaleSettings } = useText2ImageStore(
-     (state) => ({
-       upscaleSettings: state.upscaleSettings,
-       setUpscaleSettings: state.setUpscaleSettings,
-     })
-   );
+   const upscaleSettings = useText2ImageStore((state) => state.upscaleSettings);
+   const setUpscaleSettings = useText2ImageStore((state) => state.setUpscaleSettings);
```

---

## Testing Checklist

After applying the fix, verify:

- [ ] Application loads without crashing
- [ ] No "Maximum update depth exceeded" errors in console
- [ ] No "getSnapshot should be cached" warnings
- [ ] Can switch to "Upscale" model type without errors
- [ ] Upscale settings UI renders correctly
- [ ] Can adjust scale factor, denoise, creativity sliders
- [ ] Settings persist when switching between model types
- [ ] No performance degradation (smooth UI interactions)
- [ ] Run: `bun run build` - build succeeds
- [ ] Run: `bun run test` - all tests pass
- [ ] Test in both dev mode (`bun dev`) and production build (`bun run electron`)

---

## Related Issues

### Previous Build Errors (Resolved)

This infinite loop error surfaced **after** fixing the following TypeScript build errors:

1. **`text2image.tsx:549`** - JSX syntax error (missing `}`)
2. **`model-type-selector.tsx:52`** - Invalid button variant `"ghost"`
3. **`text2image-store.ts:536-538`** - Incorrect `as const` placement

These were resolved in the previous session, but the infinite loop error was a **runtime** issue that only appeared when the app loaded and the `UpscaleSettings` component mounted.

### Git Branch Context

- **Current branch**: `upscale`
- **Recent commits**: Phases 5-7 of upscale feature implementation
- The infinite loop was introduced when the `UpscaleSettings` component was created

---

## Prevention Guidelines

### For Future Zustand Selectors

**❌ DON'T**: Create objects/arrays in selectors without equality checks

```typescript
// BAD - creates new object every render
const data = useStore((state) => ({
  value: state.value,
  setter: state.setValue,
}));

// BAD - creates new array every render
const items = useStore((state) => [state.item1, state.item2]);
```

**✅ DO**: Use shallow equality or split subscriptions

```typescript
// GOOD - shallow equality
const data = useStore(
  (state) => ({ value: state.value, setter: state.setValue }),
  shallow
);

// GOOD - split subscriptions
const value = useStore((state) => state.value);
const setter = useStore((state) => state.setValue);
```

---

## Additional Notes

### Why setUpscaleSettings is Stable

Zustand store methods (setters) are **stable references** - they don't change between renders. However, when you wrap them in an object `{ setUpscaleSettings }`, that object is **new** every time.

### React's Maximum Update Depth

React allows up to **50 nested updates** before throwing this error. This is a safety mechanism to prevent browser freezes from infinite loops.

---

## References

- [Zustand: Selecting Multiple State Slices](https://github.com/pmndrs/zustand#selecting-multiple-state-slices)
- [React: Maximum Update Depth Exceeded](https://legacy.reactjs.org/docs/error-decoder.html?invariant=185)
- [Zustand Shallow Equality](https://docs.pmnd.rs/zustand/guides/prevent-rerenders-with-use-shallow)
- QCut Architecture: `CLAUDE.md` lines 160-167 (State Management patterns)
