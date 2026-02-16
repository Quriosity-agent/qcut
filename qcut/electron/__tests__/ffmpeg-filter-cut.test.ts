import { describe, expect, it } from "vitest";
import { buildFilterCutComplex } from "../ffmpeg-filter-cut";

describe("buildFilterCutComplex", () => {
  it("builds single segment cut", () => {
    const result = buildFilterCutComplex({
      keepSegments: [{ start: 0, end: 10 }],
      crossfadeMs: 30,
    });

    expect(result.filterComplex).toContain("[0:v]trim=start=0:end=10");
    expect(result.filterComplex).toContain("[0:a]atrim=start=0:end=10");
    expect(result.outputMaps).toEqual(["-map", "[outv]", "-map", "[outa]"]);
  });

  it("concatenates multiple segments with audio", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      crossfadeMs: 30,
    });

    expect(result.filterComplex).toContain("concat=n=2:v=1:a=0[outv]");
    expect(result.filterComplex).toContain("concat=n=2:v=0:a=1[outa]");
    expect(result.outputMaps).toEqual(["-map", "[outv]", "-map", "[outa]"]);
  });

  it("concatenates N segments correctly", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
      ],
      crossfadeMs: 30,
    });

    expect(result.filterComplex).toContain("concat=n=3:v=1:a=0[outv]");
    expect(result.filterComplex).toContain("concat=n=3:v=0:a=1[outa]");
  });

  it("skips audio filters when hasAudio is false", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      crossfadeMs: 0,
      hasAudio: false,
    });

    expect(result.filterComplex).not.toContain("[0:a]");
    expect(result.filterComplex).not.toContain("[outa]");
    expect(result.outputMaps).toEqual(["-map", "[outv]"]);
  });

  it("skips audio for single segment when hasAudio is false", () => {
    const result = buildFilterCutComplex({
      keepSegments: [{ start: 5, end: 15 }],
      crossfadeMs: 0,
      hasAudio: false,
    });

    expect(result.filterComplex).toContain("[0:v]trim=start=5:end=15");
    expect(result.filterComplex).not.toContain("atrim");
    expect(result.outputMaps).toEqual(["-map", "[outv]"]);
  });

  it("throws when no valid keep segments are provided", () => {
    expect(() =>
      buildFilterCutComplex({
        keepSegments: [{ start: 2, end: 2 }],
        crossfadeMs: 30,
      }),
    ).toThrow("At least one keep segment");
  });
});
