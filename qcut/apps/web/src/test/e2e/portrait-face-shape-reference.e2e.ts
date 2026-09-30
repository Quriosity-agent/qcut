import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import matrix from "../../../../../scripts/fixtures/portrait-face-shape-reference.json";
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
	process.env.QCUT_PORTRAIT_FACE_SHAPE_OUTPUT ??
		"output/playwright/portrait-face-shape-reference"
);

test("face shape and existing skin tone render isolated values, reset, reopen and export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and native runtime"
	);
	test.setTimeout(600_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-face-shape-")
	);
	let app = await startElectronApp({ userDataDirectory });
	let page = await getMainWindow(app);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const capture = createPortraitReferenceCapture({ output });
	const samples: Array<Awaited<ReturnType<typeof capture.changeAndCapture>>> =
		[];
	const uiLabels: Record<string, Array<string | null>> = {};
	const contourExports: Array<
		Awaited<ReturnType<typeof exportPortraitReference>> & {
			name: string;
			values: Awaited<ReturnType<typeof readValues>>;
			exportSha256: string;
			frameSha256: string;
		}
	> = [];
	let exported: Awaited<ReturnType<typeof exportPortraitReference>> | undefined;
	let reopenedHash: string | undefined;
	let reportFailure: Error | undefined;
	async function exportContour({
		name,
		value,
	}: {
		name: string;
		value: number;
	}) {
		const expectedValues = value ? { face_adjust_lunkuopinghua: value } : {};
		expect(await readValues({ page })).toEqual(expectedValues);
		const directory = path.join(output, "contour-exports", name);
		await mkdir(directory, { recursive: true });
		const result = await exportPortraitReference({
			app,
			page,
			output: directory,
			name,
			expectedFrames: 150,
		});
		expect(result.videoStream).toMatchObject({
			codec_name: "h264",
			width: 1080,
			height: 1620,
			pix_fmt: "yuv420p",
			color_range: "tv",
			color_space: "bt709",
			color_transfer: "bt709",
			color_primaries: "bt709",
			avg_frame_rate: "30/1",
		});
		expect(Number(result.videoStream.duration)).toBeCloseTo(5, 3);
		contourExports.push({
			name,
			values: await readValues({ page }),
			...result,
			exportSha256: createHash("sha256")
				.update(await readFile(result.exportPath))
				.digest("hex"),
			frameSha256: createHash("sha256")
				.update(await readFile(path.join(directory, "export-frame.png")))
				.digest("hex"),
		});
		await page
			.getByRole("button", { name: "Close export dialog", exact: true })
			.click();
		await page
			.getByTestId("media-properties")
			.getByRole("tab", { name: "美颜美体", exact: true })
			.click();
	}
	try {
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: 5,
		});
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		await exportContour({ name: "neutral", value: 0 });
		const groups = [
			{
				section: "face-shape",
				title: "脸型",
				controls: matrix.faceControls.filter(({ key }) => key !== null),
			},
			{
				section: "skin",
				title: "皮肤管理",
				controls: [matrix.qcutSkinControl],
			},
		];
		await groups.reduce(async (prior, group) => {
			await prior;
			await panel
				.getByRole("button", { name: group.title, exact: true })
				.click();
			const section = page.getByTestId(`portrait-section-${group.section}`);
			uiLabels[group.section] = await section
				.getByRole("slider")
				.evaluateAll((sliders) =>
					sliders.map((slider) => slider.getAttribute("aria-label"))
				);
			await group.controls.reduce(async (previous, control) => {
				await previous;
				const slider = section.getByRole("slider", {
					name: control.label,
					exact: true,
				});
				await expect(slider).toHaveAttribute(
					"aria-valuemin",
					control.values[0] < 0 ? "-50" : "0"
				);
				await expect(slider).toHaveAttribute(
					"aria-valuemax",
					String(control.values.at(-1))
				);
				await control.values.reduce(async (before, value) => {
					await before;
					await section
						.getByRole("button", { name: "重置本组", exact: true })
						.click();
					await expect.poll(() => readValues({ page })).toEqual({});
					const name = `${control.slug}-${value}`;
					const sample = await capture.changeAndCapture({
						page,
						label: control.label,
						value,
						name,
					});
					if (!control.key) throw new Error("Missing mapped QCut control");
					expect(sample.values).toEqual({ [control.key]: value });
					expect([sample.width, sample.height]).toEqual([1080, 1620]);
					await capture.captureSource({ page, name });
					const original = await readFile(
						path.join(output, `${name}-input.png`)
					);
					expect(sample.hash).not.toBe(
						createHash("sha256").update(original).digest("hex")
					);
					samples.push(sample);
					if (control.slug === "smooth-contour") {
						await exportContour({ name, value });
						const groupButton = panel.getByRole("button", {
							name: "脸型",
							exact: true,
						});
						if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
							await groupButton.click();
						}
					}
				}, Promise.resolve());
				await section
					.getByRole("button", { name: `重置${control.label}`, exact: true })
					.click();
				await expect(page.getByTestId("color-preview-canvas")).toHaveCount(0);
				await section
					.getByRole("button", { name: "重置本组", exact: true })
					.click();
				await expect.poll(() => readValues({ page })).toEqual({});
			}, Promise.resolve());
			await panel
				.getByRole("button", { name: group.title, exact: true })
				.click();
		}, Promise.resolve());
		await exportContour({ name: "neutral-after", value: 0 });
		expect(contourExports[0].frameSha256).toBe(contourExports[3].frameSha256);
		expect(
			new Set(contourExports.slice(0, 3).map(({ frameSha256 }) => frameSha256))
				.size
		).toBe(3);
		await panel.getByRole("button", { name: "脸型", exact: true }).click();
		await capture.changeAndCapture({
			page,
			label: "窄脸",
			value: -25,
			name: "combined-narrow",
		});
		await capture.changeAndCapture({
			page,
			label: "下巴长短",
			value: 25,
			name: "combined-face",
		});
		const combined = await capture.changeAndCapture({
			page,
			label: "流畅脸",
			value: 50,
			name: "combined-contour",
		});
		const expectedValues = {
			face_adjust_CutFace: -25,
			face_adjust_Chin: 25,
			face_adjust_lunkuopinghua: 50,
		};
		expect(combined.values).toEqual(expectedValues);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByLabel("下巴长短数值", { exact: true }).hover();
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		await page.screenshot({ path: path.join(output, "compact-ui.png") });
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
			.toEqual(expectedValues);
		await expect
			.poll(async () => (await readPreview({ page })).hash, { timeout: 30_000 })
			.toBe(combined.hash);
		reopenedHash = (await readPreview({ page })).hash;
		await page.screenshot({ path: path.join(output, "reopened-ui.png") });
		exported = await exportPortraitReference({
			app,
			page,
			output,
			name: "face-shape-combined",
			expectedFrames: 150,
		});
		expect(errors).toEqual([]);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
		await page
			.screenshot({ path: path.join(output, "failure-ui.png") })
			.catch(() => {});
		throw error;
	} finally {
		try {
			await writeFile(
				path.join(output, "report.json"),
				JSON.stringify(
					{
						source,
						sourceSha256: createHash("sha256")
							.update(await readFile(source))
							.digest("hex"),
						userDataDirectory,
						samples,
						uiLabels,
						contourExports,
						reopenedHash,
						exported,
						errors,
					},
					null,
					2
				)
			);
		} catch (error) {
			reportFailure = error instanceof Error ? error : new Error(String(error));
			console.error("Could not save face shape evidence", error);
		} finally {
			await app.close();
		}
	}
	if (reportFailure) throw reportFailure;
});
