import React, { useRef, useState, useCallback, useEffect } from "react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { PenTool } from "lucide-react";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
} from "@/components/editor/draw/canvas/drawing-canvas";
import { ToolSelector } from "@/components/editor/draw/components/tool-selector";
import { CanvasToolbar } from "@/components/editor/draw/components/canvas-toolbar";
import { SavedDrawings } from "@/components/editor/draw/components/saved-drawings";

const DrawView: React.FC = () => {
  const { activeTab, setActiveTab } = useWhiteDrawStore();
  const canvasComponentRef = useRef<DrawingCanvasHandle | null>(null);
  const [currentDrawingData, setCurrentDrawingData] = useState<string>("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [hasGroups, setHasGroups] = useState(false);

  // Handle loading a drawing from saved files
  const handleLoadDrawing = useCallback(
    async (drawingData: string) => {
      // Load the drawing into the canvas
      if (canvasComponentRef.current?.loadDrawingFromDataUrl) {
        await canvasComponentRef.current.loadDrawingFromDataUrl(drawingData);
      }
      setCurrentDrawingData(drawingData);
      setActiveTab("canvas"); // Switch to canvas tab when loading
    },
    [setActiveTab]
  );

  // Handle drawing changes from canvas
  const handleDrawingChange = useCallback((dataUrl: string) => {
    setCurrentDrawingData(dataUrl);
  }, []);

  // Handle image upload from toolbar
  const handleImageUpload = useCallback((file: File) => {
    if (canvasComponentRef.current?.handleImageUpload) {
      canvasComponentRef.current.handleImageUpload(file);
    }
  }, []);

  // Handle group creation
  const handleCreateGroup = useCallback(() => {
    if (canvasComponentRef.current?.handleCreateGroup) {
      canvasComponentRef.current.handleCreateGroup();
      // Update state after group creation
      updateGroupState();
    }
  }, [updateGroupState]);

  // Handle group dissolution
  const handleUngroup = useCallback(() => {
    if (canvasComponentRef.current?.handleUngroup) {
      canvasComponentRef.current.handleUngroup();
      // Update state after ungrouping
      updateGroupState();
    }
  }, [updateGroupState]);

  // Update group state from canvas
  const updateGroupState = useCallback(() => {
    if (canvasComponentRef.current) {
      const newSelectedCount =
        canvasComponentRef.current.getSelectedCount?.() || 0;
      const newHasGroups = canvasComponentRef.current.getHasGroups?.() || false;
      setSelectedCount(newSelectedCount);
      setHasGroups(newHasGroups);
    }
  }, []);

  // Update group state when drawing changes
  useEffect(() => {
    if (currentDrawingData) {
      updateGroupState();
    }
  }, [currentDrawingData, updateGroupState]);

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
        {/* Canvas - Always mounted to preserve drawings */}
        <div
          className={`w-full h-full flex flex-col space-y-4 ${activeTab === "canvas" ? "" : "hidden"}`}
        >
          <CanvasToolbar
            canvasRef={canvasComponentRef}
            onImageUpload={handleImageUpload}
            selectedCount={selectedCount}
            hasGroups={hasGroups}
            onCreateGroup={handleCreateGroup}
            onUngroup={handleUngroup}
          />
          <div className="flex-1 flex items-center justify-center">
            <DrawingCanvas
              ref={canvasComponentRef}
              className="max-w-full max-h-full"
              onDrawingChange={handleDrawingChange}
            />
          </div>
        </div>

        {/* Tools Tab */}
        {activeTab === "tools" && <ToolSelector className="h-full" />}

        {/* Files Tab */}
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
