/**
 * AI Image Upload Section Component
 * Handles both single-image (I2V) and dual-frame (F2V) upload modes
 */

import { FileUpload } from "@/components/ui/file-upload";
import { MODEL_HELPERS, UPLOAD_CONSTANTS } from "./ai-constants";

export interface AIImageUploadSectionProps {
  /** Array of selected model IDs to determine upload mode */
  selectedModels: string[];
  /** First frame file (required for F2V, used for single I2V) */
  firstFrame: File | null;
  /** First frame preview URL */
  firstFramePreview?: string | null;
  /** Last frame file (optional for F2V) */
  lastFrame: File | null;
  /** Last frame preview URL */
  lastFramePreview?: string | null;
  /** Callback when first frame changes */
  onFirstFrameChange: (file: File | null, preview?: string | null) => void;
  /** Callback when last frame changes */
  onLastFrameChange: (file: File | null, preview?: string | null) => void;
  /** Callback when validation error occurs */
  onError: (error: string) => void;
  /** Whether to show in compact mode */
  isCompact?: boolean;
}

export function AIImageUploadSection({
  selectedModels,
  firstFrame,
  firstFramePreview,
  lastFrame,
  lastFramePreview,
  onFirstFrameChange,
  onLastFrameChange,
  onError,
  isCompact = false,
}: AIImageUploadSectionProps) {
  // Check if any selected model requires F2V mode
  const requiresFrameToFrame = selectedModels.some((id) =>
    MODEL_HELPERS.requiresFrameToFrame(id)
  );

  if (requiresFrameToFrame) {
    // Dual-frame upload mode for F2V models
    return (
      <div className="space-y-4">
        <FileUpload
          id="ai-first-frame-input"
          label="First Frame"
          helperText="Required"
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
          file={firstFrame}
          preview={firstFramePreview}
          onFileChange={onFirstFrameChange}
          onError={onError}
          isCompact={isCompact}
        />

        <FileUpload
          id="ai-last-frame-input"
          label="Last Frame"
          helperText="Optional"
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
          file={lastFrame}
          preview={lastFramePreview}
          onFileChange={onLastFrameChange}
          onError={onError}
          isCompact={isCompact}
        />
        <p className="text-xs text-muted-foreground">
          Leave last frame empty to use as standard image-to-video
        </p>
      </div>
    );
  }

  // Standard single-image upload mode for I2V models
  return (
    <FileUpload
      id="ai-image-input"
      label={isCompact ? "Image" : "Upload Image for Video Generation"}
      fileType="image"
      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
      maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
      maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
      formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
      file={firstFrame}
      preview={firstFramePreview}
      onFileChange={onFirstFrameChange}
      onError={onError}
      isCompact={isCompact}
    />
  );
}
