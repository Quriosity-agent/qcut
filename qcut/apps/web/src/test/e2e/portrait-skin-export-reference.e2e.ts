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
	readValues,
} from "./helpers/portrait-reference";
import { exportPortraitReference } from "./helpers/portrait-reference-export";

const source = process.env.QCUT_REAL_PORTRAIT_IMAGE_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_SKIN_EXPORT_OUTPUT ??
		"output/playwright/portrait-skin-export-reference"
);
const controls = [
	{ label: "磨皮", key: "face_adjust_Smooth" },
	{ label: "祛斑祛痘", key: "face_adjust_SpotAcne" },
	{ label: "清晰", key: "face_adjust_Clarity" },
];

test("skin reference exports isolate each control and preserve the neutral baseline", async () => {
	test.skip(
		!source || !existsSync(source),
		"Requires real portrait and native runtime"
	);
	test.setTimeout(900_000);
	if (!source) throw new Error("Missing real portrait");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-skin-export-")
	);
	const app = await startElectronApp({ userDataDirectory });
	const page = await getMainWindow(app);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const samples: Array<{
		name: string;
		values: Awaited<ReturnType<typeof readValues>>;
		exportPath: string;
		decodedFrames: number;
		videoStream: Record<string, string | number>;
		frameSha256: string;
	}> = [];
	async function captureExport({ name }: { name: string }) {
		const directory = path.join(output, name);
		await mkdir(directory, { recursive: true });
		const result = await exportPortraitReference({
			app,
			page,
			output: directory,
			name,
			expectedFrames: 150,
		});
		const frame = await readFile(path.join(directory, "export-frame.png"));
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
		const sample = {
			name,
			values: await readValues({ page }),
			...result,
			frameSha256: createHash("sha256").update(frame).digest("hex"),
		};
		samples.push(sample);
		await page
			.getByRole("button", { name: "Close export dialog", exact: true })
			.click();
		await page
			.getByTestId("media-properties")
			.getByRole("tab", { name: "美颜美体", exact: true })
			.click();
		const skinGroup = page
			.getByTestId("jianying-portrait-adjustments")
			.getByRole("button", { name: "皮肤管理", exact: true });
		if ((await skinGroup.getAttribute("aria-expanded")) !== "true")
			await skinGroup.click();
		return sample;
	}
	try {
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: 5,
		});
		await panel.getByRole("button", { name: "五官精修", exact: true }).click();
		await panel.getByRole("button", { name: "皮肤管理", exact: true }).click();
		const skin = page.getByTestId("portrait-section-skin");
		const reset = skin.getByRole("button", { name: "重置本组", exact: true });
		const capture = createPortraitReferenceCapture({ output });
		await expect.poll(() => readValues({ page })).toEqual({});
		const neutral = await captureExport({ name: "neutral" });
		await controls.reduce(async (previous, control) => {
			await previous;
			await [50, 100].reduce(async (prior, value) => {
				await prior;
				await reset.click();
				await expect.poll(() => readValues({ page })).toEqual({});
				const name = `${control.key}-${value}`;
				const preview = await capture.changeAndCapture({
					page,
					label: control.label,
					value,
					name,
				});
				expect(preview.values).toEqual({ [control.key]: value });
				expect([preview.width, preview.height]).toEqual([1080, 1620]);
				const result = await captureExport({ name });
				expect(result.values).toEqual(preview.values);
				expect(result.frameSha256).not.toBe(neutral.frameSha256);
			}, Promise.resolve());
		}, Promise.resolve());
		await reset.click();
		await expect.poll(() => readValues({ page })).toEqual({});
		const finalNeutral = await captureExport({ name: "neutral-after" });
		expect(finalNeutral.frameSha256).toBe(neutral.frameSha256);
		expect(errors).toEqual([]);
	} catch (error) {
		await page
			.screenshot({ path: path.join(output, "failure-ui.png") })
			.catch(() => {});
		throw error;
	} finally {
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
					errors,
				},
				null,
				2
			)
		);
		await app.close();
	}
});
