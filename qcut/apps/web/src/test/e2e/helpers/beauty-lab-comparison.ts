import { readFile, rm } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import JSZip from "jszip";

export async function saveBeautyLabComparison({
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
					result = await JSZip.loadAsync(await readFile(destination), {
						checkCRC32: true,
					});
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

async function decodePNG({ zip, name }: { zip: JSZip; name: string }) {
	const file = zip.file(name);
	if (!file) throw new Error(`Missing ${name}`);
	const image = await loadImage(await file.async("nodebuffer"));
	const canvas = createCanvas(image.width, image.height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	return {
		width: image.width,
		height: image.height,
		pixels: context.getImageData(0, 0, image.width, image.height).data,
	};
}

export async function decodeBeautyLabFixture({
	page,
	bytes,
}: {
	page: Page;
	bytes: Buffer;
}) {
	const png = await page.evaluate(async (base64) => {
		const bytes = Uint8Array.from(atob(base64), (character) =>
			character.charCodeAt(0)
		);
		const bitmap = await createImageBitmap(new Blob([bytes]));
		try {
			const ratio = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
			canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
			const context = canvas.getContext("2d", { colorSpace: "srgb" });
			if (!context) throw new Error("Fixture decoder unavailable");
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL("image/png").split(",")[1];
		} finally {
			bitmap.close();
		}
	}, bytes.toString("base64"));
	return Buffer.from(png, "base64");
}

export async function verifyBeautyLabDifferencePNG({
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
	const image = await decodePNG({ zip, name });
	expect([image.width, image.height]).toEqual([width, height]);
	let changed = 0;
	let grayscaleOpaque = true;
	for (let index = 0; index < image.pixels.length; index += 4) {
		const gray = image.pixels[index];
		if (gray > 0) changed++;
		if (
			gray !== image.pixels[index + 1] ||
			gray !== image.pixels[index + 2] ||
			image.pixels[index + 3] !== 255
		)
			grayscaleOpaque = false;
	}
	expect(changed).toBe(changedPixels);
	expect(grayscaleOpaque).toBe(true);
}

export async function auditBeautyLabNativeZip({
	zip,
	expectedOriginalPNG,
}: {
	zip: JSZip;
	expectedOriginalPNG: Buffer;
}) {
	const report = JSON.parse(await zip.file("comparison.json")!.async("string"));
	expect(report).toMatchObject({
		schema: "qcut-beauty-lab-comparison-v1",
		mode: "native-live",
		record: null,
		nativeResultPresent: true,
		candidateResultPresent: false,
		candidateProvenance: null,
		arbitraryFrameCandidateReady: false,
	});
	expect(zip.file("candidate.png")).toBeNull();
	expect(
		Number.isInteger(report.gain) && report.gain >= 1 && report.gain <= 32
	).toBe(true);
	const [original, native, difference] = await Promise.all([
		decodePNG({ zip, name: "original.png" }),
		decodePNG({ zip, name: "native.png" }),
		decodePNG({ zip, name: "difference-original-native.png" }),
	]);
	for (const image of [original, native, difference]) {
		expect([image.width, image.height]).toEqual([report.width, report.height]);
	}
	const fixtureZip = new JSZip().file("fixture.png", expectedOriginalPNG);
	const fixture = await decodePNG({ zip: fixtureZip, name: "fixture.png" });
	expect([original.width, original.height]).toEqual([
		fixture.width,
		fixture.height,
	]);
	expect(Buffer.from(original.pixels).equals(Buffer.from(fixture.pixels))).toBe(
		true
	);
	let changedPixels = 0;
	let rgbTotal = 0;
	let rgbMax = 0;
	let alphaMax = 0;
	let incorrectGrayPixels = 0;
	for (let offset = 0; offset < original.pixels.length; offset += 4) {
		const deltas = [0, 1, 2].map((channel) =>
			Math.abs(
				original.pixels[offset + channel] - native.pixels[offset + channel]
			)
		);
		const max = Math.max(...deltas);
		const alpha = Math.abs(
			original.pixels[offset + 3] - native.pixels[offset + 3]
		);
		const gray = Math.min(255, max * report.gain);
		if (max || alpha) changedPixels++;
		rgbTotal += deltas[0] + deltas[1] + deltas[2];
		rgbMax = Math.max(rgbMax, max);
		alphaMax = Math.max(alphaMax, alpha);
		if (
			difference.pixels[offset] !== gray ||
			difference.pixels[offset + 1] !== gray ||
			difference.pixels[offset + 2] !== gray ||
			difference.pixels[offset + 3] !== 255
		)
			incorrectGrayPixels++;
	}
	const pixelCount = report.width * report.height;
	expect(incorrectGrayPixels).toBe(0);
	expect(report.comparisons).toHaveLength(1);
	expect(report.comparisons[0]).toEqual({
		name: "original-native",
		changedPixels,
		pixelCount,
		rgbMae: rgbTotal / (pixelCount * 3),
		rgbMax,
		alphaMax,
	});
	return report;
}
