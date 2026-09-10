import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFFmpegPath, getFFprobePath } from "../ffmpeg/paths";
import { prepareNeuralInterpolation } from "../ffmpeg/neural-frame-interpolation";
import { RIFE_EXECUTABLE, RIFE_MODEL } from "../rife/rife-bridge";

const execFileAsync = promisify(execFile);

/**
 * Runs the real pre-stage — FFmpeg decode, RIFE, FFmpeg re-encode — on a
 * synthetic clip. It needs the staged FFmpeg and RIFE binaries, so it skips
 * cleanly on machines and CI runners that have not staged them.
 */
const projectRoot = path.resolve(__dirname, "..", "..");
const rifeDir = path.join(
	projectRoot,
	"electron",
	"resources",
	"rife",
	process.platform
);
const staged =
	existsSync(path.join(rifeDir, RIFE_EXECUTABLE)) &&
	existsSync(path.join(rifeDir, RIFE_MODEL, "flownet.bin")) &&
	existsSync(path.join(projectRoot, "electron", "resources", "ffmpeg"));

describe.skipIf(!staged)("neural frame interpolation (staged binaries)", () => {
	let workDir = "";

	beforeAll(async () => {
		workDir = await mkdtemp(path.join(os.tmpdir(), "qcut-neural-it-"));
		// 1 s at 10 fps, tagged BT.709, so the round trip has tags to preserve.
		await execFileAsync(getFFmpegPath(), [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=320x180:rate=10",
			"-t",
			"1",
			"-pix_fmt",
			"yuv420p",
			"-colorspace",
			"bt709",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			"-c:v",
			"libx264",
			"-crf",
			"18",
			path.join(workDir, "clip.mp4"),
		]);
	}, 60_000);
	afterAll(async () => {
		if (workDir) await rm(workDir, { recursive: true, force: true });
	});

	it("triples a 0.6 s window to 18 frames and keeps the BT.709 tags", async () => {
		const result = await prepareNeuralInterpolation({
			sourcePath: path.join(workDir, "clip.mp4"),
			trimStart: 0.2,
			readDuration: 0.6,
			requiredFrames: 18,
			workDir,
		});
		expect(result).not.toBeNull();
		expect(result?.sourceFrames).toBe(6);
		expect(result?.outputFrames).toBe(18);
		expect(result?.frameRate).toBe(30);

		const { stdout } = await execFileAsync(await getFFprobePath(), [
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=nb_read_frames,r_frame_rate,pix_fmt,color_space,color_range",
			"-of",
			"json",
			result?.path ?? "",
		]);
		const stream = (
			JSON.parse(stdout) as { streams: Array<Record<string, string>> }
		).streams[0];
		expect(stream.nb_read_frames).toBe("18");
		expect(stream.r_frame_rate).toBe("30/1");
		expect(stream.pix_fmt).toBe("yuv444p");
		expect(stream.color_space).toBe("bt709");
		expect(stream.color_range).toBe("tv");
	}, 120_000);

	it("declines to synthesise when the source already has enough frames", async () => {
		const result = await prepareNeuralInterpolation({
			sourcePath: path.join(workDir, "clip.mp4"),
			trimStart: 0,
			readDuration: 1,
			requiredFrames: 10,
			workDir: path.join(workDir, "enough"),
		});
		expect(result).toBeNull();
	}, 60_000);
});
