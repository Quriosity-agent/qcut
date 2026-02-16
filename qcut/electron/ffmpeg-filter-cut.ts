export interface KeepSegment {
  start: number;
  end: number;
}

export interface FilterCutResult {
  filterComplex: string;
  outputMaps: string[];
}

function toTime({
  value,
}: {
  value: number;
}): string {
  try {
    return Number(value.toFixed(6)).toString();
  } catch {
    return String(value);
  }
}

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

export function buildFilterCutComplex({
  keepSegments,
  crossfadeMs,
}: {
  keepSegments: KeepSegment[];
  crossfadeMs: number;
}): FilterCutResult {
  const segments = normalizeSegments({ keepSegments });
  if (segments.length === 0) {
    throw new Error("At least one keep segment is required for filter cut.");
  }

  const filterSteps: string[] = [];
  const crossfadeSeconds = Math.max(0, crossfadeMs / 1000);

  if (segments.length === 1) {
    const segment = segments[0];
    filterSteps.push(
      `[0:v]trim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},setpts=PTS-STARTPTS[outv]`
    );
    filterSteps.push(
      `[0:a]atrim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},asetpts=PTS-STARTPTS[outa]`
    );
    return {
      filterComplex: filterSteps.join(";"),
      outputMaps: ["-map", "[outv]", "-map", "[outa]"],
    };
  }

  for (const [index, segment] of segments.entries()) {
    filterSteps.push(
      `[0:v]trim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},setpts=PTS-STARTPTS[v${index}]`
    );
    filterSteps.push(
      `[0:a]atrim=start=${toTime({ value: segment.start })}:end=${toTime({ value: segment.end })},asetpts=PTS-STARTPTS[a${index}]`
    );
  }

  const videoInputs = segments.map((_, index) => `[v${index}]`).join("");
  filterSteps.push(
    `${videoInputs}concat=n=${segments.length}:v=1:a=0[outv]`
  );

  if (crossfadeSeconds > 0) {
    let previousAudioLabel = "a0";
    for (let index = 1; index < segments.length; index += 1) {
      const nextAudioLabel = `a${index}`;
      const outputLabel =
        index === segments.length - 1 ? "outa" : `a_mix_${index}`;
      filterSteps.push(
        `[${previousAudioLabel}][${nextAudioLabel}]acrossfade=d=${toTime({ value: crossfadeSeconds })}:c1=tri:c2=tri[${outputLabel}]`
      );
      previousAudioLabel = outputLabel;
    }
  } else {
    const audioInputs = segments.map((_, index) => `[a${index}]`).join("");
    filterSteps.push(
      `${audioInputs}concat=n=${segments.length}:v=0:a=1[outa]`
    );
  }

  return {
    filterComplex: filterSteps.join(";"),
    outputMaps: ["-map", "[outv]", "-map", "[outa]"],
  };
}
