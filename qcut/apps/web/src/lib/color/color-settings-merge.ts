import type { MediaAdjustments, MediaColorSettings } from "@/types/timeline";
import { COLOR_KEYFRAME_DEFINITIONS } from "./color-properties";

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

/**
 * Range check for a grade patch from the editor API. The editor's own sliders
 * clamp to these ranges (COLOR_KEYFRAME_DEFINITIONS), but a JSON payload can
 * name any number — `basic.exposure: 20` on a −5..5 EV control renders a
 * white frame. Out-of-range values are refused with the allowed range, the
 * same way a misspelt adjustments field is refused, instead of being clamped
 * behind the caller's back.
 *
 * Only known numeric leaves are checked; fields without a published range
 * (curves, LUT payloads, keyframe lists…) pass through untouched.
 */
export function assertColorPatchInRange({
	patch,
	prefix = "color",
}: {
	patch: Record<string, unknown>;
	prefix?: string;
}): void {
	const walk = (value: unknown, path: string[]): void => {
		if (!isPlainObject(value)) return;
		for (const [key, entry] of Object.entries(value)) {
			const nextPath = [...path, key];
			const definition =
				COLOR_KEYFRAME_DEFINITIONS[
					nextPath.join(".") as keyof typeof COLOR_KEYFRAME_DEFINITIONS
				];
			if (definition && typeof entry === "number") {
				if (
					!Number.isFinite(entry) ||
					entry < definition.min ||
					entry > definition.max
				) {
					throw new Error(
						`${prefix}.${nextPath.join(".")} must be ${definition.min}..${definition.max} (got ${entry})`
					);
				}
				continue;
			}
			walk(entry, nextPath);
		}
	};
	walk(patch, []);
}

/**
 * The eight legacy fields mirror `color.basic`, so they obey the same ranges.
 */
export function assertAdjustmentsPatchInRange({
	patch,
}: {
	patch: Partial<MediaAdjustments>;
}): void {
	for (const [key, entry] of Object.entries(patch)) {
		const definition =
			COLOR_KEYFRAME_DEFINITIONS[
				`basic.${key}` as keyof typeof COLOR_KEYFRAME_DEFINITIONS
			];
		if (!definition || typeof entry !== "number") continue;
		if (
			!Number.isFinite(entry) ||
			entry < definition.min ||
			entry > definition.max
		) {
			throw new Error(
				`adjustments.${key} must be ${definition.min}..${definition.max} (got ${entry})`
			);
		}
	}
}
