import { statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { MediaFile } from "../types/claude-api.js";
import {
	clearMediaProbeCache,
	parseMediaProbe,
	probeMediaFile,
	withMediaProbes,
} from "../claude/handlers/claude-media-probe.js";

const FIXTURES = path.resolve(
	__dirname,
	"../../apps/web/src/test/e2e/fixtures/media"
);

function probeJson({
	streams,
	formatDuration,
}: {
	streams: Array<Record<string, unknown>>;
	formatDuration?: string;
}): string {
	return JSON.stringify({
		streams,
		format: formatDuration ? { duration: formatDuration } : {},
	});
}

function fixture(name: string, type: MediaFile["type"]): MediaFile {
	const filePath = path.join(FIXTURES, name);
	const stat = statSync(filePath);
	return {
		id: name,
		name,
		type,
		path: filePath,
		size: stat.size,
		createdAt: stat.birthtimeMs,
		modifiedAt: stat.mtimeMs,
	};
}

describe("parseMediaProbe", () => {
	it("takes a video's length from its video stream, not the container", () => {
		// The report's clip: 409 frames of 24 fps video under a longer AAC track.
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [
						{
							codec_type: "video",
							width: 1280,
							height: 720,
							avg_frame_rate: "24/1",
							duration: "17.041667",
						},
						{ codec_type: "audio", duration: "17.056000" },
					],
					formatDuration: "17.056000",
				}),
				type: "video",
			})
		).toEqual({ duration: 17.041667, width: 1280, height: 720, fps: 24 });
	});

	it("falls back to the container length and the nominal frame rate", () => {
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [
						{
							codec_type: "video",
							width: 1920,
							height: 1080,
							avg_frame_rate: "0/0",
							r_frame_rate: "30000/1001",
						},
					],
					formatDuration: "4.5",
				}),
				type: "video",
			})
		).toEqual({ duration: 4.5, width: 1920, height: 1080, fps: 29.97 });
	});

	it("reads a WebM picture length from its DURATION tag, not the audio tail", () => {
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [
						{
							codec_type: "video",
							width: 320,
							height: 240,
							avg_frame_rate: "24/1",
							tags: { DURATION: "00:00:01.709000000" },
						},
						{
							codec_type: "audio",
							tags: { DURATION: "00:00:01.798000000" },
						},
					],
					formatDuration: "1.798000",
				}),
				type: "video",
			})
		).toEqual({ duration: 1.709, width: 320, height: 240, fps: 24 });
	});

	it("counts frames when the video stream states no length", () => {
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [
						{
							codec_type: "video",
							width: 1280,
							height: 720,
							avg_frame_rate: "24/1",
							nb_frames: "409",
						},
						{ codec_type: "audio" },
					],
					formatDuration: "17.056",
				}),
				type: "video",
			}).duration
		).toBeCloseTo(409 / 24, 9);
	});

	it("leaves the length unknown rather than take an audio-extended container", () => {
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [
						{
							codec_type: "video",
							width: 1280,
							height: 720,
							avg_frame_rate: "24/1",
						},
						{ codec_type: "audio" },
					],
					formatDuration: "17.056",
				}),
				type: "video",
			})
		).toEqual({ width: 1280, height: 720, fps: 24 });
	});

	it("reads audio length and image size", () => {
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [{ codec_type: "audio", duration: "164.2" }],
				}),
				type: "audio",
			})
		).toEqual({ duration: 164.2 });
		expect(
			parseMediaProbe({
				stdout: probeJson({
					streams: [{ codec_type: "video", width: 640, height: 480 }],
				}),
				type: "image",
			})
		).toEqual({ width: 640, height: 480 });
	});
});

describe("withMediaProbes", () => {
	beforeEach(() => clearMediaProbeCache());

	it("fills duration, size and frame rate from the real files", async () => {
		const [video, audio, image] = await withMediaProbes([
			fixture("sample-video.mp4", "video"),
			fixture("sample-audio.mp3", "audio"),
			fixture("sample-image.png", "image"),
		]);
		expect(video).toMatchObject({
			duration: 5,
			dimensions: { width: 1280, height: 720 },
			fps: 30,
		});
		expect(audio.duration).toBeGreaterThan(0);
		expect(audio.dimensions).toBeUndefined();
		expect(image.dimensions?.width).toBeGreaterThan(0);
		expect(image.duration).toBeUndefined();
	});

	it("keeps what the listing already knew", async () => {
		const [video] = await withMediaProbes([
			{
				...fixture("sample-video.mp4", "video"),
				duration: 3,
				dimensions: { width: 1, height: 1 },
			},
		]);
		expect(video).toMatchObject({
			duration: 3,
			dimensions: { width: 1, height: 1 },
			fps: 30,
		});
	});

	it("leaves an unreadable file's fields empty instead of failing", async () => {
		const unreadable: MediaFile = {
			...fixture("README.md", "video"),
			id: "broken",
		};
		const [result] = await withMediaProbes([unreadable]);
		expect(result).toEqual(unreadable);
	});

	it("probes an unchanged file once, and again once it changes", async () => {
		const file = fixture("sample-video.mp4", "video");
		const request = {
			path: file.path,
			type: file.type,
			size: file.size,
			modifiedAt: file.modifiedAt,
		};
		const first = probeMediaFile(request);
		expect(probeMediaFile(request)).toBe(first);
		expect(
			probeMediaFile({ ...request, modifiedAt: file.modifiedAt + 1 })
		).not.toBe(first);
		await first;
	});
});
