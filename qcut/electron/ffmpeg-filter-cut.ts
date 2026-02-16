export type KeepSegment = {
  start: number;
  end: number;
};

export type FilterCutResult = {
  filterComplex: string;
  outputMaps: string[];
};

/** Format a numeric time value to a precision string for FFmpeg. */
function toTime({ value }: { value: number }): string {
  try {
    return Number(value.toFixed(6)).toString();
  } catch {
    return String(value);
  }
}

/** Clamp, filter, and sort keep segments for valid FFmpeg ranges. */
function normalizeSegments({
  keepSegments,
}: {
  keepSegments: KeepSegment[];
}): KeepSegment[] {
  try {
    return keepSegments
      .map((segment) => ({
        start: Math.max(0, segment.start),
        end: Math.max(0, segment.end),
      }))
      .filter((segment) => segment.end > segment.start)
      .sort((left, right) => left.start - right.start);
  } catch {
    return [];
  }
}

/**
 * Build an FFmpeg filter_complex string that trims and concatenates keep segments.
 * @param keepSegments - Array of time ranges (in seconds) to keep.
 * @param hasAudio - Whether the input has an audio stream (default true).
 * @returns filterComplex string and output -map args for FFmpeg.
 */
export function buildFilterCutComplex({
  keepSegments,
  hasAudio = true,
}: {
  keepSegments: KeepSegment[];
  hasAudio?: boolean;
}): FilterCutResult {
  const segments = normalizeSegments({ keepSegments });
  if (segments.length === 0) {
    throw new Error("At least one keep segment is required for filter cut.");
  }

  const filterSteps: string[] = [];

  if (segments.length === 1) {
    const segment = segments[0];
    filterSteps.push(
      `[0:v]trim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},setpts=PTS-STARTPTS[outv]`
    );
    const outputMaps = ["-map", "[outv]"];
    if (hasAudio) {
      filterSteps.push(
        `[0:a]atrim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},asetpts=PTS-STARTPTS[outa]`
      );
      outputMaps.push("-map", "[outa]");
    }
    return {
      filterComplex: filterSteps.join(";"),
      outputMaps,
    };
  }

  for (const [index, segment] of segments.entries()) {
    filterSteps.push(
      `[0:v]trim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},setpts=PTS-STARTPTS[v${index}]`
    );
    if (hasAudio) {
      filterSteps.push(
        `[0:a]atrim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},asetpts=PTS-STARTPTS[a${index}]`
      );
    }
  }

  const videoInputs = segments.map((_, index) => `[v${index}]`).join("");
  filterSteps.push(`${videoInputs}concat=n=${segments.length}:v=1:a=0[outv]`);

  const outputMaps = ["-map", "[outv]"];

  if (hasAudio) {
    const audioInputs = segments.map((_, index) => `[a${index}]`).join("");
    filterSteps.push(`${audioInputs}concat=n=${segments.length}:v=0:a=1[outa]`);
    outputMaps.push("-map", "[outa]");
  }

  return {
    filterComplex: filterSteps.join(";"),
    outputMaps,
  };
}
