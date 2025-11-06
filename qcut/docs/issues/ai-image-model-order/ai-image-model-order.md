# AI Image Model Order Adjustment

## Overview
Reorder the AI image edit dropdown so the cheapest, most general models appear first, while premium options remain available near the bottom. All ordering lives in `getImageEditModels()` inside the image edit client.

## Target Priority Order
1. Nano Banana (`nano-banana`) - lowest cost, solid default
2. Reve Edit (`reve-edit`) - budget-friendly edit flow
3. SeedDream v4 (`seeddream-v4`) - multi-image and parameter rich
4. SeedEdit v3 (`seededit`) - legacy precise edits
5. FLUX Pro Kontext (`flux-kontext`) - pro controls, mid-high cost
6. FLUX Pro Kontext Max (`flux-kontext-max`) - highest cost premium tier

## Implementation Tasks (real code)

### 1. Modify `getImageEditModels()` ordering
**File**: `qcut/apps/web/src/lib/image-edit-client.ts`

Replace the model array with the block below so the function emits the curated sequence.

```typescript
export function getImageEditModels() {
  return [
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing with Google/Gemini technology",
      provider: "Google",
      estimatedCost: "$0.039",
      features: [
        "Smart understanding",
        "Cost effective",
        "Multiple formats",
        "Edit descriptions",
      ],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["JPEG", "PNG"],
          default: "PNG",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
    {
      id: "reve-edit",
      name: "Reve Edit",
      description: "Cost-effective image editing with strong aesthetic quality",
      provider: "fal.ai",
      estimatedCost: "$0.04",
      features: [
        "Cost-effective editing",
        "Strong aesthetics",
        "Fast processing",
        "Multiple formats",
      ],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["png", "jpeg", "webp"],
          default: "png",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
    {
      id: "seeddream-v4",
      name: "SeedDream v4",
      description: "Advanced multi-image editing with unified architecture",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: [
        "Multi-image processing",
        "Flexible sizing",
        "Enhanced prompts",
        "Advanced controls",
      ],
      parameters: {
        imageSize: {
          type: "select",
          options: [
            "square_hd",
            "square",
            "portrait_3_4",
            "portrait_9_16",
            "landscape_4_3",
            "landscape_16_9",
          ],
          default: "square_hd",
          customRange: { min: 1024, max: 4096, step: 64 },
        },
        maxImages: { min: 1, max: 6, default: 1, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        syncMode: { type: "boolean", default: false },
        enableSafetyChecker: { type: "boolean", default: true },
        seed: { optional: true },
      },
    },
    {
      id: "seededit",
      name: "SeedEdit v3",
      description: "Precise photo editing with content preservation",
      provider: "ByteDance",
      estimatedCost: "$0.05-0.10",
      features: ["Photo retouching", "Object modification", "Realistic edits"],
      parameters: {
        guidanceScale: { min: 1, max: 10, default: 1.0, step: 0.1 },
        seed: { optional: true },
      },
    },
    {
      id: "flux-kontext",
      name: "FLUX Pro Kontext",
      description: "Context-aware editing with scene transformations",
      provider: "FLUX",
      estimatedCost: "$0.15-0.25",
      features: ["Style changes", "Object replacement", "Scene modification"],
      parameters: {
        guidanceScale: { min: 1, max: 20, default: 3.5, step: 0.5 },
        steps: { min: 1, max: 50, default: 28, step: 1 },
        safetyTolerance: { min: 1, max: 6, default: 2, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
      },
    },
    {
      id: "flux-kontext-max",
      name: "FLUX Pro Kontext Max",
      description: "Advanced editing for complex tasks and typography",
      provider: "FLUX",
      estimatedCost: "$0.25-0.40",
      features: ["Complex edits", "Typography", "Professional adjustments"],
      parameters: {
        guidanceScale: { min: 1, max: 20, default: 3.5, step: 0.5 },
        steps: { min: 1, max: 50, default: 28, step: 1 },
        safetyTolerance: { min: 1, max: 6, default: 2, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
      },
    },
  ];
}
```

### 2. Delete legacy order comments
**File**: `qcut/docs/issues/image-edit/image-edit.md`
- Remove any statements saying models are automatically sorted by price if they no longer match the new curated order.

### 3. Verify store defaults
**File**: `qcut/apps/web/src/stores/adjustment-store.ts`
- No code change required. Confirm the `selectedModel` default remains `"seededit"` for backward compatibility.

## Testing
- [ ] Manual: open Adjustment tab, expand Model Selection, confirm the order matches the list above.
- [ ] Regression: switch between models to ensure parameters reset correctly.
- [ ] Optional: run `pnpm --filter @qcut/web lint` to catch type issues.

## Change Log
- **November 2025** - Reordered `getImageEditModels()` to surface budget-friendly models first and documented manual verification steps.
