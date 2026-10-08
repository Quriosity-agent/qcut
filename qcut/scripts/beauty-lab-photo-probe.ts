import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import {
	beautyMatrixOptions,
	beautyMatrixProviders,
} from "./beauty-lab-matrix-providers";

async function main() {
	const {
		configurationPath: imagePath,
		outputPath,
		resume,
		packagedApp,
	} = beautyMatrixOptions({ argv: process.argv.slice(2) });
	if (resume) throw new Error("Photo probe requires a new output directory");
	const directory = path.resolve(outputPath);
	await mkdir(directory, { recursive: false });
	const image = await loadImage(path.resolve(imagePath));
	const scale = Math.min(1, 640 / Math.max(image.width, image.height));
	const width = Math.round(image.width * scale),
		height = Math.round(image.height * scale);
	const canvas = createCanvas(width, height),
		context = canvas.getContext("2d");
	context.fillStyle = "white";
	context.fillRect(0, 0, width, height);
	context.drawImage(image, 0, 0, width, height);
	const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
	const hash = ({ bytes }: { bytes: Uint8Array }) =>
		createHash("sha256").update(bytes).digest("hex");
	function save({ name, pixels }: { name: string; pixels: Uint8Array }) {
		context.putImageData(
			new ImageData(new Uint8ClampedArray(pixels), width, height),
			0,
			0
		);
		return writeFile(
			path.join(directory, `${name}.png`),
			canvas.toBuffer("image/png")
		);
	}
	const { owned, native, executionIdentity } = await beautyMatrixProviders({
		packagedApp,
	});
	try {
		const [independentStatus, nativeStatus] = await Promise.all([
			owned.inspect(),
			native.inspect(),
		]);
		await writeFile(
			path.join(directory, "status.json"),
			JSON.stringify({ independentStatus, nativeStatus }, null, 2)
		);
		console.log(
			JSON.stringify({
				independent: independentStatus.available,
				native: nativeStatus.available,
				width,
				height,
			})
		);
		if (!independentStatus.available || !nativeStatus.available)
			throw new Error("Both real providers must be available");
		await save({ name: "original", pixels: rgba });
		const source = { width, height, rgba, sourceKey: "beauty-lab-photo-probe" };
		const zero = await owned.render({
			request: {
				...source,
				requestId: "probe-zero",
				adjustments: { enabled: true, values: {} },
			},
		});
		if (zero.outputSha256 !== hash({ bytes: rgba }))
			throw new Error("Independent zero controls changed pixels");
		await writeFile(
			path.join(directory, "zero.json"),
			JSON.stringify(zero.report, null, 2)
		);
		const adjustments = {
			enabled: true,
			values: {
				face_adjust_Whiten: 45,
				face_adjust_TotalFace: 35,
				face_adjust_Nose: 25,
			},
			makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
		};
		const result = await owned.render({
			request: { ...source, requestId: "probe-composite", adjustments },
		});
		console.log(`Independent completed: ${result.outputSha256}`);
		const baseline = await native.render({
			...source,
			adjustments,
			frameNumber: 0,
			timestampSeconds: 0,
		});
		if (baseline.provider !== "jianying-local-swing-v1")
			throw new Error("Wrong native provider");
		if (
			result.outputSha256 === hash({ bytes: rgba }) ||
			hash({ bytes: baseline.rgba }) === hash({ bytes: rgba })
		)
			throw new Error("Active controls did not affect the photo");
		const difference = new Uint8Array(rgba.length);
		let total = 0,
			maximum = 0,
			maximumAlpha = 0,
			changed = 0;
		for (let index = 0; index < rgba.length; index += 4) {
			let pixelChanged = false;
			for (let channel = 0; channel < 3; channel++) {
				const delta = Math.abs(
					result.rgba[index + channel] - baseline.rgba[index + channel]
				);
				total += delta;
				maximum = Math.max(maximum, delta);
				pixelChanged ||= delta > 0;
				difference[index + channel] = Math.min(255, delta * 4);
			}
			difference[index + 3] = 255;
			maximumAlpha = Math.max(
				maximumAlpha,
				Math.abs(result.rgba[index + 3] - baseline.rgba[index + 3])
			);
			if (pixelChanged) changed++;
		}
		await Promise.all([
			save({ name: "independent", pixels: result.rgba }),
			save({ name: "native", pixels: baseline.rgba }),
			save({ name: "difference-native-independent-x4", pixels: difference }),
			writeFile(
				path.join(directory, "independent.json"),
				JSON.stringify(result.report, null, 2)
			),
			writeFile(
				path.join(directory, "comparison.json"),
				JSON.stringify(
					{
						executionIdentity,
						adjustments,
						width,
						height,
						nativeProvider: baseline.provider,
						independentProvider: result.provider,
						originalSha256: hash({ bytes: rgba }),
						nativeSha256: hash({ bytes: baseline.rgba }),
						independentSha256: result.outputSha256,
						nativeProductParityVerified: false,
						zeroIdentity: true,
						meanRGB: total / (width * height * 3),
						maximumRGB: maximum,
						maximumAlpha,
						changedPixels: changed,
					},
					null,
					2
				)
			),
		]);
		console.log(`Saved comparison: ${directory}`);
	} finally {
		await Promise.all([owned.dispose(), native.clear()]);
	}
}
void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
