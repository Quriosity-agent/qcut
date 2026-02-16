import { describe, expect, it } from "vitest";
import {
  calculateKeepSegments,
  type KeepSegment,
} from "../segment-calculator";
import { WORD_FILTER_STATE, type WordItem } from "@/types/word-timeline";

function createWord({
  id,
  start,
  end,
  filterState = WORD_FILTER_STATE.NONE,
}: {
  id: string;
  start: number;
  end: number;
  filterState?: WordItem["filterState"];
}): WordItem {
  return {
    id,
    text: id,
    start,
    end,
    type: "word",
    filterState,
  };
}

function expectSegmentsClose({
  actual,
  expected,
}: {
  actual: KeepSegment[];
  expected: KeepSegment[];
}): void {
  expect(actual.length).toBe(expected.length);
  for (const [index, segment] of actual.entries()) {
    expect(segment.start).toBeCloseTo(expected[index].start, 4);
    expect(segment.end).toBeCloseTo(expected[index].end, 4);
  }
}

describe("calculateKeepSegments", () => {
  it("returns full range when there are no filtered words", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({ id: "w1", start: 0, end: 1 }),
        createWord({ id: "w2", start: 1.2, end: 2 }),
      ],
      videoDuration: 10,
    });

    expectSegmentsClose({
      actual: segments,
      expected: [{ start: 0, end: 10 }],
    });
  });

  it("splits around one removed word", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({ id: "w1", start: 0, end: 1 }),
        createWord({
          id: "w2",
          start: 2,
          end: 3,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
        createWord({ id: "w3", start: 4, end: 5 }),
      ],
      videoDuration: 8,
      options: { bufferMs: 0, minGapMs: 0 },
    });

    expectSegmentsClose({
      actual: segments,
      expected: [
        { start: 0, end: 2 },
        { start: 3, end: 8 },
      ],
    });
  });

  it("merges overlapping removals after buffer expansion", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({
          id: "w1",
          start: 1,
          end: 1.2,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
        createWord({
          id: "w2",
          start: 1.23,
          end: 1.4,
          filterState: WORD_FILTER_STATE.AI,
        }),
      ],
      videoDuration: 4,
      options: { bufferMs: 50, minGapMs: 0 },
    });

    expectSegmentsClose({
      actual: segments,
      expected: [
        { start: 0, end: 0.95 },
        { start: 1.45, end: 4 },
      ],
    });
  });

  it("expands removal by default 50ms before and after", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({
          id: "w1",
          start: 2,
          end: 3,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
      ],
      videoDuration: 6,
    });

    expectSegmentsClose({
      actual: segments,
      expected: [
        { start: 0, end: 1.95 },
        { start: 3.05, end: 6 },
      ],
    });
  });

  it("handles first and last word removed", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({
          id: "w1",
          start: 0.1,
          end: 0.5,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
        createWord({ id: "w2", start: 1, end: 2 }),
        createWord({
          id: "w3",
          start: 5.7,
          end: 5.95,
          filterState: WORD_FILTER_STATE.AI,
        }),
      ],
      videoDuration: 6,
      options: { bufferMs: 100, minGapMs: 0 },
    });

    expectSegmentsClose({
      actual: segments,
      expected: [{ start: 0.6, end: 5.6 }],
    });
  });

  it("merges keep segments when the keep gap is below minGap", () => {
    const segments = calculateKeepSegments({
      words: [
        createWord({
          id: "w1",
          start: 1,
          end: 1.4,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
        createWord({
          id: "w2",
          start: 1.43,
          end: 1.8,
          filterState: WORD_FILTER_STATE.USER_REMOVE,
        }),
      ],
      videoDuration: 3,
      options: { bufferMs: 0, minGapMs: 50 },
    });

    expectSegmentsClose({
      actual: segments,
      expected: [
        { start: 0, end: 1 },
        { start: 1.8, end: 3 },
      ],
    });
  });

  it("returns single full segment for empty input", () => {
    const segments = calculateKeepSegments({
      words: [],
      videoDuration: 5,
    });

    expectSegmentsClose({
      actual: segments,
      expected: [{ start: 0, end: 5 }],
    });
  });
});
