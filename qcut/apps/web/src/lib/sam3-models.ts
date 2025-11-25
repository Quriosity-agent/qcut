/**
 * SAM-3 Model Catalog
 *
 * Single source of truth for SAM-3 model configuration.
 * Follows upscale-models.ts pattern for consistency.
 *
 * @module Sam3Models
 */

export const SAM3_MODEL_INFO = {
  id: "sam-3",
  name: "SAM-3 (Segment Anything 3)",
  description:
    "Meta's state-of-the-art image segmentation model with text, point, and box prompts",
  provider: "fal.ai (Meta)",
  endpoint: "fal-ai/sam-3/image",

  priceTier: "budget" as const,
  estimatedCost: "$0.005 / request",
  costPerRequest: 0.005,

  qualityRating: 5,
  speedRating: 4,

  features: {
    textPrompt: true,
    pointPrompt: true,
    boxPrompt: true,
    multipleMasks: true,
    confidenceScores: true,
    boundingBoxes: true,
  },

  bestFor: [
    "Object isolation",
    "Background removal",
    "Interactive selection",
    "Batch segmentation",
  ],

  strengths: [
    "Extremely cost-effective ($0.005/request)",
    "Multiple prompt types (text, point, box)",
    "Returns multiple mask options",
    "Confidence scores for quality assessment",
  ],

  limitations: [
    "Requires clear object boundaries",
    "May struggle with heavily occluded objects",
    "Text prompts work best for common objects",
  ],

  defaultParams: {
    apply_mask: true,
    sync_mode: false,
    output_format: "png" as const,
    return_multiple_masks: false,
    max_masks: 3,
    include_scores: false,
    include_boxes: false,
  },
} as const;

export type Sam3ModelInfo = typeof SAM3_MODEL_INFO;

/**
 * Get default parameters for SAM-3 requests
 */
export function getSam3DefaultParams() {
  return { ...SAM3_MODEL_INFO.defaultParams };
}
