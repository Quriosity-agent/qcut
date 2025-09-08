import type { EffectParameters, EffectInstance } from "@/types/effects";
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
  type: string;
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
        type: "color",
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
        type: "enhancement",
        parameters: {
          sharpen: 30,
        },
        order: 2,
      },
      {
        name: "Vignette",
        type: "enhancement",
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
        type: "color",
        parameters: {
          contrast: 15,
          saturation: -10,
        },
        order: 1,
      },
      {
        name: "Slight Grain",
        type: "enhancement",
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
        type: "color",
        parameters: {
          warm: 15,
          saturation: 10,
        },
        order: 1,
      },
      {
        name: "Soft Focus",
        type: "enhancement",
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
        type: "enhancement",
        parameters: {
          blur: 2,
          brightness: 15,
        },
        order: 1,
        blendMode: "screen",
      },
      {
        name: "Color Shift",
        type: "color",
        parameters: {
          hue: 20,
          saturation: 30,
        },
        order: 2,
      },
      {
        name: "Vignette",
        type: "enhancement",
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
        type: "color",
        parameters: {
          saturation: 80,
          contrast: 40,
        },
        order: 1,
      },
      {
        name: "Blue Shift",
        type: "color",
        parameters: {
          cool: 60,
        },
        order: 2,
      },
      {
        name: "Edge Glow",
        type: "enhancement",
        parameters: {
          edge: 30,
        },
        order: 3,
      },
      {
        name: "Grain",
        type: "enhancement",
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
        type: "color",
        parameters: {
          contrast: 70,
          saturation: 60,
        },
        order: 1,
      },
      {
        name: "Halftone",
        type: "artistic",
        parameters: {
          halftone: 50,
          dotSize: 3,
        },
        order: 2,
      },
      {
        name: "Edge Detection",
        type: "enhancement",
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
        type: "color",
        parameters: {
          vintage: 70,
          warm: 30,
        },
        order: 1,
      },
      {
        name: "Film Grain",
        type: "enhancement",
        parameters: {
          grain: 40,
        },
        order: 2,
      },
      {
        name: "Vignette",
        type: "enhancement",
        parameters: {
          vignette: 50,
        },
        order: 3,
      },
      {
        name: "Slight Blur",
        type: "enhancement",
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
        type: "color",
        parameters: {
          grayscale: 100,
        },
        order: 1,
      },
      {
        name: "High Contrast",
        type: "color",
        parameters: {
          contrast: 50,
          brightness: -10,
        },
        order: 2,
      },
      {
        name: "Film Grain",
        type: "enhancement",
        parameters: {
          grain: 30,
        },
        order: 3,
      },
      {
        name: "Vignette",
        type: "enhancement",
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
        type: "color",
        parameters: {
          saturation: -20,
          contrast: -15,
        },
        order: 1,
      },
      {
        name: "Scan Lines",
        type: "distortion",
        parameters: {
          wave: 5,
          waveFrequency: 50,
          waveAmplitude: 2,
        },
        order: 2,
      },
      {
        name: "Static Noise",
        type: "enhancement",
        parameters: {
          grain: 35,
        },
        order: 3,
      },
      {
        name: "Color Shift",
        type: "color",
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
        type: "color",
        parameters: {
          saturation: 25,
          contrast: 20,
          brightness: 10,
        },
        order: 1,
      },
      {
        name: "Subtle Warmth",
        type: "color",
        parameters: {
          warm: 10,
        },
        order: 2,
      },
      {
        name: "Slight Vignette",
        type: "enhancement",
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
        type: "color",
        parameters: {
          saturation: -30,
        },
        order: 1,
      },
      {
        name: "Lift Shadows",
        type: "color",
        parameters: {
          brightness: 15,
          contrast: -10,
        },
        order: 2,
      },
      {
        name: "Cool Tone",
        type: "color",
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
        type: "color",
        parameters: {
          contrast: 15,
          saturation: 15,
        },
        order: 1,
      },
      {
        name: "Sharpening",
        type: "enhancement",
        parameters: {
          sharpen: 25,
        },
        order: 2,
      },
      {
        name: "Slight Grain",
        type: "enhancement",
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

/**
 * Apply template to create effect instances
 */
export function applyTemplate(template: EffectTemplate): EffectInstance[] {
  return template.effects.map((effect) => ({
    id: generateUUID(),
    name: effect.name,
    effectType: effect.type as any,
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
      type: effect.effectType,
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
    localStorage.setItem("effect-templates-custom", JSON.stringify(savedTemplates));
  } catch {
    // Silently fail if localStorage is unavailable (quota, private mode, SSR)
  }
  
  return template;
}

/**
 * Load custom templates from localStorage
 */
export function loadCustomTemplates(): EffectTemplate[] {
  try {
    const saved = localStorage.getItem("effect-templates-custom");
    if (saved) {
      return JSON.parse(saved);
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
 * Import template from JSON
 */
export function importTemplate(json: string): EffectTemplate | null {
  try {
    const candidate = JSON.parse(json) as any;
    if (
      candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      Array.isArray(candidate.effects) &&
      candidate.effects.every((e: any) => 
        e && 
        typeof e.name === 'string' &&
        typeof e.type === 'string' &&
        typeof e.order === 'number' &&
        e.parameters && typeof e.parameters === 'object'
      )
    ) {
      // Ensure required fields and proper types
      return {
        id: candidate.id,
        name: candidate.name,
        description: candidate.description || '',
        category: candidate.category || 'custom',
        effects: candidate.effects,
        thumbnail: candidate.thumbnail,
        metadata: candidate.metadata
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