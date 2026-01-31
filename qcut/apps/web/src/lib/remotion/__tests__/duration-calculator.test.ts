/**
 * Tests for Remotion Duration Calculator
 *
 * @module lib/remotion/__tests__/duration-calculator.test
 */

import { describe, it, expect } from "vitest";
import {
  calculateTotalDuration,
  calculateSequencePositions,
  getOverlappingSequences,
  findTransitionAtFrame,
  validateSequenceStructure,
  type SequencePosition,
} from "../duration-calculator";
import type { SequenceStructure } from "../types";

describe("calculateTotalDuration", () => {
  it("returns sum of sequences when no transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 60, durationInFrames: 80 },
        { name: "C", from: 140, durationInFrames: 90 },
      ],
    };

    expect(calculateTotalDuration(structure)).toBe(230); // 60 + 80 + 90
  });

  it("subtracts transition durations from total", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 40 },
        { name: "B", from: 0, durationInFrames: 60 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 30 },
      ],
    };

    // 40 + 60 - 30 = 70
    expect(calculateTotalDuration(structure)).toBe(70);
  });

  it("handles multiple transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 40 },
        { name: "B", from: 0, durationInFrames: 60 },
        { name: "C", from: 0, durationInFrames: 90 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 30 },
        { afterSequenceIndex: 1, durationInFrames: 45 },
      ],
    };

    // 40 + 60 + 90 - 30 - 45 = 115
    expect(calculateTotalDuration(structure)).toBe(115);
  });

  it("returns 0 for empty sequences", () => {
    const structure: SequenceStructure = {
      sequences: [],
    };

    expect(calculateTotalDuration(structure)).toBe(0);
  });

  it("returns 0 for undefined sequences", () => {
    const structure = {} as SequenceStructure;
    expect(calculateTotalDuration(structure)).toBe(0);
  });

  it("handles single sequence", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "Only", from: 0, durationInFrames: 100 },
      ],
    };

    expect(calculateTotalDuration(structure)).toBe(100);
  });
});

describe("calculateSequencePositions", () => {
  it("returns sequential positions without transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 0, durationInFrames: 80 },
        { name: "C", from: 0, durationInFrames: 90 },
      ],
    };

    const positions = calculateSequencePositions(structure);

    expect(positions).toEqual([
      { from: 0, to: 60 },
      { from: 60, to: 140 },
      { from: 140, to: 230 },
    ]);
  });

  it("calculates overlap positions with transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 0, durationInFrames: 80 },
        { name: "C", from: 0, durationInFrames: 90 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 15 },
        { afterSequenceIndex: 1, durationInFrames: 20 },
      ],
    };

    const positions = calculateSequencePositions(structure);

    // A: 0-60
    // B: starts 15 earlier (60 - 15 = 45), ends at 45 + 80 = 125
    // C: starts 20 earlier (125 - 20 = 105), ends at 105 + 90 = 195
    expect(positions).toEqual([
      { from: 0, to: 60 },
      { from: 45, to: 125 },
      { from: 105, to: 195 },
    ]);
  });

  it("handles first sequence starting at 0", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "First", from: 0, durationInFrames: 100 },
      ],
    };

    const positions = calculateSequencePositions(structure);

    expect(positions[0].from).toBe(0);
  });

  it("prevents negative start positions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 10 },
        { name: "B", from: 0, durationInFrames: 50 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 30 }, // Larger than first sequence!
      ],
    };

    const positions = calculateSequencePositions(structure);

    // B would start at 10 - 30 = -20, but should be clamped to 0
    expect(positions[1].from).toBeGreaterThanOrEqual(0);
  });

  it("returns empty array for empty sequences", () => {
    const structure: SequenceStructure = {
      sequences: [],
    };

    expect(calculateSequencePositions(structure)).toEqual([]);
  });
});

describe("getOverlappingSequences", () => {
  it("returns single sequence when not in overlap", () => {
    const positions: SequencePosition[] = [
      { from: 0, to: 60 },
      { from: 45, to: 125 },
    ];

    // Frame 30 is only in sequence A
    expect(getOverlappingSequences(positions, 30)).toEqual([0]);

    // Frame 100 is only in sequence B
    expect(getOverlappingSequences(positions, 100)).toEqual([1]);
  });

  it("returns multiple sequences when in overlap region", () => {
    const positions: SequencePosition[] = [
      { from: 0, to: 60 },
      { from: 45, to: 125 },
    ];

    // Frame 50 is in both A (0-60) and B (45-125)
    expect(getOverlappingSequences(positions, 50)).toEqual([0, 1]);
  });

  it("returns empty array when before all sequences", () => {
    const positions: SequencePosition[] = [
      { from: 10, to: 60 },
    ];

    expect(getOverlappingSequences(positions, 5)).toEqual([]);
  });

  it("returns empty array when after all sequences", () => {
    const positions: SequencePosition[] = [
      { from: 0, to: 60 },
    ];

    expect(getOverlappingSequences(positions, 100)).toEqual([]);
  });
});

describe("findTransitionAtFrame", () => {
  const structure: SequenceStructure = {
    sequences: [
      { name: "A", from: 0, durationInFrames: 60 },
      { name: "B", from: 0, durationInFrames: 80 },
    ],
    transitions: [
      { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
    ],
  };

  const positions = calculateSequencePositions(structure);

  it("returns transition info when in overlap region", () => {
    // Overlap is from 45 (B start) to 60 (A end)
    const result = findTransitionAtFrame(structure, positions, 50);

    expect(result).not.toBeNull();
    expect(result?.transition.presentation).toBe("fade");
    expect(result?.overlapStart).toBe(45);
    expect(result?.overlapEnd).toBe(60);
  });

  it("returns null when not in overlap region", () => {
    expect(findTransitionAtFrame(structure, positions, 30)).toBeNull();
    expect(findTransitionAtFrame(structure, positions, 100)).toBeNull();
  });

  it("returns null when no transitions", () => {
    const noTransitions: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 0, durationInFrames: 80 },
      ],
    };

    const pos = calculateSequencePositions(noTransitions);
    expect(findTransitionAtFrame(noTransitions, pos, 50)).toBeNull();
  });
});

describe("validateSequenceStructure", () => {
  it("returns empty array for valid structure without transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 60, durationInFrames: 80 },
      ],
    };

    expect(validateSequenceStructure(structure)).toEqual([]);
  });

  it("returns empty array for valid structure with transitions", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
        { name: "B", from: 0, durationInFrames: 80 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 15 },
      ],
    };

    expect(validateSequenceStructure(structure)).toEqual([]);
  });

  it("returns error for empty sequences", () => {
    const structure: SequenceStructure = {
      sequences: [],
    };

    const errors = validateSequenceStructure(structure);
    expect(errors).toContain("No sequences defined");
  });

  it("returns error for invalid sequence duration", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "Bad", from: 0, durationInFrames: 0 },
      ],
    };

    const errors = validateSequenceStructure(structure);
    expect(errors.some(e => e.includes("invalid duration"))).toBe(true);
  });

  it("returns error for invalid transition index", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 60 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 15 }, // No sequence after A!
      ],
    };

    const errors = validateSequenceStructure(structure);
    expect(errors.some(e => e.includes("afterSequenceIndex"))).toBe(true);
  });

  it("returns error when transition exceeds sequence duration", () => {
    const structure: SequenceStructure = {
      sequences: [
        { name: "A", from: 0, durationInFrames: 30 },
        { name: "B", from: 0, durationInFrames: 60 },
      ],
      transitions: [
        { afterSequenceIndex: 0, durationInFrames: 50 }, // Exceeds A's duration!
      ],
    };

    const errors = validateSequenceStructure(structure);
    expect(errors.some(e => e.includes("exceeds"))).toBe(true);
  });
});
