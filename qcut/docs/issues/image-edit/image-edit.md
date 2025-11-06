# Image Edit Feature - Model Order Update

## Quick Summary - What to Do

**Single Change Required:** Reorder the models in one function to display cheapest first.

### The Change
1. **File to modify:** `qcut/apps/web/src/lib/image-edit-client.ts`
2. **Function to update:** `getImageEditModels()` (Line 627)
3. **Action:** Move the model objects into price order (see updated code below)

### Current vs Desired Order
| Current Order | -> | New Order (by price) |
|--------------|---|---------------------|
| 1. SeedEdit v3 ($0.05-0.10) | -> | 1. Nano Banana ($0.039) |
| 2. FLUX Pro Kontext ($0.15-0.25) | -> | 2. Reve Edit ($0.04) |
| 3. FLUX Pro Kontext Max ($0.25-0.40) | -> | 3. SeedDream v4 ($0.04-0.08) |
| 4. SeedDream v4 ($0.04-0.08) | -> | 4. SeedEdit v3 ($0.05-0.10) |
| 5. Nano Banana ($0.039) | -> | 5. FLUX Pro Kontext ($0.15-0.25) |
| 6. Reve Edit ($0.04) | -> | 6. FLUX Pro Kontext Max ($0.25-0.40) |

## Feature Description
The Image Edit feature provides AI-powered image editing tools directly within QCut:
- AI model selection for image generation/editing
- Basic image upload and management
- Integration with existing timeline
- Export capabilities

## Technical Specifications

### Core Components
1. **Image Editor Panel** (✅ ALREADY EXISTS)
   - Location: Implemented in Adjustment tab of media panel
   - Purpose: Main UI component for image editing interface
   - Features: Model selection, image upload, "Generate Edit" button
   - Status: Fully functional with AI Image Editing capability

2. **Image Processing Client** (✅ ALREADY EXISTS)
   - Location: `qcut/apps/web/src/lib/image-edit-client.ts`
   - Purpose: Handle AI model API calls and image processing
   - Status: Fully implemented with FAL.ai integration

### Existing Components to Leverage
1. **AI Image Upload Component** (✅ EXISTS)
   - Location: `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx`
   - Features: Single/dual frame upload, validation, preview

2. **Text2Image Models** (✅ EXISTS)
   - Location: `qcut/apps/web/src/lib/text2image-models.ts`
   - Models: Imagen4, FLUX, StableDiffusion, etc.

3. **Image Utils** (✅ EXISTS)
   - Location: `qcut/apps/web/src/lib/image-utils.ts`
   - Features: Image processing utilities

4. **Error Handler** (✅ EXISTS)
   - Location: `qcut/apps/web/src/lib/error-handler.ts`
   - Features: AI service error handling

### Dependencies
- Existing AI video client infrastructure
- Canvas API for basic image display
- File upload components (already implemented)

## Code to Modify

### File: `qcut/apps/web/src/lib/image-edit-client.ts`

#### Current Code (Lines 627-751)
```typescript
export function getImageEditModels() {
  return [
    {
      id: "seededit",
      name: "SeedEdit v3",
      description: "Precise photo editing with content preservation",
      provider: "ByteDance",
      estimatedCost: "$0.05-0.10",
      features: ["Photo retouching", "Object modification", "Realistic edits"],
      parameters: { /* ... */ },
    },
    {
      id: "flux-kontext",
      name: "FLUX Pro Kontext",
      description: "Context-aware editing with scene transformations",
      provider: "FLUX",
      estimatedCost: "$0.15-0.25",
      features: ["Style changes", "Object replacement", "Scene modification"],
      parameters: { /* ... */ },
    },
    {
      id: "flux-kontext-max",
      name: "FLUX Pro Kontext Max",
      description: "Advanced editing for complex tasks and typography",
      provider: "FLUX",
      estimatedCost: "$0.25-0.40",
      features: ["Complex edits", "Typography", "Professional adjustments"],
      parameters: { /* ... */ },
    },
    {
      id: "seeddream-v4",
      name: "SeedDream v4",
      description: "Advanced multi-image editing with unified architecture",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: ["Multi-image processing", "Flexible sizing", "Enhanced prompts", "Advanced controls"],
      parameters: { /* ... */ },
    },
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing with Google/Gemini technology",
      provider: "Google",
      estimatedCost: "$0.039",
      features: ["Smart understanding", "Cost effective", "Multiple formats", "Edit descriptions"],
      parameters: { /* ... */ },
    },
    {
      id: "reve-edit",
      name: "Reve Edit",
      description: "Cost-effective image editing with strong aesthetic quality",
      provider: "fal.ai",
      estimatedCost: "$0.04",
      features: ["Cost-effective editing", "Strong aesthetics", "Fast processing", "Multiple formats"],
      parameters: { /* ... */ },
    },
  ];
}

```

#### Updated Code (Reordered by Price - Cheapest First)
```typescript
export function getImageEditModels() {
  return [
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing with Google/Gemini technology",
      provider: "Google",
      estimatedCost: "$0.039",
      features: ["Smart understanding", "Cost effective", "Multiple formats", "Edit descriptions"],
      parameters: { /* ... keep existing parameters */ },
    },
    {
      id: "reve-edit",
      name: "Reve Edit",
      description: "Cost-effective image editing with strong aesthetic quality",
      provider: "fal.ai",
      estimatedCost: "$0.04",
      features: ["Cost-effective editing", "Strong aesthetics", "Fast processing", "Multiple formats"],
      parameters: { /* ... keep existing parameters */ },
    },
    {
      id: "seeddream-v4",
      name: "SeedDream v4",
      description: "Advanced multi-image editing with unified architecture",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: ["Multi-image processing", "Flexible sizing", "Enhanced prompts", "Advanced controls"],
      parameters: { /* ... keep existing parameters */ },
    },
    {
      id: "seededit",
      name: "SeedEdit v3",
      description: "Precise photo editing with content preservation",
      provider: "ByteDance",
      estimatedCost: "$0.05-0.10",
      features: ["Photo retouching", "Object modification", "Realistic edits"],
      parameters: { /* ... keep existing parameters */ },
    },
    {
      id: "flux-kontext",
      name: "FLUX Pro Kontext",
      description: "Context-aware editing with scene transformations",
      provider: "FLUX",
      estimatedCost: "$0.15-0.25",
      features: ["Style changes", "Object replacement", "Scene modification"],
      parameters: { /* ... keep existing parameters */ },
    },
    {
      id: "flux-kontext-max",
      name: "FLUX Pro Kontext Max",
      description: "Advanced editing for complex tasks and typography",
      provider: "FLUX",
      estimatedCost: "$0.25-0.40",
      features: ["Complex edits", "Typography", "Professional adjustments"],
      parameters: { /* ... keep existing parameters */ },
    },
  ];
}
```

## Files That Use This Function

### Components Using `getImageEditModels()`
1. **`qcut/apps/web/src/components/editor/adjustment/model-selector.tsx`** (Line 12)
   - Renders the model dropdown in the Adjustment tab
   - Displays models with pricing and checkmark for selected model

2. **`qcut/apps/web/src/components/editor/adjustment/parameter-controls.tsx`** (Line 35)
   - Uses model list to configure parameter controls for selected model

## Implementation Notes

### What This Change Does
- **Reorders models by price** (cheapest first: $0.039 -> $0.40)
- **Keeps all functionality intact** - Only changes display order
- **Maintains SeedEdit v3 as default** - Can be kept via `selectedModel` state in adjustment store

### Default Model Configuration
If you want to keep SeedEdit v3 as default despite not being first, check:
- **`qcut/apps/web/src/stores/adjustment-store.ts`** - Look for initial `selectedModel` state
- Set default to `"seededit"` if not already set

## Reviewer Notes
- Reviewed the implementation and confirmed only the getImageEditModels() array order needs to change to match the pricing table; move the complete model objects so parameter maps stay aligned.
- Verified qcut/apps/web/src/stores/adjustment-store.ts initializes selectedModel to "seededit", so the default selection remains correct after reordering.

<!-- Reviewer: Plan validated; proceed with the reorder when ready. -->
---

*Last Updated: November 2025*
*Status: Planning Phase*



