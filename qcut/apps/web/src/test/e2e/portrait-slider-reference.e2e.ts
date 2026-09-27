import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import {
	createPortraitReferenceCapture,
	preparePortraitReferenceProject,
	readValues,
	readPreview,
	type ReferenceWindow,
} from "./helpers/portrait-reference";
import {
	getMainWindow,
	startElectronApp,
	stubExportSaveDialog,
} from "./helpers/electron-helpers";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_REFERENCE_E2E_OUTPUT ??
		"output/playwright/portrait-slider-reference"
);

const { captureSource, changeAndCapture } = createPortraitReferenceCapture({
	output,
});

test("single-slider native preview, tilt, 3D nose, classic compatibility, reopen and export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires a real local portrait and native runtime"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing portrait source");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-portrait-reference-")
	);
	let app = await startElectronApp({ userDataDirectory });
	let page = await getMainWindow(app);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const { features } = await preparePortraitReferenceProject({
			page,
			source,
		});
		await page.screenshot({
			path: path.join(output, "00-baseline-ui.png"),
			animations: "disabled",
		});
		const tiltSamples: Awaited<ReturnType<typeof changeAndCapture>>[] = [];
		await [
			{ category: "嘴巴", label: "嘴倾斜", key: "face_adjust_MouthTilted" },
			{ category: "眼睛", label: "眼倾斜", key: "face_adjust_EyeTilted" },
		].reduce(async (previous, control) => {
			await previous;
			await features
				.getByRole("button", { name: control.category, exact: true })
				.click();
			const slider = page.getByRole("slider", {
				name: control.label,
				exact: true,
			});
			await expect(slider).toHaveAttribute("aria-valuemin", "-100");
			await expect(slider).toHaveAttribute("aria-valuemax", "100");
			await [-100, -50, 50, 100].reduce(async (prior, value) => {
				await prior;
				const sample = await changeAndCapture({
					page,
					label: control.label,
					value,
					name: `tilt-${control.key}-${value}`,
					previousHash: tiltSamples.at(-1)?.hash,
				});
				expect(sample.values).toEqual({ [control.key]: value });
				tiltSamples.push(sample);
			}, Promise.resolve());
			await slider.press("Home");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: -100 });
			await slider.press("End");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: 100 });
			await features
				.getByRole("button", { name: `重置${control.label}`, exact: true })
				.click();
			await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
			await features.getByRole("button", { name: "重置本组" }).click();
			await expect.poll(() => readValues({ page })).toEqual({});
		}, Promise.resolve());
		const eye = await changeAndCapture({
			page,
			label: "大眼",
			value: 100,
			name: "01-eye100",
		});
		await features.getByRole("button", { name: "重置本组" }).click();
		await expect.poll(() => readValues({ page })).toEqual({});
		const corner = await changeAndCapture({
			page,
			label: "开眼角",
			value: 99,
			name: "01b-corner99",
			previousHash: eye.hash,
		});
		expect(corner.values).toEqual({ face_adjust_inner_corner: 99 });
		const cornerSlider = page.getByRole("slider", {
			name: "开眼角",
			exact: true,
		});
		await cornerSlider.press("End");
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_inner_corner: 100 });
		await cornerSlider.press("ArrowLeft");
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_inner_corner: 99 });
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(corner.hash);
		await features
			.getByRole("button", { name: "重置开眼角", exact: true })
			.click();
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_inner_corner: 0 });
		await features.getByRole("button", { name: "重置本组" }).click();
		await expect.poll(() => readValues({ page })).toEqual({});
		await features.getByRole("button", { name: "鼻子", exact: true }).click();
		await expect(
			page.getByLabel("鼻部位移（基础）数值", { exact: true })
		).toHaveCount(0);
		const negative = await changeAndCapture({
			page,
			label: "鼻高低",
			value: -48,
			name: "02-nose-minus48",
			previousHash: eye.hash,
		});
		expect(negative.values).toEqual({ face_adjust_nose_position: -48 });
		expect({ width: negative.width, height: negative.height }).toEqual({
			width: 1080,
			height: 1620,
		});
		const commitsBeforeResize = (await readPreview({ page })).commits;
		await page.setViewportSize({ width: 1280, height: 800 });
		await expect
			.poll(async () => (await readPreview({ page })).commits, {
				timeout: 30_000,
			})
			.toBeGreaterThan(commitsBeforeResize);
		const resized = await readPreview({ page });
		expect(resized.hash).toBe(negative.hash);
		await page
			.getByLabel("鼻高低数值", { exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "02b-compact-ui.png"),
			animations: "disabled",
		});
		await page.setViewportSize({ width: 1800, height: 1100 });
		const positive = await changeAndCapture({
			page,
			label: "鼻高低",
			value: 50,
			name: "03-nose-plus50",
			previousHash: negative.hash,
		});
		expect(positive.values).toEqual({ face_adjust_nose_position: 50 });
		await features.getByRole("button", { name: "重置本组" }).click();
		await expect.poll(() => readValues({ page })).toEqual({});
		await page.screenshot({
			path: path.join(output, "04-reset-ui.png"),
			animations: "disabled",
		});
		await features.getByRole("button", { name: "精修", exact: true }).click();
		const classic = await changeAndCapture({
			page,
			label: "鼻部位移（基础）",
			value: -48,
			name: "05-classic-minus48",
			previousHash: positive.hash,
		});
		expect(classic.values).toEqual({ face_adjust_MoveNose: -48 });
		expect(classic.hash).not.toBe(negative.hash);
		await features.getByRole("button", { name: "重置本组" }).click();
		await features.getByRole("button", { name: "鼻子", exact: true }).click();
		const restored = await changeAndCapture({
			page,
			label: "鼻高低",
			value: -48,
			name: "06-nose-restored",
			previousHash: classic.hash,
		});
		expect(restored.hash).toBe(negative.hash);
		await features.getByRole("button", { name: "重置本组" }).click();
		const nose3dSamples: Awaited<ReturnType<typeof changeAndCapture>>[] = [];
		await [-50, -25, 25, 50, -48].reduce(async (previous, value) => {
			await previous;
			const sample = await changeAndCapture({
				page,
				label: "鼻大小",
				value,
				name: `08-nose3d-${value}`,
				previousHash: nose3dSamples.at(-1)?.hash ?? restored.hash,
			});
			expect(sample.values).toEqual({ face_adjust_3DNose_Big: value });
			nose3dSamples.push(sample);
		}, Promise.resolve());
		const nose3d = nose3dSamples.at(-1);
		if (!nose3d) throw new Error("Missing 3D nose sample");
		const noseSlider = page.getByRole("slider", {
			name: "鼻大小",
			exact: true,
		});
		await noseSlider.press("Home");
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_3DNose_Big: -50 });
		await noseSlider.press("End");
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_3DNose_Big: 50 });
		await features
			.getByRole("button", { name: "重置鼻大小", exact: true })
			.click();
		await expect
			.poll(() => readValues({ page }))
			.toEqual({ face_adjust_3DNose_Big: 0 });
		await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
		await page.screenshot({
			path: path.join(output, "09-nose3d-zero-ui.png"),
			animations: "disabled",
		});
		await features.getByRole("button", { name: "重置本组" }).click();
		const oldNose = await changeAndCapture({
			page,
			label: "鼻子大小（2D 基础）",
			value: -48,
			name: "10-nose2d-legacy",
			previousHash: nose3d.hash,
		});
		expect(oldNose.values).toEqual({ face_adjust_nose: -48 });
		expect(oldNose.hash).not.toBe(nose3d.hash);
		await features.getByRole("button", { name: "重置本组" }).click();
		const restored3d = await changeAndCapture({
			page,
			label: "鼻大小",
			value: -48,
			name: "11-nose3d-restored",
			previousHash: oldNose.hash,
		});
		expect(restored3d.hash).toBe(nose3d.hash);
		await features.getByRole("button", { name: "嘴巴", exact: true }).click();
		await changeAndCapture({
			page,
			label: "嘴倾斜",
			value: 50,
			name: "13-mouth-with-nose",
			previousHash: restored3d.hash,
		});
		await features.getByRole("button", { name: "眼睛", exact: true }).click();
		const combined = await changeAndCapture({
			page,
			label: "眼倾斜",
			value: -50,
			name: "14-combined-tilt-nose",
		});
		const combinedValues = {
			face_adjust_3DNose_Big: -48,
			face_adjust_MouthTilted: 50,
			face_adjust_EyeTilted: -50,
		};
		expect(combined.values).toEqual(combinedValues);
		const editorUrl = page.url();
		await captureSource({ page, name: "14-combined-tilt-nose" });
		await page.evaluate(async () => {
			await (window as unknown as ReferenceWindow).__projectStore
				.getState()
				.saveCurrentProject();
		});
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
			.poll(async () => (await readPreview({ page })).commits, {
				timeout: 30_000,
			})
			.toBeGreaterThan(0);
		await writeFile(
			path.join(output, "15-combined-reopened-frame.png"),
			(await readPreview({ page })).png
		);
		await captureSource({ page, name: "15-combined-reopened" });
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		await page.evaluate(() => {
			const timeline = (
				window as unknown as ReferenceWindow
			).__timelineStore.getState();
			const track = timeline.tracks.find((item) => item.elements.length > 0);
			if (!track) throw new Error("Missing reopened track");
			timeline.setSelectedElements([
				{ trackId: track.id, elementId: track.elements[0].id },
			]);
		});
		await page
			.getByTestId("media-properties")
			.getByRole("tab", { name: "美颜美体", exact: true })
			.click();
		const reopenedPanel = page.getByTestId("jianying-portrait-adjustments");
		const featureButton = reopenedPanel.getByRole("button", {
			name: "五官精修",
			exact: true,
		});
		if ((await featureButton.getAttribute("aria-expanded")) !== "true")
			await featureButton.click();
		await page
			.getByTestId("portrait-section-features")
			.getByRole("button", { name: "眼睛", exact: true })
			.click();
		await expect(page.getByLabel("眼倾斜数值", { exact: true })).toHaveValue(
			"-50"
		);
		await page.screenshot({
			path: path.join(output, "15-combined-reopened-ui.png"),
			animations: "disabled",
		});
		const exportPath = path.join(output, `tilt-nose-${Date.now()}.mp4`);
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
		await page.screenshot({
			path: path.join(output, "07-export-ui.png"),
			animations: "disabled",
		});
		if (!ffmpegPath) throw new Error("Missing FFmpeg for export verification");
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
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					source,
					userDataDirectory,
					exportPath,
					decodedFrames,
					samples: [
						...tiltSamples,
						eye,
						corner,
						negative,
						positive,
						classic,
						restored,
						...nose3dSamples,
						oldNose,
						restored3d,
						combined,
					],
					reopenedCombinedHash: (await readPreview({ page })).hash,
					viewportResize: {
						width: resized.width,
						height: resized.height,
						hash: resized.hash,
						unchanged: resized.hash === negative.hash,
					},
					errors,
				},
				null,
				2
			)
		);
		expect(errors).toEqual([]);
	} catch (error) {
		await page
			.screenshot({
				path: path.join(output, "failure-ui.png"),
				animations: "disabled",
			})
			.catch(() => undefined);
		throw error;
	} finally {
		await app.close();
	}
});
