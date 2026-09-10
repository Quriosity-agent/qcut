/**
 * Drives the real ShaderTransitionCompositor in headless Chromium.
 *
 *   bun scripts/validate-shader-compositor.ts
 *
 * scripts/validate-gl-transitions.ts proves the GLSL itself; this bundles the
 * compositor module the preview overlay and canvas export actually use, feeds
 * it two solid frames, and checks every Transition Lab recipe — clean-room and
 * gl-transitions alike — shows only `from` at progress 0 and only `to` at 1
 * through that code path (texture upload, Y flip, uniform binding included).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(import.meta.dir, "..");

interface Failure {
	id: string;
	log: string;
}

const scratch = await mkdtemp(path.join(os.tmpdir(), "qcut-compositor-"));
try {
	const entry = path.join(scratch, "entry.ts");
	await writeFile(
		entry,
		[
			`import { createShaderTransitionCompositor } from ${JSON.stringify(path.join(ROOT, "apps/web/src/lib/transitions/shader-transition-compositor.ts"))};`,
			`import { TRANSITION_LAB_RECIPES } from ${JSON.stringify(path.join(ROOT, "electron/native-pipeline/transitions/transition-lab-catalog.ts"))};`,
			"(globalThis as Record<string, unknown>).__qcutCompositor = { createShaderTransitionCompositor, TRANSITION_LAB_RECIPES };",
		].join("\n")
	);
	const bundle = await Bun.build({
		entrypoints: [entry],
		target: "browser",
		format: "esm",
		minify: false,
	});
	if (!bundle.success) {
		for (const log of bundle.logs) console.error(log);
		throw new Error("Bundling the compositor failed");
	}
	const script = await bundle.outputs[0].text();

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
		await page.setContent("<!doctype html><html><body></body></html>");
		await page.addScriptTag({ type: "module", content: script });
		await page.waitForFunction(
			() => "__qcutCompositor" in (globalThis as Record<string, unknown>)
		);
		const { failures, total } = await page.evaluate(() => {
			const size = 16;
			const solid = (r: number, g: number, b: number) => {
				const canvas = document.createElement("canvas");
				canvas.width = size;
				canvas.height = size;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("2d context unavailable");
				ctx.fillStyle = `rgb(${r},${g},${b})`;
				ctx.fillRect(0, 0, size, size);
				return canvas;
			};
			const api = (globalThis as Record<string, unknown>).__qcutCompositor as {
				createShaderTransitionCompositor: () => {
					render: (frame: {
						programKey: string;
						fragmentSource: string;
						from: HTMLCanvasElement;
						to: HTMLCanvasElement;
						progress: number;
						width: number;
						height: number;
					}) => HTMLCanvasElement;
					dispose: () => void;
				} | null;
				TRANSITION_LAB_RECIPES: Array<{
					id: string;
					shader: { fragmentSource: string };
				}>;
			};
			const compositor = api.createShaderTransitionCompositor();
			if (!compositor) {
				return { failures: [{ id: "*", log: "WebGL1 unavailable" }], total: 0 };
			}
			const from = solid(200, 30, 30);
			const to = solid(30, 30, 200);
			const probe = document.createElement("canvas");
			probe.width = size;
			probe.height = size;
			const probeCtx = probe.getContext("2d");
			if (!probeCtx) throw new Error("2d context unavailable");
			const failures: Failure[] = [];
			for (const recipe of api.TRANSITION_LAB_RECIPES) {
				const problems: string[] = [];
				for (const [progress, expected] of [
					[0, [200, 30, 30]],
					[1, [30, 30, 200]],
				] as Array<[number, number[]]>) {
					try {
						const result = compositor.render({
							programKey: recipe.id,
							fragmentSource: recipe.shader.fragmentSource,
							from,
							to,
							progress,
							width: size,
							height: size,
						});
						probeCtx.clearRect(0, 0, size, size);
						probeCtx.drawImage(result, 0, 0);
						const pixel = probeCtx.getImageData(size / 2, size / 2, 1, 1).data;
						if (
							expected.some(
								(value, index) => Math.abs(pixel[index] - value) > 3
							)
						) {
							problems.push(
								`progress ${progress}: rgb(${pixel[0]},${pixel[1]},${pixel[2]}) expected rgb(${expected.join(",")})`
							);
						}
					} catch (error) {
						problems.push(
							`progress ${progress}: ${error instanceof Error ? error.message : String(error)}`
						);
					}
				}
				if (problems.length)
					failures.push({ id: recipe.id, log: problems.join("; ") });
			}
			compositor.dispose();
			return { failures, total: api.TRANSITION_LAB_RECIPES.length };
		});
		if (failures.length > 0) {
			for (const failure of failures)
				console.error(`✗ ${failure.id}: ${failure.log}`);
			console.error(
				`${failures.length} of ${total} recipes failed through the compositor.`
			);
			process.exitCode = 1;
		} else {
			console.log(
				`✓ ${total} Transition Lab recipes render both endpoints correctly through ShaderTransitionCompositor.`
			);
		}
	} finally {
		await browser.close();
	}
} finally {
	await rm(scratch, { recursive: true, force: true });
}
