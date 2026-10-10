import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import type { MediaPortraitAdjustmentKey } from "../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import { createJianyingPortraitAdjustmentProvider } from "../electron/jianying-portrait-adjustment-runtime/provider.js";
import { resolveJianyingPortraitPackages } from "../electron/jianying-portrait-adjustment-runtime/package-resolver.js";

const source = process.env.QCUT_PORTRAIT_REFERENCE_SOURCE;
if (!source)
	throw new Error("Set QCUT_PORTRAIT_REFERENCE_SOURCE to a portrait image");
const output = path.resolve(
	process.env.QCUT_PORTRAIT_REFERENCE_OUTPUT ??
		"output/portrait-slider-reference"
);
const width = Number(process.env.QCUT_PORTRAIT_REFERENCE_WIDTH ?? 600);
const coldStart = process.env.QCUT_PORTRAIT_REFERENCE_COLD === "1";
const sampleFilter = process.env.QCUT_PORTRAIT_REFERENCE_FILTER;
if (!Number.isInteger(width) || width < 64 || width > 4096)
	throw new Error("Invalid reference width");
const cases: Array<{
	name: string;
	key?: MediaPortraitAdjustmentKey;
	value?: number;
}> = [
	{ name: "00-neutral" },
	{ name: "01-eye-size-50", key: "face_adjust_EnlargeEye", value: 50 },
	{ name: "02-eye-size-100", key: "face_adjust_EnlargeEye", value: 100 },
	{ name: "03-eye-corner-50", key: "face_adjust_CornerEye", value: 50 },
	{ name: "04-eye-corner-99", key: "face_adjust_CornerEye", value: 99 },
	{ name: "05-eye-spacing-minus46", key: "face_adjust_EyeSpacing", value: -46 },
	{ name: "06-eye-spacing-plus50", key: "face_adjust_EyeSpacing", value: 50 },
	{ name: "07-nose-neutral" },
	{ name: "08-nose-position-minus48", key: "face_adjust_MoveNose", value: -48 },
	{ name: "09-nose-position-plus50", key: "face_adjust_MoveNose", value: 50 },
	{ name: "10-nose-slim-99", key: "face_adjust_Nose", value: 99 },
	{ name: "11-nose-size-minus48", key: "face_adjust_nose", value: -48 },
	{ name: "12-nose-size-plus50", key: "face_adjust_nose", value: 50 },
	{
		name: "13-nose-bridge-minus48",
		key: "face_adjust_nose_bridge",
		value: -48,
	},
	{ name: "14-nose-bridge-plus50", key: "face_adjust_nose_bridge", value: 50 },
	{ name: "15-mouth-size-minus48", key: "face_adjust_ZoomMouth", value: -48 },
	{ name: "16-mouth-size-plus50", key: "face_adjust_ZoomMouth", value: 50 },
	{ name: "17-face-slim-99", key: "face_adjust_TotalFace", value: 99 },
	{ name: "18-chin-length-minus48", key: "face_adjust_Chin", value: -48 },
	{ name: "19-chin-length-plus50", key: "face_adjust_Chin", value: 50 },
	{ name: "20-skin-smooth-80", key: "face_adjust_Smooth", value: 80 },
	{ name: "21-final-reset" },
	{
		name: "22-alt-nose-position-minus48",
		key: "face_adjust_nose_position",
		value: -48,
	},
	{
		name: "23-alt-nose-position-plus50",
		key: "face_adjust_nose_position",
		value: 50,
	},
	{ name: "24-alt-mouth-size-minus48", key: "face_adjust_mouse", value: -48 },
	{ name: "25-alt-mouth-size-plus50", key: "face_adjust_mouse", value: 50 },
	{ name: "26-inner-corner-50", key: "face_adjust_inner_corner", value: 50 },
	{
		name: "27-inner-corner-minus50",
		key: "face_adjust_inner_corner",
		value: -50,
	},
	{ name: "28-nose-size-minus24", key: "face_adjust_nose", value: -24 },
	{ name: "29-nose-size-plus25", key: "face_adjust_nose", value: 25 },
	{ name: "30-inner-corner-99", key: "face_adjust_inner_corner", value: 99 },
	{ name: "31-inner-corner-75", key: "face_adjust_inner_corner", value: 75 },
	{ name: "32-nose3d-minus48", key: "face_adjust_3DNose_Big", value: -48 },
	{ name: "33-nose3d-plus50", key: "face_adjust_3DNose_Big", value: 50 },
	{
		name: "34-mouth-tilt-minus100",
		key: "face_adjust_MouthTilted",
		value: -100,
	},
	{ name: "35-mouth-tilt-minus50", key: "face_adjust_MouthTilted", value: -50 },
	{ name: "36-mouth-tilt-plus50", key: "face_adjust_MouthTilted", value: 50 },
	{ name: "37-mouth-tilt-plus100", key: "face_adjust_MouthTilted", value: 100 },
	{ name: "38-eye-tilt-minus100", key: "face_adjust_EyeTilted", value: -100 },
	{ name: "39-eye-tilt-minus50", key: "face_adjust_EyeTilted", value: -50 },
	{ name: "40-eye-tilt-plus50", key: "face_adjust_EyeTilted", value: 50 },
	{ name: "41-eye-tilt-plus100", key: "face_adjust_EyeTilted", value: 100 },
	{ name: "42-tilt-reset" },
	{
		name: "43-mouth-smile-lips-minus50",
		key: "face_adjust_mouse_corner",
		value: -50,
	},
	{
		name: "44-mouth-smile-lips-plus50",
		key: "face_adjust_mouse_corner",
		value: 50,
	},
	{ name: "45-mouth-smile-minus100", key: "face_adjust_Smile", value: -100 },
	{ name: "46-mouth-smile-plus100", key: "face_adjust_Smile", value: 100 },
	{ name: "47-mouth-size-minus50", key: "face_adjust_ZoomMouth", value: -50 },
	{
		name: "48-mouth-position-minus50",
		key: "face_adjust_MoveMouth",
		value: -50,
	},
	{ name: "49-mouth-position-plus50", key: "face_adjust_MoveMouth", value: 50 },
	{ name: "50-mouth-teeth-100", key: "face_adjust_WhiteTeeth", value: 100 },
	{
		name: "51-mouth-legacy-corner-minus50",
		key: "face_adjust_mouse_corner",
		value: -50,
	},
	{
		name: "52-mouth-legacy-corner-plus50",
		key: "face_adjust_mouse_corner",
		value: 50,
	},
	{ name: "53-mouth-final-reset" },
	{ name: "54-eye-bright-50", key: "face_adjust_BrightEye", value: 50 },
	{ name: "55-eye-bright-100", key: "face_adjust_BrightEye", value: 100 },
	{ name: "56-eye-spacing-minus50", key: "face_adjust_EyeSpacing", value: -50 },
	{ name: "57-eye-position-minus50", key: "face_adjust_MoveEye", value: -50 },
	{ name: "58-eye-position-plus50", key: "face_adjust_MoveEye", value: 50 },
	{ name: "59-inner-corner-100", key: "face_adjust_inner_corner", value: 100 },
	{ name: "60-eyes-final-reset" },
];

await mkdir(output, { recursive: true });
const image = await loadImage(source);
const height = Math.round((width * image.height) / image.width);
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");
context.drawImage(image, 0, 0, width, height);
const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
const provider = createJianyingPortraitAdjustmentProvider();
const results: Array<Record<string, unknown>> = [];
try {
	const status = await provider.inspect();
	if (!status.available) throw new Error(status.message);
	const packages = await resolveJianyingPortraitPackages();
	const selected = sampleFilter
		? cases.filter(
				({ name }) =>
					name === "00-neutral" || new RegExp(sampleFilter).test(name)
			)
		: cases;
	await selected.reduce(async (previous, sample) => {
		await previous;
		if (coldStart) await provider.clear();
		const adjustments = {
			enabled: true,
			values: sample.key ? { [sample.key]: sample.value } : {},
		};
		const started = performance.now();
		const frame = await provider.render({
			width,
			height,
			rgba,
			adjustments,
			frameNumber: 0,
			timestampSeconds: 0,
			sourceKey: source,
		});
		context.putImageData(
			new ImageData(Uint8ClampedArray.from(frame.rgba), width, height),
			0,
			0
		);
		const png = canvas.toBuffer("image/png");
		await writeFile(path.join(output, `${sample.name}.png`), png);
		let absoluteDifference = 0;
		let changedPixels = 0;
		for (let index = 0; index < rgba.length; index += 4) {
			const difference =
				Math.abs(rgba[index] - frame.rgba[index]) +
				Math.abs(rgba[index + 1] - frame.rgba[index + 1]) +
				Math.abs(rgba[index + 2] - frame.rgba[index + 2]);
			absoluteDifference += difference;
			if (difference > 0) changedPixels += 1;
		}
		const result = {
			...sample,
			adjustments,
			provider: frame.provider,
			width,
			height,
			changedPixels,
			mae: absoluteDifference / (width * height * 3),
			elapsedMs: performance.now() - started,
			sha256: createHash("sha256").update(png).digest("hex"),
		};
		results.push(result);
		console.log(JSON.stringify(result));
	}, Promise.resolve());
	await writeFile(
		path.join(output, "report.json"),
		JSON.stringify(
			{
				source,
				sourceSha256: createHash("sha256")
					.update(await readFile(source))
					.digest("hex"),
				width,
				height,
				coldStart,
				provider: status.provider,
				offlineReady: status.offlineReady,
				packages,
				results,
			},
			null,
			2
		)
	);
} finally {
	await provider.clear();
}
