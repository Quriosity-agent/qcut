import { useRef, useState, useEffect } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEffectsStore } from "@/stores/effects-store";
import { toast } from "sonner";
import type {
	TimelineTrack,
	TimelineElement as TimelineElementType,
} from "@/types/timeline";

interface EffectsTimelineProps {
	tracks: TimelineTrack[];
	pixelsPerSecond: number;
}

// Standard track height from timeline constants
const TRACK_HEIGHT = 64;

export function EffectsTimeline({
	tracks,
	pixelsPerSecond,
}: EffectsTimelineProps) {
	const { getElementEffects } = useEffectsStore();
	const [hoveredEffect, setHoveredEffect] = useState<{
		id: string;
		name: string;
	} | null>(null);

	// Render effect visualization bars for each element
	const renderEffectBars = (element: TimelineElementType) => {
		const effects = getElementEffects(element.id);

		if (!effects || effects.length === 0) return null;

		return effects.map((effect, index) => {
			if (!effect.enabled) return null;

			const barHeight = 4;
			const barOffset = index * (barHeight + 1);

			return (
				<div
					key={effect.id}
					className="absolute transition-opacity hover:opacity-100"
					style={{
						left: `${element.startTime * pixelsPerSecond}px`,
						width: `${element.duration * pixelsPerSecond}px`,
						bottom: `${barOffset}px`,
						height: `${barHeight}px`,
						backgroundColor: getEffectColor(effect.effectType),
						opacity: hoveredEffect?.id === effect.id ? 1 : 0.7,
					}}
					onMouseEnter={() =>
						setHoveredEffect({ id: effect.id, name: effect.name })
					}
					onMouseLeave={() => setHoveredEffect(null)}
					title={`${effect.name} Effect`}
				/>
			);
		});
	};

	// Get color for different effect types
	const getEffectColor = (effectType: string): string => {
		const colorMap: Record<string, string> = {
			brightness: "#fbbf24", // amber-400
			contrast: "#f97316", // orange-500
			saturation: "#ec4899", // pink-500
			blur: "#3b82f6", // blue-500
			sepia: "#a78bfa", // violet-400
			grayscale: "#6b7280", // gray-500
			vintage: "#f59e0b", // amber-500
			dramatic: "#dc2626", // red-600
			warm: "#ef4444", // red-500
			cool: "#06b6d4", // cyan-500
			cinematic: "#8b5cf6", // violet-500
			vignette: "#1f2937", // gray-800
			grain: "#d97706", // amber-600
			sharpen: "#10b981", // emerald-500
			emboss: "#84cc16", // lime-500
			edge: "#14b8a6", // teal-500
			pixelate: "#a855f7", // purple-500
			invert: "#e11d48", // rose-600
		};

		return colorMap[effectType] || "#9333ea"; // purple-600 as default
	};

	return (
		<div
			className="relative hover:bg-accent/5"
			style={{ height: `${TRACK_HEIGHT}px` }}
		>
			{/* Effect visualization bars for all elements from all tracks */}
			{tracks
				.flatMap((track) => track.elements)
				.map((element) => (
					<div key={element.id}>{renderEffectBars(element)}</div>
				))}

			{/* Hover tooltip */}
			{hoveredEffect && (
				<div className="absolute top-0 right-2 text-xs text-muted-foreground">
					{hoveredEffect.name}
				</div>
			)}
		</div>
	);
}
