import { fragmentShader } from "./transition-lab-shader.js";

/**
 * Adapts a gl-transitions (https://gl-transitions.com) GLSL file to the
 * Transition Lab fragment contract.
 *
 * A gl-transition implements `vec4 transition(vec2 uv)` against three
 * provided symbols — `progress`, `ratio`, `getFromColor()`/`getToColor()` —
 * and declares its tunables as `uniform T name; // = default`. The lab host
 * exposes `uFrom`/`uTo`/`uProgress`/`uResolution`/`vUv` instead, so this
 * adapter supplies the spec symbols, freezes each tunable to its documented
 * default, and appends the `main()` the host expects. It is deterministic and
 * side-effect free so the import script and tests can share it.
 */

export interface GlTransitionParameter {
	name: string;
	type: string;
	defaultValue: string;
}

export interface AdaptedGlTransition {
	fragmentSource: string;
	parameters: GlTransitionParameter[];
	author?: string;
}

// `uniform float x; // = 0.3` and burn.glsl's `uniform vec3 c /* = vec3(…) */;`
const UNIFORM_WITH_DEFAULT =
	/^[ \t]*uniform[ \t]+(\w+)[ \t]+(\w+)[ \t]*(?:;[ \t]*\/\/[ \t]*=[ \t]*(.+?)[ \t]*|\/\*[ \t]*=[ \t]*(.+?)[ \t]*\*\/[ \t]*;)[ \t]*$/;
const UNIFORM_ANY = /^[ \t]*uniform\b/;
// The host prelude already declares precision; a second declaration is
// legal GLSL but pointless noise in the generated source.
const PRECISION = /^[ \t]*precision[ \t]+\w+[ \t]+\w+[ \t]*;[ \t]*$/;
const AUTHOR = /^[ \t]*\/\/[ \t]*Author:[ \t]*(.+?)[ \t]*$/im;
const TRANSITION_ENTRY =
	/\bvec4[ \t]+transition[ \t]*\([ \t]*vec2[ \t]+\w+[ \t]*\)/;
const INT_LITERAL = /^-?\d+$/;
// Names the host prelude already declares; a tunable that reuses one (dissolve
// calls its strength `uIntensity`) would be a redefinition, so it is renamed.
const HOST_SYMBOLS = new Set([
	"uFrom",
	"uTo",
	"uProgress",
	"uIntensity",
	"uResolution",
	"uRatio",
	"vUv",
]);

// In gl-transitions `progress` and `ratio` are uniforms, and several shaders
// (circle-crop, for one) read them in global initialisers that run before
// main(). Plain globals assigned in main() would still be zero there, so both
// names are macros over real uniforms; a local `float ratio` in a shader then
// simply shadows the uniform, which GLSL allows.
const SPEC_HELPERS = [
	"uniform float uRatio;",
	"#define progress uProgress",
	"#define ratio uRatio",
	"vec4 getFromColor(vec2 uv) { return texture2D(uFrom, uv); }",
	"vec4 getToColor(vec2 uv) { return texture2D(uTo, uv); }",
	"",
];

const MAIN_BODY = "\tgl_FragColor = transition(vUv);";

export function adaptGlTransition({
	source,
	fileName,
}: {
	source: string;
	fileName: string;
}): AdaptedGlTransition {
	if (!TRANSITION_ENTRY.test(source)) {
		throw new Error(`${fileName}: no vec4 transition(vec2 uv) entry point`);
	}
	const parameters: GlTransitionParameter[] = [];
	const renames = new Map<string, string>();
	const body: string[] = [];
	for (const line of source.split(/\r?\n/)) {
		if (PRECISION.test(line)) continue;
		const match = UNIFORM_WITH_DEFAULT.exec(line);
		if (match) {
			const [, type, sourceName, lineDefault, blockDefault] = match;
			const name = HOST_SYMBOLS.has(sourceName)
				? `${sourceName}Param`
				: sourceName;
			if (name !== sourceName) renames.set(sourceName, name);
			if (type === "sampler2D") {
				throw new Error(
					`${fileName}: extra sampler "${name}" is outside the from/to contract`
				);
			}
			let defaultValue = (lineDefault ?? blockDefault ?? "").trim();
			// GLSL ES 1.0 has no int→float promotion: `const float x = 3;` is a
			// compile error, so a bare integer default gets its ".0" back.
			if (type === "float" && INT_LITERAL.test(defaultValue)) {
				defaultValue = `${defaultValue}.0`;
			}
			// luminance_melt writes its flags as `// = 0`; bool has no int conversion.
			if (type === "bool" && INT_LITERAL.test(defaultValue)) {
				defaultValue = defaultValue === "0" ? "false" : "true";
			}
			parameters.push({ name, type, defaultValue });
			body.push(`const ${type} ${name} = ${defaultValue};`);
			continue;
		}
		if (UNIFORM_ANY.test(line)) {
			if (/^[ \t]*uniform[ \t]+sampler2D\b/.test(line)) {
				throw new Error(
					`${fileName}: extra sampler is outside the from/to contract: ${line.trim()}`
				);
			}
			throw new Error(`${fileName}: uniform without a default: ${line.trim()}`);
		}
		body.push(line);
	}
	let transition = body.join("\n");
	for (const [sourceName, name] of renames) {
		transition = transition.replace(
			new RegExp(`\\b${sourceName}\\b`, "g"),
			name
		);
	}
	const author = AUTHOR.exec(source)?.[1];
	return {
		fragmentSource: fragmentShader({
			helpers: [...SPEC_HELPERS, transition].join("\n"),
			body: MAIN_BODY,
		}),
		parameters,
		...(author ? { author } : {}),
	};
}

/** `GridFlip.glsl` → `grid-flip`; `undulating_burn_out.glsl` → `undulating-burn-out`. */
export function glTransitionSlug({ fileName }: { fileName: string }): string {
	return fileName
		.replace(/\.glsl$/i, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[_\s]+/g, "-")
		.toLowerCase();
}

/** `GridFlip.glsl` → `Grid Flip`; `undulating_burn_out.glsl` → `Undulating Burn Out`. */
export function glTransitionDisplayName({
	fileName,
}: {
	fileName: string;
}): string {
	return glTransitionSlug({ fileName })
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
