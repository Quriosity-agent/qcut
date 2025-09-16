# Draw Folder Analysis

## Overview
The `draw` folder contains a React-based AI image editing application called "🍌-nano-bananary｜zho" that integrates with Google's Gemini AI for image transformations.

## Project Structure

### Core Files
- **App.tsx** - Main React component handling image editing workflow
- **package.json** - Node.js project configuration with React 19 and Gemini AI dependencies
- **index.tsx** - Application entry point
- **index.html** - HTML template
- **vite.config.ts** - Vite build configuration
- **tsconfig.json** - TypeScript configuration
- **.env.local** - Environment variables (likely contains GEMINI_API_KEY)

### Key Directories
- **components/** - React UI components
- **services/** - API integration services (Gemini AI)
- **utils/** - Utility functions for file handling
- **types.ts** - TypeScript type definitions
- **constants.ts** - Application constants and transformations

## Technology Stack
- **Frontend**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 6.2.0
- **AI Integration**: Google Generative AI (@google/genai 1.17.0)
- **Node.js**: TypeScript support with @types/node

## Key Features (Based on Code Analysis)
- Image editing with AI-powered transformations
- Canvas-based image editor
- Multiple image upload support
- History panel for tracking changes
- Preview modal for images
- Watermark embedding functionality
- File download capabilities
- Transformation selector with customizable order

## Application Flow
1. User uploads primary/secondary images
2. Selects from predefined transformations
3. AI processes images using Gemini API
4. Results displayed with preview options
5. Users can download processed images

## Development Commands
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
```

## Dependencies
- React 19.1.1 (latest)
- Google Generative AI for image processing
- TypeScript for type safety
- Vite for fast development and building

## Notes
- Requires GEMINI_API_KEY environment variable
- Appears to be a standalone AI Studio app deployment
- Contains sophisticated image manipulation features
- Uses modern React patterns with hooks and TypeScript

---

## Integration Analysis: White-Draw Panel for QCut

### Reusable Components for QCut Integration

#### 🟢 **Highly Reusable Components**
- **ImageEditorCanvas.tsx** (11KB) - Core canvas-based drawing/editing functionality
- **HistoryPanel.tsx** (8KB) - History tracking system (already exists in QCut nano-edit)
- **MultiImageUploader.tsx** (5KB) - Multi-file upload with drag-and-drop
- **TransformationSelector.tsx** (3KB) - Transformation/tool selection interface
- **ImagePreviewModal.tsx** (2KB) - Modal for image preview and editing
- **ResultDisplay.tsx** (21KB) - Display results with download/export options

#### 🟡 **Adaptable Components**
- **LoadingSpinner.tsx** (900B) - Simple loading state component
- **ErrorMessage.tsx** (400B) - Error display component

#### 🔴 **QCut-Specific Adaptations Needed**
- **App.tsx** - Main component logic needs integration with QCut's editor state
- **services/geminiService.ts** - AI integration (may conflict with existing QCut AI features)

### Integration Strategy for White-Draw Panel

#### **Panel Structure**
```
apps/web/src/components/editor/white-draw-panel/
├── white-draw-panel.tsx                 # Main panel component
├── components/
│   ├── canvas/
│   │   ├── drawing-canvas.tsx          # Adapted from ImageEditorCanvas
│   │   └── canvas-tools.tsx            # Drawing tools (brush, eraser, etc.)
│   ├── ui/
│   │   ├── tool-selector.tsx           # Adapted from TransformationSelector
│   │   ├── image-uploader.tsx          # Adapted from MultiImageUploader
│   │   └── export-options.tsx          # Adapted from ResultDisplay
│   └── history/
│       └── drawing-history.tsx         # Adapted from HistoryPanel
├── hooks/
│   ├── use-drawing-state.ts            # Drawing state management
│   └── use-canvas-tools.ts             # Canvas tool logic
├── utils/
│   ├── canvas-utils.ts                 # Adapted from utils/fileUtils
│   └── drawing-export.ts              # Export functionality
└── types/
    └── drawing-types.ts                # Drawing-specific types
```

#### **Dependencies to Add to QCut**
```json
{
  "@google/genai": "^1.17.0"  // Only if AI features are desired
}
```

#### **QCut Integration Points**

1. **Panel Registration**
   - Add to `apps/web/src/components/editor/panel-layouts.tsx`
   - Follow existing panel pattern (media-panel, preview-panel, etc.)

2. **State Management**
   - Integrate with existing Zustand stores
   - Add `useWhiteDrawStore()` following QCut patterns

3. **Timeline Integration**
   - Export drawings as image/video elements to timeline
   - Support for drawing overlays on video frames

4. **File System Integration**
   - Use existing QCut file handling via Electron IPC
   - Leverage existing project storage system

#### **Key Features for White-Draw Panel**
- **Canvas Drawing**: Freehand drawing, shapes, text annotation
- **Image Import**: Import images from QCut project or external files
- **Layer Management**: Multiple drawing layers with opacity control
- **Export Options**: Export as PNG/SVG for timeline integration
- **Tool Palette**: Brushes, pens, shapes, text, eraser
- **History/Undo**: Drawing action history with undo/redo

#### **Compatibility Notes**
- Drawing components use React 19 patterns (compatible with QCut's React 18.3.1)
- Canvas-based approach fits well with QCut's video editing workflow
- File utilities can be adapted to use QCut's Electron file system APIs
- UI components should use QCut's existing Tailwind/Radix UI system

---

## 🚀 **Implementation Task Breakdown**

### **Phase 1: Foundation Setup** ⏱️ *15 minutes*

#### **Task 1.1: Create Base Panel Structure** ⏱️ *8 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/white-draw-panel.tsx` - Main panel component
- `apps/web/src/components/editor/white-draw-panel/index.ts` - Export barrel file
- `apps/web/src/stores/white-draw-store.ts` - Zustand store for drawing state

**Implementation:**
```typescript
// white-draw-panel.tsx - Basic panel structure following QCut patterns
export function WhiteDrawPanel() {
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 p-4">
        {/* Drawing canvas area */}
      </div>
    </div>
  );
}
```

#### **Task 1.2: Panel Registration** ⏱️ *4 minutes*
**Files to Modify:**
- `apps/web/src/components/editor/panel-layouts.tsx` - Add white-draw panel to layout system
- `apps/web/src/components/editor/panels/index.ts` - Export new panel

#### **Task 1.3: Store Integration** ⏱️ *3 minutes*
**Files to Modify:**
- `apps/web/src/stores/index.ts` - Export white-draw store

### **Phase 2: Core Canvas Implementation** ⏱️ *25 minutes*

#### **Task 2.1: Drawing Canvas Component** ⏱️ *15 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-canvas.tsx`
- `apps/web/src/components/editor/white-draw-panel/hooks/use-canvas-drawing.ts`
- `apps/web/src/components/editor/white-draw-panel/utils/canvas-utils.ts`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/ImageEditorCanvas.tsx`

#### **Task 2.2: Drawing Tools** ⏱️ *10 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-tools.tsx`
- `apps/web/src/components/editor/white-draw-panel/types/drawing-types.ts`

### **Phase 3: UI Components** ⏱️ *20 minutes*

#### **Task 3.1: Tool Selector** ⏱️ *8 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/tool-selector.tsx`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/TransformationSelector.tsx`

#### **Task 3.2: History Panel** ⏱️ *7 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-history.tsx`
- `apps/web/src/components/editor/white-draw-panel/hooks/use-drawing-history.ts`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/HistoryPanel.tsx`

#### **Task 3.3: Export Options** ⏱️ *5 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/export-options.tsx`

### **Phase 4: Timeline Integration** ⏱️ *15 minutes*

#### **Task 4.1: Drawing Export to Timeline** ⏱️ *10 minutes*
**Files to Modify:**
- `apps/web/src/stores/timeline-store.ts` - Add method to import drawing as media element
- `apps/web/src/components/editor/white-draw-panel/utils/timeline-integration.ts` - Export utilities

#### **Task 4.2: Drawing Layer Support** ⏱️ *5 minutes*
**Files to Modify:**
- `apps/web/src/components/editor/timeline/timeline-element.tsx` - Support drawing overlay type

### **Phase 5: File System Integration** ⏱️ *12 minutes*

#### **Task 5.1: Project Storage** ⏱️ *7 minutes*
**Files to Modify:**
- `electron/main.ts` - Add IPC handlers for drawing save/load
- `apps/web/src/lib/electron-api.ts` - Add drawing storage APIs

#### **Task 5.2: Drawing Persistence** ⏱️ *5 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/utils/drawing-storage.ts`

### **Phase 6: Testing & Safety** ⏱️ *18 minutes*

#### **Task 6.1: Component Tests** ⏱️ *12 minutes*
**Files to Create:**
- `apps/web/src/test/components/white-draw-panel.test.tsx`
- `apps/web/src/test/stores/white-draw-store.test.ts`

#### **Task 6.2: Integration Safety Check** ⏱️ *6 minutes*
**Files to Test:**
- Run existing E2E tests to ensure no regressions
- Test timeline functionality with new drawing elements
- Verify panel switching doesn't break existing features

---

## 🛡️ **Safety & Non-Breaking Integration Strategy**

### **Critical Safety Measures**

#### **1. Panel System Safety** ⏱️ *3 minutes*
- **Isolation**: White-draw panel operates independently within existing panel system
- **No Core Modifications**: Zero changes to core editor, timeline, or video processing logic
- **Graceful Degradation**: Panel can be disabled without affecting existing functionality

#### **2. Store Isolation** ⏱️ *2 minutes*
- **Separate Store**: `useWhiteDrawStore()` doesn't interact with core stores (`useTimelineStore`, `useEditorStore`)
- **Optional Integration**: Timeline integration is additive, not modifying existing timeline logic

#### **3. File System Safety** ⏱️ *2 minutes*
- **Namespaced Storage**: Drawing files stored in dedicated `drawings/` project subfolder
- **Electron API Extension**: New IPC handlers don't modify existing file operations

### **Non-Breaking Implementation Checklist**

#### **Before Integration:**
- [ ] Backup current working branch
- [ ] Run full test suite: `bun run test`
- [ ] Verify E2E tests pass: `bun x playwright test --project=electron`

#### **During Implementation:**
- [ ] Test panel switching after each phase
- [ ] Verify timeline operations remain functional
- [ ] Check video export process isn't affected
- [ ] Monitor memory usage with drawing operations

#### **After Integration:**
- [ ] Full regression test of core video editing workflow
- [ ] E2E test verification: `bun x playwright test project-workflow-part1.e2e.ts --project=electron`
- [ ] Performance benchmark comparison

### **Rollback Plan**

If issues arise:
1. **Immediate**: Disable panel via feature flag in `panel-layouts.tsx`
2. **Full Rollback**: Remove white-draw-panel directory and store imports
3. **Electron Safety**: IPC handlers are additive - can be removed without breaking existing APIs

---

## 📋 **Total Implementation Timeline**

| Phase | Tasks | Duration | Risk Level |
|-------|-------|----------|------------|
| **Phase 1** | Foundation Setup | 15 min | 🟢 Low |
| **Phase 2** | Core Canvas | 25 min | 🟡 Medium |
| **Phase 3** | UI Components | 20 min | 🟢 Low |
| **Phase 4** | Timeline Integration | 15 min | 🟡 Medium |
| **Phase 5** | File System | 12 min | 🟡 Medium |
| **Phase 6** | Testing & Safety | 18 min | 🟢 Low |
| **Total** | **6 Phases** | **105 min** | **🟢 Safe** |

### **Critical Success Factors**
1. **Incremental Testing**: Test after each phase completion
2. **Panel Isolation**: Maintain strict separation from core editor logic
3. **Existing Pattern Following**: Use QCut's established patterns for panels, stores, and components
4. **Electron API Safety**: Extend rather than modify existing IPC handlers

### **Dependencies & Prerequisites**
- **QCut Build**: Must be working (`bun run build`)
- **E2E Tests**: Core tests must pass before integration
- **Canvas API**: Browser canvas support (already available in Electron)
- **No New Dependencies**: Implementation uses existing QCut tech stack

---

## 🔍 **Detailed Code Analysis & Implementation Patterns**

### **Canvas Implementation Analysis from ImageEditorCanvas.tsx**

#### **Core Canvas Features Identified:**
```typescript
// Key features from draw/components/ImageEditorCanvas.tsx
interface CanvasFeatures {
  // Dual canvas system for layers
  imageCanvas: HTMLCanvasElement;     // Background/image layer
  maskCanvas: HTMLCanvasElement;      // Drawing/mask layer

  // Drawing state management
  isDrawing: boolean;
  lastPos: { x: number; y: number };
  brushSize: number;
  history: ImageData[];               // Undo/redo system

  // Image handling
  image: HTMLImageElement;
  aspectRatioHandling: boolean;       // Auto-fit to container
  crossOriginSupport: boolean;        // For external images
}
```

#### **Drawing Implementation Pattern:**
```typescript
// Mouse/touch event handling pattern from ImageEditorCanvas
const handleDrawing = {
  onMouseDown: (e) => {
    setIsDrawing(true);
    saveToHistory();  // Save state before drawing
    setLastPos(getCanvasCoordinates(e));
  },
  onMouseMove: (e) => {
    if (!isDrawing) return;
    drawLine(lastPos, getCanvasCoordinates(e));
    setLastPos(getCanvasCoordinates(e));
  },
  onMouseUp: () => {
    setIsDrawing(false);
    onMaskChange(canvas.toDataURL()); // Export to parent
  }
};
```

### **QCut Panel Architecture Analysis**

#### **Panel Registration Pattern (from panel-layouts.tsx):**
```typescript
// QCut uses ResizablePanelGroup structure
interface PanelStructure {
  toolsPanel: number;     // Left sidebar percentage
  previewPanel: number;   // Center preview percentage
  propertiesPanel: number; // Right sidebar percentage

  // Normalization ensures panels sum to 100%
  normalizationFactor: number;
}

// Implementation pattern for white-draw integration:
const WhiteDrawPanelIntegration = {
  // Add to existing MediaPanel tab system
  location: "toolsPanel",           // Left sidebar with media
  tabName: "draw",                 // New tab in MediaPanel
  component: "<WhiteDrawView />",   // Component to render
};
```

#### **Store Pattern Analysis (from editor-store.ts):**
```typescript
// QCut Zustand store pattern to follow
interface StorePattern {
  // State properties
  isInitializing: boolean;
  canvasSize: CanvasSize;

  // Actions with descriptive names
  setInitializing: (loading: boolean) => void;
  initializeApp: () => Promise<void>;
}

// White-draw store should follow this pattern:
interface WhiteDrawStore {
  // Drawing state
  isDrawing: boolean;
  currentTool: DrawingTool;
  brushSize: number;
  color: string;
  layers: DrawingLayer[];
  history: DrawingHistory[];

  // Actions
  setDrawing: (drawing: boolean) => void;
  setTool: (tool: DrawingTool) => void;
  setBrushSize: (size: number) => void;
  addLayer: () => void;
  undo: () => void;
  redo: () => void;
  exportToTimeline: () => Promise<void>;
}
```

### **MediaPanel Integration Pattern**

#### **Tab System Integration (from media-panel/index.tsx):**
```typescript
// Current MediaPanel tabs structure
type ExistingTabs = "media" | "audio" | "text" | "stickers" | "effects" | "captions";

// Add white-draw to existing tab system
type UpdatedTabs = ExistingTabs | "draw";

const viewMap: Record<UpdatedTabs, React.ReactNode> = {
  // ... existing tabs
  draw: <WhiteDrawView />,  // New tab integration
};

// Tab configuration
const drawTabConfig = {
  id: "draw" as const,
  label: "Draw",
  icon: "✏️",              // Or use Lucide icon
  component: WhiteDrawView,
};
```

### **File Utilities Adaptation from draw/utils/fileUtils.ts**

#### **QCut-Compatible File Handling:**
```typescript
// Adapt existing utilities for QCut's Electron environment
class QCutDrawingFileUtils {
  // Use QCut's Electron IPC instead of browser file APIs
  static async saveDrawing(drawingData: string, projectId: string): Promise<string> {
    return window.electronAPI?.files?.saveDrawing?.(drawingData, projectId) || "";
  }

  static async loadDrawing(drawingId: string): Promise<string> {
    return window.electronAPI?.files?.loadDrawing?.(drawingId) || "";
  }

  // Maintain browser compatibility for canvas operations
  static dataUrlToFile = dataUrlToFile;     // Keep from original
  static loadImage = loadImage;             // Keep from original
  static downloadImage = downloadImage;     // Keep from original

  // Adapt watermarking for QCut projects
  static async embedProjectWatermark(imageUrl: string, projectId: string): Promise<string> {
    const watermarkText = `QCut-${projectId}-${Date.now()}`;
    return embedWatermark(imageUrl, watermarkText);
  }
}
```

### **Timeline Integration Specification**

#### **Drawing Element Type Addition:**
```typescript
// Extend QCut's timeline element types
type ExistingElementTypes = "video" | "audio" | "image" | "text";
type ExtendedElementTypes = ExistingElementTypes | "drawing";

interface DrawingTimelineElement {
  type: "drawing";
  id: string;
  drawingData: string;        // Base64 canvas data
  duration: number;           // Display duration
  opacity: number;            // Layer opacity
  blendMode: string;          // Canvas blend mode
  position: { x: number; y: number; };
  scale: { x: number; y: number; };
}
```

#### **Export Integration with QCut Timeline:**
```typescript
// Integration with QCut's timeline store
const timelineIntegration = {
  exportAsImage: async (drawingData: string) => {
    const file = await dataUrlToFile(drawingData, `drawing-${Date.now()}.png`);
    // Use QCut's existing media import system
    return useTimelineStore.getState().addMediaElement(file, "image");
  },

  exportAsOverlay: async (drawingData: string) => {
    // Create transparent overlay element
    const overlayElement: DrawingTimelineElement = {
      type: "drawing",
      id: `drawing-${Date.now()}`,
      drawingData,
      duration: 5000,  // 5 second default
      opacity: 0.8,
      blendMode: "normal",
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 }
    };

    return useTimelineStore.getState().addElement(overlayElement);
  }
};
```

### **Component Architecture Deep Dive**

#### **DrawingCanvas Component (adapted from ImageEditorCanvas):**
```typescript
// Core drawing canvas following QCut patterns
interface DrawingCanvasProps {
  width: number;
  height: number;
  onDrawingChange: (dataUrl: string) => void;
  tool: DrawingTool;
  brushSize: number;
  color: string;
  backgroundImage?: string;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  width, height, onDrawingChange, tool, brushSize, color, backgroundImage
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  // Implement drawing logic adapted from ImageEditorCanvas
  // with QCut-specific optimizations

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="border border-border cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
};
```

#### **Tool Selector Component (adapted from TransformationSelector):**
```typescript
// Drawing tools selector following QCut UI patterns
interface DrawingTool {
  id: string;
  name: string;
  icon: React.ReactNode;
  cursor: string;
  settings?: ToolSettings;
}

const drawingTools: DrawingTool[] = [
  { id: "brush", name: "Brush", icon: <Brush />, cursor: "crosshair" },
  { id: "eraser", name: "Eraser", icon: <Eraser />, cursor: "crosshair" },
  { id: "line", name: "Line", icon: <Minus />, cursor: "crosshair" },
  { id: "rectangle", name: "Rectangle", icon: <Square />, cursor: "crosshair" },
  { id: "circle", name: "Circle", icon: <Circle />, cursor: "crosshair" },
  { id: "text", name: "Text", icon: <Type />, cursor: "text" },
];
```

### **Memory Management & Performance**

#### **Canvas Optimization for QCut:**
```typescript
// Optimize for video editor performance
const canvasOptimizations = {
  // Debounce drawing operations to prevent lag
  debouncedDraw: useMemo(
    () => debounce((drawData) => onDrawingChange(drawData), 100),
    [onDrawingChange]
  ),

  // Limit history size to prevent memory issues
  maxHistorySize: 50,

  // Use requestAnimationFrame for smooth drawing
  useAnimationFrame: true,

  // Canvas recycling for multiple drawings
  canvasPool: new Map<string, HTMLCanvasElement>(),
};
```

### **Electron IPC Integration**

#### **Drawing Storage IPC Handlers:**
```typescript
// Add to electron/main.ts
const drawingHandlers = {
  "drawing:save": async (drawingData: string, projectId: string) => {
    const drawingPath = path.join(projectsDir, projectId, "drawings");
    await fs.ensureDir(drawingPath);
    const filename = `drawing-${Date.now()}.png`;
    const filePath = path.join(drawingPath, filename);

    // Convert base64 to buffer and save
    const base64Data = drawingData.replace(/^data:image\/png;base64,/, "");
    await fs.writeFile(filePath, base64Data, "base64");
    return filename;
  },

  "drawing:load": async (filename: string, projectId: string) => {
    const filePath = path.join(projectsDir, projectId, "drawings", filename);
    const buffer = await fs.readFile(filePath);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  },

  "drawing:list": async (projectId: string) => {
    const drawingPath = path.join(projectsDir, projectId, "drawings");
    if (!(await fs.pathExists(drawingPath))) return [];
    return fs.readdir(drawingPath);
  }
};
```