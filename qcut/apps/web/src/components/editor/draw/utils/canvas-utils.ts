import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

/**
 * Convert canvas data URL to File object
 * Matches QCut's file handling patterns
 */
export const dataUrlToFile = async (
  dataUrl: string,
  filename: string
): Promise<File> => {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type });
  } catch (error) {
    handleError(error, {
      operation: "canvas data URL to file conversion",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.MEDIUM,
    });
    throw error;
  }
};

/**
 * Download drawing as image file
 * Uses QCut's download pattern
 */
export const downloadDrawing = (dataUrl: string, filename: string): void => {
  try {
    console.log("📦 downloadDrawing called with:", {
      filename,
      dataUrlLength: dataUrl.length,
      dataUrlPrefix: dataUrl.substring(0, 50) + "...",
      isDataUrl: dataUrl.startsWith("data:"),
      isBlobUrl: dataUrl.startsWith("blob:"),
    });

    console.log("🔗 Creating download link element...");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.style.display = "none";

    console.log("✅ Link element created:", {
      href: link.href.substring(0, 50) + "...",
      download: link.download,
      display: link.style.display,
    });

    console.log("📎 Appending link to document body...");
    document.body.appendChild(link);

    console.log("🖱️ Triggering link click...");
    link.click();

    console.log("🗑️ Removing link from document body...");
    document.body.removeChild(link);

    // Clean up object URL if it was created
    if (dataUrl.startsWith("blob:")) {
      console.log("🧹 Cleaning up blob URL...");
      URL.revokeObjectURL(dataUrl);
    }

    console.log("✅ downloadDrawing completed successfully");
  } catch (error) {
    console.error("❌ downloadDrawing failed:", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      filename,
      dataUrlLength: dataUrl.length,
    });

    handleError(error, {
      operation: "drawing download",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.MEDIUM,
    });
    throw error; // Re-throw to let caller handle
  }
};

/**
 * Resize canvas content to new dimensions
 * Maintains aspect ratio and quality
 */
export const resizeCanvas = (
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  maintainAspectRatio = true
): string => {
  try {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");

    if (!tempCtx) {
      throw new Error("Failed to get canvas context");
    }

    let targetWidth = width;
    let targetHeight = height;

    if (maintainAspectRatio) {
      const sourceRatio = sourceCanvas.width / sourceCanvas.height;
      const targetRatio = width / height;

      if (sourceRatio > targetRatio) {
        targetHeight = width / sourceRatio;
      } else {
        targetWidth = height * sourceRatio;
      }
    }

    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;

    // Use high-quality scaling
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = "high";

    tempCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

    return tempCanvas.toDataURL("image/png");
  } catch (error) {
    handleError(error, {
      operation: "canvas resize",
      category: ErrorCategory.UI,
      severity: ErrorSeverity.MEDIUM,
    });
    throw error;
  }
};

/**
 * Clear canvas while preserving context settings and white background
 */
export const clearCanvas = (canvas: HTMLCanvasElement): void => {
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Set white background
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } catch (error) {
    handleError(error, {
      operation: "canvas clear",
      category: ErrorCategory.UI,
      severity: ErrorSeverity.LOW,
    });
  }
};

/**
 * Get canvas as blob for efficient processing
 */
export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.92
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        },
        type,
        quality
      );
    } catch (error) {
      handleError(error, {
        operation: "canvas to blob conversion",
        category: ErrorCategory.UI,
        severity: ErrorSeverity.MEDIUM,
      });
      reject(error);
    }
  });
};
