/**
 * Canvas Object Type Definitions
 * Extracted from use-canvas-objects.ts to keep files under 800 lines.
 */

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
