"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { X, Upload, Image as ImageIcon, Plus } from "lucide-react";

interface MultiImageUploadProps {
  images: string[];
  maxImages: number;
  onChange: (images: string[]) => void;
  label?: string;
}

export function MultiImageUpload({ 
  images = [], 
  maxImages, 
  onChange, 
  label = "Input Images" 
}: MultiImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFileUpload = useCallback((files: FileList) => {
    const remainingSlots = maxImages - images.length;
    const filesToProcess = Math.min(files.length, remainingSlots);
    
    const newImageUrls: string[] = [];
    
    for (let i = 0; i < filesToProcess; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        newImageUrls.push(url);
      }
    }
    
    if (newImageUrls.length > 0) {
      onChange([...images, ...newImageUrls]);
    }
  }, [images, maxImages, onChange]);

  const removeImage = useCallback((index: number) => {
    const imageToRemove = images[index];
    if (imageToRemove.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove);
    }
    onChange(images.filter((_, i) => i !== index));
  }, [images, onChange]);

  const openFileDialog = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  }, [handleFileUpload]);

  const canAddMore = images.length < maxImages;
  const remainingSlots = maxImages - images.length;

  return (
    <div className="multi-image-upload space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground">
          {images.length}/{maxImages}
        </span>
      </div>

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <Card key={index} className="relative group">
              <CardContent className="p-2">
                <div className="relative aspect-square">
                  <img 
                    src={image} 
                    alt={`Upload ${index + 1}`}
                    className="w-full h-full object-cover rounded border"
                    onError={() => {
                      console.warn(`Failed to load image: ${image}`);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    className="absolute -top-1 -right-1 w-5 h-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(index)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                  <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1 rounded">
                    {index + 1}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {/* Add More Button */}
          {canAddMore && (
            <Card 
              className={`cursor-pointer border-2 border-dashed transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onClick={openFileDialog}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <CardContent className="p-2">
                <div className="aspect-square flex flex-col items-center justify-center text-center">
                  <Plus className="w-6 h-6 text-muted-foreground mb-1" />
                  <span className="text-xs text-muted-foreground">
                    Add More
                  </span>
                  <span className="text-xs text-muted-foreground/75">
                    {remainingSlots} left
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Initial Upload Area (when no images) */}
      {images.length === 0 && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            Upload Images
          </p>
          <p className="text-xs text-muted-foreground">
            Drag & drop images here or click to browse
          </p>
          <p className="text-xs text-muted-foreground/75 mt-1">
            Up to {maxImages} images supported
          </p>
        </div>
      )}

      {/* Bulk Upload Button (when some images exist) */}
      {images.length > 0 && canAddMore && (
        <Button
          variant="outline"
          size="sm"
          onClick={openFileDialog}
          className="w-full h-8 text-xs"
        >
          <Upload className="w-3 h-3 mr-1" />
          Add More Images ({remainingSlots} slots available)
        </Button>
      )}

      {/* Helper Text */}
      <p className="text-xs text-muted-foreground">
        {images.length === 0 
          ? "Select multiple images to edit simultaneously" 
          : canAddMore 
            ? "You can add more images or proceed with current selection"
            : "Maximum images reached. Remove some to add different ones."
        }
      </p>
    </div>
  );
}