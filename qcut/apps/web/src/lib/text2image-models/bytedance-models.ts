import type { Text2ImageModel } from "./types";

export const BYTEDANCE_MODELS: Record<string, Text2ImageModel> = {
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

  // Keep "seeddream" model IDs for internal consistency; the FAL endpoint uses "seedream".
  "seeddream-v4-5": {
    id: "seeddream-v4-5",
    name: "SeedDream v4.5",
    description:
      "ByteDance's latest unified image generation model with up to 4K resolution",
    provider: "ByteDance",
    endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image",

    qualityRating: 5,
    speedRating: 4,

    estimatedCost: "$0.04-0.08",
    costPerImage: 5, // cents

    maxResolution: "4096x4096",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      image_size: "auto_2K",
      max_images: 1,
      num_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
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
          "auto_2K",
          "auto_4K",
        ],
        default: "auto_2K",
        description: "Output image resolution and aspect ratio",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 6,
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
      {
        name: "enable_safety_checker",
        type: "boolean",
        default: true,
        description: "Enable content safety filtering",
      },
    ],

    bestFor: [
      "High-resolution image generation",
      "Commercial content creation",
      "Product photography",
      "Artistic illustrations",
      "Up to 4K output",
    ],

    strengths: [
      "Up to 4K resolution output",
      "Unified generation architecture",
      "Commercial license",
      "No cold starts",
      "Fast generation speed",
    ],

    limitations: [
      "Higher cost for 4K output",
      "May require specific prompt formatting",
    ],
  },

  "seeddream-v4-5-edit": {
    id: "seeddream-v4-5-edit",
    name: "SeedDream v4.5 Edit",
    description:
      "ByteDance's image editing model with multi-image compositing support (up to 10 images)",
    provider: "ByteDance",
    endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4.5/edit",

    qualityRating: 5,
    speedRating: 4,

    estimatedCost: "$0.04-0.08",
    costPerImage: 5, // cents

    maxResolution: "4096x4096",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      image_size: "auto_2K",
      num_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
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
          "auto_2K",
          "auto_4K",
        ],
        default: "auto_2K",
        description: "Output image resolution",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 6,
        default: 1,
        description: "Number of output images",
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
      "Image editing and adjustment",
      "Multi-image compositing",
      "Background replacement",
      "Object manipulation",
      "Style transfer",
    ],

    strengths: [
      "Supports up to 10 input images",
      "Multi-image compositing",
      "Up to 4K output",
      "Unified architecture with generation",
      "Commercial license",
    ],

    limitations: [
      "Requires image upload to FAL",
      "Higher latency for multiple images",
    ],
  },
};
