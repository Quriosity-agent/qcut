# AI Image Model Order Adjustment

## Goal
Ensure the AI Images multi-model selector lists models in a curated priority order (cheapest → premium) instead of the raw object insertion order.

## Target Priority Order
1. Nano Banana (`nano-banana`)
2. SeedDream v4 (`seeddream-v4`)
3. Reve Text-to-Image (`reve-text-to-image`)
4. WAN v2.2 (`wan-v2-2`)
5. Imagen4 Ultra (`imagen4-ultra`)
6. Qwen Image (`qwen-image`)
7. FLUX Pro v1.1 Ultra (`flux-pro-v11-ultra`)
8. SeedDream v3 (`seeddream-v3`)

## Implementation Summary

### 1. Define shared order in the model catalog  
**File**: `qcut/apps/web/src/lib/text2image-models.ts:646`

```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "nano-banana",
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
```

### 2. Use the order for default selections  
**File**: `qcut/apps/web/src/stores/text2image-store.ts:55`

- Import `TEXT2IMAGE_MODEL_ORDER`.
- Set `selectedModels: [...TEXT2IMAGE_MODEL_ORDER]`.
- When multi-mode is empty, seed with `TEXT2IMAGE_MODEL_ORDER.slice(0, 6)`.
- When single-mode is empty, seed with `[TEXT2IMAGE_MODEL_ORDER[0]]`.

### 3. Render the selector using the shared order  
**File**: `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx:193`

```tsx
{TEXT2IMAGE_MODEL_ORDER.map((modelId) => {
  const model = TEXT2IMAGE_MODELS[modelId];
  return (
    <FloatingActionPanelModelOption
      key={modelId}
      id={modelId}
      name={model.name}
      checked={selectedModels.includes(modelId)}
      onCheckedChange={(checked) => {
        if (generationMode === "single") {
          selectedModels.forEach((m) => {
            if (m !== modelId) toggleModel(m);
          });
          if (checked && !selectedModels.includes(modelId)) {
            toggleModel(modelId);
          }
        } else {
          toggleModel(modelId);
        }
      }}
    />
  );
})}
```

## Validation
- Open **AI Images → Select Models** panel and confirm the order matches the list above.
- Toggle between Single and Multi modes to ensure defaults follow the new priority.
- Optional: `pnpm --filter @qcut/web lint`.

## Status
- [x] Shared priority constant exported.
- [x] Store defaults aligned.
- [x] UI selector iterates using the curated order.

## Upscale Models Integration (Option 1 Design)

### UI Design: Separate Section with Toggle

Create a distinct "MODEL TYPE" selector above the current model list:

```
┌─────────────────────────────────────┐
│ • MODEL TYPE                        │
│ ┌─────────────────────────────────┐ │
│ │ [Generation] [Edit] [Upscale]   │ │
│ └─────────────────────────────────┘ │
│                                      │
│ • MODEL SELECTION                    │
│ ┌─────────────────────────────────┐ │
│ │ ☑ Crystal Upscaler   $0.02/img  │ │
│ │ ☐ SeedVR Upscale     $0.05/img  │ │
│ │ ☐ Topaz Upscale      $0.10/img  │ │
│ └─────────────────────────────────┘ │
│                                      │
│ • UPSCALE SETTINGS                   │
│ Scale Factor: [2x] [4x] [8x] [16x]   │
│ Denoise Level: [Slider 0-100]       │
│ Creativity: [Slider 0-100]           │
│ Overlapping Tiles: [Toggle]          │
└─────────────────────────────────────┘
```

### Implementation Structure

#### 1. Model Type Enum
```typescript
enum ModelType {
  GENERATION = 'generation',
  EDIT = 'edit',
  UPSCALE = 'upscale'
}
```

#### 2. Upscale Model Interface
```typescript
interface UpscaleModel {
  id: string;
  name: string;
  price: string;
  maxScale: number;
  supportedScales: number[];
  features: {
    faceEnhancement?: boolean;
    denoising?: boolean;
    sharpening?: boolean;
  };
  endpoint: string;
  category: 'upscale';
}
```

#### 3. Upscale Models Configuration
```typescript
export const UPSCALE_MODEL_ORDER = [
  "crystal-upscaler",  // Good balance of price and quality
  "seedvr-upscale",    // High quality with creativity control
  "topaz-upscale"      // Professional grade
] as const;

export const UPSCALE_MODELS: Record<string, UpscaleModel> = {
  "crystal-upscaler": {
    id: "crystal-upscaler",
    name: "Crystal Upscaler",
    price: "0.02",
    maxScale: 10,
    supportedScales: [2, 4, 8, 10],
    features: {
      denoising: true,
      sharpening: true
    },
    endpoint: "fal-ai/crystal-upscaler",
    category: "upscale"
  },
  "seedvr-upscale": {
    id: "seedvr-upscale",
    name: "SeedVR Upscale",
    price: "0.05",
    maxScale: 16,
    supportedScales: [2, 4, 8, 16],
    features: {
      denoising: true,
      sharpening: true,
      creativity: true  // Supports creative enhancement
    },
    endpoint: "fal-ai/seedvr/upscale/image",
    category: "upscale"
  },
  "topaz-upscale": {
    id: "topaz-upscale",
    name: "Topaz Upscale",
    price: "0.10",
    maxScale: 16,
    supportedScales: [2, 4, 8, 16],
    features: {
      denoising: true,
      sharpening: true,
      overlappingTiles: true,  // Professional tiling
      professionalGrade: true  // Highest quality
    },
    endpoint: "fal-ai/topaz/upscale/image",
    category: "upscale"
  }
};
```

#### 4. Upscale Settings Component
```typescript
interface UpscaleSettings {
  scaleFactor: 2 | 4 | 8 | 10 | 16;
  faceEnhancement: boolean;
  denoise: boolean;
  denoiseLevel: number; // 0-100
  preserveDetails: boolean;
  creativity: number; // 0-100 for SeedVR
  overlappingTiles: boolean; // For Topaz
  outputFormat: 'png' | 'jpeg' | 'webp';
}
```

### User Flow

1. **Model Type Selection**: User clicks "Upscale" tab
2. **Model List Update**: UI shows upscale models with pricing
3. **Model Selection**: User selects one or more upscale models
4. **Settings Configuration**:
   - Scale factor selector appears (2x, 4x, 8x, 16x based on model)
   - Enhancement toggles based on model capabilities
   - Denoise slider for fine-tuning
   - Creativity slider for SeedVR (0-100)
   - Overlapping tiles toggle for Topaz
5. **Image Input**: User uploads image or selects from existing
6. **Processing**: "Upscale Image" button initiates processing
7. **Result**: Before/after preview with download option

### Visual Design Guidelines

- **Icons**:
  - 🔍 for upscale models
  - ✏️ for edit models
  - 🎨 for generation models
- **Color Coding**:
  - Purple accent for upscale
  - Blue for edit
  - Green for generation
- **Resolution Display**: Show "720p → 2880p" format
- **Progress Indicator**: Display processing stages
- **Preview**: Split-screen before/after comparison

### Model Capabilities Comparison

| Model | Max Scale | Best For | Special Features | Price |
|-------|-----------|----------|------------------|-------|
| **Crystal Upscaler** | 10x | Balanced quality | Good price/performance | $0.02 |
| **SeedVR Upscale** | 16x | Creative upscaling | Creativity control slider | $0.05 |
| **Topaz Upscale** | 16x | Professional work | Highest quality, overlapping tiles | $0.10 |

### Advantages of Option 1

1. **Clear Separation**: Users immediately understand they're in "upscale mode"
2. **Dedicated Settings**: Upscale-specific controls without cluttering other interfaces
3. **Consistency**: Follows existing pattern of model selection with pricing
4. **Scalability**: Easy to add more upscale models in the future
5. **User Experience**: Intuitive workflow from model selection to result
6. **Focused Selection**: 3 carefully chosen models covering budget to professional needs

## Implementation Subtasks

### Phase 1: Model Infrastructure (Reuse Existing Patterns)

#### Task 1.1: Create Upscale Models Configuration
**File to Create:** `qcut/apps/web/src/lib/upscale-models.ts`
```typescript
// Reuse pattern from text2image-models.ts
import type { UpscaleModel } from "@/components/editor/media-panel/views/ai-types";

export const UPSCALE_MODEL_ORDER = [...] as const;
export const UPSCALE_MODELS: Record<string, UpscaleModel> = {...};
export function getUpscaleModelEntriesInPriorityOrder() {...}
```
**Reference:** Copy structure from `qcut/apps/web/src/lib/text2image-models.ts`

#### Task 1.2: Extend AI Types
**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
```typescript
// Add to existing file
export interface UpscaleModel extends BaseAIModel {
  category: 'upscale';
  maxScale: number;
  supportedScales: number[];
  features: {
    denoising?: boolean;
    sharpening?: boolean;
    creativity?: boolean;
    overlappingTiles?: boolean;
    professionalGrade?: boolean;
  };
}

export type ModelCategory = 'generation' | 'edit' | 'upscale';
```

#### Task 1.3: Update AI Constants
**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
```typescript
// Add upscale model endpoints
export const UPSCALE_MODEL_ENDPOINTS = {
  "crystal-upscaler": "fal-ai/crystal-upscaler",
  "seedvr-upscale": "fal-ai/seedvr/upscale/image",
  "topaz-upscale": "fal-ai/topaz/upscale/image",
};
```

### Phase 2: Client Integration (Extend Existing Client)

#### Task 2.1: Extend Image Edit Client
**File to Modify:** `qcut/apps/web/src/lib/image-edit-client.ts`
```typescript
// Add to existing MODEL_ENDPOINTS
export const MODEL_ENDPOINTS: Record<string, ModelEndpoint> = {
  // ... existing models ...

  // Add upscale models
  "crystal-upscaler": {
    endpoint: "fal-ai/crystal-upscaler",
    defaultParams: {
      scale_factor: 4,
      denoise: 0.5,
    },
  },
  "seedvr-upscale": {
    endpoint: "fal-ai/seedvr/upscale/image",
    defaultParams: {
      scale_factor: 4,
      creativity: 0.3,
    },
  },
  "topaz-upscale": {
    endpoint: "fal-ai/topaz/upscale/image",
    defaultParams: {
      scale_factor: 4,
      overlapping_tiles: true,
    },
  },
};

// Add new function for upscaling (reuse existing pattern)
export async function upscaleImage(
  request: ImageUpscaleRequest,
  onProgress?: ImageEditProgressCallback
): Promise<ImageEditResponse> {
  // Reuse pattern from editImage function
}
```

#### Task 2.2: Create Upscale Request Interface
**File to Modify:** `qcut/apps/web/src/lib/image-edit-client.ts`
```typescript
export interface ImageUpscaleRequest {
  imageUrl: string;
  model: "crystal-upscaler" | "seedvr-upscale" | "topaz-upscale";
  scaleFactor?: number;
  denoise?: number;
  creativity?: number;
  overlappingTiles?: boolean;
  outputFormat?: "png" | "jpeg" | "webp";
}
```

### Phase 3: Store Management (Extend Existing Store)

#### Task 3.1: Create Upscale Store
**File to Create:** `qcut/apps/web/src/stores/upscale-store.ts`
```typescript
// Reuse pattern from text2image-store.ts
import { create } from "zustand";
import { UPSCALE_MODEL_ORDER } from "@/lib/upscale-models";

interface UpscaleStore {
  selectedModel: string;
  scaleFactor: number;
  modelSettings: Record<string, any>;
  setSelectedModel: (model: string) => void;
  setScaleFactor: (factor: number) => void;
  updateModelSettings: (settings: Record<string, any>) => void;
}

export const useUpscaleStore = create<UpscaleStore>((set) => ({
  selectedModel: UPSCALE_MODEL_ORDER[0],
  scaleFactor: 4,
  modelSettings: {},
  // ... methods
}));
```
**Reference:** Copy pattern from `qcut/apps/web/src/stores/text2image-store.ts`

### Phase 4: UI Components (Reuse Existing Components)

#### Task 4.1: Create Model Type Selector
**File to Create:** `qcut/apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`
```typescript
// Reusable component for all model types
export function ModelTypeSelector({
  selected,
  onChange,
}: {
  selected: ModelCategory;
  onChange: (type: ModelCategory) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-secondary/50 rounded-md">
      <button onClick={() => onChange('generation')}>Generation</button>
      <button onClick={() => onChange('edit')}>Edit</button>
      <button onClick={() => onChange('upscale')}>Upscale</button>
    </div>
  );
}
```

#### Task 4.2: Create Upscale Settings Component
**File to Create:** `qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx`
```typescript
// Reuse UI components from existing views
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function UpscaleSettings({ model }: { model: string }) {
  // Model-specific settings UI
}
```
**Reference:** Copy patterns from `qcut/apps/web/src/components/editor/media-panel/views/video-edit-upscale.tsx`

#### Task 4.3: Integrate into AI Images View
**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx`
```typescript
// Add model type selector at top
import { ModelTypeSelector } from "./model-type-selector";
import { useUpscaleStore } from "@/stores/upscale-store";

// Add state for model type
const [modelType, setModelType] = useState<ModelCategory>('generation');

// Conditionally render based on model type
{modelType === 'upscale' && <UpscaleModelsList />}
```

### Phase 5: Hook Integration (Reuse Existing Hooks)

#### Task 5.1: Extend AI Generation Hook
**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
```typescript
// Add upscale handling to existing hook
export function useAIGeneration() {
  // ... existing code ...

  const handleUpscale = async (request: ImageUpscaleRequest) => {
    // Reuse existing progress tracking pattern
    const response = await upscaleImage(request, onProgress);
    // Handle response
  };

  return {
    // ... existing returns ...
    handleUpscale,
  };
}
```

### Phase 6: Testing & Validation

#### Task 6.1: Add Upscale Tests
**File to Create:** `qcut/apps/web/src/test/upscale-models.test.ts`
```typescript
// Test model configuration and API integration
import { UPSCALE_MODELS, UPSCALE_MODEL_ORDER } from "@/lib/upscale-models";

describe("Upscale Models", () => {
  test("all models have required fields", () => {
    // Validate model structure
  });

  test("endpoints are valid", () => {
    // Validate FAL API endpoints
  });
});
```

#### Task 6.2: Update E2E Tests
**File to Modify:** `qcut/apps/web/src/test/e2e/ai-enhancement-export-integration.e2e.ts`
```typescript
// Add upscale workflow tests
test("upscale image workflow", async () => {
  // Test model selection
  // Test settings adjustment
  // Test processing
});
```

### Phase 7: Documentation & Cleanup

#### Task 7.1: Update Type Definitions
**File to Modify:** `qcut/apps/web/src/types/ai-generation.ts`
```typescript
// Add upscale-related types to centralized location
export type UpscaleModelId = "crystal-upscaler" | "seedvr-upscale" | "topaz-upscale";
export interface UpscaleResult {
  url: string;
  scale: number;
  dimensions: { width: number; height: number };
}
```

#### Task 7.2: Update Environment Variables
**File to Modify:** `qcut/apps/web/.env.example`
```env
# Existing FAL API key will work for upscale models
VITE_FAL_API_KEY=your_fal_api_key
```

### Maintenance Strategy

1. **Code Reuse Principles:**
   - Reuse existing FAL API client patterns from `image-edit-client.ts`
   - Copy store patterns from `text2image-store.ts`
   - Reuse UI components from `video-edit-upscale.tsx`
   - Extend existing hooks instead of creating new ones

2. **Naming Conventions:**
   - Follow existing pattern: `{feature}-{type}.{ext}`
   - Example: `upscale-models.ts`, `upscale-store.ts`, `upscale-settings.tsx`

3. **Testing Strategy:**
   - Unit tests for model configuration
   - Integration tests for API calls
   - E2E tests for complete workflow

4. **Long-term Maintenance:**
   - Keep all upscale logic in dedicated files for easy updates
   - Use TypeScript interfaces for type safety
   - Document FAL API changes in comments
   - Version control model configurations

5. **Performance Considerations:**
   - Lazy load upscale components only when needed
   - Cache model configurations
   - Reuse existing image preview components

---
*Last Updated: November 2025* · *Status: In Progress - Upscale Integration with Implementation Plan*
