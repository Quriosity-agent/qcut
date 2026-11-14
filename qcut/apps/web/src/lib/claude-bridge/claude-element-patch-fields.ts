/**
 * Which fields an element patch (`editor element patch`, a manifest update)
 * can change, by element type.
 */

import { CAPTION_PATCH_FIELDS } from "./claude-caption-patch";

/** Keys every element patch may carry (ids and timing). */
const COMMON_PATCH_FIELDS = new Set([
	"elementId",
	"type",
	"startTime",
	"colorLabel",
	"trimStart",
	"trimEnd",
	"duration",
	"endTime",
]);

/**
 * The fields a patch can change per element type. Text patches are schema
 * driven (`getClaudeTextProperties`) and are not checked here.
 */
const PATCH_FIELDS_BY_TYPE: Partial<Record<string, ReadonlySet<string>>> = {
	media: new Set([
		"name",
		"fitMode",
		"x",
		"y",
		"rotation",
		"scaleX",
		"scaleY",
		"opacity",
		// How the clip sits on what is under it; `blendEnabled: false` keeps
		// the mode and opacity but stops applying them.
		"blendMode",
		"blendEnabled",
		"playbackRate",
		"speedKeyframes",
		"reverse",
		"freezeFrameTime",
		"freezeFrameDuration",
		"preservePitch",
		"frameInterpolation",
		"style",
		"portraitAdjustments",
		"enhancements",
		"keyframes",
		"audio",
		"filterStack",
		"color",
		"adjustments",
		// Replacing the source in place (N24): claude-media-replace.ts.
		"mediaId",
		"sourceDuration",
	]),
	adjustment: new Set(["name", "opacity", "color", "adjustments", "masks"]),
	markdown: new Set(["content"]),
	captions: new Set(CAPTION_PATCH_FIELDS),
	sticker: new Set([
		"mediaId",
		"x",
		"y",
		"width",
		"height",
		"stickerGeometrySpace",
		"stickerId",
		"stickerAssetId",
		"stickerRuntime",
		"rotation",
		"opacity",
	]),
};

/**
 * Fields the element's type cannot use. A patch made only of such fields is
 * an error (it used to answer `updated: true` while changing nothing); a
 * patch that also carries supported fields applies them and reports the rest.
 */
export function unsupportedPatchFields({
	elementType,
	changes,
}: {
	elementType: string;
	changes: Record<string, unknown>;
}): string[] {
	const typed = PATCH_FIELDS_BY_TYPE[elementType];
	if (!typed) return [];
	return Object.keys(changes).filter(
		(key) =>
			changes[key] !== undefined &&
			!COMMON_PATCH_FIELDS.has(key) &&
			!typed.has(key)
	);
}

/** The fields a type's patch can change, for an error that has to list them. */
export function patchableFields({
	elementType,
}: {
	elementType: string;
}): string[] {
	const typed = PATCH_FIELDS_BY_TYPE[elementType];
	if (!typed) return [];
	return [...COMMON_PATCH_FIELDS, ...typed].filter(
		(key) => key !== "elementId" && key !== "type"
	);
}
