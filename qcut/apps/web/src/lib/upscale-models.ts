/**
 * Upscale Model Catalog
 *
 * Comprehensive configuration for AI image upscaling models offered by FAL.ai.
 * This module mirrors the structure used for text-to-image models so UI components
 * and stores share a single source of truth for model capabilities, pricing, and
 * supported controls.
 *
 * Each model has distinct characteristics:
 * - **Crystal Upscaler**: Budget-friendly, fast, good for social media
 * - **SeedVR**: Creative upscaling with detail hallucination up to 16x
 * - **Topaz**: Professional-grade with tile overlap for artifact-free results
 *
 * @module UpscaleModels
 */

/**
 * Priority order for upscale models (fastest/cheapest to slowest/most expensive)
 */
export const UPSCALE_MODEL_ORDER = [
  "crystal-upscaler",
  "seedvr-upscale",
  "topaz-upscale",
] as const;

/**
 * Type-safe upscale model identifier
 */
export type UpscaleModelId = (typeof UPSCALE_MODEL_ORDER)[number];

/**
 * Feature flags indicating which upscaling capabilities a model supports
 */
export interface UpscaleModelFeatureFlags {
  /** Whether the model supports noise reduction */
  denoising: boolean;
  /** Whether the model supports sharpening */
  sharpening: boolean;
  /** Whether the model supports creative detail synthesis */
  creativity?: boolean;
  /** Whether the model supports overlapping tile processing to avoid seams */
  overlappingTiles?: boolean;
  /** Whether the model has specialized face enhancement algorithms */
  faceEnhancement?: boolean;
}

/**
 * Configuration for a single upscale control (slider, toggle, or selector)
 *
 * Defines the UI control type, range, default value, and user-facing labels
 * for each adjustable parameter in an upscale model.
 */
export interface UpscaleModelControlConfig {
  /** Display label for the control */
  label: string;
  /** Minimum value (for sliders) */
  min?: number;
  /** Maximum value (for sliders) */
  max?: number;
  /** Step increment (for sliders) */
  step?: number;
  /** Default value for the control */
  default: number | boolean;
  /** Unit label (e.g., "%" or "x") */
  unit?: string;
  /** Tooltip or help text explaining the control */
  description?: string;
  /** Discrete options for select controls */
  options?: number[];
  /** UI control type */
  type: "slider" | "toggle" | "select";
}

/**
 * Complete configuration for an upscale model
 *
 * Includes all information needed to render UI, make API calls, and
 * display pricing/capability information to users.
 */
export interface UpscaleModel {
  /** Unique model identifier */
  id: UpscaleModelId;
  /** Human-readable model name */
  name: string;
  /** Brief description of model capabilities */
  description: string;
  /** Provider/vendor name */
  provider: string;
  /** FAL.ai API endpoint path */
  endpoint: string;
  /** Pricing tier category */
  priceTier: "budget" | "mid" | "pro";
  /** Display string for estimated cost (e.g., "$0.02 / image") */
  estimatedCost: string;
  /** Numeric cost per image for sorting/comparison */
  costPerImage: number;
  /** Quality rating (1-5 scale) */
  qualityRating: number;
  /** Speed rating (1-5 scale, higher = faster) */
  speedRating: number;
  /** Maximum supported scale factor */
  maxScale: number;
  /** Array of all supported scale factors */
  supportedScales: number[];
  /** Default parameter values sent to the API */
  defaultParams: {
    scale_factor: number;
    denoise?: number;
    creativity?: number;
    overlapping_tiles?: boolean;
    output_format: "png" | "jpeg" | "webp";
  };
  /** Feature flags for model capabilities */
  features: UpscaleModelFeatureFlags;
  /** Use cases where this model excels */
  bestFor: string[];
  /** Key advantages of this model */
  strengths: string[];
  /** Known limitations or trade-offs */
  limitations: string[];
  /** UI control configurations for adjustable parameters */
  controls: {
    scaleFactor: UpscaleModelControlConfig;
    denoise?: UpscaleModelControlConfig;
    creativity?: UpscaleModelControlConfig;
    overlappingTiles?: UpscaleModelControlConfig;
  };
}

/**
 * Mapping of model IDs to their FAL.ai API endpoint paths
 */
export const UPSCALE_MODEL_ENDPOINTS: Record<UpscaleModelId, string> = {
  "crystal-upscaler": "fal-ai/crystal-upscaler",
  "seedvr-upscale": "fal-ai/seedvr/upscale/image",
  "topaz-upscale": "fal-ai/topaz/upscale/image",
};

/**
 * Complete catalog of available upscale models with full configuration
 *
 * This is the single source of truth for all upscale model information including:
 * - API endpoints and parameters
 * - Pricing and performance characteristics
 * - UI control configurations
 * - Feature flags and capabilities
 * - Marketing copy (descriptions, strengths, limitations)
 *
 * Used throughout the application by:
 * - UpscaleSettingsPanel for rendering dynamic controls
 * - text2image store for API calls and parameter management
 * - Model selection UIs for displaying options
 *
 * @example
 * ```ts
 * const model = UPSCALE_MODELS['crystal-upscaler'];
 * console.log(model.name); // "Crystal Upscaler"
 * console.log(model.maxScale); // 10
 * console.log(model.features.creativity); // false
 * ```
 */
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
    supportedScales: [2, 4, 6, 8, 12, 16],
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
        options: [2, 4, 6, 8, 12, 16],
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

/**
 * Returns upscale model entries in their defined priority order
 *
 * Creates an array of [modelId, modelConfig] tuples ordered from fastest/most
 * affordable to professional-grade models. Useful for rendering model selection
 * UIs in a consistent order.
 *
 * @returns Array of tuples containing model IDs and their complete configuration
 *
 * @example
 * ```ts
 * const models = getUpscaleModelEntriesInPriorityOrder();
 * models.forEach(([id, config]) => {
 *   console.log(`${config.name}: ${config.estimatedCost}`);
 * });
 * // Output:
 * // Crystal Upscaler: $0.02 / image
 * // SeedVR Upscale: $0.05 / image
 * // Topaz Upscale: $0.10 / image
 * ```
 */
export function getUpscaleModelEntriesInPriorityOrder() {
  return UPSCALE_MODEL_ORDER.map(
    (modelId) => [modelId, UPSCALE_MODELS[modelId]] as const
  );
}
