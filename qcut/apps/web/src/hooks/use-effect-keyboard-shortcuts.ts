"use client";

import { useEffect, useRef } from "react";
import { useActionHandler } from "@/constants/actions";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { toast } from "sonner";
import { EFFECTS_ENABLED } from "@/config/features";
import type { EffectParameters } from "@/types/effects";
import {
  PARAMETER_RANGES,
  getParameterRange,
  type NumericParameterKey,
} from "@/constants/effect-parameter-ranges";

export const useEffectKeyboardShortcuts = () => {
  const isActive = useRef(true);
  const {
    applyEffect,
    toggleEffect,
    resetEffectParameters,
    duplicateEffect,
    activeEffects,
    updateEffectParameters,
  } = useEffectsStore();
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
          parameters: { brightness: 20 },
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
          parameters: { contrast: 30 },
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
          parameters: { saturation: 30 },
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
          parameters: { blur: 3 },
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
  // Uses parameter-aware ranges for safe value clamping
  useActionHandler(
    "increase-effect-intensity",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          const effect = effects[0];

          // Find first numeric parameter
          const paramKeys = Object.keys(effect.parameters) as Array<
            keyof EffectParameters
          >;
          const firstNumericParam = paramKeys.find(
            (key) => typeof effect.parameters[key] === "number"
          );

          if (firstNumericParam) {
            const currentValue = effect.parameters[firstNumericParam] as number;
            const range = getParameterRange(firstNumericParam);
            const newValue = Math.min(range.max, currentValue + range.step);

            updateEffectParameters(elementId, effect.id, {
              [firstNumericParam]: newValue,
            } as Partial<EffectParameters>);
            toast.success(
              `${String(firstNumericParam)} increased to ${newValue}`
            );
          }
        }
      }
    },
    isActive
  );

  // Decrease effect intensity (Shift+Minus)
  // Uses parameter-aware ranges for safe value clamping (mirrors increase logic)
  useActionHandler(
    "decrease-effect-intensity",
    () => {
      const elementId = getSelectedElement();
      if (elementId) {
        const effects = activeEffects.get(elementId);
        if (effects && effects.length > 0) {
          const effect = effects[0];

          // Find first numeric parameter
          const paramKeys = Object.keys(effect.parameters) as Array<
            keyof EffectParameters
          >;
          const firstNumericParam = paramKeys.find(
            (key) => typeof effect.parameters[key] === "number"
          );

          if (firstNumericParam) {
            const currentValue = effect.parameters[firstNumericParam] as number;
            const range = getParameterRange(firstNumericParam);
            const newValue = Math.max(range.min, currentValue - range.step);

            updateEffectParameters(elementId, effect.id, {
              [firstNumericParam]: newValue,
            } as Partial<EffectParameters>);
            toast.success(
              `${String(firstNumericParam)} decreased to ${newValue}`
            );
          }
        }
      }
    },
    isActive
  );
};
