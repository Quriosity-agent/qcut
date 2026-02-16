import { WORD_FILTER_STATE, type WordItem } from "@/types/word-timeline";

export type KeepSegment = {
  start: number;
  end: number;
};

export type SegmentCalculatorOptions = {
  bufferMs?: number;
  crossfadeMs?: number;
  minGapMs?: number;
};

interface TimeRange {
  start: number;
  end: number;
}

const DEFAULT_OPTIONS: Required<SegmentCalculatorOptions> = {
  bufferMs: 50,
  crossfadeMs: 30,
  minGapMs: 50,
};

function clamp({
  value,
  min,
  max,
}: {
  value: number;
  min: number;
  max: number;
}): number {
  try {
    return Math.max(min, Math.min(max, value));
  } catch {
    return min;
  }
}

function mergeRanges({ ranges }: { ranges: TimeRange[] }): TimeRange[] {
  try {
    if (ranges.length === 0) {
      return [];
    }

    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    const merged: TimeRange[] = [];

    for (const range of sorted) {
      const previous = merged[merged.length - 1];
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        continue;
      }
      previous.end = Math.max(previous.end, range.end);
    }

    return merged;
  } catch {
    return [];
  }
}

function mergeAdjacentKeepRanges({
  ranges,
  minGapSeconds,
}: {
  ranges: KeepSegment[];
  minGapSeconds: number;
}): KeepSegment[] {
  try {
    if (ranges.length <= 1) {
      return ranges;
    }

    const merged: KeepSegment[] = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (!previous) {
        merged.push({ ...range });
        continue;
      }

      const gap = range.start - previous.end;
      if (gap <= minGapSeconds) {
        previous.end = Math.max(previous.end, range.end);
        continue;
      }

      merged.push({ ...range });
    }
    const minimumDuration = Math.max(0, minGapSeconds);
    if (minimumDuration === 0) {
      return merged;
    }

    return merged.filter((segment, index) => {
      const duration = segment.end - segment.start;
      if (duration >= minimumDuration) {
        return true;
      }
      const isBoundary = index === 0 || index === merged.length - 1;
      return isBoundary;
    });
  } catch {
    return ranges;
  }
}

export function calculateKeepSegments({
  words,
  videoDuration,
  options,
}: {
  words: WordItem[];
  videoDuration: number;
  options?: SegmentCalculatorOptions;
}): KeepSegment[] {
  try {
    const duration = Math.max(0, Number(videoDuration) || 0);
    if (duration === 0) {
      return [];
    }

    const config = {
      ...DEFAULT_OPTIONS,
      ...(options || {}),
    };
    const bufferSeconds = Math.max(0, config.bufferMs / 1000);
    const minGapSeconds = Math.max(0, config.minGapMs / 1000);

    const removalRanges = words
      .filter(
        (word) =>
          word.filterState === WORD_FILTER_STATE.AI ||
          word.filterState === WORD_FILTER_STATE.USER_REMOVE
      )
      .map((word) => ({
        start: clamp({
          value: word.start - bufferSeconds,
          min: 0,
          max: duration,
        }),
        end: clamp({
          value: word.end + bufferSeconds,
          min: 0,
          max: duration,
        }),
      }))
      .filter((range) => range.end > range.start);

    if (removalRanges.length === 0) {
      return [{ start: 0, end: duration }];
    }

    const mergedRemovals = mergeRanges({ ranges: removalRanges });
    const keepSegments: KeepSegment[] = [];
    let cursor = 0;

    for (const removal of mergedRemovals) {
      if (removal.start > cursor) {
        keepSegments.push({
          start: cursor,
          end: removal.start,
        });
      }
      cursor = Math.max(cursor, removal.end);
    }

    if (cursor < duration) {
      keepSegments.push({
        start: cursor,
        end: duration,
      });
    }

    return mergeAdjacentKeepRanges({
      ranges: keepSegments.filter((segment) => segment.end > segment.start),
      minGapSeconds,
    });
  } catch {
    return [{ start: 0, end: Math.max(0, videoDuration || 0) }];
  }
}
