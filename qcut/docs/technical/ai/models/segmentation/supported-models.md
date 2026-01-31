# Segmentation - Supported Models

This document details the AI models supported for image and video segmentation in QCut.

## Overview

The Segmentation feature supports **SAM-3 (Segment Anything Model 3)** from Meta AI via FAL.ai, providing state-of-the-art object segmentation capabilities for both images and videos.

---

## Supported Model

### SAM-3 (Segment Anything 3)
- **Provider:** Meta AI (via fal.ai)
- **Model ID:** sam-3
- **Price Tier:** Budget
- **Estimated Cost:** $0.005 per request
- **Cost Per Request:** $0.005
- **Quality Rating:** 5/5
- **Speed Rating:** 4/5
- **Description:** Meta's state-of-the-art image and video segmentation model with text, point, and box prompts

---

## Capabilities

### Image Segmentation
Segment objects in still images using multiple prompt types:
- **Text Prompts:** Describe the object to segment (e.g., "person", "car", "dog")
- **Point Prompts:** Click on the image to mark foreground/background
- **Box Prompts:** Draw a bounding box around the object

**Endpoint:** `fal-ai/sam-3/image`

### Video Segmentation
Segment objects across video frames with temporal consistency:
- **Text Prompts:** Describe the object to track and segment
- **Point Prompts:** Mark the object in the first frame
- **Box Prompts:** Define bounding box for the object

**Endpoint:** `fal-ai/sam-3/video`

---

## Features

### ✅ Supported Features

| Feature | Image | Video | Description |
|---------|-------|-------|-------------|
| **Text Prompt** | ✅ | ✅ | Natural language object description |
| **Point Prompt** | ✅ | ✅ | Click-to-segment interaction |
| **Box Prompt** | ✅ | ✅ | Bounding box selection |
| **Multiple Masks** | ✅ | ✅ | Returns multiple segmentation options |
| **Confidence Scores** | ✅ | ✅ | Quality assessment for each mask |
| **Bounding Boxes** | ✅ | ✅ | Automatic bounding box detection |
| **Temporal Consistency** | ❌ | ✅ | Object tracking across frames |

---

## Best Use Cases

### Image Segmentation
1. **Object Isolation**
   - Remove backgrounds from product photos
   - Extract specific objects from scenes
   - Create transparency masks

2. **Background Removal**
   - E-commerce product images
   - Profile picture editing
   - Graphic design workflows

3. **Interactive Selection**
   - Click-to-select objects
   - Fine-tune selections with points
   - Quick object extraction

4. **Batch Segmentation**
   - Process multiple images
   - Consistent object extraction
   - Automated workflows

### Video Segmentation
1. **Object Tracking**
   - Track people/objects through video
   - Motion-based segmentation
   - Temporal consistency

2. **Background Replacement**
   - Video background removal
   - Green screen alternative
   - Virtual backgrounds

3. **Video Effects**
   - Apply effects to specific objects
   - Blur/enhance selected regions
   - Color grading specific elements

---

## Strengths

### Cost-Effectiveness
- **$0.005 per request** - Extremely affordable
- No per-pixel or per-frame pricing
- Fixed cost regardless of image/video size

### Versatility
- **Multiple prompt types** - Text, point, box
- **Works on common objects** - Excellent recognition
- **Flexible output** - Multiple mask options

### Quality
- **State-of-the-art accuracy** - Meta's latest model
- **Confidence scores** - Quality assessment built-in
- **Temporal consistency** - Smooth video segmentation

### Performance
- **Fast processing** - 4/5 speed rating
- **Queue-based API** - Reliable processing
- **Progress updates** - Real-time status

---

## Limitations

### Object Recognition
- **Requires clear boundaries** - Works best with distinct objects
- **Struggles with occlusion** - Heavily overlapped objects may be challenging
- **Text prompts** - Work best for common/recognizable objects

### Processing
- **Queue-based** - Not instant, requires polling
- **API dependency** - Requires FAL.ai API key
- **Internet required** - Cloud-based processing

### Video Constraints
- **Longer processing time** - Video takes more time than images
- **File size limits** - Depends on FAL.ai quotas
- **Temporal consistency** - May require manual correction in complex scenes

---

## Parameters

### Image Segmentation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **image_url** | string | Required | URL of the image to segment |
| **text_prompt** | string | Optional | Object description (e.g., "person") |
| **prompts** | Point[] | Optional | Array of point prompts |
| **box_prompts** | Box[] | Optional | Array of bounding box prompts |
| **apply_mask** | boolean | true | Apply mask to output image |
| **sync_mode** | boolean | false | Synchronous vs queue mode |
| **output_format** | string | "png" | Output format (png, jpeg, webp) |
| **return_multiple_masks** | boolean | false | Return multiple mask options |
| **max_masks** | number | 3 | Maximum number of masks to return |
| **include_scores** | boolean | false | Include confidence scores |
| **include_boxes** | boolean | false | Include bounding boxes |

### Video Segmentation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **video_url** | string | Required | URL of the video to segment |
| **text_prompt** | string | Optional | Object description |
| **prompts** | Point[] | Optional | Array of point prompts |
| **box_prompts** | Box[] | Optional | Array of bounding box prompts |
| **detection_threshold** | number | 0.5 | Detection confidence threshold |
| **apply_mask** | boolean | true | Apply mask to output video |
| **sync_mode** | boolean | false | Synchronous vs queue mode |
| **output_format** | string | "mp4" | Output video format |

### Point Prompt Format
```typescript
interface Sam3PointPrompt {
  x: number;        // X coordinate (0-1 normalized)
  y: number;        // Y coordinate (0-1 normalized)
  label: 0 | 1;     // 0 = background, 1 = foreground
}
```

### Box Prompt Format
```typescript
interface Sam3BoxPrompt {
  x_min: number;    // Left edge (0-1 normalized)
  y_min: number;    // Top edge (0-1 normalized)
  x_max: number;    // Right edge (0-1 normalized)
  y_max: number;    // Bottom edge (0-1 normalized)
}
```

---

## Usage Examples

### Example 1: Text Prompt Segmentation
```typescript
import { segmentWithText } from '@/lib/sam3-client';

const result = await segmentWithText(
  "https://example.com/image.jpg",
  "person",
  {
    apply_mask: true,
    output_format: "png",
    return_multiple_masks: true,
    max_masks: 3
  }
);
```

### Example 2: Point-Based Segmentation
```typescript
import { segmentWithPoints } from '@/lib/sam3-client';

const points = [
  { x: 0.5, y: 0.5, label: 1 },    // Foreground point
  { x: 0.1, y: 0.1, label: 0 }     // Background point
];

const result = await segmentWithPoints(
  "https://example.com/image.jpg",
  points,
  { include_scores: true }
);
```

### Example 3: Bounding Box Segmentation
```typescript
import { segmentWithBox } from '@/lib/sam3-client';

const box = {
  x_min: 0.2,
  y_min: 0.3,
  x_max: 0.8,
  y_max: 0.9
};

const result = await segmentWithBox(
  "https://example.com/image.jpg",
  box,
  { include_boxes: true }
);
```

### Example 4: Video Segmentation with Progress
```typescript
import { segmentVideoWithText } from '@/lib/sam3-client';

const result = await segmentVideoWithText(
  "https://example.com/video.mp4",
  "car",
  {
    detection_threshold: 0.7,
    onProgress: (progress) => {
      console.log(`Progress: ${progress.progress}%`);
      console.log(`Status: ${progress.status}`);
      console.log(`Message: ${progress.message}`);
    }
  }
);
```

---

## Output Format

### Image Segmentation Output
```typescript
interface Sam3Output {
  image_url: string;              // URL of segmented image
  masks?: Array<{
    mask_url: string;             // URL of individual mask
    confidence_score?: number;    // Confidence (0-1)
    bounding_box?: {              // Bounding box coordinates
      x_min: number;
      y_min: number;
      x_max: number;
      y_max: number;
    };
  }>;
}
```

### Video Segmentation Output
```typescript
interface Sam3VideoOutput {
  video_url: string;              // URL of segmented video
  masks?: Array<{
    frame_masks: string[];        // URLs of frame-by-frame masks
    confidence_score?: number;
  }>;
}
```

---

## Workflow Recommendations

### For Background Removal
1. **Text Prompt Approach:**
   - Use text prompt: "person" or specific object
   - Enable `apply_mask: true`
   - Set `output_format: "png"` for transparency

2. **Point Prompt Approach (more precise):**
   - Click on the subject (label: 1)
   - Click on background areas (label: 0)
   - Refine with multiple points

### For Object Isolation
1. **Use bounding box** for rough selection
2. **Refine with points** if needed
3. **Request multiple masks** to choose best option
4. **Check confidence scores** for quality assessment

### For Video Effects
1. **Text prompt** for simple objects ("person", "car")
2. **Set detection threshold** based on object clarity (0.5-0.8)
3. **Monitor progress** for long videos
4. **Verify temporal consistency** across frames

---

## Performance Optimization

### For Faster Processing
- Use **text prompts** (faster than points)
- Disable **multiple masks** if not needed
- Use **sync_mode: false** for queue processing
- Avoid **include_scores** and **include_boxes** unless required

### For Better Quality
- Use **multiple masks** and select the best
- Enable **confidence scores** for quality assessment
- Use **point prompts** for precise selection
- Adjust **detection_threshold** for video (start at 0.5)

### For Cost Efficiency
- Already extremely cost-effective ($0.005/request)
- Batch similar requests together
- Cache results when possible
- Use appropriate output format (PNG for transparency, JPEG for smaller files)

---

## Error Handling

### Common Errors and Solutions

#### "FAL API key not configured"
- **Cause:** Missing or invalid API key
- **Solution:** Set `VITE_FAL_API_KEY` or configure in Settings
- **Check:** Run `sam3Client.isAvailable()` to verify

#### "Segmentation failed"
- **Cause:** Invalid input or API error
- **Solution:** Verify image/video URL is accessible
- **Retry:** Queue-based processing may retry automatically

#### "Maximum polling attempts reached"
- **Cause:** Timeout during queue processing
- **Solution:** Check network connection and API status
- **Image timeout:** 5 minutes
- **Video timeout:** 10 minutes

#### "No object found"
- **Cause:** Text prompt too vague or object not recognizable
- **Solution:** Use more specific text or switch to point/box prompts
- **Alternative:** Try different prompt types

---

## Technical Implementation

### Client Module
Located at: `qcut/apps/web/src/lib/sam3-client.ts`

**Key Features:**
- Singleton pattern for consistent API configuration
- Queue-based polling with progress callbacks
- Support for image and video segmentation
- Convenience methods for each prompt type

### Model Configuration
Located at: `qcut/apps/web/src/lib/sam3-models.ts`

**Contains:**
- Model metadata and pricing
- Feature flags
- Default parameters
- Best practices

### UI Components
Segmentation interface located at:
- `qcut/apps/web/src/components/editor/segmentation/`
- Canvas for interactive selection
- Controls for prompt types
- Progress indicators

---

## API Key Configuration

### Environment Variable
```bash
VITE_FAL_API_KEY=your_fal_api_key_here
```

### Electron Storage
API key can also be stored securely via:
```typescript
window.electronAPI.apiKeys.set({ falApiKey: 'your_key' });
```

### Verification
```typescript
import { sam3Client } from '@/lib/sam3-client';

const available = await sam3Client.isAvailable();
console.log('SAM-3 available:', available);
```

---

## Processing Time Estimates

### Image Segmentation
- **Small images (< 1MP):** 3-8 seconds
- **Medium images (1-4MP):** 8-15 seconds
- **Large images (> 4MP):** 15-30 seconds

### Video Segmentation
- **Short clips (< 5s):** 30-60 seconds
- **Medium clips (5-15s):** 1-3 minutes
- **Long clips (> 15s):** 3-10 minutes

*Note: Times vary based on queue position and API load*

---

## Comparison: Prompt Types

| Prompt Type | Speed | Precision | Best For | Learning Curve |
|-------------|-------|-----------|----------|----------------|
| **Text** | Fastest | Good | Common objects | Easiest |
| **Point** | Medium | Excellent | Precise selection | Medium |
| **Box** | Fast | Good | Known regions | Easy |
| **Combined** | Slowest | Best | Complex scenes | Advanced |

---

## Best Practices

### General Guidelines
1. **Start simple** - Try text prompts first
2. **Use multiple masks** - Get options to choose from
3. **Check confidence scores** - Verify quality
4. **Refine with points** - Improve precision when needed
5. **Cache results** - Save processed masks

### For Production Use
1. **Validate inputs** - Check image/video URLs
2. **Handle errors gracefully** - Show user-friendly messages
3. **Implement timeouts** - Don't block UI indefinitely
4. **Show progress** - Use progress callbacks
5. **Test edge cases** - Occluded objects, low contrast, etc.

### For Video Segmentation
1. **Test on short clips first** - Verify before long videos
2. **Adjust detection threshold** - Based on object clarity
3. **Monitor temporal consistency** - Check for frame-to-frame stability
4. **Consider file size** - Large videos = longer processing

---

## Future Enhancements

Potential improvements being considered:
- Real-time segmentation preview
- Advanced editing tools (refine edges, grow/shrink selection)
- Mask compositing and layering
- Integration with timeline for video editing
- Custom model training for specific objects
- Batch processing multiple files
- Export masks in various formats
- Segmentation history and undo/redo

---

## Related Documentation

- [SAM-3 Client Implementation](../../apps/web/src/lib/sam3-client.ts)
- [SAM-3 Model Configuration](../../apps/web/src/lib/sam3-models.ts)
- [Segmentation UI Components](../../apps/web/src/components/editor/segmentation/)
- [SAM-3 Types Definitions](../../apps/web/src/types/sam3.ts)
- [Segmentation Store](../../apps/web/src/stores/segmentation-store.ts)

---

## External Resources

- [FAL.ai SAM-3 Documentation](https://fal.ai/models/sam-3)
- [Meta SAM Research Paper](https://ai.meta.com/research/publications/segment-anything/)
- [Segment Anything Project](https://segment-anything.com/)
