/**
 * Configuration interface for text-to-image AI models.
 * Defines model metadata, capabilities, parameters, and quality characteristics.
 */
export interface Text2ImageModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  endpoint: string;

  // Quality indicators (1-5 scale)
  qualityRating: number;
  speedRating: number;

  // Cost information
  estimatedCost: string;
  costPerImage: number; // in credits/cents

  // Technical specifications
  maxResolution: string;
  supportedAspectRatios: string[];

  // Model-specific parameters
  defaultParams: Record<string, any>;
  availableParams: Array<{
    name: string;
    type: "number" | "string" | "boolean" | "select";
    min?: number;
    max?: number;
    options?: string[];
    default: any;
    description: string;
  }>;

  // Use case recommendations
  bestFor: string[];
  strengths: string[];
  limitations: string[];
}

export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  "imagen4-ultra": {
    id: "imagen4-ultra",
    name: "Imagen4 Ultra",
    description:
      "Google's latest high-quality model with exceptional photorealism",
    provider: "Google",
    endpoint: "https://fal.run/fal-ai/imagen4/preview/ultra",

    qualityRating: 5,
    speedRating: 3,

    estimatedCost: "$0.08-0.12",
    costPerImage: 10, // cents

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      aspect_ratio: "1:1",
      num_images: 1,
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: ["1:1", "4:3", "3:4", "16:9", "9:16"],
        default: "1:1",
        description: "Image aspect ratio",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
    ],

    bestFor: [
      "Photorealistic images",
      "Product photography",
      "Architectural visualization",
      "Nature and landscapes",
      "Portrait photography",
    ],

    strengths: [
      "Exceptional photorealism",
      "Excellent prompt adherence",
      "High detail and clarity",
      "Natural lighting and shadows",
      "Advanced understanding of complex prompts",
    ],

    limitations: [
      "Slower generation time",
      "Higher cost per image",
      "May struggle with highly stylized art",
      "Limited creative interpretation",
    ],
  },

  "seeddream-v3": {
    id: "seeddream-v3",
    name: "SeedDream v3",
    description:
      "ByteDance's creative model optimized for artistic and stylized generation",
    provider: "ByteDance",
    endpoint: "https://fal.run/fal-ai/bytedance/seedream/v3/text-to-image",

    qualityRating: 4,
    speedRating: 5,

    estimatedCost: "$0.03-0.06",
    costPerImage: 4, // cents

    maxResolution: "1536x1536",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      guidance_scale: 2.5,
      num_images: 1,
    },

    availableParams: [
      {
        name: "image_size",
        type: "select",
        options: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
        default: "square_hd",
        description: "Output image resolution and aspect ratio",
      },
      {
        name: "guidance_scale",
        type: "number",
        min: 1,
        max: 10,
        default: 2.5,
        description: "Controls prompt alignment (1-10)",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
      {
        name: "seed",
        type: "number",
        min: 0,
        max: 2_147_483_647,
        default: null,
        description: "Random seed for reproducible results",
      },
    ],

    bestFor: [
      "Artistic illustrations",
      "Concept art and design",
      "Stylized portraits",
      "Creative interpretations",
      "Abstract and surreal art",
    ],

    strengths: [
      "Fast generation speed",
      "Creative and artistic output",
      "Good style transfer capabilities",
      "Cost-effective",
      "Excellent for iterative design",
    ],

    limitations: [
      "Less photorealistic than Imagen4",
      "May over-stylize realistic requests",
      "Lower maximum resolution",
      "Sometimes inconsistent quality",
    ],
  },

  "flux-pro-v11-ultra": {
    id: "flux-pro-v11-ultra",
    name: "FLUX Pro v1.1 Ultra",
    description:
      "Latest FLUX model with enhanced detail and professional versatility",
    provider: "Black Forest Labs",
    endpoint: "https://fal.run/fal-ai/flux-pro/v1.1-ultra",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.05-0.09",
    costPerImage: 7, // cents

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"],

    defaultParams: {
      aspect_ratio: "16:9",
      num_images: 1,
      safety_tolerance: "2",
      enable_safety_checker: true,
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: [
          "21:9",
          "16:9",
          "4:3",
          "3:2",
          "1:1",
          "2:3",
          "3:4",
          "9:16",
          "9:21",
        ],
        default: "16:9",
        description: "Output image aspect ratio",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
      {
        name: "safety_tolerance",
        type: "select",
        options: ["1", "2", "3", "4", "5", "6"],
        default: "2",
        description: "Safety filtering tolerance (1=strict, 6=permissive)",
      },
      {
        name: "enable_safety_checker",
        type: "boolean",
        default: true,
        description: "Enable content safety filtering",
      },
    ],

    bestFor: [
      "Professional content creation",
      "Versatile image generation",
      "Balanced realism and creativity",
      "Commercial applications",
      "High-resolution outputs",
    ],

    strengths: [
      "Excellent balance of quality and speed",
      "Professional-grade output",
      "Versatile across many styles",
      "Good prompt understanding",
      "High maximum resolution",
    ],

    limitations: [
      "Not as creative as SeedDream",
      "Not as photorealistic as Imagen4",
      "Mid-range pricing",
      "May require prompt engineering",
    ],
  },

  "flux-2-flex": {
    id: "flux-2-flex",
    name: "FLUX 2 Flex",
    description:
      "Text-to-image with adjustable inference steps, guidance scale, and enhanced typography",
    provider: "Black Forest Labs",
    endpoint: "https://fal.run/fal-ai/flux-2-flex",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.06/MP",
    costPerImage: 6, // cents per megapixel

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      image_size: "landscape_4_3",
      num_images: 1,
      guidance_scale: 3.5,
      num_inference_steps: 28,
      enable_prompt_expansion: true,
      safety_tolerance: "2",
      enable_safety_checker: true,
      output_format: "jpeg",
      sync_mode: false,
    },

    availableParams: [
      {
        name: "image_size",
        type: "select",
        options: [
          "square_hd",
          "square",
          "portrait_4_3",
          "portrait_16_9",
          "landscape_4_3",
          "landscape_16_9",
        ],
        default: "landscape_4_3",
        description: "Output image size preset",
      },
      {
        name: "guidance_scale",
        type: "number",
        min: 1.5,
        max: 10,
        default: 3.5,
        description: "Controls adherence to prompt",
      },
      {
        name: "num_inference_steps",
        type: "number",
        min: 2,
        max: 50,
        default: 28,
        description: "Number of denoising steps",
      },
      {
        name: "enable_prompt_expansion",
        type: "boolean",
        default: true,
        description: "Auto-expand prompt using model knowledge",
      },
      {
        name: "output_format",
        type: "select",
        options: ["jpeg", "png"],
        default: "jpeg",
        description: "Output image format",
      },
    ],

    bestFor: [
      "Fine-tuned control over generation",
      "Typography and text rendering",
      "Professional content creation",
    ],

    strengths: [
      "Adjustable inference steps for quality/speed tradeoff",
      "Enhanced typography capabilities",
      "Cost-effective per megapixel pricing",
    ],

    limitations: [
      "Pricing scales with resolution",
      "Limited aspect ratio options vs FLUX Pro Ultra",
    ],
  },

  "wan-v2-2": {
    id: "wan-v2-2",
    name: "WAN v2.2",
    description:
      "High-resolution photorealistic model with powerful prompt understanding",
    provider: "fal.ai",
    endpoint: "https://fal.run/fal-ai/wan/v2.2-a14b/text-to-image",

    qualityRating: 5,
    speedRating: 3,

    estimatedCost: "$0.06-0.10",
    costPerImage: 8, // cents

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      num_inference_steps: 27,
      image_size: "square_hd",
      guidance_scale: 3.5,
    },

    availableParams: [
      {
        name: "image_size",
        type: "select",
        options: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
        default: "square_hd",
        description: "Output image resolution and aspect ratio",
      },
      {
        name: "num_inference_steps",
        type: "number",
        min: 10,
        max: 50,
        default: 27,
        description: "Number of inference steps (quality vs. speed trade-off)",
      },
      {
        name: "guidance_scale",
        type: "number",
        min: 1,
        max: 10,
        default: 3.5,
        description: "How closely to follow the prompt (1-10)",
      },
      {
        name: "seed",
        type: "number",
        min: 0,
        max: 2_147_483_647,
        default: null,
        description: "Random seed for reproducible results",
      },
    ],

    bestFor: [
      "High-resolution photorealistic images",
      "Detailed character portraits",
      "Professional photography-style images",
      "Complex scene generation",
      "Commercial content creation",
    ],

    strengths: [
      "Exceptional photorealism",
      "Powerful prompt understanding",
      "High-resolution output",
      "Excellent detail preservation",
      "Good at complex compositions",
    ],

    limitations: [
      "Slower generation time",
      "Higher computational cost",
      "May struggle with highly abstract concepts",
      "Less creative interpretation than artistic models",
    ],
  },

  "qwen-image": {
    id: "qwen-image",
    name: "Qwen Image",
    description:
      "Alibaba's versatile image generation model with excellent prompt understanding",
    provider: "Alibaba",
    endpoint: "https://fal.run/fal-ai/qwen-image",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.04-0.08",
    costPerImage: 6, // cents

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      image_size: "landscape_4_3",
      num_inference_steps: 30,
      guidance_scale: 2.5,
      num_images: 1,
      output_format: "png",
      negative_prompt: " ",
    },

    availableParams: [
      {
        name: "image_size",
        type: "select",
        options: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
        default: "landscape_4_3",
        description: "Output image resolution and aspect ratio",
      },
      {
        name: "num_inference_steps",
        type: "number",
        min: 2,
        max: 50,
        default: 30,
        description: "Number of inference steps (quality vs. speed trade-off)",
      },
      {
        name: "guidance_scale",
        type: "number",
        min: 0,
        max: 20,
        default: 2.5,
        description: "How closely to follow the prompt (0-20)",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
      {
        name: "output_format",
        type: "select",
        options: ["png", "jpeg", "webp"],
        default: "png",
        description: "Output image format",
      },
      {
        name: "negative_prompt",
        type: "string",
        default: " ",
        description: "What to avoid in the generated image",
      },
      {
        name: "seed",
        type: "number",
        min: 0,
        max: 2_147_483_647,
        default: null,
        description: "Random seed for reproducible results",
      },
    ],

    bestFor: [
      "Versatile image generation",
      "Natural scene composition",
      "Character and object generation",
      "Cultural and artistic themes",
      "Balanced realism and creativity",
    ],

    strengths: [
      "Strong prompt understanding",
      "Good balance of speed and quality",
      "Versatile across different styles",
      "Cost-effective generation",
      "Supports negative prompts",
    ],

    limitations: [
      "Not as photorealistic as specialized models",
      "May require prompt engineering for best results",
      "Less detailed than ultra-high-end models",
      "Limited creative interpretation for abstract concepts",
    ],
  },

  // Add new SeedDream V4 model
  "seeddream-v4": {
    id: "seeddream-v4",
    name: "SeedDream v4",
    description:
      "ByteDance's flagship SeedDream v4 text-to-image model with optional multi-image editing and unified architecture",
    provider: "ByteDance",
    endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4/text-to-image",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.04-0.08",
    costPerImage: 5, // cents

    maxResolution: "1536x1536",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      image_size: "square_hd",
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      num_images: 1,
    },

    availableParams: [
      {
        name: "image_size",
        type: "select",
        options: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
        default: "square_hd",
        description: "Output image resolution and aspect ratio",
      },
      {
        name: "max_images",
        type: "number",
        min: 1,
        max: 6,
        default: 1,
        description: "Maximum input images to process",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of output images to generate",
      },
      {
        name: "sync_mode",
        type: "boolean",
        default: false,
        description: "Use synchronous processing mode",
      },
      {
        name: "enable_safety_checker",
        type: "boolean",
        default: true,
        description: "Enable content safety filtering",
      },
      {
        name: "seed",
        type: "number",
        min: 0,
        max: 2_147_483_647,
        default: null,
        description: "Random seed for reproducible results",
      },
    ],

    bestFor: [
      "High-fidelity text-to-image generation",
      "Cinematic concept art with long prompts",
      "Hybrid workflows that mix generation and editing",
      "Advanced content modification pipelines",
    ],

    strengths: [
      "Native text-to-image endpoint with editing flexibility",
      "Processes multiple images simultaneously",
      "Unified generation and editing architecture",
      "Flexible output sizing",
      "Enhanced prompt understanding (5000 chars)",
      "Advanced safety controls",
    ],

    limitations: [
      "Higher complexity than V3",
      "May require more specific prompts",
      "Potentially slower for simple edits",
    ],
  },

  // Add Nano Banana model
  "nano-banana": {
    id: "nano-banana",
    name: "Nano Banana",
    description:
      "Google/Gemini-powered model for fast, cost-effective text-to-image generation with optional editing",
    provider: "Google",
    endpoint: "https://fal.run/fal-ai/nano-banana",

    qualityRating: 4,
    speedRating: 5,

    estimatedCost: "$0.039",
    costPerImage: 3.9, // cents

    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      aspect_ratio: "1:1",
      num_images: 1,
      output_format: "png",
      sync_mode: false,
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: ["1:1", "4:3", "3:4", "16:9", "9:16"],
        default: "1:1",
        description: "Image aspect ratio",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of output images to generate",
      },
      {
        name: "output_format",
        type: "select",
        options: ["jpeg", "png"],
        default: "png",
        description: "Output image format",
      },
      {
        name: "sync_mode",
        type: "boolean",
        default: false,
        description: "Return images as data URIs immediately",
      },
    ],

    bestFor: [
      "Cost-effective image editing",
      "Smart content understanding",
      "Quick image modifications",
      "Format-specific outputs",
    ],

    strengths: [
      "Google/Gemini AI technology",
      "Very cost effective ($0.039/image)",
      "Multiple output formats",
      "Smart contextual understanding",
      "Provides edit descriptions",
    ],

    limitations: [
      "Less advanced than SeedDream V4",
      "No flexible sizing options",
      "Standard prompt length limits",
    ],
  },

  "reve-text-to-image": {
    id: "reve-text-to-image",
    name: "Reve Text-to-Image",
    description:
      "Cost-effective AI image generation with strong aesthetic quality and accurate text rendering",
    provider: "fal.ai",
    endpoint: "https://fal.run/fal-ai/reve/text-to-image",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.04",
    costPerImage: 4, // cents

    maxResolution: "Auto (aspect-ratio dependent)",
    supportedAspectRatios: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"],

    defaultParams: {
      aspect_ratio: "3:2",
      num_images: 1,
      output_format: "png",
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"],
        default: "3:2",
        description: "Output image aspect ratio",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
      {
        name: "output_format",
        type: "select",
        options: ["png", "jpeg", "webp"],
        default: "png",
        description: "Output image format",
      },
    ],

    bestFor: [
      "Cost-effective image generation",
      "Text rendering in images",
      "General-purpose image creation",
      "Aesthetic quality outputs",
      "Multiple aspect ratios",
    ],

    strengths: [
      "Very affordable ($0.04 per image)",
      "Strong aesthetic quality",
      "Accurate text rendering",
      "Flexible aspect ratios (7 options)",
      "Multiple output formats",
      "Fast generation speed",
    ],

    limitations: [
      "Lower resolution than premium models",
      "Limited customization parameters",
      "No guidance scale control",
      "No seed control for reproducibility",
    ],
  },

  "gemini-3-pro": {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    description:
      "Google's state-of-the-art image generation with exceptional photorealism and long prompt support",
    provider: "Google",
    endpoint: "https://fal.run/fal-ai/gemini-3-pro-image-preview",

    qualityRating: 5,
    speedRating: 3,

    estimatedCost: "$0.15-0.30",
    costPerImage: 15, // cents (4K costs 2x)

    maxResolution: "4096x4096",
    supportedAspectRatios: [
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "21:9",
      "9:21",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
    ],

    defaultParams: {
      aspect_ratio: "1:1",
      num_images: 1,
      resolution: "1K",
      output_format: "png",
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: [
          "auto",
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "21:9",
          "9:21",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
        ],
        default: "1:1",
        description: "Image aspect ratio (auto matches input for editing)",
      },
      {
        name: "resolution",
        type: "select",
        options: ["1K", "2K", "4K"],
        default: "1K",
        description: "Output resolution (4K costs 2x)",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of images to generate",
      },
      {
        name: "output_format",
        type: "select",
        options: ["jpeg", "png", "webp"],
        default: "png",
        description: "Output image format",
      },
    ],

    bestFor: [
      "Photorealistic images",
      "Long detailed prompts (up to 50K chars)",
      "High-resolution outputs",
      "Commercial photography",
      "Product visualization",
    ],

    strengths: [
      "Exceptional photorealism (Google's latest)",
      "Supports extremely long prompts (50,000 chars)",
      "Multiple resolution options (1K/2K/4K)",
      "Wide aspect ratio support (11 options)",
      "Consistent quality across styles",
    ],

    limitations: [
      "Higher cost than budget models ($0.15/image)",
      "4K outputs double the cost",
      "Slower generation (quality focus)",
      "No seed control for reproducibility",
    ],
  },
};

// ============================================
// Shared priority order (cheapest ➜ premium)
// ============================================
export const TEXT2IMAGE_MODEL_ORDER = [
  "gemini-3-pro",
  "nano-banana",
  "flux-2-flex",
  "seeddream-v4",
  "reve-text-to-image",
  "wan-v2-2",
  "imagen4-ultra",
  "qwen-image",
  "flux-pro-v11-ultra",
  "seeddream-v3",
] as const;

export type Text2ImageModelId = (typeof TEXT2IMAGE_MODEL_ORDER)[number];

export function getText2ImageModelEntriesInPriorityOrder() {
  return TEXT2IMAGE_MODEL_ORDER.map(
    (modelId) => [modelId, TEXT2IMAGE_MODELS[modelId]] as const
  );
}

// Helper functions
export function getModelById(id: string): Text2ImageModel | undefined {
  return TEXT2IMAGE_MODELS[id];
}

export function getModelsByProvider(provider: string): Text2ImageModel[] {
  return Object.values(TEXT2IMAGE_MODELS).filter(
    (model) => model.provider === provider
  );
}

export function getModelsByQuality(minRating: number): Text2ImageModel[] {
  return Object.values(TEXT2IMAGE_MODELS).filter(
    (model) => model.qualityRating >= minRating
  );
}

export function getModelsBySpeed(minRating: number): Text2ImageModel[] {
  return Object.values(TEXT2IMAGE_MODELS).filter(
    (model) => model.speedRating >= minRating
  );
}

export function getCostRange(): { min: number; max: number } {
  const costs = Object.values(TEXT2IMAGE_MODELS).map((m) => m.costPerImage);
  return {
    min: Math.min(...costs),
    max: Math.max(...costs),
  };
}

export function recommendModelsForPrompt(prompt: string): string[] {
  const lowercasePrompt = prompt.toLowerCase();

  // Simple keyword-based recommendations
  if (
    lowercasePrompt.includes("photo") ||
    lowercasePrompt.includes("realistic") ||
    lowercasePrompt.includes("portrait") ||
    lowercasePrompt.includes("product")
  ) {
    return ["imagen4-ultra", "wan-v2-2", "flux-pro-v11-ultra"];
  }

  if (
    lowercasePrompt.includes("art") ||
    lowercasePrompt.includes("artistic") ||
    lowercasePrompt.includes("style") ||
    lowercasePrompt.includes("creative") ||
    lowercasePrompt.includes("abstract")
  ) {
    return ["seeddream-v3", "qwen-image", "flux-pro-v11-ultra"];
  }

  // Default recommendation for balanced use
  return ["qwen-image", "flux-pro-v11-ultra", "seeddream-v3"];
}

export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"],
  VERSATILE: [
    "qwen-image",
    "flux-pro-v11-ultra",
    "flux-2-flex",
    "nano-banana",
    "reve-text-to-image",
  ],
  FAST: [
    "seeddream-v3",
    "nano-banana",
    "qwen-image",
    "reve-text-to-image",
    "flux-2-flex",
  ],
  HIGH_QUALITY: [
    "imagen4-ultra",
    "wan-v2-2",
    "flux-pro-v11-ultra",
    "flux-2-flex",
    "seeddream-v4",
    "gemini-3-pro",
  ],
  COST_EFFECTIVE: [
    "seeddream-v3",
    "nano-banana",
    "qwen-image",
    "reve-text-to-image",
    "flux-2-flex",
  ],
} as const;
