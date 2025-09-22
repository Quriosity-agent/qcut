/**
 * Debug test to understand how effects store works
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEffectsStore } from '../../stores/effects-store';

describe('Debug Effects Store', () => {
  let effectsStore: ReturnType<typeof useEffectsStore.getState>;
  const testElementId = 'test-element-123';

  beforeEach(() => {
    effectsStore = useEffectsStore.getState();
    effectsStore.clearEffects(testElementId);
  });

  it('should understand the effects store structure', () => {
    console.log('Available store methods:', Object.keys(effectsStore));
    console.log('Available presets:', effectsStore.presets?.map(p => ({ id: p.id, name: p.name, parameters: p.parameters })));
  });

  it('should apply grayscale effect and check filter chain', () => {
    // Find the Black & White preset
    const blackWhitePreset = effectsStore.presets?.find(p => p.name === 'Black & White');
    console.log('Black & White preset:', blackWhitePreset);

    if (blackWhitePreset) {
      effectsStore.applyEffect(testElementId, blackWhitePreset);

      console.log('Applied effects:', effectsStore.getElementEffects?.(testElementId));

      const filterChain = effectsStore.getFFmpegFilterChain(testElementId);
      console.log('Generated filter chain:', filterChain);

      expect(filterChain).toContain('hue');
    } else {
      console.log('Available preset names:', effectsStore.presets?.map(p => p.name));
    }
  });
});