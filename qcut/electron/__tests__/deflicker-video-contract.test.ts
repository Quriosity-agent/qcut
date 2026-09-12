import { describe, expect, it } from "vitest";
import {
	buildLocalDeflickerArgs,
	parseLocalDeflickerMetadata,
	verifyLocalDeflickerOutput,
} from "../ffmpeg/deflicker-video-contract.js";

function probe({
	video = {},
	audio = true,
	format,
}: {
	video?: Record<string, unknown>;
	audio?: boolean;
	format?: { duration?: string };
} = {}) {
	return JSON.stringify({
		format,
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
		undefined,
		"N/A",
		"",
		"0",
		"-1",
	])("uses container timing when stream duration is unavailable: %s", (duration) => {
		const source = parseLocalDeflickerMetadata({
			json: probe({ video: { duration }, format: { duration: "4" } }),
		});
		expect(source).toMatchObject({
			durationSeconds: 4,
			durationBasis: "container",
			containerDurationSeconds: 4,
		});
		const output = parseLocalDeflickerMetadata({
			json: probe({ format: { duration: "4.001" } }),
		});
		expect(output.durationSeconds).toBe(2);
		expect(() => verifyLocalDeflickerOutput({ source, output })).not.toThrow();
	});

	it("compares video timing when available even if audio extends the container", () => {
		const source = parseLocalDeflickerMetadata({
			json: probe({ format: { duration: "4" } }),
		});
		expect(source.durationBasis).toBe("video");
		expect(() =>
			verifyLocalDeflickerOutput({
				source,
				output: { ...source, durationSeconds: 1.5 },
			})
		).toThrow("verification");
	});

	it.each([
		undefined,
		Number.NaN,
		2,
		6,
	])("rejects changed audio-tail timing even when video timing matches: %s", (containerDurationSeconds) => {
		const source = parseLocalDeflickerMetadata({
			json: probe({ format: { duration: "4" } }),
		});
		expect(() =>
			verifyLocalDeflickerOutput({
				source,
				output: { ...source, containerDurationSeconds },
			})
		).toThrow("verification");
	});

	it("accepts matching video and container durations within tolerance", () => {
		const source = parseLocalDeflickerMetadata({
			json: probe({ format: { duration: "4" } }),
		});
		const output = parseLocalDeflickerMetadata({
			json: probe({
				video: { duration: "2.001" },
				format: { duration: "4.001" },
			}),
		});
		expect(() => verifyLocalDeflickerOutput({ source, output })).not.toThrow();
	});

	it.each([
		undefined,
		Number.NaN,
		3.5,
	])("rejects missing or changed output container timing: %s", (containerDurationSeconds) => {
		const source = parseLocalDeflickerMetadata({
			json: probe({ video: { duration: "N/A" }, format: { duration: "4" } }),
		});
		expect(() =>
			verifyLocalDeflickerOutput({
				source,
				output: { ...source, containerDurationSeconds },
			})
		).toThrow("verification");
	});

	it.each([
		undefined,
		"N/A",
		"0",
		"-2",
	])("rejects metadata without usable stream or container timing: %s", (duration) => {
		expect(() =>
			parseLocalDeflickerMetadata({
				json: probe({ video: { duration: "N/A" }, format: { duration } }),
			})
		).toThrow("timing");
	});

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
