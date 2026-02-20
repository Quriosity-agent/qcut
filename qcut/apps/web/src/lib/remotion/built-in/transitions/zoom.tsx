/**
 * Zoom Transition Component
 *
 * A transition that zooms in or out to reveal new content.
 *
 * @module lib/remotion/built-in/transitions/zoom
 */

import React from "react";
import {
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Easing,
	AbsoluteFill,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for Zoom transition component props
 */
export const ZoomSchema = z.object({
	/** Zoom direction */
	zoomType: z.enum(["in", "out", "through"]).default("in"),
	/** Background color (content B / incoming) */
	backgroundColor: z.string().default("#000000"),
	/** Foreground color (content A / outgoing) */
	foregroundColor: z.string().default("#ffffff"),
	/** Duration of zoom in frames (uses full duration if not specified) */
	zoomDuration: z.number().min(1).optional(),
	/** Animation type */
	animationType: z.enum(["linear", "easeOut", "spring"]).default("easeOut"),
	/** Start delay in frames */
	startDelay: z.number().min(0).default(0),
	/** Maximum scale for zoom effect */
	maxScale: z.number().min(1).max(10).default(3),
	/** Include fade during zoom */
	includeFade: z.boolean().default(true),
	/** Spring damping (for spring animation) */
	damping: z.number().min(1).max(100).default(15),
	/** Spring stiffness (for spring animation) */
	stiffness: z.number().min(1).max(500).default(100),
	/** Zoom origin point */
	origin: z
		.enum(["center", "top-left", "top-right", "bottom-left", "bottom-right"])
		.default("center"),
});

export type ZoomProps = z.infer<typeof ZoomSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const zoomDefaultProps: ZoomProps = {
	zoomType: "in",
	backgroundColor: "#000000",
	foregroundColor: "#ffffff",
	animationType: "easeOut",
	startDelay: 0,
	maxScale: 3,
	includeFade: true,
	damping: 15,
	stiffness: 100,
	origin: "center",
};

// ============================================================================
// Helper Functions
// ============================================================================

function getOriginStyle(origin: string): string {
	switch (origin) {
		case "center":
			return "center center";
		case "top-left":
			return "top left";
		case "top-right":
			return "top right";
		case "bottom-left":
			return "bottom left";
		case "bottom-right":
			return "bottom right";
		default:
			return "center center";
	}
}

// ============================================================================
// Component
// ============================================================================

/**
 * Zoom transition component
 *
 * Creates a zoom effect to transition between scenes.
 */
export const Zoom: React.FC<Partial<ZoomProps>> = ({
	zoomType = zoomDefaultProps.zoomType,
	backgroundColor = zoomDefaultProps.backgroundColor,
	foregroundColor = zoomDefaultProps.foregroundColor,
	zoomDuration,
	animationType = zoomDefaultProps.animationType,
	startDelay = zoomDefaultProps.startDelay,
	maxScale = zoomDefaultProps.maxScale,
	includeFade = zoomDefaultProps.includeFade,
	damping = zoomDefaultProps.damping,
	stiffness = zoomDefaultProps.stiffness,
	origin = zoomDefaultProps.origin,
}) => {
	const frame = useCurrentFrame();
	const { durationInFrames, fps } = useVideoConfig();

	// Calculate actual zoom duration (ensure at least 1 to avoid zero/negative interpolation)
	const actualDuration =
		zoomDuration ?? Math.max(1, durationInFrames - startDelay);
	const activeFrame = Math.max(0, frame - startDelay);

	// Calculate progress based on animation type
	let progress: number;

	if (animationType === "spring") {
		progress = spring({
			fps,
			frame: activeFrame,
			config: {
				damping,
				stiffness,
				mass: 1,
			},
		});
	} else {
		const easingFn =
			animationType === "linear" ? Easing.linear : Easing.out(Easing.cubic);

		progress = interpolate(activeFrame, [0, actualDuration], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
			easing: easingFn,
		});
	}

	// Calculate scales and opacities based on zoom type
	let foregroundScale: number;
	let foregroundOpacity: number;
	let backgroundScale: number;
	let backgroundOpacity: number;

	switch (zoomType) {
		case "in":
			// Foreground zooms in and fades out
			foregroundScale = interpolate(progress, [0, 1], [1, maxScale]);
			foregroundOpacity = includeFade ? 1 - progress : 1;
			// Background starts at scale 1
			backgroundScale = 1;
			backgroundOpacity = 1;
			break;

		case "out":
			// Foreground zooms out (shrinks) and fades out
			foregroundScale = interpolate(progress, [0, 1], [1, 1 / maxScale]);
			foregroundOpacity = includeFade ? 1 - progress : 1;
			// Background is already there
			backgroundScale = 1;
			backgroundOpacity = 1;
			break;

		case "through":
			// Foreground zooms through (past camera) and background zooms in from small
			foregroundScale = interpolate(progress, [0, 1], [1, maxScale * 2]);
			foregroundOpacity = interpolate(progress, [0, 0.5, 1], [1, 0, 0]);
			backgroundScale = interpolate(
				progress,
				[0, 0.5, 1],
				[1 / maxScale, 1 / maxScale, 1]
			);
			backgroundOpacity = interpolate(progress, [0, 0.3, 1], [0, 1, 1]);
			break;

		default:
			foregroundScale = 1;
			foregroundOpacity = 1;
			backgroundScale = 1;
			backgroundOpacity = 1;
	}

	const transformOrigin = getOriginStyle(origin);

	return (
		<AbsoluteFill>
			{/* Background (Content B / Incoming) */}
			<AbsoluteFill
				style={{
					backgroundColor,
					transform: `scale(${backgroundScale})`,
					transformOrigin,
					opacity: backgroundOpacity,
				}}
			/>

			{/* Foreground (Content A / Outgoing) */}
			<AbsoluteFill
				style={{
					backgroundColor: foregroundColor,
					transform: `scale(${foregroundScale})`,
					transformOrigin,
					opacity: foregroundOpacity,
				}}
			/>
		</AbsoluteFill>
	);
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Zoom transition component definition for QCut
 */
export const ZoomDefinition: RemotionComponentDefinition = {
	id: "built-in-zoom-transition",
	name: "Zoom Transition",
	description: "Zooms in or out to reveal new content",
	category: "transition",
	durationInFrames: 30,
	fps: 30,
	width: 1920,
	height: 1080,
	schema: ZoomSchema,
	defaultProps: zoomDefaultProps,
	component: Zoom as React.ComponentType<Record<string, unknown>>,
	source: "built-in",
	tags: ["transition", "zoom", "scale", "punch"],
	version: "1.0.0",
	author: "QCut",
};

export default Zoom;
