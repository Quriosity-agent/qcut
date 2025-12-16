"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { X, Upload, Image as ImageIcon, Plus } from "lucide-react";
import { createObjectURL, revokeObjectURL } from "@/lib/blob-manager";

interface MultiImageUploadProps {
  images: string[];
  maxImages: number;
  /** Called with both URLs and Files for proper upload handling */
  onImagesChange: (images: string[], files: File[]) => void;
  /** Called when an image is removed */
  onRemoveImage?: (index: number) => void;
  label?: string;
}

export function MultiImageUpload({
  images = [],
  maxImages,
  onImagesChange,
  onRemoveImage,
  label = "Input Images",
}: MultiImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  // Track files internally to pass with URLs
  const filesRef = useRef<File[]>([]);

  const handleFileUpload = useCallback(
    (fileList: FileList) => {
      const remainingSlots = maxImages - images.length;
      const filesToProcess = Math.min(fileList.length, remainingSlots);

      const newImageUrls: string[] = [];
      const newFiles: File[] = [];

      for (let i = 0; i < filesToProcess; i++) {
        const file = fileList[i];
        if (file.type.startsWith("image/")) {
          const url = createObjectURL(file, "multi-image-upload");
          newImageUrls.push(url);
          newFiles.push(file);
        }
      }

      if (newImageUrls.length > 0) {
        const updatedUrls = [...images, ...newImageUrls];
        const updatedFiles = [...filesRef.current, ...newFiles];
        filesRef.current = updatedFiles;
        onImagesChange(updatedUrls, updatedFiles);
      }
    },
    [images, maxImages, onImagesChange]
  );

  const removeImage = useCallback(
    (index: number) => {
      const imageToRemove = images[index];
      if (imageToRemove.startsWith("blob:")) {
        revokeObjectURL(imageToRemove, "multi-image-upload:remove");
      }

      // Update files ref
      const updatedFiles = filesRef.current.filter((_, i) => i !== index);
      filesRef.current = updatedFiles;

      // Notify parent
      if (onRemoveImage) {
        onRemoveImage(index);
      } else {
        const updatedUrls = images.filter((_, i) => i !== index);
        onImagesChange(updatedUrls, updatedFiles);
      }
    },
    [images, onImagesChange, onRemoveImage]
  );

  const openFileDialog = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        handleFileUpload(target.files);
      }
    };
    input.click();
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files) {
        handleFileUpload(e.dataTransfer.files);
      }
    },
    [handleFileUpload]
  );

  const canAddMore = images.length < maxImages;
  const remainingSlots = maxImages - images.length;

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">{label}</Label>
          <span className="text-xs text-muted-foreground">
            {images.length}/{maxImages}
          </span>
        </div>

        {/* Image Preview Grid */}
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {images.map((image, index) => (
              <div key={`img-${index}`} className="relative group">
                <div className="relative aspect-square rounded border overflow-hidden">
                  <img
                    src={image}
                    alt={`Upload ${index + 1}`}
                    className="w-full h-full object-cover"
                    onError={() => {
                      console.warn(`Failed to load image: ${image}`);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="absolute top-0.5 right-0.5 w-4 h-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(index)}
                  >
                    <X className="w-2.5 h-2.5" />
                  </Button>
                  <div className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[10px] px-1 rounded">
                    {index + 1}
                  </div>
                </div>
              </div>
            ))}

            {/* Add More Button in Grid */}
            {canAddMore && (
              <div
                role="button"
                tabIndex={0}
                className={`aspect-square rounded border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-primary ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50"
                }`}
                onClick={openFileDialog}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openFileDialog();
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                aria-label={`Add up to ${remainingSlots} more images`}
              >
                <Plus className="w-5 h-5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  +{remainingSlots}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Initial Upload Area (when no images) */}
        {images.length === 0 && (
          <div
            role="button"
            tabIndex={0}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openFileDialog}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openFileDialog();
              }
            }}
            aria-label={`Upload up to ${maxImages} images`}
          >
            <ImageIcon className="mx-auto h-6 w-6 text-muted-foreground mb-1" />
            <p className="text-xs font-medium text-muted-foreground">
              Upload Images
            </p>
            <p className="text-[10px] text-muted-foreground">
              Drag & drop or click - Up to {maxImages}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
