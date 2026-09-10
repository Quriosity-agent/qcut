import { TRANSITION_LAB_RECIPES } from "../../../../../../../../electron/native-pipeline/transitions/transition-lab-catalog";
import {
	defineTransitionPreset,
	type TransitionPreset,
	type TransitionType,
} from "./transition-preset-types";

function transitionType({
	clipType,
}: {
	clipType: (typeof TRANSITION_LAB_RECIPES)[number]["clip"]["type"];
}): TransitionType {
	switch (clipType) {
		case "page-flip":
			return "page";
		case "motion-blur":
			return "motion-blur";
		case "cube":
			return "cube";
		default:
			return clipType;
	}
}

export const TRANSITION_LAB_PRESETS: TransitionPreset[] =
	TRANSITION_LAB_RECIPES.map((recipe) =>
		defineTransitionPreset({
			id: recipe.id,
			name: recipe.name,
			localizedName: recipe.localizedName,
			description: recipe.description,
			category: "lab",
			type: transitionType({ clipType: recipe.clip.type }),
			clipType: recipe.clip.type,
			direction: recipe.clip.direction,
			easing: recipe.clip.easing,
			tuning: recipe.clip.tuning,
			defaultDuration: recipe.defaultDuration,
			labOrigin: recipe.shader.origin,
			tags: [
				"shader",
				"GLSL",
				recipe.shader.origin === "qcut-clean-room"
					? "clean-room"
					: "gl-transitions",
				recipe.clip.type,
				...(recipe.shader.author ? [recipe.shader.author] : []),
			],
			latest: true,
		})
	);

export { getTransitionLabRecipe } from "../../../../../../../../electron/native-pipeline/transitions/transition-lab-catalog";
