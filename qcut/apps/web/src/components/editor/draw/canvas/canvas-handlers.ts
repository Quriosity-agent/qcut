import { useCallback, type RefObject } from "react";
import type { CanvasObject } from "../hooks/use-canvas-objects";
import {
	handleError,
	ErrorCategory,
	ErrorSeverity,
} from "@/lib/debug/error-handler";

/**
 * Hook providing canvas event handlers: text confirm/cancel,
 * image upload, and drawing load from data URL.
 */
export function useCanvasHandlers({
	canvasRef,
	objects,
	textInputModal,
	setTextInputModal,
	addText,
	addImageObject,
	brushSize,
	color,
	opacity,
	onDrawingChange,
	withObjectCreationProtection,
}: {
	canvasRef: RefObject<HTMLCanvasElement | null>;
	objects: CanvasObject[];
	textInputModal: {
		isOpen: boolean;
		position: { x: number; y: number };
		canvasPosition: { x: number; y: number };
	};
	setTextInputModal: React.Dispatch<
		React.SetStateAction<{
			isOpen: boolean;
			position: { x: number; y: number };
			canvasPosition: { x: number; y: number };
		}>
	>;
	addText: (
		text: string,
		position: { x: number; y: number },
		style: { font: string; fillStyle: string; opacity: number }
	) => string;
	addImageObject: (data: {
		id: string;
		element: HTMLImageElement;
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	}) => void;
	brushSize: number;
	color: string;
	opacity: number;
	onDrawingChange?: (dataUrl: string) => void;
	withObjectCreationProtection: (
		operation: () => any,
		operationType: string
	) => any;
}) {
	// Text input handlers
	const handleTextConfirm = useCallback(
		(text: string) => {
			console.log("📝 TEXT DEBUG - Text input confirmed:", {
				text,
				hasCanvasPosition: !!textInputModal.canvasPosition,
				canvasPosition: textInputModal.canvasPosition,
				currentObjectCount: objects.length,
				timestamp: Date.now(),
			});

			if (textInputModal.canvasPosition && text.trim()) {
				const style = {
					font: `${brushSize}px Arial, sans-serif`,
					fillStyle: color,
					opacity,
				};

				console.log("📝 TEXT DEBUG - Calling addText with style:", style);
				const textId = addText(text, textInputModal.canvasPosition, style);
				console.log("📝 TEXT DEBUG - Text added with ID:", textId);

				if (onDrawingChange && canvasRef.current) {
					console.log("📝 TEXT DEBUG - Triggering onDrawingChange");
					onDrawingChange(canvasRef.current.toDataURL());
				}
			} else {
				console.log(
					"📝 TEXT DEBUG - Text input cancelled - no position or empty text"
				);
			}
			setTextInputModal((prev) => ({ ...prev, isOpen: false }));
		},
		[
			textInputModal.canvasPosition,
			addText,
			brushSize,
			color,
			opacity,
			onDrawingChange,
			objects.length,
		]
	);

	const handleTextCancel = useCallback(() => {
		setTextInputModal((prev) => ({ ...prev, isOpen: false }));
	}, []);

	// Load drawing from data URL (for saved drawings)
	const loadDrawingFromDataUrl = useCallback(
		async (dataUrl: string) => {
			try {
				if (import.meta.env.DEV) {
					console.log("🔄 DRAW DEBUG - loadDrawingFromDataUrl called:", {
						dataUrlLength: dataUrl.length,
						currentObjectCount: objects.length,
					});
				}

				const canvas = canvasRef.current;
				if (!canvas) {
					throw new Error("Canvas not available");
				}

				if (import.meta.env.DEV) {
					console.log(
						"🚫 DRAW DEBUG - loadDrawingFromDataUrl disabled to preserve stroke objects"
					);
				}

				if (onDrawingChange) {
					onDrawingChange(dataUrl);
				}

				return;
			} catch (error) {
				handleError(error, {
					operation: "load drawing",
					category: ErrorCategory.MEDIA_PROCESSING,
					severity: ErrorSeverity.MEDIUM,
				});
			}
		},
		[onDrawingChange, objects.length]
	);

	// Image upload handler
	const handleImageUpload = useCallback(
		async (file: File) => {
			console.log("🖼️ IMAGE DEBUG - Image upload starting:", {
				fileName: file.name,
				fileSize: file.size,
				fileType: file.type,
				currentObjectCount: objects.length,
				timestamp: Date.now(),
			});

			try {
				const canvas = canvasRef.current;
				if (!canvas) {
					console.error("🖼️ IMAGE DEBUG - Canvas not available");
					throw new Error("Canvas not available");
				}

				console.log("🖼️ IMAGE DEBUG - Creating image element and loading file");
				// Create image element and load the file
				const img = new Image();
				await new Promise<void>((resolve, reject) => {
					img.onload = () => {
						console.log("🖼️ IMAGE DEBUG - Image loaded successfully:", {
							imageWidth: img.width,
							imageHeight: img.height,
						});
						resolve();
					};
					img.onerror = () => {
						console.error("🖼️ IMAGE DEBUG - Failed to load image");
						reject(new Error("Failed to load image"));
					};
					img.src = URL.createObjectURL(file);
				});

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

				console.log("🖼️ IMAGE DEBUG - Calculated image dimensions:", {
					originalSize: { width: img.width, height: img.height },
					scaledSize: { width, height },
					canvasSize: { width: canvas.width, height: canvas.height },
				});

				// Create image object with protection
				const result = withObjectCreationProtection(() => {
					const imageData = {
						id: `image-${Date.now()}`,
						element: img,
						x: 20, // Top-left positioning with 20px padding
						y: 20, // Top-left positioning with 20px padding
						width,
						height,
						rotation: 0,
					};

					console.log("🖼️ IMAGE DEBUG - Creating image object:", imageData);
					addImageObject(imageData);
					console.log("🖼️ IMAGE DEBUG - Image object added to store");

					if (onDrawingChange && canvasRef.current) {
						console.log("🖼️ IMAGE DEBUG - Triggering onDrawingChange");
						onDrawingChange(canvasRef.current.toDataURL());
					}

					console.log("🖼️ IMAGE DEBUG - Image upload completed:", {
						imageId: imageData.id,
						newObjectCount: objects.length + 1,
						timestamp: Date.now(),
					});

					return imageData.id;
				}, "image");

				return result;
			} catch (error) {
				console.error("🖼️ IMAGE DEBUG - Image upload error:", error);
				handleError(error, {
					operation: "image upload",
					category: ErrorCategory.MEDIA_PROCESSING,
					severity: ErrorSeverity.MEDIUM,
				});
			}
		},
		[
			addImageObject,
			onDrawingChange,
			withObjectCreationProtection,
			objects.length,
		]
	);

	return {
		handleTextConfirm,
		handleTextCancel,
		loadDrawingFromDataUrl,
		handleImageUpload,
	};
}
