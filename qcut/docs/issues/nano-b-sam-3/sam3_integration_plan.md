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

### 4. SAM 3 Video RLE (Run-Length Encoding)
- **Endpoint**: `fal-ai/sam-3/video-rle`
- **Type**: Video-to-RLE segmentation
- **Output**: Per-frame RLE-encoded mask data
- **Pricing**: $0.005 per 16 frames

---

## Output Format Comparison

### Image Endpoints

| Aspect | `image` | `image-rle` |
|--------|---------|-------------|
| Output format | Actual mask images (PNG/JPEG) | Run-Length Encoded strings |
| Payload size | Larger (image files) | Smaller (compressed data) |
| Use case | Display masks directly | Programmatic mask manipulation |
| Processing | Ready to display | Requires decoding |
| Best for | UI preview, export | Compositing, programmatic use |

### Video Endpoints

| Aspect | `video` | `video-rle` |
|--------|---------|-------------|
| Output format | Segmented video file | Per-frame RLE strings |
| Payload size | Larger (video file) | Smaller (compressed data) |
| Use case | Direct playback/export | Frame-by-frame processing |
| Processing | Ready to play | Requires per-frame decoding |
| Best for | Preview, final export | Compositing pipelines, rotoscoping |

**Recommendations**:
- Use `image` / `video` for user-facing previews and exports
- Use `image-rle` / `video-rle` for backend processing, compositing pipelines, or when bandwidth is a concern

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

### Video RLE Segmentation (`fal-ai/sam-3/video-rle`)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `video_url` | string | required | Video URL for segmentation |
| `text_prompt` | string | "" | Text-based segmentation prompt (e.g., "person", "red car") |
| `prompts` | PointPrompt[] | [] | Point prompts with frame indices |
| `box_prompts` | BoxPrompt[] | [] | Box prompts with frame indices |
| `apply_mask` | boolean | false | Apply mask overlay (default false for RLE) |
| `detection_threshold` | float | 0.5 | Confidence threshold (0.01-1.0); try 0.2-0.3 if text prompts fail |
| `boundingbox_zip` | boolean | false | Return per-frame bounding box overlays as ZIP |
| `frame_index` | integer | 0 | Initial frame for mask/prompt application |
| `mask_url` | string | optional | Initial mask URL to apply |

### Prompt Structures

**PointPrompt**:
```typescript
{
  x: number;           // X coordinate
  y: number;           // Y coordinate
  label: 0 | 1;        // 0=background, 1=foreground
  object_id?: number;  // Shared ID for same object (prompts sharing IDs refine same object)
  frame_index?: number; // Frame to interact with (video only)
}
```

**BoxPrompt**:
```typescript
{
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  object_id?: number;  // Shared ID for same object
  frame_index?: number; // Frame to interact with (video only)
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

### Video RLE Output (`fal-ai/sam-3/video-rle`)
```typescript
{
  rle: string | string[];         // Per-frame Run-Length Encoded masks
  metadata?: MaskMetadata[];      // Per-mask metadata
  scores?: number[];              // Confidence scores
  boxes?: number[][];             // Bounding boxes [cx, cy, w, h]
  boundingbox_frames_zip?: File;  // Optional zip with per-frame box overlays
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

interface File {
  url: string;          // Download URL
  content_type: string; // MIME type
  file_name: string;    // Generated filename
  file_size: number;    // Size in bytes
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

### Video RLE: Per-Frame Masks
For video-rle, the `rle` output contains masks for each frame. This enables:
- Frame-by-frame mask manipulation
- Efficient storage of video masks
- Custom compositing workflows
- Rotoscoping with per-frame control

### When to Use RLE
- Backend compositing pipelines
- Storing masks in database (smaller storage)
- Programmatic mask manipulation
- When you need to combine/modify masks before display
- Video rotoscoping workflows
- Frame-by-frame mask editing

---

## Integration Considerations

### 1. Architecture Decision: Separate vs Combined

**Option A: Separate Client Files**
- `sam3-image-client.ts` - Image segmentation (both image and RLE)
- `sam3-video-client.ts` - Video segmentation (both video and RLE)
- Pros: Clear separation, easier maintenance
- Cons: Some code duplication

**Option B: Combined Client** (Recommended)
- `sam3-client.ts` - All four endpoints
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
5. **Rotoscoping** - Semi-automated mask generation for video (video-rle ideal)

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
- Use video-rle for frame-by-frame mask editing

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
| `src/lib/sam3-client.ts` | API client service (image, image-rle, video, video-rle) |
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
| Output variants | Single | Image, Image-RLE, Video, Video-RLE |
| Endpoints | 2 | 4 |

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

5. **RLE vs standard endpoint?**
   - Which to use by default?
   - Expose both to users or abstract away?

6. **Video vs Video-RLE?**
   - Video for preview, Video-RLE for processing?
   - Support rotoscoping workflow?

### 8. Implementation Phases

**Phase 1: Core Infrastructure** (~30 min)
- Create TypeScript types for all four endpoints
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

**Phase 4: Video Segmentation** (~60 min)
- Implement `segmentVideo()` function
- Implement `segmentVideoRLE()` function
- Handle video and RLE output
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
| Video-RLE frame sync | Medium | Medium | Careful frame indexing, validation |

---

## UI Reference Design

Based on the SAM 3 demo interface, the UI should include:

### Image Segmentation UI (Review Objects Mode)

**Panel Layout:**
- **Left sidebar**: "Review objects" panel
  - Search box for text-based object detection (e.g., "Zebra")
  - "Add object" button to add new detection targets
  - Scrollable object list with:
    - Thumbnail preview of each detected object
    - Object name (e.g., "Object 1", "Object 2", etc.)
    - Color-coded indicator dot matching mask overlay color
    - Delete (trash) icon per object
  - "Continue to effects" button at bottom

- **Main canvas**: Image with mask overlays
  - Each detected object highlighted with unique color
  - Colors include: cyan, pink/magenta, purple, orange, yellow, green, blue
  - Semi-transparent colored overlay on detected objects
  - Colored outline/border around each object

- **Top bar**:
  - Home button (left)
  - "Change objects" button (right) for re-detection
  - Additional action icons

### Video Segmentation UI (Search & Track Mode)

**Panel Layout:**
- **Left sidebar**: "Search for objects" panel
  - Header: "Search for objects"
  - Subtext: "Type to search what you're looking for."
  - Search box with text input (e.g., "Dog")
  - Clear (X) button in search box
  - "Search entire video" button at bottom with arrow icon

- **Main canvas**: Video frame with mask overlays
  - Each detected object highlighted with unique color
  - Colors: cyan/teal, orange, pink/magenta, blue
  - Semi-transparent colored fill on detected objects
  - Colored outline/border around each object

- **Video controls**:
  - Timeline scrubber at bottom
  - Current time / Total time display (e.g., "00:00 / 10:07")
  - Play/pause button
  - Frame thumbnail strip showing video preview
  - "Show tracks" button (top right of timeline area)

### Color Palette for Object Masks
The demo uses vibrant, distinguishable colors:
| Object | Color | Hex (approx) |
|--------|-------|--------------|
| Object 1 | Cyan/Teal | #00CED1 |
| Object 2 | Pink/Magenta | #FF69B4 |
| Object 3 | Blue | #4169E1 |
| Object 4 | Orange | #FFA500 |
| Object 5 | Green | #32CD32 |
| Object 6 | Purple | #9370DB |
| Object 7 | Yellow | #FFD700 |
| Object 8 | Lime | #7FFF00 |
| Object 9 | Red | #FF6347 |

### Interaction Flow (Image)
1. User enters text prompt in search box (e.g., "Zebra")
2. System detects all matching objects and assigns unique colors
3. Objects appear in left panel list with thumbnails
4. User can adjust results with clicks or boxes on canvas
5. User can delete unwanted objects from list
6. "Add object" allows detecting additional object types
7. "Continue to effects" proceeds to next step (editing/export)

### Interaction Flow (Video)
1. User enters text prompt in search box (e.g., "Dog")
2. User clicks "Search entire video" to initiate detection
3. System processes video and detects matching objects across all frames
4. Each detected object gets unique color overlay
5. User can scrub through timeline to see tracking across frames
6. "Show tracks" displays object tracking paths over time
7. Frame thumbnail strip shows quick video preview

### Key UI Features to Implement

**For Image Segmentation:**
- **Text-based detection**: Search box triggers `text_prompt` API parameter
- **Multi-object support**: Handle `return_multiple_masks: true` and display all masks
- **Color-coded overlays**: Assign unique colors to each detected object
- **Object list management**: Add, remove, rename detected objects
- **Canvas interaction**: Click/box prompts for refinement (adjust results)
- **Object thumbnails**: Cropped preview of each detected region

**For Video Segmentation:**
- **Video search**: "Search entire video" triggers video endpoint
- **Timeline integration**: Scrubber to navigate segmented video
- **Frame preview strip**: Thumbnail timeline for quick navigation
- **Track visualization**: "Show tracks" to display object paths
- **Persistent tracking**: Objects tracked across frames with same color
- **Progress indication**: Show processing status for long videos

---

## Open Questions

1. Should SAM 3 be exposed as a standalone tool or integrated into existing editing workflow?
2. What's the primary use case: background removal, object selection, or video tracking?
3. Is canvas-based point/box interaction needed for MVP, or can text prompts suffice?
4. How should mask outputs be presented to the user?
5. Should we use standard or RLE endpoints by default? Or expose both?
6. Do we need to decode RLE masks client-side, or use them server-side only?
7. Is rotoscoping (video-rle + frame editing) a target use case?

---

## API Summary Table

| Endpoint | Input | Output | Best For |
|----------|-------|--------|----------|
| `fal-ai/sam-3/image` | Image URL + prompts | Mask images | UI display, export |
| `fal-ai/sam-3/image-rle` | Image URL + prompts | RLE strings | Compositing, storage |
| `fal-ai/sam-3/video` | Video URL + prompts | Segmented video | Preview, final export |
| `fal-ai/sam-3/video-rle` | Video URL + prompts | Per-frame RLE | Rotoscoping, frame-by-frame processing |

---

## Next Steps

1. **Decide on UI placement and primary use case**
2. **Determine if canvas interaction is required for MVP**
3. **Decide on standard vs RLE endpoint defaults**
4. **Determine if video-rle rotoscoping is in scope**
5. **Create implementation plan with specific file changes**
6. **Implement in phases, starting with image segmentation**
