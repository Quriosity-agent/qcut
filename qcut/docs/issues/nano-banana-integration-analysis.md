# Nano Banana Integration Analysis

## Overview

The `nano-banana` folder contains a complete React + Vite AI image editing application that uses fal.ai Nano Banana APIs for image transformations. This document analyzes the codebase and provides recommendations for integrating reusable components and patterns into QCut for **AI-powered image and video editing capabilities** through a new "Nano Edit" panel.

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

## QCut Integration: "Nano Edit" Panel

### **Proposed UI Integration**
Add a new panel in QCut's media panel system that bridges AI image and video capabilities:

```
QCut Media Panel Navigation:
┌─────────────────────────────────────────────────────────────┐
│ 🎬 Media │ 🎵 Audio │ 🏷️ Text │ 🖼️ AI Images │ 🎥 AI Videos │
│                              ├─── 🍌 Nano Edit ───┤            │
└─────────────────────────────────────────────────────────────┘
```

### **"Nano Edit" Panel Features**
The Nano Edit panel provides a unified interface for AI-powered content creation:

#### **Panel Sections**:
1. **📷 Image Assets** - Thumbnail and title card generation
2. **🎨 Style Transfer** - Apply artistic styles to video frames
3. **🔧 Enhancement** - AI-powered image and video enhancement
4. **📋 Templates** - Pre-configured effects for common use cases

#### **Workflow Integration**:
```typescript
interface NanoEditPanel {
  // Image-focused capabilities (immediate integration)
  imageAssets: {
    generateThumbnail: (prompt: string) => Promise<ImageUrl>;
    createTitleCard: (text: string, style: BrandStyle) => Promise<ImageUrl>;
    enhanceLogo: (logoFile: File, effect: AIEffect) => Promise<ImageUrl>;
  };
  
  // Video capabilities (future expansion)
  videoEnhancement: {
    enhanceFrame: (frame: VideoFrame, effect: AIEffect) => Promise<ProcessedFrame>;
    applyStyleTransfer: (frames: VideoFrame[], style: ArtisticStyle) => Promise<ProcessedFrame[]>;
    generatePreviewThumbnail: (videoFile: File) => Promise<ImageUrl>;
  };
}
```

## Reusable Components for QCut Integration

### 1. **ImageEditorCanvas** (`components/ImageEditorCanvas.tsx`)
- **Functionality**: Advanced canvas-based image editor with masking and drawing tools
- **Integration Potential**: HIGH - Perfect for QCut's image editing capabilities
- **Key Features**:
  - Dual-canvas architecture (image layer + mask layer)
  - Real-time drawing with configurable brush sizes (5-100px)
  - Drag-and-drop file upload support
  - Undo/redo history system for mask operations
  - Responsive canvas with proper aspect ratio handling
  - Touch and mouse event support
  - Visual feedback for drawing states
- **Code Quality**: Excellent - Uses React hooks efficiently, proper cleanup, TypeScript types
- **Nano Edit Panel Integration**:
  - **Image Assets Section**: Core canvas editor for thumbnail/title card creation
  - **Enhancement Section**: Selective image enhancement with masking tools
  - **Template Section**: Pre-configured canvas templates for common video asset types
  - **Style Transfer Section**: Apply artistic effects to extracted video frames

### 2. **TransformationSelector** (`components/TransformationSelector.tsx`)
- **Functionality**: Interactive grid-based effect selector with drag-and-drop customization
- **Integration Potential**: HIGH - Excellent for QCut's image transformation gallery
- **Key Features**:
  - Responsive grid layout (2-5 columns based on screen size)
  - Drag-and-drop reordering with visual feedback
  - Emoji + title effect cards with hover animations
  - Persistent localStorage for user's preferred effect order
  - Smooth transitions and professional styling
  - Accessibility features (focus states, ARIA labels)
- **Code Quality**: Good - Clean React patterns, proper event handling
- **Nano Edit Panel Integration**: 
  - **Main Effect Gallery**: 25+ AI transformations organized by category
  - **Quick Access Bar**: User-customizable effect ordering for frequent workflows
  - **Template Browser**: Pre-configured effects for video asset types
  - **Style Presets**: One-click application of popular artistic styles

### 3. **HistoryPanel** (`components/HistoryPanel.tsx`)
- **Functionality**: Sophisticated sliding side panel for generation history management
- **Integration Potential**: EXCELLENT - Ready-to-use for QCut's image editing history
- **Key Features**:
  - Slide-out panel with backdrop blur and smooth animations
  - Support for both single results and two-step processes
  - Individual download and "use as input" actions per item
  - Responsive thumbnail grid with proper aspect ratios
  - Empty state with helpful instructions
  - Professional action buttons with hover states
  - Organized history with chronological ordering
- **Code Architecture**: Modular design with separate `HistoryItem` component
- **Nano Edit Panel Integration**:
  - **Asset History Tab**: Track all generated images and enhanced video frames
  - **Project Gallery**: Show assets organized by current video project
  - **Quick Reuse**: Drag assets directly from history to timeline
  - **Export Options**: Batch download or individual asset export
- **Implementation**: Seamless integration with QCut's existing project system

### 4. **ResultDisplay** (`components/ResultDisplay.tsx`)
- **Functionality**: Before/after comparison with download and reuse options  
- **Integration Potential**: HIGH - Perfect for image transformation results
- **Nano Edit Panel Integration**:
  - **Preview Section**: Real-time before/after comparison for all AI operations
  - **Video Frame Enhancement**: Show original vs enhanced video frames side-by-side
  - **Asset Preview**: Professional presentation of generated thumbnails and title cards
  - **Quick Actions**: One-click download, timeline integration, or iterative editing

### 5. **LoadingSpinner** & **ErrorMessage**
- **Functionality**: User feedback components
- **Integration Potential**: HIGH - Direct reuse possible
- **Adaptations Needed**: Minimal - just styling to match QCut's design

## "Nano Edit" Panel: Detailed Implementation

### **Panel Architecture**
```typescript
// src/components/editor/nano-edit/NanoEditPanel.tsx
interface NanoEditPanelProps {
  currentProject: Project;
  onAssetGenerated: (asset: GeneratedAsset) => void;
  onFrameEnhanced: (originalFrame: VideoFrame, enhancedFrame: ProcessedFrame) => void;
}

const NanoEditPanel: React.FC<NanoEditPanelProps> = ({ currentProject, onAssetGenerated, onFrameEnhanced }) => {
  return (
    <div className="nano-edit-panel">
      {/* Panel Navigation */}
      <NanoEditTabs />
      
      {/* Content Sections */}
      <NanoEditContent 
        activeTab={activeTab}
        project={currentProject}
        onAssetGenerated={onAssetGenerated}
        onFrameEnhanced={onFrameEnhanced}
      />
    </div>
  );
};
```

### **Panel Navigation Tabs**
```typescript
enum NanoEditTab {
  IMAGE_ASSETS = 'image-assets',
  STYLE_TRANSFER = 'style-transfer', 
  ENHANCEMENT = 'enhancement',
  TEMPLATES = 'templates'
}

const TAB_CONFIG = {
  [NanoEditTab.IMAGE_ASSETS]: {
    icon: '📷',
    label: 'Image Assets',
    description: 'Generate thumbnails, title cards, logos'
  },
  [NanoEditTab.STYLE_TRANSFER]: {
    icon: '🎨', 
    label: 'Style Transfer',
    description: 'Apply artistic styles to video frames'
  },
  [NanoEditTab.ENHANCEMENT]: {
    icon: '🔧',
    label: 'Enhancement', 
    description: 'AI-powered image and video enhancement'
  },
  [NanoEditTab.TEMPLATES]: {
    icon: '📋',
    label: 'Templates',
    description: 'Pre-configured effects and layouts'
  }
};
```

### **Tab Content Implementation**

#### **1. Image Assets Tab**
```typescript
// Primary focus - immediate implementation
const ImageAssetsTab: React.FC = () => {
  return (
    <div className="image-assets-tab">
      {/* Thumbnail Generation */}
      <Section title="Thumbnail Generator">
        <ThumbnailGenerator 
          projectContext={currentProject}
          onGenerated={handleThumbnailGenerated}
        />
      </Section>
      
      {/* Title Card Creator */}
      <Section title="Title Cards">
        <TitleCardCreator 
          projectTitle={currentProject.title}
          brandStyle={currentProject.brandStyle}
          onCreated={handleTitleCardCreated}
        />
      </Section>
      
      {/* Logo Enhancement */}
      <Section title="Logo Enhancement">
        <LogoEnhancer 
          onEnhanced={handleLogoEnhanced}
        />
      </Section>
    </div>
  );
};
```

#### **2. Style Transfer Tab** 
```typescript
// Future expansion - video frame processing
const StyleTransferTab: React.FC = () => {
  return (
    <div className="style-transfer-tab">
      {/* Frame Extractor */}
      <Section title="Frame Selection">
        <VideoFrameExtractor 
          videoFile={currentProject.primaryVideo}
          onFrameSelected={handleFrameSelected}
        />
      </Section>
      
      {/* Style Gallery */}
      <Section title="Artistic Styles">
        <StyleSelector 
          styles={ARTISTIC_STYLES}
          onStyleApplied={handleStyleApplied}
        />
      </Section>
      
      {/* Batch Processing */}
      <Section title="Batch Enhancement">
        <BatchProcessor 
          frames={selectedFrames}
          style={selectedStyle}
          onBatchComplete={handleBatchComplete}
        />
      </Section>
    </div>
  );
};
```

#### **3. Enhancement Tab**
```typescript
// Unified enhancement for images and video frames
const EnhancementTab: React.FC = () => {
  return (
    <div className="enhancement-tab">
      {/* Input Source */}
      <Section title="Source">
        <SourceSelector 
          options={['Upload Image', 'Extract from Video', 'From Project Assets']}
          onSourceSelected={handleSourceSelected}
        />
      </Section>
      
      {/* Enhancement Options */}
      <Section title="Enhancement Type">
        <EnhancementSelector 
          effects={ENHANCEMENT_EFFECTS}
          onEffectSelected={handleEffectSelected}
        />
      </Section>
      
      {/* Canvas Editor */}
      <Section title="Edit">
        <ImageEditorCanvas 
          sourceImage={selectedSource}
          effect={selectedEffect}
          onEnhanced={handleEnhanced}
        />
      </Section>
    </div>
  );
};
```

#### **4. Templates Tab**
```typescript
// Pre-configured workflows and templates
const TemplatesTab: React.FC = () => {
  return (
    <div className="templates-tab">
      {/* Template Categories */}
      <Section title="Categories">
        <TemplateCategories 
          categories={['YouTube', 'Social Media', 'Business', 'Creative']}
          onCategorySelected={handleCategorySelected}
        />
      </Section>
      
      {/* Template Gallery */}
      <Section title="Templates">
        <TemplateGallery 
          category={selectedCategory}
          templates={availableTemplates}
          onTemplateSelected={handleTemplateSelected}
        />
      </Section>
      
      {/* Quick Customization */}
      <Section title="Customize">
        <TemplateCustomizer 
          template={selectedTemplate}
          projectData={currentProject}
          onCustomized={handleTemplateCustomized}
        />
      </Section>
    </div>
  );
};
```

### **Integration with Existing QCut UI**
```typescript
// src/components/editor/media-panel/views/nano-edit.tsx
const NanoEditView: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  
  return (
    <div className="nano-edit-view">
      <NanoEditPanel 
        currentProject={currentProject}
        onAssetGenerated={handleAssetGenerated}
        onFrameEnhanced={handleFrameEnhanced}
      />
    </div>
  );
};

// Add to existing media panel tabs
// src/components/editor/media-panel/tabbar.tsx
const TABS = [
  { id: 'media', icon: '🎬', label: 'Media' },
  { id: 'audio', icon: '🎵', label: 'Audio' },
  { id: 'text', icon: '🏷️', label: 'Text' },
  { id: 'nano-edit', icon: '🍌', label: 'Nano Edit' }, // New tab
  { id: 'stickers', icon: '😀', label: 'Stickers' },
];
```

## Utility Functions Analysis

### **File Utilities** (`utils/fileUtils.ts`)
**Integration Potential**: EXCELLENT - Essential building blocks for image processing in QCut

#### Key Functions with QCut Applications:

1. **`fileToBase64(file: File)`**
   - **Purpose**: Converts files to base64 for API uploads
   - **QCut Use**: Image asset processing and AI transformation
   - **Code Quality**: Robust error handling, Promise-based

2. **`dataUrlToFile(dataUrl: string, filename: string)`**
   - **Purpose**: Converts data URLs back to File objects
   - **QCut Use**: Save processed images (thumbnails, logos, titles) to filesystem
   - **Integration**: Direct - no modifications needed

3. **`loadImage(dataUrl: string)`** 
   - **Purpose**: Loads images with crossOrigin support
   - **QCut Use**: Image asset loading, thumbnail preview
   - **Benefits**: Proper error handling, CORS compliance

4. **`resizeImageToMatch(sourceUrl: string, targetImage: HTMLImageElement)`**
   - **Purpose**: Resizes images to match target dimensions
   - **QCut Use**: Standardize thumbnail and title card dimensions
   - **Implementation**: Canvas-based with aspect ratio preservation

5. **`embedWatermark(imageUrl: string, text: string)`**
   - **Purpose**: Invisible steganographic watermarking using LSB
   - **QCut Use**: Brand protection for generated images and thumbnails
   - **Features**: Binary text embedding, overflow protection, reversible
   - **Sophistication**: Advanced - uses Least Significant Bit manipulation

6. **`downloadImage(url: string, filename: string)`**
   - **Purpose**: Programmatic file downloads
   - **QCut Use**: Export processed images, thumbnails, logos, title cards
   - **Implementation**: Clean DOM manipulation, cross-browser compatible

### **Type Definitions** (`types.ts`)
**Integration Potential**: MEDIUM - Good patterns to adapt

#### Core Types:
```typescript
interface Transformation {
  title: string;
  prompt: string; 
  emoji: string;
  description: string;
  isMultiImage?: boolean;     // Support for 2+ input images
  isTwoStep?: boolean;        // Complex processing workflows  
  stepTwoPrompt?: string;     // Second step instructions
  // UI customization for multi-image workflows
  primaryUploaderTitle?: string;
  secondaryUploaderTitle?: string;
  primaryUploaderDescription?: string;
  secondaryUploaderDescription?: string;
}
```

**QCut Adaptation Potential**:
- Use similar structure for image transformation definitions
- Multi-step image processing workflows (line art → coloring)
- Effect parameter configuration for AI transformations
- Template system for thumbnails, title cards, and logos

### **Constants & Effect Library** (`constants.ts`)
**Integration Value**: HIGH - Comprehensive effect library with 25+ transformations

#### Effect Categories Analysis:
1. **Viral & Fun** (8 effects): 3D Figurine, Funko Pop, LEGO, Crochet, Cosplay, Plushie, Keychain
2. **Photorealistic & Enhancement** (6 effects): HD Enhance, Pose Transfer, Photorealistic conversion, Fashion Magazine, Hyper-realistic
3. **Design & Product** (4 effects): Architecture Model, Product Render, Soda Can, Industrial Design
4. **Artistic & Stylistic** (7 effects): Color Palette Swap, Line Art, Painting Process, Marker Sketch, Cyberpunk, Van Gogh
5. **Utility & Specific** (6 effects): Isolate & Enhance, 3D Screen, Makeup Analysis, Background Change

**QCut Integration Strategy**:
- Use existing prompts for image asset creation
- Apply effects to thumbnails, title cards, logos, and overlays
- Leverage two-step processing for complex image transformations (line art → coloring)
- Create branded assets with consistent styling across projects

## Service Layer Integration Opportunities

### 1. **fal.ai Nano Banana Service** (`services/geminiService.ts`)
- **Current Use**: Image-to-image transformations and text-to-image generation
- **APIs Available**:
  - **Text-to-Image**: Generate images from prompts (1-4 images, jpeg/png output)
  - **Image Editing**: Transform existing images with text prompts (supports up to 10 input images)
- **QCut Integration**: Image asset creation and enhancement for video projects
- **Implementation**: 
  - Generate custom thumbnails for video projects
  - Create branded title cards and overlays
  - Transform logos and watermarks with AI effects
  - Batch process multiple image assets for consistent branding

### 2. **File Utilities** (`utils/fileUtils.ts`)
- **Functionality**: Image processing, watermarking, download handling
- **Integration Potential**: HIGH - Direct integration for image assets
- **Applications**: Handle thumbnails, title cards, logos, and overlay images for video projects

## Architecture Patterns Worth Adopting

### 1. **Two-Step Processing Pipeline**
```typescript
// Current: Line art → Color application
// QCut Adaptation: Asset creation → Brand application
const processImageAsset = async (inputImage: File, brandStyle: BrandStyle) => {
  // Step 1: Create base design (line art, layout, etc.)
  const baseDesign = await createBaseDesign(inputImage);
  
  // Step 2: Apply brand styling and colors
  const brandedAsset = await applyBrandStyling(baseDesign, brandStyle);
  return brandedAsset;
};
```

### 2. **Canvas-Based Editing System**
- **Pattern**: Direct canvas manipulation with drawing tools
- **QCut Application**: Image asset editing, custom overlay creation
- **Benefits**: Real-time feedback, precise control, professional results

### 3. **History Management System**
```typescript
// Reusable pattern for QCut image assets
interface ImageAssetHistory {
  id: string;
  timestamp: Date;
  imageUrl: string;
  assetType: 'thumbnail' | 'title-card' | 'logo' | 'overlay';
  transformation: string;
  metadata: ImageMetadata;
}
```

## Integration Recommendations

### Phase 1: UI Component Extraction
1. **Extract reusable components** from nano-banana:
   - `LoadingSpinner`
   - `ErrorMessage` 
   - `HistoryPanel` (adapt for image asset history)
   - Canvas drawing utilities

2. **Create QCut-specific variants**:
   - Image-aware ResultDisplay for thumbnails and title cards
   - Asset library integration with existing project management

### Phase 2: AI Service Integration
1. **Add fal.ai client to QCut**:
   ```bash
   cd qcut/apps/web
   bun add @fal-ai/client
   ```

2. **Create image asset features**:
   - AI-generated thumbnails using fal.ai/nano-banana
   - Custom title card creation with brand consistency
   - Logo and watermark enhancement using fal.ai/nano-banana/edit
   - Batch processing for multiple project assets (up to 10 images per API call)

### Phase 3: Advanced Features  
1. **AI-Powered Image Creation**:
   - Brand-consistent thumbnail generation
   - Custom title card templates with project-specific styling
   - Logo variations and adaptations

2. **Intelligent Asset Management**:
   - Suggest thumbnails based on video content
   - Auto-generate title cards with project metadata
   - Maintain brand consistency across all generated assets

## File Structure Integration

```
qcut/apps/web/src/
├── components/
│   └── editor/
│       ├── nano-edit/                    # New: Nano Edit panel
│       │   ├── NanoEditPanel.tsx         # Main panel component
│       │   ├── tabs/                     # Panel tab implementations
│       │   │   ├── ImageAssetsTab.tsx    # Thumbnail/title card generation
│       │   │   ├── StyleTransferTab.tsx  # Video frame style transfer
│       │   │   ├── EnhancementTab.tsx    # AI enhancement tools
│       │   │   └── TemplatesTab.tsx      # Pre-configured templates
│       │   └── components/               # Reusable nano-edit components
│       │       ├── ThumbnailGenerator.tsx
│       │       ├── TitleCardCreator.tsx
│       │       ├── LogoEnhancer.tsx
│       │       ├── VideoFrameExtractor.tsx
│       │       └── ImageEditorCanvas.tsx # Adapted from nano-banana
│       └── media-panel/
│           └── views/
│               └── nano-edit.tsx         # Integration with media panel
├── services/
│   └── ai/                              # New: AI services
│       ├── falAiService.ts              # fal.ai Nano Banana API client
│       └── nanoEditProcessor.ts         # Nano Edit processing logic
└── stores/
    └── nano-edit-store.ts               # New: Nano Edit state management
```

## Environment Configuration

Add to QCut's environment variables:
```bash
# .env.local
VITE_FAL_KEY=your_fal_ai_api_key
VITE_AI_FEATURES_ENABLED=true
```

**Note**: fal.ai API pricing is $0.039 per image for both text-to-image generation and image editing operations. Perfect for creating thumbnails, title cards, and branded assets.

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

1. **Image Asset Processing**:
   ```typescript
   // Generate thumbnail for video project
   const thumbnail = await fal.subscribe("fal-ai/nano-banana", {
     input: {
       prompt: "Create a professional YouTube thumbnail with vibrant colors",
       num_images: 3,
       output_format: "png"
     }
   });
   
   // Process multiple assets in batches (max 10 per API call)
   const assets = [logoFile, titleCardFile, overlayFile];
   const result = await fal.subscribe("fal-ai/nano-banana/edit", {
     input: {
       prompt: "Apply consistent brand styling with modern design",
       image_urls: assets.map(asset => asset.dataUrl)
     }
   });
   ```

2. **Cost Optimization**:
   - Generate multiple thumbnail options in single API call
   - Batch process project assets together
   - Cache generated assets for reuse across projects
   - Implement user approval before expensive operations

## Development Guidelines

### 1. **⚠️ CRITICAL: Non-Breaking Integration Strategy**
**Priority**: Ensure zero impact on existing QCut functionality

#### **Existing Systems to Preserve**:
- **Core Timeline System**: Never modify `src/components/editor/timeline/` components
- **Video Processing**: Keep `src/lib/ffmpeg-utils.ts` and video export engines untouched
- **State Management**: Preserve all existing Zustand stores:
  - `timeline-store.ts` - Core video editing state
  - `project-store.ts` - Project management 
  - `media-store.ts` - Media library management
  - `playback-store.ts` - Video playback controls
  - `effects-store.ts` - Existing video effects
- **Component Structure**: Maintain existing editor layout and panel system

#### **Integration Approach**:
```typescript
// ✅ CORRECT: Add new AI features as separate modules
src/components/editor/ai/              # New directory - no conflicts
src/services/ai/                       # New directory - no conflicts  
src/stores/image-ai-store.ts           # New store - no conflicts

// ❌ WRONG: Modifying existing core components
src/components/editor/timeline/        # Never modify existing files
src/stores/timeline-store.ts          # Never modify existing stores
src/lib/ffmpeg-utils.ts               # Never modify core video processing
```

### 2. **Maintain QCut's Architecture**
- Use existing Zustand stores for state management (read-only access)
- Follow QCut's component structure and naming conventions
- Integrate with existing Electron IPC for file operations

### 3. **Safe Integration Practices**

#### **Component Integration Rules**:
```typescript
// ✅ SAFE: Extend existing functionality without modification
const useProjectData = () => {
  const project = useProjectStore((state) => state.currentProject); // Read-only
  return project;
};

// ✅ SAFE: Add new routes without modifying existing ones  
// src/routes/ai/image-editor.tsx - New route, no conflicts

// ❌ DANGEROUS: Modifying existing component exports
// Never change existing component interfaces or props
```

#### **Store Integration Safety**:
```typescript
// ✅ SAFE: Create separate AI store
interface ImageAIStore {
  generatedAssets: ImageAsset[];
  isProcessing: boolean;
  addAsset: (asset: ImageAsset) => void;
}

// ✅ SAFE: Read from existing stores without mutation
const currentProject = useProjectStore.getState().currentProject;

// ❌ DANGEROUS: Adding properties to existing stores
// Never extend timeline-store, project-store, etc.
```

### 4. **Preserve Performance** 
- Use Web Workers for AI processing to avoid blocking UI
- Implement proper loading states and error handling
- Cache generated assets locally to reduce API calls
- Lazy load AI components only when needed

### 5. **Respect QCut's Design System**
- Adapt nano-banana's styling to match QCut's Tailwind theme
- Use QCut's existing UI components (Button, Dialog, etc.)
- Maintain consistent spacing and typography
- Follow existing panel layout patterns

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

## ⚠️ **Testing Strategy: Ensure No Existing Features Break**

### **Pre-Integration Testing Checklist**
Before adding any nano-banana components, verify these existing QCut features work:

#### **Core Video Editor Functions**:
```bash
# Run existing test suite
cd qcut/apps/web
bun run test

# Verify core functionality manually:
# ✅ Project creation and loading
# ✅ Video import and timeline placement  
# ✅ Basic video editing (trim, split, move)
# ✅ Effect application (brightness, contrast, etc.)
# ✅ Audio track management
# ✅ Video export functionality
# ✅ Keyboard shortcuts and timeline interactions
```

### **Integration Testing Protocol**
After adding each nano-banana component:

#### **Phase 1: Component Addition Testing**
```typescript
// Test that new components don't affect existing ones
describe('AI Integration Safety', () => {
  it('should not break existing timeline functionality', async () => {
    // Add timeline element
    // Verify timeline store state unchanged
    // Confirm video playback works
  });
  
  it('should not interfere with existing stores', () => {
    // Import new AI store
    // Verify timeline-store, project-store still function
    // Check no store state conflicts
  });
});
```

#### **Phase 2: Route Integration Testing**
```bash
# Verify existing routes still work
✅ /editor/[project_id] - Main editor
✅ /projects - Project list  
✅ / - Home page

# Test new AI routes don't conflict
✅ /ai/image-editor - New AI features
✅ Navigation between editor and AI features
```

#### **Phase 3: Performance Impact Testing**
```typescript
// Measure performance impact
const performanceTests = {
  timelineRender: 'Should remain < 100ms',
  videoPlayback: 'Should remain smooth 60fps', 
  projectLoad: 'Should remain < 2s',
  memoryUsage: 'Should not increase > 10%'
};
```

### **Rollback Strategy**
If integration causes issues:

```bash
# Immediate rollback steps
git stash  # Save current work
git checkout main  # Return to stable state
bun run test  # Verify all tests pass
```

### **Continuous Integration Safeguards**
```typescript
// Add to existing test suite
beforeEach(() => {
  // Reset all stores to clean state
  resetTimelineStore();
  resetProjectStore(); 
  resetMediaStore();
});

afterEach(() => {
  // Verify no store pollution from AI features
  expect(useTimelineStore.getState()).toMatchSnapshot();
});
```

## Conclusion

The nano-banana application provides excellent patterns and components that can significantly enhance QCut through a unified **"Nano Edit" panel** that bridges AI image and video capabilities. The most valuable aspects are:

1. **Unified AI Interface** - Single "Nano Edit" panel providing access to all AI-powered features
2. **Canvas-based editing tools** for precise image asset creation and video frame manipulation
3. **fal.ai API integration** for cost-effective AI processing ($0.039/image) supporting both images and video frames
4. **Tabbed workflow organization** - Image Assets, Style Transfer, Enhancement, and Templates
5. **Seamless QCut integration** - New media panel tab without modifying existing functionality
6. **Future-proof architecture** - Immediate image capabilities with planned video frame processing expansion

## **Nano Edit Panel Benefits**:

### **For Users**:
- **Unified Experience**: All AI features accessible from one familiar panel location
- **Project Context**: AI tools automatically use current project data and branding
- **Flexible Workflows**: Choose between quick templates or detailed custom editing
- **Asset Management**: Generated images automatically organized within project structure

### **For Developers**:
- **Non-Breaking Integration**: Completely separate module with zero impact on existing features
- **Modular Architecture**: Each tab can be developed and deployed independently
- **Scalable Design**: Easy to add new AI capabilities as separate tabs
- **Existing Infrastructure**: Leverages QCut's established media panel system

The Nano Edit panel approach ensures **safe, incremental enhancement** of QCut's capabilities while maintaining the application's stability and performance standards.

## 🔨 Implementation Roadmap: Micro-Tasks (≤20 Minutes Each)

**Core Principles**:
1. ✅ **No Breaking Changes** - Each task maintains existing functionality
2. ♻️ **Maximum Code Reuse** - Leverage nano-banana components directly  
3. 🔧 **Long-term Maintainable** - Clean architecture for future updates

---

## **✅ Phase 1: Foundation Setup (Day 1) - COMPLETED**

### **✅ Task 1.1: Environment Setup** ⏱️ *15 minutes* - **DONE**
```bash
# Add fal.ai dependency without breaking existing dependencies
cd qcut/apps/web
bun add @fal-ai/client
```
**Safety**: ✅ No existing code modified, just new dependency
**Reuse**: ✅ Direct npm package integration (@fal-ai/client@1.6.2)
**Maintenance**: ✅ Standard dependency update process

### **✅ Task 1.2: Type Definitions** ⏱️ *10 minutes* - **DONE**
```typescript
// src/types/nano-edit.ts - NEW FILE CREATED
export interface NanoEditAsset {
  id: string;
  type: 'thumbnail' | 'title-card' | 'logo' | 'overlay';
  url: string;
  projectId?: string;
  createdAt: Date;
  prompt?: string;
  dimensions?: string;
}

export interface NanoEditStore {
  assets: NanoEditAsset[];
  isProcessing: boolean;
  activeTab: 'image-assets' | 'enhancement' | 'templates' | 'style-transfer';
  // + comprehensive fal.ai API types
}
```
**Safety**: ✅ New file, no existing types modified
**Reuse**: ✅ Adapted from nano-banana types.ts with enhancements
**Maintenance**: ✅ Single file to update for new asset types

### **✅ Task 1.3: Basic Store Setup** ⏱️ *15 minutes* - **DONE**
```typescript
// src/stores/nano-edit-store.ts - NEW FILE CREATED
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export const useNanoEditStore = create<NanoEditStore>()(
  devtools((set, get) => ({
    assets: [],
    isProcessing: false,
    activeTab: 'image-assets',
    addAsset: (asset) => set(state => ({ assets: [...state.assets, asset] })),
    // + full CRUD operations and selectors
  }), { name: 'nano-edit-store' })
);
```
**Safety**: ✅ New store, doesn't interact with existing stores
**Reuse**: ✅ Same Zustand pattern as existing QCut stores
**Maintenance**: ✅ Standard Zustand store with devtools integration

**Phase 1 Status**: ✅ **COMPLETE** - Foundation ready for Phase 2

---

## **Phase 2: Core Components (Day 2-3)**

### **Task 2.1: File Utilities Extract** ⏱️ *20 minutes*
```bash
# Copy nano-banana utilities to new location
cp nano-banana/utils/fileUtils.ts qcut/apps/web/src/lib/utils/nano-edit-utils.ts
```
```typescript
// Minor adaptations for QCut
export { fileToBase64, dataUrlToFile, loadImage, downloadImage } from './nano-edit-utils';
```
**Safety**: New utility file, existing utils untouched
**Reuse**: 95% direct copy from nano-banana
**Maintenance**: Update from nano-banana source when needed

### **Task 2.2: Basic Service Setup** ⏱️ *15 minutes*
```typescript
// src/services/ai/fal-ai-service.ts - NEW FILE
import { fal } from "@fal-ai/client";

export class FalAiService {
  static async generateImage(prompt: string): Promise<string> {
    const result = await fal.subscribe("fal-ai/nano-banana", {
      input: { prompt }
    });
    return result.images[0]?.url || '';
  }
}
```
**Safety**: New service, no existing API calls modified
**Reuse**: Direct integration of nano-banana API patterns
**Maintenance**: Single service file for all AI operations

### **Task 2.3: Loading Components** ⏱️ *10 minutes*
```typescript
// Copy nano-banana loading components directly
cp nano-banana/components/LoadingSpinner.tsx qcut/apps/web/src/components/ui/
cp nano-banana/components/ErrorMessage.tsx qcut/apps/web/src/components/ui/
```
**Safety**: New UI components, don't modify existing ones
**Reuse**: 100% direct copy from nano-banana
**Maintenance**: Standard React component updates

### **Task 2.4: Panel Placeholder** ⏱️ *15 minutes*
```typescript
// src/components/editor/media-panel/views/nano-edit.tsx - NEW FILE
export const NanoEditView: React.FC = () => {
  return (
    <div className="p-4">
      <h2>🍌 Nano Edit</h2>
      <p>AI-powered image and video enhancement coming soon...</p>
    </div>
  );
};
```
**Safety**: Minimal placeholder, no existing functionality affected
**Reuse**: Uses existing QCut styling patterns
**Maintenance**: Simple component to expand incrementally

### **Task 2.5: Panel Registration** ⏱️ *10 minutes*
```typescript
// src/components/editor/media-panel/tabbar.tsx
// Add to existing TABS array:
{ id: 'nano-edit', icon: '🍌', label: 'Nano Edit' }

// src/components/editor/media-panel/index.tsx
// Add to view mapping:
case 'nano-edit': return <NanoEditView />;
```
**Safety**: Minimal addition to existing tab system
**Reuse**: Follows existing QCut panel pattern exactly
**Maintenance**: Standard tab management

---

## **Phase 3: Image Assets Tab (Day 4-5)**

### **Task 3.1: Canvas Component Extract** ⏱️ *20 minutes*
```bash
# Copy nano-banana canvas with minimal QCut adaptations
cp nano-banana/components/ImageEditorCanvas.tsx qcut/apps/web/src/components/editor/nano-edit/components/
```
**Safety**: New component in nano-edit directory, no existing canvas modified
**Reuse**: 90% direct copy, minor styling updates
**Maintenance**: Update from nano-banana source when improved

### **Task 3.2: Image Assets Tab Structure** ⏱️ *15 minutes*
```typescript
// src/components/editor/nano-edit/tabs/ImageAssetsTab.tsx - NEW FILE
export const ImageAssetsTab: React.FC = () => {
  return (
    <div className="space-y-4">
      <ThumbnailGenerator />
      <TitleCardCreator />
      <LogoEnhancer />
    </div>
  );
};
```
**Safety**: New component, no existing functionality modified
**Reuse**: Component structure from nano-banana App.tsx
**Maintenance**: Clear separation of concerns for easy updates

### **Task 3.3: Thumbnail Generator** ⏱️ *20 minutes*
```typescript
// src/components/editor/nano-edit/components/ThumbnailGenerator.tsx - NEW FILE
export const ThumbnailGenerator: React.FC = () => {
  const { addAsset } = useNanoEditStore();
  const project = useProjectStore(s => s.currentProject); // READ-ONLY
  
  const handleGenerate = async (prompt: string) => {
    const imageUrl = await FalAiService.generateImage(prompt);
    addAsset({ 
      id: crypto.randomUUID(),
      type: 'thumbnail', 
      url: imageUrl,
      projectId: project?.id,
      createdAt: new Date()
    });
  };
  
  return <PromptInput onGenerate={handleGenerate} />;
};
```
**Safety**: Only reads from existing project store, no mutations
**Reuse**: Logic adapted from nano-banana transformation flow
**Maintenance**: Single component responsible for thumbnail generation

### **Task 3.4: Basic Templates** ⏱️ *15 minutes*
```typescript
// src/components/editor/nano-edit/constants/templates.ts - NEW FILE
export const THUMBNAIL_TEMPLATES = [
  { id: 'youtube', name: 'YouTube', prompt: 'Create a vibrant YouTube thumbnail', dimensions: '1280x720' },
  { id: 'social', name: 'Social Media', prompt: 'Create a social media post image', dimensions: '1080x1080' },
];
```
**Safety**: New constants file, no existing templates affected
**Reuse**: Template concept from nano-banana constants.ts
**Maintenance**: Easy to add new templates without code changes

---

## **Phase 4: Enhancement Features (Day 6-7)**

### **Task 4.1: History Integration** ⏱️ *18 minutes*
```typescript
// Integrate nano-banana HistoryPanel into nano-edit components
cp nano-banana/components/HistoryPanel.tsx qcut/apps/web/src/components/editor/nano-edit/components/
// Adapt to use useNanoEditStore instead of local state
```
**Safety**: Self-contained component using nano-edit store only
**Reuse**: 85% direct copy with store integration
**Maintenance**: Update from nano-banana when history features improve

### **Task 4.2: Effect Gallery** ⏱️ *20 minutes*
```typescript
// Copy and adapt TransformationSelector
cp nano-banana/components/TransformationSelector.tsx qcut/apps/web/src/components/editor/nano-edit/components/EffectGallery.tsx
// Integrate with nano-edit store and QCut styling
```
**Safety**: Separate effect system from existing QCut video effects
**Reuse**: Direct adaptation of drag-and-drop gallery
**Maintenance**: Sync with nano-banana effect updates

### **Task 4.3: Result Display** ⏱️ *15 minutes*
```typescript
// Copy ResultDisplay with minor QCut adaptations
cp nano-banana/components/ResultDisplay.tsx qcut/apps/web/src/components/editor/nano-edit/components/
```
**Safety**: Self-contained preview component
**Reuse**: 95% direct copy from nano-banana
**Maintenance**: Standard React component maintenance

---

## **Phase 5: Polish & Testing (Day 8)**

### **Task 5.1: Integration Testing** ⏱️ *20 minutes*
```bash
# Verify no existing functionality broken
bun run test
bun run electron:dev
# Manual test: Create project, verify timeline, test nano-edit panel
```
**Safety**: Comprehensive testing ensures no regressions
**Reuse**: Use existing QCut testing infrastructure
**Maintenance**: Add to CI/CD pipeline

### **Task 5.2: Documentation Updates** ⏱️ *15 minutes*
```markdown
# Update CLAUDE.md with new nano-edit panel
- Document new media panel tab
- Add environment variable for FAL_KEY
- Update development commands
```
**Safety**: Documentation only, no code changes
**Reuse**: Follow existing QCut documentation patterns  
**Maintenance**: Update docs when features expand

### **Task 5.3: Error Handling** ⏱️ *20 minutes*
```typescript
// Add proper error boundaries and API error handling
// Integrate with existing QCut error system
```
**Safety**: Graceful degradation, no crashes
**Reuse**: Use QCut's existing error handling patterns
**Maintenance**: Standard error handling maintenance

---

## **🔄 Long-term Maintenance Strategy**

### **Code Reuse Maintenance**:
- **Quarterly sync** with nano-banana repository for component updates
- **Version pinning** for @fal-ai/client with controlled updates
- **Component isolation** ensures nano-edit updates don't affect core QCut

### **Feature Expansion Path**:
- **Phase 6**: Video frame processing (Style Transfer tab)
- **Phase 7**: Advanced templates (Templates tab enhancement)  
- **Phase 8**: Batch processing and automation features

### **Breaking Change Prevention**:
- **Separate namespace** for all nano-edit functionality
- **Read-only access** to existing QCut stores
- **Independent deployment** possible for nano-edit features
- **Feature flags** for gradual rollout and easy rollback

## Code Quality Assessment

### **Strengths of nano-banana Codebase**:
✅ **Excellent TypeScript usage** - Comprehensive interfaces, proper error handling
✅ **Clean React patterns** - Proper hook usage, component separation, lifecycle management  
✅ **Robust canvas implementation** - Efficient drawing, proper event handling, memory management
✅ **Professional UI/UX** - Smooth animations, accessibility features, responsive design
✅ **Modular architecture** - Clear separation of concerns, reusable components
✅ **Error handling** - Graceful failures, user feedback, recovery patterns

### **Areas for QCut Adaptation**:
⚠️ **Asset management integration** - Connect to QCut's project and file management systems
⚠️ **Batch processing patterns** - Extend single-image logic to multi-asset workflows  
⚠️ **State management integration** - Connect to QCut's Zustand stores for project data
⚠️ **Branding consistency** - Ensure generated assets match project/user brand guidelines

## Risk Assessment & Mitigation

### **Technical Risks**:
1. **⚠️ CRITICAL: Breaking Existing Functionality**
   - **Risk**: Modifying existing stores, components, or utilities could break video editing
   - **Mitigation**: 
     - Create completely separate AI modules (`src/components/editor/ai/`)
     - Use read-only access to existing stores
     - Comprehensive testing after each integration step
     - Immediate rollback plan if issues detected

2. **API Cost Management**: Image generation can accumulate costs with heavy usage
   - **Mitigation**: Implement usage limits, cost tracking, user approval for expensive operations

3. **Asset Storage**: Generated images require additional storage management
   - **Mitigation**: Implement cleanup policies, user-controlled retention, separate storage namespace

4. **Performance Impact**: AI processing could affect video editing performance
   - **Mitigation**: Use Web Workers, lazy loading, separate memory allocation for AI features

### **Success Metrics**:
1. **🎯 PRIMARY**: Zero existing functionality broken (100% existing tests must pass)
2. **📊 FUNCTIONALITY**: Positive user feedback on AI-generated thumbnails and title cards
3. **💰 COST**: Manageable API costs (<$5/month for typical user creating 125 assets)
4. **🎨 QUALITY**: Improved project branding consistency and professional appearance
5. **⚡ PERFORMANCE**: <5% impact on existing video editing performance

### **Rollback Triggers**:
- Any existing test fails after integration
- Video timeline or playback functionality affected
- More than 10% performance degradation
- Memory leaks or crashes introduced
- User reports of broken existing features