import { describe, expect, it } from "vitest";
import { buildFilterCutComplex } from "../ffmpeg-filter-cut";

describe("buildFilterCutComplex", () => {
  it("builds single segment cut without acrossfade", () => {
    const result = buildFilterCutComplex({
      keepSegments: [{ start: 0, end: 10 }],
      crossfadeMs: 30,
    });

    expect(result.filterComplex).toContain("[0:v]trim=start=0:end=10");
    expect(result.filterComplex).toContain("[0:a]atrim=start=0:end=10");
    expect(result.filterComplex).not.toContain("acrossfade");
    expect(result.outputMaps).toEqual(["-map", "[outv]", "-map", "[outa]"]);
  });

  it("adds one acrossfade for two segments", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      crossfadeMs: 30,
    });

    expect(result.filterComplex).toContain("concat=n=2:v=1:a=0[outv]");
    expect(result.filterComplex).toContain("acrossfade=d=0.03");
    expect(result.filterComplex.match(/acrossfade=/g)?.length || 0).toBe(1);
  });

  it("chains N-1 acrossfades for N segments", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
      ],
      crossfadeMs: 30,
    });

    expect(result.filterComplex.match(/acrossfade=/g)?.length || 0).toBe(2);
    expect(result.filterComplex).toContain("[a_mix_1]");
    expect(result.filterComplex).toContain("[outa]");
  });

  it("uses audio concat when crossfade is disabled", () => {
    const result = buildFilterCutComplex({
      keepSegments: [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      crossfadeMs: 0,
    });

    expect(result.filterComplex).not.toContain("acrossfade");
    expect(result.filterComplex).toContain("concat=n=2:v=0:a=1[outa]");
  });

  it("throws when no valid keep segments are provided", () => {
    expect(() =>
      buildFilterCutComplex({
        keepSegments: [{ start: 2, end: 2 }],
        crossfadeMs: 30,
      })
    ).toThrow("At least one keep segment");
  });
});
