import React, { useCallback, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  getScrollThumbSize,
  getScrollThumbPosition,
  clampScroll,
} from "../utils/scroll-utils";

interface CanvasScrollbarsProps {
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  onScrollXChange: (x: number) => void;
  onScrollYChange: (y: number) => void;
  className?: string;
}

export const CanvasScrollbars: React.FC<CanvasScrollbarsProps> = ({
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  scrollX,
  scrollY,
  onScrollXChange,
  onScrollYChange,
  className,
}) => {
  const verticalTrackRef = useRef<HTMLDivElement>(null);
  const horizontalTrackRef = useRef<HTMLDivElement>(null);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const SCROLLBAR_SIZE = 16;

  // Show scrollbars only when needed
  const showVerticalScrollbar = canvasHeight > viewportHeight;
  const showHorizontalScrollbar = canvasWidth > viewportWidth;

  // Calculate thumb sizes and positions
  const verticalThumbSize = getScrollThumbSize(
    viewportHeight,
    canvasHeight,
    SCROLLBAR_SIZE
  );
  const horizontalThumbSize = getScrollThumbSize(
    viewportWidth,
    canvasWidth,
    SCROLLBAR_SIZE
  );

  const verticalThumbPosition = getScrollThumbPosition(
    scrollY,
    canvasHeight,
    viewportHeight,
    viewportHeight,
    verticalThumbSize
  );

  const horizontalThumbPosition = getScrollThumbPosition(
    scrollX,
    canvasWidth,
    viewportWidth,
    viewportWidth,
    horizontalThumbSize
  );

  // Vertical scrollbar drag handlers
  const handleVerticalMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const track = verticalTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const thumbTop = verticalThumbPosition;

      // Check if click is on thumb
      if (clickY >= thumbTop && clickY <= thumbTop + verticalThumbSize) {
        setIsDraggingVertical(true);
        setDragOffset({ x: 0, y: clickY - thumbTop });
      } else {
        // Click on track - jump to position
        const maxScroll = canvasHeight - viewportHeight;
        const trackHeight = viewportHeight;
        const clickRatio = clickY / trackHeight;
        const newScrollY = clampScroll(clickRatio * maxScroll, 0, maxScroll);
        onScrollYChange(newScrollY);
      }
    },
    [
      canvasHeight,
      viewportHeight,
      verticalThumbPosition,
      verticalThumbSize,
      onScrollYChange,
    ]
  );

  // Horizontal scrollbar drag handlers
  const handleHorizontalMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const track = horizontalTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const thumbLeft = horizontalThumbPosition;

      // Check if click is on thumb
      if (clickX >= thumbLeft && clickX <= thumbLeft + horizontalThumbSize) {
        setIsDraggingHorizontal(true);
        setDragOffset({ x: clickX - thumbLeft, y: 0 });
      } else {
        // Click on track - jump to position
        const maxScroll = canvasWidth - viewportWidth;
        const trackWidth = viewportWidth;
        const clickRatio = clickX / trackWidth;
        const newScrollX = clampScroll(clickRatio * maxScroll, 0, maxScroll);
        onScrollXChange(newScrollX);
      }
    },
    [
      canvasWidth,
      viewportWidth,
      horizontalThumbPosition,
      horizontalThumbSize,
      onScrollXChange,
    ]
  );

  // Global mouse move and up handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingVertical) {
        const track = verticalTrackRef.current;
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const mouseY = e.clientY - rect.top - dragOffset.y;
        const maxThumbPosition = viewportHeight - verticalThumbSize;
        const thumbPosition = clampScroll(mouseY, 0, maxThumbPosition);
        const scrollRatio = thumbPosition / maxThumbPosition;
        const maxScroll = canvasHeight - viewportHeight;
        const newScrollY = scrollRatio * maxScroll;

        onScrollYChange(newScrollY);
      }

      if (isDraggingHorizontal) {
        const track = horizontalTrackRef.current;
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - dragOffset.x;
        const maxThumbPosition = viewportWidth - horizontalThumbSize;
        const thumbPosition = clampScroll(mouseX, 0, maxThumbPosition);
        const scrollRatio = thumbPosition / maxThumbPosition;
        const maxScroll = canvasWidth - viewportWidth;
        const newScrollX = scrollRatio * maxScroll;

        onScrollXChange(newScrollX);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingVertical(false);
      setIsDraggingHorizontal(false);
      setDragOffset({ x: 0, y: 0 });
    };

    if (isDraggingVertical || isDraggingHorizontal) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [
    isDraggingVertical,
    isDraggingHorizontal,
    dragOffset,
    canvasWidth,
    canvasHeight,
    viewportWidth,
    viewportHeight,
    verticalThumbSize,
    horizontalThumbSize,
    onScrollXChange,
    onScrollYChange,
  ]);

  if (!showVerticalScrollbar && !showHorizontalScrollbar) {
    return null;
  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {/* Vertical Scrollbar */}
      {showVerticalScrollbar && (
        <div
          ref={verticalTrackRef}
          className="absolute right-0 top-0 w-4 bg-gray-200 bg-opacity-80 hover:bg-opacity-100 transition-opacity pointer-events-auto"
          style={{ height: viewportHeight }}
          onMouseDown={handleVerticalMouseDown}
        >
          {/* Vertical Thumb */}
          <div
            className={cn(
              "absolute right-0 w-full bg-gray-500 rounded cursor-pointer transition-colors",
              isDraggingVertical
                ? "bg-gray-600"
                : "hover:bg-gray-600"
            )}
            style={{
              height: verticalThumbSize,
              transform: `translateY(${verticalThumbPosition}px)`,
            }}
          />
        </div>
      )}

      {/* Horizontal Scrollbar */}
      {showHorizontalScrollbar && (
        <div
          ref={horizontalTrackRef}
          className="absolute bottom-0 left-0 h-4 bg-gray-200 bg-opacity-80 hover:bg-opacity-100 transition-opacity pointer-events-auto"
          style={{ width: viewportWidth }}
          onMouseDown={handleHorizontalMouseDown}
        >
          {/* Horizontal Thumb */}
          <div
            className={cn(
              "absolute bottom-0 h-full bg-gray-500 rounded cursor-pointer transition-colors",
              isDraggingHorizontal
                ? "bg-gray-600"
                : "hover:bg-gray-600"
            )}
            style={{
              width: horizontalThumbSize,
              transform: `translateX(${horizontalThumbPosition}px)`,
            }}
          />
        </div>
      )}

      {/* Corner piece when both scrollbars are visible */}
      {showVerticalScrollbar && showHorizontalScrollbar && (
        <div className="absolute bottom-0 right-0 w-4 h-4 bg-gray-300" />
      )}
    </div>
  );
};