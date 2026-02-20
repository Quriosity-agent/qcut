import {
	Brush,
	Eraser,
	Minus,
	Square,
	Circle,
	Type,
	Highlighter,
	Blend,
	Pencil,
	MousePointer,
} from "lucide-react";
import type { DrawingToolConfig, ToolCategory } from "@/types/white-draw";

// Individual tool configurations with comprehensive settings
export const SELECT_TOOL: DrawingToolConfig = {
	id: "select",
	name: "Select",
	description: "Select and move objects on the canvas",
	icon: (
		<MousePointer size={16}>
			<title>Select</title>
		</MousePointer>
	),
	cursor: "default",
	category: "select",
	shortcut: "S",
	settings: {},
};

export const BRUSH_TOOL: DrawingToolConfig = {
	id: "brush",
	name: "Brush",
	description: "Freehand drawing with pressure sensitivity",
	icon: (
		<Brush size={16}>
			<title>Brush</title>
		</Brush>
	),
	cursor: "crosshair",
	category: "brush",
	shortcut: "B",
	settings: {
		brushSize: { min: 1, max: 100, default: 10 },
		opacity: { min: 0.1, max: 1, default: 1 },
		color: true,
		hasPreview: true,
	},
};

export const PENCIL_TOOL: DrawingToolConfig = {
	id: "pencil",
	name: "Pencil",
	description: "Precise drawing with harder edges",
	icon: (
		<Pencil size={16}>
			<title>Pencil</title>
		</Pencil>
	),
	cursor: "crosshair",
	category: "brush",
	shortcut: "P",
	settings: {
		brushSize: { min: 1, max: 50, default: 3 },
		opacity: { min: 0.1, max: 1, default: 0.8 },
		color: true,
		hasPreview: true,
	},
};

export const ERASER_TOOL: DrawingToolConfig = {
	id: "eraser",
	name: "Eraser",
	description: "Remove parts of the drawing",
	icon: (
		<Eraser size={16}>
			<title>Eraser</title>
		</Eraser>
	),
	cursor: "crosshair",
	category: "brush",
	shortcut: "E",
	settings: {
		brushSize: { min: 5, max: 100, default: 20 },
		opacity: { min: 0.1, max: 1, default: 1 },
	},
};

export const HIGHLIGHTER_TOOL: DrawingToolConfig = {
	id: "highlighter",
	name: "Highlighter",
	description: "Semi-transparent highlighting",
	icon: (
		<Highlighter size={16}>
			<title>Highlighter</title>
		</Highlighter>
	),
	cursor: "crosshair",
	category: "brush",
	shortcut: "H",
	settings: {
		brushSize: { min: 10, max: 50, default: 20 },
		opacity: { min: 0.2, max: 0.6, default: 0.4 },
		color: true,
	},
};

export const LINE_TOOL: DrawingToolConfig = {
	id: "line",
	name: "Line",
	description: "Draw straight lines",
	icon: (
		<Minus size={16}>
			<title>Line</title>
		</Minus>
	),
	cursor: "crosshair",
	category: "shape",
	shortcut: "L",
	settings: {
		brushSize: { min: 1, max: 20, default: 2 },
		color: true,
		hasPreview: true,
	},
};

export const RECTANGLE_TOOL: DrawingToolConfig = {
	id: "rectangle",
	name: "Rectangle",
	description: "Draw rectangles and squares",
	icon: (
		<Square size={16}>
			<title>Rectangle</title>
		</Square>
	),
	cursor: "crosshair",
	category: "shape",
	shortcut: "R",
	settings: {
		brushSize: { min: 1, max: 20, default: 2 },
		color: true,
		hasPreview: true,
	},
};

export const CIRCLE_TOOL: DrawingToolConfig = {
	id: "circle",
	name: "Circle",
	description: "Draw circles and ellipses",
	icon: (
		<Circle size={16}>
			<title>Circle</title>
		</Circle>
	),
	cursor: "crosshair",
	category: "shape",
	shortcut: "C",
	settings: {
		brushSize: { min: 1, max: 20, default: 2 },
		color: true,
		hasPreview: true,
	},
};

export const TEXT_TOOL: DrawingToolConfig = {
	id: "text",
	name: "Text",
	description: "Add text annotations",
	icon: (
		<Type size={16}>
			<title>Text</title>
		</Type>
	),
	cursor: "text",
	category: "text",
	shortcut: "T",
	settings: {
		brushSize: { min: 8, max: 72, default: 16 }, // Font size
		color: true,
	},
};

export const BLUR_TOOL: DrawingToolConfig = {
	id: "blur",
	name: "Blur",
	description: "Apply blur effect",
	icon: (
		<Blend size={16}>
			<title>Blur</title>
		</Blend>
	),
	cursor: "crosshair",
	category: "effect",
	shortcut: "U",
	settings: {
		brushSize: { min: 10, max: 100, default: 30 },
		opacity: { min: 0.1, max: 1, default: 0.5 },
	},
};

// Organized tool categories for UI
export const TOOL_CATEGORIES: ToolCategory[] = [
	{
		id: "select",
		name: "Selection",
		tools: [SELECT_TOOL],
	},
	{
		id: "brush",
		name: "Brushes",
		tools: [BRUSH_TOOL, PENCIL_TOOL, ERASER_TOOL, HIGHLIGHTER_TOOL],
	},
	{
		id: "shape",
		name: "Shapes",
		tools: [LINE_TOOL, RECTANGLE_TOOL, CIRCLE_TOOL],
	},
	{
		id: "text",
		name: "Text",
		tools: [TEXT_TOOL],
	},
	{
		id: "effect",
		name: "Effects",
		tools: [BLUR_TOOL],
	},
];

// Flat array of all tools for easy access
export const ALL_DRAWING_TOOLS: DrawingToolConfig[] = TOOL_CATEGORIES.flatMap(
	(category) => category.tools
);

// Quick lookup map for tools by ID
export const TOOL_MAP = new Map<string, DrawingToolConfig>(
	ALL_DRAWING_TOOLS.map((tool) => [tool.id, tool])
);

// Default tool
export const DEFAULT_TOOL = SELECT_TOOL;

// Tool keyboard shortcuts map
export const TOOL_SHORTCUTS = new Map<string, string>(
	ALL_DRAWING_TOOLS.filter((tool) => tool.shortcut).map((tool) => [
		tool.shortcut!,
		tool.id,
	])
);

// Helper functions
export const getToolById = (id: string): DrawingToolConfig | undefined => {
	return TOOL_MAP.get(id);
};

export const getToolsByCategory = (category: string): DrawingToolConfig[] => {
	return TOOL_CATEGORIES.find((cat) => cat.id === category)?.tools || [];
};

export const getToolByShortcut = (
	shortcut: string
): DrawingToolConfig | undefined => {
	const toolId = TOOL_SHORTCUTS.get(shortcut.toUpperCase());
	return toolId ? getToolById(toolId) : undefined;
};

// Validation helpers
export const isValidToolId = (id: string): boolean => {
	return TOOL_MAP.has(id);
};

export const getDefaultSettingsForTool = (toolId: string) => {
	const tool = getToolById(toolId);
	if (!tool) return {};

	return {
		brushSize: tool.settings.brushSize?.default || 10,
		opacity: tool.settings.opacity?.default || 1,
		color: "#000000", // Default color
	};
};
