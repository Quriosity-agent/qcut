/**
 * Reve Settings Panel Component
 *
 * Renders settings panels for Reve AI models including:
 * - Text-to-Image settings (aspect ratio, num images, output format)
 * - Edit Image section (optional image upload + edit instructions)
 *
 * @see ai-tsx-refactoring.md - Subtask 4.3
 */

import { Upload, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

import {
  REVE_TEXT_TO_IMAGE_MODEL,
} from "../constants/ai-constants";
import {
  type ReveAspectRatioOption,
  type ReveOutputFormatOption,
  REVE_NUM_IMAGE_OPTIONS,
} from "../constants/ai-model-options";

// ============================================
// Types
// ============================================

export interface AIReveTextToImageSettingsProps {
  /** Current aspect ratio */
  aspectRatio: ReveAspectRatioOption;
  /** Callback when aspect ratio changes */
  onAspectRatioChange: (value: ReveAspectRatioOption) => void;
  /** Current number of images */
  numImages: number;
  /** Callback when number of images changes */
  onNumImagesChange: (value: number) => void;
  /** Current output format */
  outputFormat: ReveOutputFormatOption;
  /** Callback when output format changes */
  onOutputFormatChange: (value: ReveOutputFormatOption) => void;
}

export interface AIReveEditSettingsProps {
  /** Uploaded image file for editing */
  uploadedImage: File | null;
  /** Preview URL of uploaded image */
  uploadedImagePreview: string | null;
  /** Callback when image is uploaded */
  onImageUpload: (file: File) => Promise<void>;
  /** Callback to clear uploaded image */
  onClearImage: () => void;
  /** Edit prompt/instructions */
  editPrompt: string;
  /** Callback when edit prompt changes */
  onEditPromptChange: (value: string) => void;
  /** Error callback */
  onError: (error: string | null) => void;
}

// ============================================
// Components
// ============================================

/**
 * Reve Text-to-Image settings panel component.
 *
 * @example
 * ```tsx
 * <AIReveTextToImageSettings
 *   aspectRatio={reveAspectRatio}
 *   onAspectRatioChange={setReveAspectRatio}
 *   numImages={reveNumImages}
 *   onNumImagesChange={setReveNumImages}
 *   outputFormat={reveOutputFormat}
 *   onOutputFormatChange={setReveOutputFormat}
 * />
 * ```
 */
export function AIReveTextToImageSettings({
  aspectRatio,
  onAspectRatioChange,
  numImages,
  onNumImagesChange,
  outputFormat,
  onOutputFormatChange,
}: AIReveTextToImageSettingsProps) {
  return (
    <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
      <Label className="text-xs font-medium">Reve Text-to-Image Settings</Label>

      {/* Aspect Ratio Selector */}
      <div className="space-y-1">
        <Label htmlFor="reve-aspect" className="text-xs">
          Aspect Ratio
        </Label>
        <Select
          value={aspectRatio}
          onValueChange={(value) =>
            onAspectRatioChange(value as ReveAspectRatioOption)
          }
        >
          <SelectTrigger id="reve-aspect" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVE_TEXT_TO_IMAGE_MODEL.aspectRatios.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Number of Images */}
      <div className="space-y-1">
        <Label htmlFor="reve-num-images" className="text-xs">
          Number of Images
        </Label>
        <Select
          value={String(numImages)}
          onValueChange={(v) => onNumImagesChange(Number(v))}
        >
          <SelectTrigger id="reve-num-images" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVE_NUM_IMAGE_OPTIONS.map((count) => {
              const totalPrice =
                REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * count;
              return (
                <SelectItem key={count} value={String(count)}>
                  {count} image{count > 1 ? "s" : ""} (${totalPrice.toFixed(2)})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Output Format */}
      <div className="space-y-1">
        <Label htmlFor="reve-format" className="text-xs">
          Output Format
        </Label>
        <Select
          value={outputFormat}
          onValueChange={(value) =>
            onOutputFormatChange(value as ReveOutputFormatOption)
          }
        >
          <SelectTrigger id="reve-format" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVE_TEXT_TO_IMAGE_MODEL.outputFormats.map((format) => (
              <SelectItem key={format} value={format}>
                {format.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * Reve Edit Image settings panel component.
 *
 * @example
 * ```tsx
 * <AIReveEditSettings
 *   uploadedImage={uploadedImageForEdit}
 *   uploadedImagePreview={uploadedImagePreview}
 *   onImageUpload={handleImageUploadForEdit}
 *   onClearImage={clearUploadedImageForEdit}
 *   editPrompt={prompt}
 *   onEditPromptChange={setPrompt}
 *   onError={setError}
 * />
 * ```
 */
export function AIReveEditSettings({
  uploadedImage,
  uploadedImagePreview,
  onImageUpload,
  onClearImage,
  editPrompt,
  onEditPromptChange,
  onError,
}: AIReveEditSettingsProps) {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await onImageUpload(file);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to upload image");
    }
  };

  return (
    <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
      <Label className="text-xs font-medium">Reve Edit (Optional)</Label>
      <p className="text-xs text-muted-foreground">
        Upload an image to edit it with Reve AI, or leave empty for text-to-image
        generation.
      </p>

      {/* Image Upload */}
      <div className="space-y-2">
        <Label className="text-xs">Source Image (Optional)</Label>
        <label
          htmlFor="reve-edit-image-input"
          className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[100px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
            uploadedImage
              ? "border-primary/50 bg-primary/5 p-2"
              : "border-muted-foreground/25 hover:border-muted-foreground/50 p-3"
          }`}
          aria-label={uploadedImage ? "Change image" : "Upload image to edit"}
        >
          {uploadedImage && uploadedImagePreview ? (
            <div className="relative flex flex-col items-center justify-center h-full">
              <img
                src={uploadedImagePreview}
                alt={uploadedImage.name}
                className="max-w-full max-h-20 mx-auto rounded object-contain"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearImage();
                }}
                className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                aria-label="Remove uploaded image"
              >
                <X className="h-3 w-3" />
              </Button>
              <div className="mt-1 text-xs text-muted-foreground text-center">
                {uploadedImage.name}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full space-y-1 text-center">
              <Upload className="size-6 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">
                Upload image to edit
              </div>
              <div className="text-xs text-muted-foreground/70">
                PNG, JPEG, WebP, AVIF, HEIF (max 10MB)
              </div>
              <div className="text-xs text-muted-foreground/70">
                128×128 to 4096×4096 pixels
              </div>
            </div>
          )}
          <input
            id="reve-edit-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/heif"
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>
      </div>

      {uploadedImage && (
        <div className="space-y-2">
          <Label className="text-xs">Edit Instructions</Label>
          <Textarea
            value={editPrompt}
            onChange={(e) => onEditPromptChange(e.target.value)}
            placeholder="Describe the edits you want to make (e.g., 'Make the sky sunset orange', 'Add snow to the ground')"
            className="min-h-[80px] text-xs resize-none"
            maxLength={2560}
          />
          <div className="text-xs text-muted-foreground text-right">
            {editPrompt.length} / 2560 characters
          </div>
        </div>
      )}
    </div>
  );
}
