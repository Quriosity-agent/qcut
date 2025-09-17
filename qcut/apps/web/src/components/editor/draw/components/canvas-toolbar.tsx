import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  Upload,
  RotateCcw,
  Trash2,
  Save,
  Film,
  FolderOpen,
} from "lucide-react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { useProjectStore } from "@/stores/project-store";
import { TimelineIntegration } from "../utils/timeline-integration";
import { DrawingStorage } from "../utils/drawing-storage";
import { downloadDrawing, clearCanvas } from "../utils/canvas-utils";
import { GroupControls } from "./group-controls";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DrawingCanvasHandle } from "../canvas/drawing-canvas";

// Debug logging function that only logs in development mode when enabled
const debug = (...args: unknown[]) => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_TOOLBAR === "1") {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

interface CanvasToolbarProps {
  canvasRef: React.RefObject<DrawingCanvasHandle>;
  className?: string;
  onImageUpload?: (imageFile: File) => void;
  selectedCount?: number;
  hasGroups?: boolean;
  onCreateGroup?: () => void;
  onUngroup?: () => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  canvasRef,
  className,
  onImageUpload,
  selectedCount = 0,
  hasGroups = false,
  onCreateGroup,
  onUngroup,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { undo, redo, clear, history, historyIndex, setActiveTab } =
    useWhiteDrawStore();
  const { activeProject } = useProjectStore();

  // Helper function to get canvas data URL using the typed DrawingCanvasHandle
  const getCanvasDataUrl = (): string | null => {
    if (!canvasRef.current) {
      debug("❌ Canvas ref is null or undefined");
      return null;
    }

    // Use the properly typed getCanvasDataUrl method
    return canvasRef.current.getCanvasDataUrl();
  };

  const handleDownload = async () => {
    debug("🎯 Download button clicked - starting download process");

    try {
      const dataUrl = getCanvasDataUrl();

      if (!dataUrl) {
        debug("❌ Could not generate canvas data URL");
        toast.error("Failed to generate image data");
        return;
      }

      const filename = `drawing-${Date.now()}.png`;
      debug("📱 Data URL generated:", {
        filename,
        dataUrlLength: dataUrl.length,
        isValidDataUrl: dataUrl.startsWith("data:image/png;base64,"),
      });

      await downloadDrawing(dataUrl, filename);
      debug("✅ Download completed successfully");
      toast.success("Drawing downloaded successfully");
    } catch (error) {
      debug("❌ Download failed:", error);
      toast.error("Failed to download drawing");
    }
  };

  const handleExportToTimeline = async () => {
    if (!TimelineIntegration.isAvailable()) {
      toast.error("Timeline integration not available");
      return;
    }

    setIsExporting(true);
    try {
      const dataUrl = getCanvasDataUrl();

      if (!dataUrl) {
        toast.error("Failed to generate image data");
        return;
      }

      await TimelineIntegration.quickExport(dataUrl);
    } catch (error) {
      toast.error("Failed to export to timeline");
    } finally {
      setIsExporting(false);
    }
  };

  const handleQuickSave = async () => {
    if (!activeProject?.id) {
      toast.error("No active project");
      return;
    }

    setIsSaving(true);
    try {
      const dataUrl = getCanvasDataUrl();

      if (!dataUrl) {
        toast.error("Failed to generate image data");
        return;
      }

      const filename = `quick-save-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.png`;

      await DrawingStorage.saveDrawing(dataUrl, activeProject.id, filename, [
        "quick-save",
      ]);
      toast.success("Drawing saved!");
    } catch (error) {
      toast.error("Failed to save drawing");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearCanvas = () => {
    if (!canvasRef.current) {
      toast.error("Canvas not available");
      return;
    }

    // Use the properly typed clearAll method from DrawingCanvasHandle
    canvasRef.current.clearAll();
    clear(); // Update store
    toast.success("Canvas cleared");
  };

  const handleImageUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && onImageUpload) {
        onImageUpload(file);
        toast.success("Image uploaded to canvas");
      }
    };
    input.click();
  };

  const canUndo = history.length > 0 && historyIndex > 0;
  const canRedo = history.length > 0 && historyIndex < history.length - 1;

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 bg-gray-800 rounded-lg",
        className
      )}
    >
      {/* History Controls */}
      <div className="flex items-center gap-1 border-r border-gray-600 pr-2">
        <Button
          variant="text"
          size="sm"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="h-8 w-8 p-0"
        >
          <RotateCcw size={14} />
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className="h-8 w-8 p-0"
        >
          <RotateCcw size={14} className="scale-x-[-1]" />
        </Button>
      </div>

      {/* Canvas Actions */}
      <div className="flex items-center gap-1 border-r border-gray-600 pr-2">
        <Button
          variant="text"
          size="sm"
          onClick={handleImageUpload}
          title="Upload Image"
          className="h-8 w-8 p-0"
        >
          <Upload size={14} />
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={handleClearCanvas}
          title="Clear Canvas"
          className="h-8 w-8 p-0"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Group Controls - Only show if we have selection functionality */}
      {(onCreateGroup || onUngroup) && (
        <div className="flex items-center border-r border-gray-600 pr-2">
          <GroupControls
            selectedCount={selectedCount}
            hasGroups={hasGroups}
            onCreateGroup={onCreateGroup || (() => {})}
            onUngroup={onUngroup || (() => {})}
          />
        </div>
      )}

      {/* Export Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="text"
          size="sm"
          onClick={handleQuickSave}
          disabled={isSaving || !activeProject}
          title="Quick Save"
          className="h-8 w-8 p-0"
        >
          {isSaving ? (
            <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={handleDownload}
          title="Download as PNG"
          className="h-8 w-8 p-0"
        >
          <Download size={14} />
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={handleExportToTimeline}
          disabled={isExporting}
          title="Export to Timeline"
          className="h-8 w-8 p-0"
        >
          {isExporting ? (
            <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Film size={14} />
          )}
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={() => setActiveTab("files")}
          title="Open Files Tab"
          className="h-8 w-8 p-0"
        >
          <FolderOpen size={14} />
        </Button>
      </div>

      {/* Status Indicator */}
      <div className="ml-auto text-xs text-gray-400">
        {TimelineIntegration.isAvailable() ? (
          <span className="text-green-400">Timeline Ready</span>
        ) : (
          <span className="text-red-400">Timeline Unavailable</span>
        )}
      </div>
    </div>
  );
};

export default CanvasToolbar;
