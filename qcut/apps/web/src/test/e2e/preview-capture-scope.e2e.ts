import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";

test("scoped preview capture preserves canvas and image layers without cloning editor panels", async () => {
	test.setTimeout(60_000);
	const output = path.resolve("output/playwright/preview-capture-scope");
	await mkdir(output, { recursive: true });
	const bundled = await build({
		entryPoints: ["apps/web/src/lib/effects/canvas-utils.ts"],
		bundle: true,
		format: "iife",
		globalName: "QcutCaptureTest",
		platform: "browser",
		write: false,
	});
	const app = await startElectronApp({
		userDataDirectory: await mkdtemp(path.join(os.tmpdir(), "qcut-capture-")),
	});
	try {
		const page = await getMainWindow(app);
		await page.goto("about:blank");
		await page.setViewportSize({ width: 1200, height: 800 });
		await page.setContent(`<!doctype html><html><head><style>
			body { margin: 0; color: black; }
			main { display: flex; width: 1000px; }
			aside { width: 250px; }
			section { flex: 1; display: flex; justify-content: center; }
			#surface { width: 320px; height: 180px; position: relative; overflow: hidden; }
			#overlay { position: absolute; left: 160px; top: 90px; width: 80px; height: 45px; }
		</style></head><body><main><aside id="library"></aside><section><div id="surface"><canvas width="320" height="180"></canvas><img id="overlay" alt="layer" /></div></section></main><div id="timeline"></div></body></html>`);
		await page.addScriptTag({ content: bundled.outputFiles[0].text });
		const capture = await page.evaluate(async () => {
			const surface = document.getElementById("surface")!;
			const base = surface.querySelector("canvas")!;
			const ctx = base.getContext("2d")!;
			ctx.fillStyle = "#ff0000";
			ctx.fillRect(0, 0, 160, 180);
			ctx.fillStyle = "#0000ff";
			ctx.fillRect(160, 0, 160, 180);
			const layer = document.createElement("canvas");
			layer.width = 80;
			layer.height = 45;
			const layerContext = layer.getContext("2d")!;
			layerContext.fillStyle = "#00ff00";
			layerContext.fillRect(0, 0, 80, 45);
			const img = document.getElementById("overlay") as HTMLImageElement;
			img.src = layer.toDataURL();
			await img.decode();
			for (const id of ["library", "timeline"]) {
				const panel = document.getElementById(id)!;
				for (let index = 0; index < 2000; index++) {
					const item = document.createElement("div");
					item.textContent = `Unrelated item ${index}`;
					panel.append(item);
				}
			}
			let unrelatedStyleReads = 0;
			const original = window.getComputedStyle;
			window.getComputedStyle = (element, pseudo) => {
				if (element.closest("#library, #timeline")) unrelatedStyleReads++;
				return original.call(window, element, pseudo);
			};
			try {
				const api = (
					window as unknown as {
						QcutCaptureTest: {
							captureFrameToCanvas: (
								element: HTMLElement,
								options: { width: number; height: number }
							) => Promise<ImageData | null>;
						};
					}
				).QcutCaptureTest;
				const data = await api.captureFrameToCanvas(surface, {
					width: 320,
					height: 180,
				});
				if (!data) throw new Error("No captured frame");
				const pixel = ({ x, y }: { x: number; y: number }) =>
					Array.from(
						data.data.slice(
							(y * data.width + x) * 4,
							(y * data.width + x) * 4 + 4
						)
					);
				const result = document.createElement("canvas");
				result.width = data.width;
				result.height = data.height;
				result.getContext("2d")!.putImageData(data, 0, 0);
				return {
					unrelatedStyleReads,
					left: pixel({ x: 80, y: 45 }),
					right: pixel({ x: 280, y: 45 }),
					overlay: pixel({ x: 200, y: 110 }),
					png: result.toDataURL(),
				};
			} finally {
				window.getComputedStyle = original;
			}
		});
		await page
			.locator("#surface")
			.screenshot({ path: path.join(output, "original.png") });
		await writeFile(
			path.join(output, "captured.png"),
			Buffer.from(capture.png.split(",")[1], "base64")
		);
		expect(capture.unrelatedStyleReads).toBe(0);
		expect(capture.left).toEqual([255, 0, 0, 255]);
		expect(capture.right).toEqual([0, 0, 255, 255]);
		expect(capture.overlay).toEqual([0, 255, 0, 255]);
	} finally {
		await app.close();
	}
});
