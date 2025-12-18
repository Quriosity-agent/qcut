# Text-to-Image - Supported Models

This document lists all the AI models supported for text-to-image generation in QCut.

## Overview

The Text-to-Image panel supports **14 different AI models** from various providers including Google, ByteDance, Black Forest Labs, OpenAI, Alibaba, fal.ai, and Tongyi-MAI.

---

## Supported Models

### 1. Gemini 3 Pro
- **Provider:** Google
- **Quality Rating:** 5/5
- **Speed Rating:** 3/5
- **Estimated Cost:** $0.15-0.30
- **Max Resolution:** 4096x4096 (4K)
- **Description:** Google's state-of-the-art image generation with exceptional photorealism and long prompt support
- **Best For:**
  - Photorealistic images
  - Long detailed prompts (up to 50K chars)
  - High-resolution outputs
  - Commercial photography
  - Product visualization
- **Strengths:**
  - Exceptional photorealism (Google's latest)
  - Supports extremely long prompts (50,000 characters)
  - Multiple resolution options (1K/2K/4K)
  - Wide aspect ratio support (11 options)
  - Consistent quality across styles
- **Limitations:**
  - Higher cost than budget models ($0.15/image)
  - 4K outputs double the cost
  - Slower generation (quality focus)
  - No seed control for reproducibility
- **Parameters:**
  - Aspect Ratio: auto, 1:1, 4:3, 3:4, 16:9, 9:16, 21:9, 9:21, 3:2, 2:3, 5:4, 4:5
  - Resolution: 1K, 2K, 4K (default: 1K)
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png, webp (default: png)

---

### 2. GPT Image 1.5
- **Provider:** OpenAI
- **Quality Rating:** 5/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04-0.08
- **Max Resolution:** 1536x1536
- **Description:** OpenAI's GPT Image 1.5 for high-fidelity image generation with strong prompt adherence
- **Best For:**
  - High-fidelity image generation
  - Strong prompt adherence
  - Transparent backgrounds for compositing
  - Commercial content creation
- **Strengths:**
  - Excellent prompt adherence
  - Transparent background support
  - Multiple output formats (png, jpeg, webp)
  - Consistent quality across styles
- **Limitations:**
  - Limited resolution options (3 sizes)
  - No guidance scale control
  - No seed for reproducibility
- **Parameters:**
  - Image Size: 1024x1024, 1536x1024, 1024x1536 (default: 1024x1024)
  - Background: auto, transparent, opaque (default: auto)
  - Quality: low, medium, high (default: high)
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png, webp (default: png)

---

### 3. Nano Banana
- **Provider:** Google
- **Quality Rating:** 4/5
- **Speed Rating:** 5/5
- **Estimated Cost:** $0.039
- **Max Resolution:** 2048x2048
- **Description:** Google/Gemini-powered model for fast, cost-effective text-to-image generation with optional editing
- **Best For:**
  - Cost-effective image editing
  - Smart content understanding
  - Quick image modifications
  - Format-specific outputs
- **Strengths:**
  - Google/Gemini AI technology
  - Very cost effective ($0.039/image)
  - Multiple output formats
  - Smart contextual understanding
  - Provides edit descriptions
- **Limitations:**
  - Less advanced than SeedDream V4
  - No flexible sizing options
  - Standard prompt length limits
- **Parameters:**
  - Aspect Ratio: 1:1, 4:3, 3:4, 16:9, 9:16 (default: 1:1)
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png (default: png)
  - Sync Mode: boolean (default: false)

---

### 4. SeedDream v4.5
- **Provider:** ByteDance
- **Quality Rating:** 5/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04-0.08
- **Max Resolution:** 4096x4096 (4K)
- **Description:** ByteDance's latest unified image generation model with up to 4K resolution
- **Best For:**
  - High-resolution image generation
  - Commercial content creation
  - Product photography
  - Artistic illustrations
  - Up to 4K output
- **Strengths:**
  - Up to 4K resolution output
  - Unified generation architecture
  - Commercial license
  - No cold starts
  - Fast generation speed
- **Limitations:**
  - Higher cost for 4K output
  - May require specific prompt formatting
- **Parameters:**
  - Image Size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto_2K, auto_4K (default: auto_2K)
  - Number of images: 1-6 (default: 1)
  - Seed: optional (0-2,147,483,647)
  - Enable Safety Checker: boolean (default: true)

---

### 5. Z-Image Turbo
- **Provider:** Tongyi-MAI
- **Quality Rating:** 4/5
- **Speed Rating:** 5/5
- **Estimated Cost:** $0.03-0.05
- **Max Resolution:** 2048x2048
- **Description:** Super fast 6B parameter text-to-image model by Tongyi-MAI, optimized for speed
- **Best For:**
  - Fast generation
  - Quick iterations
  - Prototyping
  - Cost-effective generation
- **Strengths:**
  - Very fast generation speed
  - 6B parameter model
  - H100 GPU acceleration
  - Cost-effective
  - Good for rapid prototyping
- **Limitations:**
  - Newer model with less community testing
  - May not match photorealistic models
  - Limited advanced customization
- **Parameters:**
  - Image Size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9 (default: landscape_4_3)
  - Number of inference steps: 1-30 (default: 8)
  - Number of images: 1-4 (default: 1)
  - Output Format: jpeg, png, webp (default: png)
  - Enable Safety Checker: boolean (default: true)
  - Seed: optional

---

### 6. FLUX 2 Flex
- **Provider:** Black Forest Labs
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.06/MP
- **Max Resolution:** 2048x2048
- **Description:** Text-to-image with adjustable inference steps, guidance scale, and enhanced typography
- **Best For:**
  - Fine-tuned control over generation
  - Typography and text rendering
  - Professional content creation
- **Strengths:**
  - Adjustable inference steps for quality/speed tradeoff
  - Enhanced typography capabilities
  - Cost-effective per megapixel pricing
- **Limitations:**
  - Pricing scales with resolution
  - Limited aspect ratio options vs FLUX Pro Ultra
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: landscape_4_3)
  - Guidance Scale: 1.5-10 (default: 3.5)
  - Number of inference steps: 2-50 (default: 28)
  - Enable Prompt Expansion: boolean (default: true)
  - Output Format: jpeg, png (default: jpeg)

---

### 7. SeedDream v4
- **Provider:** ByteDance
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04-0.08
- **Max Resolution:** 1536x1536
- **Description:** ByteDance's flagship SeedDream v4 text-to-image model with optional multi-image editing and unified architecture
- **Best For:**
  - High-fidelity text-to-image generation
  - Cinematic concept art with long prompts
  - Hybrid workflows that mix generation and editing
  - Advanced content modification pipelines
- **Strengths:**
  - Native text-to-image endpoint with editing flexibility
  - Processes multiple images simultaneously
  - Unified generation and editing architecture
  - Flexible output sizing
  - Enhanced prompt understanding (5000 chars)
  - Advanced safety controls
- **Limitations:**
  - Higher complexity than V3
  - May require more specific prompts
  - Potentially slower for simple edits
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: square_hd)
  - Max Images: 1-6 (default: 1)
  - Number of images: 1-4 (default: 1)
  - Sync Mode: boolean (default: false)
  - Enable Safety Checker: boolean (default: true)
  - Seed: optional

---

### 8. Reve Text-to-Image
- **Provider:** fal.ai
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04
- **Max Resolution:** Auto (aspect-ratio dependent)
- **Description:** Cost-effective AI image generation with strong aesthetic quality and accurate text rendering
- **Best For:**
  - Cost-effective image generation
  - Text rendering in images
  - General-purpose image creation
  - Aesthetic quality outputs
  - Multiple aspect ratios
- **Strengths:**
  - Very affordable ($0.04 per image)
  - Strong aesthetic quality
  - Accurate text rendering
  - Flexible aspect ratios (7 options)
  - Multiple output formats
  - Fast generation speed
- **Limitations:**
  - Lower resolution than premium models
  - Limited customization parameters
  - No guidance scale control
  - No seed control for reproducibility
- **Parameters:**
  - Aspect Ratio: 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1 (default: 3:2)
  - Number of images: 1-4 (default: 1)
  - Output Format: png, jpeg, webp (default: png)

---

### 9. WAN v2.2
- **Provider:** fal.ai
- **Quality Rating:** 5/5
- **Speed Rating:** 3/5
- **Estimated Cost:** $0.06-0.10
- **Max Resolution:** 2048x2048
- **Description:** High-resolution photorealistic model with powerful prompt understanding
- **Best For:**
  - High-resolution photorealistic images
  - Detailed character portraits
  - Professional photography-style images
  - Complex scene generation
  - Commercial content creation
- **Strengths:**
  - Exceptional photorealism
  - Powerful prompt understanding
  - High-resolution output
  - Excellent detail preservation
  - Good at complex compositions
- **Limitations:**
  - Slower generation time
  - Higher computational cost
  - May struggle with highly abstract concepts
  - Less creative interpretation than artistic models
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: square_hd)
  - Number of inference steps: 10-50 (default: 27)
  - Guidance Scale: 1-10 (default: 3.5)
  - Seed: optional

---

### 10. Imagen4 Ultra
- **Provider:** Google
- **Quality Rating:** 5/5
- **Speed Rating:** 3/5
- **Estimated Cost:** $0.08-0.12
- **Max Resolution:** 2048x2048
- **Description:** Google's latest high-quality model with exceptional photorealism
- **Best For:**
  - Photorealistic images
  - Product photography
  - Architectural visualization
  - Nature and landscapes
  - Portrait photography
- **Strengths:**
  - Exceptional photorealism
  - Excellent prompt adherence
  - High detail and clarity
  - Natural lighting and shadows
  - Advanced understanding of complex prompts
- **Limitations:**
  - Slower generation time
  - Higher cost per image
  - May struggle with highly stylized art
  - Limited creative interpretation
- **Parameters:**
  - Aspect Ratio: 1:1, 4:3, 3:4, 16:9, 9:16 (default: 1:1)
  - Number of images: 1-4 (default: 1)

---

### 11. Qwen Image
- **Provider:** Alibaba
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04-0.08
- **Max Resolution:** 2048x2048
- **Description:** Alibaba's versatile image generation model with excellent prompt understanding
- **Best For:**
  - Versatile image generation
  - Natural scene composition
  - Character and object generation
  - Cultural and artistic themes
  - Balanced realism and creativity
- **Strengths:**
  - Strong prompt understanding
  - Good balance of speed and quality
  - Versatile across different styles
  - Cost-effective generation
  - Supports negative prompts
- **Limitations:**
  - Not as photorealistic as specialized models
  - May require prompt engineering for best results
  - Less detailed than ultra-high-end models
  - Limited creative interpretation for abstract concepts
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: landscape_4_3)
  - Number of inference steps: 2-50 (default: 30)
  - Guidance Scale: 0-20 (default: 2.5)
  - Number of images: 1-4 (default: 1)
  - Output Format: png, jpeg, webp (default: png)
  - Negative Prompt: string (default: " ")
  - Seed: optional

---

### 12. FLUX Pro v1.1 Ultra
- **Provider:** Black Forest Labs
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.05-0.09
- **Max Resolution:** 2048x2048
- **Description:** Latest FLUX model with enhanced detail and professional versatility
- **Best For:**
  - Professional content creation
  - Versatile image generation
  - Balanced realism and creativity
  - Commercial applications
  - High-resolution outputs
- **Strengths:**
  - Excellent balance of quality and speed
  - Professional-grade output
  - Versatile across many styles
  - Good prompt understanding
  - High maximum resolution
- **Limitations:**
  - Not as creative as SeedDream
  - Not as photorealistic as Imagen4
  - Mid-range pricing
  - May require prompt engineering
- **Parameters:**
  - Aspect Ratio: 21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21 (default: 16:9)
  - Number of images: 1-4 (default: 1)
  - Safety Tolerance: 1-6 (default: 2)
  - Enable Safety Checker: boolean (default: true)

---

### 13. SeedDream v3
- **Provider:** ByteDance
- **Quality Rating:** 4/5
- **Speed Rating:** 5/5
- **Estimated Cost:** $0.03-0.06
- **Max Resolution:** 1536x1536
- **Description:** ByteDance's creative model optimized for artistic and stylized generation
- **Best For:**
  - Artistic illustrations
  - Concept art and design
  - Stylized portraits
  - Creative interpretations
  - Abstract and surreal art
- **Strengths:**
  - Fast generation speed
  - Creative and artistic output
  - Good style transfer capabilities
  - Cost-effective
  - Excellent for iterative design
- **Limitations:**
  - Less photorealistic than Imagen4
  - May over-stylize realistic requests
  - Lower maximum resolution
  - Sometimes inconsistent quality
- **Parameters:**
  - Image Size: square_hd, square, portrait_3_4, portrait_9_16, landscape_4_3, landscape_16_9 (default: square_hd)
  - Guidance Scale: 1-10 (default: 2.5)
  - Number of images: 1-4 (default: 1)
  - Seed: optional (0-2,147,483,647)

---

### 14. SeedDream v4.5 Edit
- **Provider:** ByteDance
- **Quality Rating:** 5/5
- **Speed Rating:** 4/5
- **Estimated Cost:** $0.04-0.08
- **Max Resolution:** 4096x4096 (4K)
- **Description:** ByteDance's image editing model with multi-image compositing support (up to 10 images)
- **Best For:**
  - Image editing and adjustment
  - Multi-image compositing
  - Background replacement
  - Object manipulation
  - Style transfer
- **Strengths:**
  - Supports up to 10 input images
  - Multi-image compositing
  - Up to 4K output
  - Unified architecture with generation
  - Commercial license
- **Limitations:**
  - Requires image upload to FAL
  - Higher latency for multiple images
- **Parameters:**
  - Image Size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto_2K, auto_4K (default: auto_2K)
  - Number of images: 1-6 (default: 1)
  - Seed: optional

---

## Model Categories

### Photorealistic
- Imagen4 Ultra
- WAN v2.2
- Gemini 3 Pro
- GPT Image 1.5

### Artistic
- SeedDream v3
- SeedDream v4
- SeedDream v4.5
- Qwen Image

### Versatile
- Qwen Image
- FLUX Pro v1.1 Ultra
- FLUX 2 Flex
- Nano Banana
- Reve Text-to-Image
- Z-Image Turbo
- SeedDream v4.5 Edit

### Fast
- SeedDream v3
- Nano Banana
- Z-Image Turbo
- Qwen Image
- Reve Text-to-Image
- FLUX 2 Flex

### High Quality
- Imagen4 Ultra
- WAN v2.2
- FLUX Pro v1.1 Ultra
- FLUX 2 Flex
- SeedDream v4
- SeedDream v4.5
- Gemini 3 Pro
- GPT Image 1.5

### Cost Effective
- SeedDream v3
- Nano Banana
- Z-Image Turbo
- Qwen Image
- Reve Text-to-Image
- FLUX 2 Flex

---

## Cost Comparison

**Most Affordable:**
1. Nano Banana - $0.039
2. SeedDream v3 - $0.03-0.06
3. Z-Image Turbo - $0.03-0.05
4. Reve Text-to-Image - $0.04
5. Qwen Image - $0.04-0.08

**Premium Tier:**
1. Gemini 3 Pro - $0.15-0.30
2. Imagen4 Ultra - $0.08-0.12
3. WAN v2.2 - $0.06-0.10

---

## Technical Implementation

All models are accessed via the FAL.ai API through the `text2image-models.ts` module located at:
```
qcut/apps/web/src/lib/text2image-models.ts
```

The Text-to-Image UI is located at:
```
qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx
```

---

## Model Selection Priority Order

Models are prioritized in this order (premium to cost-effective):
1. Gemini 3 Pro
2. GPT Image 1.5
3. Nano Banana
4. SeedDream v4.5
5. Z-Image Turbo
6. FLUX 2 Flex
7. SeedDream v4
8. Reve Text-to-Image
9. WAN v2.2
10. Imagen4 Ultra
11. Qwen Image
12. FLUX Pro v1.1 Ultra
13. SeedDream v3

---

## Related Documentation

- [Text2Image Models API](../../apps/web/src/lib/text2image-models.ts)
- [Text2Image View Component](../../apps/web/src/components/editor/media-panel/views/text2image.tsx)
- [Text2Image Store](../../apps/web/src/stores/text2image-store.ts)
