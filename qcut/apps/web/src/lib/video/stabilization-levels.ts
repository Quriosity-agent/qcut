import type { StabilizationProfile } from "@/lib/stabilization/stabilization-plan";

/**
 * Discrete stabilization levels for the 视频防抖 section's level dropdown.
 *
 * The stored value stays the 0–100 `enhancements.stabilization` number. The
 * in-house stabilizer (preview and canvas export) maps each level to a
 * smoothing window and a crop scale through `STABILIZATION_PROFILES`; the
 * FFmpeg CLI/API engines still quantize the same value to a deshake radius of
 * `ceil(value / 100 * 4) * 16`, i.e. exactly four steps: 16, 32, 48 and 64 px.
 * The level enum maps one-to-one onto those steps.
 */
export type StabilizationLevel = "low" | "recommended" | "high" | "max";

export const STABILIZATION_LEVELS: ReadonlyArray<{
	level: StabilizationLevel;
	/** Stored `enhancements.stabilization` value. */
	value: number;
	/** Resulting deshake search radius in pixels. */
	radius: number;
	labelKey:
		| "mediaProperties.stabilizationLevel.low"
		| "mediaProperties.stabilizationLevel.recommended"
		| "mediaProperties.stabilizationLevel.high"
		| "mediaProperties.stabilizationLevel.max";
}> = [
	{
		level: "low",
		value: 25,
		radius: 16,
		labelKey: "mediaProperties.stabilizationLevel.low",
	},
	{
		level: "recommended",
		value: 50,
		radius: 32,
		labelKey: "mediaProperties.stabilizationLevel.recommended",
	},
	{
		level: "high",
		value: 75,
		radius: 48,
		labelKey: "mediaProperties.stabilizationLevel.high",
	},
	{
		level: "max",
		value: 100,
		radius: 64,
		labelKey: "mediaProperties.stabilizationLevel.max",
	},
];

export const DEFAULT_STABILIZATION_LEVEL: StabilizationLevel = "recommended";

/**
 * In-house stabilizer tuning per level: a wider smoothing window follows the
 * camera path less closely, and a smaller crop scale leaves more room for the
 * correction before the lens motion constraint has to clip it.
 */
export const STABILIZATION_PROFILES: Record<
	StabilizationLevel,
	StabilizationProfile
> = {
	low: { smoothingSeconds: 0.6, cropScale: 0.94 },
	recommended: { smoothingSeconds: 1.2, cropScale: 0.9 },
	high: { smoothingSeconds: 2, cropScale: 0.86 },
	max: { smoothingSeconds: 3, cropScale: 0.8 },
};

/** Profile for a stored 0–100 value; null when stabilization is off. */
export function stabilizationProfileForValue(
	value: number
): StabilizationProfile | null {
	const level = stabilizationLevelForValue(value);
	return level ? STABILIZATION_PROFILES[level] : null;
}

/** Mirror of the backend quantization, kept here so the UI can be tested against it. */
export function deshakeRadiusForStabilization(value: number): number {
	if (value <= 0) return 0;
	return Math.ceil((Math.min(100, value) / 100) * 4) * 16;
}

/** Level whose deshake radius matches a stored 0–100 value; undefined when off. */
export function stabilizationLevelForValue(
	value: number
): StabilizationLevel | undefined {
	if (value <= 0) return undefined;
	const radius = deshakeRadiusForStabilization(value);
	return STABILIZATION_LEVELS.find((entry) => entry.radius === radius)?.level;
}

export function stabilizationValueForLevel(level: StabilizationLevel): number {
	return (
		STABILIZATION_LEVELS.find((entry) => entry.level === level)?.value ?? 0
	);
}
