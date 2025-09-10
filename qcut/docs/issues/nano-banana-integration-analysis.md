# Nano Banana Integration Analysis

## Overview

The `nano-banana` folder contains a complete React + Vite AI image editing application that uses Google Gemini AI for image transformations. This document analyzes the codebase and provides recommendations for integrating reusable components and patterns into the QCut video editor.

## Application Architecture

### Core Technology Stack
- **Frontend**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 6.2.0
- **AI Service**: Google Gemini 2.5 Flash Image Preview (`@google/genai`)
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

### 1. **Gemini AI Service** (`services/geminiService.ts`)
- **Current Use**: Image-to-image transformations
- **QCut Integration**: Video frame enhancement, thumbnail generation
- **Implementation**: 
  - Extract frames from video timeline
  - Apply AI transformations to individual frames
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
1. **Add Gemini service to QCut**:
   ```bash
   cd qcut/apps/web
   bun add @google/genai
   ```

2. **Create video enhancement features**:
   - Frame-by-frame AI enhancement
   - Intelligent thumbnail generation
   - Content-aware effect suggestions

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
│       ├── geminiService.ts   # Adapted from nano-banana
│       └── videoProcessor.ts  # Video-specific AI processing
└── stores/
    └── ai-store.ts            # New: AI processing state management
```

## Environment Configuration

Add to QCut's environment variables:
```bash
# .env.local
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_AI_FEATURES_ENABLED=true
```

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
   - Store Gemini API keys securely via Electron's secure storage
   - Never expose keys in client-side code
   - Implement proper key rotation mechanisms

2. **File Processing**:
   - Validate uploaded files before AI processing
   - Implement file size limits and type checking
   - Use QCut's existing file handling security measures

## Conclusion

The nano-banana application provides excellent patterns and components that can significantly enhance QCut's capabilities. The most valuable aspects are:

1. **Canvas-based editing tools** for precise video frame manipulation
2. **AI service architecture** for intelligent video enhancement
3. **History management patterns** for tracking user operations
4. **Two-step processing workflows** for complex video operations

Integration should be done gradually, starting with UI components and progressing to AI-powered features, always maintaining QCut's performance and architecture standards.