/**
 * Defines the capabilities and constraints for an AI image generation model.
 */
export interface ModelCapability {
  multiImage: boolean;
  flexibleSizing: boolean;
  enhancedPrompts: boolean;
  outputFormats: string[];
  maxImages: number;
  sizeOptions: string[];
  pricing?: { perImage: number; currency: string };
}

/**
 * Returns the capabilities for a given AI model.
 * @param modelId - The unique identifier of the AI model
 * @returns ModelCapability object describing the model's features and constraints
 */
export function getModelCapabilities(modelId: string): ModelCapability {
  switch (modelId) {
    case "seededit":
    case "seeddream-v3":
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1,
        sizeOptions: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
    case "seeddream-v4":
      return {
        multiImage: true,
        flexibleSizing: true,
        enhancedPrompts: true,
        outputFormats: ["PNG"],
        maxImages: 6,
        sizeOptions: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
    case "nano-banana":
      return {
        multiImage: true,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["JPEG", "PNG"],
        maxImages: 10,
        sizeOptions: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
        pricing: { perImage: 0.039, currency: "USD" },
      };
    case "flux-kontext":
    case "flux-kontext-max":
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1,
        sizeOptions: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
    case "flux-2-flex-edit":
      return {
        multiImage: false,
        flexibleSizing: true,
        enhancedPrompts: true,
        outputFormats: ["JPEG", "PNG"],
        maxImages: 1,
        sizeOptions: [
          "auto",
          "square_hd",
          "square",
          "portrait_4_3",
          "portrait_16_9",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
    default:
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1,
        sizeOptions: [
          "square_hd",
          "square",
          "portrait_3_4",
          "portrait_9_16",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
  }
}

/**
 * Determines if switching between two AI models is allowed.
 * @param fromModel - The current model identifier
 * @param toModel - The target model identifier
 * @param currentParams - Current generation parameters
 * @returns true if model switching is allowed
 */
export function canSwitchModels(
  fromModel: string,
  toModel: string,
  currentParams: CommonParams
): boolean {
  // Allow switching between any models - parameters will be converted appropriately
  // V3 users can always upgrade to V4/Nano Banana
  // V4/Nano Banana users can downgrade to V3 (with parameter compatibility warnings)
  return true;
}

type CommonParams = Partial<{
  prompt: string;
  numImages: number;
  num_images: number;
  guidanceScale: number;
  guidance_scale: number;
  steps: number;
  num_inference_steps: number;
  seed: number;
  safetyTolerance: number;
  safety_tolerance: number;
  image_urls: string[];
  outputFormat: "JPEG" | "PNG";
  imageSize: string | number; // Support both preset strings and custom numbers
  maxImages: number;
}>;

/**
 * Converts generation parameters when switching between AI models.
 * Handles parameter name differences and validates values against target model constraints.
 * @param params - Current generation parameters
 * @param fromModel - Source model identifier
 * @param toModel - Target model identifier
 * @returns Converted parameters compatible with the target model
 */
export function convertParametersBetweenModels(
  params: CommonParams,
  fromModel: string,
  toModel: string
): Record<string, unknown> {
  // Handle parameter conversion when switching models
  const baseParams = {
    prompt: params.prompt || "",
    numImages: Math.min(
      params.numImages || params.num_images || 1,
      getModelCapabilities(toModel).maxImages
    ),
  };

  if (toModel === "nano-banana") {
    return {
      ...baseParams,
      outputFormat:
        params.outputFormat === "JPEG" || params.outputFormat === "PNG"
          ? params.outputFormat
          : "PNG",
      syncMode: false,
      image_urls: params.image_urls || [],
    };
  }

  if (toModel === "seeddream-v4") {
    return {
      ...baseParams,
      imageSize: "square_hd",
      maxImages: 1,
      syncMode: false,
      enableSafetyChecker: true,
      image_urls: params.image_urls || [],
    };
  }

  if (toModel === "flux-2-flex-edit") {
    return {
      ...baseParams,
      outputFormat:
        params.outputFormat === "JPEG" || params.outputFormat === "PNG"
          ? params.outputFormat
          : "JPEG",
      syncMode: false,
      image_urls: params.image_urls || [],
      guidanceScale: params.guidanceScale || params.guidance_scale || 3.5,
      steps: params.steps || params.num_inference_steps || 28,
    };
  }

  // Converting to V3 or other models - keep only compatible parameters
  return {
    prompt: params.prompt || "",
    numImages: params.numImages || params.num_images || 1,
    guidanceScale: params.guidanceScale || params.guidance_scale || 1.0,
    steps: params.steps || params.num_inference_steps || 20,
    seed: params.seed,
    safetyTolerance: params.safetyTolerance || params.safety_tolerance || 2,
  };
}

/**
 * Categorization of AI models by their primary use cases and characteristics.
 */
export const modelCategories = {
  stable: ["seededit", "seeddream-v3", "flux-kontext", "flux-2-flex-edit"],
  advanced: ["seeddream-v4", "flux-kontext-max"],
  smart: ["nano-banana"],
  cost_effective: ["nano-banana", "seeddream-v3", "flux-2-flex-edit"],
  high_quality: ["seeddream-v4", "flux-kontext-max"],
};

/**
 * Returns the recommended AI model for a specific use case.
 * @param useCase - The primary goal: "speed", "quality", "features", or "cost"
 * @returns The model identifier best suited for the use case
 */
export function getRecommendedModel(
  useCase: "speed" | "quality" | "features" | "cost"
) {
  switch (useCase) {
    case "speed":
      return "seeddream-v3"; // Fastest, proven
    case "quality":
      return "seeddream-v4"; // Best features
    case "features":
      return "seeddream-v4"; // Most capabilities
    case "cost":
      return "nano-banana"; // Cost effective
    default:
      return "seeddream-v3"; // Safe default
  }
}

/**
 * Returns human-readable display information for a model.
 * @param modelId - The AI model identifier
 * @returns Object containing name, description, badge, technology, and feature list
 */
export function getModelDisplayInfo(modelId: string) {
  const capabilities = getModelCapabilities(modelId);

  switch (modelId) {
    case "seededit":
      return {
        name: "SeedEdit v3",
        description: "Stable, proven image editing",
        badge: "Stable",
        technology: "ByteDance",
        features: [
          "Photo retouching",
          "Object modification",
          "Realistic edits",
        ],
      };
    case "seeddream-v3":
      return {
        name: "SeedDream v3",
        description: "Creative artistic generation",
        badge: "Stable",
        technology: "ByteDance",
        features: [
          "Artistic illustrations",
          "Fast generation",
          "Creative output",
        ],
      };
    case "seeddream-v4":
      return {
        name: "SeedDream v4",
        description: "Advanced multi-image editing",
        badge: "Advanced",
        technology: "ByteDance V4",
        features: [
          "Multi-image processing",
          "Flexible sizing",
          "Enhanced prompts",
        ],
      };
    case "nano-banana":
      return {
        name: "Nano Banana",
        description: "Smart AI-powered editing",
        badge: "Smart",
        technology: "Google/Gemini",
        features: ["Smart understanding", "Cost effective", "Multiple formats"],
      };
    case "flux-kontext":
      return {
        name: "FLUX Pro Kontext",
        description: "Context-aware editing",
        badge: "Professional",
        technology: "FLUX",
        features: [
          "Style changes",
          "Scene modification",
          "Professional quality",
        ],
      };
    case "flux-kontext-max":
      return {
        name: "FLUX Pro Kontext Max",
        description: "Advanced professional editing",
        badge: "Premium",
        technology: "FLUX",
        features: ["Complex edits", "Typography", "Maximum quality"],
      };
    case "flux-2-flex-edit":
      return {
        name: "FLUX 2 Flex Edit",
        description: "Flexible editing with fine control",
        badge: "Versatile",
        technology: "FLUX 2",
        features: ["Auto sizing", "Prompt expansion", "Adjustable steps"],
      };
    default:
      return {
        name: modelId,
        description: "Unknown model",
        badge: "Unknown",
        technology: "Unknown",
        features: [],
      };
  }
}

/**
 * Validates model parameters against model-specific constraints
 * @param modelId - The AI model identifier
 * @param params - Parameters to validate
 * @returns Array of validation error messages
 */
export function validateModelParameters(
  modelId: string,
  params: CommonParams
): string[] {
  const errors: string[] = [];

  if (modelId === "seeddream-v4") {
    // Validate image size - supports both preset strings and custom numbers
    if (params.imageSize) {
      const validPresets = [
        "square_hd",
        "square",
        "portrait_3_4",
        "portrait_9_16",
        "landscape_4_3",
        "landscape_16_9",
      ];

      if (typeof params.imageSize === "string") {
        // String preset validation
        if (!validPresets.includes(params.imageSize)) {
          errors.push(
            `Image size preset must be one of: ${validPresets.join(", ")}`
          );
        }
      } else if (typeof params.imageSize === "number") {
        // Custom numeric size validation
        if (params.imageSize < 1024 || params.imageSize > 4096) {
          errors.push(
            "Custom image size must be between 1024-4096px for SeedDream V4"
          );
        }
      } else {
        errors.push(
          "Image size must be a valid preset string or number between 1024-4096"
        );
      }
    }

    // Validate max images count (corrected from 10 to 6 based on capabilities)
    if (params.maxImages && (params.maxImages < 1 || params.maxImages > 6)) {
      errors.push("Max images must be between 1-6 for SeedDream V4");
    }

    // Validate prompt length
    if (params.prompt && params.prompt.length > 5000) {
      errors.push("Prompt must be under 5000 characters for SeedDream V4");
    }
  }

  if (modelId === "nano-banana") {
    if (params.outputFormat && !["JPEG", "PNG"].includes(params.outputFormat)) {
      errors.push("Output format must be JPEG or PNG for Nano Banana");
    }
    if (params.numImages && (params.numImages < 1 || params.numImages > 4)) {
      errors.push("Number of images must be between 1-4 for Nano Banana");
    }
  }

  if (modelId === "flux-2-flex-edit") {
    if (params.outputFormat && !["JPEG", "PNG"].includes(params.outputFormat)) {
      errors.push("Output format must be JPEG or PNG for FLUX 2 Flex Edit");
    }
    if (params.numImages && (params.numImages < 1 || params.numImages > 4)) {
      errors.push("Number of images must be between 1-4 for FLUX 2 Flex Edit");
    }
  }

  return errors;
}

/**
 * Suggests an alternative model based on prompt content analysis.
 * @param prompt - The user's generation prompt
 * @param currentModel - The currently selected model
 * @returns A suggested model identifier, or null if current model is optimal
 */
export function getModelSuggestion(
  prompt: string,
  currentModel: string
): string | null {
  const lowercasePrompt = prompt.toLowerCase();

  // Suggest V4 for complex multi-object prompts
  if (
    (lowercasePrompt.includes("multiple") ||
      lowercasePrompt.includes("several") ||
      lowercasePrompt.includes("many") ||
      lowercasePrompt.split("and").length > 3) &&
    currentModel !== "seeddream-v4"
  ) {
    return "seeddream-v4"; // Better for complex multi-element scenes
  }

  // Suggest Nano Banana for cost-conscious users
  if (
    (lowercasePrompt.includes("simple") ||
      lowercasePrompt.includes("quick") ||
      lowercasePrompt.includes("basic")) &&
    currentModel !== "nano-banana"
  ) {
    return "nano-banana"; // More cost effective for simple edits
  }

  // Suggest V3 for traditional photo editing
  if (
    (lowercasePrompt.includes("photo") ||
      lowercasePrompt.includes("realistic") ||
      lowercasePrompt.includes("portrait")) &&
    currentModel !== "seededit" &&
    currentModel !== "seeddream-v3"
  ) {
    return "seededit"; // Better for traditional photo editing
  }

  return null; // No suggestion
}
