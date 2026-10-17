/**
 * Manual body settings the independent engine renders: the editor's stretch
 * band (intensity −50..50, upper and bottom handles as shares of the height
 * from the bottom, at least 0.02 apart). Slim and zoom are not rendered yet;
 * the renderer refuses them before a request reaches the engine.
 * @module electron/beauty-lab/beauty-lab-independent-manual-body
 */

import { z } from "zod";

export const independentManualBodySchema = z
	.object({
		stretch: z
			.object({
				intensity: z.number().finite().min(-50).max(50),
				upper: z.number().finite().min(0.02).max(1),
				bottom: z.number().finite().min(0).max(0.98),
			})
			.strict()
			.refine(
				({ upper, bottom }) => upper - bottom >= 0.02 - 1e-9,
				"Independent stretch band must be at least 0.02 tall"
			)
			.optional(),
	})
	.strict();

export type IndependentManualBody = z.infer<typeof independentManualBodySchema>;

/**
 * The tools that change the picture, as the engine's canonical plan keeps
 * them (an idle stretch is dropped, −0 becomes 0); undefined when none does.
 */
export function canonicalIndependentManualBody({
	manualBody,
}: {
	manualBody: IndependentManualBody | undefined;
}): IndependentManualBody | undefined {
	const stretch = manualBody?.stretch;
	if (!stretch || stretch.intensity === 0) return undefined;
	return {
		stretch: {
			intensity: stretch.intensity,
			upper: Object.is(stretch.upper, -0) ? 0 : stretch.upper,
			bottom: Object.is(stretch.bottom, -0) ? 0 : stretch.bottom,
		},
	};
}
