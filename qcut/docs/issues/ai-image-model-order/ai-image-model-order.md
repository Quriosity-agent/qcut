# AI Image Model Order Adjustment

## Overview
Balance the text-to-image dropdown order by cost and capability so the UI shows the curated priority instead of the object iteration order.

## Target Priority Order
1. Nano Banana (`nano-banana`) — cost-effective baseline with Google/Gemini alignment
2. SeedDream v4 (`seeddream-v4`) — multi-image artistic control
3. Reve Text-to-Image (`reve-text-to-image`) — fast edit-friendly generation
4. WAN v2.2 (`wan-v2-2`) — photorealistic depth via fal.ai
5. Imagen4 Ultra (`imagen4-ultra`) — highest photorealistic quality
6. Qwen Image (`qwen-image`) — multilingual creative coverage
7. FLUX Pro v1.1 Ultra (`flux-pro-v11-ultra`) — pro-grade detail with style controls
8. SeedDream v3 (`seeddream-v3`) — reliable fallback with low cost

## Implementation Tasks with Real Code

### 1. Add the shared model order constant
**File**: `qcut/apps/web/src/lib/text2image-models.ts`  
**Action**: ADD the following block immediately after the `TEXT2IMAGE_MODELS` export.

```typescript
// ============================================
// Priority order for Text2Image models
// ============================================
export const TEXT2IMAGE_MODEL_ORDER = [
  "nano-banana",
  "seeddream-v4",
  "reve-text-to-image",
  "wan-v2-2",
  "imagen4-ultra",
  "qwen-image",
  "flux-pro-v11-ultra",
  "seeddream-v3",
] as const;

export type Text2ImageModelId = (typeof TEXT2IMAGE_MODEL_ORDER)[number];

export function getText2ImageModelEntriesInPriorityOrder() {
  return TEXT2IMAGE_MODEL_ORDER.map(
    (modelId) => [modelId, TEXT2IMAGE_MODELS[modelId]] as const
  );
}
```

### 2. Modify the Text2Image store to consume the shared order
**File**: `qcut/apps/web/src/stores/text2image-store.ts`  
**Action**: MODIFY the imports and default selections so every list is driven by the shared order (note the inline array deletions).

```diff
@@
-import { TEXT2IMAGE_MODELS } from "@/lib/text2image-models";
+import {
+  TEXT2IMAGE_MODELS,
+  TEXT2IMAGE_MODEL_ORDER,
+} from "@/lib/text2image-models";
@@
-      selectedModels: [
-        "imagen4-ultra",
-        "seeddream-v3",
-        "seeddream-v4", // Add new SeedDream V4
-        "nano-banana", // Add new Nano Banana
-        "flux-pro-v11-ultra",
-        "wan-v2-2",
-        "qwen-image",
-        "reve-text-to-image", // Add Reve Text-to-Image
-      ], // Default to all models
+      selectedModels: [...TEXT2IMAGE_MODEL_ORDER], // Default to all models in curated priority order
@@
-          set({
-            selectedModels: [
-              "imagen4-ultra",
-              "wan-v2-2",
-              "seeddream-v3",
-              "seeddream-v4",
-              "nano-banana",
-              "reve-text-to-image",
-            ],
-          });
+          set({
+            selectedModels: TEXT2IMAGE_MODEL_ORDER.slice(0, 6),
+          });
@@
-          set({ selectedModels: ["imagen4-ultra"] });
+          set({
+            selectedModels: [TEXT2IMAGE_MODEL_ORDER[0]],
+          });
```

### 3. Modify the Text2Image view to iterate using the order constant
**File**: `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx`  
**Action**: UPDATE the import and replace the dropdown iteration so it respects the curated order.

```diff
@@
-import { TEXT2IMAGE_MODELS } from "@/lib/text2image-models";
+import {
+  TEXT2IMAGE_MODELS,
+  TEXT2IMAGE_MODEL_ORDER,
+} from "@/lib/text2image-models";
@@
-                      {Object.entries(TEXT2IMAGE_MODELS).map(([key, model]) => (
-                        <FloatingActionPanelModelOption
-                          key={key}
-                          id={key}
-                          name={model.name}
-                          checked={selectedModels.includes(key)}
+                      {TEXT2IMAGE_MODEL_ORDER.map((modelId) => {
+                        const model = TEXT2IMAGE_MODELS[modelId];
+                        return (
+                          <FloatingActionPanelModelOption
+                            key={modelId}
+                            id={modelId}
+                            name={model.name}
+                            checked={selectedModels.includes(modelId)}
                           onCheckedChange={(checked) => {
                             if (generationMode === "single") {
                               // Clear all selections and select only this one
                               selectedModels.forEach((m) => {
-                                if (m !== key) toggleModel(m);
+                                if (m !== modelId) toggleModel(m);
                               });
-                              if (checked && !selectedModels.includes(key)) {
-                                toggleModel(key);
+                              if (checked && !selectedModels.includes(modelId)) {
+                                toggleModel(modelId);
                               }
                             } else {
                               // Multi-model mode - just toggle
-                              toggleModel(key);
+                              toggleModel(modelId);
                             }
                           }}
                         />
-                      ))}
+                        );
+                      })}
```

### 4. Clean up any stale references
Remove any comments or documentation that still claim the dropdown is automatically cheapest-first. The curated priority list above is the source of truth once the shared constant exists.

## Testing
- [ ] `pnpm --filter @qcut/web lint`
- [ ] `pnpm --filter @qcut/web test` (or the targeted component tests)
- [ ] Manual UI check: open Text-to-Image panel and confirm the dropdown reflects the order above in both single and multi-model modes.

## Change Log
- **November 2025** — Added shared priority order constant, updated store/UI to consume it, and removed outdated cheapest-first messaging.
