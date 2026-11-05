import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import {
	applyTextAnimationPreset,
	getTextAnimationPreset,
} from "@/lib/text/text-animation-presets";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import { runQCutPipelineCli } from "./helpers/qcut-pipeline-cli";
import { stubExportSaveDialog } from "./helpers/e2e-export-helpers";
import {
	createDesktopExportSource,
	exportFfmpeg,
	verifyDesktopExport,
	verifyDesktopPreview,
} from "./helpers/desktop-export-evidence";

async function command<T>({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<T> {
	const result = await runQCutPipelineCli({
		apiPort,
		args: [...args, "--flat"],
		timeoutMs: 420_000,
	});
	return result.envelopes.at(-1) as T;
}

async function exportFromDialog({
	page,
	electronApp,
	output,
	quality,
	engine,
}: {
	page: Page;
	electronApp: ElectronApplication;
	output: string;
	quality: "1080p" | "720p" | "480p";
	engine: "cli" | "standard";
}) {
	await page.getByTestId("export-button").click();
	const dialog = page.getByTestId("export-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: /^File Name/ }).click();
	await page
		.getByTestId("export-filename-input")
		.fill(path.basename(output, ".mp4"));
	await page.getByTestId("export-quality-select").getByRole("button").click();
	await dialog.locator(`[role="radio"][value="${quality}"]`).click();
	await dialog.getByRole("button", { name: /Export Engine/ }).click();
	await dialog.locator(`[role="radio"][value="${engine}"]`).click();
	await stubExportSaveDialog({ electronApp, outputPath: output });
	await page.screenshot({ path: `${output}-settings.png` });
	await page.getByTestId("export-start-button").click();
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const state = (
						window as unknown as {
							__exportStore: {
								getState: () => {
									error: string | null;
									exportHistory: Array<{ success: boolean; filename: string }>;
								};
							};
						}
					).__exportStore.getState();
					return { error: state.error, result: state.exportHistory[0] };
				}),
			{ timeout: 420_000, intervals: [500, 1000] }
		)
		.toMatchObject({
			error: null,
			result: { success: true, filename: path.basename(output) },
		});
	expect(existsSync(output)).toBe(true);
	await page.screenshot({ path: `${output}-complete.png` });
	await page
		.getByRole("button", { name: "Close export dialog", exact: true })
		.click();
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(1_200_000);

for (const scenario of [
	{ name: "landscape", width: 1280, height: 720 },
	{ name: "portrait", width: 720, height: 1280 },
]) {
	test(`desktop export retains captions, animated text and audio across resolutions: ${scenario.name}`, async ({
		apiPort,
		page,
		electronApp,
	}) => {
		test.skip(!existsSync(exportFfmpeg), "bundled FFmpeg unavailable");
		page.setDefaultTimeout(15_000);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0];
			window.webContents.setBackgroundThrottling(false);
		});
		const dir = path.resolve(
			process.env.QCUT_EXPORT_ACCEPTANCE_DIR ??
				".local/export-desktop-acceptance",
			scenario.name
		);
		mkdirSync(dir, { recursive: true });
		const source = path.join(dir, "source.mp4");
		createDesktopExportSource({
			file: source,
			width: scenario.width,
			height: scenario.height,
		});
		const { projectId } = await command<{ projectId: string }>({
			apiPort,
			args: [
				"editor:project:create",
				"--name",
				`Export acceptance ${scenario.name}`,
				"--open",
			],
		});
		const pid = ["--project-id", projectId];
		const run = <T>({ args }: { args: string[] }) =>
			command<T>({ apiPort, args: [args[0], ...pid, ...args.slice(1)] });
		await run({
			args: [
				"editor:project:update-settings",
				"--data",
				JSON.stringify({
					width: scenario.width,
					height: scenario.height,
					fps: 30,
				}),
			],
		});
		const { tracks } = await run<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>({ args: ["editor:track:list"] });
		const main = tracks.find((track) => track.isMain);
		expect(main).toBeDefined();
		await run({
			args: [
				"editor:media:batch-import",
				"--sources",
				source,
				"--append-to-track",
				main!.id,
			],
		});
		await run({
			args: [
				"editor:timeline:add-element",
				"--data",
				JSON.stringify({
					type: "text",
					content: "QCut Export",
					startTime: 0,
					duration: 3,
					fontSize: 52,
					fontFamily: "Arial",
					color: "#ffff00",
					strokeColor: "#ff0000",
					strokeWidth: 3,
					x: 35,
					y: -150,
					textAnimations: applyTextAnimationPreset({
						animations: { schemaVersion: 1 },
						preset: getTextAnimationPreset({
							phase: "entrance",
							presetId: "scale-up",
						}),
					}),
				}),
			],
		});
		const lane = await run<{ trackId: string }>({
			args: [
				"editor:track:create",
				"--type",
				"captions",
				"--name",
				"Bilingual captions",
			],
		});
		const caption = {
			type: "captions",
			trackId: lane.trackId,
			startTime: 0,
			duration: 3,
			content: "字幕背景",
			secondaryContent:
				"Caption background wraps automatically across multiple lines so later captions must reserve the complete measured height of every preceding line.",
			style: {
				fontFamily: "Arial",
				fontSize: 42,
				fontColor: "#ffffff",
				fontWeight: 400,
				outlineWidth: 0,
				backgroundColor: "#00ffff",
				bgOpacity: 0.7,
				secondary: { fontFamily: "Arial", fontSize: 28, fontColor: "#ffffff" },
			},
		};
		const added = await run<{ warnings?: string[] }>({
			args: ["editor:timeline:add-element", "--data", JSON.stringify(caption)],
		});
		expect(added.warnings ?? []).toEqual([]);
		const stackedLane = await run<{ trackId: string }>({
			args: [
				"editor:track:create",
				"--type",
				"captions",
				"--name",
				"Overlapping captions",
			],
		});
		const stacked = await run<{ warnings?: string[] }>({
			args: [
				"editor:timeline:add-element",
				"--data",
				JSON.stringify({
					type: "captions",
					trackId: stackedLane.trackId,
					startTime: 0.25,
					duration: 2.75,
					content: "Later caption",
					style: {
						...caption.style,
						fontSize: 30,
						backgroundColor: "#ff00ff",
						bgOpacity: 1,
					},
				}),
			],
		});
		expect(stacked.warnings ?? []).toEqual([]);
		const before = await run<{ tracks: unknown[] }>({
			args: ["editor:timeline:export"],
		});
		const saved = await page.evaluate(async () => {
			return await (
				window as unknown as {
					__timelineStore: {
						getState: () => { saveImmediate: () => Promise<boolean> };
					};
				}
			).__timelineStore
				.getState()
				.saveImmediate();
		});
		expect(saved, "project persistence completed").toBe(true);
		// Reload rebuilds the renderer stores from the saved project, not the in-memory fixture.
		await page.reload();
		await expect(page.getByTestId("export-button")).toBeVisible({
			timeout: 30_000,
		});
		const after = await run<{ tracks: unknown[] }>({
			args: ["editor:timeline:export"],
		});
		expect(after.tracks).toMatchObject(before.tracks);
		await page.setViewportSize({ width: 3200, height: 2160 });
		await run({ args: ["editor:timeline:seek", "--time", "1.5"] });
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								__playbackStore: { getState: () => { currentTime: number } };
							}
						).__playbackStore.getState().currentTime
				)
			)
			.toBeCloseTo(1.5, 3);
		await page.keyboard.press("Escape");
		await expect(
			page
				.getByTestId("preview-capture-surface")
				.getByText(caption.secondaryContent, { exact: true })
		).toBeVisible();
		await page.evaluate(async () => {
			await document.fonts.ready;
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
		});
		const previewPath = path.join(dir, "preview.png");
		const previewBounds = await page
			.getByTestId("preview-capture-surface")
			.boundingBox();
		expect(
			previewBounds?.width,
			"preview is sampled at project resolution"
		).toBeGreaterThanOrEqual(scenario.width);
		expect(
			previewBounds?.height,
			"preview is sampled at project resolution"
		).toBeGreaterThanOrEqual(scenario.height);
		await page
			.getByTestId("preview-capture-surface")
			.screenshot({ path: previewPath });
		const preview = verifyDesktopPreview({
			file: previewPath,
			projectWidth: scenario.width,
			projectHeight: scenario.height,
		});
		await page.screenshot({ path: path.join(dir, "reopened-editor.png") });
		const records: Record<string, ReturnType<typeof verifyDesktopExport>> = {};
		const uiRun = async ({
			name,
			quality,
			engine,
			shortEdge,
		}: {
			name: string;
			quality: "1080p" | "720p" | "480p";
			engine: "cli" | "standard";
			shortEdge: number;
		}) => {
			const output = path.join(dir, `${name}.mp4`);
			await exportFromDialog({ page, electronApp, output, quality, engine });
			const scale = shortEdge / 720;
			records[name] = verifyDesktopExport({
				file: output,
				width: Math.round((scenario.width * scale) / 2) * 2,
				height: Math.round((scenario.height * scale) / 2) * 2,
				projectWidth: scenario.width,
				projectHeight: scenario.height,
			});
		};
		await uiRun({
			name: "dialog-cli-1080",
			quality: "1080p",
			engine: "cli",
			shortEdge: 1080,
		});
		await uiRun({
			name: "dialog-cli-480",
			quality: "480p",
			engine: "cli",
			shortEdge: 480,
		});
		const apiRun = async ({ engine }: { engine: "native" | "muxer" }) => {
			const output = path.join(dir, `api-${engine}-1080.mp4`);
			const width = scenario.width * 1.5;
			const height = scenario.height * 1.5;
			await run({
				args: [
					"editor:export:start",
					"--engine",
					engine,
					"--data",
					JSON.stringify({ width, height, fps: 30, format: "mp4" }),
					"--output",
					output,
					"--poll",
				],
			});
			records[engine] = verifyDesktopExport({
				file: output,
				width,
				height,
				projectWidth: scenario.width,
				projectHeight: scenario.height,
			});
		};
		await apiRun({ engine: "native" });
		await apiRun({ engine: "muxer" });
		await uiRun({
			name: "dialog-standard-1080",
			quality: "1080p",
			engine: "standard",
			shortEdge: 1080,
		});
		writeFileSync(
			path.join(dir, "evidence.json"),
			JSON.stringify(
				{ projectId, scenario, savedProjectReload: true, preview, records },
				null,
				2
			)
		);
		const reference = records["dialog-cli-1080"];
		for (const [name, record] of Object.entries(records)) {
			for (const channel of [0, 1, 2]) {
				expect(
					Math.abs(
						record.backgroundFill[channel] - reference.backgroundFill[channel]
					),
					`${name} caption background color channel ${channel}`
				).toBeLessThanOrEqual(6);
				expect(
					Math.abs(
						record.backgroundFill[channel] - preview.backgroundFill[channel]
					),
					`${name} caption background matches editor preview channel ${channel}`
				).toBeLessThanOrEqual(6);
			}
			for (const kind of ["text", "background", "stackedBackground"] as const) {
				for (const edge of ["left", "right", "top", "bottom"] as const) {
					expect(
						Math.abs(record[kind][edge] - reference[kind][edge]),
						`${name} ${kind} ${edge} in project coordinates`
					).toBeLessThanOrEqual(3);
					// The editor screenshot is resized from its UI viewport; its edges
					// include one extra resampling step beyond the encoded exports.
					expect(
						Math.abs(record[kind][edge] - preview[kind][edge]),
						`${name} ${kind} ${edge} matches editor preview`
					).toBeLessThanOrEqual(4);
				}
			}
		}
	});
}
