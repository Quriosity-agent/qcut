import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";

describe("CLI timeline playback args", () => {
	it("parses editor:timeline:play command", () => {
		const opts = parseCliArgs(["editor:timeline:play", "--project-id", "p1"]);
		expect(opts.command).toBe("editor:timeline:play");
		expect(opts.projectId).toBe("p1");
	});

	it("parses --time into seekTime for editor:timeline:seek", () => {
		const opts = parseCliArgs([
			"editor:timeline:seek",
			"--project-id",
			"p1",
			"--time",
			"4.25",
		]);
		expect(opts.command).toBe("editor:timeline:seek");
		expect(opts.seekTime).toBe(4.25);
	});
});
