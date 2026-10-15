/**
 * Level and pan automation as FFmpeg filters, read the way the editor reads
 * it (apps/web/src/lib/audio/audio-mix-automation.ts): straight lines between
 * points, in dB for level, holding before the first point and after the
 * last. `t` is timeline time: every track's clips are placed from 0.
 *
 * @module electron/ffmpeg/audio-mix-automation
 */

import type { AudioAutomationPoint } from "./types";

function num(value: number): string {
	const rounded = Number(value.toFixed(6));
	return rounded < 0 ? `(${rounded})` : String(rounded);
}

function line(from: AudioAutomationPoint, to: AudioAutomationPoint): string {
	const span = to.time - from.time;
	if (span <= 0 || from.value === to.value) return num(to.value);
	return `${num(from.value)}+${num(to.value - from.value)}*(t-${num(from.time)})/${num(span)}`;
}

/** Segments `low`..`high` as a balanced tree of ifs, so depth stays log n. */
function segments(
	points: AudioAutomationPoint[],
	low: number,
	high: number
): string {
	if (low === high) return line(points[low], points[low + 1]);
	const middle = (low + high) >> 1;
	return `if(lt(t,${num(points[middle + 1].time)}),${segments(points, low, middle)},${segments(points, middle + 1, high)})`;
}

/** The curve's value at time `t`; `points` sorted and non-empty. */
export function automationExpression(points: AudioAutomationPoint[]): string {
	const first = points[0];
	const last = points[points.length - 1];
	if (points.length === 1) return num(first.value);
	return `if(lt(t,${num(first.time)}),${num(first.value)},if(gte(t,${num(last.time)}),${num(last.value)},${segments(points, 0, points.length - 2)}))`;
}

/**
 * A level curve: the volume is re-read every 10 ms frame, which keeps a
 * fade's steps far below what can be heard.
 */
export function automatedLevelFilters(
	points: AudioAutomationPoint[]
): string[] {
	return [
		"asetnsamples=n=480:p=0",
		`volume=volume='pow(10,(${automationExpression(points)})/20)':eval=frame`,
	];
}

/**
 * A pan curve with the editor's StereoPannerNode law for stereo input: the
 * far channel fades by cos, the near one gains the other at sin.
 */
export function automatedPanFilters(points: AudioAutomationPoint[]): string[] {
	const pan = `st(0,${automationExpression(points)})`;
	const left = `${pan};if(lte(ld(0),0),val(0)+val(1)*cos((ld(0)+1)*PI/2),val(0)*cos(ld(0)*PI/2))`;
	const right = `${pan};if(lte(ld(0),0),val(1)*sin((ld(0)+1)*PI/2),val(1)+val(0)*sin(ld(0)*PI/2))`;
	return [
		"aformat=channel_layouts=stereo",
		`aeval=exprs='${left}|${right}':c=same`,
	];
}
