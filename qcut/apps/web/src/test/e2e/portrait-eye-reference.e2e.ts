import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	createPortraitReferenceCapture,
	preparePortraitReferenceProject,
	readPreview,
	readValues,
	type ReferenceWindow,
} from "./helpers/portrait-reference";
import { exportPortraitReference } from "./helpers/portrait-reference-export";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_EYE_E2E_OUTPUT ??
		"output/playwright/portrait-eye-reference"
);
const { changeAndCapture, captureSource } = createPortraitReferenceCapture({
	output,
});
const cases = [
	{
		label: "大眼",
		key: "face_adjust_EnlargeEye",
		values: [50, 100],
		min: 0,
		max: 100,
	},
	{
		label: "亮眼",
		key: "face_adjust_BrightEye",
		values: [50, 100],
		min: 0,
		max: 100,
	},
	{
		label: "眼距",
		key: "face_adjust_EyeSpacing",
		values: [-50, 50],
		min: -50,
		max: 50,
	},
	{
		label: "开眼角",
		key: "face_adjust_inner_corner",
		values: [50, 100],
		min: 0,
		max: 100,
	},
	{
		label: "眼高低",
		key: "face_adjust_MoveEye",
		values: [-50, 50],
		min: -50,
		max: 50,
	},
	{
		label: "眼倾斜",
		key: "face_adjust_EyeTilted",
		values: [-100, 50, 100],
		min: -100,
		max: 100,
	},
];

test("six eye controls render independently, reset, resize, reopen and export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and local native runtime"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-eye-reference-")
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
		expect(
			await features
				.getByRole("slider")
				.evaluateAll((sliders) =>
					sliders.map((slider) => slider.getAttribute("aria-label"))
				)
		).toEqual(cases.map(({ label }) => label));
		await page
			.getByLabel("眼倾斜数值", { exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "00-eyes-ui.png"),
			animations: "disabled",
		});
		await cases.reduce(async (previous, control) => {
			await previous;
			const slider = features.getByRole("slider", {
				name: control.label,
				exact: true,
			});
			await expect(slider).toHaveAttribute(
				"aria-valuemin",
				String(control.min)
			);
			await expect(slider).toHaveAttribute(
				"aria-valuemax",
				String(control.max)
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
				expect([sample.width, sample.height]).toEqual([1080, 1620]);
				samples.push(sample);
			}, Promise.resolve());
			await slider.press("Home");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: control.min });
			await slider.press("End");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: control.max });
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
			value: 50,
			name: "14-eye-restored",
		});
		expect(eye.hash).toBe(samples[0].hash);
		const combined = await changeAndCapture({
			page,
			label: "亮眼",
			value: 100,
			name: "15-eyes-combined",
			previousHash: eye.hash,
		});
		const combinedValues = {
			face_adjust_EnlargeEye: 50,
			face_adjust_BrightEye: 100,
		};
		expect(combined.values).toEqual(combinedValues);
		await captureSource({ page, name: "15-eyes-combined" });
		await features
			.getByRole("button", { name: "重置亮眼", exact: true })
			.click();
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(eye.hash);
		const restored = await changeAndCapture({
			page,
			label: "亮眼",
			value: 100,
			name: "16-eyes-restored",
			previousHash: eye.hash,
		});
		expect(restored.hash).toBe(combined.hash);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByLabel("亮眼数值", { exact: true }).hover();
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		await page.screenshot({
			path: path.join(output, "16-eyes-compact-ui.png"),
			animations: "disabled",
		});
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
			path.join(output, "17-eyes-reopened-frame.png"),
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
		await expect(page.getByLabel("大眼数值", { exact: true })).toHaveValue(
			"50"
		);
		await expect(page.getByLabel("亮眼数值", { exact: true })).toHaveValue(
			"100"
		);
		await page
			.getByLabel("眼倾斜数值", { exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "17-eyes-reopened-ui.png"),
			animations: "disabled",
		});
		const exported = await exportPortraitReference({
			app,
			page,
			output,
			name: "18-eyes",
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
					...exported,
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
