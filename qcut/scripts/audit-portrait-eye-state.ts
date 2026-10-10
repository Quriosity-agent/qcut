import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import type { MediaPortraitAdjustments } from "../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import { createJianyingPortraitAdjustmentProvider } from "../electron/jianying-portrait-adjustment-runtime/provider.js";

const { values: options } = parseArgs({
	options: {
		source: { type: "string" },
		output: { type: "string" },
	},
});
if (!options.source || !options.output)
	throw new Error("Required: --source IMAGE --output DIRECTORY");
const image = await loadImage(options.source);
const { width, height } = image;
if (width * height > 16_000_000)
	throw new Error("Diagnostic image exceeds 16 million pixels");
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");
context.drawImage(image, 0, 0);
const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
const provider = createJianyingPortraitAdjustmentProvider();
const records: Array<{ name: string; hash: string }> = [];
const combined = { face_adjust_EnlargeEye: 50, face_adjust_BrightEye: 100 };
async function render({
	name,
	values,
	timestampSeconds = 0,
}: {
	name: string;
	values: MediaPortraitAdjustments["values"];
	timestampSeconds?: number;
}) {
	const result = await provider.render({
		width,
		height,
		rgba,
		sourceKey: options.source,
		timestampSeconds,
		adjustments: { enabled: true, values },
	});
	const hash = createHash("sha256").update(result.rgba).digest("hex");
	context.putImageData(
		new ImageData(Uint8ClampedArray.from(result.rgba), width, height),
		0,
		0
	);
	await writeFile(
		path.join(output, `${name}.png`),
		canvas.toBuffer("image/png")
	);
	records.push({ name, hash });
	console.log(JSON.stringify({ name, hash }));
	return hash;
}
try {
	await render({ name: "01-enlarge", values: { face_adjust_EnlargeEye: 50 } });
	const warm = await render({ name: "02-warm-combined", values: combined });
	const held = await render({
		name: "03-held-combined",
		values: combined,
		timestampSeconds: 1 / 30,
	});
	await provider.clear();
	const cold = await render({ name: "04-cold-combined", values: combined });
	await provider.clear();
	await render({
		name: "05-bright-half",
		values: { face_adjust_BrightEye: 50 },
	});
	const brightHistory = await render({
		name: "06-bright-history-combined",
		values: combined,
	});
	await writeFile(
		path.join(output, "report.json"),
		JSON.stringify(
			{
				source: options.source,
				width,
				height,
				inputRgbaSha256: createHash("sha256").update(rgba).digest("hex"),
				records,
				warmMatchesCold: warm === cold,
				heldMatchesCold: held === cold,
				brightHistoryMatchesCold: brightHistory === cold,
			},
			null,
			2
		)
	);
	if (warm !== cold || held !== cold || brightHistory !== cold)
		process.exitCode = 1;
} finally {
	await provider.clear();
}
