# AI Image Model Order Adjustment

## Overview
This document tracks the implementation of price-based ordering for AI image generation models in the QCut application. Models are now displayed from cheapest to most expensive to help users make cost-effective choices.

## Objective
Reorder AI image generation models in the UI dropdown to display them by price (ascending), making it easier for users to identify cost-effective options.

## Current Implementation Status
✅ **Completed** - Model order has been updated to display cheapest first

## Model Order (By Price - Cheapest First)

### 1. Nano Banana
- **Provider**: Google
- **Cost**: $0.039 per generation
- **Features**: Smart understanding, Cost effective, Multiple formats, Edit descriptions
- **Best for**: Budget-conscious users needing basic AI image editing

### 2. Reve Edit
- **Provider**: fal.ai
- **Cost**: $0.04 per generation
- **Features**: Cost-effective editing, Strong aesthetics, Fast processing, Multiple formats
- **Best for**: Quick edits with good aesthetic quality at low cost

### 3. SeedDream v4
- **Provider**: ByteDance
- **Cost**: $0.04-0.08 per generation
- **Features**: Multi-image processing, Flexible sizing, Enhanced prompts, Advanced controls
- **Best for**: Users needing multi-image capabilities with advanced control options

### 4. SeedEdit v3
- **Provider**: ByteDance
- **Cost**: $0.05-0.10 per generation
- **Features**: Photo retouching, Object modification, Realistic edits
- **Best for**: Precise photo editing with content preservation
- **Note**: Currently set as default model in the application

### 5. FLUX Pro Kontext
- **Provider**: FLUX
- **Cost**: $0.15-0.25 per generation
- **Features**: Style changes, Object replacement, Scene modification
- **Best for**: Context-aware editing with scene transformations

### 6. FLUX Pro Kontext Max
- **Provider**: FLUX
- **Cost**: $0.25-0.40 per generation
- **Features**: Complex edits, Typography, Professional adjustments
- **Best for**: Advanced editing for complex tasks and typography

## Implementation Details

### Files to Modify

#### Primary File
`qcut/apps/web/src/lib/image-edit-client.ts`
- **Function**: `getImageEditModels()`
- **Line Range**: 627-751
- **Action**: Reorder the array of model objects to match the price-based order above

### Components That Use This Function

1. **Model Selector Component**
   - Path: `qcut/apps/web/src/components/editor/adjustment/model-selector.tsx`
   - Line: 12
   - Purpose: Renders the model dropdown in the Adjustment tab

2. **Parameter Controls Component**
   - Path: `qcut/apps/web/src/components/editor/adjustment/parameter-controls.tsx`
   - Line: 35
   - Purpose: Configures parameter controls based on selected model

### Default Model Configuration
- **Store**: `qcut/apps/web/src/stores/adjustment-store.ts`
- **Default**: "seededit" (SeedEdit v3)
- **Note**: Default selection remains unchanged despite reordering

## Code Changes Required

### Before (Current Order)
```typescript
export function getImageEditModels() {
  return [
    { id: "seededit", ... },      // $0.05-0.10
    { id: "flux-kontext", ... },   // $0.15-0.25
    { id: "flux-kontext-max", ...}, // $0.25-0.40
    { id: "seeddream-v4", ... },   // $0.04-0.08
    { id: "nano-banana", ... },    // $0.039
    { id: "reve-edit", ... },      // $0.04
  ];
}
```

### After (Price-Based Order)
```typescript
export function getImageEditModels() {
  return [
    { id: "nano-banana", ... },    // $0.039 ⬆️
    { id: "reve-edit", ... },      // $0.04 ⬆️
    { id: "seeddream-v4", ... },   // $0.04-0.08 ⬆️
    { id: "seededit", ... },       // $0.05-0.10 (stays default)
    { id: "flux-kontext", ... },   // $0.15-0.25 ⬇️
    { id: "flux-kontext-max", ...}, // $0.25-0.40 ⬇️
  ];
}
```

## User Interface Impact

### Model Selection Dropdown
- Models now appear in price-ascending order
- Pricing information displayed next to each model name
- Selected model indicated with checkmark
- Default selection (SeedEdit v3) remains in 4th position

### Benefits for Users
1. **Cost Transparency**: Cheapest options appear first
2. **Informed Decisions**: Easy comparison of price vs features
3. **Budget Control**: Quick identification of economical choices
4. **Feature Discovery**: Clear progression from basic to advanced models

## Testing Checklist

- [x] Model order displays correctly in dropdown
- [x] Pricing information is accurate
- [x] Default model selection still works
- [x] Model switching functionality preserved
- [x] Parameter controls update correctly for each model
- [x] Build completes without errors

## Migration Notes

### For Developers
- No database migrations required
- No API changes needed
- UI automatically reflects new order
- Existing user preferences maintained

### For Users
- Model order in dropdown has changed
- All functionality remains the same
- Previous selections and history preserved
- Default model (SeedEdit v3) unchanged

## Related Documentation

- [Image Edit Feature Documentation](../image-edit/image-edit.md)
- [AI Video Client Implementation](../../../apps/web/src/lib/ai-video-client.ts)
- [Adjustment Store Configuration](../../../apps/web/src/stores/adjustment-store.ts)

## Future Considerations

### Potential Enhancements
1. **Dynamic Pricing**: Fetch real-time pricing from providers
2. **Usage Analytics**: Track most popular models
3. **Cost Calculator**: Estimate costs based on usage patterns
4. **Favorites System**: Allow users to pin preferred models
5. **Filtering Options**: Add filters for price range, features, provider

### Configuration Options
Consider adding user preferences for:
- Default sort order (price, name, popularity)
- Hide/show specific models
- Custom model grouping
- Price display format (per use, monthly estimate)

## Rollback Plan

If issues arise, revert the order in `getImageEditModels()` to the original sequence while maintaining all other functionality.

## Change Log

### November 2025
- Initial implementation of price-based model ordering
- Updated documentation to reflect new order
- Fixed TypeScript build errors in ai.tsx
- Verified all dependent components work correctly

---

*Last Updated: November 2025*
*Status: Completed*
*Priority: Medium*
*Impact: User Experience Enhancement*