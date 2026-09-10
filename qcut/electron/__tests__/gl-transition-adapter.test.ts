import { describe, expect, it } from "vitest";
import {
	adaptGlTransition,
	glTransitionDisplayName,
	glTransitionSlug,
} from "../native-pipeline/transitions/gl-transition-adapter";
import { GL_TRANSITION_RECIPES } from "../native-pipeline/transitions/gl-transitions-recipes";
import { TRANSITION_LAB_RECIPES } from "../native-pipeline/transitions/transition-lab-catalog";
import manifest from "../native-pipeline/transitions/gl-transitions/manifest.json";

const MINIMAL = `// Author: gre
// License: MIT
vec4 transition (vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}
`;

describe("gl-transition adapter", () => {
	it("freezes documented uniform defaults into constants", () => {
		const adapted = adaptGlTransition({
			fileName: "cube.glsl",
			source: `uniform float persp; // = 0.7
uniform ivec2 size; // = ivec2(4)
uniform bool flip; // = true
uniform vec3 color /* = vec3(0.9, 0.4, 0.2) */;
${MINIMAL}`,
		});
		expect(adapted.fragmentSource).toContain("const float persp = 0.7;");
		expect(adapted.fragmentSource).toContain("const ivec2 size = ivec2(4);");
		expect(adapted.fragmentSource).toContain("const bool flip = true;");
		expect(adapted.fragmentSource).toContain(
			"const vec3 color = vec3(0.9, 0.4, 0.2);"
		);
		// The tunables are constants now; only the host prelude keeps uniforms.
		expect(adapted.fragmentSource).not.toMatch(
			/uniform\s+\w+\s+(persp|size|flip|color)\b/
		);
		expect(adapted.parameters.map((parameter) => parameter.name)).toEqual([
			"persp",
			"size",
			"flip",
			"color",
		]);
		expect(adapted.author).toBe("gre");
	});

	// GLSL ES 1.0 rejects `const float x = 3;` — no int→float promotion.
	it("restores the decimal point on bare integer float defaults", () => {
		const adapted = adaptGlTransition({
			fileName: "bounce.glsl",
			source: `uniform float bounces; // = 3\nuniform float speed; // = -2\n${MINIMAL}`,
		});
		expect(adapted.fragmentSource).toContain("const float bounces = 3.0;");
		expect(adapted.fragmentSource).toContain("const float speed = -2.0;");
	});

	it("renames tunables that collide with host uniforms and fixes bool literals", () => {
		const adapted = adaptGlTransition({
			fileName: "dissolve.glsl",
			source: `uniform float uIntensity; // = 0.5
uniform bool flip; // = 0
uniform bool wrap; // = 1
vec4 transition (vec2 uv) {
  float a = uIntensity * (flip ? 1.0 : 0.0) + (wrap ? 0.0 : 1.0);
  return mix(getFromColor(uv), getToColor(uv), progress * a);
}
`,
		});
		expect(adapted.fragmentSource).toContain(
			"const float uIntensityParam = 0.5;"
		);
		expect(adapted.fragmentSource).toContain(
			"uIntensityParam * (flip ? 1.0 : 0.0)"
		);
		expect(adapted.fragmentSource).toContain("const bool flip = false;");
		expect(adapted.fragmentSource).toContain("const bool wrap = true;");
		// The host uniform itself must still be declared exactly once.
		expect(
			adapted.fragmentSource.match(/uniform float uIntensity;/g)
		).toHaveLength(1);
	});

	it("supplies the spec symbols and the host main", () => {
		const adapted = adaptGlTransition({
			fileName: "fade.glsl",
			source: MINIMAL,
		});
		for (const expected of [
			"uniform float uRatio;",
			"#define progress uProgress",
			"#define ratio uRatio",
			"vec4 getFromColor(vec2 uv) { return texture2D(uFrom, uv); }",
			"vec4 getToColor(vec2 uv) { return texture2D(uTo, uv); }",
			"gl_FragColor = transition(vUv);",
		]) {
			expect(adapted.fragmentSource).toContain(expected);
		}
		// The host prelude declares precision once; a second copy is dropped.
		const withPrecision = adaptGlTransition({
			fileName: "fade.glsl",
			source: `precision highp float;\n${MINIMAL}`,
		});
		expect(
			withPrecision.fragmentSource.match(/precision highp float;/g)
		).toHaveLength(1);
	});

	it("rejects shaders outside the from/to contract", () => {
		expect(() =>
			adaptGlTransition({
				fileName: "luma.glsl",
				source: `uniform sampler2D luma;\n${MINIMAL}`,
			})
		).toThrow(/outside the from\/to contract/);
		expect(() =>
			adaptGlTransition({
				fileName: "x.glsl",
				source: `uniform float strength;\n${MINIMAL}`,
			})
		).toThrow(/without a default/);
		expect(() =>
			adaptGlTransition({ fileName: "x.glsl", source: "void main() {}" })
		).toThrow(/no vec4 transition/);
	});

	it("derives stable ids and display names", () => {
		expect(glTransitionSlug({ fileName: "GridFlip.glsl" })).toBe("grid-flip");
		expect(glTransitionSlug({ fileName: "undulating_burn_out.glsl" })).toBe(
			"undulating-burn-out"
		);
		expect(glTransitionDisplayName({ fileName: "GridFlip.glsl" })).toBe(
			"Grid Flip"
		);
	});
});

describe("generated gl-transitions recipes", () => {
	it("match the vendored manifest one to one", () => {
		expect(GL_TRANSITION_RECIPES).toHaveLength(manifest.files.length);
		const generated = new Set(
			GL_TRANSITION_RECIPES.map((recipe) => recipe.shader.sourceFile)
		);
		for (const entry of manifest.files)
			expect(generated.has(entry.file)).toBe(true);
		expect(manifest.excluded.map((entry) => entry.file).sort()).toEqual([
			"displacement.glsl",
			"luma.glsl",
		]);
	});

	it("carry provenance and keep ids unique across the whole catalog", () => {
		for (const recipe of GL_TRANSITION_RECIPES) {
			expect(recipe.id.startsWith("gl-")).toBe(true);
			expect(recipe.clip.type).toBe("shader");
			expect(recipe.shader.origin).toBe("gl-transitions");
			expect(recipe.shader.license).toBe("MIT");
			expect(recipe.shader.binaryAssets).toBe(false);
			expect(recipe.shader.fragmentSource).toContain(
				"gl_FragColor = transition(vUv);"
			);
		}
		const ids = TRANSITION_LAB_RECIPES.map((recipe) => recipe.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
