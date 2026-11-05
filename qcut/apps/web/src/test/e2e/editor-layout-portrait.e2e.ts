import {
	exercisePresetPersistence,
	exerciseHeaderNames,
} from "./helpers/editor-layout-persistence";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import { runQCutPipelineCli } from "./helpers/qcut-pipeline-cli";
import {
	applyTextAnimationPreset,
	getTextAnimationPreset,
} from "../../lib/text/text-animation-presets";

import {
	capture,
	selectPreset,
	assertLayout,
	exerciseToolbar,
	LAYOUT_PRESETS,
} from "./helpers/editor-layout-evidence";
import { createDesktopExportSource } from "./helpers/desktop-export-evidence";
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
	});
	return result.envelopes.at(-1) as T;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(300_000);
test("portrait controls remain reachable across six layouts and three window sizes", async ({
	apiPort,
	page,
	electronApp,
}, testInfo) => {
	const output = path.resolve(
		process.env.QCUT_LAYOUT_EVIDENCE_DIR ?? testInfo.outputPath("layouts")
	);
	mkdirSync(output, { recursive: true });
	page.setDefaultTimeout(15000);
	await electronApp.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
	);
	const scenario = { name: "portrait", width: 720, height: 1280 };
	const source = path.join(output, "source.mp4");
	createDesktopExportSource({ file: source, width: 720, height: 1280 });
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

	await run({ args: ["editor:timeline:seek", "--time", "1.5"] });
	await page.keyboard.press("Escape");
	const records: Awaited<ReturnType<typeof capture>>[] = [];
	await [
		{ width: 1440, height: 900 },
		{ width: 1280, height: 800 },
		{ width: 1920, height: 1080 },
	].reduce(async (previous, viewport) => {
		await previous;
		await page.setViewportSize(viewport);
		await LAYOUT_PRESETS.reduce(async (previousPreset, preset) => {
			await previousPreset;
			await selectPreset({ page, label: preset.label });
			await assertLayout({ page });
			records.push(
				await capture({
					page,
					output,
					name: `${viewport.width}x${viewport.height}-${preset.key}`,
				})
			);
			await exerciseToolbar({ page });
		}, Promise.resolve());
	}, Promise.resolve());
	await page.getByTestId("preview-play-button").click();
	await expect(page.getByTestId("preview-pause-button")).toBeVisible();
	await page.getByTestId("preview-pause-button").click();
	await page.getByTestId("timeline-play-button").click();
	await expect(page.getByTestId("timeline-pause-button")).toBeVisible();
	await page.getByTestId("timeline-pause-button").click();
	await run({ args: ["editor:timeline:seek", "--time", "1.5"] });
	await page.setViewportSize({ width: 1440, height: 900 });
	await selectPreset({ page, label: "默认布局" });
	records.push(await capture({ page, output, name: "switch-1-default" }));
	await selectPreset({ page, label: "音频创作" });
	records.push(await capture({ page, output, name: "switch-2-audio" }));
	await page.getByTitle("面板布局预设", { exact: true }).click();
	await page
		.getByRole("button", { name: "重置音频创作预设", exact: true })
		.click();
	await page.keyboard.press("Escape");
	records.push(await capture({ page, output, name: "switch-3-audio-reset" }));
	await selectPreset({ page, label: "默认布局" });
	records.push(
		await capture({ page, output, name: "switch-4-default-return" })
	);
	expect(
		records.find((record) => record.name === "switch-2-audio")!.timeline!.y
	).toBeLessThan(
		records.find((record) => record.name === "switch-1-default")!.timeline!.y -
			100
	);
	expect(
		records.find((record) => record.name === "switch-4-default-return")!
			.timeline!.y
	).toBeCloseTo(
		records.find((record) => record.name === "switch-1-default")!.timeline!.y,
		0
	);
	expect(
		records.find((record) => record.name === "switch-3-audio-reset")!.timeline!
			.y
	).toBeCloseTo(
		records.find((record) => record.name === "switch-2-audio")!.timeline!.y,
		0
	);
	writeFileSync(
		path.join(output, "measurements.json"),
		JSON.stringify(records, null, 2)
	);
	await exercisePresetPersistence({ page, output });
	await exerciseHeaderNames({ page, projectId, output });
	const finalTimeline = await run<{ tracks: unknown[] }>({
		args: ["editor:timeline:export"],
	});
	expect(finalTimeline.tracks).toMatchObject(before.tracks);
	writeFileSync(
		path.join(output, "timeline.json"),
		JSON.stringify(finalTimeline, null, 2)
	);
});
