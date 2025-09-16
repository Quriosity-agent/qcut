import { useState, useCallback, useRef } from 'react';

// Base object interface
export interface CanvasObject {
  id: string;
  type: 'stroke' | 'shape' | 'text' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  selected: boolean;
  groupId?: string;
  zIndex: number;
  created: Date;
}

// Stroke object for pencil/brush drawings
export interface StrokeObject extends CanvasObject {
  type: 'stroke';
  points: { x: number; y: number }[];
  strokeStyle: string;
  lineWidth: number;
  tool: string; // 'brush', 'pencil', 'eraser', etc.
  lineCap: string;
  lineJoin: string;
  globalCompositeOperation: string;
}

// Shape object for rectangles, circles, lines
export interface ShapeObject extends CanvasObject {
  type: 'shape';
  shapeType: 'rectangle' | 'circle' | 'line';
  strokeStyle: string;
  fillStyle?: string;
  lineWidth: number;
}

// Text object
export interface TextObject extends CanvasObject {
  type: 'text';
  text: string;
  font: string;
  fillStyle: string;
}

// Image object (already exists in use-canvas-images but extending here)
export interface ImageObject extends CanvasObject {
  type: 'image';
  element: HTMLImageElement;
  rotation: number;
}

// Union type for all canvas objects
export type AnyCanvasObject = StrokeObject | ShapeObject | TextObject | ImageObject;

// Group interface
export interface ObjectGroup {
  id: string;
  name: string;
  objectIds: string[];
  locked: boolean;
  visible: boolean;
}

export const useCanvasObjects = () => {
  const [objects, setObjects] = useState<AnyCanvasObject[]>([]);
  const [groups, setGroups] = useState<ObjectGroup[]>([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const dragOffset = useRef<{ x: number; y: number; lastDeltaX?: number; lastDeltaY?: number }>({ x: 0, y: 0 });
  const zIndexCounter = useRef(1);

  // Add a new stroke object
  const addStroke = useCallback((
    points: { x: number; y: number }[],
    style: {
      strokeStyle: string;
      lineWidth: number;
      opacity: number;
      tool: string;
      lineCap: string;
      lineJoin: string;
      globalCompositeOperation: string;
    }
  ) => {
    if (points.length === 0) return null;

    // Calculate bounding box
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));

    const strokeObject: StrokeObject = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'stroke',
      x: minX - style.lineWidth / 2,
      y: minY - style.lineWidth / 2,
      width: maxX - minX + style.lineWidth,
      height: maxY - minY + style.lineWidth,
      opacity: style.opacity,
      points: points.map(p => ({ x: p.x - minX, y: p.y - minY })), // Relative to object origin
      strokeStyle: style.strokeStyle,
      lineWidth: style.lineWidth,
      tool: style.tool,
      lineCap: style.lineCap,
      lineJoin: style.lineJoin,
      globalCompositeOperation: style.globalCompositeOperation,
      selected: false,
      zIndex: zIndexCounter.current++,
      created: new Date()
    };

    setObjects(prev => [...prev, strokeObject]);
    console.log('✏️ Stroke object created:', { id: strokeObject.id, pointCount: points.length });
    return strokeObject.id;
  }, []);

  // Add a new shape object
  const addShape = useCallback((
    shapeType: 'rectangle' | 'circle' | 'line',
    bounds: { x: number; y: number; width: number; height: number },
    style: {
      strokeStyle: string;
      fillStyle?: string;
      lineWidth: number;
      opacity: number;
    }
  ) => {
    const shapeObject: ShapeObject = {
      id: `shape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'shape',
      shapeType,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      opacity: style.opacity,
      strokeStyle: style.strokeStyle,
      fillStyle: style.fillStyle,
      lineWidth: style.lineWidth,
      selected: false,
      zIndex: zIndexCounter.current++,
      created: new Date()
    };

    setObjects(prev => [...prev, shapeObject]);
    console.log('🔲 Shape object created:', { id: shapeObject.id, type: shapeType });
    return shapeObject.id;
  }, []);

  // Add a new text object
  const addText = useCallback((
    text: string,
    position: { x: number; y: number },
    style: {
      font: string;
      fillStyle: string;
      opacity: number;
    }
  ) => {
    // Estimate text dimensions (rough calculation)
    const fontSize = parseInt(style.font);
    const estimatedWidth = text.length * fontSize * 0.6;
    const estimatedHeight = fontSize * 1.2;

    const textObject: TextObject = {
      id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'text',
      text,
      x: position.x,
      y: position.y,
      width: estimatedWidth,
      height: estimatedHeight,
      opacity: style.opacity,
      font: style.font,
      fillStyle: style.fillStyle,
      selected: false,
      zIndex: zIndexCounter.current++,
      created: new Date()
    };

    setObjects(prev => [...prev, textObject]);
    console.log('📝 Text object created:', { id: textObject.id, text });
    return textObject.id;
  }, []);

  // Add an image object (integrates with existing image system)
  const addImageObject = useCallback((imageData: {
    id: string;
    element: HTMLImageElement;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }) => {
    const imageObject: ImageObject = {
      ...imageData,
      type: 'image',
      opacity: 1.0, // Default opacity for images
      selected: false,
      zIndex: zIndexCounter.current++,
      created: new Date()
    };

    setObjects(prev => [...prev, imageObject]);
    console.log('🖼️ Image object created:', { id: imageObject.id });
    return imageObject.id;
  }, []);

  // Select objects
  const selectObjects = useCallback((ids: string[], addToSelection = false) => {
    if (addToSelection) {
      setSelectedObjectIds(prev => {
        const newSelection = [...prev];
        ids.forEach(id => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      });
    } else {
      setSelectedObjectIds(ids);
    }

    setObjects(prev => prev.map(obj => ({
      ...obj,
      selected: addToSelection
        ? (obj.selected || ids.includes(obj.id))
        : ids.includes(obj.id)
    })));
  }, []);

  // Get object at position (for selection)
  const getObjectAtPosition = useCallback((x: number, y: number): AnyCanvasObject | null => {
    // Check from top to bottom (highest z-index first)
    const sortedObjects = [...objects].sort((a, b) => b.zIndex - a.zIndex);

    for (const obj of sortedObjects) {
      if (x >= obj.x && x <= obj.x + obj.width &&
          y >= obj.y && y <= obj.y + obj.height) {
        return obj;
      }
    }
    return null;
  }, [objects]);

  // Create group from selected objects
  const createGroup = useCallback((name?: string) => {
    if (selectedObjectIds.length < 2) return null;

    const groupId = `group-${Date.now()}`;
    const groupName = name || `Group ${groups.length + 1}`;

    const newGroup: ObjectGroup = {
      id: groupId,
      name: groupName,
      objectIds: [...selectedObjectIds],
      locked: false,
      visible: true
    };

    setGroups(prev => [...prev, newGroup]);
    setObjects(prev => prev.map(obj =>
      selectedObjectIds.includes(obj.id)
        ? { ...obj, groupId }
        : obj
    ));

    console.log('🔗 Group created:', { groupId, name: groupName, objects: selectedObjectIds });
    return groupId;
  }, [selectedObjectIds, groups.length]);

  // Ungroup objects
  const ungroupObjects = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(group => group.id !== groupId));
    setObjects(prev => prev.map(obj =>
      obj.groupId === groupId
        ? { ...obj, groupId: undefined }
        : obj
    ));
    console.log('🔓 Group dissolved:', { groupId });
  }, []);

  // Move selected objects
  const moveObjects = useCallback((deltaX: number, deltaY: number) => {
    if (selectedObjectIds.length === 0) return;

    setObjects(prev => prev.map(obj =>
      selectedObjectIds.includes(obj.id)
        ? { ...obj, x: obj.x + deltaX, y: obj.y + deltaY }
        : obj
    ));
  }, [selectedObjectIds]);

  // Delete selected objects
  const deleteSelectedObjects = useCallback(() => {
    setObjects(prev => prev.filter(obj => !selectedObjectIds.includes(obj.id)));
    setSelectedObjectIds([]);
  }, [selectedObjectIds]);

  // Render all objects to canvas
  const renderObjects = useCallback((ctx: CanvasRenderingContext2D) => {
    // Sort by z-index
    const sortedObjects = [...objects].sort((a, b) => a.zIndex - b.zIndex);

    sortedObjects.forEach(obj => {
      ctx.save();

      // Apply object opacity
      ctx.globalAlpha = obj.opacity || 1;

      switch (obj.type) {
        case 'stroke': {
          const stroke = obj as StrokeObject;
          ctx.strokeStyle = stroke.strokeStyle;
          ctx.lineWidth = stroke.lineWidth;
          ctx.lineCap = stroke.lineCap as CanvasLineCap;
          ctx.lineJoin = stroke.lineJoin as CanvasLineJoin;
          ctx.globalCompositeOperation = stroke.globalCompositeOperation as GlobalCompositeOperation;

          if (stroke.points.length > 1) {
            ctx.beginPath();
            const firstPoint = stroke.points[0];
            ctx.moveTo(obj.x + firstPoint.x, obj.y + firstPoint.y);

            for (let i = 1; i < stroke.points.length; i++) {
              const point = stroke.points[i];
              ctx.lineTo(obj.x + point.x, obj.y + point.y);
            }
            ctx.stroke();
          }
          break;
        }

        case 'shape': {
          const shape = obj as ShapeObject;
          ctx.strokeStyle = shape.strokeStyle;
          ctx.lineWidth = shape.lineWidth;
          if (shape.fillStyle) {
            ctx.fillStyle = shape.fillStyle;
          }

          ctx.beginPath();
          switch (shape.shapeType) {
            case 'rectangle':
              ctx.rect(obj.x, obj.y, obj.width, obj.height);
              break;
            case 'circle':
              const centerX = obj.x + obj.width / 2;
              const centerY = obj.y + obj.height / 2;
              const radius = Math.min(obj.width, obj.height) / 2;
              ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
              break;
          }

          if (shape.fillStyle) {
            ctx.fill();
          }
          ctx.stroke();
          break;
        }

        case 'text': {
          const text = obj as TextObject;
          ctx.fillStyle = text.fillStyle;
          ctx.font = text.font;
          ctx.fillText(text.text, obj.x, obj.y);
          break;
        }

        case 'image': {
          const image = obj as ImageObject;
          const centerX = obj.x + obj.width / 2;
          const centerY = obj.y + obj.height / 2;

          ctx.translate(centerX, centerY);
          ctx.rotate((image.rotation * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);

          ctx.drawImage(image.element, obj.x, obj.y, obj.width, obj.height);
          break;
        }
      }

      // Draw selection indicator
      if (obj.selected) {
        ctx.strokeStyle = '#ff6b35';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);

        // Draw group indicator if part of a group
        if (obj.groupId) {
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(obj.x - 4, obj.y - 4, obj.width + 8, obj.height + 8);
        }
      }

      ctx.restore();
    });
  }, [objects]);

  return {
    objects,
    groups,
    selectedObjectIds,
    isDragging,
    isDrawing,
    addStroke,
    addShape,
    addText,
    addImageObject,
    selectObjects,
    getObjectAtPosition,
    createGroup,
    ungroupObjects,
    moveObjects,
    deleteSelectedObjects,
    renderObjects,
    setIsDrawing,
    setIsDragging
  };
};

export default useCanvasObjects;