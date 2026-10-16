import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	measureFileLoudness,
	parseEbur128Report,
} from "../claude/handlers/claude-export-handler/export-loudness";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(__dirname, "../../.tmp/export-loudness-test");

describe("parseEbur128Report", () => {
	it("reads the summary, the loudest windows and the sample peak", () => {
		const stderr = [
			"[Parsed_ebur128_0 @ 0x1] t: 0.1       TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -inf dBFS  TPK: -inf dBFS",
			"[Parsed_ebur128_0 @ 0x1] t: 1.0       TARGET:-23 LUFS    M: -18.3 S: -20.9     I: -20.5 LUFS       LRA:   0.3 LU  FTPK:  -1.9 dBFS  TPK:  -1.9 dBFS",
			"[Parsed_ebur128_0 @ 0x1] t: 1.1       TARGET:-23 LUFS    M: -10.9 S: -14.5     I: -20.2 LUFS       LRA:   0.3 LU  FTPK:  -1.7 dBFS  TPK:  -1.7 dBFS",
			"[Parsed_astats_1 @ 0x2] Peak level dB: -1.085524",
			"[Parsed_ebur128_0 @ 0x1] Summary:",
			"",
			"  Integrated loudness:",
			"    I:         -20.2 LUFS",
			"    Threshold: -30.6 LUFS",
			"",
			"  Loudness range:",
			"    LRA:         3.4 LU",
			"",
			"  True peak:",
			"    Peak:       -1.7 dBFS",
		].join("\n");
		expect(parseEbur128Report({ stderr })).toEqual({
			integratedLufs: -20.2,
			truePeakDbtp: -1.7,
			maxMomentaryLufs: -10.9,
			maxShortTermLufs: -14.5,
			samplePeakDb: -1.085524,
		});
	});

	it("refuses a log without a summary", () => {
		expect(() => parseEbur128Report({ stderr: "nothing" })).toThrow(
			"no summary"
		);
	});
});

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"measureFileLoudness (real ffmpeg)",
	() => {
		const tone = path.join(tempDir, "tone.wav");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			// A stereo 200 Hz sine at exactly -20 dBFS: -20.7 LUFS by BS.1770 for
			// two channels before K-weighting, which still adds about 0.3 dB at
			// 200 Hz (0.7 dB at 1 kHz); sample and true peak -20 dB. Five seconds,
			// so the 3 s short-term window fills.
			const made = spawnSync(
				ffmpegPath,
				[
					"-y",
					"-f",
					"lavfi",
					"-i",
					"aevalsrc=0.1*sin(2*PI*200*t)|0.1*sin(2*PI*200*t):s=48000:d=5",
					"-c:a",
					"pcm_s16le",
					tone,
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(made.status, made.stderr).toBe(0);
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("measures a known tone", async () => {
			const loudness = await measureFileLoudness({ file: tone });
			expect(Math.abs(loudness.integratedLufs + 20.7)).toBeLessThan(0.5);
			expect(Math.abs(loudness.truePeakDbtp + 20)).toBeLessThan(0.2);
			expect(Math.abs(loudness.samplePeakDb + 20)).toBeLessThan(0.1);
			expect(loudness.maxShortTermLufs).toBeGreaterThan(-21.5);
			expect(loudness.maxMomentaryLufs).toBeGreaterThan(-21.5);
			expect(loudness.durationSeconds).toBeCloseTo(5, 1);
		});
	}
);
