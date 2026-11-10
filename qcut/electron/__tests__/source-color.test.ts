import { describe, expect, it, vi } from "vitest";
import {
	buildCursorDecodeArgs,
	buildCursorEncodeArgs,
} from "../claude/handlers/claude-export-handler/cursor-composite.js";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import { buildGapSegmentEncodeArgs } from "../claude/handlers/claude-export-handler/gap-segments.js";
import {
	createSourceColorReader,
	EXPORT_PICTURE_COLOR_ARGS,
	EXPORT_PICTURE_COLOR_FILTERS,
	EXPORT_PICTURE_TAGS_FILTER,
	exportColorWarnings,
	resolveSourceColor,
	type SourceColor,
} from "../claude/handlers/claude-export-handler/source-color.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";

/**
 * How a source's colour is read and what every picture is written as (the
 * measured colours are in source-color-real.test.ts).
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
const settings = { fps: 24, codec: "libx264", bitrate: "8Mbps" };

function segmentArgs({
	color,
	blackPicture = false,
}: {
	color?: SourceColor;
	blackPicture?: boolean;
}): string[] {
	return buildExportSegmentEncodeArgs({
		inputArgs: buildExportSegmentInputArgs({ segment: clip }),
		scaleFilter: "scale=1280:720",
		segment: clip,
		settings,
		audio: null,
		outputPath: "/t/segment-0000.mov",
		blackPicture,
		color,
	});
}

const picture = (args: string[]) => args[args.indexOf("-vf") + 1];

describe("resolveSourceColor", () => {
	const yuv = { pixelFormat: "yuv420p", height: 1080 };

	it("takes a file at its word", () => {
		expect(
			resolveSourceColor({
				probe: { ...yuv, space: "bt709", range: "tv", transfer: "bt709" },
			})
		).toEqual({ declare: null, hdr: false });
		// A BT.601 or full-range file says so itself; the conversion reads it.
		expect(
			resolveSourceColor({
				probe: { ...yuv, space: "smpte170m", range: "tv" },
			})
		).toEqual({ declare: null, hdr: false });
		expect(
			resolveSourceColor({
				probe: { pixelFormat: "yuvj420p", space: "bt470bg", range: "pc" },
			})
		).toEqual({ declare: null, hdr: false });
	});

	it("reads an untagged picture as the preview does: BT.709 from 720 lines up, BT.601 below", () => {
		expect(resolveSourceColor({ probe: yuv })).toEqual({
			declare: "setparams=colorspace=bt709:range=tv",
			hdr: false,
		});
		expect(resolveSourceColor({ probe: { ...yuv, height: 720 } }).declare).toBe(
			"setparams=colorspace=bt709:range=tv"
		);
		expect(resolveSourceColor({ probe: { ...yuv, height: 719 } }).declare).toBe(
			"setparams=colorspace=smpte170m:range=tv"
		);
		expect(resolveSourceColor({ probe: { ...yuv, height: 360 } }).declare).toBe(
			"setparams=colorspace=smpte170m:range=tv"
		);
		// "unknown" is ffprobe's word for a tag that is not there.
		expect(
			resolveSourceColor({
				probe: { ...yuv, space: "unknown", range: "unknown" },
			}).declare
		).toBe("setparams=colorspace=bt709:range=tv");
	});

	it("states only what the file leaves out", () => {
		expect(
			resolveSourceColor({ probe: { ...yuv, space: "smpte170m" } }).declare
		).toBe("setparams=range=tv");
		expect(
			resolveSourceColor({ probe: { ...yuv, height: 480, range: "pc" } })
				.declare
		).toBe("setparams=colorspace=smpte170m");
	});

	it("has nothing to state for a picture without a matrix", () => {
		for (const pixelFormat of [
			"rgb24",
			"rgba",
			"gbrp",
			"pal8",
			"gray",
			"bgr0",
		]) {
			expect(
				resolveSourceColor({ probe: { pixelFormat, height: 360 } })
			).toEqual({
				declare: null,
				hdr: false,
			});
		}
	});

	it("leaves an HDR picture as it is", () => {
		for (const transfer of ["smpte2084", "arib-std-b67"]) {
			expect(
				resolveSourceColor({
					probe: {
						pixelFormat: "yuv420p10le",
						space: "bt2020nc",
						range: "tv",
						transfer,
						height: 2160,
					},
				})
			).toEqual({ declare: null, hdr: true });
		}
	});

	it("assumes nothing about a file it could not read", () => {
		expect(resolveSourceColor({ probe: undefined })).toEqual({
			declare: null,
			hdr: false,
		});
		expect(resolveSourceColor({ probe: { height: 360 } })).toEqual({
			declare: null,
			hdr: false,
		});
	});
});

describe("the export's colour description", () => {
	it("is BT.709, limited range, converted exactly and said on every frame", () => {
		expect(EXPORT_PICTURE_COLOR_FILTERS).toEqual([
			"scale=out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int",
			"format=yuv420p",
			"setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
		]);
		expect(EXPORT_PICTURE_TAGS_FILTER).toBe(
			"setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
		);
		expect(EXPORT_PICTURE_COLOR_ARGS).toEqual([
			"-colorspace",
			"bt709",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			"-color_range",
			"tv",
		]);
	});
});

describe("a segment's picture", () => {
	const toExport = EXPORT_PICTURE_COLOR_FILTERS.join(",");

	it("is converted to the export's description after its own filters, before it is cut", () => {
		const args = segmentArgs({ color: { declare: null, hdr: false } });
		expect(picture(args)).toBe(
			`scale=1280:720,${toExport},tpad=stop_mode=clone:stop=-1,fps=24:start_time=0:round=up,trim=end_frame=48`
		);
		expect(args.join(" ")).toContain(
			`-pix_fmt yuv420p ${EXPORT_PICTURE_COLOR_ARGS.join(" ")}`
		);
		// Without a probe it is converted all the same.
		expect(picture(segmentArgs({}))).toBe(picture(args));
	});

	it("says first what an untagged source is taken to be", () => {
		const args = segmentArgs({
			color: { declare: "setparams=colorspace=smpte170m:range=tv", hdr: false },
		});
		expect(
			picture(args).startsWith(
				"setparams=colorspace=smpte170m:range=tv,scale=1280:720,scale=out_color_matrix=bt709"
			)
		).toBe(true);
	});

	it("keeps an HDR source's own description", () => {
		const args = segmentArgs({ color: { declare: null, hdr: true } });
		expect(picture(args)).toBe(
			"scale=1280:720,tpad=stop_mode=clone:stop=-1,fps=24:start_time=0:round=up,trim=end_frame=48"
		);
		expect(args).not.toContain("-colorspace");
	});

	it("says what it is when it is black", () => {
		const args = segmentArgs({ blackPicture: true });
		expect(picture(args)).toBe(
			`trim=end_frame=48,${EXPORT_PICTURE_TAGS_FILTER}`
		);
		expect(args.join(" ")).toContain(EXPORT_PICTURE_COLOR_ARGS.join(" "));
		// Black has no source to keep the description of.
		expect(
			picture(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment: clip }),
					scaleFilter: "",
					segment: clip,
					settings,
					audio: null,
					outputPath: "/t/segment-0000.mov",
					blackPicture: true,
					color: { declare: null, hdr: true },
				})
			)
		).toBe(`trim=end_frame=48,${EXPORT_PICTURE_TAGS_FILTER}`);
	});
});

describe("a gap clip", () => {
	it("is black in the export's description", () => {
		const args = buildGapSegmentEncodeArgs({
			gap: { beforeSegment: 0, startTime: 0, duration: 1 },
			settings: { ...settings, width: 1280, height: 720 },
			outputPath: "/t/gap-0000.mov",
		});
		expect(picture(args)).toBe(
			`trim=end_frame=24,${EXPORT_PICTURE_TAGS_FILTER}`
		);
		expect(args.join(" ")).toContain(EXPORT_PICTURE_COLOR_ARGS.join(" "));
	});
});

describe("a recording drawn on as RGBA", () => {
	const decode = (color?: SourceColor) =>
		buildCursorDecodeArgs({
			sourcePath: "/m/recording.mp4",
			duration: 2,
			frames: 48,
			fps: 24,
			width: 1920,
			height: 1080,
			color,
		});

	it("is turned into RGB by what the source is taken to be", () => {
		const args = decode({
			declare: "setparams=colorspace=bt709:range=tv",
			hdr: false,
		});
		expect(picture(args)).toBe("setparams=colorspace=bt709:range=tv");
		expect(args.slice(-9)).toEqual([
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			"1920x1080",
			"-v",
			"error",
			"pipe:1",
		]);
		// A file that says what it is needs no statement.
		expect(decode({ declare: null, hdr: false })).not.toContain("-vf");
		expect(decode()).not.toContain("-vf");
	});

	it("goes back to the export's description", () => {
		const args = buildCursorEncodeArgs({
			segmentPath: "/t/segment-0000.mov",
			outputPath: "/t/segment-0000.mov.cursor-tmp.mov",
			width: 1280,
			height: 720,
			fps: 24,
			frames: 48,
			codec: "libx264",
			bitrate: "8Mbps",
		});
		expect(picture(args)).toBe(
			`tpad=stop_mode=clone:stop=-1,trim=end_frame=48,${EXPORT_PICTURE_COLOR_FILTERS.join(",")}`
		);
		expect(args.join(" ")).toContain(
			`-pix_fmt yuv420p ${EXPORT_PICTURE_COLOR_ARGS.join(" ")}`
		);
		// The drawn frames come in on stdin; the segment gives its sound.
		expect(args.slice(0, 12)).toEqual([
			"-y",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			"1280x720",
			"-r",
			"24",
			"-i",
			"pipe:0",
			"-i",
		]);
		expect(args.at(-1)).toBe("/t/segment-0000.mov.cursor-tmp.mov");
	});
});

describe("exportColorWarnings", () => {
	const complete = {
		pixelFormat: "yuv420p",
		range: "tv",
		space: "bt709",
		primaries: "bt709",
		transfer: "bt709",
	};

	it("says nothing of a file in the export's description, or one it cannot read", () => {
		expect(exportColorWarnings({ probe: complete })).toEqual([]);
		expect(exportColorWarnings({ probe: undefined })).toEqual([]);
	});

	it("names the tags of a file a pass left in another description", () => {
		// What a pass that draws in RGB hands back when nothing states it.
		const [warning] = exportColorWarnings({
			probe: { ...complete, primaries: undefined, transfer: "unknown" },
		});
		expect(warning).toMatch(
			/^The exported picture is tagged tv, bt709, unknown, unknown \(range, matrix, primaries, transfer\); it should be tv, bt709, bt709, bt709\./
		);
		expect(
			exportColorWarnings({ probe: { ...complete, range: "pc" } })
		).toHaveLength(1);
		expect(
			exportColorWarnings({ probe: { ...complete, space: "smpte170m" } })
		).toHaveLength(1);
	});
});

describe("createSourceColorReader", () => {
	it("reads each file once and resolves what it found", async () => {
		const probe = vi.fn(async ({ mediaPath }: { mediaPath: string }) =>
			mediaPath.endsWith("sd.mp4")
				? { pixelFormat: "yuv420p", height: 360 }
				: { pixelFormat: "yuv420p", height: 1080, space: "bt709", range: "tv" }
		);
		const read = createSourceColorReader({ probe });
		expect(await read({ mediaPath: "/m/sd.mp4" })).toEqual({
			declare: "setparams=colorspace=smpte170m:range=tv",
			hdr: false,
		});
		expect(await read({ mediaPath: "/m/hd.mp4" })).toEqual({
			declare: null,
			hdr: false,
		});
		await read({ mediaPath: "/m/sd.mp4" });
		expect(probe).toHaveBeenCalledTimes(2);
	});
});
