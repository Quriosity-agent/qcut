import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { createBeautyLabIndependentProvider } from "../electron/beauty-lab/beauty-lab-independent";
import {
	processIndependentBeautySequence,
	type IndependentBeautySequenceFrame,
} from "../electron/beauty-lab/beauty-lab-independent-sequence";
import { createJianyingPortraitAdjustmentProvider } from "../electron/jianying-portrait-adjustment-runtime/provider";
import { beautyPixelDifference } from "./beauty-lab-matrix-metrics";

async function main() {
	const [framesPath, outputPath, fpsText, ...extra] = process.argv.slice(2);
	const fps = Number(fpsText);
	if (
		!framesPath ||
		!outputPath ||
		extra.length ||
		!Number.isFinite(fps) ||
		fps <= 0 ||
		fps > 60
	)
		throw new Error(
			"Usage: node <compiled sequence probe> <PNG-frame-directory> <new-output-directory> <fps>"
		);
	const directory = path.resolve(outputPath);
	const files = (await readdir(framesPath))
		.filter((name) => /^\d+\.png$/.test(name))
		.sort();
	if (!files.length || files.length > 300)
		throw new Error("Expected 1..300 numbered PNG frames");
	await mkdir(directory, { recursive: false });
	await Promise.all(
		["original", "native", "independent", "difference"].map((name) =>
			mkdir(path.join(directory, name))
		)
	);
	const engineRoot = path.resolve("research/independent-beauty");
	const manifestHash = createHash("sha256")
		.update(await readFile(path.join(engineRoot, "source-manifest.json")))
		.digest("hex");
	const owned = createBeautyLabIndependentProvider({ engineRoot });
	const native = createJianyingPortraitAdjustmentProvider();
	const sourceKey = `sequence-${manifestHash.slice(0, 16)}`;
	let index = 0;
	const frames: AsyncIterable<IndependentBeautySequenceFrame> = {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					if (index === files.length)
						return { done: true as const, value: undefined };
					const image = await loadImage(path.join(framesPath, files[index]));
					const canvas = createCanvas(image.width, image.height),
						context = canvas.getContext("2d");
					context.fillStyle = "white";
					context.fillRect(0, 0, image.width, image.height);
					context.drawImage(image, 0, 0);
					return {
						done: false as const,
						value: {
							width: image.width,
							height: image.height,
							rgba: new Uint8Array(
								context.getImageData(0, 0, image.width, image.height).data
							),
							timestampSeconds: index++ / fps,
						},
					};
				},
			};
		},
	};
	const adjustments = {
		enabled: true,
		values: {
			face_adjust_Whiten: 45,
			face_adjust_TotalFace: 25,
			face_adjust_Nose: 15,
		},
	};
	const rows: {
		frameNumber: number;
		timestampSeconds: number;
		maximumRGB: number;
		meanRGB: number;
		changedPixels: number;
		alpha: number;
		inputSha256: string;
		outputSha256: string;
	}[] = [];
	const controller = new AbortController();
	const interrupt = () => controller.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	try {
		const sequence = await processIndependentBeautySequence({
			provider: owned,
			frames,
			adjustments,
			sourceKey,
			sequenceId: "real-video",
			signal: controller.signal,
			async onFrame({ input, result, frameNumber }) {
				const baseline = await native.render({
					...input,
					adjustments,
					sourceKey,
					frameNumber,
					timestampSeconds: input.timestampSeconds,
				});
				const comparison = beautyPixelDifference({
					left: baseline.rgba,
					right: result.rgba,
				});
				const name = String(frameNumber).padStart(4, "0");
				async function save({
					folder,
					rgba,
				}: {
					folder: string;
					rgba: Uint8Array;
				}) {
					const canvas = createCanvas(input.width, input.height);
					canvas
						.getContext("2d")
						.putImageData(
							new ImageData(
								new Uint8ClampedArray(rgba),
								input.width,
								input.height
							),
							0,
							0
						);
					await writeFile(
						path.join(directory, folder, `${name}.png`),
						canvas.toBuffer("image/png")
					);
				}
				await Promise.all([
					save({ folder: "original", rgba: input.rgba }),
					save({ folder: "native", rgba: baseline.rgba }),
					save({ folder: "difference", rgba: comparison.difference }),
					writeFile(
						path.join(directory, "independent", `${name}.png`),
						result.png
					),
					writeFile(
						path.join(directory, "independent", `${name}.json`),
						JSON.stringify(result.report, null, 2)
					),
				]);
				rows.push({
					frameNumber,
					timestampSeconds: input.timestampSeconds,
					maximumRGB: comparison.metrics.maximumRGB,
					meanRGB: comparison.metrics.meanRGB,
					changedPixels: comparison.metrics.changedPixels,
					alpha: comparison.metrics.maximumAlpha,
					inputSha256: result.inputSha256,
					outputSha256: result.outputSha256,
				});
				await writeFile(
					path.join(directory, "frames.json"),
					JSON.stringify(
						{
							expectedFrames: files.length,
							completedFrames: rows.length,
							fps,
							adjustments,
							sourceManifestSha256: manifestHash,
							rows,
							nativeProductParityVerified: false,
							independentTrackingVerified: false,
						},
						null,
						2
					)
				);
				console.log(
					`${rows.length}/${files.length}: maxRGB=${comparison.metrics.maximumRGB}`
				);
			},
		});
		await writeFile(
			path.join(directory, "sequence.json"),
			JSON.stringify(sequence, null, 2)
		);
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
		await Promise.all([owned.dispose(), native.clear()]);
	}
}
void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
