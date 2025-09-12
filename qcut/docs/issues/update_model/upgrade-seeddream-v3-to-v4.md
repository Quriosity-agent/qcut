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
// Add new models alongside existing V3
export const imageEditModels = [
  // Keep existing V3 model unchanged
  {
    id: "seeddream-v3",
    name: "SeedDream V3",
    endpoint: "fal-ai/bytedance/seedream/v3/text-to-image",
    // ... existing V3 configuration
  },
  // Add new V4 model
  {
    id: "seeddream-v4", 
    name: "SeedDream V4",
    endpoint: "fal-ai/bytedance/seedream/v4/edit",
    parameters: {
      image_urls: { type: "array", max: 10 },
      image_size: { type: "range", min: 1024, max: 4096 },
      max_images: { type: "number", default: 1 },
      sync_mode: { type: "boolean", default: false },
      enable_safety_checker: { type: "boolean", default: true },
      prompt: { type: "string", max: 5000 },
      num_images: { type: "number", min: 1, max: 4 },
      seed: { type: "number", optional: true }
    },
    features: ["multi-image", "flexible-sizing", "enhanced-prompts"]
  },
  // Add Nano Banana model
  {
    id: "nano-banana",
    name: "Nano Banana", 
    endpoint: "fal-ai/nano-banana/edit",
    parameters: {
      image_urls: { type: "array", min: 1, max: 10 },
      prompt: { type: "string", required: true },
      num_images: { type: "number", min: 1, max: 4, default: 1 },
      output_format: { type: "enum", values: ["JPEG", "PNG"], default: "PNG" },
      sync_mode: { type: "boolean", default: false }
    },
    features: ["multi-image", "output-formats", "gemini-powered"],
    pricing: { perImage: 0.039, currency: "USD" }
  }
];
```

**2. Update `image-edit-client.ts`:**
```typescript
// Add model configuration functions
export function getImageEditModels() {
  return imageEditModels.filter(model => 
    ["seeddream-v3", "seeddream-v4", "nano-banana"].includes(model.id)
  );
}

export function getModelCapabilities(modelId: string) {
  const model = imageEditModels.find(m => m.id === modelId);
  return model?.features || [];
}

export function validateModelParameters(modelId: string, params: any) {
  const model = imageEditModels.find(m => m.id === modelId);
  if (!model) return { valid: false, errors: ["Unknown model"] };
  
  // Model-specific validation logic
  const errors = [];
  
  if (modelId === "seeddream-v4") {
    if (params.image_size && (params.image_size < 1024 || params.image_size > 4096)) {
      errors.push("Image size must be between 1024-4096px for V4");
    }
    if (params.prompt && params.prompt.length > 5000) {
      errors.push("Prompt must be under 5000 characters for V4");
    }
  }
  
  if (modelId === "nano-banana") {
    if (params.output_format && !["JPEG", "PNG"].includes(params.output_format)) {
      errors.push("Output format must be JPEG or PNG for Nano Banana");
    }
  }
  
  return { valid: errors.length === 0, errors };
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
interface AdjustmentState {
  selectedModel: "seeddream-v3" | "seeddream-v4" | "nano-banana";
  // Keep existing V3 parameters unchanged
  v3Parameters: {
    // ... existing V3 parameters
  };
  // Add new V4 parameters
  v4Parameters: {
    image_urls: string[];
    image_size: number;
    max_images: number;
    sync_mode: boolean;
    enable_safety_checker: boolean;
    prompt: string;
    num_images: number;
    seed?: number;
  };
  // Add Nano Banana parameters
  nanoBananaParameters: {
    image_urls: string[];
    prompt: string;
    num_images: number;
    output_format: "JPEG" | "PNG";
    sync_mode: boolean;
  };
}

// Add model-specific parameter defaults
const defaultV4Parameters = {
  image_urls: [],
  image_size: 1024,
  max_images: 1,
  sync_mode: false,
  enable_safety_checker: true,
  prompt: "",
  num_images: 1
};

const defaultNanoBananaParameters = {
  image_urls: [],
  prompt: "",
  num_images: 1,
  output_format: "PNG" as const,
  sync_mode: false
};

export const useAdjustmentStore = create<AdjustmentState & Actions>((set, get) => ({
  selectedModel: "seeddream-v3", // Default to V3 for backward compatibility
  v3Parameters: { /* existing V3 defaults */ },
  v4Parameters: defaultV4Parameters,
  nanoBananaParameters: defaultNanoBananaParameters,
  
  // Keep existing V3 actions unchanged
  setSelectedModel: (model) => set({ selectedModel: model }),
  
  // Add model-specific parameter getters
  getCurrentParameters: () => {
    const state = get();
    switch (state.selectedModel) {
      case "seeddream-v4": return state.v4Parameters;
      case "nano-banana": return state.nanoBananaParameters;
      default: return state.v3Parameters; // V3 default
    }
  },
  
  updateParameters: (params) => {
    const state = get();
    switch (state.selectedModel) {
      case "seeddream-v4":
        set({ v4Parameters: { ...state.v4Parameters, ...params } });
        break;
      case "nano-banana":
        set({ nanoBananaParameters: { ...state.nanoBananaParameters, ...params } });
        break;
      default:
        // Keep existing V3 parameter update logic unchanged
        set({ v3Parameters: { ...state.v3Parameters, ...params } });
    }
  }
}));
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

### Phase 4: Testing & Validation (Est. 2-3 hours)
#### Subtask 4.1: Unit Testing (60-90 min)
**Files to create:**
- `apps/web/src/lib/__tests__/parameter-translation.test.ts`
- `apps/web/src/stores/__tests__/v4-migration.test.ts`

**Tasks:**
- [ ] Test V4 parameter handling functions (separate from V3)
- [ ] Test Nano Banana parameter handling functions (separate from V3/V4)
- [ ] Validate multi-model support functions (V3/V4/Nano Banana)
- [ ] Test model selection logic and switching between all three models
- [ ] Verify parameter validation for V3, V4, and Nano Banana formats
- [ ] Test model capability detection for all models
- [ ] Test output format handling for Nano Banana

#### Subtask 4.2: Integration Testing (60-90 min)
**Test files to update:**
- Update existing adjustment panel tests to support both models

**Tasks:**
- [ ] Test V3 workflows continue to work unchanged
- [ ] Test V4 workflows with new capabilities
- [ ] Test Nano Banana workflows with Google/Gemini features
- [ ] Validate model switching preserves compatible parameters across all models
- [ ] Test error handling for V3, V4, and Nano Banana API calls
- [ ] Verify users can seamlessly switch between all three models
- [ ] Test that existing V3 users are unaffected by new model additions
- [ ] Test output format differences (Nano Banana JPEG/PNG vs others)

### Phase 5: Documentation & Rollout (Est. 1-2 hours)
#### Subtask 5.1: Documentation Updates (30-45 min)
**Files to update:**
- Update component documentation for V4 features
- Add migration guide for developers

**Tasks:**
- [ ] Document V4 and Nano Banana features and when to use each model
- [ ] Create comprehensive user guide for model selection (V3/V4/Nano Banana)
- [ ] Document new V4 parameters and capabilities
- [ ] Document Nano Banana parameters and Google/Gemini features
- [ ] Update troubleshooting guide for multi-model support
- [ ] Create model comparison matrix for users

#### Subtask 5.2: Monitoring & Analytics (45-60 min)
**Files to create:**
- `apps/web/src/lib/model-usage-analytics.ts` - Track V3/V4 usage patterns

**Tasks:**
- [ ] Add usage analytics for V3/V4/Nano Banana adoption patterns
- [ ] Monitor API performance and error rates for all three models
- [ ] Track user preference patterns and model switching behavior
- [ ] Add success metrics for multi-model implementation
- [ ] Monitor resource usage differences between models
- [ ] Track cost analysis for different model usage patterns
- [ ] Monitor output format preferences for Nano Banana

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