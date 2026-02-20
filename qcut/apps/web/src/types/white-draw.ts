import type { ReactNode } from "react";

export interface DrawingTool {
	id: string;
	name: string;
	description: string;
	cursor: string;
	category: "select" | "brush" | "shape" | "text" | "effect";
	shortcut?: string;
	disabled?: boolean;
}

export interface ToolSettings {
	brushSize?: { min: number; max: number; default: number };
	opacity?: { min: number; max: number; default: number };
	color?: boolean;
	hasPreview?: boolean;
}

export interface DrawingToolConfig extends DrawingTool {
	icon: ReactNode;
	settings: ToolSettings;
}

export interface DrawingLayer {
	id: string;
	data: string; // Canvas data URL
	visible: boolean;
	opacity: number;
}

export interface WhiteDrawStore {
	// UI State
	activeTab: "canvas" | "tools" | "files";
	isProcessing: boolean;

	// Drawing State
	isDrawing: boolean;
	currentTool: DrawingToolConfig;
	brushSize: number;
	color: string;
	opacity: number;
	layers: DrawingLayer[];
	history: string[];
	historyIndex: number;
	drawings: Array<{ id: string; name: string; data: string; created: Date }>;

	// Actions
	setActiveTab: (tab: "canvas" | "tools" | "files") => void;
	setDrawing: (drawing: boolean) => void;
	setTool: (tool: DrawingToolConfig) => void;
	setBrushSize: (size: number) => void;
	setColor: (color: string) => void;
	setOpacity: (opacity: number) => void;
	addLayer: () => void;
	saveToHistory: (state: string) => void;
	undo: () => void;
	redo: () => void;
	getCurrentHistoryState: () => string | undefined;
	clear: () => void;
	setProcessing: (processing: boolean) => void;
}

// Tool categories for organization
export type ToolCategory = {
	id: string;
	name: string;
	tools: DrawingToolConfig[];
};
