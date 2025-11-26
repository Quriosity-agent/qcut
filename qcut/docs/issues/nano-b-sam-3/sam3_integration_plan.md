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

### 2. SAM 3 Video Segmentation
- **Endpoint**: `fal-ai/sam-3/video`
- **Type**: Video-to-Video segmentation
- **Output**: Segmented video file
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

## Integration Considerations

### 1. Architecture Decision: Separate vs Combined Client

**Option A: Separate Client Files**
- `sam3-image-client.ts` - Image segmentation
- `sam3-video-client.ts` - Video segmentation
- Pros: Clear separation, easier maintenance
- Cons: Some code duplication

**Option B: Combined Client** (Recommended)
- `sam3-client.ts` - Both endpoints
- Pros: Shared types, single import, unified API
- Cons: Larger file

**Recommendation**: Combined client with clear internal separation, since they share prompt types and similar patterns. Export separate functions for each endpoint.

### 2. Architecture Decision: New Panel vs Existing Feature Integration

**✅ DECISION: Use a New Dedicated Panel**

After careful analysis, SAM 3 should be implemented as a **new dedicated "Segmentation" panel** rather than integrating into existing image edit or text2image features.

#### Rationale

**1. Fundamentally Different Paradigm**
| Existing Features | SAM 3 |
|-------------------|-------|
| Prompt → Generate workflow | Click → Segment → Refine workflow |
| Text-based input | Canvas interaction (clicks, boxes) + optional text |
| Single output | Multi-object with color-coded masks |
| No state between operations | Persistent object list with IDs |

**2. Complex State Management Requirements**
SAM 3 requires tracking state that doesn't fit existing patterns:
- Multiple segmented objects with unique IDs and colors
- Point prompts (positive/negative clicks on canvas)
- Box prompts (drag selection regions)
- Text prompts per object
- Video timeline state and frame navigation

**3. Canvas Interaction Requirements**
The UI Reference Design shows extensive canvas interaction:
- Click-to-segment on canvas coordinates
- Multi-object selection with color coding
- Visual mask overlays with opacity controls
- Video scrubbing and frame selection

Existing panels don't have canvas click handlers or mask overlay rendering.

**4. Risk Mitigation**
Integrating SAM 3 into existing features risks:
- Breaking the working edit flow
- Confusing users with mixed paradigms
- Complex conditional rendering logic
- Harder to maintain and debug

**5. Better User Experience**
A dedicated "Segmentation" or "Object Selection" panel provides:
- Clear mental model for users
- Specialized toolbar (point/box/text mode toggles)
- Dedicated object list sidebar
- Video-specific controls when needed
- Room for future expansion

#### Recommended File Structure

```
src/
├── lib/
│   └── sam3-client.ts          # SAM 3 API client (image + video)
├── types/
│   └── sam3.ts                 # TypeScript interfaces
├── stores/
│   └── segmentation-store.ts   # Segmentation state (Zustand)
├── components/
│   └── segmentation/           # Dedicated feature folder
│       ├── SegmentationPanel.tsx      # Main panel container
│       ├── SegmentationCanvas.tsx     # Canvas with click/drag handlers
│       ├── ObjectList.tsx             # Sidebar object list
│       ├── PromptToolbar.tsx          # Point/Box/Text mode toggles
│       ├── MaskOverlay.tsx            # Color-coded mask rendering
│       └── VideoTimeline.tsx          # Video-specific controls
└── hooks/
    └── useSegmentation.ts      # Segmentation logic hook
```

### 3. Where Does SAM 3 Fit in QCut?

SAM 3 is fundamentally different from existing models:
- **Not text-to-image** (like FLUX 2 Flex)
- **Not image editing** (like FLUX 2 Flex Edit)
- **It's a segmentation/masking tool**

Potential use cases in QCut:
1. **Background removal** - Segment subject from background
2. **Object selection** - Click/box to select objects for editing
3. **Masking for compositing** - Generate masks for video compositing
4. **Object tracking** - Track objects across video frames

### 4. UI Integration Points

**New Segmentation Panel** (Primary):
- Accessible from main navigation alongside existing AI tools
- Full canvas interaction for point/box prompts
- Object list management in sidebar
- Mode switcher for Image vs Video

**Image Segmentation Mode**:
- Upload or select image from project
- Text prompt for automatic detection
- Click/drag on canvas for refinement
- Multi-object with color-coded overlays
- Export masks or continue to editing

**Video Segmentation Mode**:
- Upload or select video from project/timeline
- Text prompt for object detection across frames
- Timeline scrubber for frame navigation
- Object tracking visualization
- Export segmented video or per-frame masks

### 5. Existing Patterns to Follow

Based on codebase analysis:
- Follow `image-edit-client.ts` pattern for API calls
- Use queue polling for async requests (like other FAL models)
- Create types in `types/` folder
- Add model info to a catalog file

### 6. Files to Create/Modify

**New Files**:

| File | Purpose |
|------|---------|
| `src/types/sam3.ts` | TypeScript interfaces for image and video endpoints |
| `src/lib/sam3-client.ts` | API client service (image + video) |
| `src/lib/sam3-models.ts` | Model catalog/info |
| `src/stores/segmentation-store.ts` | Zustand store for segmentation state |
| `src/components/segmentation/SegmentationPanel.tsx` | Main panel container |
| `src/components/segmentation/SegmentationCanvas.tsx` | Canvas with click/drag handlers |
| `src/components/segmentation/ObjectList.tsx` | Sidebar object list |
| `src/components/segmentation/PromptToolbar.tsx` | Point/Box/Text mode toggles |
| `src/components/segmentation/MaskOverlay.tsx` | Color-coded mask rendering |
| `src/components/segmentation/VideoTimeline.tsx` | Video-specific controls |
| `src/hooks/useSegmentation.ts` | Segmentation logic hook |

**Files to Modify**:

| File | Changes |
|------|---------|
| `src/types/ai-generation.ts` | Re-export SAM 3 types |
| Navigation/routing files | Add Segmentation panel route |

### 7. Key Differences from Previous Integrations

| Aspect | FLUX 2 Flex | SAM 3 |
|--------|-------------|-------|
| Input | Text prompt | Image/Video + prompts |
| Output | Generated image | Masks + metadata |
| Interaction | None | Points, boxes, text |
| Use case | Generation | Segmentation/Selection |
| UI needs | Simple form | Canvas interaction |
| Endpoints | 2 | 2 |

### 8. Resolved Decisions

| Question | Decision |
|----------|----------|
| **Where in the UI?** | ✅ New dedicated "Segmentation" panel |
| **Canvas interaction needed?** | ✅ Yes - required for point/box prompts |
| **Video integration scope?** | Start with image, then add video |
| **Mask output usage?** | Display, export, and use for compositing |

### 9. Remaining Questions

1. **Integration with existing editor workflow?**
   - How does segmented mask flow into image editing?
   - Can users send masks to other AI tools?

2. **Mask export formats?**
   - PNG with transparency?
   - Direct integration with timeline?

### 10. Implementation Phases

**Phase 1: Core Infrastructure**
- Create TypeScript types (`src/types/sam3.ts`)
- Create basic API client (`src/lib/sam3-client.ts`)
- Create model catalog (`src/lib/sam3-models.ts`)

**Phase 2: Image Segmentation API**
- Implement `segmentImage()` function
- Add text prompt support
- Add point/box prompt support
- Handle mask output

**Phase 3: Segmentation Panel UI - Image Mode**
- Create Zustand store for segmentation state (`src/stores/segmentation-store.ts`)
- Create main panel container (`SegmentationPanel.tsx`)
- Create canvas with click handlers (`SegmentationCanvas.tsx`)
- Create object list sidebar (`ObjectList.tsx`)
- Create prompt toolbar (`PromptToolbar.tsx`)
- Create mask overlay rendering (`MaskOverlay.tsx`)
- Wire up to navigation/routing
- Implement text-based detection flow
- Implement point/box prompt refinement
- Add object management (add, remove, rename)

**Phase 4: Video Segmentation API**
- Implement `segmentVideo()` function
- Handle video output
- Frame-specific prompts
- Progress tracking for longer videos

**Phase 5: Segmentation Panel UI - Video Mode**
- Add video timeline component (`VideoTimeline.tsx`)
- Add frame scrubber and preview
- Add "Search entire video" functionality
- Add track visualization
- Handle async video processing with progress

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| UI complexity for canvas interaction | High | Medium | Start with text prompts only |
| Video processing time | Medium | Low | Show progress, use queue polling |
| Large mask outputs | Low | Low | Compress images, optimize transfer |
| Unclear user workflow | Medium | High | Define clear use cases first |

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

---

## API Summary Table

| Endpoint | Input | Output | Best For |
|----------|-------|--------|----------|
| `fal-ai/sam-3/image` | Image URL + prompts | Mask images | UI display, export |
| `fal-ai/sam-3/video` | Video URL + prompts | Segmented video | Preview, final export |

---

## Next Steps

### ✅ Completed Decisions
1. ~~Decide on UI placement~~ → **New dedicated Segmentation panel**
2. ~~Determine if canvas interaction is required~~ → **Yes, required for point/box prompts**

### 🔜 Ready to Implement
1. **Phase 1**: Create core infrastructure (types, client, utils)
2. **Phase 2**: Implement image segmentation API
3. **Phase 3**: Build Segmentation Panel UI for image mode

### 📋 Pending Decisions
1. Define mask export formats and integration with existing editor
2. Determine video timeline integration depth

### 💡 Recommendation
Start with **Phase 1-3** (Image Segmentation) as MVP:
- Simpler scope, faster to validate UX
- Video support (Phase 4-5) can follow as enhancement
- Allows user feedback before committing to video complexity
