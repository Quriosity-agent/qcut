import { describe, expect, it } from "vitest";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
	planSegmentPictureRead,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import { STEREO_SOURCE_CHAIN } from "../ffmpeg/stereo-source.js";

/**
 * Where a segment's source is opened, and how its picture and sound are put
 * back on the clip's clock (the measured behaviour is in
 * export-segment-in-point-real.test.ts).
 */

const clip: ExportSegment = {
	elementId: "clip-1",
	trackId: "track-1",
	trackOrder: 0,
	elementOrder: 0,
	sourcePath: "/tmp/clip.mp4",
	startTime: 26.6,
	duration: 1.5,
	trimStart: 129.5,
	sourceId: "media-1",
	fitMode: "cover",
};
const settings = { fps: 24, codec: "libx264", bitrate: "8Mbps" };

function filters({ args }: { args: string[] }): { vf: string; af: string } {
	return {
		vf: args[args.indexOf("-vf") + 1],
		af: args[args.indexOf("-af") + 1],
	};
}

describe("planSegmentPictureRead", () => {
	it("opens the source a quarter of a second before the in-point", () => {
		expect(planSegmentPictureRead({ segment: clip })).toEqual({
			seek: 129.25,
			lead: 0.25,
			// The lead, and the millisecond within which a frame counts as on time.
			pictureShiftMicros: 251_000,
		});
	});

	it("opens it at the start when the in-point is nearer than that", () => {
		expect(
			planSegmentPictureRead({ segment: { ...clip, trimStart: 0.1 } })
		).toEqual({ seek: 0, lead: 0.1, pictureShiftMicros: 101_000 });
		expect(
			planSegmentPictureRead({ segment: { ...clip, trimStart: 0 } })
		).toEqual({ seek: 0, lead: 0, pictureShiftMicros: 1000 });
	});

	it("starts the picture later by the first frame's delay, at the clip's rate", () => {
		// The clip starts 0.6 of a frame before the frame it is first seen on.
		expect(
			planSegmentPictureRead({ segment: clip, firstFrameDelay: 0.025 })
				?.pictureShiftMicros
		).toBe(276_000);
		// At twice the speed the same delay is twice as much of the source.
		expect(
			planSegmentPictureRead({
				segment: { ...clip, playbackRate: 2 },
				firstFrameDelay: 0.025,
			})?.pictureShiftMicros
		).toBe(302_000);
		// A delay cannot be negative: the first frame never shows what is
		// before the in-point.
		expect(
			planSegmentPictureRead({ segment: clip, firstFrameDelay: -0.01 })
				?.pictureShiftMicros
		).toBe(251_000);
	});

	it("puts the seek point on a whole microsecond", () => {
		const read = planSegmentPictureRead({
			segment: { ...clip, trimStart: 36.2 / 24 },
		});
		expect(read?.seek).toBe(1.258333);
		expect(read?.lead).toBeCloseTo(0.2500003333, 9);
	});

	it("has nothing to plan for a picture", () => {
		expect(
			planSegmentPictureRead({ segment: { ...clip, isImage: true } })
		).toBeUndefined();
	});
});

describe("a segment read by its plan", () => {
	const read = planSegmentPictureRead({ segment: clip });

	it("seeks to the plan's point and reads the lead as well", () => {
		expect(buildExportSegmentInputArgs({ segment: clip, read })).toEqual([
			"-ss",
			"129.25",
			"-t",
			"1.75",
			"-i",
			"/tmp/clip.mp4",
		]);
		// A retimed clip reads its rate times as much, plus the same lead.
		expect(
			buildExportSegmentInputArgs({
				segment: { ...clip, playbackRate: 2 },
				read,
			})
		).toEqual(["-ss", "129.25", "-t", "3.25", "-i", "/tmp/clip.mp4"]);
	});

	it("puts the picture on the first frame's clock and counts frames from zero", () => {
		const { vf, af } = filters({
			args: buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({ segment: clip, read }),
				scaleFilter: "scale=1470:630",
				segment: clip,
				settings,
				audio: { kind: "input" },
				outputPath: "/t/segment-0000.mov",
				span: { frames: 36, samples: 72_000 },
				read,
			}),
		});
		expect(vf).toBe(
			"settb=AVTB,setpts=PTS-251000,scale=1470:630,tpad=stop_mode=clone:stop=-1,fps=24:start_time=0:round=up,trim=end_frame=36"
		);
		// The sound of the same input starts at the in-point, the lead cut off.
		expect(af).toBe(
			`${STEREO_SOURCE_CHAIN},atrim=start=0.25,asetpts=PTS-0.25/TB,aresample=async=1:first_pts=0,apad,atrim=end_sample=72000`
		);
	});

	it("divides a retimed clip's time by its rate before the frames are counted", () => {
		const retimed = { ...clip, playbackRate: 2 };
		const plan = planSegmentPictureRead({ segment: retimed });
		const { vf } = filters({
			args: buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({
					segment: retimed,
					read: plan,
				}),
				scaleFilter: "scale=1470:630",
				segment: retimed,
				settings,
				audio: null,
				outputPath: "/t/segment-0000.mov",
				span: { frames: 36, samples: 72_000 },
				read: plan,
			}),
		});
		expect(vf).toBe(
			"settb=AVTB,setpts=PTS-252000,scale=1470:630,setpts=PTS/2,tpad=stop_mode=clone:stop=-1,fps=24:start_time=0:round=up,trim=end_frame=36"
		);
	});

	it("leaves sound from another input as it is read", () => {
		const { af } = filters({
			args: buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({ segment: clip, read }),
				scaleFilter: "scale=1470:630",
				segment: clip,
				settings,
				audio: {
					kind: "separate",
					inputArgs: ["-ss", "129.5", "-t", "1.5", "-i", "/tmp/sound.wav"],
				},
				outputPath: "/t/segment-0000.mov",
				span: { frames: 36, samples: 72_000 },
				read,
			}),
		});
		expect(af).toBe(
			`${STEREO_SOURCE_CHAIN},aresample=async=1:first_pts=0,apad,atrim=end_sample=72000`
		);
	});

	it("cuts no lead from the sound of a clip that starts with its file", () => {
		const untrimmed = { ...clip, trimStart: 0 };
		const plan = planSegmentPictureRead({ segment: untrimmed });
		const args = buildExportSegmentEncodeArgs({
			inputArgs: buildExportSegmentInputArgs({
				segment: untrimmed,
				read: plan,
			}),
			scaleFilter: "scale=1470:630",
			segment: untrimmed,
			settings,
			audio: { kind: "input" },
			outputPath: "/t/segment-0000.mov",
			span: { frames: 36, samples: 72_000 },
			read: plan,
		});
		expect(args.slice(1, 5)).toEqual(["-t", "1.5", "-i", "/tmp/clip.mp4"]);
		const { vf, af } = filters({ args });
		expect(vf.startsWith("settb=AVTB,setpts=PTS-1000,scale=")).toBe(true);
		expect(af).toBe(
			`${STEREO_SOURCE_CHAIN},aresample=async=1:first_pts=0,apad,atrim=end_sample=72000`
		);
	});
});
