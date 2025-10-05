/**
 * Reusable File Upload Component
 * Supports image, audio, and video file uploads with validation and preview
 */

import { useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "./button";
import { Label } from "./label";

export interface FileUploadConfig {
  /** Unique identifier for the file input */
  id: string;
  /** Display label for the upload field */
  label: string;
  /** Optional helper text (e.g., "Required", "For Kling models") */
  helperText?: string;
  /** File type category for display logic */
  fileType: "image" | "audio" | "video";
  /** Accepted MIME types */
  acceptedTypes: readonly string[];
  /** Maximum file size in bytes */
  maxSizeBytes: number;
  /** Human-readable file size limit (e.g., "10MB") */
  maxSizeLabel: string;
  /** Human-readable accepted formats (e.g., "JPG, PNG, WebP") */
  formatsLabel: string;
  /** Current file */
  file: File | null;
  /** File preview URL (for images) */
  preview?: string | null;
  /** Callback when file changes */
  onFileChange: (file: File | null, preview?: string | null) => void;
  /** Callback when validation error occurs */
  onError: (error: string) => void;
  /** Whether to show in compact mode */
  isCompact?: boolean;
}

export function FileUpload({
  id,
  label,
  helperText,
  fileType,
  acceptedTypes,
  maxSizeBytes,
  maxSizeLabel,
  formatsLabel,
  file,
  preview,
  onFileChange,
  onError,
  isCompact = false,
}: FileUploadConfig) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate MIME type
    if (!acceptedTypes.includes(selectedFile.type)) {
      onError(`Please select a valid ${fileType} file (${formatsLabel})`);
      return;
    }

    // Validate file size
    if (selectedFile.size > maxSizeBytes) {
      onError(
        `${fileType === "image" ? "Image" : fileType === "audio" ? "Audio" : "Video"} file too large (max ${maxSizeLabel})`
      );
      return;
    }

    // For images, create preview
    if (fileType === "image") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const previewUrl = e.target?.result as string;
        onFileChange(selectedFile, previewUrl);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      onFileChange(selectedFile);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileChange(null, null);
    const input = document.getElementById(id) as HTMLInputElement;
    if (input) input.value = "";
  };

  const renderPreview = () => {
    if (!file) return null;

    if (fileType === "image" && preview) {
      return (
        <div className="relative flex flex-col items-center justify-center h-full">
          <img
            src={preview}
            alt={file.name}
            className="max-w-full max-h-32 mx-auto rounded object-contain"
          />
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
          >
            <X className="h-3 w-3" />
          </Button>
          <div className="mt-2 text-xs text-muted-foreground text-center">
            {file.name}
          </div>
        </div>
      );
    }

    // Audio/Video preview with file info
    const emoji = fileType === "audio" ? "🎵" : "🎬";
    return (
      <div className="relative flex flex-col items-center justify-center h-full">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
            <span className="text-xs">{emoji}</span>
          </div>
          <div>
            <div className="text-xs font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={handleRemove}
          className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
      <Upload
        className={`${fileType === "image" ? "size-8" : "size-6"} text-muted-foreground`}
      />
      <div className="text-xs text-muted-foreground">
        Click to upload{" "}
        {fileType === "image"
          ? "character image"
          : fileType === "audio"
            ? "audio file"
            : "source video"}
      </div>
      <div className="text-xs text-muted-foreground/70">
        {formatsLabel} (max {maxSizeLabel})
      </div>
    </div>
  );

  const minHeight = fileType === "image" ? "min-h-[120px]" : "min-h-[80px]";

  return (
    <div className="space-y-2">
      <Label className="text-xs">
        {label} {!isCompact && helperText && `(${helperText})`}
      </Label>
      <label
        htmlFor={id}
        className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors ${minHeight} focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
          file
            ? "border-primary/50 bg-primary/5 p-2"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
        }`}
        aria-label={file ? `Change ${fileType}` : `Click to upload ${fileType}`}
      >
        {file ? renderPreview() : renderEmptyState()}
        <input
          id={id}
          type="file"
          accept={acceptedTypes.join(",")}
          onChange={handleFileChange}
          className="sr-only"
        />
      </label>
    </div>
  );
}
