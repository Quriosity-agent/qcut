import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createFogComparison } from "../electron/qcut-independent-filter/comparison.js";
import { rgbaDigest } from "../electron/qcut-independent-filter/comparison-images.js";
import {
	QCUT_FOG_RESOURCE,
	QCUT_FOG_VERSION,
} from "../electron/qcut-independent-filter/contract.js";

const { values } = parseArgs({
	options: {
		input: { type: "string" },
		replay: { type: "string" },
		output: { type: "string" },
		intensity: { type: "string" },
	},
});
if (!values.output || Boolean(values.input) === Boolean(values.replay)) {
	throw new Error(
		"Usage: bun scripts/compare-independent-fog.ts (--input PNG | --replay REPORT.json) --output NEW_DIRECTORY [--intensity 100]"
	);
}
let inputBytes: Uint8Array;
let expectedInputHash: string | undefined;
let intensity = Number(values.intensity ?? 100);
if (values.replay) {
	if ((await stat(values.replay)).size > 32 * 1024 * 1024)
		throw new Error("Report exceeds 32 MB.");
	const report: unknown = JSON.parse(await readFile(values.replay, "utf8"));
	if (
		!report ||
		typeof report !== "object" ||
		!("schemaVersion" in report) ||
		report.schemaVersion !== 1 ||
		!("resourceId" in report) ||
		report.resourceId !== QCUT_FOG_RESOURCE ||
		!("version" in report) ||
		report.version !== QCUT_FOG_VERSION ||
		!("input" in report) ||
		!report.input ||
		typeof report.input !== "object" ||
		!("png" in report.input) ||
		typeof report.input.png !== "string" ||
		!report.input.png.startsWith("data:image/png;base64,") ||
		!("sha256" in report.input) ||
		typeof report.input.sha256 !== "string" ||
		!("intensity" in report) ||
		typeof report.intensity !== "number"
	)
		throw new Error("Unsupported comparison report.");
	inputBytes = Buffer.from(
		report.input.png.slice("data:image/png;base64,".length),
		"base64"
	);
	expectedInputHash = report.input.sha256;
	if (values.intensity === undefined) intensity = report.intensity;
} else {
	const path = resolve(values.input ?? "");
	if ((await stat(path)).size > 20 * 1024 * 1024)
		throw new Error("Image exceeds 20 MB.");
	inputBytes = await readFile(path);
}
const image = await loadImage(inputBytes);
if (!image.width || !image.height || image.width > 640 || image.height > 640) {
	throw new Error(
		"CLI inputs must already be at most 640 pixels per edge; no implicit resize."
	);
}
const canvas = createCanvas(image.width, image.height);
const context = canvas.getContext("2d");
context.drawImage(image, 0, 0);
const rgba = new Uint8Array(
	context.getImageData(0, 0, image.width, image.height).data
);
if (expectedInputHash && rgbaDigest({ rgba }) !== expectedInputHash)
	throw new Error("Decoded replay input hash differs from the report.");
const directory = resolve(values.output);
await mkdir(dirname(directory), { recursive: true });
await mkdir(directory);
const result = await createFogComparison()({
	request: {
		resourceId: QCUT_FOG_RESOURCE,
		version: QCUT_FOG_VERSION,
		width: image.width,
		height: image.height,
		rgba,
		intensity,
	},
});
await Promise.all(
	[
		result.input,
		result.candidate,
		result.reference,
		result.difference,
		...result.referenceStages,
	].map(async (entry) => {
		await writeFile(
			join(directory, `${entry.name}.png`),
			Buffer.from(entry.png.slice("data:image/png;base64,".length), "base64")
		);
	})
);
await writeFile(
	join(directory, "report.json"),
	JSON.stringify(result, null, 2) + "\n"
);
console.log(
	JSON.stringify({
		directory,
		width: result.width,
		height: result.height,
		intensity,
		metrics: result.metrics,
	})
);
