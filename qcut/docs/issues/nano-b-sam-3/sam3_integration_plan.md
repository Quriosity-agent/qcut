# SAM 3 (Segment Anything Model 3) Integration Plan

## Overview

SAM 3 is a unified foundation model for promptable segmentation in images and videos. It can detect, segment, and track objects using text prompts or visual prompts (points, boxes, masks).

---

## API Endpoints

### 1. SAM 3 Image Segmentation
- **Endpoint**: `fal-ai/sam-3/image`
- **Type**: Image-to-Image segmentation
- **Output**: Mask images (PNG/JPEG/WebP)
- **Pricing**: $0.005 per request

### 2. SAM 3 Image RLE (Run-Length Encoding)
- **Endpoint**: `fal-ai/sam-3/image-rle`
- **Type**: Image-to-RLE segmentation
- **Output**: RLE-encoded mask data (compressed)
- **Pricing**: $0.005 per request

### 3. SAM 3 Video Segmentation
- **Endpoint**: `fal-ai/sam-3/video`
- **Type**: Video-to-Video segmentation
- **Output**: Segmented video file
- **Pricing**: $0.005 per 16 frames

---

## Image vs Image-RLE: When to Use Which?

| Aspect | `image` | `image-rle` |
|--------|---------|-------------|
| Output format | Actual mask images (PNG/JPEG) | Run-Length Encoded strings |
| Payload size | Larger (image files) | Smaller (compressed data) |
| Use case | Display masks directly | Programmatic mask manipulation |
| Processing | Ready to display | Requires decoding |
| Best for | UI preview, export | Compositing, programmatic use |

**Recommendation**:
- Use `image` for user-facing mask previews
- Use `image-rle` for backend processing, compositing pipelines, or when bandwidth is a concern

---

## API Parameters

### Image Segmentation (`fal-ai/sam-3/image`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `image_url` | string | required | URL of image to segment |
| `text_prompt` | string | "" | Text-based segmentation prompt |
| `prompts` | PointPrompt[] | [] | Point-based prompts with coordinates |
| `box_prompts` | BoxPrompt[] | [] | Box-based prompts |
| `apply_mask` | boolean | true | Apply mask overlay on image |
| `output_format` | enum | "png" | jpeg, png, webp |
| `return_multiple_masks` | boolean | false | Return multiple mask variations |
| `max_masks` | integer | 3 | Maximum masks (1-32) |
| `include_scores` | boolean | false | Include confidence scores |
| `include_boxes` | boolean | false | Include bounding boxes |
| `sync_mode` | boolean | false | Return as data URI |

### Image RLE Segmentation (`fal-ai/sam-3/image-rle`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `image_url` | string | required | URL of image to segment |
| `text_prompt` | string | "" | Text-based segmentation prompt |
| `prompts` | PointPrompt[] | [] | Point-based prompts with coordinates |
| `box_prompts` | BoxPrompt[] | [] | Box-based prompts |
| `apply_mask` | boolean | true | Apply mask overlay on image |
| `output_format` | enum | "png" | jpeg, png, webp |
| `return_multiple_masks` | boolean | false | Return multiple mask variations |
| `max_masks` | integer | 3 | Maximum masks (1-32) |
| `include_scores` | boolean | false | Include confidence scores |
| `include_boxes` | boolean | false | Include bounding boxes |
| `sync_mode` | boolean | false | Return as data URI |

### Video Segmentation (`fal-ai/sam-3/video`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video_url` | string | required | Video URL for segmentation |
| `text_prompt` | string | "" | Text-based segmentation prompt |
| `prompts` | PointPrompt[] | [] | Point prompts with frame indices |
| `box_prompts` | BoxPrompt[] | [] | Box prompts with frame indices |
| `apply_mask` | boolean | true | Apply mask overlay to video |
| `detection_threshold` | float | 0.5 | Confidence threshold (0.01-1.0) |
| `boundingbox_zip` | boolean | false | Return per-frame bounding box overlays |
| `frame_index` | integer | 0 | Initial frame for mask application |
| `mask_url` | string | optional | Initial mask URL |

### Prompt Structures

**PointPrompt**:
```typescript
{
  x: number;           // X coordinate
  y: number;           // Y coordinate
  label: 0 | 1;        // 0=background, 1=foreground
  object_id?: number;  // Shared ID for same object
  frame_index?: number; // Frame to interact with (video)
}
```

**BoxPrompt**:
```typescript
{
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  object_id?: number;
  frame_index?: number; // For video
}
```

---

## Output Schemas

### Image Output (`fal-ai/sam-3/image`)
```typescript
{
  masks: Image[];           // Segmented mask images
  image: Image;             // Primary segmented mask preview
  metadata: MaskMetadata[]; // Per-mask metadata
  scores?: number[];        // Confidence scores
  boxes?: number[][];       // Bounding boxes [cx, cy, w, h]
}
```

### Image RLE Output (`fal-ai/sam-3/image-rle`)
```typescript
{
  rle: string | string[];   // Run-Length Encoded mask(s) - compressed format
  metadata: MaskMetadata[]; // Per-mask metadata
  scores?: number[];        // Confidence scores
  boxes?: number[][];       // Bounding boxes [cx, cy, w, h]
  boundingbox_frames_zip?: File; // Optional zip with box overlays
}
```

### Video Output (`fal-ai/sam-3/video`)
```typescript
{
  video: File;                    // Segmented output video
  boundingbox_frames_zip?: File;  // Optional zip with per-frame overlays
}
```

### Shared Types
```typescript
interface Image {
  url: string;          // Download URL
  content_type: string; // MIME type
  file_name: string;    // Generated filename
  file_size: number;    // Size in bytes
  width: number;        // Width in pixels
  height: number;       // Height in pixels
}

interface MaskMetadata {
  index: number;        // Mask position in output
  score?: number;       // Confidence score
  box?: number[];       // Normalized [cx, cy, w, h] bounding box
}
```

---

## RLE (Run-Length Encoding) Format

### What is RLE?
Run-Length Encoding is a compression algorithm that represents sequences of identical values as a single value and count. For masks, it efficiently encodes binary (0/1) pixel data.

### Example
Instead of: `0,0,0,0,1,1,1,0,0,0,0,0,1,1`
RLE encodes: `4,3,5,2` (4 zeros, 3 ones, 5 zeros, 2 ones)

### Decoding RLE in JavaScript
```typescript
function decodeRLE(rle: string, width: number, height: number): Uint8Array {
  const counts = rle.split(',').map(Number);
  const mask = new Uint8Array(width * height);
  let idx = 0;
  let value = 0; // Start with 0 (background)

  for (const count of counts) {
    for (let i = 0; i < count; i++) {
      mask[idx++] = value;
    }
    value = 1 - value; // Toggle between 0 and 1
  }

  return mask;
}
```

### When to Use RLE
- Backend compositing pipelines
- Storing masks in database (smaller storage)
- Programmatic mask manipulation
- When you need to combine/modify masks before display

---

## Integration Considerations

### 1. Architecture Decision: Separate vs Combined

**Option A: Separate Client Files**
- `sam3-image-client.ts` - Image segmentation (both image and RLE)
- `sam3-video-client.ts` - Video segmentation
- Pros: Clear separation, easier maintenance
- Cons: Some code duplication

**Option B: Combined Client** (Recommended)
- `sam3-client.ts` - All three endpoints
- Pros: Shared types, single import, unified API
- Cons: Larger file

**Recommendation**: Combined client with clear internal separation, since they share prompt types and similar patterns. Export separate functions for each endpoint.

### 2. Where Does SAM 3 Fit in QCut?

SAM 3 is fundamentally different from existing models:
- **Not text-to-image** (like FLUX 2 Flex)
- **Not image editing** (like FLUX 2 Flex Edit)
- **It's a segmentation/masking tool**

Potential use cases in QCut:
1. **Background removal** - Segment subject from background
2. **Object selection** - Click/box to select objects for editing
3. **Masking for compositing** - Generate masks for video compositing
4. **Object tracking** - Track objects across video frames
5. **Rotoscoping** - Semi-automated mask generation for video

### 3. UI Integration Points

**Image Segmentation**:
- Could integrate with "AI Image Editing" panel
- Add "Segment" or "Select Object" tool
- Allow point/box prompts via canvas interaction
- Text prompt for automatic segmentation

**Video Segmentation**:
- Could integrate with timeline for object tracking
- Generate masks for specific timeline clips
- Export masks for external compositing
- Rotoscoping workflow integration

### 4. Existing Patterns to Follow

Based on codebase analysis:
- Follow `image-edit-client.ts` pattern for API calls
- Use queue polling for async requests (like other FAL models)
- Create types in `types/` folder
- Add model info to a catalog file

### 5. Files to Create/Modify

**New Files**:
| File | Purpose |
|------|---------|
| `src/types/sam3.ts` | TypeScript interfaces for all SAM 3 endpoints |
| `src/lib/sam3-client.ts` | API client service (image, image-rle, video) |
| `src/lib/sam3-models.ts` | Model catalog/info |
| `src/lib/sam3-utils.ts` | RLE decode/encode utilities |

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/types/ai-generation.ts` | Re-export SAM 3 types |

### 6. Key Differences from Previous Integrations

| Aspect | FLUX 2 Flex | SAM 3 |
|--------|-------------|-------|
| Input | Text prompt | Image/Video + prompts |
| Output | Generated image | Masks (image/RLE) + metadata |
| Interaction | None | Points, boxes, text |
| Use case | Generation | Segmentation/Selection |
| UI needs | Simple form | Canvas interaction |
| Output variants | Single | Image, RLE, Video |

### 7. Questions to Resolve Before Implementation

1. **Where in the UI?**
   - New panel? Within image edit? Separate tool?

2. **Canvas interaction needed?**
   - Point prompts require click coordinates
   - Box prompts require drag selection

3. **Video integration scope?**
   - Start with image only?
   - Video requires timeline integration

4. **Mask output usage?**
   - Display only? Export? Use for compositing?

5. **RLE vs Image endpoint?**
   - Which to use by default?
   - Expose both to users or abstract away?

### 8. Implementation Phases

**Phase 1: Core Infrastructure** (~30 min)
- Create TypeScript types for all three endpoints
- Create basic API client with shared utilities
- Create model catalog
- Create RLE utility functions

**Phase 2: Image Segmentation** (~45 min)
- Implement `segmentImage()` function
- Implement `segmentImageRLE()` function
- Add text prompt support
- Add point/box prompt support
- Handle mask output (both image and RLE)

**Phase 3: UI Integration** (~TBD)
- Depends on UI decisions
- Canvas interaction for prompts
- Display segmented results
- RLE-to-canvas rendering

**Phase 4: Video Segmentation** (~45 min)
- Implement `segmentVideo()` function
- Handle video output
- Frame-specific prompts
- Progress tracking for longer videos

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| UI complexity for canvas interaction | High | Medium | Start with text prompts only |
| Video processing time | Medium | Low | Show progress, use queue polling |
| Large mask outputs | Low | Low | Use RLE for internal processing |
| Unclear user workflow | Medium | High | Define clear use cases first |
| RLE decoding performance | Low | Low | Use typed arrays, optimize loops |

---

## Open Questions

1. Should SAM 3 be exposed as a standalone tool or integrated into existing editing workflow?
2. What's the primary use case: background removal, object selection, or video tracking?
3. Is canvas-based point/box interaction needed for MVP, or can text prompts suffice?
4. How should mask outputs be presented to the user?
5. Should we use `image` or `image-rle` endpoint by default? Or expose both?
6. Do we need to decode RLE masks client-side, or use them server-side only?

---

## API Summary Table

| Endpoint | Input | Output | Best For |
|----------|-------|--------|----------|
| `fal-ai/sam-3/image` | Image URL + prompts | Mask images | UI display, export |
| `fal-ai/sam-3/image-rle` | Image URL + prompts | RLE strings | Compositing, storage |
| `fal-ai/sam-3/video` | Video URL + prompts | Segmented video | Object tracking |

---

## Next Steps

1. **Decide on UI placement and primary use case**
2. **Determine if canvas interaction is required for MVP**
3. **Decide on image vs image-rle default**
4. **Create implementation plan with specific file changes**
5. **Implement in phases, starting with image segmentation**
