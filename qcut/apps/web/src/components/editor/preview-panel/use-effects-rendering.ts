import { useMemo } from "react";
import { useEffectsStore } from "@/stores/ai/effects-store";
import {
	parametersToCSSFilters,
	mergeEffectParameters,
} from "@/lib/effects/effects-utils";

/** Compute the aggregate CSS filter string for an element's enabled effects. */
export function useEffectsRendering(
	elementId: string | null,
	enabled = false
) {
	const getElementEffects = useEffectsStore(
		(state) => state.getElementEffects
	);

	const effects = useMemo(() => {
		if (!enabled || !elementId) {
			return [];
		}
		const elementEffects = getElementEffects(elementId);
		return elementEffects;
	}, [enabled, elementId, getElementEffects]);

	const filterStyle = useMemo(() => {
		if (!enabled || !effects || effects.length === 0) {
			return "";
		}

		try {
			// Filter for enabled effects first
			const enabledEffects = effects.filter((e) => e.enabled);

			// Guard against zero enabled effects
			if (enabledEffects.length === 0) {
				return "";
			}

			// Merge all active effect parameters
			const mergedParams = mergeEffectParameters(
				...enabledEffects.map((e) => e.parameters)
			);

			const cssFilter = parametersToCSSFilters(mergedParams);
			return cssFilter;
		} catch (error) {
			return "";
		}
	}, [enabled, effects]);

	// Check if there are any enabled effects, not just any effects
	const hasEnabledEffects = effects?.some?.((e) => e.enabled) ?? false;

	return { filterStyle, hasEffects: hasEnabledEffects };
}
