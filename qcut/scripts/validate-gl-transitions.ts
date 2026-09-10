/**
 * Compiles every generated gl-transitions recipe in a real WebGL1 context.
 *
 *   bun scripts/validate-gl-transitions.ts
 *
 * glslc cannot check ESSL 1.00 (SPIR-V needs ES 3.10+), so this drives the
 * same headless Chromium the E2E suite uses, links each fragment shader
 * against the Transition Lab vertex shader, and fails on the first shader
 * that does not compile. Exit code 1 on any failure.
 */
import { chromium } from "@playwright/test";
import { GL_TRANSITION_RECIPES } from "../electron/native-pipeline/transitions/gl-transitions-recipes.js";
import { TRANSITION_LAB_VERTEX_SHADER } from "../electron/native-pipeline/transitions/transition-lab-shader.js";

interface ShaderFailure {
	id: string;
	stage: "fragment" | "link" | "context" | "endpoint";
	log: string;
}

const browser = await chromium.launch({
	headless: true,
	args: [
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--ignore-gpu-blocklist",
	],
});
try {
	const page = await browser.newPage();
	const failures = await page.evaluate(
		({ vertexSource, recipes }) => {
			const canvas = document.createElement("canvas");
			const gl = canvas.getContext("webgl");
			if (!gl) {
				return [{ id: "*", stage: "context", log: "WebGL1 unavailable" }];
			}
			const compile = (type: number, source: string) => {
				const shader = gl.createShader(type);
				if (!shader) throw new Error("createShader failed");
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
				return { shader, ok, log: gl.getShaderInfoLog(shader) ?? "" };
			};
			const vertex = compile(gl.VERTEX_SHADER, vertexSource);
			if (!vertex.ok) {
				return [{ id: "*", stage: "context", log: vertex.log }];
			}
			const size = 16;
			canvas.width = size;
			canvas.height = size;
			const solid = (r: number, g: number, b: number) => {
				const c = document.createElement("canvas");
				c.width = size;
				c.height = size;
				const ctx = c.getContext("2d");
				if (!ctx) throw new Error("2d context unavailable");
				ctx.fillStyle = `rgb(${r},${g},${b})`;
				ctx.fillRect(0, 0, size, size);
				return c;
			};
			const fromFrame = solid(200, 30, 30);
			const toFrame = solid(30, 30, 200);
			const buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
				gl.STATIC_DRAW
			);
			const texture = (unit: number, source: HTMLCanvasElement) => {
				const t = gl.createTexture();
				gl.activeTexture(gl.TEXTURE0 + unit);
				gl.bindTexture(gl.TEXTURE_2D, t);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source
				);
			};
			texture(0, fromFrame);
			texture(1, toFrame);
			const centre = new Uint8Array(4);
			const activateProgram = gl.useProgram.bind(gl);
			const renderEndpoints = (program: WebGLProgram): string | null => {
				activateProgram(program);
				gl.viewport(0, 0, size, size);
				const position = gl.getAttribLocation(program, "aPosition");
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				gl.enableVertexAttribArray(position);
				gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
				gl.uniform1i(gl.getUniformLocation(program, "uFrom"), 0);
				gl.uniform1i(gl.getUniformLocation(program, "uTo"), 1);
				gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), 1);
				gl.uniform2f(gl.getUniformLocation(program, "uResolution"), size, size);
				gl.uniform1f(gl.getUniformLocation(program, "uRatio"), 1);
				const problems: string[] = [];
				for (const [progress, expected] of [
					[0, [200, 30, 30]],
					[1, [30, 30, 200]],
				] as Array<[number, number[]]>) {
					gl.uniform1f(gl.getUniformLocation(program, "uProgress"), progress);
					gl.clearColor(0, 0, 0, 0);
					gl.clear(gl.COLOR_BUFFER_BIT);
					gl.drawArrays(gl.TRIANGLES, 0, 6);
					gl.readPixels(
						size / 2,
						size / 2,
						1,
						1,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						centre
					);
					const off = expected.some(
						(value, i) => Math.abs(centre[i] - value) > 3
					);
					if (off) {
						problems.push(
							`progress ${progress}: got rgb(${centre[0]},${centre[1]},${centre[2]}), expected rgb(${expected.join(",")})`
						);
					}
				}
				return problems.length ? problems.join("; ") : null;
			};
			const out: ShaderFailure[] = [];
			for (const recipe of recipes) {
				const fragment = compile(gl.FRAGMENT_SHADER, recipe.source);
				if (!fragment.ok) {
					out.push({ id: recipe.id, stage: "fragment", log: fragment.log });
					gl.deleteShader(fragment.shader);
					continue;
				}
				const program = gl.createProgram();
				if (!program) throw new Error("createProgram failed");
				gl.attachShader(program, vertex.shader);
				gl.attachShader(program, fragment.shader);
				gl.linkProgram(program);
				if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
					// gl-transitions contract: progress 0 shows only `from`, 1 only
					// `to`. Render both endpoints against solid frames and read back
					// the centre pixel through the same uniforms the app binds.
					const mismatch = renderEndpoints(program);
					if (mismatch) {
						out.push({ id: recipe.id, stage: "endpoint", log: mismatch });
					}
				} else {
					out.push({
						id: recipe.id,
						stage: "link",
						log: gl.getProgramInfoLog(program) ?? "",
					});
				}
				gl.deleteProgram(program);
				gl.deleteShader(fragment.shader);
			}
			return out;
		},
		{
			vertexSource: TRANSITION_LAB_VERTEX_SHADER,
			recipes: GL_TRANSITION_RECIPES.map((recipe) => ({
				id: recipe.id,
				source: recipe.shader.fragmentSource,
			})),
		}
	);
	if (failures.length > 0) {
		for (const failure of failures) {
			console.error(
				`✗ ${failure.id} [${failure.stage}]\n${failure.log.trim()}\n`
			);
		}
		console.error(
			`${failures.length} of ${GL_TRANSITION_RECIPES.length} gl-transitions recipes failed validation.`
		);
		process.exitCode = 1;
	} else {
		console.log(
			`✓ ${GL_TRANSITION_RECIPES.length} gl-transitions recipes compile, link and honour both endpoints in WebGL1.`
		);
	}
} finally {
	await browser.close();
}
