/**
 * Parsed Sequence Overlay Component
 *
 * Renders automatically detected sequences with visual indicators
 * for dynamic vs static values. Used when component metadata is
 * extracted via AST parsing rather than author-provided.
 *
 * @module components/editor/timeline/parsed-sequence-overlay
 */

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  ParsedSequence,
  ParsedTransition,
} from "@/lib/remotion/sequence-parser";

// ============================================================================
// Types
// ============================================================================

export interface ParsedSequenceOverlayProps {
  /** Parsed sequences from AST analysis */
  sequences: ParsedSequence[];
  /** Parsed transitions from AST analysis */
  transitions?: ParsedTransition[];
  /** Width of the element in pixels */
  elementWidth: number;
  /** Total duration in frames (for positioning) */
  totalDuration: number;
  /** Whether the component uses TransitionSeries (affects positioning logic) */
  usesTransitionSeries?: boolean;
  /** Optional className for the container */
  className?: string;
}

interface SequenceBarProps {
  sequence: ParsedSequence;
  index: number;
  left: number;
  width: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_COLORS = [
  "#8B5CF6", // violet
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#EC4899", // pink
];

const DEFAULT_DURATION = 30; // Fallback for dynamic durations

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Individual sequence bar with dynamic indicator
 */
function SequenceBar({ sequence, index, left, width }: SequenceBarProps) {
  const color = DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  const isDynamic =
    sequence.from === "dynamic" || sequence.durationInFrames === "dynamic";

  const displayName = sequence.name ?? `Seq ${index + 1}`;
  const showName = width > 25;

  // Build tooltip text
  const tooltipParts = [displayName];
  if (sequence.durationInFrames !== "dynamic") {
    tooltipParts.push(`${sequence.durationInFrames}f`);
  }
  if (isDynamic) {
    tooltipParts.push("(dynamic)");
  }
  tooltipParts.push(`Line ${sequence.line}`);

  return (
    <div
      className={cn(
        "absolute h-full rounded-sm flex items-center overflow-hidden",
        "text-[8px] font-medium text-white truncate",
        "transition-opacity hover:opacity-90",
        // Dashed border for dynamic sequences
        isDynamic && "border border-dashed border-white/60"
      )}
      style={{
        left: `${left}px`,
        width: `${Math.max(4, width)}px`,
        backgroundColor: color,
        opacity: isDynamic ? 0.7 : 1,
      }}
      title={tooltipParts.join(" | ")}
    >
      {showName && (
        <span className="px-0.5 truncate drop-shadow-sm">
          {isDynamic && "~ "}
          {displayName}
        </span>
      )}
    </div>
  );
}

/**
 * Indicator badge for dynamic values
 */
function DynamicBadge() {
  return (
    <div
      className={cn(
        "absolute top-0 right-0 px-1 py-0.5",
        "text-[7px] font-bold text-white/80",
        "bg-amber-500/80 rounded-bl-sm"
      )}
      title="Some values are computed at runtime"
    >
      ~
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * ParsedSequenceOverlay - Visualizes auto-detected sequences
 *
 * Features:
 * - Colored bars for each sequence
 * - Dashed borders for dynamic/computed values
 * - Tilde (~) prefix for dynamic sequences
 * - Line number in tooltip for debugging
 *
 * @example
 * ```tsx
 * <ParsedSequenceOverlay
 *   sequences={parsedResult.sequences}
 *   transitions={parsedResult.transitions}
 *   elementWidth={200}
 *   totalDuration={300}
 * />
 * ```
 */
export function ParsedSequenceOverlay({
  sequences,
  transitions = [],
  elementWidth,
  totalDuration,
  usesTransitionSeries = false,
  className,
}: ParsedSequenceOverlayProps) {
  // Calculate positions for all sequences
  const positions = useMemo(() => {
    if (sequences.length === 0 || totalDuration <= 0 || elementWidth <= 0) {
      return [];
    }

    const pixelsPerFrame = elementWidth / totalDuration;

    // When using TransitionSeries, calculate positions sequentially
    if (usesTransitionSeries) {
      const result: Array<{ left: number; width: number }> = [];
      let currentFrame = 0;

      for (let i = 0; i < sequences.length; i++) {
        const seq = sequences[i];
        const duration =
          seq.durationInFrames === "dynamic"
            ? DEFAULT_DURATION
            : seq.durationInFrames;

        // Check for transition before this sequence (creates overlap)
        const prevTransition = transitions.find(
          (t) => t.afterSequenceIndex === i - 1
        );
        if (prevTransition && i > 0) {
          const transitionDuration =
            prevTransition.durationInFrames === "dynamic"
              ? 15
              : prevTransition.durationInFrames;
          currentFrame -= transitionDuration;
        }

        const from = Math.max(0, currentFrame);
        result.push({
          left: from * pixelsPerFrame,
          width: duration * pixelsPerFrame,
        });
        currentFrame = from + duration;
      }
      return result;
    }

    // Default logic for absolutely positioned <Sequence> elements
    return sequences.map((seq) => {
      const from = typeof seq.from === "number" ? seq.from : 0;
      const duration =
        seq.durationInFrames === "dynamic"
          ? DEFAULT_DURATION
          : seq.durationInFrames;
      return {
        left: from * pixelsPerFrame,
        width: duration * pixelsPerFrame,
      };
    });
  }, [
    sequences,
    transitions,
    totalDuration,
    elementWidth,
    usesTransitionSeries,
  ]);

  // Check if any sequences have dynamic values
  const hasDynamicValues = useMemo(() => {
    return sequences.some(
      (seq) => seq.from === "dynamic" || seq.durationInFrames === "dynamic"
    );
  }, [sequences]);

  // Don't render if no sequences or invalid dimensions
  if (sequences.length === 0 || positions.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute bottom-1 left-1 right-1 h-3",
        "flex overflow-hidden rounded-sm",
        className
      )}
    >
      {/* Render sequence bars */}
      {sequences.map((seq, i) => {
        const pos = positions[i];
        if (!pos) return null;

        return (
          <SequenceBar
            key={`parsed-seq-${i}-${seq.line}`}
            sequence={seq}
            index={i}
            left={pos.left}
            width={pos.width}
          />
        );
      })}

      {/* Show dynamic indicator badge */}
      {hasDynamicValues && <DynamicBadge />}
    </div>
  );
}

export default ParsedSequenceOverlay;
