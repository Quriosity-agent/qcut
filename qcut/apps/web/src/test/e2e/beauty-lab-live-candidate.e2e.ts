import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	saveBeautyLabComparison,
	verifyBeautyLabDifferencePNG,
} from "./helpers/beauty-lab-comparison";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const variant = process.env.QCUT_BEAUTY_LIVE_CASE ?? "eye";
const output = path.resolve(
	process.env.QCUT_BEAUTY_LIVE_OUTPUT ??
		"output/playwright/beauty-lab-live-candidate"
);

test("Beauty Lab current-frame ONNX handoff, independent audit, ZIP and stale-result invalidation", async () => {
	test.skip(
		!source ||
			!existsSync(source) ||
			process.env.QCUT_BEAUTY_LAB_LIVE_CANDIDATE !== "1",
		"Requires explicit local native/ONNX audit opt-in and a single-face portrait"
	);
	test.setTimeout(600_000);
	if (!source) throw new Error("Missing portrait input");
	await mkdir(output, { recursive: true });
	const app = await startElectronApp({
		userDataDirectory: await mkdtemp(
			path.join(os.tmpdir(), "qcut-live-candidate-")
		),
	});
	try {
		const page = await getMainWindow(app);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const before = await page.evaluate(() =>
			JSON.stringify(
				(window as unknown as ReferenceWindow).__timelineStore.getState().tracks
			)
		);
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		await lab.getByLabel("实验室图片", { exact: true }).setInputFiles(source);
		await expect(lab.getByRole("status", { name: "实验室状态" })).toContainText(
			path.basename(source)
		);
		const status = await page.evaluate(() =>
			window.electronAPI!.beautyLab!.inspectCandidate()
		);
		expect(status).toMatchObject({
			available: true,
			scope: "audited-single-static-frame",
		});
		const controls = lab.getByTestId("beauty-lab-controls");
		if (!["eye", "face-slim", "lip"].includes(variant))
			throw new Error(`Unsupported live UI case: ${variant}`);
		const group = controls.getByRole("button", {
			name:
				variant === "lip"
					? "美妆"
					: variant === "face-slim"
						? "脸型"
						: "五官精修",
			exact: true,
		});
		if ((await group.getAttribute("aria-expanded")) === "false")
			await group.click();
		if (variant === "eye")
			await controls.getByRole("button", { name: "精修", exact: true }).click();
		if (variant === "lip") {
			const makeup = controls.getByTestId("portrait-section-makeup");
			await makeup.getByRole("tab", { name: "口红", exact: true }).click();
			await makeup.getByRole("button", { name: "柔和粉", exact: true }).click();
		}
		const parameter = lab.getByLabel(
			variant === "lip"
				? "程度数值"
				: variant === "face-slim"
					? "瘦脸数值"
					: "眼睛大小（精修）数值",
			{ exact: true }
		);
		await parameter.fill(variant === "eye" ? "40" : "80");
		await parameter.press("Tab");
		await lab.getByRole("button", { name: "原生处理", exact: true }).click();
		await expect(
			lab.getByRole("img", { name: "原生结果", exact: true })
		).toBeVisible({ timeout: 60_000 });
		await lab.getByRole("button", { name: "候选处理", exact: true }).click();
		const candidateImage = lab.getByRole("img", {
			name: "新链路（单帧核验）",
			exact: true,
		});
		await expect
			.poll(
				async () =>
					(await candidateImage.isVisible()) ||
					(await lab.getByRole("alert").isVisible()),
				{ timeout: 360_000 }
			)
			.toBe(true);
		if (await lab.getByRole("alert").isVisible()) {
			await page.screenshot({ path: path.join(output, "failed.png") });
			throw new Error(await lab.getByRole("alert").innerText());
		}
		await expect(candidateImage).toBeVisible();
		await page.screenshot({
			path: path.join(output, "01-static-audit-desktop.png"),
			animations: "disabled",
		});
		const zip = await saveBeautyLabComparison({
			app,
			page,
			destination: path.join(output, "static-audit.zip"),
		});
		const report = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		);
		expect(report).toMatchObject({
			mode: "live-candidate",
			record: null,
			nativeResultPresent: true,
			candidateResultPresent: true,
			arbitraryFrameCandidateReady: false,
			candidateProvenance: {
				source: "live-candidate",
				scope: "audited-single-static-frame",
			},
		});
		expect(report.candidateProvenance.inputSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(report.candidateProvenance.stageMetrics).toHaveLength(10);
		expect(report.gain).toBe(8);
		if (variant === "lip")
			expect(report.adjustments.makeup).toEqual({
				lip: { cardId: "lip-soft-pink", intensity: 80 },
			});
		else
			expect(report.adjustments.values).toEqual(
				variant === "eye"
					? { face_adjust_eye: 40 }
					: { face_adjust_TotalFace: 80 }
			);
		expect(
			report.comparisons.find(
				(row: { name: string }) => row.name === "original-candidate"
			).changedPixels
		).toBeGreaterThan(100);
		expect(
			report.comparisons.find(
				(row: { name: string }) => row.name === "native-candidate"
			)
		).toMatchObject({ changedPixels: 0, rgbMax: 0, alphaMax: 0 });
		for (const row of report.comparisons) {
			await verifyBeautyLabDifferencePNG({
				zip,
				name: `difference-${row.name}.png`,
				changedPixels: row.changedPixels,
				width: report.width,
				height: report.height,
			});
		}
		for (const name of [
			"original",
			"native",
			"candidate",
			"difference-original-candidate",
			"difference-native-candidate",
		]) {
			await writeFile(
				path.join(output, `${name}.png`),
				await zip.file(`${name}.png`)!.async("nodebuffer")
			);
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await lab
			.getByRole("img", { name: "新链路（单帧核验）", exact: true })
			.scrollIntoViewIfNeeded();
		expect(
			await lab.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
		).toBe(true);
		await page.screenshot({
			path: path.join(output, "02-static-audit-mobile.png"),
			animations: "disabled",
		});
		await page.setViewportSize({ width: 1440, height: 1000 });
		await parameter.fill("20");
		await parameter.press("Tab");
		await expect(
			lab.getByRole("img", { name: "新链路（单帧核验）", exact: true })
		).toHaveCount(0);
		const stale = await saveBeautyLabComparison({
			app,
			page,
			destination: path.join(output, "invalidated.zip"),
		});
		expect(stale.file("candidate.png")).toBeNull();
		expect(
			await page.evaluate(() =>
				JSON.stringify(
					(window as unknown as ReferenceWindow).__timelineStore.getState()
						.tracks
				)
			)
		).toBe(before);
		expect(errors).toEqual([]);
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					passed: true,
					variant,
					scope: "audited-single-static-frame",
					status,
					comparison: report,
					timelineUnchanged: true,
					staleCandidateInvalidated: true,
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
