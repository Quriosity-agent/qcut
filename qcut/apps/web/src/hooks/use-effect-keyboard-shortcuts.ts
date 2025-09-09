"use client";

import { useEffect, useRef } from "react";
import { useActionHandler } from "@/constants/actions";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { toast } from "sonner";
import { EFFECTS_ENABLED } from "@/config/features";
import type { EffectParameters } from "@/types/effects";

// Parameter ranges configuration
const PARAMETER_RANGES: Record<keyof EffectParameters, { min: number; max: number; step: number }> = {
  // Transform parameters
  opacity: { min: 0, max: 100, step: 10 },
  scale: { min: 0, max: 500, step: 10 },
  rotate: { min: -360, max: 360, step: 15 },
  skewX: { min: -45, max: 45, step: 5 },
  skewY: { min: -45, max: 45, step: 5 },
  
  // Basic parameters
  brightness: { min: -100, max: 100, step: 10 },
  contrast: { min: -100, max: 100, step: 10 },
  saturation: { min: -100, max: 200, step: 10 },
  hue: { min: 0, max: 360, step: 10 },
  gamma: { min: 0.1, max: 5, step: 0.1 },
  
  // Blur parameters
  blur: { min: 0, max: 20, step: 1 },
  blurType: { min: 0, max: 2, step: 1 }, // Representing enum index
  
  // Color effects
  sepia: { min: 0, max: 100, step: 10 },
  grayscale: { min: 0, max: 100, step: 10 },
  invert: { min: 0, max: 100, step: 10 },
  
  // Style effects
  vintage: { min: 0, max: 100, step: 10 },
  dramatic: { min: 0, max: 100, step: 10 },
  warm: { min: 0, max: 100, step: 10 },
  cool: { min: 0, max: 100, step: 10 },
  cinematic: { min: 0, max: 100, step: 10 },
  
  // Enhancement effects
  vignette: { min: 0, max: 100, step: 10 },
  grain: { min: 0, max: 100, step: 10 },
  sharpen: { min: 0, max: 100, step: 10 },
  emboss: { min: 0, max: 100, step: 10 },
  edge: { min: 0, max: 100, step: 10 },
  pixelate: { min: 1, max: 50, step: 5 },
  
  // Distortion effects
  wave: { min: 0, max: 100, step: 10 },
  waveFrequency: { min: 1, max: 20, step: 1 },
  waveAmplitude: { min: 0, max: 50, step: 5 },
  twist: { min: 0, max: 360, step: 15 },
  twistAngle: { min: 0, max: 360, step: 15 },
  bulge: { min: -100, max: 100, step: 10 },
  bulgeRadius: { min: 0, max: 500, step: 25 },
  fisheye: { min: 0, max: 100, step: 10 },
  fisheyeStrength: { min: 0, max: 100, step: 10 },
  ripple: { min: 0, max: 100, step: 10 },
  swirl: { min: 0, max: 360, step: 15 },
  
  // Artistic effects
  oilPainting: { min: 0, max: 100, step: 10 },
  brushSize: { min: 1, max: 50, step: 2 },
  watercolor: { min: 0, max: 100, step: 10 },
  wetness: { min: 0, max: 100, step: 10 },
  pencilSketch: { min: 0, max: 100, step: 10 },
  strokeWidth: { min: 1, max: 20, step: 1 },
  halftone: { min: 0, max: 100, step: 10 },
  dotSize: { min: 1, max: 20, step: 1 },
  
  // Transition effects
  fadeIn: { min: 0, max: 100, step: 10 },
  fadeOut: { min: 0, max: 100, step: 10 },
  dissolve: { min: 0, max: 100, step: 10 },
  dissolveProgress: { min: 0, max: 100, step: 10 },
  wipe: { min: 0, max: 100, step: 10 },
  wipeDirection: { min: 0, max: 3, step: 1 }, // Representing enum index  
  wipeProgress: { min: 0, max: 100, step: 10 },
  
  // Composite effects
  overlay: { min: 0, max: 100, step: 10 },
  overlayOpacity: { min: 0, max: 100, step: 10 },
  multiply: { min: 0, max: 100, step: 10 },
  screen: { min: 0, max: 100, step: 10 },
  colorDodge: { min: 0, max: 100, step: 10 },
  blendMode: { min: 0, max: 7, step: 1 }, // Representing enum index
} as const;

export const useEffectKeyboardShortcuts = () => {
  const isActive = useRef(true);
  const { applyEffect, toggleEffect, resetEffectParameters, duplicateEffect, activeEffects, updateEffectParameters } = useEffectsStore();
  const { selectedElements } = useTimelineStore();

  // Helper function to get selected element
  const getSelectedElement = () => {
    if (!EFFECTS_ENABLED) return null;
    if (selectedElements.length === 0) {
      toast.error("No element selected");
      return null;
    }
    return selectedElements[0]?.elementId;
  };

  // Apply brightness effect (Alt+B)
  useActionHandler(
    "apply-brightness-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        applyEffect(elementId, {
          id: "brightness-increase",
          name: "Brightness",
          description: "Increase brightness",
          category: "basic",
          icon: "🔆",
          parameters: { brightness: 20 }
        });
        toast.success("Brightness effect applied");
      }
    },
    isActive
  );

  // Apply contrast effect (Alt+C)
  useActionHandler(
    "apply-contrast-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        applyEffect(elementId, {
          id: "contrast-high",
          name: "Contrast",
          description: "Increase contrast",
          category: "basic",
          icon: "🎭",
          parameters: { contrast: 30 }
        });
        toast.success("Contrast effect applied");
      }
    },
    isActive
  );

  // Apply saturation effect (Alt+S)
  useActionHandler(
    "apply-saturation-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        applyEffect(elementId, {
          id: "saturation-boost",
          name: "Saturation",
          description: "Boost color saturation",
          category: "color",
          icon: "🎨",
          parameters: { saturation: 30 }
        });
        toast.success("Saturation effect applied");
      }
    },
    isActive
  );

  // Apply blur effect (Alt+U)
  useActionHandler(
    "apply-blur-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        applyEffect(elementId, {
          id: "blur-soft",
          name: "Soft Blur",
          description: "Apply soft blur effect",
          category: "basic",
          icon: "🌫️",
          parameters: { blur: 3 }
        });
        toast.success("Blur effect applied");
      }
    },
    isActive
  );

  // Toggle selected effect (Alt+E)
  useActionHandler(
    "toggle-selected-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          toggleEffect(elementId, effects[0].id);
          toast.success("Effect toggled");
        } else {
          toast.error("No effects to toggle");
        }
      }
    },
    isActive
  );

  // Reset effect parameters (Alt+R)
  useActionHandler(
    "reset-effect-parameters",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          resetEffectParameters(elementId, effects[0].id);
          toast.success("Effect parameters reset");
        }
      }
    },
    isActive
  );

  // Duplicate effect (Alt+D)
  useActionHandler(
    "duplicate-effect",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          duplicateEffect(elementId, effects[0].id);
          toast.success("Effect duplicated");
        } else {
          toast.error("No effects to duplicate");
        }
      }
    },
    isActive
  );

  // Increase effect intensity (Shift+Plus)
  useActionHandler(
    "increase-effect-intensity",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          const effect = effects[0];
          
          // Find first numeric parameter
          const paramKeys = Object.keys(effect.parameters) as (keyof EffectParameters)[];
          const firstNumericParam = paramKeys.find(key => typeof effect.parameters[key] === 'number');
          
          if (firstNumericParam) {
            const currentValue = effect.parameters[firstNumericParam] as number;
            const range = PARAMETER_RANGES[firstNumericParam] || { min: -100, max: 100, step: 10 };
            const newValue = Math.min(range.max, currentValue + range.step);
            
            updateEffectParameters(
              elementId,
              effect.id,
              { [firstNumericParam]: newValue } as Partial<EffectParameters>
            );
            toast.success(`${String(firstNumericParam)} increased to ${newValue}`);
          }
        }
      }
    },
    isActive
  );

  // Decrease effect intensity (Shift+Minus)
  useActionHandler(
    "decrease-effect-intensity",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          const effect = effects[0];
          
          // Find first numeric parameter
          const paramKeys = Object.keys(effect.parameters) as (keyof EffectParameters)[];
          const firstNumericParam = paramKeys.find(key => typeof effect.parameters[key] === 'number');
          
          if (firstNumericParam) {
            const currentValue = effect.parameters[firstNumericParam] as number;
            const range = PARAMETER_RANGES[firstNumericParam] || { min: -100, max: 100, step: 10 };
            const newValue = Math.max(range.min, currentValue - range.step);
            
            updateEffectParameters(
              elementId,
              effect.id,
              { [firstNumericParam]: newValue } as Partial<EffectParameters>
            );
            toast.success(`${String(firstNumericParam)} decreased to ${newValue}`);
          }
        }
      }
    },
    isActive
  );
};