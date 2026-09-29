import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
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
	process.env.QCUT_PORTRAIT_SKIN_E2E_OUTPUT ??
		"output/playwright/portrait-skin-reference"
);
const { changeAndCapture, captureSource } = createPortraitReferenceCapture({
	output,
});
const cases = [
	{ label: "磨皮", key: "face_adjust_Smooth" },
	{ label: "美白", key: "face_adjust_Whiten" },
	{ label: "匀肤", key: "face_adjust_yunfu" },
	{ label: "丰盈", key: "face_adjust_fuling" },
	{ label: "祛斑祛痘", key: "face_adjust_SpotAcne" },
	{ label: "祛法令纹", key: "face_adjust_NasolabialFolds" },
	{ label: "祛黑眼圈", key: "face_adjust_Pouch" },
	{ label: "清晰", key: "face_adjust_Clarity" },
];

async function pixels({ png }: { png: Buffer }) {
	const image = await loadImage(png);
	const canvas = createCanvas(image.width, image.height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	return context.getImageData(0, 0, image.width, image.height).data;
}

async function compareSource({ name }: { name: string }) {
	const original = await pixels({
		png: await readFile(path.join(output, `${name}-input.png`)),
	});
	const result = await pixels({
		png: await readFile(path.join(output, `${name}-frame.png`)),
	});
	expect(result.length).toBe(original.length);
	let changedPixels = 0;
	let maximumDelta = 0;
	for (let offset = 0; offset < result.length; offset += 4) {
		const delta = Math.max(
			Math.abs(result[offset] - original[offset]),
			Math.abs(result[offset + 1] - original[offset + 1]),
			Math.abs(result[offset + 2] - original[offset + 2])
		);
		if (delta > 1) changedPixels += 1;
		maximumDelta = Math.max(maximumDelta, delta);
	}
	expect(changedPixels).toBeGreaterThan(0);
	return { changedPixels, maximumDelta };
}

test("eight skin controls render, reset, reopen and export with legacy keys", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and local native runtime"
	);
	test.setTimeout(420_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-skin-reference-")
	);
	let app = await startElectronApp({ userDataDirectory });
	let page = await getMainWindow(app);
	const errors: string[] = [];
	const samples: Array<
		Awaited<ReturnType<typeof changeAndCapture>> &
			Awaited<ReturnType<typeof compareSource>>
	> = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const { panel } = await preparePortraitReferenceProject({ page, source });
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		await panel.getByRole("button", { name: "皮肤管理", exact: true }).click();
		const skin = page.getByTestId("portrait-section-skin");
		const labels = await page
			.getByTestId("portrait-group-skin")
			.getByRole("slider")
			.evaluateAll((sliders) =>
				sliders.map((slider) => slider.getAttribute("aria-label"))
			);
		expect(labels.slice(0, 8)).toEqual(cases.map(({ label }) => label));
		expect(await skin.getByRole("slider").count()).toBe(10);
		await page.getByLabel("清晰数值", { exact: true }).hover();
		await expect(
			skin.getByRole("slider", { name: "磨皮", exact: true })
		).toBeInViewport({ ratio: 1 });
		await expect(
			skin.getByRole("slider", { name: "清晰", exact: true })
		).toBeInViewport({ ratio: 1 });
		await page.screenshot({
			path: path.join(output, "00-skin-ui.png"),
			animations: "disabled",
		});
		await cases.reduce(async (previous, control) => {
			await previous;
			const slider = skin.getByRole("slider", {
				name: control.label,
				exact: true,
			});
			await expect(slider).toHaveAttribute("aria-valuemin", "0");
			await expect(slider).toHaveAttribute("aria-valuemax", "100");
			await [50, 100].reduce(async (prior, value) => {
				await prior;
				const name = `${control.key}-${value}`;
				const sample = await changeAndCapture({
					page,
					label: control.label,
					value,
					name,
					previousHash: samples.at(-1)?.hash,
				});
				expect(sample.values).toEqual({ [control.key]: value });
				expect([sample.width, sample.height]).toEqual([1080, 1620]);
				await captureSource({ page, name });
				samples.push({ ...sample, ...(await compareSource({ name })) });
			}, Promise.resolve());
			await slider.press("Home");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: 0 });
			await slider.press("End");
			await expect
				.poll(() => readValues({ page }))
				.toEqual({ [control.key]: 100 });
			await skin
				.getByRole("button", { name: `重置${control.label}`, exact: true })
				.click();
			await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
			await skin.getByRole("button", { name: "重置本组", exact: true }).click();
			await expect.poll(() => readValues({ page })).toEqual({});
		}, Promise.resolve());
		const folds = await changeAndCapture({
			page,
			label: "祛法令纹",
			value: 32,
			name: "17-folds-32",
		});
		const combined = await changeAndCapture({
			page,
			label: "祛黑眼圈",
			value: 64,
			name: "18-skin-combined",
			previousHash: folds.hash,
		});
		const combinedValues = {
			face_adjust_NasolabialFolds: 32,
			face_adjust_Pouch: 64,
		};
		expect(combined.values).toEqual(combinedValues);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByLabel("祛黑眼圈数值", { exact: true }).hover();
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		await page.screenshot({
			path: path.join(output, "19-skin-compact-ui.png"),
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
		const group = page
			.getByTestId("jianying-portrait-adjustments")
			.getByRole("button", { name: "皮肤管理", exact: true });
		if ((await group.getAttribute("aria-expanded")) !== "true")
			await group.click();
		await expect(page.getByLabel("祛法令纹数值", { exact: true })).toHaveValue(
			"32"
		);
		await expect(page.getByLabel("祛黑眼圈数值", { exact: true })).toHaveValue(
			"64"
		);
		await page.getByLabel("清晰数值", { exact: true }).hover();
		await expect(page.getByLabel("磨皮数值", { exact: true })).toBeInViewport({
			ratio: 1,
		});
		await expect(page.getByLabel("清晰数值", { exact: true })).toBeInViewport({
			ratio: 1,
		});
		const reopened = await readPreview({ page });
		expect(reopened.hash).toBe(combined.hash);
		await writeFile(
			path.join(output, "20-skin-reopened-frame.png"),
			reopened.png
		);
		await page.screenshot({
			path: path.join(output, "20-skin-reopened-ui.png"),
			animations: "disabled",
		});
		const exported = await exportPortraitReference({
			app,
			page,
			output,
			name: "21-skin",
		});
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					source,
					userDataDirectory,
					samples,
					combined,
					reopenedHash: reopened.hash,
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
