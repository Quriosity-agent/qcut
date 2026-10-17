import { describe, expect, it } from "vitest";
import { buildConcatCopyArgs } from "../claude/handlers/claude-export-handler/concat-timing.js";

describe("buildConcatCopyArgs", () => {
	it("shifts the input back by a negative audio lead and keeps negative timestamps", () => {
		const args = buildConcatCopyArgs({
			listPath: "/tmp/list.txt",
			outputPath: "/tmp/out.mp4",
			leadSeconds: -0.021333,
		});
		expect(args.slice(0, 3)).toEqual(["-y", "-itsoffset", "-0.021333"]);
		expect(args).toContain("-avoid_negative_ts");
		expect(args[args.indexOf("-avoid_negative_ts") + 1]).toBe("disabled");
		expect(args.at(-1)).toBe("/tmp/out.mp4");
	});

	it("copies plainly when the first input starts at zero or has no sound", () => {
		const args = buildConcatCopyArgs({
			listPath: "/tmp/list.txt",
			outputPath: "/tmp/out.mp4",
			leadSeconds: 0,
		});
		expect(args).toEqual([
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"/tmp/list.txt",
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			"/tmp/out.mp4",
		]);
	});
});
