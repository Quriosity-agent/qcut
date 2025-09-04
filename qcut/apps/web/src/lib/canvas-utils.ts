import html2canvas from "html2canvas";

export interface CaptureOptions {
  width: number;
  height: number;
  backgroundColor?: string;
}

/**
 * Capture a DOM element to canvas and return as ImageData
 * This is used for frame caching in the timeline
 */
export async function captureFrameToCanvas(
  element: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  try {
    // Prefer OffscreenCanvas if available for performance
    if (typeof OffscreenCanvas !== "undefined") {
      if (
        !offscreenCanvas ||
        offscreenCanvas.width !== options.width ||
        offscreenCanvas.height !== options.height
      ) {
        offscreenCanvas = new OffscreenCanvas(options.width, options.height);
        offscreenContext = offscreenCanvas.getContext("2d");
      }

      if (offscreenContext) {
        const canvas = await html2canvas(element, {
          canvas: offscreenCanvas as any,
          width: options.width,
          height: options.height,
          backgroundColor:
            options.backgroundColor === 'transparent' ? null : (options.backgroundColor || '#000000'),
          scale: 1,
          logging: false,
          useCORS: true,
          allowTaint: false,
          foreignObjectRendering: true,
        });

        return offscreenContext.getImageData(
          0,
          0,
          options.width,
          options.height
        );
      }
    }

    const canvas = await html2canvas(element, {
      width: options.width,
      height: options.height,
      backgroundColor:
        options.backgroundColor === 'transparent' ? null : (options.backgroundColor || '#000000'),
      scale: 1,
      logging: false,
      useCORS: true,
      // Preserve video frames and dynamic content
      allowTaint: false,
      foreignObjectRendering: true,
      // Important: preserve existing transforms and styles
      onclone: (clonedDoc) => {
        // Preserve any dynamic styles
        const clonedElement = element.id ? clonedDoc.getElementById(element.id) : null;
        if (clonedElement && element.style) {
          clonedElement.style.cssText = element.style.cssText;
        }
      },
    });

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    return ctx.getImageData(0, 0, options.width, options.height);
  } catch (error) {
    console.error("Failed to capture frame:", error);
    return null;
  }
}

/**
 * Create an offscreen canvas for better performance
 */
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenContext: OffscreenCanvasRenderingContext2D | null = null;

export async function captureFrameToOffscreenCanvas(
  element: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  try {
    // Use offscreen canvas if available
    if (typeof OffscreenCanvas !== "undefined") {
      if (
        !offscreenCanvas ||
        offscreenCanvas.width !== options.width ||
        offscreenCanvas.height !== options.height
      ) {
        offscreenCanvas = new OffscreenCanvas(options.width, options.height);
        offscreenContext = offscreenCanvas.getContext("2d");
      }

      if (offscreenContext) {
        // First capture to regular canvas with html2canvas
        const regularCanvas = await html2canvas(element, {
          width: options.width,
          height: options.height,
          backgroundColor:
            options.backgroundColor === 'transparent' ? null : (options.backgroundColor || '#000000'),
          scale: 1,
          logging: false,
          useCORS: true,
          allowTaint: false,
        });

        // Draw to offscreen canvas
        offscreenContext.drawImage(regularCanvas, 0, 0);

        return offscreenContext.getImageData(
          0,
          0,
          options.width,
          options.height
        );
      }
    }

    // Fallback to regular canvas
    return captureFrameToCanvas(element, options);
  } catch (error) {
    console.error("Offscreen capture failed, falling back:", error);
    return captureFrameToCanvas(element, options);
  }
}

/**
 * Helper to capture with fallback
 */
export async function captureWithFallback(
  element: HTMLElement,
  options: CaptureOptions
): Promise<ImageData | null> {
  // Try offscreen first for better performance
  const result = await captureFrameToOffscreenCanvas(element, options);
  if (result) return result;

  // Fallback to regular capture
  return captureFrameToCanvas(element, options);
}
