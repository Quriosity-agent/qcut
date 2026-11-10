import { describe, expect, it } from "vitest";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import { buildStandaloneAudioExportArgs } from "../ffmpeg/audio-export-args";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import {
	STEREO_SOURCE_CHAIN,
	STEREO_SOURCE_FILTERS,
} from "../ffmpeg/stereo-source";

/**
 * Where a source is made stereo the way the preview plays it (the measured
 * levels are in stereo-source-real.test.ts).
 */

const clip: ExportSegment = {
	elementId: "clip-1",
	trackId: "track-1",
	trackOrder: 0,
	elementOrder: 0,
	sourcePath: "/tmp/clip.mp4",
	startTime: 0,
	duration: 2,
	trimStart: 0,
	sourceId: "media-1",
	fitMode: "cover",
};

function segmentSound({
	audio,
	audioChannels,
}: {
	audio: Parameters<typeof buildExportSegmentEncodeArgs>[0]["audio"];
	audioChannels?: 1 | 2;
}): string {
	const args = buildExportSegmentEncodeArgs({
		inputArgs: buildExportSegmentInputArgs({ segment: clip }),
		scaleFilter: "scale=1280:720",
		segment: clip,
		settings: {
			fps: 24,
			codec: "libx264",
			bitrate: "8Mbps",
			...(audioChannels ? { audioChannels } : {}),
		},
		audio,
		outputPath: "/t/segment-0000.mov",
	});
	return args[args.indexOf("-af") + 1];
}

describe("the stereo source filters", () => {
	it("lift a one-channel stream by √2 ahead of FFmpeg's own conversion", () => {
		expect(STEREO_SOURCE_FILTERS).toEqual([
			"volume='if(eq(nb_channels,1),sqrt(2),1)'",
			"aresample=ochl=stereo",
		]);
		expect(STEREO_SOURCE_CHAIN).toBe(
			"volume='if(eq(nb_channels,1),sqrt(2),1)',aresample=ochl=stereo"
		);
	});
});

describe("a segment's sound", () => {
	it("is made stereo first, whether it comes with the picture or from its own file", () => {
		expect(
			segmentSound({ audio: { kind: "input" } }).startsWith(
				`${STEREO_SOURCE_CHAIN},aresample=async=1:first_pts=0,`
			)
		).toBe(true);
		expect(
			segmentSound({
				audio: { kind: "separate", inputArgs: ["-i", "/tmp/sound.wav"] },
			}).startsWith(`${STEREO_SOURCE_CHAIN},aresample=async=1:first_pts=0,`)
		).toBe(true);
	});

	it("is left alone when it is silence, which is stereo already", () => {
		expect(segmentSound({ audio: null })).toBe(
			"aresample=async=1:first_pts=0,apad,atrim=end_sample=96000"
		);
	});

	it("keeps its one channel in a mono export", () => {
		expect(segmentSound({ audio: { kind: "input" }, audioChannels: 1 })).toBe(
			"aresample=async=1:first_pts=0,apad,atrim=end_sample=96000"
		);
	});
});

describe("the timeline's audio graph", () => {
	const files = [
		{ path: "/a.wav", startTime: 0, volume: 1 },
		{ path: "/b.wav", startTime: 2, volume: 0.5, trimStart: 1, duration: 4 },
	];

	it("makes every source stereo before anything else is done to it", () => {
		const graph = buildTimelineAudioFilters({
			audioFiles: files,
			audioStartIndex: 1,
			fps: 24,
		});
		expect(graph.filterSteps.slice(0, 2)).toEqual([
			`[1:a]${STEREO_SOURCE_CHAIN}[a_0_source]`,
			"[a_0_source]anull[a_0]",
		]);
		expect(graph.filterSteps.slice(2, 4)).toEqual([
			`[2:a]${STEREO_SOURCE_CHAIN}[a_1_source]`,
			"[a_1_source]atrim=start=1:duration=3,asetpts=PTS-STARTPTS[a_1_prepared]",
		]);
		// No stream reaches the graph's later stages straight from its file.
		const fromFiles = graph.filterSteps.filter((step) =>
			/^\[\d+:a\]/.test(step)
		);
		expect(fromFiles).toHaveLength(2);
		expect(fromFiles.every((step) => step.includes(STEREO_SOURCE_CHAIN))).toBe(
			true
		);
	});

	it("does so for a single clip that needs nothing else, which used to be mapped as it was", () => {
		// Mapped straight from the file, a mono clip met the encoder's `-ac 2`
		// and lost 3 dB there.
		expect(
			buildTimelineAudioFilters({
				audioFiles: [files[0]],
				audioStartIndex: 0,
				fps: 24,
			})
		).toEqual({
			mapAudio: "[a_0]",
			filterSteps: [
				`[0:a]${STEREO_SOURCE_CHAIN}[a_0_source]`,
				"[a_0_source]anull[a_0]",
			],
		});
	});

	it("leaves the sources of a one-channel export as they are", () => {
		expect(
			buildTimelineAudioFilters({
				audioFiles: [files[0]],
				audioStartIndex: 0,
				fps: 24,
				channels: 1,
			})
		).toEqual({ mapAudio: "0:a", filterSteps: [] });
		const graph = buildTimelineAudioFilters({
			audioFiles: files,
			audioStartIndex: 0,
			fps: 24,
			channels: 1,
		});
		expect(graph.filterSteps.join(";")).not.toContain("nb_channels");
	});

	it("is told the channel count by the standalone audio export", () => {
		const options = {
			audioFiles: [files[0]],
			audioCrossfades: [],
			duration: 4,
			bitrate: 192,
			sampleRate: 48_000,
			outputPath: "/tmp/out.mp3",
		};
		const stereo = buildStandaloneAudioExportArgs({ options });
		expect(stereo[stereo.indexOf("-filter_complex") + 1]).toContain(
			STEREO_SOURCE_CHAIN
		);
		const mono = buildStandaloneAudioExportArgs({
			options: { ...options, channels: 1 },
		});
		expect(mono).not.toContain("-filter_complex");
		expect(mono.slice(mono.indexOf("-map"), mono.indexOf("-map") + 2)).toEqual([
			"-map",
			"0:a",
		]);
	});
});
