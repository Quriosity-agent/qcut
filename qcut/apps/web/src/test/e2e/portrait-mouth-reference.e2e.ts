import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import {
	getMainWindow,
	startElectronApp,
	stubExportSaveDialog,
} from "./helpers/electron-helpers";
import {
	createPortraitReferenceCapture,
	preparePortraitReferenceProject,
	readPreview,
	readValues,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_MOUTH_E2E_OUTPUT ??
		"output/playwright/portrait-mouth-reference"
);
const { changeAndCapture, captureSource } = createPortraitReferenceCapture({
	output,
});

test("mouth controls use independent native routes, reset, reopen and export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and local native runtime"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-mouth-reference-")
	);
	let app = await startElectronApp({ userDataDirectory });
	let page = await getMainWindow(app);
	const errors: string[] = [];
	const samples: Awaited<ReturnType<typeof changeAndCapture>>[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const { features } = await preparePortraitReferenceProject({
			page,
			source,
		});
		await features.getByRole("button", { name: "嘴巴", exact: true }).click();
		expect(
			await features
				.getByRole("slider")
				.evaluateAll((sliders) =>
					sliders.map((slider) => slider.getAttribute("aria-label"))
				)
		).toEqual(["白牙", "嘴大小", "嘴高低", "嘴倾斜", "微笑唇", "笑容"]);
		await page.screenshot({
			path: path.join(output, "00-mouth-ui.png"),
			animations: "disabled",
		});
		const cases = [
			{
				label: "笑容",
				key: "face_adjust_Smile",
				values: [-100, -50, 50, 100],
				limit: 100,
			},
			{
				label: "微笑唇",
				key: "face_adjust_mouse_corner",
				values: [-50, -25, 25, 50],
				limit: 50,
			},
			{
				label: "嘴大小",
				key: "face_adjust_ZoomMouth",
				values: [-50, 50],
				limit: 50,
			},
			{
				label: "嘴高低",
				key: "face_adjust_MoveMouth",
				values: [-50, 50],
				limit: 50,
			},
			{
				label: "白牙",
				key: "face_adjust_WhiteTeeth",
				values: [100],
				limit: 100,
			},
		];
		await cases.reduce(async (previous, control) => {
			await previous;
			const slider = features.getByRole("slider", {
				name: control.label,
				exact: true,
			});
			await expect(slider).toHaveAttribute(
				"aria-valuemin",
				control.key === "face_adjust_WhiteTeeth" ? "0" : String(-control.limit)
			);
			await expect(slider).toHaveAttribute(
				"aria-valuemax",
				String(control.limit)
			);
			await control.values.reduce(async (prior, value) => {
				await prior;
				const sample = await changeAndCapture({
					page,
					label: control.label,
					value,
					name: `${control.key}-${value}`,
					previousHash: samples.at(-1)?.hash,
				});
				expect(sample.values).toEqual({ [control.key]: value });
				expect(sample.width).toBe(1080);
				expect(sample.height).toBe(1620);
				samples.push(sample);
			}, Promise.resolve());
			await slider.press("Home");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({
					[control.key]:
						control.key === "face_adjust_WhiteTeeth" ? 0 : -control.limit,
				});
			await slider.press("End");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: control.limit });
			await features
				.getByRole("button", { name: `重置${control.label}`, exact: true })
				.click();
			await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
			await features.getByRole("button", { name: "重置本组" }).click();
			await expect.poll(() => readValues({ page })).toEqual({});
		}, Promise.resolve());
		const smile = await changeAndCapture({
			page,
			label: "笑容",
			value: 50,
			name: "14-smile-restored",
			previousHash: samples.at(-1)?.hash,
		});
		expect(smile.hash).toBe(
			samples.find((sample) => sample.name === "face_adjust_Smile-50")?.hash
		);
		const combined = await changeAndCapture({
			page,
			label: "微笑唇",
			value: -25,
			name: "15-mouth-combined",
			previousHash: smile.hash,
		});
		const combinedValues = {
			face_adjust_Smile: 50,
			face_adjust_mouse_corner: -25,
		};
		expect(combined.values).toEqual(combinedValues);
		await features
			.getByRole("button", { name: "重置微笑唇", exact: true })
			.click();
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_Smile: 50, face_adjust_mouse_corner: 0 });
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(smile.hash);
		const restored = await changeAndCapture({
			page,
			label: "微笑唇",
			value: -25,
			name: "16-mouth-restored",
			previousHash: smile.hash,
		});
		expect(restored.hash).toBe(combined.hash);
		await captureSource({ page, name: "16-mouth-restored" });
		const editorUrl = page.url();
		await page.evaluate(async () =>
			(window as unknown as ReferenceWindow).__projectStore
				.getState()
				.saveCurrentProject()
		);
		await app.close();
		app = await startElectronApp({ userDataDirectory });
		page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		await page.setViewportSize({ width: 1800, height: 1100 });
		await page.goto(editorUrl);
		await expect
			.poll(() => readValues({ page }), { timeout: 30_000 })
			.toEqual(combinedValues);
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		await writeFile(
			path.join(output, "17-mouth-reopened-frame.png"),
			(await readPreview({ page })).png
		);
		await page.evaluate(() => {
			const timeline = (
				window as unknown as ReferenceWindow
			).__timelineStore.getState();
			const track = timeline.tracks.find((item) => item.elements.length > 0);
			if (!track) throw new Error("No reopened media");
			timeline.setSelectedElements([
				{ trackId: track.id, elementId: track.elements[0].id },
			]);
		});
		await page
			.getByTestId("media-properties")
			.getByRole("tab", { name: "美颜美体", exact: true })
			.click();
		const featureButton = page
			.getByTestId("jianying-portrait-adjustments")
			.getByRole("button", { name: "五官精修", exact: true });
		if ((await featureButton.getAttribute("aria-expanded")) !== "true")
			await featureButton.click();
		await page
			.getByTestId("portrait-section-features")
			.getByRole("button", { name: "嘴巴", exact: true })
			.click();
		await expect(page.getByLabel("笑容数值", { exact: true })).toHaveValue(
			"50"
		);
		await expect(page.getByLabel("微笑唇数值", { exact: true })).toHaveValue(
			"-25"
		);
		await page.getByLabel("笑容数值", { exact: true }).scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "17-mouth-reopened-ui.png"),
			animations: "disabled",
		});
		const exportPath = path.join(output, `mouth-${Date.now()}.mp4`);
		await stubExportSaveDialog({ electronApp: app, outputPath: exportPath });
		await page.getByTestId("export-button").click();
		const audio = page.getByRole("checkbox", {
			name: "Include audio in export",
		});
		if (await audio.count()) await audio.uncheck();
		await page.getByTestId("export-start-button").click();
		await expect
			.poll(
				async () => (await stat(exportPath).catch(() => ({ size: 0 }))).size,
				{ timeout: 180_000 }
			)
			.toBeGreaterThan(1_000);
		await expect(page.getByTestId("export-progress-bar")).toHaveCount(0, {
			timeout: 180_000,
		});
		if (!ffmpegPath) throw new Error("FFmpeg unavailable");
		const { stdout } = await promisify(execFile)(
			ffmpegPath,
			[
				"-v",
				"error",
				"-xerror",
				"-i",
				exportPath,
				"-map",
				"0:v:0",
				"-an",
				"-f",
				"framemd5",
				"-",
			],
			{ timeout: 30_000 }
		);
		const decodedFrames = stdout
			.split("\n")
			.filter((line) => line.trim() && !line.startsWith("#")).length;
		expect(decodedFrames).toBe(30);
		await promisify(execFile)(
			ffmpegPath,
			[
				"-y",
				"-v",
				"error",
				"-i",
				exportPath,
				"-frames:v",
				"1",
				path.join(output, "export-frame.png"),
			],
			{ timeout: 30_000 }
		);
		await page.screenshot({
			path: path.join(output, "18-mouth-export-ui.png"),
			animations: "disabled",
		});
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					source,
					userDataDirectory,
					samples,
					combined,
					reopenedHash: (await readPreview({ page })).hash,
					exportPath,
					decodedFrames,
					errors,
				},
				null,
				2
			)
		);
		expect(errors).toEqual([]);
	} catch (error) {
		await page
			.screenshot({ path: path.join(output, "failure-ui.png") })
			.catch(() => undefined);
		throw error;
	} finally {
		await app.close();
	}
});
