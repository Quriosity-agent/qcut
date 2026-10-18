import { execFileSync } from "node:child_process";

export function createBodyImageEvidence({
	ffmpeg,
	width,
	height,
}: {
	ffmpeg: string;
	width: number;
	height: number;
}) {
	function rgba({ file }: { file: string }) {
		return execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				file,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"-",
			],
			{
				maxBuffer: 64 * 1024 * 1024,
			}
		);
	}

	function difference({
		left,
		right,
		output,
	}: {
		left: Buffer;
		right: Buffer;
		output?: string;
	}) {
		if (left.length !== width * height * 4 || right.length !== left.length)
			throw new Error("Evidence RGBA dimensions do not match");
		const pixels = Buffer.alloc(left.length);
		let maxRgb = 0;
		let maxAlpha = 0;
		let total = 0;
		let changedPixels = 0;
		for (let index = 0; index < left.length; index += 4) {
			let changed = false;
			for (let channel = 0; channel < 3; channel++) {
				const delta = Math.abs(left[index + channel] - right[index + channel]);
				maxRgb = Math.max(maxRgb, delta);
				total += delta;
				changed ||= delta > 0;
				pixels[index + channel] = Math.min(255, delta * 4);
			}
			if (changed) changedPixels++;
			maxAlpha = Math.max(
				maxAlpha,
				Math.abs(left[index + 3] - right[index + 3])
			);
			pixels[index + 3] = 255;
		}
		if (output)
			execFileSync(
				ffmpeg,
				[
					"-v",
					"error",
					"-f",
					"rawvideo",
					"-pix_fmt",
					"rgba",
					"-s",
					`${width}x${height}`,
					"-i",
					"-",
					"-frames:v",
					"1",
					output,
				],
				{ input: pixels }
			);
		return {
			maxRgb,
			maxAlpha,
			meanRgb: total / ((left.length / 4) * 3),
			changedPixels,
		};
	}

	return { rgba, difference };
}
