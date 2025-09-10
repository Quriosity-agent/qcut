import type {
  EffectParameters,
  EffectInstance,
  EffectType,
} from "@/types/effects";
import { generateUUID } from "@/lib/utils";

/**
 * Effect Templates System
 * Pre-configured effect combinations for common use cases
 */

export interface EffectTemplate {
  id: string;
  name: string;
  description: string;
  category: "professional" | "creative" | "vintage" | "modern" | "custom";
  thumbnail?: string;
  effects: TemplateEffect[];
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
    createdAt?: Date;
    updatedAt?: Date;
  };
}

export interface TemplateEffect {
  name: string;
  effectType: string;
  parameters: EffectParameters;
  order: number;
  blendMode?: string;
}

// Professional Templates
const PROFESSIONAL_TEMPLATES: EffectTemplate[] = [
  {
    id: "broadcast-quality",
    name: "Broadcast Quality",
    description: "Professional broadcast-ready color correction",
    category: "professional",
    effects: [
      {
        name: "Color Correction",
        effectType: "color",
        parameters: {
          brightness: 5,
          contrast: 10,
          saturation: -5,
          gamma: 1.1,
        },
        order: 1,
      },
      {
        name: "Sharpening",
        effectType: "enhancement",
        parameters: {
          sharpen: 30,
        },
        order: 2,
      },
      {
        name: "Vignette",
        effectType: "enhancement",
        parameters: {
          vignette: 20,
        },
        order: 3,
      },
    ],
  },
  {
    id: "documentary-style",
    name: "Documentary Style",
    description: "Clean, neutral look for documentaries",
    category: "professional",
    effects: [
      {
        name: "Neutral Grade",
        effectType: "color",
        parameters: {
          contrast: 15,
          saturation: -10,
        },
        order: 1,
      },
      {
        name: "Slight Grain",
        effectType: "enhancement",
        parameters: {
          grain: 10,
        },
        order: 2,
      },
    ],
  },
  {
    id: "interview-enhance",
    name: "Interview Enhancement",
    description: "Optimized for talking head interviews",
    category: "professional",
    effects: [
      {
        name: "Skin Tone Correction",
        effectType: "color",
        parameters: {
          warm: 15,
          saturation: 10,
        },
        order: 1,
      },
      {
        name: "Soft Focus",
        effectType: "enhancement",
        parameters: {
          blur: 0.5,
          sharpen: 20,
        },
        order: 2,
      },
    ],
  },
];

// Creative Templates
const CREATIVE_TEMPLATES: EffectTemplate[] = [
  {
    id: "dreamscape",
    name: "Dreamscape",
    description: "Ethereal, dreamy atmosphere",
    category: "creative",
    effects: [
      {
        name: "Soft Glow",
        effectType: "enhancement",
        parameters: {
          blur: 2,
          brightness: 15,
        },
        order: 1,
        blendMode: "screen",
      },
      {
        name: "Color Shift",
        effectType: "color",
        parameters: {
          hue: 20,
          saturation: 30,
        },
        order: 2,
      },
      {
        name: "Vignette",
        effectType: "enhancement",
        parameters: {
          vignette: 40,
        },
        order: 3,
      },
    ],
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon-lit futuristic look",
    category: "creative",
    effects: [
      {
        name: "Neon Colors",
        effectType: "color",
        parameters: {
          saturation: 80,
          contrast: 40,
        },
        order: 1,
      },
      {
        name: "Blue Shift",
        effectType: "color",
        parameters: {
          cool: 60,
        },
        order: 2,
      },
      {
        name: "Edge Glow",
        effectType: "enhancement",
        parameters: {
          edge: 30,
        },
        order: 3,
      },
      {
        name: "Grain",
        effectType: "enhancement",
        parameters: {
          grain: 25,
        },
        order: 4,
      },
    ],
  },
  {
    id: "comic-book",
    name: "Comic Book",
    description: "Bold, graphic novel style",
    category: "creative",
    effects: [
      {
        name: "High Contrast",
        effectType: "color",
        parameters: {
          contrast: 70,
          saturation: 60,
        },
        order: 1,
      },
      {
        name: "Halftone",
        effectType: "artistic",
        parameters: {
          halftone: 50,
          dotSize: 3,
        },
        order: 2,
      },
      {
        name: "Edge Detection",
        effectType: "enhancement",
        parameters: {
          edge: 50,
        },
        order: 3,
      },
    ],
  },
];

// Vintage Templates
const VINTAGE_TEMPLATES: EffectTemplate[] = [
  {
    id: "super8",
    name: "Super 8",
    description: "Authentic Super 8 film look",
    category: "vintage",
    effects: [
      {
        name: "Film Color",
        effectType: "color",
        parameters: {
          vintage: 70,
          warm: 30,
        },
        order: 1,
      },
      {
        name: "Film Grain",
        effectType: "enhancement",
        parameters: {
          grain: 40,
        },
        order: 2,
      },
      {
        name: "Vignette",
        effectType: "enhancement",
        parameters: {
          vignette: 50,
        },
        order: 3,
      },
      {
        name: "Slight Blur",
        effectType: "enhancement",
        parameters: {
          blur: 0.8,
        },
        order: 4,
      },
    ],
  },
  {
    id: "noir",
    name: "Film Noir",
    description: "Classic black and white film noir",
    category: "vintage",
    effects: [
      {
        name: "Black & White",
        effectType: "color",
        parameters: {
          grayscale: 100,
        },
        order: 1,
      },
      {
        name: "High Contrast",
        effectType: "color",
        parameters: {
          contrast: 50,
          brightness: -10,
        },
        order: 2,
      },
      {
        name: "Film Grain",
        effectType: "enhancement",
        parameters: {
          grain: 30,
        },
        order: 3,
      },
      {
        name: "Vignette",
        effectType: "enhancement",
        parameters: {
          vignette: 60,
        },
        order: 4,
      },
    ],
  },
  {
    id: "vhs",
    name: "VHS Tape",
    description: "Retro VHS tape aesthetic",
    category: "vintage",
    effects: [
      {
        name: "Color Bleed",
        effectType: "color",
        parameters: {
          saturation: -20,
          contrast: -15,
        },
        order: 1,
      },
      {
        name: "Scan Lines",
        effectType: "distortion",
        parameters: {
          wave: 5,
          waveFrequency: 50,
          waveAmplitude: 2,
        },
        order: 2,
      },
      {
        name: "Static Noise",
        effectType: "enhancement",
        parameters: {
          grain: 35,
        },
        order: 3,
      },
      {
        name: "Color Shift",
        effectType: "color",
        parameters: {
          hue: 5,
        },
        order: 4,
      },
    ],
  },
];

// Modern Templates
const MODERN_TEMPLATES: EffectTemplate[] = [
  {
    id: "instagram-ready",
    name: "Instagram Ready",
    description: "Optimized for social media",
    category: "modern",
    effects: [
      {
        name: "Pop Colors",
        effectType: "color",
        parameters: {
          saturation: 25,
          contrast: 20,
          brightness: 10,
        },
        order: 1,
      },
      {
        name: "Subtle Warmth",
        effectType: "color",
        parameters: {
          warm: 10,
        },
        order: 2,
      },
      {
        name: "Slight Vignette",
        effectType: "enhancement",
        parameters: {
          vignette: 15,
        },
        order: 3,
      },
    ],
  },
  {
    id: "minimal-clean",
    name: "Minimal Clean",
    description: "Clean, minimal aesthetic",
    category: "modern",
    effects: [
      {
        name: "Desaturate",
        effectType: "color",
        parameters: {
          saturation: -30,
        },
        order: 1,
      },
      {
        name: "Lift Shadows",
        effectType: "color",
        parameters: {
          brightness: 15,
          contrast: -10,
        },
        order: 2,
      },
      {
        name: "Cool Tone",
        effectType: "color",
        parameters: {
          cool: 20,
        },
        order: 3,
      },
    ],
  },
  {
    id: "youtube-optimized",
    name: "YouTube Optimized",
    description: "Optimized for YouTube compression",
    category: "modern",
    effects: [
      {
        name: "Compression Ready",
        effectType: "color",
        parameters: {
          contrast: 15,
          saturation: 15,
        },
        order: 1,
      },
      {
        name: "Sharpening",
        effectType: "enhancement",
        parameters: {
          sharpen: 25,
        },
        order: 2,
      },
      {
        name: "Slight Grain",
        effectType: "enhancement",
        parameters: {
          grain: 5,
        },
        order: 3,
      },
    ],
  },
];

// All templates combined
export const EFFECT_TEMPLATES: EffectTemplate[] = [
  ...PROFESSIONAL_TEMPLATES,
  ...CREATIVE_TEMPLATES,
  ...VINTAGE_TEMPLATES,
  ...MODERN_TEMPLATES,
];

// Helper: derive EffectType from provided parameters
const PARAM_TO_TYPE: ReadonlyArray<[keyof EffectParameters, EffectType]> = [
  ["brightness", "brightness"],
  ["contrast", "contrast"],
  ["saturation", "saturation"],
  ["hue", "hue"],
  ["gamma", "gamma"],
  ["sepia", "sepia"],
  ["grayscale", "grayscale"],
  ["invert", "invert"],
  ["vintage", "vintage"],
  ["dramatic", "dramatic"],
  ["warm", "warm"],
  ["cool", "cool"],
  ["cinematic", "cinematic"],
  ["vignette", "vignette"],
  ["grain", "grain"],
  ["sharpen", "sharpen"],
  ["emboss", "emboss"],
  ["edge", "edge"],
  ["pixelate", "pixelate"],
  ["wave", "wave"],
  ["waveFrequency", "wave"],
  ["waveAmplitude", "wave"],
  ["twist", "twist"],
  ["twistAngle", "twist"],
  ["bulge", "bulge"],
  ["bulgeRadius", "bulge"],
  ["fisheye", "fisheye"],
  ["fisheyeStrength", "fisheye"],
  ["oilPainting", "oil-painting"],
  ["brushSize", "oil-painting"],
  ["watercolor", "watercolor"],
  ["wetness", "watercolor"],
  ["pencilSketch", "pencil-sketch"],
  ["strokeWidth", "pencil-sketch"],
  ["halftone", "halftone"],
  ["dotSize", "halftone"],
  ["fadeIn", "fade-in"],
  ["fadeOut", "fade-out"],
  ["dissolve", "dissolve"],
  ["dissolveProgress", "dissolve"],
  ["wipe", "wipe"],
  ["wipeDirection", "wipe"],
  ["wipeProgress", "wipe"],
  ["overlay", "overlay"],
  ["overlayOpacity", "overlay"],
  ["multiply", "multiply"],
  ["screen", "screen"],
  ["colorDodge", "color-dodge"],
  ["blendMode", "overlay"],
];

function inferEffectTypeFromParams(params: EffectParameters): EffectType {
  for (const [k, t] of PARAM_TO_TYPE) {
    if (params[k] !== undefined) return t;
  }
  return "brightness";
}

/**
 * Apply template to create effect instances
 */
export function applyTemplate(template: EffectTemplate): EffectInstance[] {
  return template.effects.map((effect) => ({
    id: generateUUID(),
    name: effect.name,
    effectType: inferEffectTypeFromParams(effect.parameters),
    parameters: effect.parameters,
    duration: 0,
    enabled: true,
  }));
}

/**
 * Save custom template
 */
export function saveCustomTemplate(
  name: string,
  description: string,
  effects: EffectInstance[]
): EffectTemplate {
  const template: EffectTemplate = {
    id: generateUUID(),
    name,
    description,
    category: "custom",
    effects: effects.map((effect, index) => ({
      name: effect.name,
      effectType: effect.effectType,
      parameters: effect.parameters,
      order: index + 1,
    })),
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  // Save to localStorage
  const savedTemplates = loadCustomTemplates();
  savedTemplates.push(template);
  try {
    localStorage.setItem(
      "effect-templates-custom",
      JSON.stringify(savedTemplates)
    );
  } catch {
    // Silently fail if localStorage is unavailable (quota, private mode, SSR)
  }

  return template;
}

function normalizeTemplate(t: any): EffectTemplate {
  const meta = t?.metadata ?? {};
  const toDate = (v: unknown) =>
    v instanceof Date ? v : typeof v === "string" ? new Date(v) : undefined;
  return {
    ...t,
    metadata: {
      ...meta,
      createdAt: toDate(meta.createdAt),
      updatedAt: toDate(meta.updatedAt),
    },
  } as EffectTemplate;
}

/**
 * Load custom templates from localStorage
 */
export function loadCustomTemplates(): EffectTemplate[] {
  try {
    const saved = localStorage.getItem("effect-templates-custom");
    if (saved) {
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeTemplate) as EffectTemplate[];
      }
    }
  } catch {
    // Silently fail if localStorage is unavailable or data is corrupted
  }
  return [];
}

/**
 * Delete custom template
 */
export function deleteCustomTemplate(templateId: string): void {
  const templates = loadCustomTemplates();
  const filtered = templates.filter((t) => t.id !== templateId);
  try {
    localStorage.setItem("effect-templates-custom", JSON.stringify(filtered));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Export template as JSON
 */
export function exportTemplate(template: EffectTemplate): string {
  return JSON.stringify(template, null, 2);
}

/**
 * Infer effect type from parameters
 */
function inferEffectType(parameters: EffectParameters): string {
  // Look for the first defined parameter to guess effect type
  if (
    parameters.brightness !== undefined ||
    parameters.contrast !== undefined ||
    parameters.saturation !== undefined ||
    parameters.hue !== undefined
  ) {
    return "color";
  }
  if (parameters.blur !== undefined) return "blur";
  if (
    parameters.sepia !== undefined ||
    parameters.grayscale !== undefined ||
    parameters.invert !== undefined
  ) {
    return "color";
  }
  if (
    parameters.vintage !== undefined ||
    parameters.dramatic !== undefined ||
    parameters.warm !== undefined ||
    parameters.cool !== undefined ||
    parameters.cinematic !== undefined
  ) {
    return "style";
  }
  if (
    parameters.vignette !== undefined ||
    parameters.grain !== undefined ||
    parameters.sharpen !== undefined ||
    parameters.emboss !== undefined
  ) {
    return "enhancement";
  }
  if (
    parameters.wave !== undefined ||
    parameters.twist !== undefined ||
    parameters.bulge !== undefined ||
    parameters.fisheye !== undefined
  ) {
    return "distortion";
  }
  if (
    parameters.oilPainting !== undefined ||
    parameters.watercolor !== undefined ||
    parameters.pencilSketch !== undefined ||
    parameters.halftone !== undefined
  ) {
    return "artistic";
  }
  if (
    parameters.fadeIn !== undefined ||
    parameters.fadeOut !== undefined ||
    parameters.dissolve !== undefined ||
    parameters.wipe !== undefined
  ) {
    return "transition";
  }
  if (
    parameters.overlay !== undefined ||
    parameters.multiply !== undefined ||
    parameters.screen !== undefined ||
    parameters.colorDodge !== undefined
  ) {
    return "composite";
  }
  return "unknown";
}

/**
 * Import template from JSON
 */
export function importTemplate(json: string): EffectTemplate | null {
  try {
    const candidate = JSON.parse(json) as any;
    if (
      candidate &&
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      Array.isArray(candidate.effects) &&
      candidate.effects.every(
        (e: any) =>
          e &&
          typeof e.name === "string" &&
          (typeof e.order === "number" || e.order === undefined) &&
          e.parameters &&
          typeof e.parameters === "object"
      )
    ) {
      // Ensure required fields and proper types
      return {
        id: candidate.id,
        name: candidate.name,
        description: candidate.description || "",
        category: candidate.category || "custom",
        effects: candidate.effects.map((e: any, i: number) => ({
          name: e.name,
          // Support both old 'type' and new 'effectType' fields for backward compatibility
          effectType: e.effectType || e.type || inferEffectType(e.parameters),
          parameters: e.parameters,
          order: typeof e.order === "number" ? e.order : i + 1,
          blendMode: e.blendMode,
        })),
        thumbnail: candidate.thumbnail,
        metadata: candidate.metadata,
      } as EffectTemplate;
    }
  } catch {
    // Silently ignore malformed import
  }
  return null;
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: string): EffectTemplate[] {
  const allTemplates = [...EFFECT_TEMPLATES, ...loadCustomTemplates()];

  if (category === "all") {
    return allTemplates;
  }

  return allTemplates.filter((t) => t.category === category);
}

/**
 * Search templates
 */
export function searchTemplates(query: string): EffectTemplate[] {
  const allTemplates = [...EFFECT_TEMPLATES, ...loadCustomTemplates()];
  const lowerQuery = query.toLowerCase();

  return allTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.metadata?.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
  );
}
