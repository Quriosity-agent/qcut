import type {
	AudioAutomationPoint,
	AudioMixAutomation,
} from "@/types/timeline";

/**
 * Level and pan automation of tracks and buses: curves over timeline time.
 * A curve with points replaces the strip's fixed value; between points the
 * value moves in a straight line (in dB for level), and before the first
 * point and after the last it holds. The preview, the in-browser export and
 * FFmpeg (electron/ffmpeg/audio-mix-automation.ts) all read curves this way.
 */

export type AutomationParam = keyof AudioMixAutomation;

export const AUTOMATION_RANGES: Record<AutomationParam, [number, number]> = {
	gainDb: [-60, 12],
	pan: [-1, 1],
};

export const MAX_AUTOMATION_POINTS = 10_000;

/** Sorted by time, values in range, one point per time (the last wins). */
export function normalizeAutomationPoints({
	points,
	param,
}: {
	points: unknown;
	param: AutomationParam;
}): AudioAutomationPoint[] {
	if (!Array.isArray(points)) return [];
	const [min, max] = AUTOMATION_RANGES[param];
	const byTime = new Map<number, number>();
	for (const point of points.slice(0, MAX_AUTOMATION_POINTS)) {
		const time = Number((point as AudioAutomationPoint)?.time);
		const value = Number((point as AudioAutomationPoint)?.value);
		if (!Number.isFinite(time) || !Number.isFinite(value) || time < 0) continue;
		byTime.set(time, Math.min(max, Math.max(min, value)));
	}
	return [...byTime.entries()]
		.sort(([left], [right]) => left - right)
		.map(([time, value]) => ({ time, value }));
}

/** Only the curves that have points; undefined when none do. */
export function normalizeAutomation(
	automation: Partial<Record<AutomationParam, unknown>> | undefined
): AudioMixAutomation | undefined {
	if (!automation) return undefined;
	const normalized: AudioMixAutomation = {};
	for (const param of Object.keys(AUTOMATION_RANGES) as AutomationParam[]) {
		const points = normalizeAutomationPoints({
			points: automation[param],
			param,
		});
		if (points.length > 0) normalized[param] = points;
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function hasAutomation(automation?: AudioMixAutomation): boolean {
	return Boolean(automation?.gainDb?.length || automation?.pan?.length);
}

/** The curve's value at `time`; `points` must be sorted and non-empty. */
export function automationValueAt({
	points,
	time,
}: {
	points: AudioAutomationPoint[];
	time: number;
}): number {
	const first = points[0];
	const last = points[points.length - 1];
	if (time <= first.time) return first.value;
	if (time >= last.time) return last.value;
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (points[middle].time <= time) low = middle;
		else high = middle;
	}
	const from = points[low];
	const to = points[high];
	const span = to.time - from.time;
	return span <= 0
		? to.value
		: from.value + ((to.value - from.value) * (time - from.time)) / span;
}

/**
 * The curve with extra points along each sloped segment, so that straight
 * lines between them in another unit (linear gain for a dB curve) stay
 * within a hair of it. Flat segments need none.
 */
export function sampleAutomation({
	points,
	maxStepSeconds = 0.01,
	maxStepsPerSegment = 64,
}: {
	points: AudioAutomationPoint[];
	maxStepSeconds?: number;
	maxStepsPerSegment?: number;
}): AudioAutomationPoint[] {
	const sampled: AudioAutomationPoint[] = [];
	for (const [index, point] of points.entries()) {
		const next = points[index + 1];
		sampled.push(point);
		if (!next || next.value === point.value) continue;
		const span = next.time - point.time;
		const steps = Math.min(
			maxStepsPerSegment,
			Math.max(1, Math.ceil(span / maxStepSeconds))
		);
		for (let step = 1; step < steps; step += 1) {
			const fraction = step / steps;
			sampled.push({
				time: point.time + span * fraction,
				value: point.value + (next.value - point.value) * fraction,
			});
		}
	}
	return sampled;
}
