import { describe, expect, it } from "vitest";
import {
	TRANSITION_LAB_RECIPES,
	TRANSITION_LAB_VERTEX_SHADER,
} from "../../../../../../../../../electron/native-pipeline/transitions/transition-lab-catalog";
import { TRANSITION_LAB_PRESETS } from "../transition-lab-presets";

describe("Transition Lab catalog", () => {
	it("keeps UI presets and shader recipes in one-to-one correspondence", () => {
		expect(TRANSITION_LAB_PRESETS.map((preset) => preset.id)).toEqual(
			TRANSITION_LAB_RECIPES.map((recipe) => recipe.id)
		);
		expect(
			new Set(TRANSITION_LAB_PRESETS.map((preset) => preset.id)).size
		).toBe(TRANSITION_LAB_PRESETS.length);
	});

	it("contains only distributable shader source", () => {
		expect(TRANSITION_LAB_VERTEX_SHADER).toContain("void main()");
		for (const recipe of TRANSITION_LAB_RECIPES) {
			// Clean-room recipes are QCut's own; gl-transitions are vendored MIT
			// GLSL with per-file authors. Both ship as source, never as assets.
			expect(["qcut-clean-room", "gl-transitions"]).toContain(
				recipe.shader.origin
			);
			expect(recipe.shader.license).toBe("MIT");
			expect(recipe.shader.binaryAssets).toBe(false);
			expect(recipe.shader.fragmentSource).toContain("void main()");
			expect(recipe.shader.fragmentSource).not.toMatch(
				/Cache\/effect|\.bundle\b|\.bin\b|\.dat\b|\.zip\b/i
			);
		}
	});

	it("keeps page curl endpoints pixel-exact", () => {
		const pageCurl = TRANSITION_LAB_RECIPES.find(
			(recipe) => recipe.id === "lab-page-curl"
		);
		expect(pageCurl?.shader.fragmentSource).toContain("uProgress <= 0.0");
		expect(pageCurl?.shader.fragmentSource).toContain("texture2D(uFrom, vUv)");
		expect(pageCurl?.shader.fragmentSource).toContain("uProgress >= 1.0");
		expect(pageCurl?.shader.fragmentSource).toContain("texture2D(uTo, vUv)");
	});
});
