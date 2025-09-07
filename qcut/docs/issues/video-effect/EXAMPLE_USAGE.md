# Video Effects System - Example Usage

## Quick Start Examples

### Example 1: Apply Brightness Effect to a Video

```javascript
// Enable effects system (run in browser console)
window.qcutFeatures.toggle('VIDEO_EFFECTS', true);

// Get the effects store
const effectsStore = useEffectsStore.getState();

// Apply brightness effect to selected element
const selectedElement = "element-id-123"; // Replace with actual element ID
effectsStore.applyEffect(selectedElement, {
  id: "brightness-increase",
  name: "Brighten",
  description: "Increase brightness",
  category: "basic",
  icon: "☀️",
  parameters: { brightness: 20 }
});
```

### Example 2: Creating a Cinematic Look

```javascript
// Apply multiple effects for cinematic appearance
const elementId = "video-element-456";

// 1. Add cinematic base effect
effectsStore.applyEffect(elementId, {
  id: "cinematic",
  name: "Cinematic",
  description: "Movie-like look",
  category: "cinematic",
  icon: "🎬",
  parameters: { cinematic: 70, vignette: 20 }
});

// 2. Add slight desaturation
effectsStore.applyEffect(elementId, {
  id: "desaturate-slight",
  name: "Muted Colors",
  description: "Slightly muted colors",
  category: "color",
  icon: "🔇",
  parameters: { saturation: -20 }
});

// 3. Increase contrast
effectsStore.applyEffect(elementId, {
  id: "contrast-boost",
  name: "High Contrast",
  description: "Boost contrast",
  category: "basic",
  icon: "◐",
  parameters: { contrast: 25 }
});
```

### Example 3: Vintage Film Look

```javascript
// Create a vintage film appearance
const elementId = "image-element-789";

// Apply vintage film preset
effectsStore.applyEffect(elementId, {
  id: "vintage-film",
  name: "Vintage Film",
  description: "Old film look",
  category: "vintage",
  icon: "🎞️",
  parameters: { 
    vintage: 70, 
    grain: 20, 
    vignette: 30 
  }
});

// Add sepia tone
effectsStore.applyEffect(elementId, {
  id: "sepia",
  name: "Sepia",
  description: "Classic sepia tone",
  category: "vintage",
  icon: "📜",
  parameters: { sepia: 60 }
});
```

## Programmatic Usage

### Setup in Your Component

```typescript
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { isFeatureEnabled } from "@/config/features";

function VideoEditor() {
  const { applyEffect, removeEffect, getElementEffects } = useEffectsStore();
  const { selectedElements } = useTimelineStore();
  
  // Check if effects are enabled
  const effectsEnabled = isFeatureEnabled("VIDEO_EFFECTS");
  
  if (!effectsEnabled) {
    return <div>Effects are disabled. Enable in settings.</div>;
  }
  
  const handleApplyEffect = (preset) => {
    selectedElements.forEach(({ elementId }) => {
      applyEffect(elementId, preset);
    });
  };
  
  return (
    <div>
      <button onClick={() => handleApplyEffect(brightnessPreset)}>
        Apply Brightness
      </button>
    </div>
  );
}
```

### Custom Effect Combinations

```typescript
// Define custom effect combinations
const effectCombinations = {
  "black-and-white-dramatic": [
    { grayscale: 100 },
    { contrast: 40 },
    { brightness: -10 }
  ],
  "warm-sunset": [
    { warm: 60 },
    { saturation: 20 },
    { brightness: 10 },
    { vignette: 25 }
  ],
  "cold-winter": [
    { cool: 70 },
    { saturation: -30 },
    { brightness: 15 },
    { contrast: 10 }
  ],
  "retro-gaming": [
    { pixelate: 8 },
    { saturation: 50 },
    { contrast: 30 }
  ]
};

// Apply combination
function applyEffectCombination(elementId, combinationName) {
  const combination = effectCombinations[combinationName];
  if (!combination) return;
  
  combination.forEach((params, index) => {
    effectsStore.applyEffect(elementId, {
      id: `${combinationName}-${index}`,
      name: combinationName,
      description: "Custom combination",
      category: "custom",
      icon: "✨",
      parameters: params
    });
  });
}
```

### Batch Operations

```typescript
// Apply effects to multiple elements
function applyEffectToAll(effectPreset) {
  const { tracks } = useTimelineStore.getState();
  
  tracks.forEach(track => {
    track.elements.forEach(element => {
      if (element.type === "media" || element.type === "image") {
        effectsStore.applyEffect(element.id, effectPreset);
      }
    });
  });
}

// Remove all effects
function removeAllEffects() {
  const { tracks } = useTimelineStore.getState();
  
  tracks.forEach(track => {
    track.elements.forEach(element => {
      effectsStore.clearEffects(element.id);
    });
  });
}

// Copy effects from one element to another
function copyEffects(sourceElementId, targetElementId) {
  const sourceEffects = effectsStore.getElementEffects(sourceElementId);
  
  sourceEffects.forEach(effect => {
    effectsStore.applyEffect(targetElementId, {
      id: effect.id + "-copy",
      name: effect.name,
      description: "Copied effect",
      category: "custom",
      icon: "📋",
      parameters: effect.parameters
    });
  });
}
```

## UI Integration Examples

### Effect Preset Buttons

```tsx
import { EFFECT_PRESETS } from "@/stores/effects-store";

function EffectPresetButtons() {
  const { applyEffect } = useEffectsStore();
  const { selectedElements } = useTimelineStore();
  
  const popularPresets = EFFECT_PRESETS.filter(preset => 
    ["brightness-increase", "contrast-high", "cinematic", "vintage-film"].includes(preset.id)
  );
  
  return (
    <div className="effect-presets">
      {popularPresets.map(preset => (
        <button
          key={preset.id}
          onClick={() => {
            selectedElements.forEach(({ elementId }) => {
              applyEffect(elementId, preset);
            });
          }}
          className="preset-button"
        >
          <span className="preset-icon">{preset.icon}</span>
          <span className="preset-name">{preset.name}</span>
        </button>
      ))}
    </div>
  );
}
```

### Effect Intensity Slider

```tsx
function EffectIntensitySlider({ elementId, effectId }) {
  const { getElementEffects, updateEffectParameters } = useEffectsStore();
  const effects = getElementEffects(elementId);
  const effect = effects.find(e => e.id === effectId);
  
  if (!effect) return null;
  
  // Get the main parameter for this effect type
  const mainParam = Object.keys(effect.parameters)[0];
  const currentValue = effect.parameters[mainParam];
  
  return (
    <div className="effect-slider">
      <label>{effect.name} Intensity</label>
      <input
        type="range"
        min="-100"
        max="100"
        value={currentValue}
        onChange={(e) => {
          updateEffectParameters(elementId, effectId, {
            [mainParam]: Number(e.target.value)
          });
        }}
      />
      <span>{currentValue}%</span>
    </div>
  );
}
```

### Effect Toggle Switch

```tsx
function EffectToggle({ elementId, effectId }) {
  const { toggleEffect } = useEffectsStore();
  const effects = useEffectsStore(state => state.getElementEffects(elementId));
  const effect = effects.find(e => e.id === effectId);
  
  if (!effect) return null;
  
  return (
    <div className="effect-toggle">
      <span>{effect.name}</span>
      <label className="switch">
        <input
          type="checkbox"
          checked={effect.enabled}
          onChange={() => toggleEffect(elementId, effectId)}
        />
        <span className="slider"></span>
      </label>
    </div>
  );
}
```

## Testing Effects

### Console Commands for Testing

```javascript
// List all available features
window.qcutFeatures.list();

// Enable effects
window.qcutFeatures.toggle('VIDEO_EFFECTS', true);

// Get effects store for testing
const store = useEffectsStore.getState();

// Get timeline store to find elements
const timeline = useTimelineStore.getState();

// Find first video element
const firstVideo = timeline.tracks
  .flatMap(t => t.elements)
  .find(e => e.type === "media");

if (firstVideo) {
  // Apply a test effect
  store.applyEffect(firstVideo.id, {
    id: "test-brightness",
    name: "Test Brightness",
    description: "Testing",
    category: "basic",
    icon: "🔆",
    parameters: { brightness: 30 }
  });
  
  // Check if effect was applied
  console.log("Applied effects:", store.getElementEffects(firstVideo.id));
  
  // Update effect parameters
  const effects = store.getElementEffects(firstVideo.id);
  if (effects.length > 0) {
    store.updateEffectParameters(
      firstVideo.id, 
      effects[0].id, 
      { brightness: 50 }
    );
  }
  
  // Remove effect
  setTimeout(() => {
    store.removeEffect(firstVideo.id, effects[0].id);
    console.log("Effect removed");
  }, 5000);
}
```

### Performance Testing

```javascript
// Measure effect application performance
console.time("apply-effects");
for (let i = 0; i < 10; i++) {
  store.applyEffect(elementId, {
    id: `perf-test-${i}`,
    name: `Test ${i}`,
    description: "Performance test",
    category: "basic",
    icon: "⚡",
    parameters: { brightness: Math.random() * 100 - 50 }
  });
}
console.timeEnd("apply-effects");

// Measure render performance
const startTime = performance.now();
// Trigger re-render by updating a parameter
store.updateEffectParameters(elementId, effectId, { brightness: 25 });
requestAnimationFrame(() => {
  const renderTime = performance.now() - startTime;
  console.log(`Render time with effects: ${renderTime}ms`);
});
```

## Common Use Cases

### 1. Color Correction Workflow
```javascript
// Step 1: Analyze the footage
// Step 2: Apply base correction
applyEffect(elementId, brightnessPreset);
applyEffect(elementId, contrastPreset);

// Step 3: Fine-tune colors
updateEffectParameters(elementId, brightnessEffectId, { brightness: 15 });
updateEffectParameters(elementId, contrastEffectId, { contrast: 20 });

// Step 4: Add stylistic touches
applyEffect(elementId, warmFilterPreset);
```

### 2. Batch Processing for Consistency
```javascript
// Get all video elements in a scene
const sceneElements = tracks
  .flatMap(t => t.elements)
  .filter(e => e.startTime >= sceneStart && e.startTime < sceneEnd);

// Apply consistent look
const scenePreset = {
  id: "scene-look",
  name: "Scene Look",
  description: "Consistent scene appearance",
  category: "custom",
  icon: "🎬",
  parameters: { 
    brightness: 5, 
    contrast: 10, 
    saturation: -10 
  }
};

sceneElements.forEach(element => {
  applyEffect(element.id, scenePreset);
});
```

### 3. A/B Testing Different Looks
```javascript
// Save original state
const originalEffects = getElementEffects(elementId);

// Try Look A
clearEffects(elementId);
applyEffect(elementId, cinematicPreset);
// Export or preview...

// Try Look B
clearEffects(elementId);
applyEffect(elementId, vintagePreset);
// Export or preview...

// Restore original
clearEffects(elementId);
originalEffects.forEach(effect => {
  applyEffect(elementId, effect);
});
```

## Troubleshooting Examples

### Debug Effect Application
```javascript
// Enable detailed logging
const originalApply = store.applyEffect;
store.applyEffect = function(elementId, preset) {
  console.log("Applying effect:", { elementId, preset });
  const result = originalApply.call(this, elementId, preset);
  console.log("Current effects:", store.getElementEffects(elementId));
  return result;
};
```

### Verify Effect Rendering
```javascript
// Check if effects are being applied to canvas
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
console.log("Current canvas filter:", ctx.filter);

// Monitor filter changes
const observer = new MutationObserver(() => {
  console.log("Canvas filter changed:", ctx.filter);
});
observer.observe(canvas, { attributes: true });
```

## Best Practices

1. **Start Simple**: Begin with single effects before combining
2. **Test on Short Clips**: Verify effects on small segments first
3. **Monitor Performance**: Check frame rates with complex effects
4. **Save Presets**: Document successful effect combinations
5. **Backup Projects**: Save before applying batch effects
6. **Use Feature Flags**: Keep effects disabled in production until stable