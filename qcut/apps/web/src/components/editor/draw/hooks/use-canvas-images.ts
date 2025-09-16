import { useState, useCallback, useRef } from 'react';

export interface CanvasImage {
  id: string;
  element: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  selected: boolean;
}

interface ImageTransform {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export const useCanvasImages = (canvasRef: React.RefObject<HTMLCanvasElement>) => {
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const addImage = useCallback(async (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      const canvas = canvasRef.current;

      if (!canvas) {
        reject(new Error('Canvas not available'));
        return;
      }

      img.onload = () => {
        const id = Date.now().toString();

        // Calculate initial size (fit to canvas while maintaining aspect ratio)
        const maxWidth = canvas.width * 0.5; // Max 50% of canvas width
        const maxHeight = canvas.height * 0.5; // Max 50% of canvas height

        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }

        const newImage: CanvasImage = {
          id,
          element: img,
          x: (canvas.width - width) / 2, // Center horizontally
          y: (canvas.height - height) / 2, // Center vertically
          width,
          height,
          rotation: 0,
          selected: true
        };

        setImages(prev => [...prev, newImage]);
        setSelectedImageId(id);
        resolve(id);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      img.src = URL.createObjectURL(file);
    });
  }, [canvasRef]);

  const removeImage = useCallback((id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImageId === id) {
      setSelectedImageId(null);
    }
  }, [selectedImageId]);

  const updateImage = useCallback((id: string, updates: Partial<ImageTransform>) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, ...updates } : img
    ));
  }, []);

  const selectImage = useCallback((id: string | null) => {
    setImages(prev => prev.map(img => ({
      ...img,
      selected: img.id === id
    })));
    setSelectedImageId(id);
  }, []);

  const getImageAtPosition = useCallback((x: number, y: number): CanvasImage | null => {
    // Check from top to bottom (last added first)
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i];
      if (x >= img.x && x <= img.x + img.width &&
          y >= img.y && y <= img.y + img.height) {
        return img;
      }
    }
    return null;
  }, [images]);

  const startDrag = useCallback((imageId: string, startX: number, startY: number) => {
    const image = images.find(img => img.id === imageId);
    if (image) {
      setIsDragging(true);
      dragOffset.current = {
        x: startX - image.x,
        y: startY - image.y
      };
    }
  }, [images]);

  const updateDrag = useCallback((currentX: number, currentY: number) => {
    if (isDragging && selectedImageId) {
      const newX = currentX - dragOffset.current.x;
      const newY = currentY - dragOffset.current.y;
      updateImage(selectedImageId, { x: newX, y: newY });
    }
  }, [isDragging, selectedImageId, updateImage]);

  const endDrag = useCallback(() => {
    setIsDragging(false);
  }, []);

  const renderImages = useCallback((ctx: CanvasRenderingContext2D) => {
    images.forEach(img => {
      ctx.save();

      // Apply transformations
      const centerX = img.x + img.width / 2;
      const centerY = img.y + img.height / 2;

      ctx.translate(centerX, centerY);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);

      // Draw image
      ctx.drawImage(img.element, img.x, img.y, img.width, img.height);

      // Draw selection handles if selected
      if (img.selected) {
        ctx.strokeStyle = '#ff6b35'; // Orange selection color
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(img.x, img.y, img.width, img.height);

        // Selection handles
        const handleSize = 8;
        ctx.fillStyle = '#ff6b35';
        ctx.setLineDash([]);

        // Corner handles
        ctx.fillRect(img.x - handleSize/2, img.y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(img.x + img.width - handleSize/2, img.y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(img.x - handleSize/2, img.y + img.height - handleSize/2, handleSize, handleSize);
        ctx.fillRect(img.x + img.width - handleSize/2, img.y + img.height - handleSize/2, handleSize, handleSize);
      }

      ctx.restore();
    });
  }, [images]);

  return {
    images,
    selectedImageId,
    isDragging,
    isResizing,
    addImage,
    removeImage,
    updateImage,
    selectImage,
    getImageAtPosition,
    startDrag,
    updateDrag,
    endDrag,
    renderImages
  };
};

export default useCanvasImages;