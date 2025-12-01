"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  useSegmentationStore,
  OBJECT_COLORS,
} from "@/stores/segmentation-store";
import type { Sam3PointPrompt, Sam3BoxPrompt } from "@/types/sam3";
import { useBlobImage } from "@/hooks/use-blob-image";

/**
 * SegmentationCanvas
 *
 * Interactive canvas for displaying image and handling click/drag interactions.
 * Renders mask overlays and point/box prompts.
 */
export function SegmentationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentBox, setCurrentBox] = useState<Sam3BoxPrompt | null>(null);

  const {
    sourceImageUrl,
    promptMode,
    currentPointPrompts,
    currentBoxPrompts,
    addPointPrompt,
    addBoxPrompt,
    objects,
    compositeImageUrl,
    maskOpacity,
    showBoundingBoxes,
    setImageDimensions,
    imageWidth,
    imageHeight,
  } = useSegmentationStore();

  // Convert FAL URLs to blob URLs to bypass COEP restrictions
  const { blobUrl: compositeBlobUrl } = useBlobImage(compositeImageUrl ?? undefined);

  // Load and display image
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !sourceImageUrl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Calculate fit dimensions
      const containerRect = container.getBoundingClientRect();
      const scale = Math.min(
        containerRect.width / img.width,
        containerRect.height / img.height
      );

      const displayWidth = img.width * scale;
      const displayHeight = img.height * scale;

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      setImageDimensions(img.width, img.height);

      // If we have a composite image from SAM-3, show it based on maskOpacity
      // compositeBlobUrl contains the full segmentation visualization from SAM-3 API
      // (original image with colored mask overlays already applied)
      if (compositeBlobUrl) {
        const compositeImg = new Image();
        compositeImg.onload = () => {
          // SAM-3 returns a composite image with masks already overlaid
          // maskOpacity controls how much of the composite vs original we show:
          // - At opacity 1.0: Show full composite (colored masks visible)
          // - At opacity 0.0: Show original only
          // - In between: Blend the two images

          if (maskOpacity >= 1.0) {
            // Full composite
            ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);
          } else if (maskOpacity <= 0.0) {
            // Original only
            ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
          } else {
            // Blend: draw composite first, then original on top with inverse opacity
            ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);
            ctx.globalAlpha = 1 - maskOpacity;
            ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
            ctx.globalAlpha = 1.0;
          }

          // Draw point prompts
          drawPointPrompts(ctx, currentPointPrompts, scale);

          // Draw box prompts
          drawBoxPrompts(ctx, currentBoxPrompts, scale);

          // Draw bounding boxes if enabled
          if (showBoundingBoxes) {
            drawBoundingBoxes(ctx, objects, displayWidth, displayHeight);
          }
        };
        compositeImg.src = compositeBlobUrl;
      } else {
        // No composite yet - just draw original image with prompts
        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
        drawPointPrompts(ctx, currentPointPrompts, scale);
        drawBoxPrompts(ctx, currentBoxPrompts, scale);
      }
    };

    img.src = sourceImageUrl;
  }, [
    sourceImageUrl,
    compositeBlobUrl,
    currentPointPrompts,
    currentBoxPrompts,
    objects,
    maskOpacity,
    showBoundingBoxes,
    setImageDimensions,
  ]);

  const drawPointPrompts = (
    ctx: CanvasRenderingContext2D,
    points: Sam3PointPrompt[],
    scale: number
  ) => {
    points.forEach((point) => {
      const x = point.x * scale;
      const y = point.y * scale;
      const color = point.label === 1 ? "#00FF00" : "#FF0000";

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw + or - symbol
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(point.label === 1 ? "+" : "-", x, y);
    });
  };

  const drawBoxPrompts = (
    ctx: CanvasRenderingContext2D,
    boxes: Sam3BoxPrompt[],
    scale: number
  ) => {
    boxes.forEach((box) => {
      const x = box.x_min * scale;
      const y = box.y_min * scale;
      const width = (box.x_max - box.x_min) * scale;
      const height = (box.y_max - box.y_min) * scale;

      ctx.strokeStyle = "#00CED1";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    });
  };

  const drawBoundingBoxes = (
    ctx: CanvasRenderingContext2D,
    objs: typeof objects,
    width: number,
    height: number
  ) => {
    objs.forEach((obj) => {
      if (!obj.boundingBox) return;

      const [cx, cy, w, h] = obj.boundingBox;
      const color = OBJECT_COLORS[obj.colorIndex];

      const x = (cx - w / 2) * width;
      const y = (cy - h / 2) * height;
      const boxWidth = w * width;
      const boxHeight = h * height;

      ctx.strokeStyle = color.hex;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, boxWidth, boxHeight);
    });
  };

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !imageWidth || !imageHeight) return null;

      const rect = canvas.getBoundingClientRect();
      const scaleX = imageWidth / canvas.width;
      const scaleY = imageHeight / canvas.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      return { x: Math.round(x), y: Math.round(y) };
    },
    [imageWidth, imageHeight]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (promptMode !== "point") return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      // Left click = foreground (1), Right click = background (0)
      const label = e.button === 2 ? 0 : 1;

      addPointPrompt({
        x: coords.x,
        y: coords.y,
        label: label as 0 | 1,
      });
    },
    [promptMode, getCanvasCoordinates, addPointPrompt]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (promptMode === "point") {
        handleCanvasClick(e);
        return;
      }

      if (promptMode !== "box") return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      setIsDrawingBox(true);
      setBoxStart(coords);
    },
    [promptMode, getCanvasCoordinates, handleCanvasClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingBox || !boxStart) return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      setCurrentBox({
        x_min: Math.min(boxStart.x, coords.x),
        y_min: Math.min(boxStart.y, coords.y),
        x_max: Math.max(boxStart.x, coords.x),
        y_max: Math.max(boxStart.y, coords.y),
      });
    },
    [isDrawingBox, boxStart, getCanvasCoordinates]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawingBox || !currentBox) return;

    // Only add box if it has some size
    const width = currentBox.x_max - currentBox.x_min;
    const height = currentBox.y_max - currentBox.y_min;

    if (width > 10 && height > 10) {
      addBoxPrompt(currentBox);
    }

    setIsDrawingBox(false);
    setBoxStart(null);
    setCurrentBox(null);
  }, [isDrawingBox, currentBox, addBoxPrompt]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (promptMode === "point") {
        handleCanvasClick(e);
      }
    },
    [promptMode, handleCanvasClick]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
