/**
 * Frame Compositor
 *
 * Merges QCut canvas with pre-rendered Remotion frames.
 * Handles layer ordering, blending modes, and transformations.
 *
 * @module lib/remotion/compositor
 */

import type { TimelineElement, RemotionElement } from "@/types/timeline";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported blend modes for compositing
 */
export type BlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion";

/**
 * Transform properties for a layer
 */
export interface LayerTransform {
	/** X position offset */
	x: number;
	/** Y position offset */
	y: number;
	/** Scale factor (1 = 100%) */
	scale: number;
	/** Rotation in degrees */
	rotation: number;
	/** Anchor point X (0-1, relative to layer) */
	anchorX?: number;
	/** Anchor point Y (0-1, relative to layer) */
	anchorY?: number;
}

/**
 * A single layer in the composite
 */
export interface CompositeLayer {
	/** Stack order (higher = on top) */
	zIndex: number;
	/** Source type */
	source: "qcut" | "remotion";
	/** Element ID */
	elementId: string;
	/** Blend mode */
	blendMode: BlendMode;
	/** Layer opacity (0-1) */
	opacity: number;
	/** Transform properties */
	transform?: LayerTransform;
	/** Optional mask */
	mask?: ImageData;
	/** Whether layer is visible */
	visible: boolean;
}

/**
 * Result of compositing a frame
 */
export interface CompositeResult {
	/** Output image data */
	imageData: ImageData;
	/** Width of output */
	width: number;
	/** Height of output */
	height: number;
	/** Layers that were composited */
	layerCount: number;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_TRANSFORM: LayerTransform = {
	x: 0,
	y: 0,
	scale: 1,
	rotation: 0,
	anchorX: 0.5,
	anchorY: 0.5,
};

// ============================================================================
// Compositor Class
// ============================================================================

/**
 * Handles compositing of multiple layers into a single frame
 */
export class FrameCompositor {
	private outputCanvas: HTMLCanvasElement;
	private outputCtx: CanvasRenderingContext2D | null;
	private tempCanvas: HTMLCanvasElement;
	private tempCtx: CanvasRenderingContext2D | null;
	private width: number;
	private height: number;

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;

		// Create output canvas
		this.outputCanvas = document.createElement("canvas");
		this.outputCanvas.width = width;
		this.outputCanvas.height = height;
		this.outputCtx = this.outputCanvas.getContext("2d", {
			willReadFrequently: true,
		});

		// Create temp canvas for transformations
		this.tempCanvas = document.createElement("canvas");
		this.tempCanvas.width = width;
		this.tempCanvas.height = height;
		this.tempCtx = this.tempCanvas.getContext("2d");
	}

	/**
	 * Check if canvas context is available
	 */
	isAvailable(): boolean {
		return this.outputCtx !== null && this.tempCtx !== null;
	}

	/**
	 * Composite multiple layers into a single frame
	 */
	compositeFrame(
		qcutCanvas: HTMLCanvasElement | ImageBitmap | null,
		remotionFrames: Map<string, ImageBitmap | HTMLImageElement | string>,
		layers: CompositeLayer[]
	): CompositeResult {
		// Check if context is available
		if (!this.outputCtx) {
			// Return empty result when context not available (e.g., in test environment)
			const emptyData =
				typeof ImageData !== "undefined"
					? new ImageData(this.width, this.height)
					: ({
							data: new Uint8ClampedArray(this.width * this.height * 4),
							width: this.width,
							height: this.height,
						} as ImageData);
			return {
				imageData: emptyData,
				width: this.width,
				height: this.height,
				layerCount: 0,
			};
		}

		// Clear output canvas
		this.outputCtx.clearRect(0, 0, this.width, this.height);

		// Sort layers by z-index
		const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

		let layerCount = 0;

		for (const layer of sortedLayers) {
			if (!layer.visible) continue;

			// Get source image
			let source: CanvasImageSource | null = null;

			if (layer.source === "qcut" && qcutCanvas) {
				source = qcutCanvas;
			} else if (layer.source === "remotion") {
				const frame = remotionFrames.get(layer.elementId);
				if (frame) {
					source = typeof frame === "string" ? null : frame;
					// Handle data URL strings by loading them
					if (typeof frame === "string") {
						// Skip data URLs for now - would need async loading
						continue;
					}
				}
			}

			if (!source) continue;

			// Apply layer
			this.applyLayer(source, layer);
			layerCount++;
		}

		return {
			imageData: this.outputCtx.getImageData(0, 0, this.width, this.height),
			width: this.width,
			height: this.height,
			layerCount,
		};
	}

	/**
	 * Apply a single layer to the output canvas
	 */
	private applyLayer(source: CanvasImageSource, layer: CompositeLayer): void {
		if (!this.outputCtx) return;

		const transform = layer.transform || DEFAULT_TRANSFORM;

		// Save state
		this.outputCtx.save();

		// Apply opacity
		this.outputCtx.globalAlpha = layer.opacity;

		// Apply blend mode
		this.outputCtx.globalCompositeOperation = this.getCompositeOperation(
			layer.blendMode
		);

		// Apply transform
		if (
			transform.x !== 0 ||
			transform.y !== 0 ||
			transform.scale !== 1 ||
			transform.rotation !== 0
		) {
			const anchorX = (transform.anchorX ?? 0.5) * this.width;
			const anchorY = (transform.anchorY ?? 0.5) * this.height;

			this.outputCtx.translate(anchorX + transform.x, anchorY + transform.y);
			this.outputCtx.rotate((transform.rotation * Math.PI) / 180);
			this.outputCtx.scale(transform.scale, transform.scale);
			this.outputCtx.translate(-anchorX, -anchorY);
		}

		// Apply mask if present
		if (layer.mask) {
			this.applyMask(layer.mask);
		}

		// Draw source
		this.outputCtx.drawImage(source, 0, 0, this.width, this.height);

		// Restore state
		this.outputCtx.restore();
	}

	/**
	 * Apply a mask to the context
	 */
	private applyMask(mask: ImageData): void {
		if (!this.outputCtx || !this.tempCtx) return;

		// Create mask canvas
		this.tempCtx.clearRect(0, 0, this.width, this.height);
		this.tempCtx.putImageData(mask, 0, 0);

		// Use destination-in to apply mask
		this.outputCtx.globalCompositeOperation = "destination-in";
		this.outputCtx.drawImage(this.tempCanvas, 0, 0);
		this.outputCtx.globalCompositeOperation = "source-over";
	}

	/**
	 * Convert blend mode to canvas composite operation
	 */
	private getCompositeOperation(
		blendMode: BlendMode
	): GlobalCompositeOperation {
		const modeMap: Record<BlendMode, GlobalCompositeOperation> = {
			normal: "source-over",
			multiply: "multiply",
			screen: "screen",
			overlay: "overlay",
			darken: "darken",
			lighten: "lighten",
			"color-dodge": "color-dodge",
			"color-burn": "color-burn",
			"hard-light": "hard-light",
			"soft-light": "soft-light",
			difference: "difference",
			exclusion: "exclusion",
		};

		return modeMap[blendMode] || "source-over";
	}

	/**
	 * Get the output canvas
	 */
	getOutputCanvas(): HTMLCanvasElement {
		return this.outputCanvas;
	}

	/**
	 * Get the output as a data URL
	 */
	toDataURL(format: "png" | "jpeg" = "png", quality = 0.92): string {
		return this.outputCanvas.toDataURL(
			format === "png" ? "image/png" : "image/jpeg",
			quality
		);
	}

	/**
	 * Get the output as a Blob
	 */
	async toBlob(format: "png" | "jpeg" = "png", quality = 0.92): Promise<Blob> {
		return new Promise((resolve, reject) => {
			this.outputCanvas.toBlob(
				(blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error("Failed to create blob"));
					}
				},
				format === "png" ? "image/png" : "image/jpeg",
				quality
			);
		});
	}

	/**
	 * Resize the compositor output
	 */
	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		this.outputCanvas.width = width;
		this.outputCanvas.height = height;
		this.tempCanvas.width = width;
		this.tempCanvas.height = height;
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.outputCtx?.clearRect(0, 0, this.width, this.height);
		this.tempCtx?.clearRect(0, 0, this.width, this.height);
	}
}

// ============================================================================
// Layer Computation
// ============================================================================

/**
 * Compute the layer order for a given frame based on timeline elements
 */
export function computeLayerOrder(
	elements: TimelineElement[],
	tracks: { id: string; elements: TimelineElement[] }[],
	frame: number,
	fps: number
): CompositeLayer[] {
	const layers: CompositeLayer[] = [];
	const currentTime = frame / fps;

	// Process tracks from bottom to top (first track = lowest z-index)
	for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
		const track = tracks[trackIndex];

		for (const element of track.elements) {
			// Check if element is visible at current time
			const elementStart = element.startTime + element.trimStart;
			const elementEnd = element.startTime + element.duration - element.trimEnd;

			if (currentTime < elementStart || currentTime >= elementEnd) {
				continue;
			}

			// Create layer for this element
			const layer: CompositeLayer = {
				zIndex: trackIndex * 100 + track.elements.indexOf(element),
				source: element.type === "remotion" ? "remotion" : "qcut",
				elementId: element.id,
				blendMode: "normal",
				opacity: getElementOpacity(element),
				transform: getElementTransform(element),
				visible: !element.hidden,
			};

			layers.push(layer);
		}
	}

	return layers;
}

/**
 * Get opacity from an element
 */
function getElementOpacity(element: TimelineElement): number {
	if (element.type === "text") {
		return element.opacity ?? 1;
	}
	if (element.type === "remotion") {
		return (element as RemotionElement).opacity ?? 1;
	}
	return 1;
}

/**
 * Get transform from an element
 */
function getElementTransform(element: TimelineElement): LayerTransform {
	const transform = { ...DEFAULT_TRANSFORM };

	if (element.x !== undefined) transform.x = element.x;
	if (element.y !== undefined) transform.y = element.y;
	if (element.rotation !== undefined) transform.rotation = element.rotation;

	if (element.type === "remotion") {
		const remotionElement = element as RemotionElement;
		if (remotionElement.scale !== undefined) {
			transform.scale = remotionElement.scale;
		}
	}

	return transform;
}

/**
 * Filter elements that are Remotion type and visible at current time
 */
export function getVisibleRemotionElements(
	elements: TimelineElement[],
	currentTime: number
): RemotionElement[] {
	return elements.filter((element): element is RemotionElement => {
		if (element.type !== "remotion") return false;
		if (element.hidden) return false;

		const elementStart = element.startTime + element.trimStart;
		const elementEnd = element.startTime + element.duration - element.trimEnd;

		return currentTime >= elementStart && currentTime < elementEnd;
	});
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a compositor instance
 */
export function createCompositor(
	width: number,
	height: number
): FrameCompositor {
	return new FrameCompositor(width, height);
}
