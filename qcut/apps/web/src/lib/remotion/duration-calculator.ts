/**
 * Duration Calculator for Remotion Sequence Visualization
 *
 * Calculates total duration and sequence positions accounting for
 * transition overlaps in TransitionSeries components.
 *
 * @module lib/remotion/duration-calculator
 */

import type { SequenceStructure } from "./types";

/**
 * Position information for a sequence in the timeline
 */
export interface SequencePosition {
  /** Starting frame (may overlap with previous sequence) */
  from: number;
  /** Ending frame (exclusive) */
  to: number;
}

/**
 * Calculate total duration accounting for transition overlaps.
 *
 * Formula: Sum of all sequence durations - Sum of all transition durations
 *
 * @example
 * // Sequence A (40f) + Transition (30f) + Sequence B (60f) = 70f
 * calculateTotalDuration({
 *   sequences: [
 *     { name: "A", from: 0, durationInFrames: 40 },
 *     { name: "B", from: 10, durationInFrames: 60 }
 *   ],
 *   transitions: [{ afterSequenceIndex: 0, durationInFrames: 30 }]
 * }); // Returns 70
 */
export function calculateTotalDuration(structure: SequenceStructure): number {
  if (!structure.sequences || structure.sequences.length === 0) {
    return 0;
  }

  const sequenceTotal = structure.sequences.reduce(
    (sum, seq) => sum + seq.durationInFrames,
    0
  );

  const transitionTotal = (structure.transitions ?? []).reduce(
    (sum, trans) => sum + trans.durationInFrames,
    0
  );

  return Math.max(0, sequenceTotal - transitionTotal);
}

/**
 * Calculate the actual start and end frame for each sequence considering overlaps.
 *
 * For TransitionSeries, transitions cause sequences to overlap. This function
 * calculates where each sequence would appear in the final timeline.
 *
 * @example
 * // Three sequences with two transitions
 * const positions = calculateSequencePositions({
 *   sequences: [
 *     { name: "A", from: 0, durationInFrames: 60 },
 *     { name: "B", from: 0, durationInFrames: 80 },
 *     { name: "C", from: 0, durationInFrames: 90 }
 *   ],
 *   transitions: [
 *     { afterSequenceIndex: 0, durationInFrames: 15 },
 *     { afterSequenceIndex: 1, durationInFrames: 20 }
 *   ]
 * });
 * // Returns [
 * //   { from: 0, to: 60 },      // A: 0-60
 * //   { from: 45, to: 125 },    // B: 45-125 (starts 15f early due to transition)
 * //   { from: 105, to: 195 }    // C: 105-195 (starts 20f early due to transition)
 * // ]
 */
export function calculateSequencePositions(
  structure: SequenceStructure
): SequencePosition[] {
  if (!structure.sequences || structure.sequences.length === 0) {
    return [];
  }

  const positions: SequencePosition[] = [];
  let currentFrame = 0;

  for (let i = 0; i < structure.sequences.length; i++) {
    const seq = structure.sequences[i];

    // Find transition that precedes this sequence (if any)
    const prevTransition = structure.transitions?.find(
      (t) => t.afterSequenceIndex === i - 1
    );

    // Adjust start if there's an overlap from previous transition
    if (prevTransition && i > 0) {
      currentFrame -= prevTransition.durationInFrames;
    }

    const from = Math.max(0, currentFrame);
    const to = from + seq.durationInFrames;

    positions.push({ from, to });

    // Move to end of this sequence for next iteration
    currentFrame = to;
  }

  return positions;
}

/**
 * Check if two sequences overlap at a given point in time.
 * Useful for determining if we're in a transition region.
 */
export function getOverlappingSequences(
  positions: SequencePosition[],
  frame: number
): number[] {
  const overlapping: number[] = [];

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (frame >= pos.from && frame < pos.to) {
      overlapping.push(i);
    }
  }

  return overlapping;
}

/**
 * Find the transition at a given frame position.
 * Returns the transition metadata and overlap region if found.
 */
export function findTransitionAtFrame(
  structure: SequenceStructure,
  positions: SequencePosition[],
  frame: number
): {
  transition: import("./types").TransitionMetadata;
  overlapStart: number;
  overlapEnd: number;
} | null {
  if (!structure.transitions) {
    return null;
  }

  for (const trans of structure.transitions) {
    const afterSeq = positions[trans.afterSequenceIndex];
    const nextSeq = positions[trans.afterSequenceIndex + 1];

    if (!afterSeq || !nextSeq) {
      continue;
    }

    // Overlap region is where next sequence starts until previous sequence ends
    const overlapStart = nextSeq.from;
    const overlapEnd = afterSeq.to;

    if (frame >= overlapStart && frame < overlapEnd) {
      return { transition: trans, overlapStart, overlapEnd };
    }
  }

  return null;
}

/**
 * Validate that a sequence structure is internally consistent.
 * Returns array of validation errors (empty if valid).
 */
export function validateSequenceStructure(
  structure: SequenceStructure
): string[] {
  const errors: string[] = [];

  if (!structure.sequences || structure.sequences.length === 0) {
    errors.push("No sequences defined");
    return errors;
  }

  // Check each sequence has valid duration
  for (let i = 0; i < structure.sequences.length; i++) {
    const seq = structure.sequences[i];
    if (seq.durationInFrames <= 0) {
      errors.push(
        `Sequence "${seq.name}" has invalid duration: ${seq.durationInFrames}`
      );
    }
  }

  // Check transitions reference valid sequences
  if (structure.transitions) {
    for (let i = 0; i < structure.transitions.length; i++) {
      const trans = structure.transitions[i];

      if (trans.afterSequenceIndex < 0) {
        errors.push(
          `Transition ${i} has invalid afterSequenceIndex: ${trans.afterSequenceIndex}`
        );
      }

      if (trans.afterSequenceIndex >= structure.sequences.length - 1) {
        errors.push(
          `Transition ${i} afterSequenceIndex (${trans.afterSequenceIndex}) exceeds max (${structure.sequences.length - 2})`
        );
      }

      if (trans.durationInFrames <= 0) {
        errors.push(
          `Transition ${i} has invalid duration: ${trans.durationInFrames}`
        );
      }

      // Check transition doesn't exceed adjacent sequence durations
      const prevSeq = structure.sequences[trans.afterSequenceIndex];
      const nextSeq = structure.sequences[trans.afterSequenceIndex + 1];

      if (prevSeq && trans.durationInFrames > prevSeq.durationInFrames) {
        errors.push(
          `Transition ${i} duration (${trans.durationInFrames}) exceeds previous sequence "${prevSeq.name}" duration (${prevSeq.durationInFrames})`
        );
      }

      if (nextSeq && trans.durationInFrames > nextSeq.durationInFrames) {
        errors.push(
          `Transition ${i} duration (${trans.durationInFrames}) exceeds next sequence "${nextSeq.name}" duration (${nextSeq.durationInFrames})`
        );
      }
    }
  }

  return errors;
}
