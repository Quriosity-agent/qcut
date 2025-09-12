export interface ModelCapability {
  multiImage: boolean;
  flexibleSizing: boolean;
  enhancedPrompts: boolean;
  outputFormats: string[];
  maxImages: number;
  sizeOptions: string[];
  pricing?: { perImage: number; currency: string };
}

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
        sizeOptions: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]
      };
    case "seeddream-v4":
      return {
        multiImage: true,
        flexibleSizing: true,
        enhancedPrompts: true,
        outputFormats: ["PNG"],
        maxImages: 10,
        sizeOptions: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]
      };
    case "nano-banana":
      return {
        multiImage: true,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["JPEG", "PNG"],
        maxImages: 10,
        sizeOptions: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
        pricing: { perImage: 0.039, currency: "USD" }
      };
    case "flux-kontext":
    case "flux-kontext-max":
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1,
        sizeOptions: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]
      };
    default:
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1,
        sizeOptions: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]
      };
  }
}

export function canSwitchModels(fromModel: string, toModel: string, currentParams: any): boolean {
  // Allow switching between any models - parameters will be converted appropriately
  // V3 users can always upgrade to V4/Nano Banana
  // V4/Nano Banana users can downgrade to V3 (with parameter compatibility warnings)
  return true;
}

export function convertParametersBetweenModels(params: any, fromModel: string, toModel: string): any {
  // Handle parameter conversion when switching models
  const baseParams = {
    prompt: params.prompt || "",
    numImages: Math.min(params.numImages || params.num_images || 1, getModelCapabilities(toModel).maxImages)
  };
  
  if (toModel === "nano-banana") {
    return {
      ...baseParams,
      outputFormat: "PNG",
      syncMode: false,
      image_urls: params.image_urls || []
    };
  }
  
  if (toModel === "seeddream-v4") {
    return {
      ...baseParams,
      imageSize: "square_hd",
      maxImages: 1,
      syncMode: false,
      enableSafetyChecker: true,
      image_urls: params.image_urls || []
    };
  }
  
  // Converting to V3 or other models - keep only compatible parameters
  return {
    prompt: params.prompt || "",
    numImages: params.numImages || params.num_images || 1,
    guidanceScale: params.guidanceScale || params.guidance_scale || 1.0,
    steps: params.steps || params.num_inference_steps || 20,
    seed: params.seed,
    safetyTolerance: params.safetyTolerance || params.safety_tolerance || 2
  };
}

// Add model categorization
export const modelCategories = {
  stable: ["seededit", "seeddream-v3", "flux-kontext"],
  advanced: ["seeddream-v4", "flux-kontext-max"],
  smart: ["nano-banana"],
  cost_effective: ["nano-banana", "seeddream-v3"],
  high_quality: ["seeddream-v4", "flux-kontext-max"]
};

// Add model recommendations
export function getRecommendedModel(useCase: "speed" | "quality" | "features" | "cost") {
  switch (useCase) {
    case "speed": return "seeddream-v3";      // Fastest, proven
    case "quality": return "seeddream-v4";    // Best features
    case "features": return "seeddream-v4";   // Most capabilities
    case "cost": return "nano-banana";        // Cost effective
    default: return "seeddream-v3";          // Safe default
  }
}

export function getModelDisplayInfo(modelId: string) {
  const capabilities = getModelCapabilities(modelId);
  
  switch (modelId) {
    case "seededit":
      return {
        name: "SeedEdit v3",
        description: "Stable, proven image editing",
        badge: "Stable",
        technology: "ByteDance",
        features: ["Photo retouching", "Object modification", "Realistic edits"]
      };
    case "seeddream-v3":
      return {
        name: "SeedDream v3",
        description: "Creative artistic generation",
        badge: "Stable",
        technology: "ByteDance",
        features: ["Artistic illustrations", "Fast generation", "Creative output"]
      };
    case "seeddream-v4": 
      return {
        name: "SeedDream v4",
        description: "Advanced multi-image editing",
        badge: "Advanced",
        technology: "ByteDance V4",
        features: ["Multi-image processing", "Flexible sizing", "Enhanced prompts"]
      };
    case "nano-banana":
      return {
        name: "Nano Banana",
        description: "Smart AI-powered editing",
        badge: "Smart",
        technology: "Google/Gemini",
        features: ["Smart understanding", "Cost effective", "Multiple formats"]
      };
    case "flux-kontext":
      return {
        name: "FLUX Pro Kontext",
        description: "Context-aware editing",
        badge: "Professional",
        technology: "FLUX",
        features: ["Style changes", "Scene modification", "Professional quality"]
      };
    case "flux-kontext-max":
      return {
        name: "FLUX Pro Kontext Max",
        description: "Advanced professional editing",
        badge: "Premium",
        technology: "FLUX",
        features: ["Complex edits", "Typography", "Maximum quality"]
      };
    default:
      return {
        name: modelId,
        description: "Unknown model",
        badge: "Unknown",
        technology: "Unknown",
        features: []
      };
  }
}

export function validateModelParameters(modelId: string, params: any): string[] {
  const errors: string[] = [];
  
  if (modelId === "seeddream-v4") {
    if (params.imageSize && (params.imageSize < 1024 || params.imageSize > 4096)) {
      errors.push("Image size must be between 1024-4096px for SeedDream V4");
    }
    if (params.maxImages && (params.maxImages < 1 || params.maxImages > 10)) {
      errors.push("Max images must be between 1-10 for SeedDream V4");  
    }
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
  
  return errors;
}

export function getModelSuggestion(prompt: string, currentModel: string): string | null {
  const lowercasePrompt = prompt.toLowerCase();
  
  // Suggest V4 for complex multi-object prompts
  if ((lowercasePrompt.includes("multiple") || 
       lowercasePrompt.includes("several") ||
       lowercasePrompt.includes("many") ||
       lowercasePrompt.split("and").length > 3) && 
      currentModel !== "seeddream-v4") {
    return "seeddream-v4"; // Better for complex multi-element scenes
  }
  
  // Suggest Nano Banana for cost-conscious users
  if ((lowercasePrompt.includes("simple") || 
       lowercasePrompt.includes("quick") ||
       lowercasePrompt.includes("basic")) && 
      currentModel !== "nano-banana") {
    return "nano-banana"; // More cost effective for simple edits
  }
  
  // Suggest V3 for traditional photo editing
  if ((lowercasePrompt.includes("photo") || 
       lowercasePrompt.includes("realistic") ||
       lowercasePrompt.includes("portrait")) && 
      currentModel !== "seededit" && currentModel !== "seeddream-v3") {
    return "seededit"; // Better for traditional photo editing
  }
  
  return null; // No suggestion
}