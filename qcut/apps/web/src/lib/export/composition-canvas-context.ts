// Readback hints affect crop/resample rounding; final and intermediate targets must agree.
export const COMPOSITION_CANVAS_CONTEXT_SETTINGS = {
	willReadFrequently: false,
} as const satisfies CanvasRenderingContext2DSettings;
