import { create } from "zustand";
import { toast } from "sonner";
import { generateUUID } from "@/lib/utils";
import type {
  EffectPreset,
  EffectCategory,
  EffectParameters,
  EffectInstance,
  EffectType,
} from "@/types/effects";

// Feature flag - disabled by default for safety
export const EFFECTS_ENABLED = false;

// Predefined effect presets
const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: "brightness-increase",
    name: "Brighten",
    description: "Increase brightness",
    category: "basic",
    icon: "☀️",
    parameters: { brightness: 20 },
  },
  {
    id: "brightness-decrease",
    name: "Darken",
    description: "Decrease brightness",
    category: "basic",
    icon: "🌙",
    parameters: { brightness: -20 },
  },
  {
    id: "contrast-high",
    name: "High Contrast",
    description: "Increase contrast",
    category: "basic",
    icon: "◐",
    parameters: { contrast: 30 },
  },
  {
    id: "saturation-boost",
    name: "Vibrant",
    description: "Boost color saturation",
    category: "color",
    icon: "🎨",
    parameters: { saturation: 40 },
  },
  {
    id: "desaturate",
    name: "Muted",
    description: "Reduce color saturation",
    category: "color",
    icon: "🔇",
    parameters: { saturation: -30 },
  },
  {
    id: "sepia",
    name: "Sepia",
    description: "Classic sepia tone",
    category: "vintage",
    icon: "📜",
    parameters: { sepia: 80 },
  },
  {
    id: "grayscale",
    name: "Black & White",
    description: "Convert to grayscale",
    category: "artistic",
    icon: "⚫",
    parameters: { grayscale: 100 },
  },
  {
    id: "vintage-film",
    name: "Vintage Film",
    description: "Old film look",
    category: "vintage",
    icon: "🎞️",
    parameters: { vintage: 70, grain: 20, vignette: 30 },
  },
  {
    id: "dramatic",
    name: "Dramatic",
    description: "High drama effect",
    category: "cinematic",
    icon: "🎭",
    parameters: { dramatic: 60, contrast: 20 },
  },
  {
    id: "warm-filter",
    name: "Warm",
    description: "Warm color tone",
    category: "color",
    icon: "🔥",
    parameters: { warm: 50 },
  },
  {
    id: "cool-filter",
    name: "Cool",
    description: "Cool color tone",
    category: "color",
    icon: "❄️",
    parameters: { cool: 50 },
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Movie-like look",
    category: "cinematic",
    icon: "🎬",
    parameters: { cinematic: 70, vignette: 20 },
  },
  {
    id: "blur-soft",
    name: "Soft Blur",
    description: "Gentle blur effect",
    category: "distortion",
    icon: "🌫️",
    parameters: { blur: 2 },
  },
  {
    id: "sharpen",
    name: "Sharpen",
    description: "Enhance edges",
    category: "basic",
    icon: "🔪",
    parameters: { sharpen: 50 },
  },
  {
    id: "emboss",
    name: "Emboss",
    description: "3D emboss effect",
    category: "artistic",
    icon: "🏔️",
    parameters: { emboss: 70 },
  },
  {
    id: "edge-detect",
    name: "Edge Detection",
    description: "Highlight edges",
    category: "artistic",
    icon: "📐",
    parameters: { edge: 80 },
  },
  {
    id: "pixelate",
    name: "Pixelate",
    description: "Pixelation effect",
    category: "distortion",
    icon: "🧩",
    parameters: { pixelate: 10 },
  },
  {
    id: "vignette",
    name: "Vignette",
    description: "Darken edges",
    category: "cinematic",
    icon: "⭕",
    parameters: { vignette: 50 },
  },
  {
    id: "grain",
    name: "Film Grain",
    description: "Add film grain",
    category: "vintage",
    icon: "🌾",
    parameters: { grain: 30 },
  },
  {
    id: "invert",
    name: "Invert",
    description: "Invert colors",
    category: "artistic",
    icon: "🔄",
    parameters: { invert: 100 },
  },
];

interface EffectsStore {
  presets: EffectPreset[];
  activeEffects: Map<string, EffectInstance[]>; // elementId -> effects
  selectedCategory: EffectCategory | "all";
  selectedEffect: EffectInstance | null;
  
  // Actions
  applyEffect: (elementId: string, preset: EffectPreset) => void;
  removeEffect: (elementId: string, effectId: string) => void;
  updateEffectParameters: (elementId: string, effectId: string, parameters: EffectParameters) => void;
  toggleEffect: (elementId: string, effectId: string) => void;
  clearEffects: (elementId: string) => void;
  setSelectedCategory: (category: EffectCategory | "all") => void;
  setSelectedEffect: (effect: EffectInstance | null) => void;
  getElementEffects: (elementId: string) => EffectInstance[];
  duplicateEffect: (elementId: string, effectId: string) => void;
}

export const useEffectsStore = create<EffectsStore>((set, get) => ({
  presets: EFFECT_PRESETS,
  activeEffects: new Map(),
  selectedCategory: "all",
  selectedEffect: null,

  applyEffect: (elementId, preset) => {
    if (!EFFECTS_ENABLED) {
      toast.error("Effects are currently disabled");
      return;
    }

    const newEffect: EffectInstance = {
      id: generateUUID(),
      name: preset.name,
      effectType: preset.parameters.brightness ? "brightness" :
                  preset.parameters.contrast ? "contrast" :
                  preset.parameters.saturation ? "saturation" :
                  preset.parameters.sepia ? "sepia" :
                  preset.parameters.grayscale ? "grayscale" :
                  preset.parameters.vintage ? "vintage" :
                  preset.parameters.dramatic ? "dramatic" :
                  preset.parameters.warm ? "warm" :
                  preset.parameters.cool ? "cool" :
                  preset.parameters.cinematic ? "cinematic" :
                  preset.parameters.blur ? "blur" :
                  preset.parameters.sharpen ? "sharpen" :
                  preset.parameters.emboss ? "emboss" :
                  preset.parameters.edge ? "edge" :
                  preset.parameters.pixelate ? "pixelate" :
                  preset.parameters.vignette ? "vignette" :
                  preset.parameters.grain ? "grain" :
                  preset.parameters.invert ? "invert" : "brightness",
      parameters: { ...preset.parameters },
      duration: 0, // Will be set based on element duration
      enabled: true,
    };

    set((state) => {
      const effects = state.activeEffects.get(elementId) || [];
      const newMap = new Map(state.activeEffects);
      newMap.set(elementId, [...effects, newEffect]);
      return { activeEffects: newMap };
    });

    toast.success(`Applied ${preset.name} effect`);
  },

  removeEffect: (elementId, effectId) => {
    set((state) => {
      const effects = state.activeEffects.get(elementId) || [];
      const newEffects = effects.filter(e => e.id !== effectId);
      const newMap = new Map(state.activeEffects);
      
      if (newEffects.length === 0) {
        newMap.delete(elementId);
      } else {
        newMap.set(elementId, newEffects);
      }
      
      return { activeEffects: newMap };
    });
    
    toast.info("Effect removed");
  },

  updateEffectParameters: (elementId, effectId, parameters) => {
    set((state) => {
      const effects = state.activeEffects.get(elementId) || [];
      const newEffects = effects.map(e => 
        e.id === effectId 
          ? { ...e, parameters: { ...e.parameters, ...parameters } }
          : e
      );
      const newMap = new Map(state.activeEffects);
      newMap.set(elementId, newEffects);
      return { activeEffects: newMap };
    });
  },

  toggleEffect: (elementId, effectId) => {
    set((state) => {
      const effects = state.activeEffects.get(elementId) || [];
      const newEffects = effects.map(e => 
        e.id === effectId 
          ? { ...e, enabled: !e.enabled }
          : e
      );
      const newMap = new Map(state.activeEffects);
      newMap.set(elementId, newEffects);
      return { activeEffects: newMap };
    });
  },

  clearEffects: (elementId) => {
    set((state) => {
      const newMap = new Map(state.activeEffects);
      newMap.delete(elementId);
      return { activeEffects: newMap };
    });
    
    toast.info("All effects cleared");
  },

  setSelectedCategory: (category) => {
    set({ selectedCategory: category });
  },

  setSelectedEffect: (effect) => {
    set({ selectedEffect: effect });
  },

  getElementEffects: (elementId) => {
    return get().activeEffects.get(elementId) || [];
  },

  duplicateEffect: (elementId, effectId) => {
    const effects = get().activeEffects.get(elementId) || [];
    const effectToDuplicate = effects.find(e => e.id === effectId);
    
    if (effectToDuplicate) {
      const duplicatedEffect: EffectInstance = {
        ...effectToDuplicate,
        id: generateUUID(),
        name: `${effectToDuplicate.name} (Copy)`,
      };
      
      set((state) => {
        const newEffects = [...effects, duplicatedEffect];
        const newMap = new Map(state.activeEffects);
        newMap.set(elementId, newEffects);
        return { activeEffects: newMap };
      });
      
      toast.success("Effect duplicated");
    }
  },
}));