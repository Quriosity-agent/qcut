import type { BeautyLabIndependentFrameRequest } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";

/** Edits the independent engine cannot run on a timeline clip. */
export type IndependentPortraitIssue =
	| { code: "unsupported"; selections: string[] }
	| {
			code: "scope";
			selections: Array<"faces" | "manual-retouch" | "manual-body">;
	  };

/** What the installed engine supports, from `beautyLab.inspectIndependent`. */
export interface IndependentPortraitSupport {
	controls: string[];
	makeupCards: string[];
}

const SKIN_TONE_KEYS = new Set([
	"face_adjust_skin_Intensity",
	"face_adjust_skin_ColdWarm",
]);

function faceHasEdits({
	face,
}: {
	face: NonNullable<MediaPortraitAdjustments["faces"]>[number];
}) {
	return (
		Object.values(face.values ?? {}).some((value) => (value ?? 0) !== 0) ||
		Object.values(face.makeup ?? {}).some(
			(selection) => (selection?.intensity ?? 0) > 0
		)
	);
}

/**
 * Converts a clip's portrait edits into the independent engine's request.
 *
 * The engine applies one set of edits to every face and runs a subset of the
 * native controls. Anything outside that is returned as an issue rather than
 * dropped, so an unsupported edit fails visibly instead of rendering without
 * it. `support` is optional because the engine validates controls itself.
 */
export function independentPortraitRequest({
	adjustments,
	support,
}: {
	adjustments: MediaPortraitAdjustments;
	support?: IndependentPortraitSupport;
}):
	| { adjustments: BeautyLabIndependentFrameRequest["adjustments"] }
	| { issue: IndependentPortraitIssue } {
	const scope: Array<"faces" | "manual-retouch" | "manual-body"> = [];
	if (
		adjustments.faceTarget?.mode === "single" ||
		(adjustments.faces ?? []).some((face) => faceHasEdits({ face }))
	)
		scope.push("faces");
	if ((adjustments.manualRetouch?.strokes.length ?? 0) > 0)
		scope.push("manual-retouch");
	if (
		Object.values(adjustments.manualBody ?? {}).some(
			(tool) => (tool?.intensity ?? 0) !== 0
		)
	)
		scope.push("manual-body");
	if (scope.length > 0) return { issue: { code: "scope", selections: scope } };

	const values: Record<string, number> = {};
	const unsupported: string[] = [];
	for (const [key, value] of Object.entries(adjustments.values)) {
		if (value === undefined || value === 0) continue;
		// Native ignores skin-tone strength once the skin tone is switched off.
		if (adjustments.skinToneResourceId === null && SKIN_TONE_KEYS.has(key))
			continue;
		if (support && !support.controls.includes(key)) unsupported.push(key);
		else values[key] = value;
	}
	const makeup: Record<string, { cardId: string; intensity: number }> = {};
	for (const [category, selection] of Object.entries(
		adjustments.makeup ?? {}
	)) {
		if (!selection || selection.intensity <= 0) continue;
		if (support && !support.makeupCards.includes(selection.cardId))
			unsupported.push(selection.cardId);
		else
			makeup[category] = {
				cardId: selection.cardId,
				intensity: selection.intensity,
			};
	}
	if (unsupported.length > 0)
		return { issue: { code: "unsupported", selections: unsupported } };
	return {
		adjustments: {
			enabled: true,
			values,
			...(Object.keys(makeup).length > 0 ? { makeup } : {}),
		},
	};
}

/** One-line description of an issue for errors and export failures. */
export function independentPortraitIssueMessage({
	issue,
}: {
	issue: IndependentPortraitIssue;
}) {
	if (issue.code === "unsupported")
		return `自研美颜不支持这些参数：${issue.selections.join("、")}`;
	const labels = {
		faces: "单人或分人物设置",
		"manual-retouch": "手动精修",
		"manual-body": "手动美体",
	} as const;
	return `自研美颜只能对全部人脸统一处理，请先清除：${issue.selections
		.map((selection) => labels[selection])
		.join("、")}`;
}
