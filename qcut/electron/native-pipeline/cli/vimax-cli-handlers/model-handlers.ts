/**
 * ViMax Model Handlers
 *
 * list-models
 */

import type { CLIResult } from "../cli-runner/types.js";
import { listModels } from "../../infra/cost-calculator.js";

/** vimax:list-models — List ViMax-specific models (image, video, LLM). */
export function handleVimaxListModels(): CLIResult {
	const vimaxCategories = new Set([
		"text_to_image",
		"text_to_video",
		"image_to_video",
		"image_to_image",
	]);

	const allModels = listModels();
	const vimaxModels = allModels.filter((m) =>
		m.categories.some((c: string) => vimaxCategories.has(c))
	);

	const grouped: Record<
		string,
		{ key: string; name: string; provider: string }[]
	> = {};
	for (const cat of vimaxCategories) {
		grouped[cat] = [];
	}

	for (const m of vimaxModels) {
		for (const cat of m.categories) {
			if (vimaxCategories.has(cat)) {
				grouped[cat].push({
					key: m.key,
					name: m.name,
					provider: m.provider,
				});
			}
		}
	}

	return {
		success: true,
		data: {
			models: vimaxModels.map((m) => ({
				key: m.key,
				name: m.name,
				provider: m.provider,
				categories: m.categories,
			})),
			count: vimaxModels.length,
			by_category: Object.fromEntries(
				Object.entries(grouped).map(([cat, models]) => [cat, models.length])
			),
		},
	};
}
