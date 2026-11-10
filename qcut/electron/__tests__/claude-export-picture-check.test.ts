import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	checkExportedPicture,
	checkJoinedPicture,
	countPictureFrames,
} from "../claude/handlers/claude-export-handler/export-picture-check.js";

const frameCounts =
	(counts: Record<string, number | undefined>) =>
	async ({ path: file }: { path: string }) =>
		counts[file];

const files = [
	{ path: "/t/segment-0000.mov", label: "Clip intro", frames: 25 },
	{ path: "/t/gap-0000.mov", label: "The gap at 1.042 s", frames: 12 },
	{ path: "/t/segment-0001.mov", label: "Clip battle", frames: 24 },
];

describe("checkJoinedPicture", () => {
	it("says nothing when the joined picture is the timeline's length", async () => {
		expect(
			await checkJoinedPicture({
				joinedPath: "/t/joined.mp4",
				files,
				fps: 24,
				count: frameCounts({ "/t/joined.mp4": 61 }),
			})
		).toEqual([]);
	});

	it("names the clips that came out another length, and how far apart picture and sound end up", async () => {
		expect(
			await checkJoinedPicture({
				joinedPath: "/t/joined.mp4",
				files,
				fps: 24,
				count: frameCounts({
					"/t/joined.mp4": 63,
					"/t/segment-0000.mov": 26,
					"/t/gap-0000.mov": 12,
					"/t/segment-0001.mov": 25,
				}),
			})
		).toEqual([
			"The joined picture is 63 frames (2.625 s at 24 fps); the timeline gives it 61 frames (2.542 s at 24 fps). Picture and sound are 2 frames (0.083 s at 24 fps) apart by the end.",
			"Clip intro was written as 26 frames, not 25; Clip battle was written as 25 frames, not 24. The picture after each is that much off the timeline.",
		]);
	});

	it("does not guess when the container gives no frame count", async () => {
		expect(
			await checkJoinedPicture({
				joinedPath: "/t/joined.mp4",
				files,
				fps: 24,
				count: frameCounts({}),
			})
		).toEqual([]);
	});
});

describe("checkExportedPicture", () => {
	it("warns when a pass after the join changed the picture's length", async () => {
		expect(
			await checkExportedPicture({
				outputPath: "/out/film.mp4",
				expectedFrames: 61,
				fps: 24,
				count: frameCounts({ "/out/film.mp4": 61 }),
			})
		).toEqual([]);
		expect(
			await checkExportedPicture({
				outputPath: "/out/film.mp4",
				expectedFrames: 61,
				fps: 24,
				count: frameCounts({ "/out/film.mp4": 60 }),
			})
		).toEqual([
			"The exported picture is 60 frames (2.500 s at 24 fps); it should be 61 frames (2.542 s at 24 fps). A pass after the join added or dropped frames.",
		]);
	});
});

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(__dirname, "../../.tmp/export-picture-check-test");

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"countPictureFrames (real ffprobe)",
	() => {
		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			const result = spawnSync(
				ffmpegPath,
				[
					"-v",
					"error",
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=64x64:r=24",
					"-frames:v",
					"37",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					path.join(tempDir, "thirty-seven.mp4"),
				],
				{ encoding: "utf8" }
			);
			expect(result.status, result.stderr).toBe(0);
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("reads the frame count from an MP4, and nothing from a file it cannot read", async () => {
			expect(
				await countPictureFrames({
					path: path.join(tempDir, "thirty-seven.mp4"),
				})
			).toBe(37);
			expect(
				await countPictureFrames({ path: path.join(tempDir, "missing.mp4") })
			).toBeUndefined();
		});
	}
);
