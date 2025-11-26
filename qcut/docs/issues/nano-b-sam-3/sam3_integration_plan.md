# SAM 3 (Segment Anything Model 3) Integration Plan

## Overview

SAM 3 is a unified foundation model for promptable segmentation in images and videos. It can detect, segment, and track objects using text prompts or visual prompts (points, boxes, masks).

---

## API Endpoints

### 1. SAM 3 Image Segmentation
- **Endpoint**: `fal-ai/sam-3/image`
- **Type**: Image-to-Image segmentation
- **Pricing**: $0.005 per request

### 2. SAM 3 Video Segmentation
- **Endpoint**: `fal-ai/sam-3/video`
- **Type**: Video-to-Video segmentation
- **Pricing**: $0.005 per 16 frames

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

### Image Output
```typescript
{
  masks: Image[];           // Segmented mask images
  image: Image;             // Primary segmented mask preview
  metadata: MaskMetadata[]; // Per-mask metadata
  scores?: number[];        // Confidence scores
  boxes?: number[][];       // Bounding boxes [cx, cy, w, h]
}
```

### Video Output
```typescript
{
  video: File;                    // Segmented output video
  boundingbox_frames_zip?: File;  // Optional zip with per-frame overlays
}
```

---

## Integration Considerations

### 1. Architecture Decision: Separate vs Combined

**Option A: Separate Client Files** (Recommended)
- `sam3-image-client.ts` - Image segmentation
- `sam3-video-client.ts` - Video segmentation
- Pros: Clear separation, easier maintenance
- Cons: Some code duplication

**Option B: Combined Client**
- `sam3-client.ts` - Both image and video
- Pros: Shared types, single import
- Cons: Larger file, mixed concerns

**Recommendation**: Combined client with clear internal separation, since they share prompt types and similar patterns.

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
| `src/types/sam3.ts` | TypeScript interfaces |
| `src/lib/sam3-client.ts` | API client service |
| `src/lib/sam3-models.ts` | Model catalog/info |

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/types/ai-generation.ts` | Re-export SAM 3 types |

### 6. Key Differences from Previous Integrations

| Aspect | FLUX 2 Flex | SAM 3 |
|--------|-------------|-------|
| Input | Text prompt | Image/Video + prompts |
| Output | Generated image | Masks + metadata |
| Interaction | None | Points, boxes, text |
| Use case | Generation | Segmentation/Selection |
| UI needs | Simple form | Canvas interaction |

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

### 8. Implementation Phases

**Phase 1: Core Infrastructure** (~30 min)
- Create TypeScript types
- Create basic API client
- Create model catalog

**Phase 2: Image Segmentation** (~45 min)
- Implement image segmentation function
- Add text prompt support
- Add point/box prompt support
- Handle mask output

**Phase 3: UI Integration** (~TBD)
- Depends on UI decisions
- Canvas interaction for prompts
- Display segmented results

**Phase 4: Video Segmentation** (~45 min)
- Implement video segmentation
- Handle video output
- Frame-specific prompts

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| UI complexity for canvas interaction | High | Medium | Start with text prompts only |
| Video processing time | Medium | Low | Show progress, use queue polling |
| Large mask outputs | Low | Low | Handle file sizes appropriately |
| Unclear user workflow | Medium | High | Define clear use cases first |

---

## Open Questions

1. Should SAM 3 be exposed as a standalone tool or integrated into existing editing workflow?
2. What's the primary use case: background removal, object selection, or video tracking?
3. Is canvas-based point/box interaction needed for MVP, or can text prompts suffice?
4. How should mask outputs be presented to the user?

---

## Next Steps

1. **Decide on UI placement and primary use case**
2. **Determine if canvas interaction is required for MVP**
3. **Create implementation plan with specific file changes**
4. **Implement in phases, starting with image segmentation**
