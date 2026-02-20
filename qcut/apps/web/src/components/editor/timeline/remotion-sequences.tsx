/**
 * Remotion Sequences Visualization Component
 *
 * Renders visual representation of internal sequence structure
 * within a Remotion timeline element. Shows sequence bars with
 * colors, names, and transition overlap indicators.
 *
 * @module components/editor/timeline/remotion-sequences
 */

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
	SequenceStructure,
	SequenceMetadata,
	TransitionMetadata,
} from "@/lib/remotion/types";
import {
	calculateSequencePositions,
	type SequencePosition,
} from "@/lib/remotion/duration-calculator";

// ============================================================================
// Types
// ============================================================================

export interface RemotionSequencesProps {
	/** The sequence structure metadata from the component definition */
	structure: SequenceStructure;
	/** Total duration of the element in frames */
	totalDuration: number;
	/** Width of the element in pixels */
	elementWidth: number;
	/** Optional className for the container */
	className?: string;
}

interface SequenceBarProps {
	sequence: SequenceMetadata;
	position: SequencePosition;
	index: number;
	pixelsPerFrame: number;
	hasOverlap: boolean;
	previousEnd: number;
}

interface TransitionIndicatorProps {
	transition: TransitionMetadata;
	positions: SequencePosition[];
	pixelsPerFrame: number;
}

// ============================================================================
// Default Colors
// ============================================================================

const DEFAULT_COLORS = [
	"#8B5CF6", // violet-500
	"#3B82F6", // blue-500
	"#10B981", // emerald-500
	"#F59E0B", // amber-500
	"#EF4444", // red-500
	"#EC4899", // pink-500
	"#06B6D4", // cyan-500
	"#84CC16", // lime-500
];

function getDefaultColor(index: number): string {
	return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Individual sequence bar within the visualization
 */
function SequenceBar({
	sequence,
	position,
	index,
	pixelsPerFrame,
	hasOverlap,
	previousEnd,
}: SequenceBarProps) {
	const width = (position.to - position.from) * pixelsPerFrame;
	const left = position.from * pixelsPerFrame;
	const color = sequence.color || getDefaultColor(index);

	// Calculate overlap width for gradient
	const overlapWidth = hasOverlap
		? (previousEnd - position.from) * pixelsPerFrame
		: 0;
	const overlapPercent = hasOverlap
		? Math.min(100, (overlapWidth / width) * 100)
		: 0;

	// Only show name if bar is wide enough
	const showName = width > 30;

	return (
		<div
			className={cn(
				"absolute h-full rounded-sm flex items-center overflow-hidden",
				"text-[9px] font-medium text-white truncate",
				"transition-opacity hover:opacity-90"
			)}
			style={{
				left: `${left}px`,
				width: `${Math.max(4, width)}px`,
				// Show gradient for overlap region
				background: hasOverlap
					? `linear-gradient(90deg, transparent 0%, ${color} ${overlapPercent}%, ${color} 100%)`
					: color,
			}}
			title={`${sequence.name}: ${sequence.durationInFrames} frames (${position.from}-${position.to})`}
		>
			{showName && (
				<span className="px-1 truncate drop-shadow-sm">{sequence.name}</span>
			)}
		</div>
	);
}

/**
 * Dashed indicator showing transition overlap region
 */
function TransitionIndicator({
	transition,
	positions,
	pixelsPerFrame,
}: TransitionIndicatorProps) {
	const afterSeq = positions[transition.afterSequenceIndex];
	const nextSeq = positions[transition.afterSequenceIndex + 1];

	if (!afterSeq || !nextSeq) {
		return null;
	}

	// Overlap region: where next sequence starts until previous sequence ends
	const overlapStart = nextSeq.from;
	const overlapEnd = afterSeq.to;

	// Only render if there's actual overlap
	if (overlapEnd <= overlapStart) {
		return null;
	}

	const left = overlapStart * pixelsPerFrame;
	const width = (overlapEnd - overlapStart) * pixelsPerFrame;

	const presentationLabel = transition.presentation || "slide";

	return (
		<div
			className={cn(
				"absolute h-full pointer-events-none",
				"border-t-2 border-b-2 border-dashed border-white/60"
			)}
			style={{
				left: `${left}px`,
				width: `${Math.max(2, width)}px`,
			}}
			title={`${presentationLabel} transition: ${transition.durationInFrames} frames`}
		/>
	);
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * RemotionSequences - Visualizes internal sequence structure
 *
 * Features:
 * - Colored bars for each sequence
 * - Sequence names (when space permits)
 * - Transition overlap indicators with dashed borders
 * - Tooltips with frame information
 *
 * @example
 * ```tsx
 * <RemotionSequences
 *   structure={{
 *     sequences: [
 *       { name: "Intro", from: 0, durationInFrames: 90, color: "#8B5CF6" },
 *       { name: "Main", from: 90, durationInFrames: 180, color: "#3B82F6" },
 *     ]
 *   }}
 *   totalDuration={270}
 *   elementWidth={200}
 * />
 * ```
 */
export function RemotionSequences({
	structure,
	totalDuration,
	elementWidth,
	className,
}: RemotionSequencesProps) {
	// Calculate positions for all sequences
	const positions = useMemo(
		() => calculateSequencePositions(structure),
		[structure]
	);

	// Calculate pixels per frame for positioning
	const pixelsPerFrame = useMemo(() => {
		if (totalDuration <= 0 || elementWidth <= 0) {
			return 0;
		}
		return elementWidth / totalDuration;
	}, [totalDuration, elementWidth]);

	// Don't render if no sequences or invalid dimensions
	if (
		!structure.sequences ||
		structure.sequences.length === 0 ||
		pixelsPerFrame === 0
	) {
		return null;
	}

	return (
		<div
			className={cn(
				"absolute bottom-1 left-1 right-1 h-4",
				"flex overflow-hidden rounded-sm",
				className
			)}
		>
			{/* Render sequence bars */}
			{structure.sequences.map((seq, i) => {
				const pos = positions[i];
				if (!pos) return null;

				// Check if this sequence overlaps with previous (has a transition before it)
				const hasOverlap = i > 0 && pos.from < positions[i - 1].to;
				const previousEnd = i > 0 ? positions[i - 1].to : 0;

				return (
					<SequenceBar
						key={`seq-${i}-${seq.name}`}
						sequence={seq}
						position={pos}
						index={i}
						pixelsPerFrame={pixelsPerFrame}
						hasOverlap={hasOverlap}
						previousEnd={previousEnd}
					/>
				);
			})}

			{/* Render transition indicators */}
			{structure.transitions?.map((trans, i) => (
				<TransitionIndicator
					key={`trans-${i}`}
					transition={trans}
					positions={positions}
					pixelsPerFrame={pixelsPerFrame}
				/>
			))}
		</div>
	);
}

export default RemotionSequences;
