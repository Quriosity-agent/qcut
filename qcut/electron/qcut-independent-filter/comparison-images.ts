import { createHash } from "node:crypto";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import type { FilterComparisonMetrics } from "./comparison-contract.js";

export function rgbaDigest({ rgba }: { rgba: Uint8Array }) {
	return createHash("sha256").update(rgba).digest("hex");
}

export function comparisonImage({
	name,
	rgba,
	width,
	height,
}: {
	name: string;
	rgba: Uint8Array;
	width: number;
	height: number;
}) {
	if (rgba.length !== width * height * 4)
		throw new Error("对照图像尺寸不一致。");
	const canvas = createCanvas(width, height);
	canvas
		.getContext("2d")
		.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			0,
			0
		);
	return {
		name,
		sha256: rgbaDigest({ rgba }),
		png: canvas.toDataURL("image/png"),
	};
}

export function compareRgba({
	candidate,
	reference,
}: {
	candidate: Uint8Array;
	reference: Uint8Array;
}) {
	if (
		!candidate.length ||
		candidate.length % 4 ||
		candidate.length !== reference.length
	) {
		throw new Error("对照需要尺寸相同的 RGBA 图像。");
	}
	let sum = 0;
	let squared = 0;
	let rgbMax = 0;
	let alphaMax = 0;
	let changedPixels = 0;
	const differenceGain = 8;
	const difference = new Uint8Array(candidate.length);
	for (let offset = 0; offset < candidate.length; offset += 4) {
		let changed = false;
		for (let channel = 0; channel < 4; channel++) {
			const delta = Math.abs(
				candidate[offset + channel] - reference[offset + channel]
			);
			changed ||= delta !== 0;
			if (channel === 3) {
				alphaMax = Math.max(alphaMax, delta);
				continue;
			}
			sum += delta;
			squared += delta * delta;
			rgbMax = Math.max(rgbMax, delta);
			difference[offset + channel] = Math.min(255, delta * differenceGain);
		}
		difference[offset + 3] = 255;
		if (changed) changedPixels++;
	}
	const pixelCount = candidate.length / 4;
	const metrics: FilterComparisonMetrics = {
		rgbMae: sum / (pixelCount * 3),
		rgbRmse: Math.sqrt(squared / (pixelCount * 3)),
		rgbMax,
		alphaMax,
		changedPixels,
		pixelCount,
	};
	return { metrics, difference, differenceGain };
}
