import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../../../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
import type {
	BeautyLabIndependentStatus,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";

export function beautyLabCatalogStatus({
	status,
	recordedValues,
	independentStatus,
}: {
	status: JianyingPortraitAdjustmentStatus | null;
	recordedValues?: MediaPortraitAdjustments["values"];
	independentStatus?: BeautyLabIndependentStatus | null;
}): JianyingPortraitAdjustmentStatus {
	return {
		state: "bridge-missing",
		message: "Native runtime unavailable",
		provider: "jianying-local-swing-v1",
		available: false,
		offlineReady: false,
		packages: [],
		...status,
		catalog: JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.map((control) => {
			const recorded = recordedValues?.[control.key];
			if (recorded === undefined) return control;
			// Read-only probe parameters can exceed the product slider's range.
			return {
				...control,
				min: Math.min(control.min, recorded),
				max: Math.max(control.max, recorded),
			};
		}),
		makeupCards: JIANYING_PORTRAIT_MAKEUP_CARDS.map((card) => {
			const installed = status?.makeupCards.find(({ id }) => id === card.id);
			const independentReady =
				independentStatus?.available === true &&
				independentStatus.makeupCards.includes(card.id);
			if (installed)
				return independentReady && !installed.ready
					? { ...installed, ready: true }
					: installed;
			return {
				id: card.id,
				category: card.category,
				titleZh: card.titleZh,
				titleEn: card.titleEn,
				defaultIntensity: card.defaultIntensity,
				legacyOnly: card.legacyOnly,
				// Draft availability does not change the native inspector's readiness.
				ready: independentReady,
				source: "none" as const,
			};
		}),
	};
}
