import type { MediaAdjustments, MediaColorSettings } from "@/types/timeline";

/**
 * Merging a partial grade from the editor API into a clip's current grade:
 * the API gives only the fields it changes, the way the colour panel edits
 * one slider at a time, so a patch `{ basic: { contrast: 20 } }` must keep
 * every other value the clip already has.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Objects merge key by key at any depth; arrays and primitives replace. */
function deepMerge(
	current: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		const existing = current[key];
		next[key] =
			isPlainObject(value) && isPlainObject(existing)
				? deepMerge(existing, value)
				: value;
	}
	return next;
}

export function mergeMediaColorSettings({
	current,
	patch,
}: {
	current: MediaColorSettings;
	patch: Record<string, unknown>;
}): MediaColorSettings {
	return deepMerge(
		current as unknown as Record<string, unknown>,
		patch
	) as unknown as MediaColorSettings;
}

export const MEDIA_ADJUSTMENT_KEYS = [
	"brightness",
	"contrast",
	"saturation",
	"temperature",
	"tint",
	"sharpness",
	"fade",
	"vignette",
] as const satisfies readonly (keyof MediaAdjustments)[];

/**
 * A partial `adjustments` object from the API: only the eight legacy fields,
 * each a finite number. Anything else is a typo the caller should hear about.
 */
export function readMediaAdjustmentsPatch({
	value,
}: {
	value: unknown;
}): Partial<MediaAdjustments> {
	if (!isPlainObject(value)) {
		throw new Error("adjustments must be an object");
	}
	const known = new Set<string>(MEDIA_ADJUSTMENT_KEYS);
	const patch: Partial<MediaAdjustments> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!known.has(key)) {
			throw new Error(
				`adjustments.${key} is not a field; expected ${MEDIA_ADJUSTMENT_KEYS.join(", ")}`
			);
		}
		if (typeof entry !== "number" || !Number.isFinite(entry)) {
			throw new Error(`adjustments.${key} must be a number`);
		}
		patch[key as keyof MediaAdjustments] = entry;
	}
	return patch;
}
