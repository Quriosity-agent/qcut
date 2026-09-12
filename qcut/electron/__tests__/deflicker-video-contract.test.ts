import { describe, expect, it } from "vitest";
import {
	buildLocalDeflickerArgs,
	parseLocalDeflickerMetadata,
	verifyLocalDeflickerOutput,
} from "../ffmpeg/deflicker-video-contract.js";

function probe({
	video = {},
	audio = true,
}: {
	video?: Record<string, unknown>;
	audio?: boolean;
} = {}) {
	return JSON.stringify({
		streams: [
			{
				codec_type: "video",
				width: 320,
				height: 180,
				avg_frame_rate: "24/1",
				nb_read_frames: "48",
				duration: "2",
				pix_fmt: "yuv420p",
				field_order: "progressive",
				...video,
			},
			...(audio ? [{ codec_type: "audio" }] : []),
		],
	});
}

describe("standalone local deflicker contract", () => {
	it.each([
		"not json",
		"null",
		"{}",
		'{"streams":{}}',
		'{"streams":[]}',
	])("rejects malformed metadata %s", (json) => {
		expect(() => parseLocalDeflickerMetadata({ json })).toThrow();
	});

	it("uses decoded counts and display rotation", () => {
		expect(
			parseLocalDeflickerMetadata({
				json: probe({ video: { side_data_list: [{ rotation: 90 }] } }),
			})
		).toMatchObject({
			width: 180,
			height: 320,
			frameCount: 48,
			audioStreams: 1,
		});
	});

	it.each([
		{ width: 321 },
		{ height: 0 },
		{ width: 7680, height: 4320 },
		{ color_transfer: "smpte2084" },
		{ color_transfer: "arib-std-b67" },
		{ pix_fmt: "yuva420p" },
		{ pix_fmt: "yuv420p10le" },
		{ pix_fmt: "mystery" },
		{ pix_fmt: undefined },
		{ color_transfer: "mystery" },
		{ tags: { alpha_mode: "1" } },
		{ avg_frame_rate: "24/1/2" },
		{ field_order: "tt" },
		{ nb_read_frames: "1" },
		{ avg_frame_rate: "0/0" },
		{ duration: "N/A" },
	])("rejects unsupported input %o", (video) => {
		expect(() =>
			parseLocalDeflickerMetadata({ json: probe({ video }) })
		).toThrow();
	});

	it("keeps timestamp passthrough, audio copy and shared lab strength mapping", () => {
		const metadata = parseLocalDeflickerMetadata({ json: probe() });
		const args = buildLocalDeflickerArgs({
			sourcePath: "/source.mp4",
			outputPath: "/out.mp4",
			strength: 70,
			metadata,
		});
		expect(args[args.indexOf("-vf") + 1]).toBe("deflicker=size=23:mode=am");
		expect(args[args.indexOf("-fps_mode") + 1]).toBe("passthrough");
		expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
		expect(args).not.toContain("-r");
		expect(args).not.toContain("-shortest");
	});

	it.each([
		0,
		101,
		1.5,
		Number.NaN,
	])("rejects invalid strength %s", (strength) => {
		expect(() =>
			buildLocalDeflickerArgs({
				sourcePath: "/in",
				outputPath: "/out",
				strength,
				metadata: parseLocalDeflickerMetadata({ json: probe() }),
			})
		).toThrow("--strength");
	});

	it.each([
		{ frameCount: 47 },
		{ audioStreams: 0 },
		{ width: 180 },
		{ durationSeconds: 2.2 },
	])("refuses to publish changed output metadata %o", (change) => {
		const source = parseLocalDeflickerMetadata({ json: probe() });
		expect(() =>
			verifyLocalDeflickerOutput({ source, output: { ...source, ...change } })
		).toThrow("verification");
	});

	it("accepts verified output with container rounding", () => {
		const source = parseLocalDeflickerMetadata({ json: probe() });
		expect(() =>
			verifyLocalDeflickerOutput({
				source,
				output: { ...source, durationSeconds: 2.001 },
			})
		).not.toThrow();
	});
});
