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
  groupId?: string;
}

export interface ObjectGroup {
  id: string;
  name: string;
  objectIds: string[];
  locked: boolean;
  visible: boolean;
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
  const [groups, setGroups] = useState<ObjectGroup[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMultiSelecting, setIsMultiSelecting] = useState(false);
  const dragOffset = useRef<{ x: number; y: number; lastDeltaX?: number; lastDeltaY?: number }>({ x: 0, y: 0 });

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
        setSelectedImageIds([id]);
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
    setSelectedImageIds(prev => prev.filter(imgId => imgId !== id));
  }, []);

  const updateImage = useCallback((id: string, updates: Partial<ImageTransform>) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, ...updates } : img
    ));
  }, []);

  const selectImages = useCallback((ids: string[], addToSelection = false) => {
    if (addToSelection) {
      setSelectedImageIds(prev => {
        const newSelection = [...prev];
        ids.forEach(id => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      });
    } else {
      setSelectedImageIds(ids);
    }

    setImages(prev => prev.map(img => ({
      ...img,
      selected: addToSelection
        ? (img.selected || ids.includes(img.id))
        : ids.includes(img.id)
    })));
  }, []);

  const selectImage = useCallback((id: string | null, addToSelection = false) => {
    if (id === null) {
      selectImages([], false);
    } else {
      selectImages([id], addToSelection);
    }
  }, [selectImages]);

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

  const createGroup = useCallback((name?: string) => {
    if (selectedImageIds.length < 2) return null;

    const groupId = Date.now().toString();
    const groupName = name || `Group ${groups.length + 1}`;

    const newGroup: ObjectGroup = {
      id: groupId,
      name: groupName,
      objectIds: [...selectedImageIds],
      locked: false,
      visible: true
    };

    setGroups(prev => [...prev, newGroup]);

    // Update images to belong to the group
    setImages(prev => prev.map(img =>
      selectedImageIds.includes(img.id)
        ? { ...img, groupId }
        : img
    ));

    console.log('🔗 Group created:', { groupId, name: groupName, objects: selectedImageIds });
    return groupId;
  }, [selectedImageIds, groups.length]);

  const ungroupObjects = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(group => group.id !== groupId));
    setImages(prev => prev.map(img =>
      img.groupId === groupId
        ? { ...img, groupId: undefined }
        : img
    ));
    console.log('🔓 Group dissolved:', { groupId });
  }, []);

  const selectGroup = useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      selectImages(group.objectIds, false);
    }
  }, [groups, selectImages]);

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
    if (isDragging && selectedImageIds.length > 0) {
      const deltaX = currentX - dragOffset.current.x;
      const deltaY = currentY - dragOffset.current.y;

      // Move all selected images
      selectedImageIds.forEach(imageId => {
        const image = images.find(img => img.id === imageId);
        if (image) {
          const newX = image.x + (deltaX - (dragOffset.current.lastDeltaX || 0));
          const newY = image.y + (deltaY - (dragOffset.current.lastDeltaY || 0));
          updateImage(imageId, { x: newX, y: newY });
        }
      });

      // Store the last delta for next frame
      dragOffset.current.lastDeltaX = deltaX;
      dragOffset.current.lastDeltaY = deltaY;
    }
  }, [isDragging, selectedImageIds, updateImage, images]);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    // Reset drag offset deltas
    dragOffset.current.lastDeltaX = 0;
    dragOffset.current.lastDeltaY = 0;
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

      // Draw selection borders and handles if selected
      if (img.selected) {
        // Selection border
        ctx.strokeStyle = '#ff6b35'; // Orange selection color
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.strokeRect(img.x - 2, img.y - 2, img.width + 4, img.height + 4);

        // Group indicator if part of a group
        if (img.groupId) {
          ctx.strokeStyle = '#00ff88'; // Green for grouped items
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(img.x - 4, img.y - 4, img.width + 8, img.height + 8);
        }

        // Selection handles
        const handleSize = 10;
        ctx.fillStyle = '#ff6b35';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        // Corner handles
        const corners = [
          { x: img.x - handleSize/2, y: img.y - handleSize/2 }, // Top-left
          { x: img.x + img.width - handleSize/2, y: img.y - handleSize/2 }, // Top-right
          { x: img.x - handleSize/2, y: img.y + img.height - handleSize/2 }, // Bottom-left
          { x: img.x + img.width - handleSize/2, y: img.y + img.height - handleSize/2 } // Bottom-right
        ];

        corners.forEach(corner => {
          ctx.fillRect(corner.x, corner.y, handleSize, handleSize);
          ctx.strokeRect(corner.x, corner.y, handleSize, handleSize);
        });

        // Middle handles for resizing
        const midHandles = [
          { x: img.x + img.width/2 - handleSize/2, y: img.y - handleSize/2 }, // Top
          { x: img.x + img.width/2 - handleSize/2, y: img.y + img.height - handleSize/2 }, // Bottom
          { x: img.x - handleSize/2, y: img.y + img.height/2 - handleSize/2 }, // Left
          { x: img.x + img.width - handleSize/2, y: img.y + img.height/2 - handleSize/2 } // Right
        ];

        ctx.fillStyle = '#ffffff';
        midHandles.forEach(handle => {
          ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
          ctx.strokeRect(handle.x, handle.y, handleSize, handleSize);
        });
      }

      ctx.restore();
    });
  }, [images]);

  return {
    images,
    groups,
    selectedImageIds,
    isDragging,
    isResizing,
    isMultiSelecting,
    addImage,
    removeImage,
    updateImage,
    selectImage,
    selectImages,
    getImageAtPosition,
    startDrag,
    updateDrag,
    endDrag,
    renderImages,
    createGroup,
    ungroupObjects,
    selectGroup
  };
};

export default useCanvasImages;