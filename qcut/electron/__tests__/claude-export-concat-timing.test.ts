import { describe, expect, it } from "vitest";
import { buildSegmentConcatArgs } from "../claude/handlers/claude-export-handler/concat-timing.js";

describe("buildSegmentConcatArgs", () => {
	it("copies the picture and encodes the PCM sound once at the export's format", () => {
		expect(
			buildSegmentConcatArgs({
				listPath: "/tmp/list.txt",
				outputPath: "/tmp/out.mp4",
				audio: { sampleRate: 44_100, channels: 1 },
				audioBitrateKbps: 256,
			})
		).toEqual([
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"/tmp/list.txt",
			"-map",
			"0:v:0",
			"-map",
			"0:a:0",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"256k",
			"-ar",
			"44100",
			"-ac",
			"1",
			"-movflags",
			"+faststart",
			"/tmp/out.mp4",
		]);
	});
});
