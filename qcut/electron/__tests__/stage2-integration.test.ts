/**
 * Stage 2 Integration Tests — Real FFmpeg
 *
 * These tests use REAL FFmpeg (no mocks) against an actual test video
 * to verify scene detection, frame extraction, and audio extraction
 * work end-to-end.
 *
 * Test video: apps/web/src/test/e2e/fixtures/media/test-scenes.mp4
 *   - 9 seconds, 640x360, H.264 + AAC audio
 *   - 3 distinct color scenes: red (0-3s), blue (3-6s), green (6-9s)
 *
 * ## HTTP Timeout Architecture Note
 *
 * The Claude HTTP server has a 30-second global timeout
 * (see electron/claude/http/claude-http-server.ts), but several Stage 2
 * handlers have much longer internal timeouts:
 *
 *   - Transcription: 5 min  →  client gets 408 after 30s
 *   - Scene Detection: 3 min
 *   - Vision API: 2 min
 *   - Audio Extraction: 2 min
 *
 * This is why the async job pattern (G1) exists for transcription:
 * `POST /transcribe/:projectId/start` returns immediately with a jobId,
 * and the client polls `GET /jobs/:jobId` for progress. Without this,
 * transcription of any video > ~10 seconds will always hit the HTTP timeout.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Minimal mocks — only Electron internals, NOT fs/child_process/ffmpeg
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn((name: string) => {
			if (name === "documents") return tmpdir();
			if (name === "temp") return tmpdir();
			return tmpdir();
		}),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
	},
}));

vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
}));

// Return the REAL ffmpeg/ffprobe paths
vi.mock("../ffmpeg/utils", () => ({
	getFFmpegPath: vi.fn(() => {
		try {
			return execFileSync("which", ["ffmpeg"]).toString().trim();
		} catch {
			return "ffmpeg";
		}
	}),
	getFFprobePath: vi.fn(() => {
		try {
			return execFileSync("which", ["ffprobe"]).toString().trim();
		} catch {
			return "ffprobe";
		}
	}),
}));

vi.mock("../api-key-handler", () => ({
	getDecryptedApiKeys: vi.fn(async () => ({
		falApiKey: "",
		geminiApiKey: "",
		anthropicApiKey: "",
	})),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_VIDEO = join(
	__dirname,
	"../../apps/web/src/test/e2e/fixtures/media/test-scenes.mp4"
);
const TEMP_DIR = join(tmpdir(), "qcut-integration-test");
const HAS_TEST_VIDEO = existsSync(TEST_VIDEO);

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
	if (!HAS_TEST_VIDEO) {
		console.warn(
			`Skipping Stage 2 integration tests — test video not found: ${TEST_VIDEO}\n` +
				"Generate it with: ffmpeg -y -f lavfi -i 'color=c=red:size=640x360:duration=3:rate=30' " +
				"-f lavfi -i 'color=c=blue:size=640x360:duration=3:rate=30' " +
				"-f lavfi -i 'color=c=green:size=640x360:duration=3:rate=30' " +
				"-f lavfi -i 'sine=frequency=440:duration=9' " +
				'-filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[outv]" ' +
				"-map '[outv]' -map 3:a -c:v libx264 -preset ultrafast -crf 28 " +
				`-pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart ${TEST_VIDEO}`
		);
		return;
	}
	if (!existsSync(TEMP_DIR)) {
		mkdirSync(TEMP_DIR, { recursive: true });
	}
});

afterAll(() => {
	try {
		rmSync(TEMP_DIR, { recursive: true, force: true });
	} catch {
		/* ignore cleanup errors */
	}
});

// ---------------------------------------------------------------------------
// 2.2: Scene Detection — Real FFmpeg
// ---------------------------------------------------------------------------

import {
	detectScenesWithFFmpeg,
	parseShowInfoOutput,
} from "../claude/handlers/claude-scene-handler";

describe.skipIf(!HAS_TEST_VIDEO)("Scene Detection (real FFmpeg)", () => {
	it("detects scene boundaries in test video with 3 color scenes", async () => {
		const scenes = await detectScenesWithFFmpeg(TEST_VIDEO, 0.3);

		// Should detect the red→blue transition (~3s) and blue→green transition (~6s)
		expect(scenes.length).toBeGreaterThanOrEqual(2);

		// First scene should be near 3s (red → blue)
		const scene1 = scenes.find((s) => s.timestamp >= 2.5 && s.timestamp <= 3.5);
		expect(scene1).toBeDefined();
		expect(scene1!.confidence).toBeGreaterThan(0);

		// Second scene should be near 6s (blue → green)
		const scene2 = scenes.find((s) => s.timestamp >= 5.5 && s.timestamp <= 6.5);
		expect(scene2).toBeDefined();
	}, 15_000);

	it("returns fewer scenes with higher threshold", async () => {
		const lowThreshold = await detectScenesWithFFmpeg(TEST_VIDEO, 0.1);
		const highThreshold = await detectScenesWithFFmpeg(TEST_VIDEO, 0.9);

		// Higher threshold = fewer or equal scenes
		expect(highThreshold.length).toBeLessThanOrEqual(lowThreshold.length);
	}, 15_000);

	it("always includes scene at timestamp 0", async () => {
		const scenes = await detectScenesWithFFmpeg(TEST_VIDEO, 0.3);

		// The handler auto-inserts a scene at 0 if not already there
		expect(scenes[0].timestamp).toBe(0);
		expect(scenes[0].confidence).toBe(1.0);
	}, 15_000);

	it("produces sorted, deduplicated results", async () => {
		const scenes = await detectScenesWithFFmpeg(TEST_VIDEO, 0.3);

		for (let i = 1; i < scenes.length; i++) {
			// Sorted
			expect(scenes[i].timestamp).toBeGreaterThan(scenes[i - 1].timestamp);
			// Deduplicated (>= 0.5s apart)
			expect(
				scenes[i].timestamp - scenes[i - 1].timestamp
			).toBeGreaterThanOrEqual(0.5);
		}
	}, 15_000);
});

// ---------------------------------------------------------------------------
// Frame Extraction — Real FFmpeg
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_TEST_VIDEO)("Frame Extraction (real FFmpeg)", () => {
	it("extracts a frame at timestamp 0", async () => {
		const outputPath = join(TEMP_DIR, "frame-0.jpg");

		await extractFrameWithFFmpeg(TEST_VIDEO, 0, outputPath);

		expect(existsSync(outputPath)).toBe(true);
		const stat = statSync(outputPath);
		expect(stat.size).toBeGreaterThan(0);
	}, 15_000);

	it("extracts a frame at timestamp 4.5 (blue scene)", async () => {
		const outputPath = join(TEMP_DIR, "frame-4.5.jpg");

		await extractFrameWithFFmpeg(TEST_VIDEO, 4.5, outputPath);

		expect(existsSync(outputPath)).toBe(true);
		const stat = statSync(outputPath);
		expect(stat.size).toBeGreaterThan(100); // Should be a real JPEG
	}, 15_000);

	it("extracts frames at multiple timestamps", async () => {
		const timestamps = [0, 1.5, 3, 4.5, 6, 7.5];
		const paths: string[] = [];

		for (const ts of timestamps) {
			const outputPath = join(TEMP_DIR, `multi-frame-${ts}.jpg`);
			await extractFrameWithFFmpeg(TEST_VIDEO, ts, outputPath);
			paths.push(outputPath);
		}

		for (const p of paths) {
			expect(existsSync(p)).toBe(true);
			expect(statSync(p).size).toBeGreaterThan(0);
		}
	}, 30_000);

	it("extracted frames are valid JPEG files", async () => {
		const outputPath = join(TEMP_DIR, "jpeg-check.jpg");
		await extractFrameWithFFmpeg(TEST_VIDEO, 1, outputPath);

		const buffer = await readFile(outputPath);
		// JPEG files start with FF D8 FF
		expect(buffer[0]).toBe(0xff);
		expect(buffer[1]).toBe(0xd8);
		expect(buffer[2]).toBe(0xff);
	}, 15_000);
});

// ---------------------------------------------------------------------------
// 2.1: Audio Extraction — Real FFmpeg
// ---------------------------------------------------------------------------

import { extractAudio } from "../claude/handlers/claude-transcribe-handler";

describe.skipIf(!HAS_TEST_VIDEO)("Audio Extraction (real FFmpeg)", () => {
	it("extracts audio from video to MP3", async () => {
		const audioPath = await extractAudio(TEST_VIDEO);

		expect(existsSync(audioPath)).toBe(true);
		const stat = statSync(audioPath);
		expect(stat.size).toBeGreaterThan(0);
		expect(audioPath).toMatch(/\.mp3$/);

		// Clean up
		rmSync(audioPath, { force: true });
	}, 30_000);

	it("extracted audio is a valid MP3 file", async () => {
		const audioPath = await extractAudio(TEST_VIDEO);

		const buffer = await readFile(audioPath);
		// MP3 files start with FF FB or FF F3 or ID3 tag
		const isMP3 =
			(buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) ||
			(buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33); // ID3
		expect(isMP3).toBe(true);

		// Clean up
		rmSync(audioPath, { force: true });
	}, 30_000);

	it("extracted audio has reasonable size for 9s video", async () => {
		const audioPath = await extractAudio(TEST_VIDEO);
		const stat = statSync(audioPath);

		// 9 seconds at 64kbps mono ≈ 72KB, but with overhead probably 5-100KB
		expect(stat.size).toBeGreaterThan(1000);
		expect(stat.size).toBeLessThan(500_000);

		// Clean up
		rmSync(audioPath, { force: true });
	}, 30_000);
});

// ---------------------------------------------------------------------------
// parseShowInfoOutput with real FFmpeg output
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_TEST_VIDEO)(
	"parseShowInfoOutput with real FFmpeg output",
	() => {
		it("parses real FFmpeg scene detection stderr", async () => {
			const ffmpegPath = execFileSync("which", ["ffmpeg"]).toString().trim();

			const stderr = await new Promise<string>((resolve, reject) => {
				const proc = spawn(
					ffmpegPath,
					[
						"-i",
						TEST_VIDEO,
						"-filter:v",
						"select='gt(scene,0.3)',showinfo",
						"-vsync",
						"vfr",
						"-f",
						"null",
						"-",
					],
					{ stdio: ["ignore", "pipe", "pipe"] }
				);

				let output = "";
				proc.stderr?.on("data", (chunk: Buffer) => {
					output += chunk.toString();
				});

				proc.on("close", () => resolve(output));
				proc.on("error", reject);
			});

			const scenes = parseShowInfoOutput(stderr);

			// Should find 2 scene changes at ~3s and ~6s
			expect(scenes.length).toBe(2);
			expect(scenes[0].timestamp).toBeCloseTo(3, 0);
			expect(scenes[1].timestamp).toBeCloseTo(6, 0);
		}, 15_000);
	}
);

// ---------------------------------------------------------------------------
// Helper: Frame extraction using real FFmpeg (mirrors vision-handler logic)
// ---------------------------------------------------------------------------

function extractFrameWithFFmpeg(
	videoPath: string,
	timestamp: number,
	outputPath: string
): Promise<void> {
	const ffmpegPath = execFileSync("which", ["ffmpeg"]).toString().trim();

	return new Promise((resolve, reject) => {
		const proc = spawn(
			ffmpegPath,
			[
				"-ss",
				String(timestamp),
				"-i",
				videoPath,
				"-vframes",
				"1",
				"-q:v",
				"3",
				"-y",
				outputPath,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
		);

		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Frame extraction failed (code ${code})`));
		});
		proc.on("error", reject);
	});
}
