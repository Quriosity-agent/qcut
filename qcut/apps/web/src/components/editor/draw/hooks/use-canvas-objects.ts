import { useState, useCallback, useRef } from "react";
import { generateUUID } from "@/lib/utils";

// Base object interface
export interface CanvasObject {
  id: string;
  type: "stroke" | "shape" | "text" | "image";
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
  type: "stroke";
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
  type: "shape";
  // Note: 'square' tool is normalized to 'rectangle' during creation
  // A square is stored as a rectangle with equal width and height
  shapeType: "rectangle" | "circle" | "line";
  strokeStyle: string;
  fillStyle?: string;
  lineWidth: number;
}

// Text object
export interface TextObject extends CanvasObject {
  type: "text";
  text: string;
  font: string;
  fillStyle: string;
}

// Image object (already exists in use-canvas-images but extending here)
export interface ImageObject extends CanvasObject {
  type: "image";
  element: HTMLImageElement;
  rotation: number;
}

// Union type for all canvas objects
export type AnyCanvasObject =
  | StrokeObject
  | ShapeObject
  | TextObject
  | ImageObject;

// Group interface
export interface ObjectGroup {
  id: string;
  name: string;
  objectIds: string[];
  locked: boolean;
  visible: boolean;
}

export const useCanvasObjects = () => {
  const [objects, setObjectsInternal] = useState<AnyCanvasObject[]>([]);

  // Wrapper to track all setObjects calls
  const setObjects = useCallback(
    (
      newObjects:
        | AnyCanvasObject[]
        | ((prev: AnyCanvasObject[]) => AnyCanvasObject[])
    ) => {
      if (typeof newObjects === "function") {
        setObjectsInternal((prev) => {
          const result = newObjects(prev);
          // Reduced verbose setObjects logging
          if (import.meta.env.DEV && false) {
            // Temporarily disabled
            console.log(
              "📝 setObjects (function):",
              prev.length,
              "→",
              result.length
            );
          }
          return result;
        });
      } else {
        // Reduced verbose setObjects direct logging
        if (import.meta.env.DEV && false) {
          // Temporarily disabled
          console.log("📝 setObjects (direct):", newObjects.length);
        }
        setObjectsInternal(newObjects);
      }
    },
    []
  );
  const [groups, setGroups] = useState<ObjectGroup[]>([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const dragState = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    hasMoved: boolean;
  }>({ startX: 0, startY: 0, lastX: 0, lastY: 0, hasMoved: false });
  const zIndexCounter = useRef(1);

  // Add a new stroke object
  const addStroke = useCallback(
    (
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
      if (import.meta.env.DEV) {
        console.log("🏗️ addStroke called:", {
          pointCount: points.length,
          tool: style.tool,
        });
      }

      if (points.length === 0) {
        console.error("❌ No points provided to addStroke");
        return null;
      }

      // Calculate bounding box
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));

      const strokeObject: StrokeObject = {
        id: generateUUID(),
        type: "stroke",
        x: minX - style.lineWidth / 2,
        y: minY - style.lineWidth / 2,
        width: maxX - minX + style.lineWidth,
        height: maxY - minY + style.lineWidth,
        opacity: style.opacity,
        points: points.map((p) => ({ x: p.x - minX, y: p.y - minY })), // Relative to object origin
        strokeStyle: style.strokeStyle,
        lineWidth: style.lineWidth,
        tool: style.tool,
        lineCap: style.lineCap,
        lineJoin: style.lineJoin,
        globalCompositeOperation: style.globalCompositeOperation,
        selected: false,
        zIndex: zIndexCounter.current++,
        created: new Date(),
      };

      setObjects((prev) => [...prev, strokeObject]);

      if (import.meta.env.DEV) {
        console.log("✏️ Stroke object created:", {
          id: strokeObject.id,
          tool: style.tool,
        });
      }

      return strokeObject.id;
    },
    [setObjects]
  );

  // Add a new shape object
  // Note: 'square' should be normalized to 'rectangle' before calling this function
  const addShape = useCallback(
    (
      shapeType: "rectangle" | "circle" | "line", // Excludes 'square' - use 'rectangle' instead
      bounds: { x: number; y: number; width: number; height: number },
      style: {
        strokeStyle: string;
        fillStyle?: string;
        lineWidth: number;
        opacity: number;
      }
    ) => {
      const shapeObject: ShapeObject = {
        id: generateUUID(),
        type: "shape",
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
        created: new Date(),
      };

      setObjects((prev) => [...prev, shapeObject]);

      if (import.meta.env.DEV) {
        console.log("🔲 Shape object created:", {
          id: shapeObject.id,
          type: shapeType,
        });
      }

      return shapeObject.id;
    },
    [setObjects]
  );

  // Add a new text object
  const addText = useCallback(
    (
      text: string,
      position: { x: number; y: number },
      style: {
        font: string;
        fillStyle: string;
        opacity: number;
      }
    ) => {
      console.log("📝 TEXT DEBUG - addText called:", {
        text,
        position,
        style,
        currentObjectCount: objects.length,
        timestamp: Date.now(),
      });

      // Estimate text dimensions (rough calculation)
      const fontSize = parseInt(style.font);
      const estimatedWidth = text.length * fontSize * 0.6;
      const estimatedHeight = fontSize * 1.2;

      console.log("📝 TEXT DEBUG - Calculated text dimensions:", {
        fontSize,
        estimatedWidth,
        estimatedHeight,
      });

      const textObject: TextObject = {
        id: generateUUID(),
        type: "text",
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
        created: new Date(),
      };

      console.log("📝 TEXT DEBUG - Created text object:", {
        id: textObject.id,
        type: textObject.type,
        text: textObject.text,
        bounds: {
          x: textObject.x,
          y: textObject.y,
          width: textObject.width,
          height: textObject.height,
        },
        timestamp: Date.now(),
      });

      setObjects((prev) => {
        const newObjects = [...prev, textObject];
        console.log("📝 TEXT DEBUG - Updated objects array:", {
          previousCount: prev.length,
          newCount: newObjects.length,
          addedObject: { id: textObject.id, type: textObject.type },
          timestamp: Date.now(),
        });
        return newObjects;
      });

      console.log("✅ TEXT DEBUG - Text object creation completed:", {
        id: textObject.id,
        text,
        finalObjectCount: objects.length + 1,
      });

      return textObject.id;
    },
    [objects.length, setObjects]
  );

  // Add an image object (integrates with existing image system)
  const addImageObject = useCallback(
    (imageData: {
      id: string;
      element: HTMLImageElement;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    }) => {
      console.log("🖼️ IMAGE DEBUG - addImageObject called:", {
        imageId: imageData.id,
        dimensions: {
          x: imageData.x,
          y: imageData.y,
          width: imageData.width,
          height: imageData.height,
        },
        rotation: imageData.rotation,
        currentObjectCount: objects.length,
        timestamp: Date.now(),
      });

      const imageObject: ImageObject = {
        ...imageData,
        type: "image",
        opacity: 1.0, // Default opacity for images
        selected: false,
        zIndex: zIndexCounter.current++,
        created: new Date(),
      };

      console.log("🖼️ IMAGE DEBUG - Created image object:", {
        id: imageObject.id,
        type: imageObject.type,
        bounds: {
          x: imageObject.x,
          y: imageObject.y,
          width: imageObject.width,
          height: imageObject.height,
        },
        zIndex: imageObject.zIndex,
        timestamp: Date.now(),
      });

      setObjects((prev) => {
        const newObjects = [...prev, imageObject];
        console.log("🖼️ IMAGE DEBUG - Updated objects array:", {
          previousCount: prev.length,
          newCount: newObjects.length,
          addedObject: { id: imageObject.id, type: imageObject.type },
          timestamp: Date.now(),
        });
        return newObjects;
      });

      console.log("✅ IMAGE DEBUG - Image object creation completed:", {
        id: imageObject.id,
        finalObjectCount: objects.length + 1,
      });

      return imageObject.id;
    },
    [objects.length, setObjects]
  );

  // Select objects
  const selectObjects = useCallback(
    (ids: string[], addToSelection = false) => {
      if (addToSelection) {
        setSelectedObjectIds((prev) => {
          const newSelection = [...prev];
          ids.forEach((id) => {
            if (!newSelection.includes(id)) {
              newSelection.push(id);
            }
          });
          return newSelection;
        });
      } else {
        setSelectedObjectIds(ids);
      }

      setObjects((prev) =>
        prev.map((obj) => ({
          ...obj,
          selected: addToSelection
            ? obj.selected || ids.includes(obj.id)
            : ids.includes(obj.id),
        }))
      );
    },
    [setObjects]
  );

  // Get object at position (for selection)
  const getObjectAtPosition = useCallback(
    (x: number, y: number): AnyCanvasObject | null => {
      // Check from top to bottom (highest z-index first)
      const sortedObjects = [...objects].sort((a, b) => b.zIndex - a.zIndex);

      for (const obj of sortedObjects) {
        if (
          x >= obj.x &&
          x <= obj.x + obj.width &&
          y >= obj.y &&
          y <= obj.y + obj.height
        ) {
          return obj;
        }
      }
      return null;
    },
    [objects]
  );

  // Create group from selected objects
  const createGroup = useCallback(
    (name?: string) => {
      if (selectedObjectIds.length < 2) return null;

      const groupId = generateUUID();
      const groupName = name || `Group ${groups.length + 1}`;

      const newGroup: ObjectGroup = {
        id: groupId,
        name: groupName,
        objectIds: [...selectedObjectIds],
        locked: false,
        visible: true,
      };

      setGroups((prev) => [...prev, newGroup]);
      setObjects((prev) =>
        prev.map((obj) =>
          selectedObjectIds.includes(obj.id) ? { ...obj, groupId } : obj
        )
      );

      if (import.meta.env.DEV) {
        console.log("🔗 Group created:", {
          groupId,
          name: groupName,
          objects: selectedObjectIds,
        });
      }

      return groupId;
    },
    [selectedObjectIds, groups.length, setObjects]
  );

  // Ungroup objects
  const ungroupObjects = useCallback(
    (groupId: string) => {
      setGroups((prev) => prev.filter((group) => group.id !== groupId));
      setObjects((prev) =>
        prev.map((obj) =>
          obj.groupId === groupId ? { ...obj, groupId: undefined } : obj
        )
      );

      if (import.meta.env.DEV) {
        console.log("🔓 Group dissolved:", { groupId });
      }
    },
    [setObjects]
  );

  // Clear all objects and groups
  const clearAll = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log("🧹 clearAll called:", {
        currentObjectCount: objects.length,
        stackTrace: new Error("Debug stack trace for clearAll").stack
          ?.split("\n")[2]
          ?.trim(),
      });
    }
    setObjects([]);
    setGroups([]);
    setSelectedObjectIds([]);
    setIsDrawing(false);
    setIsDragging(false);
    dragState.current = {
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      hasMoved: false,
    };
  }, [objects.length, setObjects]);

  // Start dragging objects
  const startDrag = useCallback(
    (startX: number, startY: number) => {
      if (selectedObjectIds.length === 0) return false;

      dragState.current = {
        startX,
        startY,
        lastX: startX,
        lastY: startY,
        hasMoved: false,
      };
      setIsDragging(true);

      if (import.meta.env.DEV) {
        console.log("🖱️ Drag started:", {
          startX,
          startY,
          selectedCount: selectedObjectIds.length,
        });
      }

      return true;
    },
    [selectedObjectIds]
  );

  // Update drag position
  const updateDrag = useCallback(
    (currentX: number, currentY: number) => {
      if (import.meta.env.DEV) {
        console.log("🔄 updateDrag called:", {
          currentX,
          currentY,
          isDragging,
          selectedCount: selectedObjectIds.length,
          lastX: dragState.current.lastX,
          lastY: dragState.current.lastY,
        });
      }

      // Only check if we have selected objects - don't rely on isDragging state
      // since it might be out of sync between hooks
      if (selectedObjectIds.length === 0) {
        if (import.meta.env.DEV) {
          console.log("❌ updateDrag early return - no selected objects:", {
            selectedCount: selectedObjectIds.length,
          });
        }
        return;
      }

      // Ensure we have a valid start position
      if (dragState.current.lastX === 0 && dragState.current.lastY === 0) {
        // Initialize drag state if not set
        dragState.current.lastX = currentX;
        dragState.current.lastY = currentY;
        if (import.meta.env.DEV) {
          console.log("🔧 Initializing drag state:", { currentX, currentY });
        }
        return;
      }

      const deltaX = currentX - dragState.current.lastX;
      const deltaY = currentY - dragState.current.lastY;

      // Only move if there's actual movement
      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        if (import.meta.env.DEV) {
          console.log("🚀 Applying movement:", {
            deltaX,
            deltaY,
            selectedIds: selectedObjectIds,
          });
        }

        setObjects((prev) =>
          prev.map((obj) => {
            if (selectedObjectIds.includes(obj.id)) {
              const newObj = { ...obj, x: obj.x + deltaX, y: obj.y + deltaY };
              if (import.meta.env.DEV) {
                console.log(`📦 Moving object ${obj.id}:`, {
                  from: { x: obj.x, y: obj.y },
                  to: { x: newObj.x, y: newObj.y },
                });
              }
              return newObj;
            }
            return obj;
          })
        );

        dragState.current.lastX = currentX;
        dragState.current.lastY = currentY;
        dragState.current.hasMoved = true;
      } else {
        if (import.meta.env.DEV) {
          console.log("⏸️ Movement too small:", { deltaX, deltaY });
        }
      }
    },
    [isDragging, selectedObjectIds, setObjects]
  );

  // End dragging
  const endDrag = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (import.meta.env.DEV) {
        console.log("🏁 Drag ended:", { hasMoved: dragState.current.hasMoved });
      }
      dragState.current = {
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        hasMoved: false,
      };
    }
  }, [isDragging]);

  // Delete selected objects
  const deleteSelectedObjects = useCallback(() => {
    setObjects((prev) =>
      prev.filter((obj) => !selectedObjectIds.includes(obj.id))
    );
    setSelectedObjectIds([]);
  }, [selectedObjectIds, setObjects]);

  // Render objects to canvas (optionally filtered)
  const renderObjects = useCallback(
    (ctx: CanvasRenderingContext2D, objectsToRender?: AnyCanvasObject[]) => {
      // Use provided objects or default to all objects
      const targetObjects = objectsToRender || objects;

      // Sort by z-index
      const sortedObjects = [...targetObjects].sort(
        (a, b) => a.zIndex - b.zIndex
      );

      sortedObjects.forEach((obj) => {
        ctx.save();

        // Apply object opacity
        ctx.globalAlpha = obj.opacity || 1;

        switch (obj.type) {
          case "stroke": {
            const stroke = obj as StrokeObject;
            ctx.strokeStyle = stroke.strokeStyle;
            ctx.lineWidth = stroke.lineWidth;
            ctx.lineCap = stroke.lineCap as CanvasLineCap;
            ctx.lineJoin = stroke.lineJoin as CanvasLineJoin;
            ctx.globalCompositeOperation =
              stroke.globalCompositeOperation as GlobalCompositeOperation;

            if (stroke.points.length > 1) {
              ctx.beginPath();
              const firstPoint = stroke.points[0];
              const startX = obj.x + firstPoint.x;
              const startY = obj.y + firstPoint.y;
              ctx.moveTo(startX, startY);

              for (let i = 1; i < stroke.points.length; i++) {
                const point = stroke.points[i];
                const lineX = obj.x + point.x;
                const lineY = obj.y + point.y;
                ctx.lineTo(lineX, lineY);
              }
              ctx.stroke();
            }
            break;
          }

          case "shape": {
            const shape = obj as ShapeObject;
            ctx.strokeStyle = shape.strokeStyle;
            ctx.lineWidth = shape.lineWidth;
            if (shape.fillStyle) {
              ctx.fillStyle = shape.fillStyle;
            }

            ctx.beginPath();
            switch (shape.shapeType) {
              case "rectangle":
                ctx.rect(obj.x, obj.y, obj.width, obj.height);
                break;
              case "circle": {
                const centerX = obj.x + obj.width / 2;
                const centerY = obj.y + obj.height / 2;
                const radius = Math.min(obj.width, obj.height) / 2;
                ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                break;
              }
              case "line":
                ctx.moveTo(obj.x, obj.y);
                ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
                break;
            }

            if (shape.fillStyle) {
              ctx.fill();
            }
            ctx.stroke();
            break;
          }

          case "text": {
            const text = obj as TextObject;
            if (import.meta.env.DEV) {
              console.log("📝 TEXT DEBUG - Rendering text object:", {
                id: text.id,
                text: text.text,
                position: { x: obj.x, y: obj.y },
                font: text.font,
                fillStyle: text.fillStyle,
              });
            }
            ctx.fillStyle = text.fillStyle;
            ctx.font = text.font;
            ctx.fillText(text.text, obj.x, obj.y);
            break;
          }

          case "image": {
            const image = obj as ImageObject;
            // Reduced verbose image debug logging
            if (import.meta.env.DEV && false) {
              // Temporarily disabled
              console.log("🖼️ IMAGE DEBUG - Rendering image object:", image.id);
            }

            // Check if image is loaded
            if (!image.element.complete) {
              console.warn(
                "🖼️ IMAGE DEBUG - Image not fully loaded, skipping render:",
                image.id
              );
              break;
            }

            const centerX = obj.x + obj.width / 2;
            const centerY = obj.y + obj.height / 2;

            // Reduced verbose transform calculations logging
            if (import.meta.env.DEV && false) {
              // Temporarily disabled
              console.log(
                "🖼️ IMAGE DEBUG - Transform calculations for:",
                image.id
              );
            }

            ctx.translate(centerX, centerY);
            ctx.rotate((image.rotation * Math.PI) / 180);
            ctx.translate(-centerX, -centerY);

            try {
              ctx.drawImage(image.element, obj.x, obj.y, obj.width, obj.height);
              // Reduced verbose image success logging
              if (import.meta.env.DEV && false) {
                // Temporarily disabled
                console.log(
                  "✅ IMAGE DEBUG - Image rendered successfully:",
                  image.id
                );
              }
            } catch (error) {
              console.error("❌ IMAGE DEBUG - Failed to render image:", {
                id: image.id,
                error,
                imageElement: image.element,
              });
            }
            break;
          }
        }

        // Draw selection indicator
        if (obj.selected) {
          ctx.strokeStyle = "#ff6b35";
          ctx.lineWidth = 3;
          ctx.setLineDash([]);
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);

          // Draw group indicator if part of a group
          if (obj.groupId) {
            ctx.strokeStyle = "#00ff88";
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.strokeRect(obj.x - 4, obj.y - 4, obj.width + 8, obj.height + 8);
          }
        }

        ctx.restore();
      });
    },
    [objects]
  );

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
    clearAll,
    startDrag,
    updateDrag,
    endDrag,
    deleteSelectedObjects,
    renderObjects,
    setIsDrawing,
    setIsDragging,
  };
};

export default useCanvasObjects;
