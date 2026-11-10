import { describe, expect, it } from "vitest";
import {
	buildRangePictureArgs,
	buildRangeSoundArgs,
	layersShowingInRange,
	type PictureLayers,
	rangeAudioFilter,
	rangeFrameCount,
	segmentsShowingInRange,
} from "../claude/handlers/claude-export-handler/export-range";
import { buildExportSegmentEncodeArgs } from "../claude/handlers/claude-export-handler/export-segment-encode";
import {
	EXPORT_PICTURE_COLOR_FILTERS,
	EXPORT_PICTURE_TAGS_FILTER,
} from "../claude/handlers/claude-export-handler/source-color";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

/**
 * How a range export renders: clips outside the range go black but keep
 * their sound, layers outside it are not drawn, and the finished picture
 * and the full-length mix are cut to the range.
 */

function segment(fields: Partial<ExportSegment>): ExportSegment {
	return {
		elementId: "clip",
		trackId: "main",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: "/m/clip.mp4",
		startTime: 0,
		duration: 5,
		trimStart: 0,
		sourceId: "clip",
		isImage: false,
		fitMode: "cover",
		...fields,
	};
}

const settings = {
	width: 1470,
	height: 630,
	fps: 24,
	codec: "libx264",
	bitrate: "8Mbps",
	audioBitrate: 192,
	audioSampleRate: 48_000,
	audioChannels: 2 as const,
};

describe("segmentsShowingInRange", () => {
	const segments = [
		segment({ elementId: "a", startTime: 0, duration: 10 }),
		segment({ elementId: "b", startTime: 10, duration: 10 }),
		segment({ elementId: "c", startTime: 20, duration: 10 }),
		segment({ elementId: "d", startTime: 30, duration: 10 }),
	];

	it("keeps the clips that overlap the range", () => {
		expect(
			segmentsShowingInRange({
				segments,
				transitions: [],
				range: { start: 12, end: 25 },
			})
		).toEqual(new Set([1, 2]));
	});

	it("treats a clip ending exactly at the range start as outside it", () => {
		expect(
			segmentsShowingInRange({
				segments,
				transitions: [],
				range: { start: 10, end: 20 },
			})
		).toEqual(new Set([1]));
	});

	it("keeps both clips of a transition that reaches into the range", () => {
		expect(
			segmentsShowingInRange({
				segments,
				transitions: [
					{ fromElementId: "a", toElementId: "b", duration: 1 },
					{ fromElementId: "c", toElementId: "d", duration: 1 },
				],
				range: { start: 10.5, end: 15 },
			})
		).toEqual(new Set([0, 1]));
	});
});

describe("layersShowingInRange", () => {
	it("drops the layers that start after the range or end before it", () => {
		const layers = {
			mediaOverlays: [
				segment({ elementId: "o1", startTime: 0, duration: 4 }),
				segment({ elementId: "o2", startTime: 3, duration: 4 }),
			],
			stickerOverlays: [
				{ startTime: 0, endTime: 5 },
				{ startTime: 5, endTime: 9 },
			],
			textOverlays: [{ startTime: 6, endTime: 8 }],
			jianyingTextOverlays: [{ startTime: 4.5, endTime: 5.5 }],
			adjustmentLayers: [{ startTime: 0, endTime: 100 }],
		} as unknown as PictureLayers;
		const shown = layersShowingInRange({ layers, range: { start: 5, end: 6 } });
		expect(shown.mediaOverlays.map((o) => o.elementId)).toEqual(["o2"]);
		expect(shown.stickerOverlays).toEqual([{ startTime: 5, endTime: 9 }]);
		expect(shown.textOverlays).toEqual([]);
		expect(shown.jianyingTextOverlays).toEqual([
			{ startTime: 4.5, endTime: 5.5 },
		]);
		expect(shown.adjustmentLayers).toHaveLength(1);
	});
});

describe("cutting the picture and the mix", () => {
	const range = { start: 3734 / 24, end: 4458 / 24 };

	it("counts the range's frames", () => {
		expect(rangeFrameCount({ range, fps: 24 })).toBe(724);
		expect(rangeFrameCount({ range: { start: 0, end: 0.01 }, fps: 24 })).toBe(
			1
		);
	});

	it("seeks a quarter frame early and takes exactly the range's frames", () => {
		const args = buildRangePictureArgs({
			inputPath: "/t/full.mp4",
			outputPath: "/t/range.mp4",
			range,
			settings,
		});
		expect(Number(args[args.indexOf("-ss") + 1])).toBeCloseTo(
			range.start - 0.25 / 24,
			9
		);
		expect(args[args.indexOf("-frames:v") + 1]).toBe("724");
		expect(args[args.indexOf("-r") + 1]).toBe("24");
		// A clock reset would start again at a filter graph rebuild (differing
		// colour tags at a cut) and drop the frames there.
		expect(args.join(" ")).not.toContain("setpts");
		expect(args).toContain("-an");
		expect(args.at(-1)).toBe("/t/range.mp4");
	});

	it("starts at the first frame without a seek", () => {
		expect(
			buildRangePictureArgs({
				inputPath: "/t/full.mp4",
				outputPath: "/t/range.mp4",
				range: { start: 0, end: 2 },
				settings,
			})
		).not.toContain("-ss");
	});

	it("cuts the mix by time and resets its clock", () => {
		expect(rangeAudioFilter({ range: { start: 1.5, end: 4 } })).toBe(
			"atrim=start=1.5:end=4,asetpts=PTS-STARTPTS"
		);
	});

	it("gives the cut picture the joined clips' sound, cut the same way", () => {
		const args = buildRangeSoundArgs({
			sourcePath: "/t/full.mp4",
			picturePath: "/t/range.mp4",
			outputPath: "/out/range.mp4",
			range: { start: 10, end: 12.5 },
			settings,
		});
		expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
			"-map",
			"1:v:0",
			"-map",
			"0:a:0",
		]);
		expect(args[args.indexOf("-af") + 1]).toBe(
			"atrim=start=10:end=12.5,asetpts=PTS-STARTPTS"
		);
		expect(args[args.indexOf("-t") + 1]).toBe("2.5");
		expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
	});
});

describe("a segment outside the range", () => {
	const clip = segment({ startTime: 0, duration: 5, trimStart: 2 });
	const inputArgs = ["-ss", "2", "-t", "5", "-i", "/m/clip.mp4"];

	it("is black frames at the export's size with the clip's own sound", () => {
		const args = buildExportSegmentEncodeArgs({
			inputArgs,
			scaleFilter: "",
			segment: clip,
			settings,
			audio: { kind: "input" },
			outputPath: "/t/segment-0000.mov",
			blackPicture: true,
		});
		expect(args.slice(1, 5)).toEqual([
			"-f",
			"lavfi",
			"-i",
			"color=c=black:s=1470x630:r=24",
		]);
		expect(args.slice(5, 11)).toEqual(inputArgs);
		expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
		]);
		// Five seconds at 24 fps, cut by filters rather than by `-t`.
		expect(args[args.indexOf("-vf") + 1]).toBe(
			`trim=end_frame=120,${EXPORT_PICTURE_TAGS_FILTER}`
		);
		expect(args[args.indexOf("-af") + 1]).toContain("aresample=async=1");
		expect(args[args.indexOf("-af") + 1]).toContain("atrim=end_sample=240000");
		expect(args.slice(args.indexOf("-map"))).not.toContain("-t");
	});

	it("is black frames with silence when the clip has no sound", () => {
		const args = buildExportSegmentEncodeArgs({
			inputArgs,
			scaleFilter: "",
			segment: clip,
			settings,
			audio: null,
			outputPath: "/t/segment-0000.mov",
			blackPicture: true,
		});
		expect(args).not.toContain("/m/clip.mp4");
		expect(args.join(" ")).toContain("anullsrc=r=48000:cl=stereo");
		expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
		]);
	});

	it("leaves a shown segment's command as it was", () => {
		const shown = buildExportSegmentEncodeArgs({
			inputArgs,
			scaleFilter: "scale=1470:630",
			segment: clip,
			settings,
			audio: { kind: "input" },
			outputPath: "/t/segment-0000.mov",
		});
		expect(shown.slice(1, 7)).toEqual(inputArgs);
		expect(
			shown.slice(shown.indexOf("-map"), shown.indexOf("-map") + 4)
		).toEqual(["-map", "0:v:0", "-map", "0:a:0"]);
		expect(shown[shown.indexOf("-vf") + 1]).toBe(
			`scale=1470:630,${EXPORT_PICTURE_COLOR_FILTERS.join(",")},tpad=stop_mode=clone:stop=-1,fps=24:start_time=0:round=up,trim=end_frame=120`
		);
	});
});
