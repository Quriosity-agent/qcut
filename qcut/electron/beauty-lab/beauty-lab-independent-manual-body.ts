/**
 * Manual body settings the independent engine renders, in the editor's
 * ranges. Every tool's intensity is −50..50. The stretch band's upper and
 * bottom handles are shares of the height from the bottom, at least 0.02
 * apart. The slim box has a centre (y from the bottom), a size as shares of
 * the frame and a rotation in degrees. The zoom circle has a centre and a
 * radius as a share of the frame's shorter side. Which tools the installed
 * engine renders is its catalog's call (`manualBodyTools`).
 * @module electron/beauty-lab/beauty-lab-independent-manual-body
 */

import { z } from "zod";

const intensity = z.number().finite().min(-50).max(50);
const share = z.number().finite().min(0).max(1);
const size = z.number().finite().min(0.02).max(1);

export const independentManualBodySchema = z
	.object({
		stretch: z
			.object({
				intensity,
				upper: z.number().finite().min(0.02).max(1),
				bottom: z.number().finite().min(0).max(0.98),
			})
			.strict()
			.refine(
				({ upper, bottom }) => upper - bottom >= 0.02 - 1e-9,
				"Independent stretch band must be at least 0.02 tall"
			)
			.optional(),
		slim: z
			.object({
				intensity,
				x: share,
				y: share,
				width: size,
				height: size,
				rotation: z.number().finite().min(-180).max(180),
			})
			.strict()
			.optional(),
		zoom: z
			.object({
				intensity,
				x: share,
				y: share,
				radius: z.number().finite().min(0.01).max(0.5),
			})
			.strict()
			.optional(),
	})
	.strict();

export type IndependentManualBody = z.infer<typeof independentManualBodySchema>;

/** Each tool's fields in a fixed order, for keys that must not depend on how they were written. */
const FIELDS = {
	stretch: ["intensity", "upper", "bottom"],
	slim: ["intensity", "x", "y", "width", "height", "rotation"],
	zoom: ["intensity", "x", "y", "radius"],
} as const;

function withoutNegativeZero<T extends Record<string, number>>(settings: T): T {
	return Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [
			key,
			Object.is(value, -0) ? 0 : value,
		])
	) as T;
}

/**
 * The tools that change the picture, as the engine's canonical plan keeps
 * them (idle tools are dropped, −0 becomes 0); undefined when none does.
 */
export function canonicalIndependentManualBody({
	manualBody,
}: {
	manualBody: IndependentManualBody | undefined;
}): IndependentManualBody | undefined {
	const { stretch, slim, zoom } = manualBody ?? {};
	const canonical: IndependentManualBody = {
		...(stretch && stretch.intensity !== 0
			? { stretch: withoutNegativeZero(stretch) }
			: {}),
		...(slim && slim.intensity !== 0
			? { slim: withoutNegativeZero(slim) }
			: {}),
		...(zoom && zoom.intensity !== 0
			? { zoom: withoutNegativeZero(zoom) }
			: {}),
	};
	return Object.keys(canonical).length > 0 ? canonical : undefined;
}

/** `[tool, ...values]` per present tool, tools and fields in a fixed order. */
export function independentManualBodyKeyEntries({
	manualBody,
}: {
	manualBody: IndependentManualBody;
}): Array<[string, ...number[]]> {
	const entries: Array<[string, ...number[]]> = [];
	for (const tool of Object.keys(FIELDS) as Array<keyof typeof FIELDS>) {
		const settings = manualBody[tool] as Record<string, number> | undefined;
		if (settings)
			entries.push([tool, ...FIELDS[tool].map((field) => settings[field])]);
	}
	return entries;
}
