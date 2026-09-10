/**
 * Providers that render a multi-pass color effect outside the browser.
 *
 * These two lists are the single source of truth. Every consumer that asks
 * "does this need a native renderer?" or "which bridge does it go to?" must
 * derive from them. A provider missing from a hand-written copy degrades
 * silently rather than failing: the preview drops back to CSS, or the export
 * runs FFmpeg with the effect quietly removed and no error anywhere.
 */

/** QCut's own renderers. None of them loads the Jianying runtime. */
export const INDEPENDENT_FILTER_PROVIDERS = [
	"qcut-metal-fog-v1",
	"qcut-metal-lut-v1",
	"qcut-metal-graph-v1",
	"qcut-cpu-soft-glow-v1",
	"qcut-cpu-soft-glow-ui-snapshot-v1",
] as const;

/** The Jianying local runtime, plus every independent renderer above. */
export const NATIVE_LOCAL_EFFECT_PROVIDERS = [
	"jianying-local-effect-v1",
	...INDEPENDENT_FILTER_PROVIDERS,
] as const;

export type IndependentFilterProvider =
	(typeof INDEPENDENT_FILTER_PROVIDERS)[number];

export type NativeLocalEffectProvider =
	(typeof NATIVE_LOCAL_EFFECT_PROVIDERS)[number];

export function isIndependentFilterProvider(
	provider: string | undefined
): provider is IndependentFilterProvider {
	return (INDEPENDENT_FILTER_PROVIDERS as readonly string[]).includes(
		provider ?? ""
	);
}

export function isNativeLocalEffectProvider(
	provider: string | undefined
): provider is NativeLocalEffectProvider {
	return (NATIVE_LOCAL_EFFECT_PROVIDERS as readonly string[]).includes(
		provider ?? ""
	);
}
