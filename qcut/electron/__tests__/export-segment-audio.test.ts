import { describe, expect, it, vi } from "vitest";

vi.mock("../ffmpeg/neural-frame-interpolation.js", () => ({
	prepareNeuralInterpolation: vi.fn(async () => ({ path: "/tmp/rife.mov" })),
}));

import { resolveNeuralInterpolationSegment } from "../claude/handlers/claude-export-handler/export-neural-segment.js";
import {
	buildExportSegmentEncodeArgs,
	createAudioStreamProbe,
	resolveExportSegmentAudio,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import type {
	ExportSegment,
	ResolvedExportSettings,
} from "../claude/handlers/claude-export-handler/types.js";

function segment(overrides: Partial<ExportSegment> = {}): ExportSegment {
	return {
		elementId: "e1",
		trackId: "t1",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: "/media/clip.mp4",
		startTime: 0,
		duration: 2,
		trimStart: 1.5,
		sourceId: "m1",
		fitMode: "cover",
		...overrides,
	};
}

const withSound = new Set(["/media/clip.mp4"]);
const hasAudioStream = async ({ mediaPath }: { mediaPath: string }) =>
	withSound.has(mediaPath);

describe("where a segment's sound comes from", () => {
	it("reads a clip's own audio, and gives silence to pictures and soundless files", async () => {
		await expect(
			resolveExportSegmentAudio({ segment: segment(), hasAudioStream })
		).resolves.toEqual({ kind: "input" });
		await expect(
			resolveExportSegmentAudio({
				segment: segment({ sourcePath: "/media/silent.mp4" }),
				hasAudioStream,
			})
		).resolves.toBeNull();
		await expect(
			resolveExportSegmentAudio({
				segment: segment({ isImage: true, sourcePath: "/media/clip.mp4" }),
				hasAudioStream,
			})
		).resolves.toBeNull();
	});

	it("keeps a neural-interpolated clip's own sound, read from where it was cut", async () => {
		const resolved = await resolveNeuralInterpolationSegment({
			segment: segment({ frameInterpolation: "neural", playbackRate: 2 }),
			settings: { fps: 30 } as ResolvedExportSettings,
			tempDir: "/tmp/unused",
			index: 0,
		});
		expect(resolved).toMatchObject({
			sourcePath: "/tmp/rife.mov",
			trimStart: 0,
			soundSource: { path: "/media/clip.mp4", trimStart: 1.5 },
		});
		const audio = await resolveExportSegmentAudio({
			segment: resolved,
			hasAudioStream,
		});
		// Rate 2: four source seconds become the clip's two.
		expect(audio).toEqual({
			kind: "separate",
			inputArgs: ["-ss", "1.5", "-t", "4", "-i", "/media/clip.mp4"],
		});
		const args = buildExportSegmentEncodeArgs({
			inputArgs: ["-i", "/tmp/rife.mov"],
			scaleFilter: "scale=64:64",
			segment: resolved,
			settings: { fps: 30, codec: "libx264", bitrate: "1M" },
			audio,
			outputPath: "/tmp/segment-0000.mov",
		});
		expect(args.slice(0, 9)).toEqual([
			"-y",
			"-i",
			"/tmp/rife.mov",
			"-ss",
			"1.5",
			"-t",
			"4",
			"-i",
			"/media/clip.mp4",
		]);
		expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
		]);
		expect(args[args.indexOf("-af") + 1]).toBe(
			"aresample=async=1:first_pts=0,atempo=2,apad"
		);
	});

	it("probes each file once however many clips it is cut into", async () => {
		const probe = vi.fn(async () => true);
		const cached = createAudioStreamProbe({ probe });
		await Promise.all([
			cached({ mediaPath: "/media/a.mp4" }),
			cached({ mediaPath: "/media/a.mp4" }),
			cached({ mediaPath: "/media/b.mp4" }),
		]);
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("maps silence as the second input when a segment has no sound", () => {
		const args = buildExportSegmentEncodeArgs({
			inputArgs: ["-loop", "1", "-t", "2", "-i", "/media/still.png"],
			scaleFilter: "scale=64:64",
			segment: segment({ isImage: true, sourcePath: "/media/still.png" }),
			settings: { fps: 30, codec: "libx264", bitrate: "1M" },
			audio: null,
			outputPath: "/tmp/segment-0001.mov",
		});
		expect(args).toContain("anullsrc=r=48000:cl=stereo");
		expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
		]);
		expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 6)).toEqual([
			"-c:a",
			"pcm_f32le",
			"-ar",
			"48000",
			"-ac",
			"2",
		]);
	});
});
