# Adjustment Panel - Supported Models

This document lists all the AI models supported by the Adjustment Panel for image editing in QCut.

## Overview

The Adjustment Panel supports **10 different AI image editing models** from various providers including Google, ByteDance, FLUX, Black Forest Labs, OpenAI, and fal.ai.

---

## Supported Models

### 1. Gemini 3 Pro Edit
- **Provider:** Google
- **Estimated Cost:** $0.15
- **Description:** Google's advanced image editing with exceptional context understanding
- **Key Features:**
  - Long prompt support (50K characters)
  - Resolution options (1K/2K/4K)
  - Smart context understanding
  - Multiple aspect ratios
- **Parameters:**
  - Number of images: 1-4 (default: 1)
  - Resolution: 1K, 2K, 4K (default: 1K)
  - Aspect Ratio: auto, 1:1, 4:3, 3:4, 16:9, 9:16, 21:9, 3:2, 2:3, 5:4, 4:5
  - Output Format: jpeg, png, webp (default: png)
  - Sync Mode: boolean (default: false)

---

### 2. Nano Banana
- **Provider:** Google
- **Estimated Cost:** $0.039
- **Description:** Smart AI-powered editing with Google/Gemini technology
- **Key Features:**
  - Smart understanding
  - Cost effective
  - Multiple formats
  - Edit descriptions
- **Parameters:**
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png (default: png)
  - Sync Mode: boolean (default: false)

---

### 3. SeedDream v4.5 Edit
- **Provider:** ByteDance
- **Estimated Cost:** $0.04-0.08
- **Description:** ByteDance's latest image editing with up to 4K resolution and multi-image compositing
- **Key Features:**
  - Up to 4K resolution
  - Multi-image compositing (up to 10)
  - Auto 2K/4K presets
  - Commercial license
- **Parameters:**
  - Image Size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto_2K, auto_4K (default: auto_2K)
  - Max Images: 1-10 (default: 1)
  - Number of images: 1-6 (default: 1)
  - Sync Mode: boolean (default: false)
  - Enable Safety Checker: boolean (default: true)
  - Seed: optional

---

### 4. Reve Edit
- **Provider:** fal.ai
- **Estimated Cost:** $0.04
- **Description:** Cost-effective image editing with strong aesthetic quality
- **Key Features:**
  - Cost-effective editing
  - Strong aesthetics
  - Fast processing
  - Multiple formats
- **Parameters:**
  - Number of images: 1-4 (default: 1)
  - Output Format: png, jpeg, webp (default: png)
  - Sync Mode: boolean (default: false)

---

### 5. SeedDream v4
- **Provider:** ByteDance
- **Estimated Cost:** $0.04-0.08
- **Description:** Advanced multi-image editing with unified architecture
- **Key Features:**
  - Multi-image processing
  - Flexible sizing
  - Enhanced prompts
  - Advanced controls
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: square_hd)
  - Custom Range: 1024-4096px (step: 64)
  - Max Images: 1-6 (default: 1)
  - Number of images: 1-4 (default: 1)
  - Sync Mode: boolean (default: false)
  - Enable Safety Checker: boolean (default: true)
  - Seed: optional

---

### 6. SeedEdit v3
- **Provider:** ByteDance
- **Estimated Cost:** $0.05-0.10
- **Description:** Precise photo editing with content preservation
- **Key Features:**
  - Photo retouching
  - Object modification
  - Realistic edits
- **Parameters:**
  - Guidance Scale: 1-10 (default: 1.0, step: 0.1)
  - Seed: optional

---

### 7. FLUX Pro Kontext
- **Provider:** FLUX
- **Estimated Cost:** $0.15-0.25
- **Description:** Context-aware editing with scene transformations
- **Key Features:**
  - Style changes
  - Object replacement
  - Scene modification
- **Parameters:**
  - Guidance Scale: 1-20 (default: 3.5, step: 0.5)
  - Steps: 1-50 (default: 28)
  - Safety Tolerance: 1-6 (default: 2)
  - Number of images: 1-4 (default: 1)

---

### 8. FLUX Pro Kontext Max
- **Provider:** FLUX
- **Estimated Cost:** $0.25-0.40
- **Description:** Advanced editing for complex tasks and typography
- **Key Features:**
  - Complex edits
  - Typography
  - Professional adjustments
- **Parameters:**
  - Guidance Scale: 1-20 (default: 3.5, step: 0.5)
  - Steps: 1-50 (default: 28)
  - Safety Tolerance: 1-6 (default: 2)
  - Number of images: 1-4 (default: 1)

---

### 9. FLUX 2 Flex Edit
- **Provider:** Black Forest Labs
- **Estimated Cost:** $0.06/MP
- **Description:** Flexible image editing with adjustable parameters and enhanced control
- **Key Features:**
  - Auto image size detection
  - Adjustable inference steps
  - Prompt expansion
  - Fine-tuned guidance control
- **Parameters:**
  - Guidance Scale: 1.5-10 (default: 3.5, step: 0.1)
  - Steps: 2-50 (default: 28)
  - Safety Tolerance: 1-5 (default: 2)
  - Number of images: 1 (fixed)
  - Output Format: jpeg, png (default: jpeg)
  - Enable Prompt Expansion: boolean (default: true)

---

### 10. GPT Image 1.5 Edit
- **Provider:** OpenAI
- **Estimated Cost:** $0.04-0.08
- **Description:** OpenAI's GPT Image 1.5 for high-fidelity image editing with strong prompt adherence
- **Key Features:**
  - High prompt adherence
  - Transparent background support
  - Input fidelity control
  - Multiple output formats
- **Parameters:**
  - Image Size: auto, 1024x1024, 1536x1024, 1024x1536 (default: auto)
  - Background: auto, transparent, opaque (default: auto)
  - Quality: low, medium, high (default: high)
  - Input Fidelity: low, high (default: high)
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png, webp (default: png)
  - Sync Mode: boolean (default: false)

---

## Model Selection Criteria

When choosing a model, consider:

1. **Cost:** Ranges from $0.039 (Nano Banana) to $0.40 (FLUX Pro Kontext Max)
2. **Quality:** Higher-end models like FLUX Pro Kontext Max and Gemini 3 Pro Edit offer better quality
3. **Features:** Some models support multi-image processing, higher resolutions, or special features like transparent backgrounds
4. **Speed:** Some models offer sync mode for faster processing
5. **Use Case:** Different models excel at different tasks (retouching, scene transformation, typography, etc.)

---

## Technical Implementation

All models are accessed via the FAL.ai API through the `image-edit-client.ts` module located at:
```
qcut/apps/web/src/lib/image-edit-client.ts
```

The model capabilities are defined in:
```
qcut/apps/web/src/lib/image-edit-capabilities.ts
```

The Adjustment Panel UI is located at:
```
qcut/apps/web/src/components/editor/adjustment/index.tsx
```

---

## Related Documentation

- [Image Edit Client API](../../apps/web/src/lib/image-edit-client.ts)
- [Adjustment Panel Component](../../apps/web/src/components/editor/adjustment/index.tsx)
- [Model Selector Component](../../apps/web/src/components/editor/adjustment/model-selector.tsx)
