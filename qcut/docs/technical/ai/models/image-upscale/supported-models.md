# Image Upscale - Supported Models

This document lists all the AI models supported for image upscaling in QCut.

## Overview

The Image Upscale feature supports **3 different AI upscaling models** from various providers including fal.ai, SeedVR Labs, and Topaz Labs. These models are optimized for enhancing image resolution while preserving and enhancing detail.

---

## Supported Models

### 1. Crystal Upscaler
- **Provider:** fal.ai
- **Price Tier:** Budget
- **Estimated Cost:** $0.02 / image
- **Cost Per Image:** $0.02
- **Quality Rating:** 3/5
- **Speed Rating:** 5/5
- **Max Scale:** 10x
- **Max Resolution:** Variable (depends on input × scale)
- **Description:** Balanced denoise and sharpening tuned for social posts and general workflows
- **Best For:**
  - Social posts
  - Marketing graphics
  - Quick client previews
- **Strengths:**
  - Great price/performance balance
  - Fast results (under 20s for 4x in tests)
  - Predictable color preservation
- **Limitations:**
  - Max scale limited to 10x
  - No creative stylization
  - No tiling controls
- **Parameters:**
  - **Scale Factor:** 2x, 4x, 6x, 8x, 10x (default: 4x)
  - **Denoise:** 0-100% (default: 45%)
  - **Output Format:** png, jpeg, webp (default: png)
- **Features:**
  - Denoising: ✅
  - Sharpening: ✅
  - Creativity: ❌
  - Overlapping Tiles: ❌
  - Face Enhancement: ❌

---

### 2. SeedVR Upscale
- **Provider:** SeedVR Labs
- **Price Tier:** Mid
- **Estimated Cost:** $0.05 / image
- **Cost Per Image:** $0.05
- **Quality Rating:** 4/5
- **Speed Rating:** 4/5
- **Max Scale:** 16x
- **Max Resolution:** Variable (depends on input × scale)
- **Description:** Creative-focused upscaler capable of hallucinating new detail up to 16x
- **Best For:**
  - Illustrations
  - Stylized renders
  - Faces that need extra detail
- **Strengths:**
  - Creativity slider adds tasteful variation
  - Up to 16x upscale support
  - Great for stylized or painterly work
- **Limitations:**
  - Can hallucinate unwanted details at high creativity
  - Slightly slower than Crystal Upscaler
  - No overlapping tile control
- **Parameters:**
  - **Scale Factor:** 2x, 4x, 6x, 8x, 12x, 16x (default: 6x)
  - **Denoise:** 0-100% (default: 35%)
  - **Creativity:** 0-100% (default: 40%)
    - Lower values: Preserve original texture
    - Higher values: More imaginative detail synthesis
  - **Output Format:** png, jpeg, webp (default: png)
- **Features:**
  - Denoising: ✅
  - Sharpening: ✅
  - Creativity: ✅ (unique feature)
  - Overlapping Tiles: ❌
  - Face Enhancement: ❌

---

### 3. Topaz Upscale
- **Provider:** Topaz Labs
- **Price Tier:** Pro
- **Estimated Cost:** $0.10 / image
- **Cost Per Image:** $0.10
- **Quality Rating:** 5/5
- **Speed Rating:** 3/5
- **Max Scale:** 16x
- **Max Resolution:** Variable (depends on input × scale)
- **Description:** Professional upscaler with overlapping tile controls for artifact-free 16x output
- **Best For:**
  - Print-ready artwork
  - Portrait photography
  - Product renders
- **Strengths:**
  - Tile overlap avoids seam artifacts
  - Face detection reduces smoothing
  - Consistent results for production
- **Limitations:**
  - Highest cost per image
  - Slightly slower at 16x
  - Creativity slider not available
- **Parameters:**
  - **Scale Factor:** 2x, 4x, 6x, 8x, 12x, 16x (default: 6x)
    - Best quality between 4x and 8x
  - **Denoise:** 0-100% (default: 25%)
    - Higher values smooth fine grain
  - **Overlapping Tiles:** Boolean (default: true)
    - Reduces seams by processing tiles with overlap
  - **Output Format:** png, jpeg, webp (default: png)
- **Features:**
  - Denoising: ✅
  - Sharpening: ✅
  - Creativity: ❌
  - Overlapping Tiles: ✅ (unique feature)
  - Face Enhancement: ✅ (unique feature)

---

## Model Comparison

### By Price (Cheapest to Most Expensive)
1. **Crystal Upscaler** - $0.02/image
2. **SeedVR Upscale** - $0.05/image
3. **Topaz Upscale** - $0.10/image

### By Speed (Fastest to Slowest)
1. **Crystal Upscaler** - 5/5 (under 20s for 4x)
2. **SeedVR Upscale** - 4/5
3. **Topaz Upscale** - 3/5 (slower at high scales)

### By Quality (Highest to Lowest)
1. **Topaz Upscale** - 5/5 (professional-grade)
2. **SeedVR Upscale** - 4/5
3. **Crystal Upscaler** - 3/5

### By Maximum Scale
1. **SeedVR Upscale** - 16x ✅
2. **Topaz Upscale** - 16x ✅
3. **Crystal Upscaler** - 10x

---

## Feature Comparison Matrix

| Feature | Crystal Upscaler | SeedVR Upscale | Topaz Upscale |
|---------|------------------|----------------|---------------|
| **Denoising** | ✅ | ✅ | ✅ |
| **Sharpening** | ✅ | ✅ | ✅ |
| **Creativity Slider** | ❌ | ✅ | ❌ |
| **Overlapping Tiles** | ❌ | ❌ | ✅ |
| **Face Enhancement** | ❌ | ❌ | ✅ |
| **Max Scale** | 10x | 16x | 16x |
| **Speed** | Fastest | Fast | Moderate |
| **Cost** | Lowest | Mid | Highest |
| **Quality** | Good | Very Good | Excellent |

---

## Model Selection Guide

### Choose **Crystal Upscaler** when:
- Budget is a primary concern ($0.02/image)
- Speed is essential (fastest processing)
- You need quick previews or drafts
- Working with social media content
- Scale factor ≤ 10x is sufficient
- Color preservation is important

### Choose **SeedVR Upscale** when:
- You need creative detail enhancement
- Working with illustrations or stylized art
- Scale factor > 10x required (up to 16x)
- You want control over detail synthesis
- Faces need extra detail enhancement
- Mid-range budget ($0.05/image)

### Choose **Topaz Upscale** when:
- Quality is the top priority
- Creating print-ready artwork
- Working with portrait photography
- Product renders need perfection
- Avoiding tiling artifacts is critical
- Face enhancement is needed
- Budget allows for premium service ($0.10/image)

---

## Use Case Examples

### Social Media Content
**Recommended:** Crystal Upscaler
- Fast turnaround for social posts
- Cost-effective for high-volume work
- Sufficient quality for web display
- Settings: 4x scale, 45% denoise

### Illustration Enhancement
**Recommended:** SeedVR Upscale
- Creative detail synthesis
- Excellent for painterly work
- Up to 16x scale for large prints
- Settings: 6x scale, 35% denoise, 40% creativity

### Professional Photography
**Recommended:** Topaz Upscale
- Artifact-free tiling
- Face enhancement built-in
- Production-grade consistency
- Settings: 6x scale, 25% denoise, overlapping tiles enabled

### Product Photography
**Recommended:** Topaz Upscale
- Highest quality output
- Sharp detail preservation
- No tiling artifacts for large prints
- Settings: 4-8x scale, 20-30% denoise, overlapping tiles enabled

---

## Technical Implementation

All models are accessed via the FAL.ai API through the `upscale-models.ts` module located at:
```
qcut/apps/web/src/lib/upscale-models.ts
```

### API Endpoints
```typescript
export const UPSCALE_MODEL_ENDPOINTS: Record<UpscaleModelId, string> = {
  "crystal-upscaler": "fal-ai/crystal-upscaler",
  "seedvr-upscale": "fal-ai/seedvr/upscale/image",
  "topaz-upscale": "fal-ai/topaz/upscale/image",
};
```

### Model Priority Order
Models are displayed in this order (fastest/cheapest to professional):
1. Crystal Upscaler
2. SeedVR Upscale
3. Topaz Upscale

---

## Parameter Details

### Scale Factor
- **Type:** Select dropdown
- **Purpose:** Determines the upscaling multiplier
- **Impact on Cost:** Higher scales may increase processing time but cost per image remains fixed
- **Recommendations:**
  - 2x-4x: Quick enhancements, web use
  - 6x-8x: Print quality, detailed work
  - 10x-16x: Maximum detail, large format prints

### Denoise (0-100%)
- **Type:** Slider
- **Purpose:** Reduces noise while preserving detail
- **Lower values (0-25%):** Keep more original texture and grain
- **Medium values (25-50%):** Balance between noise reduction and detail
- **Higher values (50-100%):** Smooth fine grain, reduce noise aggressively
- **Recommendations:**
  - Clean images: 20-30%
  - Noisy photos: 40-60%
  - Illustrations: 30-45%

### Creativity (SeedVR only, 0-100%)
- **Type:** Slider
- **Purpose:** Controls imaginative detail synthesis
- **Lower values (0-30%):** Conservative enhancement, stays true to original
- **Medium values (30-50%):** Balanced detail hallucination
- **Higher values (50-100%):** Aggressive detail synthesis, may add unwanted artifacts
- **Recommendations:**
  - Photorealistic work: 20-30%
  - Illustrations: 40-50%
  - Artistic/stylized: 50-70%

### Overlapping Tiles (Topaz only)
- **Type:** Toggle (boolean)
- **Purpose:** Reduces seam artifacts by processing tiles with overlap
- **When enabled:** Slower but seamless results
- **When disabled:** Faster but may show tiling artifacts on large images
- **Recommendation:** Keep enabled for production work

### Output Format
- **Type:** Select dropdown
- **Options:** PNG (lossless), JPEG (lossy), WebP (modern)
- **Default:** PNG
- **Recommendations:**
  - PNG: Professional work, transparency needed
  - JPEG: Web use, smaller file sizes acceptable
  - WebP: Modern web, balance of quality and size

---

## Performance Considerations

### Processing Time Estimates
- **Crystal Upscaler:** ~10-20 seconds for 4x upscale
- **SeedVR Upscale:** ~20-30 seconds for 6x upscale
- **Topaz Upscale:** ~30-60 seconds for 6x upscale with overlapping tiles

### Memory Usage
- Higher scale factors require more memory
- Large input images (>4K) may require additional processing time
- Overlapping tiles (Topaz) increases memory usage by ~30%

### Quality vs Speed Tradeoffs
- **Fast iterations:** Use Crystal Upscaler at lower scales
- **Quality preview:** Use SeedVR at medium scales
- **Final output:** Use Topaz at optimal scale for your use case

---

## Related Documentation

- [Upscale Models Library](../../apps/web/src/lib/upscale-models.ts)
- [Upscale Settings Panel](../../apps/web/src/components/editor/media-panel/views/upscale-settings.tsx)
- [Upscale Model Tests](../../apps/web/src/test/upscale-models.test.ts)

---

## API Integration Notes

### Environment Variables
```bash
VITE_FAL_API_KEY  # Required for FAL.ai API access
```

### Error Handling
All models return proper error messages for:
- Invalid scale factors
- Unsupported image formats
- API rate limiting
- Network failures
- File size limits

### Rate Limiting
- FAL.ai API has rate limits based on your subscription tier
- Consider implementing local rate limiting for user requests
- Monitor API usage through FAL.ai dashboard

---

## Future Enhancements

Potential improvements being considered:
- Batch processing support for multiple images
- Custom scale factor input (non-preset values)
- Real-time preview with lower quality/speed
- Progress indicators for long-running upscales
- Comparison view between original and upscaled
- Additional providers and models as they become available
