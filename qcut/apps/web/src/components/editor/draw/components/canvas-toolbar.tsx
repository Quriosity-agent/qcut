import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  Upload,
  RotateCcw,
  Trash2,
  Save,
  Film,
  FolderOpen
} from "lucide-react";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { useProjectStore } from "@/stores/project-store";
import { TimelineIntegration } from "../utils/timeline-integration";
import { DrawingStorage } from "../utils/drawing-storage";
import { downloadDrawing, clearCanvas } from "../utils/canvas-utils";
import { GroupControls } from "./group-controls";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CanvasToolbarProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
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
  onUngroup
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { undo, redo, clear, history, historyIndex, setActiveTab } = useWhiteDrawStore();
  const { activeProject } = useProjectStore();

  const handleDownload = async () => {
    console.log('🎯 Download button clicked - starting download process');

    if (!canvasRef.current) {
      console.error('❌ Canvas ref is null or undefined:', canvasRef.current);
      toast.error("Canvas not available");
      return;
    }

    try {
      // The canvasRef might be pointing to the DrawingCanvas component, not the HTMLCanvasElement
      let canvas: HTMLCanvasElement | null = null;

      console.log('🔍 Checking canvas ref type:', {
        refCurrent: canvasRef.current,
        isHTMLCanvasElement: canvasRef.current instanceof HTMLCanvasElement,
        hasToDataURL: typeof (canvasRef.current as any)?.toDataURL === 'function',
        tagName: (canvasRef.current as any)?.tagName
      });

      if (canvasRef.current instanceof HTMLCanvasElement) {
        // Direct canvas element
        canvas = canvasRef.current;
        console.log('✅ Found direct canvas element');
      } else if ((canvasRef.current as any)?.tagName === 'CANVAS') {
        // Canvas element with different typing
        canvas = canvasRef.current as HTMLCanvasElement;
        console.log('✅ Found canvas with CANVAS tagName');
      } else {
        // Might be a component ref, try to find the canvas inside it
        console.log('🔍 Searching for canvas element in component...');

        // Try common canvas selectors
        const canvasElement = document.querySelector('.drawing-canvas canvas') ||
                             document.querySelector('canvas[role="img"]') ||
                             document.querySelector('canvas[aria-label="Drawing canvas"]');

        if (canvasElement instanceof HTMLCanvasElement) {
          canvas = canvasElement;
          console.log('✅ Found canvas via querySelector:', {
            selector: canvasElement.getAttribute('aria-label') || canvasElement.className,
            width: canvas.width,
            height: canvas.height
          });
        }
      }

      if (!canvas) {
        console.error('❌ Could not find canvas element');
        toast.error("Canvas element not found");
        return;
      }

      console.log('✅ Canvas found:', {
        width: canvas.width,
        height: canvas.height,
        tagName: canvas.tagName,
        isConnected: canvas.isConnected,
        hasContext: !!canvas.getContext('2d')
      });

      console.log('🖼️ Generating canvas data URL...');
      const dataUrl = canvas.toDataURL('image/png');

      const filename = `drawing-${Date.now()}.png`;
      console.log('📱 Data URL generated:', {
        filename,
        dataUrlLength: dataUrl.length,
        dataUrlPrefix: dataUrl.substring(0, 50) + '...',
        isValidDataUrl: dataUrl.startsWith('data:image/png;base64,')
      });

      console.log('💾 Calling downloadDrawing function...');
      await downloadDrawing(dataUrl, filename);

      console.log('✅ Download completed successfully');
      toast.success("Drawing downloaded successfully");
    } catch (error) {
      console.error('❌ Download failed with error:', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      toast.error("Failed to download drawing");
    }
  };

  const handleExportToTimeline = async () => {
    if (!canvasRef.current) {
      toast.error("Canvas not available");
      return;
    }

    if (!TimelineIntegration.isAvailable()) {
      toast.error("Timeline integration not available");
      return;
    }

    setIsExporting(true);
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL('image/png');
      await TimelineIntegration.quickExport(dataUrl);
    } catch (error) {
      toast.error("Failed to export to timeline");
    } finally {
      setIsExporting(false);
    }
  };

  const handleQuickSave = async () => {
    if (!canvasRef.current) {
      toast.error("Canvas not available");
      return;
    }

    if (!activeProject?.id) {
      toast.error("No active project");
      return;
    }

    setIsSaving(true);
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL('image/png');
      const filename = `quick-save-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.png`;

      await DrawingStorage.saveDrawing(dataUrl, activeProject.id, filename, ["quick-save"]);
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

    clearCanvas(canvasRef.current);
    clear(); // Update store
    toast.success("Canvas cleared");
  };

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
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
    <div className={cn("flex items-center gap-2 p-2 bg-gray-800 rounded-lg", className)}>
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