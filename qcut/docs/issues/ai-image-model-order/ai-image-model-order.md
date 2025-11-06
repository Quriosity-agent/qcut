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
│ │ ☑ ESRGAN Ultra       $0.02/img  │ │
│ │ ☐ Real-ESRGAN 4x     $0.03/img  │ │
│ │ ☐ GFPGAN Face        $0.04/img  │ │
│ │ ☐ CodeFormer         $0.05/img  │ │
│ │ ☐ Aura SR            $0.01/img  │ │
│ └─────────────────────────────────┘ │
│                                      │
│ • UPSCALE SETTINGS                   │
│ Scale Factor: [2x] [4x] [8x]         │
│ Face Enhancement: [Toggle]           │
│ Denoise Level: [Slider 0-100]       │
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
  "esrgan-ultra",
  "real-esrgan-4x",
  "gfpgan-face",
  "codeformer",
  "aura-sr"
] as const;

export const UPSCALE_MODELS: Record<string, UpscaleModel> = {
  "esrgan-ultra": {
    id: "esrgan-ultra",
    name: "ESRGAN Ultra",
    price: "0.02",
    maxScale: 8,
    supportedScales: [2, 4, 8],
    features: {
      denoising: true,
      sharpening: true
    },
    endpoint: "fal-ai/esrgan",
    category: "upscale"
  },
  "real-esrgan-4x": {
    id: "real-esrgan-4x",
    name: "Real-ESRGAN 4x",
    price: "0.03",
    maxScale: 4,
    supportedScales: [2, 4],
    features: {
      denoising: true,
      sharpening: true
    },
    endpoint: "fal-ai/real-esrgan",
    category: "upscale"
  },
  "gfpgan-face": {
    id: "gfpgan-face",
    name: "GFPGAN Face",
    price: "0.04",
    maxScale: 4,
    supportedScales: [2, 4],
    features: {
      faceEnhancement: true,
      denoising: true
    },
    endpoint: "fal-ai/gfpgan",
    category: "upscale"
  },
  "codeformer": {
    id: "codeformer",
    name: "CodeFormer",
    price: "0.05",
    maxScale: 4,
    supportedScales: [1, 2, 4],
    features: {
      faceEnhancement: true,
      denoising: true,
      sharpening: true
    },
    endpoint: "fal-ai/codeformer",
    category: "upscale"
  },
  "aura-sr": {
    id: "aura-sr",
    name: "Aura SR",
    price: "0.01",
    maxScale: 4,
    supportedScales: [2, 4],
    features: {
      denoising: true
    },
    endpoint: "fal-ai/aura-sr",
    category: "upscale"
  }
};
```

#### 4. Upscale Settings Component
```typescript
interface UpscaleSettings {
  scaleFactor: 2 | 4 | 8;
  faceEnhancement: boolean;
  denoise: boolean;
  denoiseLevel: number; // 0-100
  preserveDetails: boolean;
}
```

### User Flow

1. **Model Type Selection**: User clicks "Upscale" tab
2. **Model List Update**: UI shows upscale models with pricing
3. **Model Selection**: User selects one or more upscale models
4. **Settings Configuration**:
   - Scale factor selector appears (2x, 4x, 8x)
   - Enhancement toggles based on model capabilities
   - Denoise slider for fine-tuning
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

### Advantages of Option 1

1. **Clear Separation**: Users immediately understand they're in "upscale mode"
2. **Dedicated Settings**: Upscale-specific controls without cluttering other interfaces
3. **Consistency**: Follows existing pattern of model selection with pricing
4. **Scalability**: Easy to add more upscale models in the future
5. **User Experience**: Intuitive workflow from model selection to result

---
*Last Updated: November 2025* · *Status: In Progress - Upscale Integration*
