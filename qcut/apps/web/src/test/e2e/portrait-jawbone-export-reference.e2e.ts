import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	createPortraitReferenceCapture,
	preparePortraitReferenceProject,
	readPreview,
	readValues,
} from "./helpers/portrait-reference";
import { exportPortraitReference } from "./helpers/portrait-reference-export";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_JAWBONE_OUTPUT ??
		"output/playwright/portrait-jawbone-export-reference"
);

test("jawbone exports isolate 50/100 and restore the neutral baseline", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and native runtime"
	);
	test.setTimeout(600_000);
	if (!source) throw new Error("Missing portrait source");
	await mkdir(output, { recursive: true });
	const sourceSha256 = createHash("sha256")
		.update(await readFile(source))
		.digest("hex");
	const app = await startElectronApp({
		userDataDirectory: await mkdtemp(path.join(os.tmpdir(), "qcut-jawbone-")),
	});
	const errors: string[] = [];
	const samples: Array<{
		name: string;
		values: Awaited<ReturnType<typeof readValues>>;
		exportPath: string;
		exportSha256: string;
		frameSha256: string;
		decodedFrames: number;
		videoStream: Record<string, string | number>;
	}> = [];
	let reportFailure: Error | undefined;
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: 5,
		});
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		const capture = createPortraitReferenceCapture({ output });
		await [0, 50, 100, 0].reduce(async (previous, value, index) => {
			await previous;
			await page
				.getByTestId("media-properties")
				.getByRole("tab", { name: "美颜美体", exact: true })
				.click();
			const group = panel.getByRole("button", { name: "脸型", exact: true });
			if ((await group.getAttribute("aria-expanded")) !== "true")
				await group.click();
			await page
				.getByTestId("portrait-section-face-shape")
				.getByRole("button", { name: "重置本组", exact: true })
				.click();
			await expect.poll(() => readValues({ page })).toEqual({});
			const name = value
				? `jawbone-${value}`
				: index === 0
					? "neutral"
					: "neutral-after";
			const expectedValues = value ? { face_adjust_ZoomJawbone: value } : {};
			if (value) {
				// Neutral adjustments unmount the effect canvas entirely.
				const hasPreviousFrame =
					(await page.getByTestId("color-preview-canvas").count()) > 0;
				const previousHash = hasPreviousFrame
					? (await readPreview({ page })).hash
					: undefined;
				const preview = await capture.changeAndCapture({
					page,
					name,
					label: "下颌骨",
					value,
					previousHash,
				});
				expect(preview.values).toEqual(expectedValues);
				expect([preview.width, preview.height]).toEqual([1080, 1620]);
				await capture.captureSource({ page, name });
			}
			await page.screenshot({ path: path.join(output, `${name}-ui.png`) });
			const directory = path.join(output, name);
			await mkdir(directory, { recursive: true });
			const exported = await exportPortraitReference({
				app,
				page,
				name,
				output: directory,
				expectedFrames: 150,
			});
			expect(exported.videoStream).toMatchObject({
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
			expect(Number(exported.videoStream.duration)).toBeCloseTo(5, 3);
			const values = await readValues({ page });
			expect(values).toEqual(expectedValues);
			const frameSha256 = createHash("sha256")
				.update(await readFile(path.join(directory, "export-frame.png")))
				.digest("hex");
			const exportSha256 = createHash("sha256")
				.update(await readFile(exported.exportPath))
				.digest("hex");
			samples.push({ name, values, ...exported, exportSha256, frameSha256 });
			await page
				.getByRole("button", { name: "Close export dialog", exact: true })
				.click();
		}, Promise.resolve());
		expect(samples[0].frameSha256).toBe(samples[3].frameSha256);
		expect(
			new Set(samples.slice(0, 3).map(({ frameSha256 }) => frameSha256)).size
		).toBe(3);
		expect(errors).toEqual([]);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
		await app
			.windows()[0]
			?.screenshot({ path: path.join(output, "failure-ui.png") })
			.catch(() => {});
		throw error;
	} finally {
		try {
			await writeFile(
				path.join(output, "report.json"),
				JSON.stringify(
					{
						source,
						sourceSha256,
						hostOverride:
							process.env.QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST ?? null,
						samples,
						errors,
					},
					null,
					2
				)
			);
		} catch (reportError) {
			reportFailure =
				reportError instanceof Error
					? reportError
					: new Error(String(reportError));
			console.error("Could not save jawbone failure report", reportError);
		} finally {
			await app.close();
		}
	}
	if (reportFailure) throw reportFailure;
});
