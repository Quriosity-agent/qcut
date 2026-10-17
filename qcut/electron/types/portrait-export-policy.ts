/**
 * Export policy for portrait (beauty and body) edits.
 *
 * Both portrait engines run in the renderer — the native runtime and the
 * independent engine's frame queue — so a clip whose portrait edits change
 * the picture exports through the renderer's engine. Whether they change it
 * is editor-core's own test, the one the preview uses: numeric controls,
 * makeup, manual body tools, manual retouch strokes and per-person edits.
 * (Counting only numeric controls sent a clip with nothing but makeup or a
 * stretch band to the native engine, which exported it without them.)
 *
 * The main process cannot load packages/ at runtime, so this mirrors
 * `hasMediaPortraitAdjustments` from @qcut/editor-core;
 * portrait-export-policy-mirror.test.ts keeps the two in step.
 */

import type { ClaudeTimeline } from "./claude-api.js";

const SKIN_TONE_KEYS = new Set([
	"face_adjust_skin_Intensity",
	"face_adjust_skin_ColdWarm",
]);
const MANUAL_BODY_TOOLS = ["stretch", "slim", "zoom"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activeNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

/** Any control other than a switched-off skin tone's strength is moved. */
function controlsMoved({
	values,
	skinToneOff,
}: {
	values: unknown;
	skinToneOff: boolean;
}) {
	if (!isRecord(values)) return false;
	return Object.entries(values).some(([key, value]) =>
		key.startsWith("face_adjust_") || key.startsWith("body_adjust_")
			? !(skinToneOff && SKIN_TONE_KEYS.has(key)) && activeNumber(value)
			: false
	);
}

function makeupApplied({ makeup }: { makeup: unknown }) {
	if (!isRecord(makeup)) return false;
	return Object.values(makeup).some(
		(selection) =>
			isRecord(selection) &&
			typeof selection.cardId === "string" &&
			typeof selection.intensity === "number" &&
			Number.isFinite(selection.intensity) &&
			selection.intensity > 0
	);
}

/** Whether a clip's stored `portraitAdjustments` change its picture. */
export function portraitAdjustmentsAreActive({
	candidate,
}: {
	candidate: unknown;
}): boolean {
	if (!isRecord(candidate) || candidate.enabled !== true) return false;
	const skinToneOff = candidate.skinToneResourceId === null;
	if (controlsMoved({ values: candidate.values, skinToneOff })) return true;
	const retouch = isRecord(candidate.manualRetouch)
		? candidate.manualRetouch.strokes
		: undefined;
	if (
		Array.isArray(retouch) &&
		retouch.some(
			(stroke) =>
				isRecord(stroke) &&
				Array.isArray(stroke.points) &&
				stroke.points.length >= 2
		)
	)
		return true;
	const body = isRecord(candidate.manualBody) ? candidate.manualBody : {};
	if (
		MANUAL_BODY_TOOLS.some((tool) => {
			const settings = body[tool];
			return isRecord(settings) && activeNumber(settings.intensity);
		})
	)
		return true;
	if (makeupApplied({ makeup: candidate.makeup })) return true;
	return (
		Array.isArray(candidate.faces) &&
		candidate.faces.some(
			(face) =>
				isRecord(face) &&
				(controlsMoved({ values: face.values, skinToneOff }) ||
					makeupApplied({ makeup: face.makeup }))
		)
	);
}

/** Whether any clip needs the renderer for its portrait edits or eye correction. */
export function timelineRequiresRendererPortraitExport({
	timeline,
}: {
	timeline: ClaudeTimeline;
}): boolean {
	for (const track of timeline.tracks) {
		for (const element of track.elements) {
			if (element.type !== "media" && element.type !== "video") continue;
			const enhancements = isRecord(element.enhancements)
				? element.enhancements
				: null;
			const eyeCorrection = enhancements?.labEyeCorrection;
			if (
				typeof eyeCorrection === "number" &&
				Number.isFinite(eyeCorrection) &&
				eyeCorrection > 0
			) {
				return true;
			}
			if (
				portraitAdjustmentsAreActive({
					candidate: element.portraitAdjustments,
				})
			) {
				return true;
			}
		}
	}
	return false;
}
