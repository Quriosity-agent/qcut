import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import type { BeautyLabIndependentResult } from "../electron/beauty-lab/beauty-lab-independent-contract";

export interface ProbeFrame {
	width: number;
	height: number;
	rgba: Uint8Array;
}

export function sha256({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function requireProbe({
	condition,
	message,
}: {
	condition: boolean;
	message: string;
}) {
	if (!condition) throw new Error(message);
}

export async function writeJson({
	directory,
	name,
	value,
}: {
	directory: string;
	name: string;
	value: unknown;
}) {
	await writeFile(
		path.join(directory, `${name}.json`),
		`${JSON.stringify(value, null, 2)}\n`
	);
}

export function encodePng({ frame }: { frame: ProbeFrame }) {
	const canvas = createCanvas(frame.width, frame.height);
	canvas
		.getContext("2d")
		.putImageData(
			new ImageData(
				new Uint8ClampedArray(frame.rgba),
				frame.width,
				frame.height
			),
			0,
			0
		);
	return canvas.toBuffer("image/png");
}

export async function saveFrame({
	directory,
	name,
	frame,
}: {
	directory: string;
	name: string;
	frame: ProbeFrame;
}) {
	await writeFile(path.join(directory, `${name}.png`), encodePng({ frame }));
}

export async function readFrame({
	file,
	maxEdge,
}: {
	file: string;
	maxEdge: number;
}) {
	const bytes = await readFile(file);
	requireProbe({
		condition:
			bytes.length >= 33 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a",
		message: "Probe inputs must be PNG files",
	});
	const width = bytes.readUInt32BE(16),
		height = bytes.readUInt32BE(20);
	requireProbe({
		condition:
			width > 0 &&
			height > 0 &&
			Math.max(width, height) <= maxEdge &&
			width * height <= 3840 * 2160,
		message: "Probe input exceeds its exact-size frame budget",
	});
	const image = await loadImage(bytes);
	requireProbe({
		condition: image.width === width && image.height === height,
		message: "Decoded PNG dimensions changed",
	});
	const canvas = createCanvas(width, height),
		context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
	for (let index = 3; index < rgba.length; index += 4) {
		requireProbe({
			condition: rgba[index] === 255,
			message: "Probe requires opaque photos; no alpha flattening is performed",
		});
	}
	return {
		width,
		height,
		rgba,
		source: path.resolve(file),
		sourcePngSha256: sha256({ bytes }),
		sourceRgbaSha256: sha256({ bytes: rgba }),
	};
}

export function cropVertical({ frame }: { frame: ProbeFrame }) {
	const width = 1080,
		height = 1920,
		aspect = width / height;
	const cropWidth = Math.min(frame.width, frame.height * aspect);
	const cropHeight = cropWidth / aspect;
	const left = (frame.width - cropWidth) / 2,
		top = (frame.height - cropHeight) / 2;
	const source = createCanvas(frame.width, frame.height);
	source
		.getContext("2d")
		.putImageData(
			new ImageData(
				new Uint8ClampedArray(frame.rgba),
				frame.width,
				frame.height
			),
			0,
			0
		);
	const output = createCanvas(width, height),
		context = output.getContext("2d");
	context.drawImage(
		source,
		left,
		top,
		cropWidth,
		cropHeight,
		0,
		0,
		width,
		height
	);
	return {
		width,
		height,
		rgba: new Uint8Array(context.getImageData(0, 0, width, height).data),
		crop: {
			left,
			top,
			width: cropWidth,
			height: cropHeight,
			resizedTo: [width, height],
			sourceSize: [frame.width, frame.height],
			method: "center-crop-preserving-aspect-canvas-resample",
		},
	};
}

export function residentIdentity({
	result,
}: {
	result: BeautyLabIndependentResult;
}) {
	const runtime = result.report.residentRuntime as
		| Record<string, unknown>
		| undefined;
	requireProbe({
		condition: Number.isSafeInteger(runtime?.pid) && Number(runtime?.pid) > 1,
		message: "Resident report lacks its real process id",
	});
	return { ...runtime, pid: Number(runtime?.pid) };
}

export function exactOutput({
	actual,
	expected,
}: {
	actual: BeautyLabIndependentResult;
	expected: BeautyLabIndependentResult;
}) {
	const rgbaEqual = Buffer.from(actual.rgba).equals(Buffer.from(expected.rgba));
	const pngEqual = Buffer.from(actual.png).equals(Buffer.from(expected.png));
	return {
		rgbaEqual,
		pngEqual,
		dimensionsEqual:
			actual.width === expected.width && actual.height === expected.height,
	};
}

export function comparePixels({
	actual,
	expected,
}: {
	actual: ProbeFrame;
	expected: ProbeFrame;
}) {
	requireProbe({
		condition:
			actual.width === expected.width &&
			actual.height === expected.height &&
			actual.rgba.length === expected.rgba.length,
		message: "Comparison dimensions differ",
	});
	const difference = new Uint8Array(actual.rgba.length);
	let maximumRGB = 0,
		maximumAlpha = 0,
		totalRGB = 0,
		changedPixels = 0;
	for (let index = 0; index < actual.rgba.length; index += 4) {
		let changed = false;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(
				actual.rgba[index + channel] - expected.rgba[index + channel]
			);
			maximumRGB = Math.max(maximumRGB, delta);
			totalRGB += delta;
			changed ||= delta !== 0;
			difference[index + channel] = Math.min(255, delta * 4);
		}
		maximumAlpha = Math.max(
			maximumAlpha,
			Math.abs(actual.rgba[index + 3] - expected.rgba[index + 3])
		);
		difference[index + 3] = 255;
		if (changed) changedPixels++;
	}
	return {
		metrics: {
			maximumRGB,
			maximumAlpha,
			meanRGB: totalRGB / (actual.width * actual.height * 3),
			changedPixels,
			withinOneRgb: maximumRGB <= 1 && maximumAlpha === 0,
		},
		difference,
	};
}

export function median({ values }: { values: number[] }) {
	const sorted = [...values].sort((left, right) => left - right),
		middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function serial<T>({
	entries,
	run,
}: {
	entries: T[];
	run: (entry: T) => Promise<void>;
}) {
	await entries.reduce(
		(previous, entry) => previous.then(() => run(entry)),
		Promise.resolve()
	);
}
