# Add New Image Editing Models (SeedDream V4 + Nano Banana) - Adjustment Panel

## Overview
Add SeedDream V4 and Nano Banana as additional model options in the adjustment panel, keeping existing SeedDream V3 functionality intact. This approach provides users with choice between multiple proven models based on their specific editing needs while maintaining full backward compatibility.

## Current State
- Adjustment panel currently using SeedDream V3
- Users have established workflows with V3
- Existing presets and configurations work with V3

## Target State
- **Multi-Model Support**: SeedDream V3, SeedDream V4, and Nano Banana all available
- **User Choice**: Users can select optimal model based on use case and requirements
- **V3 Preservation**: All existing V3 functionality remains unchanged
- **Enhanced Options**: New V4 and Nano Banana features available as opt-in capabilities

## SeedDream V4 New Features
- **Unified Architecture**: Integrates image generation and editing into single model
- **Multiple Image Support**: Can edit up to 10 input images simultaneously
- **Enhanced Control**: Better text-based editing instructions (max 5000 characters)
- **Flexible Image Sizing**: Configurable dimensions (1024-4096 pixels)
- **Improved Parameters**: New seed control, sync_mode, and safety checker options

## Nano Banana Features
- **Google/Gemini Technology**: Google-powered image editing with advanced AI
- **Multi-Image Support**: Edit 1-10 images simultaneously
- **Flexible Output**: Generate 1-4 output images per request
- **Format Options**: JPEG or PNG output formats
- **Commercial License**: Full commercial use rights
- **Cost Effective**: $0.039 per image (competitive pricing)
- **Edit Description**: Provides text description alongside generated images
- **Sync Mode**: Direct data URI return for immediate use

## Model Comparison
| Feature | SeedDream V3 | SeedDream V4 | Nano Banana |
|---------|-------------|-------------|-------------|
| **Input Images** | 1 | 1-10 | 1-10 |
| **Output Images** | 1-4 | 1-4 | 1-4 |
| **Prompt Length** | Limited | 5000 chars | Standard |
| **Image Size** | Fixed options | 1024-4096px | Standard |
| **Technology** | ByteDance | ByteDance V4 | Google/Gemini |
| **Special Features** | Proven stable | Unified arch | Edit descriptions |
| **Best For** | Reliable edits | Complex edits | Smart understanding |

## Key API Changes
### SeedDream V4 Parameters:
- `image_urls`: Array of up to 10 input image URLs for editing
- `image_size`: Configurable dimensions (1024-4096px) vs fixed sizes in V3
- `max_images`: Maximum images per generation (default 1)
- `sync_mode`: Synchronous processing option
- `enable_safety_checker`: Content safety validation
- `prompt`: Increased limit to 5000 characters (vs V3 limit)
- `num_images`: Generation iterations control
- `seed`: Better seed control for reproducible results

### Nano Banana Parameters:
- `image_urls`: Array of 1-10 input image URLs for editing
- `prompt`: Text description of desired edit
- `num_images`: Number of output images (1-4)
- `output_format`: JPEG or PNG output format
- `sync_mode`: Return direct data URI vs queue processing

## Implementation Subtasks

### Phase 1: Core API Integration (Est. 2-3 hours)
#### Subtask 1.1: Add New Model Configurations (60-90 min)
**Files to modify:**
- `apps/web/src/lib/text2image-models.ts` - Add SeedDream V4 and Nano Banana models alongside existing V3
- `apps/web/src/lib/image-edit-client.ts` - Add V4 and Nano Banana configurations alongside existing V3

**Tasks:**
- [ ] Add new "seeddream-v4" model entry with `fal-ai/bytedance/seedream/v4/edit` endpoint
- [ ] Add new "nano-banana" model entry with `fal-ai/nano-banana/edit` endpoint
- [ ] Keep existing "seeddream-v3" model unchanged
- [ ] Add V4 parameter definitions (image_urls, max_images, sync_mode, enable_safety_checker, image_size range)
- [ ] Add Nano Banana parameter definitions (image_urls, num_images, output_format, sync_mode)
- [ ] Ensure all three models are available in model selection
- [ ] Add model-specific validation rules

#### Subtask 1.2: Multi-Model Support Layer (60-90 min)
**Files to modify:**
- `apps/web/src/lib/fal-ai-client.ts` - Add V4 and Nano Banana parameter handling while keeping V3 intact

**Tasks:**
- [ ] Add V4 parameter conversion function (separate from V3)
- [ ] Add Nano Banana parameter conversion function (separate from V3/V4)
- [ ] Keep existing V3 parameter conversion unchanged
- [ ] Add model version detection logic (V3/V4/Nano Banana)
- [ ] Add parameter validation for V4 and Nano Banana formats (V3 validation remains)
- [ ] Implement model-specific parameter routing
- [ ] Add output format handling for Nano Banana (JPEG/PNG)

### Phase 2: State Management Updates (Est. 1-2 hours)
#### Subtask 2.1: Store Updates (45-60 min)
**Files to modify:**
- `apps/web/src/stores/adjustment-store.ts` - Add V4 model support alongside V3
- `apps/web/src/stores/text2image-store.ts` - Add "seeddream-v4" to available models

**Tasks:**
- [ ] Add "seeddream-v4" and "nano-banana" to available models array (keep "seeddream-v3")
- [ ] Add V4-specific default parameters to state schema
- [ ] Add Nano Banana-specific default parameters to state schema
- [ ] Add model version tracking in state (V3/V4/Nano Banana)
- [ ] Support all three model parameter structures in state
- [ ] Add model-specific parameter sets for each model type

#### Subtask 2.2: Model Selection System (30-45 min)
**Files to modify:**
- `apps/web/src/stores/settings-store.ts` - Add model preference settings
- `apps/web/src/lib/model-utils.ts` - Create model selection utilities

**Tasks:**
- [ ] Add user preference for default image editing model (V3/V4/Nano Banana)
- [ ] Add per-project model selection tracking for all three models
- [ ] Create model capability detection functions (multi-image, output formats, etc.)
- [ ] Add model recommendation logic based on use case (speed vs quality vs features)
- [ ] Add model comparison utilities for UI display

### Phase 3: UI Component Updates (Est. 3-4 hours)
#### Subtask 3.1: Adjustment Panel Core (90-120 min)
**Files to modify:**
- `apps/web/src/components/editor/adjustment/index.tsx` - Main adjustment panel component
- `apps/web/src/components/editor/adjustment/model-selector.tsx` - Model selection UI

**Tasks:**
- [ ] Add V4 and Nano Banana models to selection dropdown (alongside V3)
- [ ] Add model-specific parameter handling (V3, V4, and Nano Banana)
- [ ] Display model capabilities and differences in UI
- [ ] Add model switching functionality between all three options
- [ ] Show appropriate parameter controls per selected model
- [ ] Add model badges/indicators for each type

#### Subtask 3.2: V4-Specific Parameter Controls (60-90 min)
**Files to create:**
- `apps/web/src/components/editor/adjustment/v4/image-size-slider.tsx` - V4 flexible sizing (1024-4096px)
- `apps/web/src/components/editor/adjustment/v4/multi-image-upload.tsx` - Multi-image support (up to 10)
- `apps/web/src/components/editor/adjustment/v4/enhanced-prompt-input.tsx` - 5000 character prompt input
- `apps/web/src/components/editor/adjustment/v4/safety-controls.tsx` - V4 safety options

**Tasks:**
- [ ] Create V4-specific slider for 1024-4096px image size range
- [ ] Build multi-image upload interface (up to 10 images)
- [ ] Create enhanced prompt input with 5000 character counter
- [ ] Add toggle controls for sync_mode and safety_checker
- [ ] Add V4 model badge/indicators

#### Subtask 3.3: Model Selection UI (45-60 min)
**Files to modify:**
- `apps/web/src/components/editor/adjustment/model-selector.tsx` - Enhanced model selector
- `apps/web/src/components/editor/adjustment/model-comparison.tsx` - V3 vs V4 feature comparison

**Tasks:**
- [ ] Update model selector to show both V3 and V4 options
- [ ] Add model feature comparison tooltip/modal
- [ ] Show model-specific pricing and capabilities
- [ ] Add "Recommended" badges for different use cases
- [ ] Implement smooth model switching without data loss

### Phase 4: Testing & Validation (Est. 2-3 hours)
#### Subtask 4.1: Unit Testing (60-90 min)
**Files to create:**
- `apps/web/src/lib/__tests__/parameter-translation.test.ts`
- `apps/web/src/stores/__tests__/v4-migration.test.ts`

**Tasks:**
- [ ] Test V4 parameter handling functions (separate from V3)
- [ ] Validate dual model support functions
- [ ] Test model selection logic and switching
- [ ] Verify parameter validation for both V3 and V4 formats
- [ ] Test model capability detection

#### Subtask 4.2: Integration Testing (60-90 min)
**Test files to update:**
- Update existing adjustment panel tests to support both models

**Tasks:**
- [ ] Test V3 workflows continue to work unchanged
- [ ] Test V4 workflows with new capabilities
- [ ] Validate model switching preserves compatible parameters
- [ ] Test error handling for both V3 and V4 API calls
- [ ] Verify user can seamlessly switch between models
- [ ] Test that V3 users are unaffected by V4 addition

### Phase 5: Documentation & Rollout (Est. 1-2 hours)
#### Subtask 5.1: Documentation Updates (30-45 min)
**Files to update:**
- Update component documentation for V4 features
- Add migration guide for developers

**Tasks:**
- [ ] Document V4 features and when to use V4 vs V3
- [ ] Create user guide for model selection
- [ ] Document new V4 parameters and capabilities
- [ ] Update troubleshooting guide for dual model support

#### Subtask 5.2: Monitoring & Analytics (45-60 min)
**Files to create:**
- `apps/web/src/lib/model-usage-analytics.ts` - Track V3/V4 usage patterns

**Tasks:**
- [ ] Add usage analytics for V3 vs V4 adoption
- [ ] Monitor V4 API performance and error rates
- [ ] Track user preference patterns (V3 vs V4)
- [ ] Add success metrics for dual model implementation
- [ ] Monitor resource usage differences between models

## Critical Files Requiring Modification
1. **`apps/web/src/lib/text2image-models.ts`** - Core model configuration
2. **`apps/web/src/lib/image-edit-client.ts`** - Image editing API client
3. **`apps/web/src/lib/fal-ai-client.ts`** - Parameter conversion logic
4. **`apps/web/src/stores/adjustment-store.ts`** - Adjustment panel state
5. **`apps/web/src/stores/text2image-store.ts`** - Text2image model references
6. **`apps/web/src/components/editor/adjustment/index.tsx`** - Main adjustment panel
7. **`apps/web/src/components/editor/adjustment/model-selector.tsx`** - Model selection UI

## Adjustment Panel Specific Considerations
- **Image Size Controls**: Update slider ranges to support 1024-4096px dimensions
- **Multi-Image Support**: Design UI to handle up to 10 input images
- **Enhanced Prompts**: Expand text input to support 5000 character limit
- **Parameter Mapping**: Map V3 parameters to V4 equivalents
- **Real-time Preview**: Test performance with new unified architecture
- **Safety Integration**: Implement safety checker toggle in UI

## Breaking Changes Prevention Strategy

### Critical Non-Breaking Requirements
- **Maintain V3 Compatibility**: Keep existing V3 endpoints functional during transition
- **Gradual Migration**: Implement feature flags to toggle between V3/V4
- **Fallback Mechanism**: Auto-fallback to V3 if V4 fails
- **Preserve User Data**: Ensure existing presets and settings remain functional
- **API Response Compatibility**: Maintain consistent response format for existing features

### Backward Compatibility Plan
1. **Dual API Support**: Maintain both V3 and V4 API connections
2. **Parameter Translation Layer**: Create adapter to translate V3 params to V4
3. **Progressive Enhancement**: Add V4 features as optional enhancements
4. **Version Detection**: Auto-detect user's current workflow requirements
5. **Graceful Degradation**: Remove V4-only features if V3 mode needed

## Migration Steps
1. **Phase 1 - Foundation**
   - Create V4 API integration alongside existing V3
   - Implement parameter translation layer
   - Add feature flag system for V3/V4 switching

2. **Phase 2 - Compatibility Testing**
   - Test all existing V3 workflows with V4 backend
   - Validate parameter mapping accuracy
   - Ensure UI controls work with both versions

3. **Phase 3 - Enhanced Features**
   - Add V4-specific controls (multi-image, extended prompts)
   - Implement progressive enhancement for V4 capabilities
   - Add user preference for V3/V4 mode

4. **Phase 4 - Validation**
   - Comprehensive testing of existing user workflows
   - Performance comparison between V3/V4
   - User acceptance testing with existing presets

5. **Phase 5 - Rollout**
   - Gradual rollout with A/B testing
   - Monitor for breaking changes in production
   - Maintain V3 as fallback option

## Risk Mitigation
- **Data Loss Prevention**: Backup existing settings before migration
- **Performance Monitoring**: Track response times and error rates
- **User Communication**: Clear messaging about changes and benefits
- **Rollback Plan**: Quick revert mechanism to V3 if issues arise
- **Support Documentation**: Update help docs for both versions

## Testing Checklist
- [ ] All existing V3 workflows function with V4 backend
- [ ] Parameter conversion maintains same output quality
- [ ] UI controls respond correctly in both modes
- [ ] Error handling works for both API versions
- [ ] User presets load and save correctly
- [ ] Performance meets or exceeds V3 benchmarks
- [ ] No data corruption during parameter translation
- [ ] Graceful fallback to V3 when V4 unavailable

## Notes
- **Zero Breaking Changes**: Primary goal is seamless transition
- **Feature Addition Only**: V4 should add capabilities, not remove them
- **User Choice**: Allow users to stay on V3 if preferred
- **Monitoring**: Extensive logging during migration period
- **Documentation**: Clear migration guide for power users