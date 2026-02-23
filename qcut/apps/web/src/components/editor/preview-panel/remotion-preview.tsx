/**
 * Remotion Preview Component
 *
 * A standalone preview component for Remotion compositions.
 * Can be used to preview Remotion elements from the timeline or
 * to preview components from the component browser.
 *
 * @module components/editor/preview-panel/remotion-preview
 */

import React, {
	useRef,
	useState,
	useCallback,
	useMemo,
	useEffect,
} from "react";
import { Play, Pause, RotateCcw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
	useRemotionStore,
	useRemotionComponent,
	useRemotionInstance,
} from "@/stores/ai/remotion-store";
import {
	RemotionPlayerWrapper,
	RemotionPlayerLoading,
	RemotionPlayerError,
	type RemotionPlayerHandle,
} from "@/lib/remotion/player-wrapper";
import type { RemotionComponentDefinition } from "@/lib/remotion/types";
import { debugLog } from "@/lib/debug/debug-config";

// ============================================================================
// Types
// ============================================================================

export interface RemotionPreviewProps {
	/** ID of the component to preview */
	componentId?: string;
	/** ID of the timeline element (for element-specific preview) */
	elementId?: string;
	/** Props to pass to the component (overrides element props) */
	inputProps?: Record<string, unknown>;
	/** Whether to show playback controls */
	showControls?: boolean;
	/** Whether to auto-play on mount */
	autoPlay?: boolean;
	/** Whether to loop playback */
	loop?: boolean;
	/** Width of the preview (defaults to component width scaled to fit) */
	width?: number;
	/** Height of the preview (defaults to component height scaled to fit) */
	height?: number;
	/** Maximum width constraint */
	maxWidth?: number;
	/** Maximum height constraint */
	maxHeight?: number;
	/** External frame control from timeline (overrides internal state) */
	externalFrame?: number;
	/** External playing state from timeline (overrides internal state) */
	externalIsPlaying?: boolean;
	/** Callback when frame changes */
	onFrameChange?: (frame: number) => void;
	/** Callback when playback state changes */
	onPlayStateChange?: (isPlaying: boolean) => void;
	/** Additional className */
	className?: string;
	/** Additional styles */
	style?: React.CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * RemotionPreview - Preview a Remotion component or timeline element
 *
 * This component provides a complete preview experience including:
 * - Playback controls (play/pause, seek)
 * - Frame counter
 * - Error handling
 * - Loading states
 */
export function RemotionPreview({
	componentId,
	elementId,
	inputProps,
	showControls = true,
	autoPlay = false,
	loop = true,
	width,
	height,
	maxWidth = 640,
	maxHeight = 360,
	externalFrame,
	externalIsPlaying,
	onFrameChange,
	onPlayStateChange,
	className,
	style,
}: RemotionPreviewProps) {
	// Refs
	const playerRef = useRef<RemotionPlayerHandle>(null);

	// Local state (used when no external control)
	const [internalIsPlaying, setInternalIsPlaying] = useState(autoPlay);
	const [internalFrame, setInternalFrame] = useState(0);

	// Use external values when provided, otherwise use internal state
	const isPlaying =
		externalIsPlaying !== undefined ? externalIsPlaying : internalIsPlaying;
	const currentFrame =
		externalFrame !== undefined ? externalFrame : internalFrame;
	const [isReady, setIsReady] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Get component from store
	const component = useRemotionComponent(componentId ?? "");
	const instance = useRemotionInstance(elementId ?? "");

	// Debug: Log on mount/componentId change
	useEffect(() => {
		debugLog("[REMOTION] RemotionPreview mounted", {
			componentId,
			elementId,
			component: component?.id,
			instance: instance?.elementId,
		});
	}, [componentId, elementId, component?.id, instance?.elementId]);

	// Determine the effective component and props
	const effectiveComponent = useMemo(() => {
		if (component) {
			return component;
		}

		if (instance) {
			const comp = useRemotionStore
				.getState()
				.registeredComponents.get(instance.componentId);
			return comp;
		}

		return;
	}, [component, instance]);

	// Debug: Log effective component resolution
	useEffect(() => {
		debugLog("[REMOTION] Effective component resolved", {
			found: !!effectiveComponent,
			componentId: effectiveComponent?.id,
		});
	}, [effectiveComponent?.id, effectiveComponent]);

	const effectiveProps = useMemo(() => {
		if (inputProps) return inputProps;
		if (instance) return instance.props;
		if (effectiveComponent) return effectiveComponent.defaultProps;
		return {};
	}, [inputProps, instance, effectiveComponent]);

	// Calculate preview dimensions maintaining aspect ratio
	const previewDimensions = useMemo(() => {
		if (!effectiveComponent) {
			return { width: maxWidth || 640, height: maxHeight || 360 };
		}

		// Use || instead of ?? to handle 0 values properly
		const componentWidth =
			width && width > 0 ? width : effectiveComponent.width;
		const componentHeight =
			height && height > 0 ? height : effectiveComponent.height;
		const effectiveMaxWidth = maxWidth && maxWidth > 0 ? maxWidth : 640;
		const effectiveMaxHeight = maxHeight && maxHeight > 0 ? maxHeight : 360;
		const aspectRatio = componentWidth / componentHeight;

		let previewWidth = componentWidth;
		let previewHeight = componentHeight;

		// Scale down to fit within max bounds
		if (previewWidth > effectiveMaxWidth) {
			previewWidth = effectiveMaxWidth;
			previewHeight = previewWidth / aspectRatio;
		}

		if (previewHeight > effectiveMaxHeight) {
			previewHeight = effectiveMaxHeight;
			previewWidth = previewHeight * aspectRatio;
		}

		return {
			width: Math.round(previewWidth),
			height: Math.round(previewHeight),
		};
	}, [effectiveComponent, width, height, maxWidth, maxHeight]);

	// ========================================================================
	// Handlers
	// ========================================================================

	const handlePlayPause = useCallback(() => {
		if (playerRef.current) {
			playerRef.current.toggle();
			const newPlayState = !isPlaying;
			setInternalIsPlaying(newPlayState);
			onPlayStateChange?.(newPlayState);
		}
	}, [isPlaying, onPlayStateChange]);

	const handleSeek = useCallback(
		(value: number[]) => {
			const frame = Math.round(value[0]);
			setInternalFrame(frame);
			playerRef.current?.seekTo(frame);
			onFrameChange?.(frame);
		},
		[onFrameChange]
	);

	const handleReset = useCallback(() => {
		setInternalFrame(0);
		playerRef.current?.seekTo(0);
		playerRef.current?.pause();
		setInternalIsPlaying(false);
		onFrameChange?.(0);
		onPlayStateChange?.(false);
	}, [onFrameChange, onPlayStateChange]);

	const handleFrameUpdate = useCallback(
		(frame: number) => {
			// Only update internal state if not externally controlled
			if (externalFrame === undefined) {
				setInternalFrame(frame);
			}
			onFrameChange?.(frame);
		},
		[onFrameChange, externalFrame]
	);

	const handleReady = useCallback(() => {
		setIsReady(true);
		setError(null);
	}, []);

	const handleError = useCallback((err: Error) => {
		setError(err);
		setIsReady(false);
	}, []);

	const handleRetry = useCallback(() => {
		setError(null);
		setIsReady(false);
	}, []);

	// Auto-play effect (only when not externally controlled)
	useEffect(() => {
		if (
			externalIsPlaying === undefined &&
			autoPlay &&
			isReady &&
			playerRef.current
		) {
			playerRef.current.play();
			setInternalIsPlaying(true);
		}
	}, [autoPlay, isReady, externalIsPlaying]);

	// Debug: Log render state changes
	useEffect(() => {
		debugLog("[REMOTION] Render state changed", {
			effectiveComponent: effectiveComponent?.id,
			isReady,
			error: error?.message,
		});
	}, [effectiveComponent?.id, isReady, error]);

	// ========================================================================
	// Render
	// ========================================================================

	// No component available
	if (!effectiveComponent) {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center bg-muted/50 rounded-lg border border-dashed",
					className
				)}
				style={{
					width: previewDimensions.width,
					height: previewDimensions.height,
					...style,
				}}
			>
				<AlertCircle className="w-8 h-8 text-muted-foreground mb-2" />
				<p className="text-sm text-muted-foreground">No component selected</p>
				<p className="text-xs text-muted-foreground mt-1">
					Select a Remotion component to preview
				</p>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className={cn("flex flex-col", className)} style={style}>
				<RemotionPlayerError
					width={previewDimensions.width}
					height={previewDimensions.height}
					error={error}
					onRetry={handleRetry}
				/>
			</div>
		);
	}

	// Loading state
	if (!isReady && !error) {
		return (
			<div className={cn("flex flex-col", className)} style={style}>
				<div
					className="relative"
					style={{
						width: previewDimensions.width,
						height: previewDimensions.height,
					}}
				>
					<RemotionPlayerLoading
						width={previewDimensions.width}
						height={previewDimensions.height}
					/>
					{/* Hidden player for loading */}
					<div className="absolute inset-0 opacity-0 pointer-events-none">
						<RemotionPlayerWrapper
							ref={playerRef}
							elementId={elementId ?? `preview-${effectiveComponent.id}`}
							component={effectiveComponent}
							inputProps={effectiveProps}
							width={previewDimensions.width}
							height={previewDimensions.height}
							loop={loop}
							onReady={handleReady}
							onError={handleError}
							onFrameUpdate={handleFrameUpdate}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col", className)} style={style}>
			{/* Preview area */}
			<div
				className="relative bg-black rounded-t-lg overflow-hidden"
				style={{
					width: previewDimensions.width,
					height: previewDimensions.height,
				}}
				data-testid="remotion-player"
				data-component-id={effectiveComponent.id}
				data-frame={currentFrame}
			>
				<RemotionPlayerWrapper
					ref={playerRef}
					elementId={elementId ?? `preview-${effectiveComponent.id}`}
					component={effectiveComponent}
					inputProps={effectiveProps}
					currentFrame={currentFrame}
					isPlaying={isPlaying}
					width={previewDimensions.width}
					height={previewDimensions.height}
					loop={loop}
					onFrameUpdate={handleFrameUpdate}
					onError={handleError}
				/>
				{/* Debug overlay showing current frame */}
				{import.meta.env.DEV && (
					<div
						className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-1 rounded pointer-events-none"
						style={{ zIndex: 100 }}
					>
						Frame: {currentFrame} | {effectiveComponent.id}
					</div>
				)}
			</div>

			{/* Controls */}
			{showControls && (
				<div
					className="flex items-center gap-2 p-2 bg-background/95 border border-t-0 rounded-b-lg"
					style={{ width: previewDimensions.width }}
				>
					{/* Play/Pause button */}
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={handlePlayPause}
						aria-label={isPlaying ? "Pause" : "Play"}
					>
						{isPlaying ? (
							<Pause className="h-4 w-4" />
						) : (
							<Play className="h-4 w-4" />
						)}
					</Button>

					{/* Reset button */}
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={handleReset}
						aria-label="Reset"
					>
						<RotateCcw className="h-4 w-4" />
					</Button>

					{/* Seek slider */}
					<div className="flex-1 px-2">
						<Slider
							value={[currentFrame]}
							min={0}
							max={effectiveComponent.durationInFrames - 1}
							step={1}
							onValueChange={handleSeek}
							className="cursor-pointer"
						/>
					</div>

					{/* Frame counter */}
					<div className="text-xs text-muted-foreground font-mono min-w-[80px] text-right">
						{currentFrame} / {effectiveComponent.durationInFrames}
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Standalone Preview Modal
// ============================================================================

export interface RemotionPreviewModalProps {
	/** Whether the modal is open */
	isOpen: boolean;
	/** Callback when modal closes */
	onClose: () => void;
	/** Component to preview */
	component: RemotionComponentDefinition;
	/** Props to use for preview */
	inputProps?: Record<string, unknown>;
}

/**
 * RemotionPreviewModal - Full-screen preview modal for a component
 */
export function RemotionPreviewModal({
	isOpen,
	onClose,
	component,
	inputProps,
}: RemotionPreviewModalProps) {
	// Handle escape key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};

		if (isOpen) {
			document.addEventListener("keydown", handleKeyDown);
			document.body.style.overflow = "hidden";
		}

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = "";
		};
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label={`Preview ${component.name}`}
		>
			<div
				className="relative max-w-4xl max-h-[90vh] flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-3 bg-background rounded-t-lg">
					<div>
						<h3 className="font-medium">{component.name}</h3>
						{component.description && (
							<p className="text-xs text-muted-foreground">
								{component.description}
							</p>
						)}
					</div>
					<Button variant="outline" size="sm" onClick={onClose}>
						Close
					</Button>
				</div>

				{/* Preview */}
				<RemotionPreview
					componentId={component.id}
					inputProps={inputProps ?? component.defaultProps}
					showControls={true}
					autoPlay={true}
					loop={true}
					maxWidth={800}
					maxHeight={600}
					className="rounded-t-none"
				/>

				{/* Info footer */}
				<div className="flex items-center justify-between p-2 bg-muted/50 rounded-b-lg text-xs text-muted-foreground">
					<span>
						{component.width}x{component.height} @ {component.fps}fps
					</span>
					<span>
						{component.durationInFrames} frames (
						{(component.durationInFrames / component.fps).toFixed(1)}s)
					</span>
				</div>
			</div>
		</div>
	);
}

export default RemotionPreview;
