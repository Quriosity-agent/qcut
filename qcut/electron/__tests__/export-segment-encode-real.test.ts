import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExportSegmentEncodeArgs } from "../claude/handlers/claude-export-handler/export-segment-encode";
import { buildExportSegmentInputArgs } from "../claude/handlers/claude-export-handler/export-engine";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/export-segment-encode-test"
);

function probe({ file, stream }: { file: string; stream: "v" | "a" }): {
	duration: number;
	frames: number;
} {
	const result = spawnSync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			`${stream}:0`,
			"-count_frames",
			"-show_entries",
			"stream=duration,nb_read_frames",
			"-of",
			"json",
			file,
		],
		{ encoding: "utf8" }
	);
	const parsed = JSON.parse(result.stdout) as {
		streams: Array<{ duration: string; nb_read_frames: string }>;
	};
	return {
		duration: Number(parsed.streams[0].duration),
		frames: Number(parsed.streams[0].nb_read_frames),
	};
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"export segment encode (real ffmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "short-audio.mp4");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			// One second of picture at 24 fps whose sound stops 60 ms early, the
			// shape AAC sources on a timeline often have.
			const made = spawnSync(
				ffmpegPath,
				[
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=red:s=64x64:r=24:d=1",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:sample_rate=48000:duration=0.94",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					sourcePath,
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(made.status, made.stderr).toBe(0);
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		function encodeSegment({
			duration,
			name,
		}: {
			duration: number;
			name: string;
		}) {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration,
				trimStart: 0,
				sourceId: "media-1",
				fitMode: "cover",
			};
			const outputPath = path.join(tempDir, name);
			const args = buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({ segment }),
				scaleFilter: "scale=64:64",
				segment,
				settings: { fps: 24, codec: "libx264", bitrate: "1M" },
				outputPath,
			});
			const encoded = spawnSync(ffmpegPath, args, {
				encoding: "utf8",
				timeout: 60_000,
			});
			expect(encoded.status, encoded.stderr).toBe(0);
			return {
				video: probe({ file: outputPath, stream: "v" }),
				audio: probe({ file: outputPath, stream: "a" }),
			};
		}

		it("keeps every frame of a segment whose audio is shorter than its picture", () => {
			const { video, audio } = encodeSegment({
				duration: 1,
				name: "segment.mp4",
			});
			expect(video.frames).toBe(24);
			expect(video.duration).toBeCloseTo(1, 2);
			expect(audio.duration).toBeGreaterThanOrEqual(0.99);
		});

		it("fills a segment longer than its source by holding the last frame", () => {
			const { video, audio } = encodeSegment({
				duration: 1.5,
				name: "segment-long.mp4",
			});
			expect(video.frames).toBe(36);
			expect(video.duration).toBeCloseTo(1.5, 2);
			expect(audio.duration).toBeGreaterThanOrEqual(1.49);
		});
	}
);
