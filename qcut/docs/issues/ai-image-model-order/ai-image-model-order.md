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
> **Reviewer (Codex):** Derive UpscaleModelId from UPSCALE_MODEL_ORDER and type UPSCALE_MODELS accordingly so IDs stay in sync, and consider extracting shared fields from Text2ImageModel to avoid duplicating quality or cost metadata.

**File to Create:** `qcut/apps/web/src/lib/upscale-models.ts`
```typescript
// Reuse pattern from text2image-models.ts
export interface UpscaleModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  endpoint: string;

  // Quality indicators
  qualityRating: number;
  speedRating: number;

  // Cost information
  estimatedCost: string;
  costPerImage: number;

  // Technical specifications
  maxScale: number;
  supportedScales: number[];

  // Model-specific parameters
  defaultParams: Record<string, any>;

  // Features
  features: {
    denoising?: boolean;
    sharpening?: boolean;
    creativity?: boolean;
    overlappingTiles?: boolean;
    faceEnhancement?: boolean;
  };

  // Use case recommendations
  bestFor: string[];
  strengths: string[];
  limitations: string[];
}

export const UPSCALE_MODEL_ORDER = [
  "crystal-upscaler",
  "seedvr-upscale",
  "topaz-upscale"
] as const;

export const UPSCALE_MODELS: Record<string, UpscaleModel> = {
  // Implementation here
};
```
**Status:** ✅ Completed – Added `qcut/apps/web/src/lib/upscale-models.ts` with the curated catalog, derived IDs, endpoint map, and helper for ordered iteration (2025-11-07).
**Reference:** Copy structure from `qcut/apps/web/src/lib/text2image-models.ts`

#### Task 1.2: Extend AI Types
> **Reviewer (Codex):** Before extending ModelCategory, add the alias to ai-types.ts and make sure every consumer (AI tabs, etc.) understands the new upscale option, otherwise widening the union will just break type checking.

**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
```typescript
// Add to existing AIModel interface extensions
export interface UpscaleModelEndpoints {
  upscale: string;
}

export interface UpscaleModelParameters {
  scale_factor?: number;
  denoise?: number;
  creativity?: number;
  overlapping_tiles?: boolean;
  output_format?: "png" | "jpeg" | "webp";
  [key: string]: any;
}

// Extend existing category type
export type ModelCategory = "text" | "image" | "video" | "avatar" | "upscale";
```
**Status:** ✅ Completed – ai-types.ts now exports Upscale endpoints/parameter interfaces and a shared `ModelCategory` union that includes the upscale option (2025-11-07).

#### Task 1.3: Update AI Constants
> **Reviewer (Codex):** Place the FAL endpoints next to the upscale catalog rather than ai-constants.ts so lightweight image code does not need to import the thousand line video config to access three strings.

**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
```typescript
// Add upscale model endpoints
export const UPSCALE_MODEL_ENDPOINTS = {
  "crystal-upscaler": "fal-ai/crystal-upscaler",
  "seedvr-upscale": "fal-ai/seedvr/upscale/image",
  "topaz-upscale": "fal-ai/topaz/upscale/image",
};
```
**Status:** ✅ Completed – ai-constants.ts now re-exports `UPSCALE_MODEL_ENDPOINTS` from the shared catalog so lightweight image code can import just the curated map without pulling in video configuration (2025-11-07).

### Phase 2: Client Integration (Extend Existing Client)

#### Task 2.1: Extend Image Edit Client
> **Reviewer (Codex):** FAL upscale endpoints take a single image_url plus scale or denoise controls, so spell out that payload instead of saying the rest follows editImage, and drop prompt specific bits that do not apply.

**File to Modify:** `qcut/apps/web/src/lib/image-edit-client.ts`
```typescript
// Add to existing MODEL_ENDPOINTS (follows existing pattern)
export const MODEL_ENDPOINTS: Record<string, ModelEndpoint> = {
  // ... existing models (seededit, flux-kontext, etc.) ...

  // Add upscale models
  "crystal-upscaler": {
    endpoint: "fal-ai/crystal-upscaler",
    defaultParams: {
      scale_factor: 4,
      denoise: 0.5,
      output_format: "png",
    },
  },
  "seedvr-upscale": {
    endpoint: "fal-ai/seedvr/upscale/image",
    defaultParams: {
      scale_factor: 4,
      creativity: 0.3,
      output_format: "png",
    },
  },
  "topaz-upscale": {
    endpoint: "fal-ai/topaz/upscale/image",
    defaultParams: {
      scale_factor: 4,
      overlapping_tiles: true,
      output_format: "png",
    },
  },
};

// Add new function following editImage pattern
export async function upscaleImage(
  request: ImageUpscaleRequest,
  onProgress?: ImageEditProgressCallback
): Promise<ImageEditResponse> {
  // Validate API key (same as editImage)
  if (!FAL_API_KEY) {
    throw new Error("FAL API key not configured");
  }

  const modelConfig = MODEL_ENDPOINTS[request.model];
  if (!modelConfig) {
    throw new Error(`Unsupported model: ${request.model}`);
  }

  // Build payload following existing pattern
  const payload: any = {
    image_url: request.imageUrl,
    ...modelConfig.defaultParams,
  };

  // Override with user parameters
  if (request.scaleFactor !== undefined) {
    payload.scale_factor = request.scaleFactor;
  }
  // ... rest following editImage pattern
}
```
**Status:** ✅ Completed – image-edit-client.ts now registers the three upscale endpoints with tailored defaults and exposes a full `upscaleImage` helper that mirrors `editImage`, including queue polling and progress callbacks (2025-11-07).

#### Task 2.2: Create Upscale Request Interface
> **Reviewer (Codex):** Reuse UpscaleModelId for ImageUpscaleRequest.model and expose typed settings so UI sliders can rely on defined ranges instead of spreading string literals and any throughout the code.

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

#### Task 3.1: Extend Text2Image Store for Upscale Models
> **Reviewer (Codex):** Add a concrete UpscaleSettings type, initialize modelType or upscaleSettings in the store, and wire the new upscaleImage action through persistence or history so existing selectors keep working.

**File to Modify:** `qcut/apps/web/src/stores/text2image-store.ts`
```typescript
// Add to existing Text2ImageStore interface
interface Text2ImageStore {
  // ... existing state ...

  // Model type state
  modelType: "generation" | "edit" | "upscale";
  setModelType: (type: "generation" | "edit" | "upscale") => void;

  // Upscale-specific state
  upscaleSettings: {
    selectedModel: string;
    scaleFactor: number;
    denoise: number;
    creativity: number;
    overlappingTiles: boolean;
  };
  setUpscaleSettings: (settings: Partial<UpscaleSettings>) => void;

  // Upscale actions
  upscaleImage: (imageUrl: string) => Promise<void>;
}

// Add to implementation
modelType: "generation",
setModelType: (type) => set({ modelType: type }),

upscaleSettings: {
  selectedModel: "crystal-upscaler",
  scaleFactor: 4,
  denoise: 0.5,
  creativity: 0.3,
  overlappingTiles: false,
},
setUpscaleSettings: (settings) =>
  set((state) => ({
    upscaleSettings: { ...state.upscaleSettings, ...settings },
  })),
```
**Note:** Reusing existing store pattern avoids creating separate store file

### Phase 4: UI Components (Reuse Existing Components)

#### Task 4.1: Create Model Type Selector
> **Reviewer (Codex):** This selector mixes ModelCategory with generation or edit or upscale labels, so create a dedicated union or reuse generationMode, and wrap the buttons in the shared Button component with aria pressed for accessibility.

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
> **Reviewer (Codex):** Have this component read and update upscaleSettings from the store and drive sliders from UPSCALE_MODELS metadata, otherwise it is just a placeholder that cannot persist user choices.

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

#### Task 4.3: Integrate into Text2Image View
> **Reviewer (Codex):** Toggling modelType should not blank out selectedModels or strand edit mode, so add the necessary guards and an edit branch before replacing the existing generation selector wholesale.

**File to Modify:** `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx`
```typescript
// Add to imports
import { ModelTypeSelector } from "./model-type-selector";
import { UPSCALE_MODEL_ORDER, UPSCALE_MODELS } from "@/lib/upscale-models";

// Inside component, add model type state from store
const { modelType, setModelType } = useText2ImageStore();

// Replace existing model selection Card with conditional rendering
{modelType === 'generation' && (
  // Existing generation model selection
  <Card className="border-0 shadow-none">
    <CardHeader className="pb-2 pt-3">
      <CardTitle className="text-sm">
        {generationMode === "single"
          ? "Select Model"
          : `Select Models (${selectedModelCount} chosen)`}
      </CardTitle>
    </CardHeader>
    <CardContent className="pt-0">
      {/* Existing FloatingActionPanelRoot code */}
    </CardContent>
  </Card>
)}

{modelType === 'upscale' && (
  // New upscale model selection
  <Card className="border-0 shadow-none">
    <CardHeader className="pb-2 pt-3">
      <CardTitle className="text-sm">Select Upscale Model</CardTitle>
    </CardHeader>
    <CardContent>
      {UPSCALE_MODEL_ORDER.map((modelId) => (
        // Render upscale model options
      ))}
    </CardContent>
  </Card>
)}
```

### Phase 5: Hook Integration (Reuse Existing Hooks)

#### Task 5.1: Create Upscale Hook (Following Existing Pattern)
> **Reviewer (Codex):** Mirror use-ai-generation.ts by typing the settings, resetting progress on each call, and routing successful outputs back through addSelectedToMedia and history instead of bypassing the store.

**File to Create:** `qcut/apps/web/src/components/editor/media-panel/views/use-upscale-generation.ts`
```typescript
// Follow pattern from use-ai-generation.ts
import { useState, useCallback } from "react";
import { upscaleImage } from "@/lib/image-edit-client";
import { getMediaStoreUtils } from "@/stores/media-store-loader";
import { debugLog, debugError } from "@/lib/debug-config";

export function useUpscaleGeneration() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleUpscale = useCallback(async (
    imageUrl: string,
    model: string,
    settings: any
  ) => {
    setIsProcessing(true);
    setError(null);

    try {
      const response = await upscaleImage({
        imageUrl,
        model,
        ...settings
      }, (status) => {
        // Progress callback
        if (status.progress) {
          setProgress(status.progress);
        }
      });

      // Add to media store
      const mediaUtils = await getMediaStoreUtils();
      await mediaUtils.addImage(response.result_url);

      return response;
    } catch (err) {
      setError(err.message);
      debugError("Upscale failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    handleUpscale,
    isProcessing,
    progress,
    error,
  };
}
```
**Reference:** Pattern from `use-ai-generation.ts`

### Phase 6: Testing & Validation

#### Task 6.1: Add Upscale Tests
> **Reviewer (Codex):** Replace the TODOs with real assertions, for example verifying order arrays match the catalog and every model exposes the fields that the settings UI requires.

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
> **Reviewer (Codex):** Document how the E2E test will stub or gate FAL network calls, because running real upscale jobs in CI will either fail without network or incur costs.

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
> **Reviewer (Codex):** ai-generation.ts is explicitly scoped to video models per its header comment, so create a dedicated image or upscale types module instead of packing new types into that file.

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
> **Reviewer (Codex):** env.example already exports VITE_FAL_API_KEY, so clarify the existing comment rather than duplicating the variable.

**File to Modify:** `qcut/apps/web/.env.example`
```env
# Existing FAL API key will work for upscale models
VITE_FAL_API_KEY=your_fal_api_key
```

### Implementation Summary

#### Files to Create (4 files):
1. `qcut/apps/web/src/lib/upscale-models.ts` - Model configurations
2. `qcut/apps/web/src/components/editor/media-panel/views/model-type-selector.tsx` - UI selector
3. `qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx` - Settings UI
4. `qcut/apps/web/src/components/editor/media-panel/views/use-upscale-generation.ts` - Hook

#### Files to Modify (6 files):
1. `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` - Add types
2. `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` - Add endpoints
3. `qcut/apps/web/src/lib/image-edit-client.ts` - Add upscale function
4. `qcut/apps/web/src/stores/text2image-store.ts` - Add upscale state
5. `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx` - Integrate UI
6. `qcut/apps/web/src/types/ai-generation.ts` - Add upscale types

### Maintenance Strategy

1. **Code Reuse Principles:**
   - Reuse Text2ImageModel interface structure for UpscaleModel
   - Extend existing image-edit-client.ts with MODEL_ENDPOINTS pattern
   - Reuse text2image-store.ts instead of creating new store
   - Follow use-ai-generation.ts pattern for hooks

2. **Naming Conventions:**
   - Follow existing pattern: `{feature}-{type}.{ext}`
   - Example: `upscale-models.ts`, `upscale-settings.tsx`

3. **Testing Strategy:**
   - Unit tests for model configuration
   - Integration tests for API calls
   - E2E tests for complete workflow

4. **Long-term Maintenance:**
   - Keep upscale models in centralized configuration
   - Use TypeScript interfaces for type safety
   - Document FAL API endpoint changes
   - Version control model configurations

5. **Performance Considerations:**
   - Lazy load upscale components only when needed
   - Cache model configurations
   - Reuse existing image preview components from text2image view

---
*Last Updated: November 2025* · *Status: In Progress - Upscale Integration with Implementation Plan*
