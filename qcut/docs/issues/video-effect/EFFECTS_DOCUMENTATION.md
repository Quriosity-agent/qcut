# Video Effects System Documentation

## Overview
The QCut Video Effects System provides CSS filter-based effects that can be applied to timeline elements (videos and images). The system is designed with safety and performance in mind, using a feature flag system to ensure backward compatibility.

## Architecture

### Core Components

1. **Effects Store** (`src/stores/effects-store.ts`)
   - Zustand store managing all effect states
   - Contains 20 predefined effect presets
   - Handles effect application, removal, and parameter updates

2. **Effects Types** (`src/types/effects.ts`)
   - TypeScript definitions for all effect types
   - Module augmentation to extend timeline elements
   - Effect categories and parameters

3. **Effects Utils** (`src/lib/effects-utils.ts`)
   - CSS filter conversion utilities
   - Canvas context effect application
   - Parameter validation and merging

4. **UI Components**
   - Effects Panel (`src/components/editor/media-panel/views/effects.tsx`)
   - Effects Properties (`src/components/editor/properties-panel/effects-properties.tsx`)
   - Effects Timeline (`src/components/editor/timeline/effects-timeline.tsx`)

## Available Effects

### Basic Effects
- **Brightness**: Adjust image brightness (-100 to +100)
- **Contrast**: Modify contrast levels (-100 to +100)
- **Sharpen**: Enhance edge definition (0 to 100)

### Color Effects
- **Saturation**: Control color intensity (-100 to +200)
- **Warm**: Add warm color tones (0 to 100)
- **Cool**: Add cool color tones (0 to 100)
- **Vibrant**: Boost color saturation
- **Muted**: Reduce color saturation

### Artistic Effects
- **Grayscale**: Convert to black and white (0 to 100)
- **Invert**: Invert all colors (0 to 100)
- **Emboss**: Create 3D emboss effect (0 to 100)
- **Edge Detection**: Highlight edges (0 to 100)

### Vintage Effects
- **Sepia**: Classic sepia tone (0 to 100)
- **Vintage Film**: Old film look with grain and vignette
- **Film Grain**: Add film grain texture (0 to 100)

### Cinematic Effects
- **Dramatic**: High contrast dramatic look
- **Cinematic**: Movie-like appearance
- **Vignette**: Darken edges (0 to 100)

### Distortion Effects
- **Blur**: Soft blur effect (0 to 20px)
- **Pixelate**: Pixelation effect (0 to 50)

## Feature Flag System

### Enabling Effects

The effects system is disabled by default for safety. To enable:

#### Method 1: Browser Console (Development)
```javascript
// Enable effects
window.qcutFeatures.toggle('VIDEO_EFFECTS', true);

// Check status
window.qcutFeatures.list();

// Disable effects
window.qcutFeatures.toggle('VIDEO_EFFECTS', false);
```

#### Method 2: Code Configuration
Edit `src/config/features.ts`:
```typescript
VIDEO_EFFECTS: {
  enabled: true, // Change to true
  ...
}
```

#### Method 3: Environment Variable (Future)
```bash
VITE_ENABLE_VIDEO_EFFECTS=true npm run dev
```

## Usage Guide

### Applying Effects to Timeline Elements

1. **Enable the Feature**
   - Use one of the methods above to enable VIDEO_EFFECTS

2. **Select an Element**
   - Click on any video or image element in the timeline

3. **Open Effects Panel**
   - Navigate to the "Effects" tab in the media panel
   - Browse available effect presets by category

4. **Apply an Effect**
   - Click on any effect preset to apply it to the selected element
   - The effect will be immediately visible in the preview

5. **Adjust Parameters**
   - Open the Properties panel
   - Fine-tune effect parameters using sliders
   - Toggle effects on/off with the switch

6. **Stack Multiple Effects**
   - Apply multiple effects to the same element
   - Effects are combined in the order they were added
   - Use the duplicate button to create variations

### Timeline Visualization

When effects are enabled, a purple indicator bar appears below affected elements in the timeline, making it easy to see which elements have effects applied.

## Performance Considerations

### Preview Performance
- Effects are applied using CSS filters in real-time
- Performance depends on GPU capabilities
- Complex effects may impact preview smoothness

### Export Performance
- Effects are rendered to canvas during export
- Processing time increases by approximately 10-20% with effects
- Multiple effects on the same element may compound processing time

### Optimization Tips
1. Limit the number of simultaneous effects
2. Disable effects during timeline editing if performance is impacted
3. Use simpler effects (brightness, contrast) for better performance
4. Consider pre-rendering heavily effected segments

## Technical Implementation

### CSS Filter Mapping
Effects are converted to CSS filters for preview:
```javascript
brightness(1.2) contrast(1.3) saturate(1.5) ...
```

### Canvas Rendering
During export, effects are applied to the canvas context:
```javascript
ctx.filter = "brightness(1.2) contrast(1.3)";
ctx.drawImage(video, x, y, width, height);
```

### Type Safety
Effects use TypeScript module augmentation to extend timeline elements:
```typescript
declare module "@/types/timeline" {
  interface BaseTimelineElement {
    effectIds?: string[];
  }
}
```

## Troubleshooting

### Effects Not Showing
1. Check if VIDEO_EFFECTS feature is enabled
2. Verify element selection in timeline
3. Ensure effect parameters are within valid ranges
4. Check browser console for errors

### Performance Issues
1. Reduce number of active effects
2. Lower preview quality settings
3. Close other applications to free GPU resources
4. Consider upgrading graphics drivers

### Export Issues
1. Verify effects are enabled before export
2. Check export logs for effect-related errors
3. Try exporting without effects as baseline
4. Report issues with specific effect combinations

## API Reference

### Effects Store Methods

```typescript
// Apply effect to element
applyEffect(elementId: string, preset: EffectPreset): void

// Remove effect from element
removeEffect(elementId: string, effectId: string): void

// Update effect parameters
updateEffectParameters(
  elementId: string, 
  effectId: string, 
  parameters: EffectParameters
): void

// Toggle effect enabled state
toggleEffect(elementId: string, effectId: string): void

// Clear all effects from element
clearEffects(elementId: string): void

// Get effects for element
getElementEffects(elementId: string): EffectInstance[]
```

### Timeline Store Methods

```typescript
// Add effect ID to timeline element
addEffectToElement(elementId: string, effectId: string): void

// Remove effect ID from timeline element
removeEffectFromElement(elementId: string, effectId: string): void

// Get effect IDs for element
getElementEffectIds(elementId: string): string[] | undefined

// Clear all effect IDs from element
clearElementEffects(elementId: string): void
```

## Development Guide

### Adding New Effects

1. **Define the Effect Type**
   Add to `src/types/effects.ts`:
   ```typescript
   export type EffectType = 
     | "existing"
     | "neweffect"; // Add here
   ```

2. **Create Effect Preset**
   Add to `EFFECT_PRESETS` in `effects-store.ts`:
   ```typescript
   {
     id: "new-effect",
     name: "New Effect",
     description: "Description",
     category: "category",
     icon: "🎨",
     parameters: { newParam: 50 }
   }
   ```

3. **Implement CSS Filter Conversion**
   Update `parametersToCSSFilters` in `effects-utils.ts`:
   ```typescript
   if (parameters.newParam !== undefined) {
     filters.push(`new-filter(${parameters.newParam})`);
   }
   ```

4. **Add UI Controls**
   Update `effects-properties.tsx` to include parameter controls

### Testing Effects

1. **Unit Tests** (Future)
   ```typescript
   describe('Effects System', () => {
     test('applies brightness effect', () => {
       // Test implementation
     });
   });
   ```

2. **Integration Tests**
   - Apply effect via UI
   - Verify preview updates
   - Export and verify output

3. **Performance Tests**
   - Measure frame rate with effects
   - Compare export times
   - Monitor memory usage

## Future Enhancements

### Planned Features
1. **Custom Effect Creation** - User-defined effect combinations
2. **Effect Keyframing** - Animate effect parameters over time
3. **Effect Templates** - Save and share effect combinations
4. **GPU Acceleration** - WebGL-based effect rendering
5. **Effect Preview Gallery** - Visual effect browser
6. **Batch Effect Application** - Apply to multiple elements
7. **Effect Transitions** - Smooth effect parameter changes

### Performance Improvements
1. **Effect Caching** - Cache rendered frames with effects
2. **Worker Thread Rendering** - Offload effect processing
3. **Progressive Rendering** - Apply effects in passes
4. **Smart Effect Batching** - Combine similar effects

## Support and Feedback

For issues, questions, or feature requests related to the effects system:
1. Check this documentation first
2. Review existing issues on GitHub
3. Create a new issue with the `effects` label
4. Include system specs and reproduction steps

## License and Credits

The effects system is part of QCut and follows the same license.
CSS filter implementation inspired by modern web standards.
Special thanks to contributors who helped design and test the system.