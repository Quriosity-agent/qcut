# Nano Banana Integration Analysis

## Overview

The `nano-banana` folder contains a complete React + Vite AI image editing application that uses fal.ai Nano Banana APIs for image transformations. This document analyzes the codebase and provides recommendations for integrating reusable components and patterns into the QCut video editor.

## Application Architecture

### Core Technology Stack
- **Frontend**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 6.2.0
- **AI Service**: ~~Google Gemini 2.5 Flash Image Preview (`@google/genai`)~~ **fal.ai Nano Banana APIs**
  - **Text-to-Image**: `https://fal.run/fal-ai/nano-banana` ($0.039/image)
  - **Image Editing**: `https://fal.run/fal-ai/nano-banana/edit` ($0.039/image)
- **Image Processing**: Canvas-based editing with mask support
- **State Management**: React hooks (useState, useCallback, useEffect)

### Key Features
1. **Image Transformations**: 20+ predefined effects (sketch, anime, painting styles, etc.)
2. **Multi-Image Support**: Some effects work with 2 input images
3. **Canvas Masking**: Draw masks to apply effects to specific areas
4. **Two-Step Processing**: Complex workflows (line art → coloring)
5. **History System**: Save and reuse previous generations
6. **Custom Prompts**: Free-form text descriptions for transformations

## Reusable Components for QCut Integration

### 1. **ImageEditorCanvas** (`components/ImageEditorCanvas.tsx`)
- **Functionality**: Canvas-based image display with drawing capabilities
- **Integration Potential**: HIGH - Could enhance QCut's image/video frame editing
- **Adaptations Needed**:
  - Support video frames instead of just static images
  - Integrate with QCut's timeline system
  - Add undo/redo functionality

### 2. **TransformationSelector** (`components/TransformationSelector.tsx`)
- **Functionality**: Grid-based effect selection with drag-and-drop reordering
- **Integration Potential**: MEDIUM - Could be used for video effect templates
- **Adaptations Needed**:
  - Replace Gemini transformations with video effects
  - Integrate with QCut's effects system

### 3. **HistoryPanel** (`components/HistoryPanel.tsx`)
- **Functionality**: Side panel showing generation history with preview thumbnails
- **Integration Potential**: HIGH - Perfect for QCut's project/render history
- **Adaptations Needed**:
  - Store video export history instead of image generations
  - Add metadata (export settings, timestamps, project info)

### 4. **ResultDisplay** (`components/ResultDisplay.tsx`)
- **Functionality**: Before/after comparison with download and reuse options
- **Integration Potential**: MEDIUM - Could show video preview comparisons
- **Adaptations Needed**:
  - Handle video previews instead of images
  - Add video-specific controls (play/pause, scrubbing)

### 5. **LoadingSpinner** & **ErrorMessage**
- **Functionality**: User feedback components
- **Integration Potential**: HIGH - Direct reuse possible
- **Adaptations Needed**: Minimal - just styling to match QCut's design

## Service Layer Integration Opportunities

### 1. **fal.ai Nano Banana Service** (`services/geminiService.ts`)
- **Current Use**: Image-to-image transformations and text-to-image generation
- **APIs Available**:
  - **Text-to-Image**: Generate images from prompts (1-4 images, jpeg/png output)
  - **Image Editing**: Transform existing images with text prompts (supports up to 10 input images)
- **QCut Integration**: Video frame enhancement, thumbnail generation, AI-powered effects
- **Implementation**: 
  - Extract frames from video timeline
  - Apply AI transformations using fal.ai endpoints
  - Support batch processing for multiple frames
  - Reassemble enhanced frames back to video

### 2. **File Utilities** (`utils/fileUtils.ts`)
- **Functionality**: Image processing, watermarking, download handling
- **Integration Potential**: MEDIUM - Video equivalent needed
- **Adaptations**: Extend to handle video files, frame extraction

## Architecture Patterns Worth Adopting

### 1. **Two-Step Processing Pipeline**
```typescript
// Current: Line art → Color application
// QCut Adaptation: Video analysis → Effect application
const processVideo = async (videoFile: File, effect: VideoEffect) => {
  // Step 1: Analyze video content
  const analysis = await analyzeVideoContent(videoFile);
  
  // Step 2: Apply context-aware effects
  const result = await applyEffectWithContext(videoFile, effect, analysis);
  return result;
};
```

### 2. **Canvas-Based Editing System**
- **Pattern**: Direct canvas manipulation with drawing tools
- **QCut Application**: Timeline editing, keyframe visualization
- **Benefits**: Real-time feedback, precise control

### 3. **History Management System**
```typescript
// Reusable pattern for QCut
interface QCutHistory {
  id: string;
  timestamp: Date;
  videoUrl: string;
  settings: ExportSettings;
  thumbnail: string;
  metadata: VideoMetadata;
}
```

## Integration Recommendations

### Phase 1: UI Component Extraction
1. **Extract reusable components** from nano-banana:
   - `LoadingSpinner`
   - `ErrorMessage`
   - `HistoryPanel` (adapt for video exports)
   - Canvas drawing utilities

2. **Create QCut-specific variants**:
   - Video-aware ResultDisplay
   - Timeline-integrated masking tools

### Phase 2: AI Service Integration
1. **Add fal.ai client to QCut**:
   ```bash
   cd qcut/apps/web
   bun add @fal-ai/client
   ```

2. **Create video enhancement features**:
   - Frame-by-frame AI enhancement using fal.ai/nano-banana/edit
   - AI-generated thumbnails using fal.ai/nano-banana 
   - Content-aware effect suggestions based on video analysis
   - Batch processing for multiple video frames (up to 10 images per API call)

### Phase 3: Advanced Features
1. **AI-Powered Video Effects**:
   - Style transfer for entire videos
   - Smart object removal/replacement
   - Automated color correction

2. **Intelligent Workflow Assistance**:
   - Suggest optimal export settings
   - Auto-generate transitions
   - Content-aware audio sync

## File Structure Integration

```
qcut/apps/web/src/
├── components/
│   ├── ai/                    # New: AI-powered components
│   │   ├── VideoEnhancer.tsx
│   │   ├── FrameProcessor.tsx
│   │   └── AIHistoryPanel.tsx
│   └── editor/
│       └── canvas/            # Enhanced: Canvas tools from nano-banana
│           ├── MaskingTool.tsx
│           └── DrawingCanvas.tsx
├── services/
│   └── ai/                    # New: AI services
│       ├── falAiService.ts    # fal.ai Nano Banana API client
│       └── videoProcessor.ts  # Video-specific AI processing
└── stores/
    └── ai-store.ts            # New: AI processing state management
```

## Environment Configuration

Add to QCut's environment variables:
```bash
# .env.local
VITE_FAL_KEY=your_fal_ai_api_key
VITE_AI_FEATURES_ENABLED=true
```

**Note**: fal.ai API pricing is $0.039 per image for both text-to-image generation and image editing operations.

## fal.ai API Integration Details

### Text-to-Image API (`fal-ai/nano-banana`)
**Endpoint**: `https://fal.run/fal-ai/nano-banana`

**Parameters**:
```typescript
interface TextToImageRequest {
  prompt: string;              // Required: Text description for image generation
  num_images?: number;         // Optional: 1-4 images (default: 1)
  output_format?: "jpeg" | "png"; // Optional: Output format (default: "jpeg")
  sync_mode?: boolean;         // Optional: Return data URIs instead of URLs
}
```

**Usage Example**:
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/nano-banana", {
  input: {
    prompt: "An action shot of a black lab swimming",
    num_images: 2,
    output_format: "png"
  }
});
```

### Image Edit API (`fal-ai/nano-banana/edit`)
**Endpoint**: `https://fal.run/fal-ai/nano-banana/edit`

**Parameters**:
```typescript
interface ImageEditRequest {
  prompt: string;               // Required: Text description of desired edit
  image_urls: string[];         // Required: List of image URLs (max 10)
  num_images?: number;          // Optional: 1-4 images (default: 1)
  output_format?: "jpeg" | "png"; // Optional: Output format (default: "jpeg")
  sync_mode?: boolean;          // Optional: Return data URIs instead of URLs
}
```

**Usage Example**:
```javascript
const editResult = await fal.subscribe("fal-ai/nano-banana/edit", {
  input: {
    prompt: "make a photo of the man driving down the california coastline",
    image_urls: [
      "https://example.com/input1.png",
      "https://example.com/input2.png"
    ],
    num_images: 1,
    output_format: "jpeg"
  }
});
```

**Response Format**:
```typescript
interface ApiResponse {
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  description?: string; // AI-generated description of the edit
}
```

### QCut Integration Strategy for fal.ai APIs

1. **Video Frame Processing**:
   ```typescript
   // Extract frames from video
   const frames = await extractVideoFrames(videoFile, { fps: 1 });
   
   // Process frames in batches (max 10 per API call)
   const batches = chunkArray(frames, 10);
   const processedFrames = [];
   
   for (const batch of batches) {
     const result = await fal.subscribe("fal-ai/nano-banana/edit", {
       input: {
         prompt: "enhance video quality and colors",
         image_urls: batch.map(frame => frame.dataUrl)
       }
     });
     processedFrames.push(...result.images);
   }
   ```

2. **Cost Optimization**:
   - Process key frames only for preview
   - Allow users to select processing quality/frequency
   - Implement progress tracking for batch operations
   - Cache processed results to avoid re-processing

## Development Guidelines

### 1. **Maintain QCut's Architecture**
- Use existing Zustand stores for state management
- Follow QCut's component structure and naming conventions
- Integrate with existing Electron IPC for file operations

### 2. **Preserve Performance**
- Process video frames efficiently (batch processing)
- Use Web Workers for heavy AI computations
- Implement proper loading states and error handling

### 3. **Respect QCut's Design System**
- Adapt nano-banana's styling to match QCut's Tailwind theme
- Use QCut's existing UI components (Button, Dialog, etc.)
- Maintain consistent spacing and typography

## Security Considerations

1. **API Key Management**:
   - Store fal.ai API keys securely via Electron's secure storage
   - Never expose keys in client-side code (use `FAL_KEY` environment variable)
   - Implement proper key rotation mechanisms
   - Monitor API usage and costs (fal.ai charges per image processed)

2. **File Processing**:
   - Validate uploaded files before AI processing
   - Implement file size limits and type checking
   - Use QCut's existing file handling security measures

## Conclusion

The nano-banana application provides excellent patterns and components that can significantly enhance QCut's capabilities. The most valuable aspects are:

1. **Canvas-based editing tools** for precise video frame manipulation
2. **fal.ai API integration** for cost-effective AI video enhancement ($0.039/image)
3. **History management patterns** for tracking user operations  
4. **Two-step processing workflows** for complex video operations
5. **Batch processing capabilities** for efficient video frame processing (up to 10 images per API call)

Integration should be done gradually, starting with UI components and progressing to AI-powered features, always maintaining QCut's performance and architecture standards while managing API costs effectively.