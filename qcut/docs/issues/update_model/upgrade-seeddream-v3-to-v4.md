# Add New Image Editing Models (SeedDream V4 + Nano Banana) - Adjustment Panel

## Overview
Add SeedDream V4 and Nano Banana as additional model options in the adjustment panel, keeping existing SeedDream V3 functionality intact. This approach provides users with choice between multiple proven models based on their specific editing needs while maintaining full backward compatibility.

## API References
- **SeedDream V4 API**: https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit/api
- **Nano Banana API**: https://fal.ai/models/fal-ai/nano-banana/edit/api

## Current State
- Adjustment panel currently using SeedDream V3
- Users have established workflows with V3
- Existing presets and configurations work with V3

## Target State
- **Multi-Model Support**: SeedDream V3, SeedDream V4, and Nano Banana all available
- **User Choice**: Users can select optimal model based on use case and requirements
- **V3 Preservation**: All existing V3 functionality remains unchanged
- **Enhanced Options**: New V4 and Nano Banana features available as opt-in capabilities

## SeedDream V4 New Features
- **Unified Architecture**: Integrates image generation and editing into single model
- **Multiple Image Support**: Can edit up to 10 input images simultaneously
- **Enhanced Control**: Better text-based editing instructions (max 5000 characters)
- **Flexible Image Sizing**: Configurable dimensions (1024-4096 pixels)
- **Improved Parameters**: New seed control, sync_mode, and safety checker options

## Nano Banana Features
- **Google/Gemini Technology**: Google-powered image editing with advanced AI
- **Multi-Image Support**: Edit 1-10 images simultaneously
- **Flexible Output**: Generate 1-4 output images per request
- **Format Options**: JPEG or PNG output formats
- **Commercial License**: Full commercial use rights
- **Cost Effective**: $0.039 per image (competitive pricing)
- **Edit Description**: Provides text description alongside generated images
- **Sync Mode**: Direct data URI return for immediate use

## Model Comparison
| Feature | SeedDream V3 | SeedDream V4 | Nano Banana |
|---------|-------------|-------------|-------------|
| **Input Images** | 1 | 1-10 | 1-10 |
| **Output Images** | 1-4 | 1-4 | 1-4 |
| **Prompt Length** | Limited | 5000 chars | Standard |
| **Image Size** | Fixed options | 1024-4096px | Standard |
| **Technology** | ByteDance | ByteDance V4 | Google/Gemini |
| **Special Features** | Proven stable | Unified arch | Edit descriptions |
| **Best For** | Reliable edits | Complex edits | Smart understanding |

## Key API Changes
### SeedDream V4 Parameters:
- `image_urls`: Array of up to 10 input image URLs for editing
- `image_size`: Configurable dimensions (1024-4096px) vs fixed sizes in V3
- `max_images`: Maximum images per generation (default 1)
- `sync_mode`: Synchronous processing option
- `enable_safety_checker`: Content safety validation
- `prompt`: Increased limit to 5000 characters (vs V3 limit)
- `num_images`: Generation iterations control
- `seed`: Better seed control for reproducible results

### Nano Banana Parameters:
- `image_urls`: Array of 1-10 input image URLs for editing
- `prompt`: Text description of desired edit
- `num_images`: Number of output images (1-4)
- `output_format`: JPEG or PNG output format
- `sync_mode`: Return direct data URI vs queue processing

## Implementation Subtasks

### Phase 1: Core API Integration & Parameter Handling (Est. 2-3 hours)
#### Subtask 1: Add Multi-Model Configuration & Parameter Support (120-180 min)
**Files to modify:**
- `apps/web/src/lib/text2image-models.ts` - Add SeedDream V4 and Nano Banana models alongside existing V3
- `apps/web/src/lib/image-edit-client.ts` - Add V4 and Nano Banana configurations alongside existing V3
- `apps/web/src/lib/fal-ai-client.ts` - Add V4 and Nano Banana parameter handling while keeping V3 intact

**Implementation:**

**1. Update `text2image-models.ts`:**
```typescript
// Add new V4 model to existing TEXT2IMAGE_MODELS
export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  // Keep all existing models unchanged including seeddream-v3
  "seeddream-v3": {
    // ... existing V3 configuration remains completely unchanged
  },

  // Add new SeedDream V4 model
  "seeddream-v4": {
    id: "seeddream-v4",
    name: "SeedDream v4",
    description: "ByteDance's advanced editing model with multi-image support and unified architecture",
    provider: "ByteDance",
    endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4/edit",
    
    qualityRating: 4,
    speedRating: 4,
    
    estimatedCost: "$0.04-0.08",
    costPerImage: 5, // cents
    
    maxResolution: "4096x4096", 
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    
    defaultParams: {
      image_size: 1024,
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      num_images: 1
    },
    
    availableParams: [
      {
        name: "image_size",
        type: "number",
        min: 1024,
        max: 4096,
        default: 1024,
        description: "Output image size in pixels (square)"
      },
      {
        name: "max_images",
        type: "number", 
        min: 1,
        max: 10,
        default: 1,
        description: "Maximum input images to process"
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of output images to generate"
      },
      {
        name: "sync_mode",
        type: "boolean",
        default: false,
        description: "Use synchronous processing mode"
      },
      {
        name: "enable_safety_checker",
        type: "boolean", 
        default: true,
        description: "Enable content safety filtering"
      },
      {
        name: "seed",
        type: "number",
        min: 0,
        max: 2_147_483_647,
        default: null,
        description: "Random seed for reproducible results"
      }
    ],
    
    bestFor: [
      "Multi-image editing",
      "Complex image transformations", 
      "Advanced content modification",
      "Batch image processing"
    ],
    
    strengths: [
      "Processes multiple images simultaneously",
      "Unified generation and editing architecture",
      "Flexible output sizing",
      "Enhanced prompt understanding (5000 chars)",
      "Advanced safety controls"
    ],
    
    limitations: [
      "Higher complexity than V3",
      "May require more specific prompts",
      "Potentially slower for simple edits"
    ]
  },

  // Add Nano Banana model
  "nano-banana": {
    id: "nano-banana",
    name: "Nano Banana",
    description: "Google/Gemini-powered smart image editing with cost-effective pricing",
    provider: "Google",
    endpoint: "https://fal.run/fal-ai/nano-banana/edit",
    
    qualityRating: 4,
    speedRating: 5,
    
    estimatedCost: "$0.039",
    costPerImage: 3.9, // cents
    
    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    
    defaultParams: {
      num_images: 1,
      output_format: "PNG",
      sync_mode: false
    },
    
    availableParams: [
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of output images to generate"
      },
      {
        name: "output_format", 
        type: "select",
        options: ["JPEG", "PNG"],
        default: "PNG",
        description: "Output image format"
      },
      {
        name: "sync_mode",
        type: "boolean",
        default: false,
        description: "Return images as data URIs immediately"
      }
    ],
    
    bestFor: [
      "Cost-effective image editing",
      "Smart content understanding", 
      "Quick image modifications",
      "Format-specific outputs"
    ],
    
    strengths: [
      "Google/Gemini AI technology",
      "Very cost effective ($0.039/image)",
      "Multiple output formats",
      "Smart contextual understanding",
      "Provides edit descriptions"
    ],
    
    limitations: [
      "Less advanced than SeedDream V4",
      "No flexible sizing options",
      "Standard prompt length limits"
    ]
  }

  // ... keep all other existing models unchanged
};

// Update model categories to include new models
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"], // Add V4 to artistic
  VERSATILE: ["qwen-image", "flux-pro-v11-ultra", "nano-banana"], // Add nano-banana
  FAST: ["seeddream-v3", "nano-banana", "qwen-image"], // Add nano-banana to fast
  HIGH_QUALITY: ["imagen4-ultra", "wan-v2-2", "flux-pro-v11-ultra", "seeddream-v4"], // Add V4 
  COST_EFFECTIVE: ["seeddream-v3", "nano-banana", "qwen-image"], // Add nano-banana
} as const;
```

**2. Update `image-edit-client.ts`:**
```typescript
// Add new model endpoints to existing MODEL_ENDPOINTS
const MODEL_ENDPOINTS: Record<string, ModelEndpoint> = {
  // Keep existing models unchanged
  "seededit": {
    endpoint: "fal-ai/bytedance/seededit/v3/edit-image",
    defaultParams: {
      guidance_scale: 1.0,
    },
  },
  "flux-kontext": {
    // ... existing flux-kontext config unchanged
  },
  "flux-kontext-max": {
    // ... existing flux-kontext-max config unchanged  
  },

  // Add new SeedDream V4 endpoint
  "seeddream-v4": {
    endpoint: "fal-ai/bytedance/seedream/v4/edit",
    defaultParams: {
      image_size: 1024,
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      num_images: 1,
    },
  },

  // Add Nano Banana endpoint
  "nano-banana": {
    endpoint: "fal-ai/nano-banana/edit", 
    defaultParams: {
      num_images: 1,
      output_format: "PNG",
      sync_mode: false,
    },
  },
};

// Update ImageEditRequest interface to support new models
export interface ImageEditRequest {
  imageUrl: string;
  prompt: string;
  model: "seededit" | "flux-kontext" | "flux-kontext-max" | "seeddream-v4" | "nano-banana";
  
  // Existing parameters (keep unchanged for backward compatibility)
  guidanceScale?: number;
  steps?: number;
  seed?: number;
  safetyTolerance?: number;
  numImages?: number;
  
  // New V4-specific parameters
  imageSize?: number; // 1024-4096 for V4
  maxImages?: number; // 1-10 for V4
  syncMode?: boolean; // V4 and Nano Banana
  enableSafetyChecker?: boolean; // V4
  outputFormat?: "JPEG" | "PNG"; // Nano Banana only
}

// Update getImageEditModels function to include new models
export function getImageEditModels() {
  return [
    // Keep existing models unchanged
    {
      id: "seededit",
      name: "SeedEdit v3",
      description: "Precise photo editing with content preservation",
      provider: "ByteDance",
      estimatedCost: "$0.05-0.10",
      features: ["Photo retouching", "Object modification", "Realistic edits"],
      parameters: {
        guidanceScale: { min: 1, max: 10, default: 1.0, step: 0.1 },
        seed: { optional: true },
      },
    },
    {
      id: "flux-kontext",
      // ... existing flux-kontext config unchanged
    },
    {
      id: "flux-kontext-max",
      // ... existing flux-kontext-max config unchanged
    },

    // Add new SeedDream V4 model
    {
      id: "seeddream-v4",
      name: "SeedDream v4", 
      description: "Advanced multi-image editing with unified architecture",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: ["Multi-image processing", "Flexible sizing", "Enhanced prompts", "Advanced controls"],
      parameters: {
        imageSize: { min: 1024, max: 4096, default: 1024, step: 64 },
        maxImages: { min: 1, max: 10, default: 1, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        syncMode: { type: "boolean", default: false },
        enableSafetyChecker: { type: "boolean", default: true },
        seed: { optional: true },
      },
    },

    // Add Nano Banana model
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing with Google/Gemini technology",
      provider: "Google",
      estimatedCost: "$0.039",
      features: ["Smart understanding", "Cost effective", "Multiple formats", "Edit descriptions"],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: { type: "select", options: ["JPEG", "PNG"], default: "PNG" },
        syncMode: { type: "boolean", default: false },
      },
    },
  ];
}

// Add parameter validation for new models
function validateV4Parameters(params: any): string[] {
  const errors: string[] = [];
  
  if (params.imageSize && (params.imageSize < 1024 || params.imageSize > 4096)) {
    errors.push("Image size must be between 1024-4096px for SeedDream V4");
  }
  if (params.maxImages && (params.maxImages < 1 || params.maxImages > 10)) {
    errors.push("Max images must be between 1-10 for SeedDream V4");  
  }
  if (params.prompt && params.prompt.length > 5000) {
    errors.push("Prompt must be under 5000 characters for SeedDream V4");
  }
  
  return errors;
}

function validateNanoBananaParameters(params: any): string[] {
  const errors: string[] = [];
  
  if (params.outputFormat && !["JPEG", "PNG"].includes(params.outputFormat)) {
    errors.push("Output format must be JPEG or PNG for Nano Banana");
  }
  if (params.numImages && (params.numImages < 1 || params.numImages > 4)) {
    errors.push("Number of images must be between 1-4 for Nano Banana");
  }
  
  return errors;
}
```

**3. Update `fal-ai-client.ts`:**
```typescript
// Add model-specific parameter conversion
export function convertParametersForModel(modelId: string, params: any) {
  switch (modelId) {
    case "seeddream-v3":
      // Keep existing V3 conversion unchanged
      return convertV3Parameters(params);
      
    case "seeddream-v4":
      return convertV4Parameters(params);
      
    case "nano-banana":
      return convertNanoBananaParameters(params);
      
    default:
      throw new Error(`Unknown model: ${modelId}`);
  }
}

function convertV4Parameters(params: any) {
  return {
    image_urls: params.image_urls || [],
    prompt: params.prompt || "",
    image_size: params.image_size || 1024,
    max_images: params.max_images || 1,
    num_images: params.num_images || 1,
    sync_mode: params.sync_mode || false,
    enable_safety_checker: params.enable_safety_checker !== false,
    seed: params.seed
  };
}

function convertNanoBananaParameters(params: any) {
  return {
    image_urls: params.image_urls || [],
    prompt: params.prompt || "",
    num_images: params.num_images || 1,
    output_format: params.output_format || "PNG",
    sync_mode: params.sync_mode || false
  };
}

// Model detection and routing
export function detectModelVersion(modelId: string): "v3" | "v4" | "nano-banana" {
  if (modelId === "seeddream-v4") return "v4";
  if (modelId === "nano-banana") return "nano-banana";
  return "v3"; // default to V3 for backward compatibility
}
```

**Tasks:**
- [ ] Add new "seeddream-v4" and "nano-banana" model entries with proper endpoints
- [ ] Keep existing "seeddream-v3" model completely unchanged for backward compatibility
- [ ] Implement V4 parameter definitions with validation (image_urls, max_images, sync_mode, etc.)
- [ ] Implement Nano Banana parameter definitions with JPEG/PNG format support
- [ ] Add model-specific parameter conversion functions
- [ ] Implement model capability detection system
- [ ] Add comprehensive parameter validation for each model type
- [ ] Ensure all three models are available in model selection without breaking existing functionality

### Phase 2: State Management & Model Selection (Est. 1-2 hours)  
#### Subtask 2: Multi-Model State Management & User Preferences (75-120 min)
**Files to modify:**
- `apps/web/src/stores/adjustment-store.ts` - Add V4 and Nano Banana model support alongside V3
- `apps/web/src/stores/text2image-store.ts` - Add new models to available models
- `apps/web/src/stores/settings-store.ts` - Add model preference settings
- `apps/web/src/lib/model-utils.ts` - Create model selection utilities

**Implementation:**

**1. Update `adjustment-store.ts`:**
```typescript
// Update the existing AdjustmentState interface to support new models
export interface AdjustmentState {
  // Current image (keep unchanged)
  originalImage: File | null;
  originalImageUrl: string | null;
  currentEditedUrl: string | null;

  // Update model selection to include new models
  selectedModel: "seededit" | "flux-kontext" | "flux-kontext-max" | "seeddream-v4" | "nano-banana";

  // Keep existing parameters structure but make it model-agnostic
  prompt: string;
  parameters: {
    // Existing parameters (keep for backward compatibility)
    guidanceScale: number;
    steps: number;
    seed?: number;
    safetyTolerance: number;
    numImages: number;
    
    // Add new V4-specific parameters (optional for backward compatibility)
    imageSize?: number; // 1024-4096 for V4
    maxImages?: number; // 1-10 for V4 
    syncMode?: boolean; // V4 and Nano Banana
    enableSafetyChecker?: boolean; // V4
    outputFormat?: "JPEG" | "PNG"; // Nano Banana only
  };

  // Keep all existing state unchanged
  editHistory: EditHistoryItem[];
  currentHistoryIndex: number;
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
  elapsedTime: number;
  estimatedTime?: number;
  showParameters: boolean;
  showHistory: boolean;
  previewMode: "side-by-side" | "overlay" | "single";
}

// Update getDefaultParameters function to support new models
const getDefaultParameters = (model: AdjustmentState["selectedModel"]) => {
  switch (model) {
    case "seededit":
      // Keep existing V3/seededit parameters unchanged
      return {
        guidanceScale: 1.0,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
      };
    case "flux-kontext":
    case "flux-kontext-max":
      // Keep existing flux parameters unchanged
      return {
        guidanceScale: 3.5,
        steps: 28,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
      };
    case "seeddream-v4":
      // Add new V4 parameters
      return {
        guidanceScale: 2.5, // Reasonable default similar to V3
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        // V4-specific parameters
        imageSize: 1024,
        maxImages: 1,
        syncMode: false,
        enableSafetyChecker: true,
      };
    case "nano-banana":
      // Add Nano Banana parameters
      return {
        guidanceScale: 2.5, // Not used but kept for interface consistency
        steps: 20, // Not used but kept for interface consistency
        seed: undefined,
        safetyTolerance: 2, // Not used but kept for interface consistency
        numImages: 1,
        // Nano Banana-specific parameters
        outputFormat: "PNG" as const,
        syncMode: false,
      };
  }
};

// Update store creation - keep all existing functionality unchanged
export const useAdjustmentStore = create<AdjustmentStore>()(
  subscribeWithSelector((set, get) => ({
    // Keep all existing initial state unchanged
    originalImage: null,
    originalImageUrl: null,
    currentEditedUrl: null,
    selectedModel: "seededit", // Keep seededit as default for backward compatibility
    prompt: "",
    parameters: getDefaultParameters("seededit"), // Default to seededit
    editHistory: [],
    currentHistoryIndex: -1,
    isProcessing: false,
    progress: 0,
    statusMessage: "",
    elapsedTime: 0,
    estimatedTime: undefined,
    showParameters: true,
    showHistory: false,
    previewMode: "side-by-side",

    // Keep all existing actions unchanged, just update setSelectedModel
    setSelectedModel: (model) => {
      set({
        selectedModel: model,
        parameters: getDefaultParameters(model), // This now supports new models
      });
    },

    // All other actions remain completely unchanged
    setOriginalImage: (file, url) => {
      const prevUrl = get().originalImageUrl;
      if (prevUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(prevUrl);
      }
      set({
        originalImage: file,
        originalImageUrl: url,
        currentEditedUrl: null,
        editHistory: [],
        currentHistoryIndex: -1,
      });
    },

    // ... all other existing actions remain unchanged
  }))
);

// Keep existing localStorage persistence logic unchanged
if (typeof window !== "undefined") {
  const savedSettings = localStorage.getItem("adjustment-settings");
  if (savedSettings) {
    try {
      const settings = JSON.parse(savedSettings);
      useAdjustmentStore.setState({
        selectedModel: settings.selectedModel || "seededit", // Default to seededit
        showParameters: settings.showParameters ?? true,
        previewMode: settings.previewMode || "side-by-side",
      });
    } catch (error) {
      console.warn("Failed to load adjustment settings:", error);
    }
  }

  // Keep existing settings subscription unchanged
  useAdjustmentStore.subscribe(
    (state) => ({
      selectedModel: state.selectedModel,
      showParameters: state.showParameters,
      previewMode: state.previewMode,
    }),
    (settings) => {
      localStorage.setItem("adjustment-settings", JSON.stringify(settings));
    }
  );
}
```

```

**2. Update `text2image-store.ts`:**
```typescript
// Add new models to available models array
const availableModels = [
  "seeddream-v3",    // Keep existing
  "seeddream-v4",    // Add new
  "nano-banana"      // Add new
];

// Add model categorization
export const modelCategories = {
  stable: ["seeddream-v3"],
  advanced: ["seeddream-v4"],
  smart: ["nano-banana"]
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
```

**3. Create `model-utils.ts`:**
```typescript
export interface ModelCapability {
  multiImage: boolean;
  flexibleSizing: boolean;
  enhancedPrompts: boolean;
  outputFormats: string[];
  maxImages: number;
  pricing?: { perImage: number; currency: string };
}

export function getModelCapabilities(modelId: string): ModelCapability {
  switch (modelId) {
    case "seeddream-v3":
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1
      };
    case "seeddream-v4":
      return {
        multiImage: true,
        flexibleSizing: true,
        enhancedPrompts: true,
        outputFormats: ["PNG"],
        maxImages: 10
      };
    case "nano-banana":
      return {
        multiImage: true,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["JPEG", "PNG"],
        maxImages: 10,
        pricing: { perImage: 0.039, currency: "USD" }
      };
    default:
      return {
        multiImage: false,
        flexibleSizing: false,
        enhancedPrompts: false,
        outputFormats: ["PNG"],
        maxImages: 1
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
    num_images: Math.min(params.num_images || 1, getModelCapabilities(toModel).maxImages)
  };
  
  if (toModel === "nano-banana") {
    return {
      ...baseParams,
      output_format: "PNG",
      sync_mode: false,
      image_urls: params.image_urls || []
    };
  }
  
  if (toModel === "seeddream-v4") {
    return {
      ...baseParams,
      image_size: 1024,
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      image_urls: params.image_urls || []
    };
  }
  
  // Converting to V3 - keep only compatible parameters
  return {
    prompt: params.prompt || "",
    num_images: params.num_images || 1
    // V3-specific parameters only
  };
}
```

**4. Update `settings-store.ts`:**
```typescript
interface SettingsState {
  // Keep existing settings unchanged
  // Add new model preferences
  preferredImageEditModel: "seeddream-v3" | "seeddream-v4" | "nano-banana";
  modelPreferences: {
    showModelComparison: boolean;
    autoSuggestModel: boolean;
    rememberModelChoice: boolean;
  };
}

export const useSettingsStore = create<SettingsState & Actions>((set) => ({
  // Keep existing settings
  preferredImageEditModel: "seeddream-v3", // Default to V3 for existing users
  modelPreferences: {
    showModelComparison: true,
    autoSuggestModel: true,
    rememberModelChoice: true
  },
  
  setPreferredImageEditModel: (model) => set({ preferredImageEditModel: model }),
  updateModelPreferences: (prefs) => set(state => ({
    modelPreferences: { ...state.modelPreferences, ...prefs }
  }))
}));
```

**Tasks:**
- [ ] Add "seeddream-v4" and "nano-banana" to available models (keep "seeddream-v3" as default)
- [ ] Create separate parameter objects for each model to avoid conflicts
- [ ] Implement model-specific parameter defaults and validation
- [ ] Add model switching logic with parameter conversion
- [ ] Create model capability detection system
- [ ] Add user preference tracking for model selection
- [ ] Implement model recommendation system based on use case
- [ ] Ensure all existing V3 functionality remains completely unchanged

### Phase 3: UI Components & Model Selection Interface (Est. 3-4 hours)
#### Subtask 3: Complete Multi-Model UI Implementation (180-240 min)
**Files to modify/create:**
- `apps/web/src/components/editor/adjustment/index.tsx` - Main adjustment panel component
- `apps/web/src/components/editor/adjustment/model-selector.tsx` - Enhanced model selector
- `apps/web/src/components/editor/adjustment/model-comparison.tsx` - Model feature comparison
- `apps/web/src/components/editor/adjustment/parameter-controls.tsx` - Model-specific parameter controls

**Implementation:**

**1. Update `adjustment/index.tsx`:**
```tsx
import { useAdjustmentStore } from '@/stores/adjustment-store';
import { getModelCapabilities } from '@/lib/model-utils';
import { ModelSelector } from './model-selector';
import { ParameterControls } from './parameter-controls';
import { ModelComparison } from './model-comparison';

export function AdjustmentPanel() {
  const { selectedModel, setSelectedModel } = useAdjustmentStore();
  const capabilities = getModelCapabilities(selectedModel);
  
  return (
    <div className="adjustment-panel">
      {/* Keep existing V3 layout unchanged when V3 is selected */}
      <ModelSelector 
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
      
      {/* Model-specific parameter controls */}
      <ParameterControls 
        modelId={selectedModel}
        capabilities={capabilities}
      />
      
      {/* Show model comparison for new users */}
      <ModelComparison />
    </div>
  );
}
```

**2. Create `model-selector.tsx`:**
```tsx
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getModelCapabilities, getRecommendedModel } from '@/lib/model-utils';

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (model: "seeddream-v3" | "seeddream-v4" | "nano-banana") => void;
}

export function ModelSelector({ selectedModel, onModelChange }: ModelSelectorProps) {
  const models = [
    {
      id: "seeddream-v3",
      name: "SeedDream V3",
      description: "Stable, proven image editing",
      badge: "Stable",
      technology: "ByteDance"
    },
    {
      id: "seeddream-v4", 
      name: "SeedDream V4",
      description: "Advanced multi-image editing",
      badge: "Advanced",
      technology: "ByteDance V4"
    },
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing",
      badge: "Smart",
      technology: "Google/Gemini"
    }
  ];
  
  return (
    <div className="model-selector">
      <Select value={selectedModel} onValueChange={onModelChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map(model => {
            const capabilities = getModelCapabilities(model.id);
            return (
              <SelectItem key={model.id} value={model.id}>
                <div className="flex items-center justify-between w-full">
                  <div>
                    <div className="font-medium">{model.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {model.description}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {model.technology}
                      {capabilities.pricing && ` • $${capabilities.pricing.perImage}/image`}
                    </div>
                  </div>
                  <Badge variant="secondary">{model.badge}</Badge>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**3. Create `parameter-controls.tsx`:**
```tsx
import { useAdjustmentStore } from '@/stores/adjustment-store';
import { ModelCapability } from '@/lib/model-utils';
import { V3Controls } from './v3/controls';
import { V4Controls } from './v4/controls';
import { NanoBananaControls } from './nano-banana/controls';

interface ParameterControlsProps {
  modelId: string;
  capabilities: ModelCapability;
}

export function ParameterControls({ modelId, capabilities }: ParameterControlsProps) {
  const { getCurrentParameters, updateParameters } = useAdjustmentStore();
  const params = getCurrentParameters();
  
  // Render model-specific controls without breaking existing V3 functionality
  switch (modelId) {
    case "seeddream-v4":
      return (
        <V4Controls 
          parameters={params}
          onChange={updateParameters}
          capabilities={capabilities}
        />
      );
      
    case "nano-banana":
      return (
        <NanoBananaControls
          parameters={params}
          onChange={updateParameters}
          capabilities={capabilities}
        />
      );
      
    default:
      // Keep existing V3 controls completely unchanged
      return (
        <V3Controls
          parameters={params}
          onChange={updateParameters}
        />
      );
  }
}
```

**4. Create `v4/controls.tsx`:**
```tsx
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MultiImageUpload } from '../shared/multi-image-upload';

export function V4Controls({ parameters, onChange, capabilities }) {
  return (
    <div className="v4-controls space-y-4">
      {/* Multi-image upload */}
      {capabilities.multiImage && (
        <MultiImageUpload
          images={parameters.image_urls || []}
          maxImages={capabilities.maxImages}
          onChange={(urls) => onChange({ image_urls: urls })}
        />
      )}
      
      {/* Enhanced prompt input */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Prompt ({parameters.prompt?.length || 0}/5000)
        </label>
        <Textarea
          value={parameters.prompt || ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="Describe the edits you want to make..."
          maxLength={5000}
          rows={3}
        />
      </div>
      
      {/* Flexible image size */}
      {capabilities.flexibleSizing && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Image Size: {parameters.image_size}px
          </label>
          <Slider
            value={[parameters.image_size || 1024]}
            onValueChange={([size]) => onChange({ image_size: size })}
            min={1024}
            max={4096}
            step={64}
          />
        </div>
      )}
      
      {/* V4-specific options */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Safety Checker</label>
        <Switch
          checked={parameters.enable_safety_checker !== false}
          onCheckedChange={(checked) => onChange({ enable_safety_checker: checked })}
        />
      </div>
      
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Sync Mode</label>
        <Switch
          checked={parameters.sync_mode || false}
          onCheckedChange={(checked) => onChange({ sync_mode: checked })}
        />
      </div>
    </div>
  );
}
```

**5. Create `nano-banana/controls.tsx`:**
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { MultiImageUpload } from '../shared/multi-image-upload';

export function NanoBananaControls({ parameters, onChange, capabilities }) {
  return (
    <div className="nano-banana-controls space-y-4">
      {/* Multi-image upload */}
      <MultiImageUpload
        images={parameters.image_urls || []}
        maxImages={capabilities.maxImages}
        onChange={(urls) => onChange({ image_urls: urls })}
      />
      
      {/* Output format selector */}
      <div>
        <label className="block text-sm font-medium mb-2">Output Format</label>
        <Select 
          value={parameters.output_format || "PNG"}
          onValueChange={(format) => onChange({ output_format: format })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PNG">PNG (Higher Quality)</SelectItem>
            <SelectItem value="JPEG">JPEG (Smaller Size)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Output image count */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Output Images: {parameters.num_images || 1}
        </label>
        <Slider
          value={[parameters.num_images || 1]}
          onValueChange={([count]) => onChange({ num_images: count })}
          min={1}
          max={4}
          step={1}
        />
      </div>
      
      {/* Pricing display */}
      {capabilities.pricing && (
        <div className="text-sm text-muted-foreground">
          Cost: ${capabilities.pricing.perImage} per image • 
          Total: ${(capabilities.pricing.perImage * (parameters.num_images || 1)).toFixed(3)}
        </div>
      )}
    </div>
  );
}
```

**6. Create `shared/multi-image-upload.tsx`:**
```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Upload } from 'lucide-react';

interface MultiImageUploadProps {
  images: string[];
  maxImages: number;
  onChange: (images: string[]) => void;
}

export function MultiImageUpload({ images, maxImages, onChange }: MultiImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  
  const handleFileUpload = (files: FileList) => {
    const newImages = Array.from(files)
      .slice(0, maxImages - images.length)
      .map(file => URL.createObjectURL(file));
    
    onChange([...images, ...newImages]);
  };
  
  const removeImage = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };
  
  return (
    <div className="multi-image-upload">
      <label className="block text-sm font-medium mb-2">
        Input Images ({images.length}/{maxImages})
      </label>
      
      {/* Image preview grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {images.map((image, index) => (
            <div key={index} className="relative group">
              <img 
                src={image} 
                alt={`Upload ${index + 1}`}
                className="w-full h-20 object-cover rounded border"
              />
              <Button
                size="sm"
                variant="destructive"
                className="absolute -top-1 -right-1 w-5 h-5 p-0 opacity-0 group-hover:opacity-100"
                onClick={() => removeImage(index)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      
      {/* Upload area */}
      {images.length < maxImages && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFileUpload(e.dataTransfer.files);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'image/*';
            input.onchange = (e) => {
              const target = e.target as HTMLInputElement;
              if (target.files) handleFileUpload(target.files);
            };
            input.click();
          }}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Drop images here or click to upload
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {maxImages - images.length} more images allowed
          </p>
        </div>
      )}
    </div>
  );
}
```

**Tasks:**
- [ ] Implement multi-model UI that preserves all existing V3 functionality
- [ ] Create model selector dropdown with V3, V4, and Nano Banana options
- [ ] Add model-specific parameter controls that only show relevant options
- [ ] Implement shared multi-image upload component for V4 and Nano Banana
- [ ] Add V4-specific controls (flexible sizing, enhanced prompts, safety options)
- [ ] Add Nano Banana-specific controls (output formats, pricing display)
- [ ] Show model capabilities and technology badges in selector
- [ ] Implement smooth model switching with parameter preservation where compatible
- [ ] Ensure existing V3 users see no changes unless they actively switch models


## Critical Files Requiring Modification
1. **`apps/web/src/lib/text2image-models.ts`** - Core model configuration
2. **`apps/web/src/lib/image-edit-client.ts`** - Image editing API client
3. **`apps/web/src/lib/fal-ai-client.ts`** - Parameter conversion logic
4. **`apps/web/src/stores/adjustment-store.ts`** - Adjustment panel state
5. **`apps/web/src/stores/text2image-store.ts`** - Text2image model references
6. **`apps/web/src/components/editor/adjustment/index.tsx`** - Main adjustment panel
7. **`apps/web/src/components/editor/adjustment/model-selector.tsx`** - Model selection UI

## Adjustment Panel Specific Considerations
- **Image Size Controls**: Update slider ranges to support 1024-4096px dimensions
- **Multi-Image Support**: Design UI to handle up to 10 input images
- **Enhanced Prompts**: Expand text input to support 5000 character limit
- **Parameter Mapping**: Map V3 parameters to V4 equivalents
- **Real-time Preview**: Test performance with new unified architecture
- **Safety Integration**: Implement safety checker toggle in UI

## Breaking Changes Prevention Strategy

### Critical Non-Breaking Requirements
- **Maintain V3 Compatibility**: Keep existing V3 endpoints functional during transition
- **Gradual Migration**: Implement feature flags to toggle between V3/V4
- **Fallback Mechanism**: Auto-fallback to V3 if V4 fails
- **Preserve User Data**: Ensure existing presets and settings remain functional
- **API Response Compatibility**: Maintain consistent response format for existing features

### Backward Compatibility Plan
1. **Dual API Support**: Maintain both V3 and V4 API connections
2. **Parameter Translation Layer**: Create adapter to translate V3 params to V4
3. **Progressive Enhancement**: Add V4 features as optional enhancements
4. **Version Detection**: Auto-detect user's current workflow requirements
5. **Graceful Degradation**: Remove V4-only features if V3 mode needed

## Migration Steps
1. **Phase 1 - Foundation**
   - Create V4 API integration alongside existing V3
   - Implement parameter translation layer
   - Add feature flag system for V3/V4 switching

2. **Phase 2 - Compatibility Testing**
   - Test all existing V3 workflows with V4 backend
   - Validate parameter mapping accuracy
   - Ensure UI controls work with both versions

3. **Phase 3 - Enhanced Features**
   - Add V4-specific controls (multi-image, extended prompts)
   - Implement progressive enhancement for V4 capabilities
   - Add user preference for V3/V4 mode

4. **Phase 4 - Validation**
   - Comprehensive testing of existing user workflows
   - Performance comparison between V3/V4
   - User acceptance testing with existing presets

5. **Phase 5 - Rollout**
   - Gradual rollout with A/B testing
   - Monitor for breaking changes in production
   - Maintain V3 as fallback option

## Risk Mitigation
- **Data Loss Prevention**: Backup existing settings before migration
- **Performance Monitoring**: Track response times and error rates
- **User Communication**: Clear messaging about changes and benefits
- **Rollback Plan**: Quick revert mechanism to V3 if issues arise
- **Support Documentation**: Update help docs for both versions

## Testing Checklist
- [ ] All existing V3 workflows function with V4 backend
- [ ] Parameter conversion maintains same output quality
- [ ] UI controls respond correctly in both modes
- [ ] Error handling works for both API versions
- [ ] User presets load and save correctly
- [ ] Performance meets or exceeds V3 benchmarks
- [ ] No data corruption during parameter translation
- [ ] Graceful fallback to V3 when V4 unavailable

## Notes
- **Zero Breaking Changes**: Primary goal is seamless transition
- **Feature Addition Only**: V4 should add capabilities, not remove them
- **User Choice**: Allow users to stay on V3 if preferred
- **Monitoring**: Extensive logging during migration period
- **Documentation**: Clear migration guide for power users