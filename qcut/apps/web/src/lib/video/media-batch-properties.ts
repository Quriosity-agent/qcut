import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { getMediaKeyframeValue, upsertMediaKeyframe } from "./video-properties";
import { getMediaTimelineDuration } from "./video-timing";

export const MEDIA_BATCH_PROPERTIES = [
	"x",
	"y",
	"scaleX",
	"scaleY",
	"rotation",
	"opacity",
] as const;

export type MediaBatchProperty = (typeof MEDIA_BATCH_PROPERTIES)[number];
export type MediaBatchMode = "set" | "adjust";

export interface MediaBatchEdit {
	elements: Array<{ trackId: string; elementId: string }>;
	property: MediaBatchProperty;
	mode: MediaBatchMode;
	/** Scale and opacity use displayed percent units. */
	value: number;
	currentTime: number;
}

export interface MediaBatchSelection {
	trackId: string;
	element: MediaElement;
}

function localFrame({
	element,
	currentTime,
	fps,
}: {
	element: MediaElement;
	currentTime: number;
	fps: number;
}): number {
	return Math.min(
		Math.max(1, Math.round(getMediaTimelineDuration(element, fps) * fps)),
		Math.max(0, Math.round((currentTime - element.startTime) * fps))
	);
}

export function readMediaBatchValue({
	element,
	property,
	currentTime,
	fps,
}: {
	element: MediaElement;
	property: MediaBatchProperty;
	currentTime: number;
	fps: number;
}): number {
	const frame = localFrame({ element, currentTime, fps });
	const value = getMediaKeyframeValue({
		element,
		property,
		currentTime: element.startTime + frame / fps,
		fps,
	});
	return property === "opacity" || property.startsWith("scale")
		? value * 100
		: value;
}

function updatedMedia({
	element,
	edit,
	fps,
}: {
	element: MediaElement;
	edit: MediaBatchEdit;
	fps: number;
}): MediaElement | null {
	const { property, mode, value, currentTime } = edit;
	const previous = readMediaBatchValue({ element, property, currentTime, fps });
	const isScale = property === "scaleX" || property === "scaleY";
	const requested =
		mode === "set"
			? value
			: isScale
				? previous * (1 + value / 100)
				: previous + value;
	if (!Number.isFinite(requested)) return null;
	const bounded = isScale
		? Math.min(400, Math.max(1, requested))
		: property === "opacity"
			? Math.min(100, Math.max(0, requested))
			: requested;
	const nextValue = isScale || property === "opacity" ? bounded / 100 : bounded;
	const properties: MediaBatchProperty[] =
		isScale && (element.maintainAspectRatio ?? true)
			? ["scaleX", "scaleY"]
			: [property];
	const frame = localFrame({ element, currentTime, fps });
	let next = element;
	for (const target of properties) {
		const previousValue = readMediaBatchValue({
			element,
			property: target,
			currentTime,
			fps,
		});
		if (Math.abs(previousValue - bounded) < 1e-9) continue;
		next = { ...next, [target]: nextValue };
		const keyframes = element.keyframes?.[target];
		if (!keyframes?.length) continue;
		const existing = keyframes.find((keyframe) => keyframe.frame === frame);
		next.keyframes = {
			...next.keyframes,
			[target]: upsertMediaKeyframe({
				keyframes,
				keyframe: {
					...existing,
					id: existing?.id ?? crypto.randomUUID(),
					frame,
					value: nextValue,
					easing: existing?.easing ?? "linear",
				},
			}),
		};
	}
	return next;
}

export function planMediaBatchEdit({
	tracks,
	edit,
	fps,
}: {
	tracks: TimelineTrack[];
	edit: MediaBatchEdit;
	fps: number;
}): { tracks: TimelineTrack[]; updatedCount: number } {
	const unchanged = { tracks, updatedCount: 0 };
	if (edit.mode === "adjust" && edit.value === 0) return unchanged;
	if (
		!MEDIA_BATCH_PROPERTIES.includes(edit.property) ||
		!["set", "adjust"].includes(edit.mode) ||
		!Number.isFinite(edit.value) ||
		!Number.isFinite(edit.currentTime) ||
		!Number.isFinite(fps) ||
		fps <= 0
	)
		return unchanged;
	const selection = new Map<string, Set<string>>();
	for (const { trackId, elementId } of edit.elements) {
		const track = tracks.find((candidate) => candidate.id === trackId);
		const element = track?.elements.find(
			(candidate) => candidate.id === elementId
		);
		// Explicit selections are atomic, including a stale or locked member.
		if (!track || track.locked || element?.type !== "media") return unchanged;
		const ids = selection.get(trackId) ?? new Set<string>();
		ids.add(elementId);
		selection.set(trackId, ids);
	}
	let updatedCount = 0;
	let invalidResult = false;
	const nextTracks = tracks.map((track) => {
		const ids = selection.get(track.id);
		if (!ids) return track;
		let changed = false;
		const elements = track.elements.map((element) => {
			if (!ids.has(element.id) || element.type !== "media") return element;
			const next = updatedMedia({ element, edit, fps });
			if (!next) {
				invalidResult = true;
				return element;
			}
			if (next !== element) {
				updatedCount += 1;
				changed = true;
			}
			return next;
		});
		return changed ? { ...track, elements } : track;
	});
	return updatedCount > 0 && !invalidResult
		? { tracks: nextTracks, updatedCount }
		: unchanged;
}
