import React from "react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { PenTool } from "lucide-react";
import { DrawingCanvas } from "@/components/editor/draw/canvas/drawing-canvas";

const DrawView: React.FC = () => {
  const { activeTab, setActiveTab } = useWhiteDrawStore();

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
      </div>

      {/* Content Area - Phase 2 implementation */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "canvas" && (
          <div className="w-full h-full flex items-center justify-center">
            <DrawingCanvas
              className="max-w-full max-h-full"
              onDrawingChange={(dataUrl) => {
                console.log("Drawing updated:", dataUrl.slice(0, 50) + "...");
              }}
            />
          </div>
        )}
        {activeTab === "tools" && (
          <div className="text-gray-400">Tool Selector (Phase 3)</div>
        )}
      </div>
    </div>
  );
};

export default DrawView;