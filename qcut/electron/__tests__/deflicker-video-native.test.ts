import { execFile } from "node:child_process";
import {
	link,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflickerLocalVideo } from "../ffmpeg/deflicker-video.js";
import { getFFmpegPath } from "../ffmpeg/paths.js";

const execFileAsync = promisify(execFile);
const nativeEnabled = process.env.QCUT_DEFLICKER_NATIVE === "1";
const width = 96;
const height = 64;
const frameCount = 96;
const frameBytes = (width * height * 3) / 2;
let directory: string;
let ffmpeg: string;

function fixtureFrames({
	flicker,
	cut = false,
}: {
	flicker: boolean;
	cut?: boolean;
}) {
	const frames = Buffer.alloc(frameBytes * frameCount, 128);
	for (let frame = 0; frame < frameCount; frame++) {
		const brightness = flicker ? (frame % 2 === 0 ? 0.8 : 1.2) : 1;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const marker = (x - frame + width * 2) % width < 16 && y > 16 && y < 48;
				const base = cut && frame >= 48 ? 160 : 90;
				frames[frame * frameBytes + y * width + x] = Math.round(
					(base + (marker ? 30 : 0)) * brightness
				);
			}
		}
	}
	return frames;
}

async function createFixture({
	name,
	flicker,
	cut = false,
}: {
	name: string;
	flicker: boolean;
	cut?: boolean;
}) {
	const raw = path.join(directory, `${name}.yuv`);
	const output = path.join(directory, `${name}.mp4`);
	await writeFile(raw, fixtureFrames({ flicker, cut }));
	await execFileAsync(ffmpeg, [
		"-v",
		"error",
		"-nostdin",
		"-f",
		"rawvideo",
		"-pixel_format",
		"yuv420p",
		"-video_size",
		`${width}x${height}`,
		"-framerate",
		"24",
		"-i",
		raw,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000:duration=4",
		"-c:v",
		"libx264",
		"-crf",
		"0",
		"-c:a",
		"aac",
		output,
	]);
	return output;
}

async function means({ video }: { video: string }) {
	const { stdout } = await execFileAsync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			video,
			"-map",
			"0:v:0",
			"-pix_fmt",
			"yuv420p",
			"-f",
			"rawvideo",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 4 * 1024 * 1024 }
	);
	const values: number[] = [];
	for (let start = 0; start < stdout.length; start += frameBytes) {
		let sum = 0;
		for (let pixel = 0; pixel < width * height; pixel++)
			sum += stdout[start + pixel];
		values.push(sum / (width * height));
	}
	return values;
}

function meanStep({ values }: { values: number[] }) {
	const differences = values
		.slice(1)
		.map((value, index) => Math.abs(value - values[index]));
	return (
		differences.reduce((sum, value) => sum + value, 0) / differences.length
	);
}

describe.skipIf(!nativeEnabled)("standalone deflicker native video", () => {
	beforeAll(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "qcut-deflicker-native-"));
		ffmpeg = getFFmpegPath();
	}, 60_000);
	afterAll(async () => {
		if (directory) await rm(directory, { force: true, recursive: true });
	});

	it("reduces alternating flicker on a moving clip and preserves audio packets", async () => {
		const input = await createFixture({ name: "moving", flicker: true });
		const output = path.join(directory, "moving-output.mp4");
		const result = await deflickerLocalVideo({
			sourcePath: input,
			outputPath: output,
			strength: 70,
		});
		const [before, after] = await Promise.all([
			means({ video: input }),
			means({ video: output }),
		]);
		expect(result).toMatchObject({
			frameCount: 96,
			width,
			height,
			hasAudio: true,
			provider: "ffmpeg",
		});
		expect(after.length).toBe(before.length);
		expect(meanStep({ values: after.slice(24, 72) })).toBeLessThan(
			meanStep({ values: before.slice(24, 72) }) * 0.15
		);
		const hashes = await Promise.all(
			[input, output].map(
				async (video) =>
					(
						await execFileAsync(ffmpeg, [
							"-v",
							"error",
							"-i",
							video,
							"-map",
							"0:a:0",
							"-c:a",
							"copy",
							"-f",
							"hash",
							"-",
						])
					).stdout
			)
		);
		expect(hashes[0]).toBe(hashes[1]);
	}, 60_000);

	it("keeps a moving non-flickering control stable", async () => {
		const input = await createFixture({ name: "stable", flicker: false });
		const output = path.join(directory, "stable-output.mp4");
		await deflickerLocalVideo({
			sourcePath: input,
			outputPath: output,
			strength: 70,
		});
		const [before, after] = await Promise.all([
			means({ video: input }),
			means({ video: output }),
		]);
		expect(
			Math.max(...after.map((value, index) => Math.abs(value - before[index])))
		).toBeLessThan(1);
	}, 60_000);

	it("keeps settled regions of a scene-cut control and exposes the temporal boundary limitation", async () => {
		const input = await createFixture({
			name: "cut",
			flicker: false,
			cut: true,
		});
		const output = path.join(directory, "cut-output.mp4");
		await deflickerLocalVideo({
			sourcePath: input,
			outputPath: output,
			strength: 70,
		});
		const [before, after] = await Promise.all([
			means({ video: input }),
			means({ video: output }),
		]);
		const error = after.map((value, index) => Math.abs(value - before[index]));
		expect(Math.max(...error.slice(0, 20), ...error.slice(75))).toBeLessThan(1);
		// This backend averages across cuts; the CLI documents per-shot processing.
		expect(Math.max(...error.slice(24, 72))).toBeGreaterThan(10);
	}, 60_000);

	it("rejects overwrite and cancellation without leaving partial files", async () => {
		const input = await createFixture({ name: "cancel", flicker: false });
		const output = path.join(directory, "existing.mp4");
		await writeFile(output, "existing");
		await expect(
			deflickerLocalVideo({
				sourcePath: input,
				outputPath: output,
				strength: 70,
			})
		).rejects.toThrow("Output already exists");
		const controller = new AbortController();
		await expect(
			deflickerLocalVideo({
				sourcePath: input,
				outputPath: output,
				force: true,
				strength: 70,
				signal: controller.signal,
				onProgress: ({ stage }) => {
					if (stage === "process") controller.abort();
				},
			})
		).rejects.toThrow();
		expect(await readFile(output, "utf8")).toBe("existing");
		expect(
			(await readdir(directory)).filter((name) =>
				name.startsWith(".qcut-deflicker-")
			)
		).toEqual([]);
	}, 60_000);

	it.skipIf(process.platform === "win32")(
		"protects the source through a symbolic output alias even with force",
		async () => {
			const input = await createFixture({
				name: "alias-input",
				flicker: false,
			});
			const alias = path.join(directory, "alias.mp4");
			await symlink(input, alias);
			await expect(
				deflickerLocalVideo({
					sourcePath: input,
					outputPath: alias,
					strength: 70,
					force: true,
				})
			).rejects.toThrow("source video");
		}
	);
	it("replaces a hard-link destination without changing source bytes", async () => {
		const input = await createFixture({
			name: "hardlink-input",
			flicker: true,
		});
		const alias = path.join(directory, "hardlink-output.mp4");
		await link(input, alias);
		const before = await readFile(input);
		await deflickerLocalVideo({
			sourcePath: input,
			outputPath: alias,
			force: true,
			strength: 70,
		});
		expect(await readFile(input)).toEqual(before);
		expect(await readFile(alias)).not.toEqual(before);
	}, 60_000);

	it("retains two-frame silent clips shorter than the filter window", async () => {
		const input = path.join(directory, "two-frames.mp4");
		const output = path.join(directory, "two-frames-output.mp4");
		await execFileAsync(ffmpeg, [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=96x64:rate=24",
			"-frames:v",
			"2",
			"-c:v",
			"libx264",
			input,
		]);
		const result = await deflickerLocalVideo({
			sourcePath: input,
			outputPath: output,
			strength: 100,
		});
		expect(result).toMatchObject({ frameCount: 2, hasAudio: false });
	}, 60_000);
});
