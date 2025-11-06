# AI Image Model Order Adjustment

## Goal
Ensure the AI Images multi-model selector lists models in a curated priority order (cheapest → premium) instead of the raw object insertion order.

## Target Priority Order
1. Nano Banana (`nano-banana`)
2. SeedDream v4 (`seeddream-v4`)
3. Reve Text-to-Image (`reve-text-to-image`)
4. WAN v2.2 (`wan-v2-2`)
5. Imagen4 Ultra (`imagen4-ultra`)
6. Qwen Image (`qwen-image`)
7. FLUX Pro v1.1 Ultra (`flux-pro-v11-ultra`)
8. SeedDream v3 (`seeddream-v3`)

## Implementation Summary

### 1. Define shared order in the model catalog  
**File**: `qcut/apps/web/src/lib/text2image-models.ts:646`

```typescript
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

### 2. Use the order for default selections  
**File**: `qcut/apps/web/src/stores/text2image-store.ts:55`

- Import `TEXT2IMAGE_MODEL_ORDER`.
- Set `selectedModels: [...TEXT2IMAGE_MODEL_ORDER]`.
- When multi-mode is empty, seed with `TEXT2IMAGE_MODEL_ORDER.slice(0, 6)`.
- When single-mode is empty, seed with `[TEXT2IMAGE_MODEL_ORDER[0]]`.

### 3. Render the selector using the shared order  
**File**: `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx:193`

```tsx
{TEXT2IMAGE_MODEL_ORDER.map((modelId) => {
  const model = TEXT2IMAGE_MODELS[modelId];
  return (
    <FloatingActionPanelModelOption
      key={modelId}
      id={modelId}
      name={model.name}
      checked={selectedModels.includes(modelId)}
      onCheckedChange={(checked) => {
        if (generationMode === "single") {
          selectedModels.forEach((m) => {
            if (m !== modelId) toggleModel(m);
          });
          if (checked && !selectedModels.includes(modelId)) {
            toggleModel(modelId);
          }
        } else {
          toggleModel(modelId);
        }
      }}
    />
  );
})}
```

## Validation
- Open **AI Images → Select Models** panel and confirm the order matches the list above.
- Toggle between Single and Multi modes to ensure defaults follow the new priority.
- Optional: `pnpm --filter @qcut/web lint`.

## Status
- [x] Shared priority constant exported.
- [x] Store defaults aligned.
- [x] UI selector iterates using the curated order.

---
*Last Updated: November 2025* · *Status: Completed*
