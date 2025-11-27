# Parameter Controls `numImages` Undefined Error

## Issue Summary

**Error**: `TypeError: Cannot read properties of undefined (reading 'numImages')`
**Location**: `parameter-controls.tsx:153`
**Severity**: High (causes UI crash)
**Component**: `ParameterControls` in adjustment panel

## Error Details

```
Uncaught TypeError: Cannot read properties of undefined (reading 'numImages')
    at cx (parameter-controls.tsx:153:29)
```

The error occurs when the `ParameterControls` component tries to render but the `parameters` object from the Zustand store is undefined or doesn't have the `numImages` property initialized.

## Root Cause Analysis

### Problem Location

In `apps/web/src/components/editor/adjustment/parameter-controls.tsx` at line 153:

```tsx
{parameters.numImages}  // Line 153 - crashes when parameters is undefined
```

### Why It Happens

1. **Store Initialization Race Condition**: The `useAdjustmentStore()` hook returns `parameters` which may be undefined when:
   - The store hasn't finished initializing
   - The selected model changes and parameters aren't updated yet
   - The component mounts before store hydration completes

2. **Missing Defensive Checks**: The code assumes `parameters` is always defined, but:
   - Line 148 checks `modelParams.numImages` (model configuration)
   - Line 153 reads `parameters.numImages` (current state value) without checking if it exists

3. **Model Switch Timing**: When switching models, there's a brief moment where:
   - `selectedModel` updates to the new model
   - `parameters` still contains values from the previous model (or is reset)
   - The UI renders before `parameters` is updated with new model defaults

## Reproduction Steps

1. Open the editor with a project
2. Navigate to the adjustment panel
3. Select an image on the timeline
4. The error may occur on initial load or when switching between models

## Affected Code

```tsx
// Line 147-168 in parameter-controls.tsx
{modelParams.numImages && (
  <div className="space-y-2">
    <div className="flex justify-between">
      <Label className="text-xs">Number of Images</Label>
      <span className="text-xs text-muted-foreground">
        {parameters.numImages}  // ❌ CRASHES HERE
      </span>
    </div>
    <Slider
      value={[parameters.numImages]}  // ❌ Also would crash
      onValueChange={([value]) => updateParameter("numImages", value)}
      min={modelParams.numImages.min}
      max={modelParams.numImages.max}
      step={modelParams.numImages.step}
      className="w-full"
    />
    ...
  </div>
)}
```

## Solution

### Fix 1: Add Defensive Checks (Recommended)

Add null/undefined checks for all parameter accesses:

```tsx
{modelParams.numImages && parameters.numImages !== undefined && (
  <div className="space-y-2">
    <div className="flex justify-between">
      <Label className="text-xs">Number of Images</Label>
      <span className="text-xs text-muted-foreground">
        {parameters.numImages}
      </span>
    </div>
    <Slider
      value={[parameters.numImages]}
      onValueChange={([value]) => updateParameter("numImages", value)}
      min={modelParams.numImages.min}
      max={modelParams.numImages.max}
      step={modelParams.numImages.step}
      className="w-full"
    />
    <p className="text-xs text-muted-foreground">
      Generate multiple variations
    </p>
  </div>
)}
```

### Fix 2: Use Optional Chaining with Fallbacks

```tsx
{modelParams.numImages && (
  <div className="space-y-2">
    <div className="flex justify-between">
      <Label className="text-xs">Number of Images</Label>
      <span className="text-xs text-muted-foreground">
        {parameters?.numImages ?? modelParams.numImages.default ?? 1}
      </span>
    </div>
    <Slider
      value={[parameters?.numImages ?? modelParams.numImages.default ?? 1]}
      onValueChange={([value]) => updateParameter("numImages", value)}
      min={modelParams.numImages.min}
      max={modelParams.numImages.max}
      step={modelParams.numImages.step}
      className="w-full"
    />
    ...
  </div>
)}
```

### Fix 3: Ensure Store Initialization

In the adjustment store, ensure parameters are always initialized with defaults:

```tsx
// In adjustment-store.ts
const useAdjustmentStore = create<AdjustmentStore>((set, get) => ({
  parameters: {
    numImages: 1,
    guidanceScale: 7.5,
    steps: 28,
    safetyTolerance: 2,
    // ... other defaults
  },
  // ... rest of store
}));
```

### Fix 4: Add Early Return Guard

Add a guard at the top of the component:

```tsx
export function ParameterControls() {
  const {
    selectedModel,
    parameters,
    // ... other state
  } = useAdjustmentStore();

  const models = getImageEditModels();
  const currentModel = models.find((m) => m.id === selectedModel);

  // Guard against missing model or parameters
  if (!currentModel || !parameters) return null;

  // ... rest of component
}
```

## Similar Issues to Check

The same pattern appears elsewhere in the file. Review and fix:

- Line 80: `parameters.guidanceScale`
- Line 84: `parameters.guidanceScale` (in Slider)
- Line 105: `parameters.steps`
- Line 109: `parameters.steps` (in Slider)
- Line 128: `parameters.safetyTolerance`
- Line 132: `parameters.safetyTolerance` (in Slider)
- Line 153: `parameters.numImages` ← Current crash
- Line 157: `parameters.numImages` (in Slider)
- Line 176: `parameters.seed`
- Line 333: `parameters.numImages` (in pricing calculation)

## Implementation Checklist

- [ ] Add defensive check for `parameters` object existence
- [ ] Add null/undefined checks for each parameter property access
- [ ] Use fallback values (default from model config or hardcoded)
- [ ] Review adjustment-store.ts for proper initialization
- [ ] Test with different models (FLUX, SeedDream V4, Nano Banana)
- [ ] Test rapid model switching
- [ ] Test on fresh project load

## Testing

After implementing the fix:

1. Load the editor fresh
2. Navigate to adjustment panel
3. Switch between different image models
4. Verify no console errors
5. Verify all parameter controls render correctly
6. Test parameter slider interactions
