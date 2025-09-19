/**
 * Utility functions for canvas scroll management
 */

export const clampScroll = (
  scroll: number,
  min: number,
  max: number
): number => {
  return Math.max(min, Math.min(max, scroll));
};

export const calculateScrollRatio = (
  viewportSize: number,
  canvasSize: number
): number => {
  return Math.min(1, viewportSize / canvasSize);
};

export const scrollPositionToPixels = (
  scrollRatio: number,
  canvasSize: number,
  viewportSize: number
): number => {
  return scrollRatio * (canvasSize - viewportSize);
};

export const pixelsToScrollRatio = (
  pixels: number,
  canvasSize: number,
  viewportSize: number
): number => {
  const maxScroll = canvasSize - viewportSize;
  return maxScroll > 0 ? pixels / maxScroll : 0;
};

export const getScrollThumbSize = (
  viewportSize: number,
  canvasSize: number,
  scrollbarSize: number
): number => {
  const ratio = calculateScrollRatio(viewportSize, canvasSize);
  return Math.max(20, scrollbarSize * ratio); // Minimum 20px thumb size
};

export const getScrollThumbPosition = (
  scrollPosition: number,
  canvasSize: number,
  viewportSize: number,
  scrollbarSize: number,
  thumbSize: number
): number => {
  const maxScroll = canvasSize - viewportSize;
  if (maxScroll <= 0) return 0;

  const scrollRatio = scrollPosition / maxScroll;
  const maxThumbPosition = scrollbarSize - thumbSize;
  return scrollRatio * maxThumbPosition;
};