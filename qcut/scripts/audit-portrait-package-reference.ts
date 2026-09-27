import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { inspectJianyingFilterLocalRuntime } from "../electron/jianying-filter-local-runtime/runtime-discovery.js";
import { resolveJianyingPortraitAdjustmentHost } from "../electron/jianying-portrait-adjustment-runtime/bridge-resolver.js";
import { buildJianyingPortraitFeatureParameters } from "../electron/jianying-portrait-adjustment-runtime/catalog.js";
import { startJianyingPortraitHostProcess } from "../electron/jianying-portrait-adjustment-runtime/host-process.js";

const { values: options } = parseArgs({
	options: {
		source: { type: "string" },
		output: { type: "string" },
		package: { type: "string" },
		key: { type: "string" },
		frames: { type: "string", default: "2" },
		width: { type: "string", default: "2160" },
	},
});
if (!options.source || !options.output || !options.package) {
	throw new Error(
		"Required: --source IMAGE --output DIRECTORY --package DIRECTORY"
	);
}
const width = Number(options.width);
const frames = Number(options.frames);
if (!Number.isInteger(width) || width < 64 || width > 4096) {
	throw new Error("Width must be an integer between 64 and 4096");
}
if (!Number.isInteger(frames) || frames < 2 || frames > 120) {
	throw new Error("Frames must be an integer between 2 and 120");
}
const customKey = options.key;
if (customKey && !/^face_adjust_[A-Za-z0-9_]+$/.test(customKey)) {
	throw new Error("Key must be a face_adjust parameter name");
}
const output = path.resolve(options.output);
const packagePath = path.resolve(options.package);
const source = path.resolve(options.source);
const image = await loadImage(source);
const height = Math.round((width * image.height) / image.width);
if (height < 1 || height > 8192)
	throw new Error("Image height outside diagnostic bounds");
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");
context.drawImage(image, 0, 0, width, height);
const rgba = context.getImageData(0, 0, width, height).data;
const runtime = await inspectJianyingFilterLocalRuntime();
const hostPath = await resolveJianyingPortraitAdjustmentHost();
const { frameworkDirectory, modelDirectory } = runtime;
if (!frameworkDirectory || !modelDirectory || !hostPath) {
	throw new Error("Local portrait runtime or host unavailable");
}
const hostOptions = {
	hostPath,
	frameworkDirectory,
	modelDirectory,
	runtimeRoot: path.dirname(frameworkDirectory),
	packagePath,
	width,
	height,
};
await mkdir(output, { recursive: true });
const inputPath = path.join(output, "input.rgba");
await writeFile(inputPath, rgba);
await writeFile(path.join(output, "input.png"), canvas.toBuffer("image/png"));
const hash = ({ data }: { data: Uint8Array }) =>
	createHash("sha256").update(data).digest("hex");
const featureSamples = [
	{ name: "00-neutral", key: "face_adjust_nose", value: 0 },
	{ name: "11-nose-size-minus48", key: "face_adjust_nose", value: -48 },
	{ name: "12-nose-size-plus50", key: "face_adjust_nose", value: 50 },
	{ name: "30-inner-corner-99", key: "face_adjust_inner_corner", value: 99 },
] as const;
const samples = customKey
	? featureSamples.slice(0, 3).map((sample) => ({ ...sample, key: customKey }))
	: featureSamples;
const results: Array<Record<string, unknown>> = [];

async function renderSample({ sample }: { sample: (typeof samples)[number] }) {
	const host = await startJianyingPortraitHostProcess(hostOptions);
	const outputPath = path.join(output, `${sample.name}.rgba`);
	const featureParameters = customKey
		? JSON.stringify({
				[sample.key]: [{ id: -1, intensity: sample.value / 100 }],
			})
		: buildJianyingPortraitFeatureParameters({
				runtimePackage: "features",
				values: { [sample.key]: sample.value },
			});
	try {
		const command = {
			requestId: sample.name,
			timestampSeconds: 0,
			inputPath,
			outputPath,
			featureParameters,
		};
		const frameHashes: string[] = [];
		await Array.from({ length: frames }, (_, index) => index).reduce(
			async (previous, index) => {
				await previous;
				await host.render({ ...command, requestId: `${sample.name}-${index}` });
				const frame = await readFile(outputPath);
				if (frame.length !== width * height * 4)
					throw new Error("Unexpected native frame length");
				frameHashes.push(hash({ data: frame }));
			},
			Promise.resolve()
		);
		const finalFrame = await readFile(outputPath);
		context.putImageData(
			new ImageData(Uint8ClampedArray.from(finalFrame), width, height),
			0,
			0
		);
		const png = canvas.toBuffer("image/png");
		await writeFile(path.join(output, `${sample.name}.png`), png);
		const result = {
			...sample,
			featureParameters: JSON.parse(featureParameters) as unknown,
			frameHashes,
			stable: frameHashes.at(-1) === frameHashes.at(-2),
			pngSha256: hash({ data: png }),
		};
		results.push(result);
		console.log(
			JSON.stringify({
				...sample,
				stable: result.stable,
				pngSha256: result.pngSha256,
			})
		);
	} finally {
		await host.dispose();
	}
}

// Cold hosts isolate package/case state; the repeated frame checks settling.
await samples.reduce(async (previous, sample) => {
	await previous;
	await renderSample({ sample });
}, Promise.resolve());
await writeFile(
	path.join(output, "report.json"),
	JSON.stringify(
		{
			source,
			sourceSha256: hash({ data: await readFile(source) }),
			packagePath,
			width,
			height,
			frames,
			runtime,
			hostPath,
			results,
			limitation:
				"Direct native-host diagnostic, not editor/export parity or proof of the package used by Jianying UI.",
		},
		null,
		2
	) + "\n"
);
