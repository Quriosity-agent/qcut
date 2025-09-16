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

**Detailed Implementation:**
```typescript
// white-draw-panel.tsx - Basic panel structure following QCut patterns
import { useWhiteDrawStore } from "@/stores/white-draw-store";

export function WhiteDrawPanel() {
  const { currentTool, isDrawing } = useWhiteDrawStore();

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 p-4">
        {/* Drawing canvas area - placeholder for Phase 2 */}
        <div className="w-full h-full border-2 border-dashed border-border rounded-lg flex items-center justify-center">
          <p className="text-muted-foreground">Drawing Canvas (Phase 2)</p>
        </div>
      </div>
    </div>
  );
}

// white-draw-store.ts - Zustand store following QCut patterns
import { create } from "zustand";

interface DrawingTool {
  id: string;
  name: string;
  cursor: string;
}

interface WhiteDrawStore {
  // Drawing state
  isDrawing: boolean;
  currentTool: DrawingTool;
  brushSize: number;
  color: string;
  layers: string[]; // Canvas data URLs
  history: string[]; // History states
  historyIndex: number;

  // Actions
  setDrawing: (drawing: boolean) => void;
  setTool: (tool: DrawingTool) => void;
  setBrushSize: (size: number) => void;
  setColor: (color: string) => void;
  addLayer: () => void;
  saveToHistory: (state: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

export const useWhiteDrawStore = create<WhiteDrawStore>((set, get) => ({
  // Initial state
  isDrawing: false,
  currentTool: { id: "brush", name: "Brush", cursor: "crosshair" },
  brushSize: 10,
  color: "#000000",
  layers: [],
  history: [],
  historyIndex: -1,

  // Actions
  setDrawing: (drawing) => set({ isDrawing: drawing }),
  setTool: (tool) => set({ currentTool: tool }),
  setBrushSize: (size) => set({ brushSize: size }),
  setColor: (color) => set({ color }),
  addLayer: () => set((state) => ({ layers: [...state.layers, ""] })),

  saveToHistory: (state) => set((current) => {
    const newHistory = current.history.slice(0, current.historyIndex + 1);
    newHistory.push(state);
    return {
      history: newHistory.slice(-50), // Limit to 50 states
      historyIndex: newHistory.length - 1
    };
  }),

  undo: () => set((state) => ({
    historyIndex: Math.max(0, state.historyIndex - 1)
  })),

  redo: () => set((state) => ({
    historyIndex: Math.min(state.history.length - 1, state.historyIndex + 1)
  })),

  clear: () => set({
    layers: [],
    history: [],
    historyIndex: -1,
    isDrawing: false
  })
}));
```

#### **Task 1.2: Panel Registration** ⏱️ *4 minutes*
**Files to Modify:**
- `apps/web/src/components/editor/panel-layouts.tsx` - Add white-draw panel to layout system
- `apps/web/src/components/editor/media-panel/index.tsx` - Add draw tab

**Implementation Pattern:**
```typescript
// In media-panel/index.tsx, add to viewMap:
import { WhiteDrawView } from "./views/white-draw";

const viewMap: Record<Tab, React.ReactNode> = {
  // ... existing tabs
  draw: <WhiteDrawView />,
};

// In media-panel/store.ts, update Tab type:
export type Tab = "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions" | "filters" | "text2image" | "ai" | "sounds" | "nano-edit" | "draw";
```

#### **Task 1.3: Store Integration** ⏱️ *3 minutes*
**Files to Modify:**
- `apps/web/src/stores/index.ts` - Export white-draw store

**Implementation:**
```typescript
// Add to stores/index.ts
export { useWhiteDrawStore } from "./white-draw-store";
```

### **Phase 2: Core Canvas Implementation** ⏱️ *25 minutes*

#### **Task 2.1: Drawing Canvas Component** ⏱️ *15 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-canvas.tsx`
- `apps/web/src/components/editor/white-draw-panel/hooks/use-canvas-drawing.ts`
- `apps/web/src/components/editor/white-draw-panel/utils/canvas-utils.ts`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/ImageEditorCanvas.tsx`

**Detailed Implementation:**
```typescript
// drawing-canvas.tsx - Core drawing canvas following QCut patterns
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { useCanvasDrawing } from "../hooks/use-canvas-drawing";

interface DrawingCanvasProps {
  width: number;
  height: number;
  onDrawingChange: (dataUrl: string) => void;
  backgroundImage?: string;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  width, height, onDrawingChange, backgroundImage
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const { currentTool, brushSize, color, isDrawing, setDrawing, saveToHistory } = useWhiteDrawStore();

  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  } = useCanvasDrawing(canvasRef, {
    tool: currentTool,
    brushSize,
    color,
    onDrawingStart: () => {
      setDrawing(true);
      if (canvasRef.current) {
        saveToHistory(canvasRef.current.toDataURL());
      }
    },
    onDrawingEnd: () => {
      setDrawing(false);
      if (canvasRef.current) {
        onDrawingChange(canvasRef.current.toDataURL());
      }
    }
  });

  // Initialize canvases
  useEffect(() => {
    const canvas = canvasRef.current;
    const bgCanvas = backgroundCanvasRef.current;

    if (canvas && bgCanvas) {
      canvas.width = width;
      canvas.height = height;
      bgCanvas.width = width;
      bgCanvas.height = height;

      // Draw background image if provided
      if (backgroundImage) {
        const ctx = bgCanvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx?.drawImage(img, 0, 0, width, height);
        };
        img.src = backgroundImage;
      }
    }
  }, [width, height, backgroundImage]);

  return (
    <div className="relative" style={{ width, height }}>
      {/* Background canvas for images */}
      <canvas
        ref={backgroundCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`absolute inset-0 border border-border ${currentTool.cursor}`}
        style={{ zIndex: 2 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
};

// use-canvas-drawing.ts - Drawing logic hook
import { useCallback, useRef } from 'react';

interface DrawingOptions {
  tool: { id: string; cursor: string };
  brushSize: number;
  color: string;
  onDrawingStart: () => void;
  onDrawingEnd: () => void;
}

export const useCanvasDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: DrawingOptions
) => {
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getCanvasCoordinates = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }, []);

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.lineWidth = options.brushSize;
    ctx.strokeStyle = options.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (options.tool.id === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, [options.brushSize, options.color, options.tool.id]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDrawing.current = true;
    const pos = getCanvasCoordinates(e.nativeEvent);
    lastPos.current = pos;
    options.onDrawingStart();
  }, [getCanvasCoordinates, options.onDrawingStart]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing.current || !lastPos.current) return;

    const currentPos = getCanvasCoordinates(e.nativeEvent);
    drawLine(lastPos.current, currentPos);
    lastPos.current = currentPos;
  }, [getCanvasCoordinates, drawLine]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing.current) {
      isDrawing.current = false;
      lastPos.current = null;
      options.onDrawingEnd();
    }
  }, [options.onDrawingEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const pos = getCanvasCoordinates(e.nativeEvent);
    lastPos.current = pos;
    options.onDrawingStart();
  }, [getCanvasCoordinates, options.onDrawingStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current || !lastPos.current) return;

    const currentPos = getCanvasCoordinates(e.nativeEvent);
    drawLine(lastPos.current, currentPos);
    lastPos.current = currentPos;
  }, [getCanvasCoordinates, drawLine]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  }, [handleMouseUp]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  };
};

// canvas-utils.ts - Canvas utility functions adapted from fileUtils.ts
export const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
};

export const downloadDrawing = (dataUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const resizeCanvas = (
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number
): string => {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  tempCanvas.width = width;
  tempCanvas.height = height;

  if (tempCtx) {
    tempCtx.drawImage(sourceCanvas, 0, 0, width, height);
  }

  return tempCanvas.toDataURL('image/png');
};
```

#### **Task 2.2: Drawing Tools** ⏱️ *10 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-tools.tsx`
- `apps/web/src/components/editor/white-draw-panel/types/drawing-types.ts`

**Implementation:**
```typescript
// drawing-types.ts - TypeScript definitions
export interface DrawingTool {
  id: string;
  name: string;
  icon: React.ReactNode;
  cursor: string;
  settings?: ToolSettings;
}

export interface ToolSettings {
  brushSize?: { min: number; max: number; default: number };
  opacity?: { min: number; max: number; default: number };
  color?: boolean;
}

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  data: string; // Canvas data URL
}

// drawing-tools.tsx - Tool constants and configurations
import { Brush, Eraser, Minus, Square, Circle, Type } from "lucide-react";

export const DRAWING_TOOLS: DrawingTool[] = [
  {
    id: "brush",
    name: "Brush",
    icon: <Brush size={16} />,
    cursor: "crosshair",
    settings: {
      brushSize: { min: 1, max: 100, default: 10 },
      opacity: { min: 0.1, max: 1, default: 1 },
      color: true
    }
  },
  {
    id: "eraser",
    name: "Eraser",
    icon: <Eraser size={16} />,
    cursor: "crosshair",
    settings: {
      brushSize: { min: 5, max: 100, default: 20 }
    }
  },
  {
    id: "line",
    name: "Line",
    icon: <Minus size={16} />,
    cursor: "crosshair",
    settings: {
      brushSize: { min: 1, max: 20, default: 2 },
      color: true
    }
  },
  {
    id: "rectangle",
    name: "Rectangle",
    icon: <Square size={16} />,
    cursor: "crosshair",
    settings: {
      brushSize: { min: 1, max: 20, default: 2 },
      color: true
    }
  },
  {
    id: "circle",
    name: "Circle",
    icon: <Circle size={16} />,
    cursor: "crosshair",
    settings: {
      brushSize: { min: 1, max: 20, default: 2 },
      color: true
    }
  },
  {
    id: "text",
    name: "Text",
    icon: <Type size={16} />,
    cursor: "text",
    settings: {
      brushSize: { min: 8, max: 72, default: 16 },
      color: true
    }
  }
];
```

### **Phase 3: UI Components** ⏱️ *20 minutes*

#### **Task 3.1: Tool Selector** ⏱️ *8 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/tool-selector.tsx`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/TransformationSelector.tsx`

**Implementation:**
```typescript
// tool-selector.tsx - Drawing tools selector following QCut UI patterns
import { Button } from "@/components/ui/button";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { DRAWING_TOOLS } from "./drawing-tools";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export const ToolSelector: React.FC = () => {
  const { currentTool, setTool, brushSize, setBrushSize, color, setColor } = useWhiteDrawStore();

  return (
    <div className="p-4 border-b border-border">
      {/* Tool Selection */}
      <div className="mb-4">
        <Label className="text-sm font-medium mb-2 block">Tools</Label>
        <div className="grid grid-cols-3 gap-2">
          {DRAWING_TOOLS.map((tool) => (
            <Button
              key={tool.id}
              variant={currentTool.id === tool.id ? "default" : "outline"}
              size="sm"
              onClick={() => setTool(tool)}
              className="flex flex-col items-center gap-1 h-auto py-2"
            >
              {tool.icon}
              <span className="text-xs">{tool.name}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Tool Settings */}
      {currentTool.settings && (
        <div className="space-y-4">
          {/* Brush Size */}
          {currentTool.settings.brushSize && (
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Size: {brushSize}px
              </Label>
              <Slider
                value={[brushSize]}
                onValueChange={([value]) => setBrushSize(value)}
                min={currentTool.settings.brushSize.min}
                max={currentTool.settings.brushSize.max}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Color Picker */}
          {currentTool.settings.color && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded border border-border cursor-pointer"
                />
                <span className="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

#### **Task 3.2: History Panel** ⏱️ *7 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/drawing-history.tsx`
- `apps/web/src/components/editor/white-draw-panel/hooks/use-drawing-history.ts`

**Adapted from:** `qcut/docs/issues/white-board/draw/components/HistoryPanel.tsx`

**Implementation:**
```typescript
// drawing-history.tsx - History panel with undo/redo
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, RotateCcw } from "lucide-react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { Label } from "@/components/ui/label";

export const DrawingHistory: React.FC = () => {
  const { history, historyIndex, undo, redo, clear } = useWhiteDrawStore();

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div className="p-4 border-b border-border">
      <Label className="text-sm font-medium mb-2 block">History</Label>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
        >
          <Undo2 size={14} />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
        >
          <Redo2 size={14} />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={clear}
          title="Clear All"
          className="ml-auto"
        >
          <RotateCcw size={14} />
        </Button>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {history.length > 0 ? `${historyIndex + 1} / ${history.length}` : "No history"}
      </div>
    </div>
  );
};

// use-drawing-history.ts - History management hook
import { useCallback } from 'react';
import { useWhiteDrawStore } from '@/stores/white-draw-store';

export const useDrawingHistory = () => {
  const store = useWhiteDrawStore();

  const saveState = useCallback((canvasDataUrl: string) => {
    store.saveToHistory(canvasDataUrl);
  }, [store]);

  const getCurrentState = useCallback(() => {
    if (store.historyIndex >= 0 && store.historyIndex < store.history.length) {
      return store.history[store.historyIndex];
    }
    return null;
  }, [store.history, store.historyIndex]);

  return {
    saveState,
    getCurrentState,
    undo: store.undo,
    redo: store.redo,
    clear: store.clear,
    canUndo: store.historyIndex > 0,
    canRedo: store.historyIndex < store.history.length - 1,
    historyLength: store.history.length
  };
};
```

#### **Task 3.3: Export Options** ⏱️ *5 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/components/export-options.tsx`

**Implementation:**
```typescript
// export-options.tsx - Export and timeline integration
import { Button } from "@/components/ui/button";
import { Download, Plus, Image } from "lucide-react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { downloadDrawing, dataUrlToFile } from "../utils/canvas-utils";
import { useTimelineStore } from "@/stores/timeline-store";
import { Label } from "@/components/ui/label";

export const ExportOptions: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement> }> = ({ canvasRef }) => {
  const { layers } = useWhiteDrawStore();
  const timelineStore = useTimelineStore();

  const handleDownload = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      downloadDrawing(dataUrl, `drawing-${Date.now()}.png`);
    }
  };

  const handleAddToTimeline = async () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const file = await dataUrlToFile(dataUrl, `drawing-${Date.now()}.png`);

      // Add to timeline as image element
      // This will need integration with actual timeline store methods
      console.log('Adding drawing to timeline:', file);
    }
  };

  return (
    <div className="p-4 border-t border-border">
      <Label className="text-sm font-medium mb-2 block">Export</Label>

      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className="w-full justify-start"
          disabled={!canvasRef.current}
        >
          <Download size={14} className="mr-2" />
          Download PNG
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleAddToTimeline}
          className="w-full justify-start"
          disabled={!canvasRef.current}
        >
          <Plus size={14} className="mr-2" />
          Add to Timeline
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={!canvasRef.current}
        >
          <Image size={14} className="mr-2" />
          Save to Project
        </Button>
      </div>
    </div>
  );
};
```

### **Phase 4: Timeline Integration** ⏱️ *15 minutes*

#### **Task 4.1: Drawing Export to Timeline** ⏱️ *10 minutes*
**Files to Modify:**
- `apps/web/src/stores/timeline-store.ts` - Add method to import drawing as media element
- `apps/web/src/components/editor/white-draw-panel/utils/timeline-integration.ts` - Export utilities

**Implementation:**
```typescript
// timeline-integration.ts - Timeline integration utilities
import { useTimelineStore } from "@/stores/timeline-store";
import { dataUrlToFile } from "./canvas-utils";

export interface DrawingTimelineElement {
  type: "drawing";
  id: string;
  drawingData: string;        // Base64 canvas data
  duration: number;           // Display duration in ms
  opacity: number;            // Layer opacity
  blendMode: string;          // Canvas blend mode
  position: { x: number; y: number; };
  scale: { x: number; y: number; };
}

export const timelineIntegration = {
  exportAsImage: async (drawingData: string): Promise<void> => {
    const file = await dataUrlToFile(drawingData, `drawing-${Date.now()}.png`);
    // Use QCut's existing media import system
    const timelineStore = useTimelineStore.getState();

    // This needs to be adapted to actual QCut timeline methods
    if (timelineStore.addMediaElement) {
      await timelineStore.addMediaElement(file, "image");
    }
  },

  exportAsOverlay: async (drawingData: string): Promise<void> => {
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

    const timelineStore = useTimelineStore.getState();

    // This needs to be adapted to actual QCut timeline methods
    if (timelineStore.addElement) {
      await timelineStore.addElement(overlayElement);
    }
  },

  saveToProject: async (drawingData: string, projectId: string): Promise<string> => {
    // Use Electron IPC for saving to project
    if (window.electronAPI?.files?.saveDrawing) {
      return await window.electronAPI.files.saveDrawing(drawingData, projectId);
    }

    // Fallback for browser testing
    const file = await dataUrlToFile(drawingData, `drawing-${Date.now()}.png`);
    return URL.createObjectURL(file);
  }
};
```

#### **Task 4.2: Drawing Layer Support** ⏱️ *5 minutes*
**Files to Modify:**
- `apps/web/src/components/editor/timeline/timeline-element.tsx` - Support drawing overlay type

**Implementation Note:**
```typescript
// Add to timeline element types
type ElementType = "video" | "audio" | "image" | "text" | "drawing";

// In timeline-element.tsx, add rendering support for drawing elements
const renderDrawingElement = (element: DrawingTimelineElement) => {
  return (
    <div
      className="timeline-element drawing-element"
      style={{
        opacity: element.opacity,
        mixBlendMode: element.blendMode as any
      }}
    >
      <img
        src={element.drawingData}
        alt="Drawing overlay"
        style={{
          transform: `scale(${element.scale.x}, ${element.scale.y})`,
          position: 'absolute',
          left: element.position.x,
          top: element.position.y
        }}
      />
    </div>
  );
};
```

### **Phase 5: File System Integration** ⏱️ *12 minutes*

#### **Task 5.1: Project Storage** ⏱️ *7 minutes*
**Files to Modify:**
- `electron/main.ts` - Add IPC handlers for drawing save/load
- `apps/web/src/lib/electron-api.ts` - Add drawing storage APIs

**Implementation:**
```typescript
// Add to electron/main.ts - Drawing Storage IPC Handlers
const drawingHandlers = {
  "drawing:save": async (drawingData: string, projectId: string): Promise<string> => {
    const drawingPath = path.join(projectsDir, projectId, "drawings");
    await fs.ensureDir(drawingPath);
    const filename = `drawing-${Date.now()}.png`;
    const filePath = path.join(drawingPath, filename);

    // Convert base64 to buffer and save
    const base64Data = drawingData.replace(/^data:image\/png;base64,/, "");
    await fs.writeFile(filePath, base64Data, "base64");
    return filename;
  },

  "drawing:load": async (filename: string, projectId: string): Promise<string> => {
    const filePath = path.join(projectsDir, projectId, "drawings", filename);
    const buffer = await fs.readFile(filePath);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  },

  "drawing:list": async (projectId: string): Promise<string[]> => {
    const drawingPath = path.join(projectsDir, projectId, "drawings");
    if (!(await fs.pathExists(drawingPath))) return [];
    return fs.readdir(drawingPath);
  },

  "drawing:delete": async (filename: string, projectId: string): Promise<void> => {
    const filePath = path.join(projectsDir, projectId, "drawings", filename);
    await fs.remove(filePath);
  }
};

// Register handlers
Object.entries(drawingHandlers).forEach(([channel, handler]) => {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`Error in ${channel}:`, error);
      throw error;
    }
  });
});

// Add to electron-api.ts
declare global {
  interface Window {
    electronAPI: {
      // ... existing APIs
      drawings: {
        save: (drawingData: string, projectId: string) => Promise<string>;
        load: (filename: string, projectId: string) => Promise<string>;
        list: (projectId: string) => Promise<string[]>;
        delete: (filename: string, projectId: string) => Promise<void>;
      };
    };
  }
}
```

#### **Task 5.2: Drawing Persistence** ⏱️ *5 minutes*
**Files to Create:**
- `apps/web/src/components/editor/white-draw-panel/utils/drawing-storage.ts`

**Implementation:**
```typescript
// drawing-storage.ts - Drawing persistence utilities
export class DrawingStorage {
  static async saveDrawing(drawingData: string, projectId: string): Promise<string> {
    if (window.electronAPI?.drawings?.save) {
      return await window.electronAPI.drawings.save(drawingData, projectId);
    }

    // Fallback for browser development
    const key = `drawing-${projectId}-${Date.now()}`;
    localStorage.setItem(key, drawingData);
    return key;
  }

  static async loadDrawing(filename: string, projectId: string): Promise<string> {
    if (window.electronAPI?.drawings?.load) {
      return await window.electronAPI.drawings.load(filename, projectId);
    }

    // Fallback for browser development
    return localStorage.getItem(filename) || "";
  }

  static async listDrawings(projectId: string): Promise<string[]> {
    if (window.electronAPI?.drawings?.list) {
      return await window.electronAPI.drawings.list(projectId);
    }

    // Fallback for browser development
    const keys = Object.keys(localStorage);
    return keys.filter(key => key.startsWith(`drawing-${projectId}-`));
  }

  static async deleteDrawing(filename: string, projectId: string): Promise<void> {
    if (window.electronAPI?.drawings?.delete) {
      return await window.electronAPI.drawings.delete(filename, projectId);
    }

    // Fallback for browser development
    localStorage.removeItem(filename);
  }

  static async autosaveDrawing(drawingData: string, projectId: string): Promise<void> {
    const autosaveKey = `autosave-drawing-${projectId}`;

    if (window.electronAPI?.drawings?.save) {
      await window.electronAPI.drawings.save(drawingData, `${projectId}-autosave`);
    } else {
      localStorage.setItem(autosaveKey, drawingData);
    }
  }

  static async loadAutosave(projectId: string): Promise<string | null> {
    const autosaveKey = `autosave-drawing-${projectId}`;

    if (window.electronAPI?.drawings?.load) {
      try {
        return await window.electronAPI.drawings.load("autosave", `${projectId}-autosave`);
      } catch {
        return null;
      }
    } else {
      return localStorage.getItem(autosaveKey);
    }
  }
}
```

### **Phase 6: Testing & Safety** ⏱️ *18 minutes*

#### **Task 6.1: Component Tests** ⏱️ *12 minutes*
**Files to Create:**
- `apps/web/src/test/components/white-draw-panel.test.tsx`
- `apps/web/src/test/stores/white-draw-store.test.ts`

**Implementation:**
```typescript
// white-draw-panel.test.tsx - Component tests
import { render, screen, fireEvent } from '@testing-library/react';
import { WhiteDrawPanel } from '@/components/editor/white-draw-panel';
import { useWhiteDrawStore } from '@/stores/white-draw-store';

// Mock the store
jest.mock('@/stores/white-draw-store');

describe('WhiteDrawPanel', () => {
  beforeEach(() => {
    (useWhiteDrawStore as jest.Mock).mockReturnValue({
      currentTool: { id: 'brush', name: 'Brush', cursor: 'crosshair' },
      isDrawing: false,
      brushSize: 10,
      color: '#000000',
      setTool: jest.fn(),
      setBrushSize: jest.fn(),
      setColor: jest.fn()
    });
  });

  it('renders drawing panel', () => {
    render(<WhiteDrawPanel />);
    expect(screen.getByText(/drawing canvas/i)).toBeInTheDocument();
  });

  it('displays current tool information', () => {
    render(<WhiteDrawPanel />);
    // Add specific tool display tests
  });
});

// white-draw-store.test.ts - Store tests
import { renderHook, act } from '@testing-library/react';
import { useWhiteDrawStore } from '@/stores/white-draw-store';

describe('useWhiteDrawStore', () => {
  it('initializes with default values', () => {
    const { result } = renderHook(() => useWhiteDrawStore());

    expect(result.current.isDrawing).toBe(false);
    expect(result.current.currentTool.id).toBe('brush');
    expect(result.current.brushSize).toBe(10);
    expect(result.current.color).toBe('#000000');
  });

  it('updates drawing state', () => {
    const { result } = renderHook(() => useWhiteDrawStore());

    act(() => {
      result.current.setDrawing(true);
    });

    expect(result.current.isDrawing).toBe(true);
  });

  it('manages undo/redo history', () => {
    const { result } = renderHook(() => useWhiteDrawStore());

    act(() => {
      result.current.saveToHistory('test-state-1');
      result.current.saveToHistory('test-state-2');
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.historyIndex).toBe(1);

    act(() => {
      result.current.undo();
    });

    expect(result.current.historyIndex).toBe(0);
  });
});
```

#### **Task 6.2: Integration Safety Check** ⏱️ *6 minutes*
**Files to Test:**
- Run existing E2E tests to ensure no regressions
- Test timeline functionality with new drawing elements
- Verify panel switching doesn't break existing features

**Testing Commands:**
```bash
# Run all tests to ensure no regressions
bun run test

# Run E2E tests
bun x playwright test --project=electron

# Specific white-draw panel tests
bun run test white-draw

# Integration tests
bun run test timeline
```

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