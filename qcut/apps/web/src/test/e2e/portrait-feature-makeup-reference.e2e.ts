import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { expect, test } from "@playwright/test";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../../../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
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
	process.env.QCUT_PORTRAIT_FEATURE_E2E_OUTPUT ??
		"output/playwright/portrait-feature-makeup-reference"
);
const groups = [
	{ category: "eyes", label: "眼睛" },
	{ category: "nose", label: "鼻子" },
	{ category: "mouth", label: "嘴巴" },
	{ category: "brows", label: "眉毛" },
] as const;
const makeupOnly = process.env.QCUT_PORTRAIT_MAKEUP_ONLY === "1";
const makeupLabels = {
	look: "套装",
	lip: "口红",
	blush: "腮红",
	contour: "修容",
	aegyo: "卧蚕",
	brows: "眉毛",
	lashes: "睫毛",
	eyeliner: "眼线",
	eyeshadow: "眼影",
	contacts: "美瞳",
	highlight: "高光",
	freckles: "雀斑",
};

test("canonical features and selectable makeup cards render, reset, resize, reopen and export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires a real portrait and local native runtime"
	);
	test.setTimeout(900_000);
	if (!source) throw new Error("Missing portrait source");
	const image = await loadImage(source);
	const canvasSize = {
		width: 1080,
		height: Math.round((1080 * image.height) / image.width / 2) * 2,
	};
	if (canvasSize.height < 64 || canvasSize.height > 4096) {
		throw new Error("Portrait aspect ratio outside reference bounds");
	}
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-feature-makeup-")
	);
	let app = await startElectronApp({ userDataDirectory });
	let page = await getMainWindow(app);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const capture = createPortraitReferenceCapture({ output });
	const samples: Array<Awaited<ReturnType<typeof capture.changeAndCapture>>> =
		[];
	const makeupSamples: Array<Record<string, unknown>> = [];
	try {
		const { panel, features } = await preparePortraitReferenceProject({
			page,
			source,
			canvasSize,
		});
		await (makeupOnly ? [] : groups).reduce(async (previous, group) => {
			await previous;
			await features
				.getByRole("button", { name: group.label, exact: true })
				.click();
			const controls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
				({ section, category }) =>
					section === "features" && category === group.category
			);
			expect(
				await features
					.getByRole("slider")
					.evaluateAll((sliders) =>
						sliders.map((slider) => slider.getAttribute("aria-label"))
					)
			).toEqual(controls.map(({ titleZh }) => titleZh));
			await controls.reduce(async (prior, control) => {
				await prior;
				await expect(
					page.getByLabel(`${control.titleZh}数值`, { exact: true })
				).toBeEnabled();
				const values =
					control.min < 0 ? [control.min, control.max] : [50, control.max];
				await values.reduce(async (priorValue, value) => {
					await priorValue;
					const sample = await capture.changeAndCapture({
						page,
						label: control.titleZh,
						value,
						name: `${control.key}-${value}`,
						previousHash: samples.at(-1)?.hash,
					});
					expect(sample.values).toEqual({ [control.key]: value });
					expect([sample.width, sample.height]).toEqual([
						canvasSize.width,
						canvasSize.height,
					]);
					await capture.captureSource({ page, name: sample.name });
					samples.push(sample);
				}, Promise.resolve());
				await features
					.getByRole("button", { name: `重置${control.titleZh}`, exact: true })
					.click();
				await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
				await features
					.getByRole("button", { name: "重置本组", exact: true })
					.click();
				await expect.poll(() => readValues({ page })).toEqual({});
			}, Promise.resolve());
		}, Promise.resolve());
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		await panel.getByRole("button", { name: "美妆", exact: true }).click();
		const makeup = page.getByTestId("portrait-section-makeup");
		await JIANYING_PORTRAIT_MAKEUP_CARDS.filter(
			({ legacyOnly }) => !legacyOnly
		).reduce(async (previous, card) => {
			await previous;
			await makeup
				.getByRole("tab", { name: makeupLabels[card.category], exact: true })
				.click();
			const button = makeup.getByRole("button", {
				name: card.titleZh,
				exact: true,
			});
			await expect(button).toBeEnabled();
			const readCover = () =>
				button.locator("img").evaluateAll(
					(images) =>
						images.length === 1 &&
						images.every((image) => {
							const cover = image as HTMLImageElement;
							return (
								cover.complete &&
								cover.naturalWidth > 0 &&
								cover.naturalHeight > 0
							);
						})
				);
			if (process.env.QCUT_REQUIRE_PORTRAIT_COVERS === "1") {
				await expect
					.poll(readCover, {
						message: `${card.id} requires its actual catalog cover`,
						timeout: 10_000,
					})
					.toBe(true);
			}
			const coverRendered = await readCover();
			await button.click();
			const sample = await capture.changeAndCapture({
				page,
				label: "程度",
				value: card.defaultIntensity,
				name: card.id,
			});
			await capture.captureSource({ page, name: card.id });
			const saved = await page.evaluate(() => {
				const element = (window as unknown as ReferenceWindow).__timelineStore
					.getState()
					.tracks.flatMap((track) => track.elements)[0];
				return element?.type === "media"
					? element.portraitAdjustments?.makeup
					: undefined;
			});
			expect(saved).toEqual({
				[card.category]: { cardId: card.id, intensity: card.defaultIntensity },
			});
			makeupSamples.push({
				...sample,
				cardId: card.id,
				category: card.category,
				coverRendered,
				makeup: saved,
			});
			await makeup
				.getByRole("button", { name: "重置程度", exact: true })
				.click();
			await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
			await expect(button).toHaveAttribute("aria-pressed", "true");
			const restored = await capture.changeAndCapture({
				page,
				label: "程度",
				value: card.defaultIntensity,
				name: `${card.id}-restored`,
			});
			expect(restored.hash).toBe(sample.hash);
			await makeup.getByRole("button", { name: "无", exact: true }).click();
			await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
		}, Promise.resolve());
		await makeup.getByRole("tab", { name: "口红", exact: true }).click();
		await makeup.getByRole("button", { name: "柔和粉", exact: true }).click();
		const lipPreview = await capture.changeAndCapture({
			page,
			label: "程度",
			value: 50,
			name: "combined-lip",
		});
		const makeupLayouts: Array<Record<string, unknown>> = [];
		await [
			{ width: 1280, height: 800 },
			{ width: 1800, height: 1100 },
		].reduce(async (previous, viewport) => {
			await previous;
			await page.setViewportSize(viewport);
			await makeup.getByLabel("程度数值", { exact: true }).hover();
			await expect
				.poll(async () => (await readPreview({ page })).hash)
				.toBe(lipPreview.hash);
			const layout = await makeup.evaluate((element) => {
				const panel = element.getBoundingClientRect();
				const buttons = Array.from(element.querySelectorAll("button"));
				const cards = buttons.filter((button) =>
					button.hasAttribute("aria-pressed")
				);
				return {
					overflow: element.scrollWidth > element.clientWidth,
					contained: buttons.every((button) => {
						const rect = button.getBoundingClientRect();
						return rect.left >= panel.left && rect.right <= panel.right + 1;
					}),
					thumbnailSizes: cards.map((card) => {
						const rect = card.firstElementChild?.getBoundingClientRect();
						return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
					}),
				};
			});
			expect(layout.overflow).toBe(false);
			expect(layout.contained).toBe(true);
			expect(layout.thumbnailSizes).toHaveLength(3);
			for (const size of layout.thumbnailSizes) {
				expect(size.width).toBeGreaterThan(40);
				expect(size.width).toBeLessThanOrEqual(65);
				expect(Math.abs(size.width - size.height)).toBeLessThan(1);
			}
			const filename = `makeup-ui-${viewport.width}.png`;
			await page.screenshot({
				path: path.join(output, filename),
				animations: "disabled",
			});
			makeupLayouts.push({ viewport, ...layout, filename });
		}, Promise.resolve());
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		await features.getByRole("button", { name: "鼻子", exact: true }).click();
		const combined = await capture.changeAndCapture({
			page,
			label: "小翘鼻",
			value: 50,
			name: "combined-nose-makeup",
			previousHash: lipPreview.hash,
		});
		await capture.captureSource({ page, name: "combined-nose-makeup" });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByLabel("小翘鼻数值", { exact: true }).hover();
		try {
			await expect
				.poll(async () => (await readPreview({ page })).hash, {
					timeout: 30_000,
				})
				.toBe(combined.hash);
		} finally {
			const resized = await readPreview({ page });
			await writeFile(
				path.join(output, "combined-resized-frame.png"),
				resized.png
			);
			const resizedSource = await capture.captureSource({
				page,
				name: "combined-resized",
			});
			await writeFile(
				path.join(output, "combined-resized.json"),
				JSON.stringify({
					expected: combined,
					hash: resized.hash,
					width: resized.width,
					height: resized.height,
					commits: resized.commits,
					source: resizedSource,
					values: await readValues({ page }),
				})
			);
		}
		await page.screenshot({
			path: path.join(output, "compact-ui.png"),
			animations: "disabled",
		});
		const url = page.url();
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
		await page.goto(url);
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		const exported = await exportPortraitReference({
			app,
			page,
			output,
			name: "nose-makeup-combined",
		});
		expect(exported.videoStream.codec_name).toBe("h264");
		expect([exported.videoStream.width, exported.videoStream.height]).toEqual([
			canvasSize.width,
			canvasSize.height,
		]);
		expect(errors).toEqual([]);
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					source,
					sourceSha256: createHash("sha256")
						.update(await readFile(source))
						.digest("hex"),
					canvasSize,
					mode: makeupOnly ? "makeup-only" : "features-and-makeup",
					samples,
					makeupSamples,
					makeupLayouts,
					combined,
					exported,
					errors,
				},
				null,
				2
			)
		);
	} finally {
		await app.close();
	}
});
