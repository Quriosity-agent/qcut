import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = process.env.QCUT_PORTRAIT_REFERENCE_ROOT;
if (!root)
	throw new Error("Set QCUT_PORTRAIT_REFERENCE_ROOT to the evidence folder");
const output = path.join(root, "qcut-comparison");
const sources: Array<{ path: string; sha256: string }> = [];

async function normalizedFrame({
	name,
	jianying = false,
}: {
	name: string;
	jianying?: boolean;
}) {
	const filename = path.join(
		root!,
		jianying ? "slider-comparison/screenshots" : "qcut-comparison/native-cold",
		`${name}.${jianying ? "jpg" : "png"}`
	);
	const bytes = await readFile(filename);
	sources.push({
		path: filename,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	});
	const image = await loadImage(bytes);
	const canvas = createCanvas(396, 592);
	const context = canvas.getContext("2d");
	// Fixed player rectangle from the 1751x1114 Jianying reference screenshots.
	if (jianying) context.drawImage(image, 731, 79, 396, 592, 0, 0, 396, 592);
	else context.drawImage(image, 0, 0, 396, 592);
	return canvas;
}

interface SheetRow {
	label: string;
	frames: Array<{ name: string; jianying?: boolean }>;
}

async function createSheet({
	name,
	title,
	columns,
	rows,
}: {
	name: string;
	title: string;
	columns: string[];
	rows: SheetRow[];
}) {
	const canvas = createCanvas(
		columns.length * 320 + 32,
		rows.length * 412 + 134
	);
	const context = canvas.getContext("2d");
	context.fillStyle = "#f8f8f8";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = "#161616";
	context.font = "bold 22px Arial";
	context.fillText(title, 16, 30);
	context.font = "14px Arial";
	context.fillText(
		"Same source photo. Fixed face crop. No retouching or geometric alignment of evidence.",
		16,
		55
	);
	for (const [index, label] of columns.entries())
		context.fillText(label, index * 320 + 16, 83);
	await rows.reduce(async (previous, row, rowIndex) => {
		await previous;
		const top = 103 + rowIndex * 412;
		context.font = "bold 16px Arial";
		context.fillText(row.label, 16, top + 12);
		await row.frames.reduce(async (previousFrame, frame, columnIndex) => {
			await previousFrame;
			const image = await normalizedFrame(frame);
			context.drawImage(
				image,
				49,
				131,
				300,
				360,
				columnIndex * 320 + 16,
				top + 26,
				300,
				360
			);
		}, Promise.resolve());
	}, Promise.resolve());
	context.font = "13px Arial";
	context.fillText(
		"Jianying: UI JPEG crop. QCut: native-provider PNG at 600x900. These are not equal-resolution export parity tests.",
		16,
		canvas.height - 13
	);
	await writeFile(
		path.join(output, `${name}.png`),
		canvas.toBuffer("image/png")
	);
}

await mkdir(output, { recursive: true });
await createSheet({
	name: "nose-position-before-after",
	title: "Nose position: separate the classic and feature operators",
	columns: [
		"QCut neutral",
		"Jianying reference",
		"QCut classic: MoveNose",
		"QCut current label: NosePosition",
	],
	rows: [
		{
			label: "Slider -48",
			frames: [
				{ name: "00-neutral" },
				{ name: "08-nose-position-minus48", jianying: true },
				{ name: "08-nose-position-minus48" },
				{ name: "22-alt-nose-position-minus48" },
			],
		},
		{
			label: "Slider +50",
			frames: [
				{ name: "00-neutral" },
				{ name: "09-nose-position-plus50", jianying: true },
				{ name: "09-nose-position-plus50" },
				{ name: "23-alt-nose-position-plus50" },
			],
		},
	],
});
await createSheet({
	name: "eyes-skin-reference",
	title: "Single-slider comparison: matching regions, remaining strength gaps",
	columns: ["QCut neutral", "Jianying reference", "QCut native provider"],
	rows: [
		{
			label: "Enlarge eyes: 100",
			frames: [
				{ name: "00-neutral" },
				{ name: "02-eye-size-100", jianying: true },
				{ name: "02-eye-size-100" },
			],
		},
		{
			label: "Eye corners: 99 (not calibrated)",
			frames: [
				{ name: "00-neutral" },
				{ name: "04-eye-corner-99", jianying: true },
				{ name: "04-eye-corner-99" },
			],
		},
		{
			label: "Skin smooth: 80",
			frames: [
				{ name: "00-neutral" },
				{ name: "20-skin-smooth-80", jianying: true },
				{ name: "20-skin-smooth-80" },
			],
		},
	],
});
await createSheet({
	name: "nose-chin-reference",
	title: "Unresolved calibration: size, contour and negative endpoint",
	columns: ["QCut neutral", "Jianying reference", "QCut native provider"],
	rows: [
		{
			label: "Nose size: -48 (not calibrated)",
			frames: [
				{ name: "00-neutral" },
				{ name: "11-nose-size-minus48", jianying: true },
				{ name: "11-nose-size-minus48" },
			],
		},
		{
			label: "Chin length: -48 (occluded boundary)",
			frames: [
				{ name: "00-neutral" },
				{ name: "18-chin-length-minus48", jianying: true },
				{ name: "18-chin-length-minus48" },
			],
		},
		{
			label: "Slim face: 99",
			frames: [
				{ name: "00-neutral" },
				{ name: "17-face-slim-99", jianying: true },
				{ name: "17-face-slim-99" },
			],
		},
	],
});
await writeFile(
	path.join(output, "contact-sheets-manifest.json"),
	JSON.stringify(
		{
			normalizedSize: [396, 592],
			jianyingPlayerCrop: [731, 79, 396, 592],
			faceCrop: [49, 131, 300, 360],
			sources,
		},
		null,
		2
	)
);
