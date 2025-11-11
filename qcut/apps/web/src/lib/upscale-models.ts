/**
 * Upscale model catalog
 *
 * Mirrors the structure used for text-to-image models so UI and stores share
 * a single source of truth for capabilities, pricing, and supported controls.
 */

export const UPSCALE_MODEL_ORDER = [
  "crystal-upscaler",
  "seedvr-upscale",
  "topaz-upscale",
] as const;

export type UpscaleModelId = (typeof UPSCALE_MODEL_ORDER)[number];

export interface UpscaleModelFeatureFlags {
  denoising: boolean;
  sharpening: boolean;
  creativity?: boolean;
  overlappingTiles?: boolean;
  faceEnhancement?: boolean;
}

export interface UpscaleModelControlConfig {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
  unit?: string;
  description?: string;
  options?: number[];
  type: "slider" | "toggle" | "select";
}

export interface UpscaleModel {
  id: UpscaleModelId;
  name: string;
  description: string;
  provider: string;
  endpoint: string;
  priceTier: "budget" | "mid" | "pro";
  estimatedCost: string;
  costPerImage: number;
  qualityRating: number;
  speedRating: number;
  maxScale: number;
  supportedScales: number[];
  defaultParams: {
    scale_factor: number;
    denoise?: number;
    creativity?: number;
    overlapping_tiles?: boolean;
    output_format: "png" | "jpeg" | "webp";
  };
  features: UpscaleModelFeatureFlags;
  bestFor: string[];
  strengths: string[];
  limitations: string[];
  controls: {
    scaleFactor: UpscaleModelControlConfig;
    denoise?: UpscaleModelControlConfig;
    creativity?: UpscaleModelControlConfig;
    overlappingTiles?: UpscaleModelControlConfig;
  };
}

export const UPSCALE_MODEL_ENDPOINTS: Record<UpscaleModelId, string> = {
  "crystal-upscaler": "fal-ai/crystal-upscaler",
  "seedvr-upscale": "fal-ai/seedvr/upscale/image",
  "topaz-upscale": "fal-ai/topaz/upscale/image",
};

export const UPSCALE_MODELS: Record<UpscaleModelId, UpscaleModel> = {
  "crystal-upscaler": {
    id: "crystal-upscaler",
    name: "Crystal Upscaler",
    description:
      "Balanced denoise and sharpening tuned for social posts and general workflows.",
    provider: "fal.ai",
    endpoint: UPSCALE_MODEL_ENDPOINTS["crystal-upscaler"],
    priceTier: "budget",
    estimatedCost: "$0.02 / image",
    costPerImage: 0.02,
    qualityRating: 3,
    speedRating: 5,
    maxScale: 10,
    supportedScales: [2, 4, 6, 8, 10],
    defaultParams: {
      scale_factor: 4,
      denoise: 0.45,
      output_format: "png",
    },
    features: {
      denoising: true,
      sharpening: true,
    },
    bestFor: ["Social posts", "Marketing graphics", "Quick client previews"],
    strengths: [
      "Great price/performance balance",
      "Fast results (under 20s for 4x in tests)",
      "Predictable color preservation",
    ],
    limitations: [
      "Max scale limited to 10x",
      "No creative stylization",
      "No tiling controls",
    ],
    controls: {
      scaleFactor: {
        type: "select",
        label: "Scale Factor",
        options: [2, 4, 6, 8, 10],
        default: 4,
        description: "Select the upscale multiplier",
      },
      denoise: {
        type: "slider",
        label: "Denoise",
        min: 0,
        max: 100,
        step: 1,
        default: 45,
        unit: "%",
        description: "Reduce noise while preserving detail",
      },
    },
  },
  "seedvr-upscale": {
    id: "seedvr-upscale",
    name: "SeedVR Upscale",
    description:
      "Creative-focused upscaler capable of hallucinating new detail up to 16x.",
    provider: "SeedVR Labs",
    endpoint: UPSCALE_MODEL_ENDPOINTS["seedvr-upscale"],
    priceTier: "mid",
    estimatedCost: "$0.05 / image",
    costPerImage: 0.05,
    qualityRating: 4,
    speedRating: 4,
    maxScale: 16,
    supportedScales: [2, 4, 8, 12, 16],
    defaultParams: {
      scale_factor: 6,
      denoise: 0.35,
      creativity: 0.4,
      output_format: "png",
    },
    features: {
      denoising: true,
      sharpening: true,
      creativity: true,
    },
    bestFor: [
      "Illustrations",
      "Stylized renders",
      "Faces that need extra detail",
    ],
    strengths: [
      "Creativity slider adds tasteful variation",
      "Up to 16x upscale support",
      "Great for stylized or painterly work",
    ],
    limitations: [
      "Can hallucinate unwanted details at high creativity",
      "Slightly slower than Crystal Upscaler",
      "No overlapping tile control",
    ],
    controls: {
      scaleFactor: {
        type: "select",
        label: "Scale Factor",
        options: [2, 4, 8, 12, 16],
        default: 6,
        description: "Upscale multiplier (SeedVR supports up to 16x)",
      },
      denoise: {
        type: "slider",
        label: "Denoise",
        min: 0,
        max: 100,
        step: 1,
        default: 35,
        unit: "%",
        description: "Lower values keep more original texture",
      },
      creativity: {
        type: "slider",
        label: "Creativity",
        min: 0,
        max: 100,
        step: 1,
        default: 40,
        unit: "%",
        description: "Increase for more imaginative detail synthesis",
      },
    },
  },
  "topaz-upscale": {
    id: "topaz-upscale",
    name: "Topaz Upscale",
    description:
      "Professional upscaler with overlapping tile controls for artifact-free 16x output.",
    provider: "Topaz Labs",
    endpoint: UPSCALE_MODEL_ENDPOINTS["topaz-upscale"],
    priceTier: "pro",
    estimatedCost: "$0.10 / image",
    costPerImage: 0.1,
    qualityRating: 5,
    speedRating: 3,
    maxScale: 16,
    supportedScales: [2, 4, 6, 8, 12, 16],
    defaultParams: {
      scale_factor: 6,
      denoise: 0.25,
      overlapping_tiles: true,
      output_format: "png",
    },
    features: {
      denoising: true,
      sharpening: true,
      overlappingTiles: true,
      faceEnhancement: true,
    },
    bestFor: ["Print-ready artwork", "Portrait photography", "Product renders"],
    strengths: [
      "Tile overlap avoids seam artifacts",
      "Face detection reduces smoothing",
      "Consistent results for production",
    ],
    limitations: [
      "Highest cost per image",
      "Slightly slower at 16x",
      "Creativity slider not available",
    ],
    controls: {
      scaleFactor: {
        type: "select",
        label: "Scale Factor",
        options: [2, 4, 6, 8, 12, 16],
        default: 6,
        description: "Best quality between 4x and 8x",
      },
      denoise: {
        type: "slider",
        label: "Denoise",
        min: 0,
        max: 100,
        step: 1,
        default: 25,
        unit: "%",
        description: "Higher values smooth fine grain",
      },
      overlappingTiles: {
        type: "toggle",
        label: "Overlapping Tiles",
        default: true,
        description: "Reduces seams by processing tiles with overlap",
      },
    },
  },
};

export function getUpscaleModelEntriesInPriorityOrder() {
  return UPSCALE_MODEL_ORDER.map(
    (modelId) => [modelId, UPSCALE_MODELS[modelId]] as const
  );
}
