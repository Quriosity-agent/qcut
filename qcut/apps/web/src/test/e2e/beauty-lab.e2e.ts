import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
	expect,
	test,
	type Page,
	type ElectronApplication,
} from "@playwright/test";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

async function verifyDifferencePNG({
	zip,
	name,
	changedPixels,
	width,
	height,
}: {
	zip: JSZip;
	name: string;
	changedPixels: number;
	width: number;
	height: number;
}) {
	const bytes = await zip.file(name)!.async("nodebuffer");
	const image = await loadImage(bytes);
	expect([image.width, image.height]).toEqual([width, height]);
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	const pixels = context.getImageData(0, 0, width, height).data;
	let changed = 0;
	let grayscaleOpaque = true;
	for (let index = 0; index < pixels.length; index += 4) {
		if (pixels[index] > 0) changed++;
		if (
			pixels[index] !== pixels[index + 1] ||
			pixels[index] !== pixels[index + 2] ||
			pixels[index + 3] !== 255
		)
			grayscaleOpaque = false;
	}
	expect(changed).toBe(changedPixels);
	expect(grayscaleOpaque).toBe(true);
}

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_BEAUTY_LAB_OUTPUT ?? "output/playwright/beauty-lab"
);

async function saveComparison({
	app,
	page,
	destination,
}: {
	app: ElectronApplication;
	page: Page;
	destination: string;
}) {
	await rm(destination, { force: true });
	await app.evaluate(({ BrowserWindow }, filename) => {
		const window = BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error("Missing download window");
		window.webContents.session.once("will-download", (_event, item) =>
			item.setSavePath(filename)
		);
	}, destination);
	await page
		.getByTestId("beauty-lab-dialog")
		.getByRole("button", { name: "导出对照 ZIP", exact: true })
		.click();
	let result: JSZip | undefined;
	await expect
		.poll(
			async () => {
				try {
					result = await JSZip.loadAsync(await readFile(destination));
					return true;
				} catch {
					return false;
				}
			},
			{ timeout: 30_000 }
		)
		.toBe(true);
	if (!result) throw new Error("Comparison ZIP not saved");
	return result;
}

test("Beauty Lab ZIP replaces stale comparison evidence", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires an opaque portrait input"
	);
	test.setTimeout(120_000);
	if (!source) throw new Error("Missing portrait input");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-lab-zip-")
	);
	const app = await startElectronApp({ userDataDirectory });
	try {
		const page = await getMainWindow(app);
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			path.basename(source)
		);
		const destination = path.join(output, "stale-comparison.zip");
		const stale = new JSZip().file("stale.txt", "prior output");
		await writeFile(
			destination,
			await stale.generateAsync({ type: "nodebuffer" })
		);
		const zip = await saveComparison({ app, page, destination });
		expect(zip.file("stale.txt")).toBeNull();
		const report = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		);
		expect(report.inputName).toBe(path.basename(source));
		expect(report.record).toBeNull();
		expect(report.candidateResultPresent).toBe(false);
		const original = await loadImage(
			await zip.file("original.png")!.async("nodebuffer")
		);
		expect([original.width, original.height]).toEqual([
			report.width,
			report.height,
		]);
		await page.screenshot({
			path: path.join(output, "stale-zip-replaced.png"),
			animations: "disabled",
		});
	} finally {
		await app.close();
	}
});

async function timelineSnapshot({ page }: { page: Page }) {
	return page.evaluate(() =>
		JSON.stringify(
			(window as unknown as ReferenceWindow).__timelineStore.getState().tracks
		)
	);
}

async function assertLabUnoccluded({ page }: { page: Page }) {
	await expect
		.poll(() =>
			page.getByTestId("beauty-lab-dialog").evaluate((node) => {
				const bounds = node.getBoundingClientRect();
				return [
					bounds.left + 6,
					bounds.left + bounds.width / 2,
					bounds.right - 6,
				].flatMap((x) =>
					[
						bounds.top + 6,
						bounds.top + bounds.height / 2,
						bounds.bottom - 6,
					].flatMap((y) => {
						const hit = document.elementFromPoint(x, y);
						return hit && node.contains(hit)
							? []
							: [{ x, y, blocker: hit?.className }];
					})
				);
			})
		)
		.toEqual([]);
}

async function canvasPixels({ page, label }: { page: Page; label: string }) {
	return page
		.getByRole("img", { name: label, exact: true })
		.evaluate((node) => {
			const canvas = node as HTMLCanvasElement;
			const rgba = canvas
				.getContext("2d")
				?.getImageData(0, 0, canvas.width, canvas.height).data;
			if (!rgba) throw new Error("Missing canvas pixels");
			let bright = 0;
			for (let i = 0; i < rgba.length; i += 4)
				if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 0) bright++;
			return { width: canvas.width, height: canvas.height, bright };
		});
}

test("Beauty Lab real native render, verified replay, controls, ZIP and responsive isolation", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires an opaque portrait and private native runtime"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-beauty-lab-")
	);
	const app = await startElectronApp({ userDataDirectory });
	const errors: string[] = [];
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const before = await timelineSnapshot({ page });
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		await expect(lab).toBeVisible();
		await assertLabUnoccluded({ page });
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			"原生运行时就绪"
		);
		await lab.getByRole("button", { name: "当前原始帧", exact: true }).click();
		await expect(
			lab.getByRole("img", { name: "原图", exact: true })
		).toBeVisible();
		await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			path.basename(source)
		);
		await expect(
			lab.getByRole("button", { name: "候选处理", exact: true })
		).toBeDisabled();
		const candidateCapability = await page.evaluate(async () => {
			const api = window.electronAPI?.beautyLab;
			if (!api) throw new Error("Missing Beauty Lab IPC");
			const status = await api.inspectCandidate();
			try {
				await api.renderCandidate({
					protocol: "qcut-beauty-lab-candidate-v1",
					requestId: "e2e-disabled-candidate",
					backendVersion: "unavailable-test",
					width: 1,
					height: 1,
					rgba: new Uint8Array([0, 0, 0, 255]),
					adjustments: { enabled: true, values: {} },
					sourceKey: "e2e-disabled-candidate",
					frameNumber: 0,
					timestampSeconds: 0,
				});
				throw new Error("Unexpected candidate output from unavailable backend");
			} catch (error) {
				return { status, rejection: String(error) };
			}
		});
		expect(candidateCapability.status).toMatchObject({
			protocol: "qcut-beauty-lab-candidate-v1",
			available: false,
			state: "not-connected",
			backendVersion: null,
		});
		expect(candidateCapability.status.blockers).toContain(
			"independent-160-sampling-unverified"
		);
		expect(candidateCapability.rejection).toContain(
			"Candidate backend unavailable"
		);
		const controls = lab.getByTestId("beauty-lab-controls");
		await controls
			.getByRole("button", { name: "五官精修", exact: true })
			.click();
		await controls.getByRole("button", { name: "精修", exact: true }).click();
		const eye = lab.getByLabel("眼睛大小（精修）数值", { exact: true });
		await eye.fill("40");
		await eye.press("Tab");
		await expect(eye).toHaveValue("40");
		await controls
			.getByRole("button", { name: "识别人脸", exact: true })
			.click();
		await expect(
			controls.getByRole("button", { name: "识别人脸", exact: true })
		).toBeEnabled({ timeout: 30_000 });
		await controls.getByLabel("人脸选择", { exact: true }).click();
		await expect(
			page.getByRole("option", { name: "人脸 1", exact: true })
		).toBeVisible();
		await page.getByRole("option", { name: "全部人脸", exact: true }).click();
		await lab.getByRole("button", { name: "原生处理", exact: true }).click();
		await expect(
			lab.getByRole("img", { name: "原生结果", exact: true })
		).toBeVisible({ timeout: 60_000 });
		const liveOriginal = await canvasPixels({ page, label: "原图" });
		expect(liveOriginal.bright).toBeGreaterThan(10_000);
		await expect
			.poll(
				async () =>
					(await canvasPixels({ page, label: "原图 → 原生结果" })).bright
			)
			.toBeGreaterThan(100);
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			"任意画面推理未接入"
		);
		await page.screenshot({
			path: path.join(output, "01-native-eyes-desktop.png"),
			animations: "disabled",
		});
		const zipPath = path.join(output, "native-comparison.zip");
		const zip = await saveComparison({ app, page, destination: zipPath });
		expect(Object.keys(zip.files).sort()).toEqual([
			"comparison.json",
			"difference-original-native.png",
			"native.png",
			"original.png",
		]);
		const liveReport = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		);
		expect(liveReport.adjustments.values.face_adjust_eye).toBe(40);
		expect(liveReport.comparisons[0].changedPixels).toBeGreaterThan(100);
		await verifyDifferencePNG({
			zip,
			name: "difference-original-native.png",
			changedPixels: liveReport.comparisons[0].changedPixels,
			width: liveReport.width,
			height: liveReport.height,
		});
		expect(await timelineSnapshot({ page })).toBe(before);
		await eye.fill("30");
		await eye.press("Tab");
		await expect(
			lab.getByRole("img", { name: "原生结果", exact: true })
		).toHaveCount(0);
		await controls
			.getByRole("button", { name: "五官精修", exact: true })
			.click();
		await controls.getByRole("button", { name: "美妆", exact: true }).click();
		await page.screenshot({
			path: path.join(output, "02-makeup-desktop.png"),
			animations: "disabled",
		});
		await controls.getByRole("tab", { name: "美体", exact: true }).click();
		await page.screenshot({
			path: path.join(output, "03-body-desktop.png"),
			animations: "disabled",
		});
		await controls.getByRole("tab", { name: "美颜预设", exact: true }).click();
		await controls
			.getByRole("button", { name: "保存美颜预设", exact: true })
			.click();
		expect(
			await page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("qcut-beauty-lab-presets-v1") ?? "[]")
						.length
			)
		).toBe(1);
		await lab.getByLabel("对照来源", { exact: true }).click();
		await page
			.getByRole("option", { name: "人脸时序对照", exact: true })
			.click();
		await expect(
			lab.getByRole("img", { name: "新链路（离线回放）", exact: true })
		).toBeVisible({ timeout: 30_000 });
		await expect
			.poll(
				async () =>
					(
						await canvasPixels({
							page,
							label: "原生基准（记录） → 新链路（离线回放）",
						})
					).bright
			)
			.toBe(0);
		await expect
			.poll(
				async () =>
					(await canvasPixels({ page, label: "原图 → 原生基准（记录）" }))
						.bright
			)
			.toBeGreaterThan(10_000);
		await controls.getByRole("tab", { name: "美颜", exact: true }).click();
		await controls
			.getByRole("button", { name: "五官精修", exact: true })
			.click();
		await controls.getByRole("button", { name: "精修", exact: true }).click();
		await expect(
			lab.getByLabel("眼睛大小（精修）数值", { exact: true })
		).toBeDisabled();
		await page.screenshot({
			path: path.join(output, "04-verified-replay-desktop.png"),
			animations: "disabled",
		});
		const recordZipPath = path.join(output, "verified-replay-comparison.zip");
		const recordZip = await saveComparison({
			app,
			page,
			destination: recordZipPath,
		});
		expect(Object.keys(recordZip.files)).toHaveLength(7);
		const recordReport = JSON.parse(
			await recordZip.file("comparison.json")!.async("string")
		);
		expect(recordReport.mode).toBe("verified-offline-replay");
		expect(recordReport.adjustments.values.face_adjust_eye).toBe(100);
		expect(
			recordReport.comparisons.find(
				(comparison: { name: string }) => comparison.name === "native-candidate"
			).changedPixels
		).toBe(0);
		await verifyDifferencePNG({
			zip: recordZip,
			name: "difference-native-candidate.png",
			changedPixels: 0,
			width: recordReport.width,
			height: recordReport.height,
		});
		await lab.getByLabel("记录帧", { exact: true }).click();
		await page.getByRole("option", { name: "帧 3", exact: true }).click();
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			"temporal:3"
		);
		await lab.getByLabel("对照来源", { exact: true }).click();
		await page
			.getByRole("option", { name: "QCut 导出对照", exact: true })
			.click();
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			"qcut-export:0"
		);
		await page.screenshot({
			path: path.join(output, "05-qcut-export-replay.png"),
			animations: "disabled",
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await assertLabUnoccluded({ page });
		await page.screenshot({
			path: path.join(output, "06-mobile-controls.png"),
			animations: "disabled",
		});
		const bounds = await lab.evaluate((node) => ({
			width: node.getBoundingClientRect().width,
			scrollWidth: node.scrollWidth,
			clientWidth: node.clientWidth,
		}));
		expect(bounds.width).toBeLessThanOrEqual(390);
		expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
		await lab
			.getByRole("img", { name: "新链路（离线回放）", exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: path.join(output, "07-mobile-results.png"),
			animations: "disabled",
		});
		expect(await timelineSnapshot({ page })).toBe(before);
		expect(errors).toEqual([]);
		await writeFile(
			path.join(output, "e2e-report.json"),
			JSON.stringify(
				{
					passed: true,
					backend: "real-native-and-verified-offline-replay",
					liveOriginal,
					bounds,
					liveReport,
					recordReport,
					timelineUnchanged: true,
					arbitraryFrameCandidateReady: false,
					candidateCapability,
					pageErrors: errors,
				},
				null,
				2
			)
		);
	} finally {
		await app.close();
	}
});
