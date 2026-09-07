/**
 * Timeline ruler calibration for the editor pointer CLI: recover the
 * time → x mapping from the ruler tick labels so `--to-time` can scrub the
 * playhead with a real drag.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer-ruler
 */

import type { EditorSnapshotResponse } from "../../types/claude-api.js";
import type { EditorApiClient } from "../editor/editor-api-client.js";

/** Ruler geometry recovered from the timeline's tick labels ("0s", "5s", ...). */
export interface TimelineRulerCalibration {
	originX: number;
	pixelsPerSecond: number;
	rulerY: number;
	labelCount: number;
}

const RULER_LABEL_PATTERN = /^(\d+(?:\.\d+)?)s$/;

/**
 * Recover time → x from the ruler labels in a full (non-interactive) snapshot.
 * Labels sit at `time * pixelsPerSecond` inside the ruler, so two or more of
 * them give the scale and origin without touching renderer internals.
 */
export interface TimelineRulerCalibrationAttempt {
	calibration: TimelineRulerCalibration | null;
	/** Where the labels came from, or why calibration failed. */
	source: "ruler-labels" | "snapshot";
	reason?: string;
	labelCount: number;
}

interface RulerLabelPoint {
	time: number;
	x: number;
	y: number;
}

async function readRulerLabelPoints({
	client,
	windowId,
}: {
	client: EditorApiClient;
	windowId?: number;
}): Promise<{
	points: RulerLabelPoint[];
	source: "ruler-labels" | "snapshot";
	reason?: string;
}> {
	try {
		const probe = await client.get<{
			labels?: Array<{ time: number; x: number; y: number; height: number }>;
		}>(
			"/api/claude/pointer/ruler-labels",
			windowId !== undefined ? { windowId: String(windowId) } : undefined
		);
		if (Array.isArray(probe.labels)) {
			return {
				points: probe.labels
					.filter((label) => Number.isFinite(label.time))
					.map((label) => ({
						time: label.time,
						x: label.x,
						y: label.y + label.height / 2,
					})),
				source: "ruler-labels",
			};
		}
	} catch {
		// Older editors do not serve the probe; fall back to a full snapshot.
	}
	const snapshot = await client.get<EditorSnapshotResponse>(
		"/api/claude/snapshot",
		{
			interactive: "false",
			depth: "40",
			maxNodes: "12000",
			maxBytes: String(2 * 1024 * 1024),
		}
	);
	if (snapshot.truncated === true) {
		return {
			points: [],
			source: "snapshot",
			reason: `snapshot truncated: ${snapshot.reason ?? "size limit"}`,
		};
	}
	const points = snapshot.elements
		.map((element) => {
			const text = (element.textPreview ?? element.name ?? "").trim();
			const match = RULER_LABEL_PATTERN.exec(text);
			if (!match || !element.bounds || element.bounds.width <= 0) return null;
			return {
				time: Number.parseFloat(match[1]),
				x: element.bounds.x,
				y: element.bounds.y + element.bounds.height / 2,
			};
		})
		.filter(
			(label): label is RulerLabelPoint =>
				label !== null && Number.isFinite(label.time)
		);
	return { points, source: "snapshot" };
}

export async function calibrateTimelineRuler({
	client,
}: {
	client: EditorApiClient;
}): Promise<TimelineRulerCalibration | null> {
	return (await attemptTimelineRulerCalibration({ client })).calibration;
}

/**
 * Recover time → x from the ruler labels. The renderer probe is preferred
 * because a full snapshot of the editor can be truncated; the result carries
 * the reason when no usable label row was found.
 */
export async function attemptTimelineRulerCalibration({
	client,
	windowId,
}: {
	client: EditorApiClient;
	windowId?: number;
}): Promise<TimelineRulerCalibrationAttempt> {
	const {
		points: labels,
		source,
		reason,
	} = await readRulerLabelPoints({
		client,
		windowId,
	});
	if (reason) return { calibration: null, source, reason, labelCount: 0 };
	// Labels share the ruler row; keep the most populated row so a stray
	// "5s" badge elsewhere in the UI cannot skew the fit.
	const rows = new Map<number, RulerLabelPoint[]>();
	for (const label of labels) {
		const key = Math.round(label.y / 4);
		rows.set(key, [...(rows.get(key) ?? []), label]);
	}
	const row = [...rows.values()].sort((a, b) => b.length - a.length)[0];
	if (!row || row.length < 2) {
		return {
			calibration: null,
			source,
			reason: `found ${labels.length} ruler label(s); need at least two on one row`,
			labelCount: labels.length,
		};
	}
	const byTime = new Map<number, RulerLabelPoint>();
	for (const label of row) byTime.set(label.time, label);
	const points = [...byTime.values()].sort((a, b) => a.time - b.time);
	if (points.length < 2) {
		return {
			calibration: null,
			source,
			reason: "ruler labels do not cover two distinct times",
			labelCount: labels.length,
		};
	}
	const meanT = points.reduce((sum, p) => sum + p.time, 0) / points.length;
	const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
	let numerator = 0;
	let denominator = 0;
	for (const point of points) {
		numerator += (point.time - meanT) * (point.x - meanX);
		denominator += (point.time - meanT) ** 2;
	}
	const pixelsPerSecond = denominator > 0 ? numerator / denominator : 0;
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		return {
			calibration: null,
			source,
			reason: "ruler labels do not increase with time",
			labelCount: labels.length,
		};
	}
	return {
		calibration: {
			originX: meanX - meanT * pixelsPerSecond,
			pixelsPerSecond,
			rulerY: points.reduce((sum, p) => sum + p.y, 0) / points.length,
			labelCount: points.length,
		},
		source,
		labelCount: labels.length,
	};
}

export function rulerTimeToX({
	calibration,
	time,
}: {
	calibration: TimelineRulerCalibration;
	time: number;
}): number {
	return calibration.originX + time * calibration.pixelsPerSecond;
}

export function rulerXToTime({
	calibration,
	x,
}: {
	calibration: TimelineRulerCalibration;
	x: number;
}): number {
	return Math.max(0, (x - calibration.originX) / calibration.pixelsPerSecond);
}
