import React, { useRef, useState, useCallback } from "react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { PenTool } from "lucide-react";
import { DrawingCanvas } from "@/components/editor/draw/canvas/drawing-canvas";
import { ToolSelector } from "@/components/editor/draw/components/tool-selector";
import { CanvasToolbar } from "@/components/editor/draw/components/canvas-toolbar";
import { SavedDrawings } from "@/components/editor/draw/components/saved-drawings";

const DrawView: React.FC = () => {
  const { activeTab, setActiveTab } = useWhiteDrawStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentDrawingData, setCurrentDrawingData] = useState<string>("");

  // Handle loading a drawing from saved files
  const handleLoadDrawing = useCallback((drawingData: string) => {
    // This would need to be implemented to load the drawing into the canvas
    // For now, we'll just store it and potentially trigger a canvas update
    setCurrentDrawingData(drawingData);
    setActiveTab("canvas"); // Switch to canvas tab when loading
  }, [setActiveTab]);

  // Handle drawing changes from canvas
  const handleDrawingChange = useCallback((dataUrl: string) => {
    setCurrentDrawingData(dataUrl);
  }, []);

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Header - matches nano-edit pattern */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          <PenTool className="inline w-6 h-6 mr-2" />
          White Draw
        </h2>
        <p className="text-gray-400">Canvas drawing and annotation tools</p>
      </div>

      {/* Tab Navigation - matches nano-edit structure */}
      <div className="flex space-x-1 mb-6 bg-gray-800 p-1 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("canvas")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "canvas"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          🎨 Canvas
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tools")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "tools"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          🛠️ Tools
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("files")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "files"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          📁 Files
        </button>
      </div>

      {/* Content Area - Phase 2 implementation */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "canvas" && (
          <div className="w-full h-full flex flex-col space-y-4">
            <CanvasToolbar canvasRef={canvasRef} />
            <div className="flex-1 flex items-center justify-center">
              <DrawingCanvas
                ref={canvasRef}
                className="max-w-full max-h-full"
                onDrawingChange={handleDrawingChange}
              />
            </div>
          </div>
        )}
        {activeTab === "tools" && (
          <ToolSelector className="h-full" />
        )}
        {activeTab === "files" && (
          <SavedDrawings
            currentDrawingData={currentDrawingData}
            onLoadDrawing={handleLoadDrawing}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
};

export default DrawView;