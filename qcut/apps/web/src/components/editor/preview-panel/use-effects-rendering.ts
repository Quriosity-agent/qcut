import { useMemo } from "react";
import { useEffectsStore } from "@/stores/ai/effects-store";
import {
	parametersToCSSFilters,
	mergeEffectParameters,
} from "@/lib/effects/effects-utils";

const EMPTY_EFFECTS: readonly never[] = [];

/** Compute the aggregate CSS filter string for an element's enabled effects. */
export function useEffectsRendering(elementId: string | null, enabled = false) {
	const effects = useEffectsStore((state) => {
		if (!enabled || !elementId) return EMPTY_EFFECTS;
		return state.activeEffects.get(elementId) ?? EMPTY_EFFECTS;
	});

	return useMemo(() => {
		if (!enabled || effects.length === 0) {
			return { filterStyle: "", hasEffects: false };
		}

		try {
			const enabledEffects = effects.filter((e) => e.enabled);

			if (enabledEffects.length === 0) {
				return { filterStyle: "", hasEffects: false };
			}

			const mergedParams = mergeEffectParameters(
				...enabledEffects.map((e) => e.parameters)
			);

			return {
				filterStyle: parametersToCSSFilters(mergedParams),
				hasEffects: true,
			};
		} catch {
			return { filterStyle: "", hasEffects: false };
		}
	}, [enabled, effects]);
}
