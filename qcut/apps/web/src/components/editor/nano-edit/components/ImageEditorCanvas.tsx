import React, { useRef, useEffect, useState, useCallback } from "react";
import { useNanoEditStore } from "@/stores/nano-edit-store";
import { loadImage, downloadImage } from "@/lib/utils/nano-edit-utils";

interface ImageEditorCanvasProps {
  imageUrl?: string;
  onImageProcessed?: (processedUrl: string) => void;
}

export const ImageEditorCanvas: React.FC<ImageEditorCanvasProps> = ({
  imageUrl,
  onImageProcessed,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const { isProcessing } = useNanoEditStore();

  const loadImageToCanvas = useCallback(async (url: string) => {
    if (!canvasRef.current) return;

    setIsLoading(true);
    try {
      const img = await loadImage(url);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        // Set canvas size to match image
        canvas.width = img.width;
        canvas.height = img.height;
        setCanvasSize({ width: img.width, height: img.height });

        // Clear and draw image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      }
    } catch (error) {
      console.error("Error loading image to canvas:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const exportCanvas = useCallback(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL("image/png");

    // Notify parent component
    onImageProcessed?.(dataUrl);

    // Download the image
    downloadImage(dataUrl, "edited-image.png");
  }, [onImageProcessed]);

  const clearCanvas = useCallback(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    if (imageUrl) {
      loadImageToCanvas(imageUrl);
    }
  }, [imageUrl, loadImageToCanvas]);

  return (
    <div className="space-y-4">
      {/* Canvas Controls */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={exportCanvas}
          disabled={isProcessing || isLoading}
          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Export Image
        </button>
        <button
          onClick={clearCanvas}
          disabled={isProcessing || isLoading}
          className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Clear Canvas
        </button>
      </div>

      {/* Canvas Container */}
      <div className="relative border border-gray-700 rounded-lg overflow-hidden bg-gray-900">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="text-white text-sm">Loading image...</div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="max-w-full h-auto block"
          style={{
            maxHeight: "600px",
            objectFit: "contain",
          }}
        />

        {!imageUrl && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <div className="text-center space-y-2">
              <div className="text-4xl">🖼️</div>
              <div className="text-sm">No image loaded</div>
            </div>
          </div>
        )}
      </div>

      {/* Canvas Info */}
      {imageUrl && (
        <div className="text-xs text-gray-400">
          Canvas size: {canvasSize.width} × {canvasSize.height}px
        </div>
      )}
    </div>
  );
};

export default ImageEditorCanvas;
