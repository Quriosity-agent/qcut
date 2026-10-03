import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { resolveBeautyLabResearchPaths } from "../../../../../electron/beauty-lab-research-config";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { saveBeautyLabComparison } from "./helpers/beauty-lab-comparison";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const packageRoot = resolveBeautyLabResearchPaths({
	sourceRoot: path.resolve("."),
	isPackaged: false,
	environment: process.env,
}).ownedChainRoot!;
const output = path.resolve(
	process.env.QCUT_BEAUTY_OWNED_CHAIN_OUTPUT ??
		"output/playwright/beauty-lab-owned-chain"
);

test("Beauty Lab owned sampling checkpoint: seven real frames, grayscale, ZIP and isolation", async () => {
	test.skip(
		!source ||
			!existsSync(source) ||
			!existsSync(path.join(packageRoot, "index.json")),
		"Requires the private verified fixed-profile package"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing portrait input");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-owned-chain-")
	);
	const app = await startElectronApp({ userDataDirectory });
	try {
		const page = await getMainWindow(app);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await preparePortraitReferenceProject({
			page,
			source,
			canvasSize: { width: 640, height: 480 },
		});
		const timeline = () =>
			page.evaluate(() =>
				JSON.stringify(
					(window as unknown as ReferenceWindow).__timelineStore.getState()
						.tracks
				)
			);
		const before = await timeline();
		await page.getByTestId("beauty-lab-open").click();
		const lab = page.getByTestId("beauty-lab-dialog");
		await expect(lab).toBeVisible();
		await expect
			.poll(
				async () =>
					page.evaluate(async () =>
						(await window.electronAPI!.beautyLab!.listResearchCases()).map(
							(item) => item.id
						)
					),
				{ timeout: 60_000 }
			)
			.toContain("owned-preprocess");
		await lab.getByLabel("对照来源", { exact: true }).click();
		await page
			.getByRole("option", { name: "自有采样对照", exact: true })
			.click();
		const metrics = [];
		for (let index = 0; index < 7; index++) {
			if (index > 0) {
				await lab.getByLabel("记录帧", { exact: true }).click();
				await page
					.getByRole("option", { name: `帧 ${index}`, exact: true })
					.click();
			}
			await expect(
				lab.getByRole("status", { name: "实验室状态" })
			).toContainText(`owned-preprocess:${index}`, { timeout: 60_000 });
			await expect
				.poll(() =>
					lab
						.getByRole("img", {
							name: "原生基准（记录） → 新链路（离线回放）",
							exact: true,
						})
						.evaluate((node) => {
							const canvas = node as HTMLCanvasElement;
							const data = canvas
								.getContext("2d")!
								.getImageData(0, 0, canvas.width, canvas.height).data;
							return data.every(
								(value, offset) => value === (offset % 4 === 3 ? 255 : 0)
							);
						})
				)
				.toBe(true);
			const frame = await page.evaluate(async (frameIndex) => {
				const result = await window.electronAPI!.beautyLab!.loadResearchFrame({
					caseId: "owned-preprocess",
					frameIndex,
				});
				let changedPixels = 0;
				for (let offset = 0; offset < result.input.length; offset += 4) {
					if (
						[0, 1, 2, 3].some(
							(channel) =>
								result.input[offset + channel] !==
								result.native[offset + channel]
						)
					)
						changedPixels++;
				}
				return {
					frameIndex,
					changedPixels,
					width: result.width,
					height: result.height,
					parity: result.native.every(
						(value, offset) => value === result.candidate[offset]
					),
					source: result.source,
					nativeDependencies: result.nativeDependencies,
				};
			}, index);
			expect(frame).toMatchObject({
				width: 1448,
				height: 1086,
				parity: true,
				source: "verified-offline-replay",
				nativeDependencies: true,
			});
			expect(frame.changedPixels).toBe(
				[43893, 43565, 44022, 0, 43698, 0, 42469][index]
			);
			metrics.push(frame);
			await page.screenshot({
				path: path.join(output, `frame-${index}.png`),
				animations: "disabled",
			});
		}
		const controls = lab.getByTestId("beauty-lab-controls");
		await controls.getByRole("button", { name: "美妆", exact: true }).click();
		const makeup = controls.getByTestId("portrait-section-makeup");
		await makeup.getByRole("tab", { name: "口红", exact: true }).click();
		await expect(
			makeup.getByRole("tab", { name: "口红", exact: true })
		).toHaveAttribute("aria-selected", "true");
		await expect(
			makeup.getByRole("button", { name: "柔和粉", exact: true })
		).toBeDisabled();
		await expect(
			makeup.getByRole("button", { name: "无", exact: true })
		).toBeDisabled();
		await expect(makeup.getByLabel("程度数值", { exact: true })).toBeDisabled();
		await page.screenshot({
			path: path.join(output, "read-only-makeup.png"),
			animations: "disabled",
		});
		const zip = await saveBeautyLabComparison({
			app,
			page,
			destination: path.join(output, "owned-chain-comparison.zip"),
		});
		const report = JSON.parse(
			await zip.file("comparison.json")!.async("string")
		);
		expect(report.record).toEqual({
			caseId: "owned-preprocess",
			frameIndex: 6,
		});
		expect(report.mode).toBe("verified-offline-replay");
		expect(report.arbitraryFrameCandidateReady).toBe(false);
		expect(
			(await zip.file("native.png")!.async("nodebuffer")).equals(
				await zip.file("candidate.png")!.async("nodebuffer")
			)
		).toBe(true);
		await page.setViewportSize({ width: 390, height: 844 });
		await lab
			.getByRole("img", { name: "新链路（离线回放）", exact: true })
			.scrollIntoViewIfNeeded();
		expect(
			await lab.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
		).toBe(true);
		await page.screenshot({
			path: path.join(output, "mobile.png"),
			animations: "disabled",
		});
		expect(await timeline()).toBe(before);
		expect(
			await page.evaluate(async () =>
				window.electronAPI!.beautyLab!.inspectCandidate()
			)
		).toMatchObject({
			available: false,
			state: "not-connected",
			backendVersion: null,
		});
		expect(errors).toEqual([]);
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					passed: true,
					metrics,
					recordReport: report,
					timelineUnchanged: true,
					arbitraryFrameBackendConnected: false,
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
