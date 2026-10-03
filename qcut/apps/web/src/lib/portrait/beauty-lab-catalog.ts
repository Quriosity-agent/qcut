import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../../../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
import type { JianyingPortraitAdjustmentStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";

export function beautyLabCatalogStatus({
	status,
	recordedValues,
}: {
	status: JianyingPortraitAdjustmentStatus | null;
	recordedValues?: MediaPortraitAdjustments["values"];
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
			return (
				installed ?? {
					id: card.id,
					category: card.category,
					titleZh: card.titleZh,
					titleEn: card.titleEn,
					defaultIntensity: card.defaultIntensity,
					legacyOnly: card.legacyOnly,
					ready: false,
					source: "none" as const,
				}
			);
		}),
	};
}
