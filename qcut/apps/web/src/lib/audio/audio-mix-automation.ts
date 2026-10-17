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

/**
 * A curve after the span [startTime, endTime) is cut out of the timeline:
 * points inside the span go, points after it move earlier by the span's
 * length, and where the span had points on both sides the value at its end
 * is kept at the join so the curve continues from there, the way a ripple
 * delete joins the clips.
 */
export function ripplePoints({
	points,
	startTime,
	endTime,
}: {
	points: AudioAutomationPoint[];
	startTime: number;
	endTime: number;
}): AudioAutomationPoint[] {
	const removed = endTime - startTime;
	if (removed <= 0 || points.length === 0) return points;
	const sorted = [...points].sort((a, b) => a.time - b.time);
	const before = sorted.filter((point) => point.time < startTime);
	const inside = sorted.filter(
		(point) => point.time >= startTime && point.time < endTime
	);
	const after = sorted
		.filter((point) => point.time >= endTime)
		.map((point) => ({ time: point.time - removed, value: point.value }));
	if (inside.length > 0 && before.length > 0 && after.length > 0) {
		// The cut lands mid-curve: pin the value the curve had at the cut's
		// far side so the join does not interpolate across the removed span.
		const joinValue = automationValueAt({ points: sorted, time: endTime });
		if (after[0].time > startTime) {
			after.unshift({ time: startTime, value: joinValue });
		}
	}
	return [...before, ...after];
}

/** Every curve of `automation` rippled by `ripplePoints`; undefined when none remain. */
export function rippleAutomation({
	automation,
	startTime,
	endTime,
}: {
	automation: AudioMixAutomation | undefined;
	startTime: number;
	endTime: number;
}): AudioMixAutomation | undefined {
	if (!automation) return undefined;
	const rippled: AudioMixAutomation = {};
	for (const param of Object.keys(AUTOMATION_RANGES) as AutomationParam[]) {
		const points = automation[param];
		if (!points?.length) continue;
		const next = ripplePoints({ points, startTime, endTime });
		if (next.length > 0) rippled[param] = next;
	}
	return Object.keys(rippled).length > 0 ? rippled : undefined;
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
