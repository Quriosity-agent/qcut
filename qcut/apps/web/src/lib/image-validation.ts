/**
 * Image validation utilities for AI models
 * Generic helpers that can be reused across different image upload features
 */

export interface ImageValidationConstraints {
  maxSizeMB: number;
  minDimensions: { width: number; height: number };
  maxDimensions: { width: number; height: number };
  allowedFormats: string[];
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  dimensions?: { width: number; height: number };
  fileSize?: number;
}

/**
 * Validate an image file against specified constraints
 *
 * @param file - The image file to validate
 * @param constraints - Validation constraints (size, dimensions, formats)
 * @returns Validation result with error message if invalid
 */
export async function validateImageUpload(
  file: File,
  constraints: ImageValidationConstraints
): Promise<ImageValidationResult> {
  // Validate file type
  if (!constraints.allowedFormats.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed formats: ${constraints.allowedFormats.join(", ")}`,
    };
  }

  // Validate file size
  const maxSizeBytes = constraints.maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${constraints.maxSizeMB}MB`,
      fileSize: file.size,
    };
  }

  // Validate dimensions
  try {
    const dimensions = await getImageDimensions(file);

    if (
      dimensions.width < constraints.minDimensions.width ||
      dimensions.height < constraints.minDimensions.height
    ) {
      return {
        valid: false,
        error: `Image dimensions (${dimensions.width}×${dimensions.height}) are below minimum (${constraints.minDimensions.width}×${constraints.minDimensions.height})`,
        dimensions,
      };
    }

    if (
      dimensions.width > constraints.maxDimensions.width ||
      dimensions.height > constraints.maxDimensions.height
    ) {
      return {
        valid: false,
        error: `Image dimensions (${dimensions.width}×${dimensions.height}) exceed maximum (${constraints.maxDimensions.width}×${constraints.maxDimensions.height})`,
        dimensions,
      };
    }

    return {
      valid: true,
      dimensions,
      fileSize: file.size,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read image dimensions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get image dimensions from a File object
 *
 * @param file - Image file
 * @returns Promise resolving to width and height
 */
export function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Validate Reve Edit image specifically
 * Applies Reve Edit constraints (10MB, 128-4096px, PNG/JPEG/WebP/AVIF/HEIF)
 */
export async function validateReveEditImage(
  file: File
): Promise<ImageValidationResult> {
  return validateImageUpload(file, {
    maxSizeMB: 10,
    minDimensions: { width: 128, height: 128 },
    maxDimensions: { width: 4096, height: 4096 },
    allowedFormats: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/heif",
    ],
  });
}
