import { describe, expect, it, vi } from "vitest";
import { CLIPipelineRunner } from "../native-pipeline/cli/cli-runner.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import { getCommand } from "../native-pipeline/cli/command-registry.js";
import { readTimeRangeFlags } from "../native-pipeline/editor/editor-time-range-flags.js";

/**
 * `--start-time`/`--end-time` on `export start` and `mix loudness`: read as
 * numbers of seconds, and text that is not one is refused rather than read
 * as something else ("2:35" was 2) or dropped.
 */

describe("export start range flags", () => {
	it("registers --start-time and --end-time", () => {
		const names = getCommand("editor:export:start")?.flags.map((f) => f.name);
		expect(names).toContain("--start-time");
		expect(names).toContain("--end-time");
		expect(getCommand("editor:mix:loudness")?.flags.map((f) => f.name)).toEqual(
			expect.arrayContaining(["--start-time", "--end-time"])
		);
	});

	it("reads seconds and marks text that is not a number", () => {
		expect(
			parseCliArgs([
				"editor",
				"export",
				"start",
				"--project-id",
				"p",
				"--start-time",
				"155.583",
				"--end-time",
				"185.75",
			])
		).toMatchObject({ startTime: 155.583, endTime: 185.75 });
		const clock = parseCliArgs([
			"editor",
			"export",
			"start",
			"--project-id",
			"p",
			"--start-time",
			"2:35",
		]);
		expect(clock.startTime).toBeNaN();
		expect(
			parseCliArgs(["editor", "export", "start", "--project-id", "p"])
		).toMatchObject({ startTime: undefined, endTime: undefined });
	});

	it("is refused by the runner before any command runs", async () => {
		const runner = new CLIPipelineRunner();
		const start = await runner.run(
			{
				command: "editor:export:start",
				projectId: "p",
				startTime: Number.NaN,
			} as CLIRunOptions,
			vi.fn()
		);
		expect(start).toEqual({
			success: false,
			error: "--start-time must be a number of seconds (such as 155.583)",
		});
		const end = await runner.run(
			{
				command: "editor:timeline:trim",
				projectId: "p",
				startTime: 1,
				endTime: Number.NaN,
			} as CLIRunOptions,
			vi.fn()
		);
		expect(end).toEqual({
			success: false,
			error: "--end-time must be a number of seconds (such as 185.75)",
		});
	});
});

describe("readTimeRangeFlags", () => {
	it("gives no range when neither flag is set", () => {
		expect(readTimeRangeFlags({})).toEqual({});
	});

	it("keeps only the flags that were given", () => {
		expect(readTimeRangeFlags({ startTime: 10 })).toEqual({
			range: { startTime: 10 },
		});
		expect(readTimeRangeFlags({ endTime: 10 })).toEqual({
			range: { endTime: 10 },
		});
		expect(readTimeRangeFlags({ startTime: 0, endTime: 10 })).toEqual({
			range: { startTime: 0, endTime: 10 },
		});
	});

	it.each([
		{ flags: { startTime: -1 }, error: "--start-time must be a number" },
		{ flags: { startTime: Number.NaN }, error: "--start-time must be" },
		{ flags: { endTime: 0 }, error: "--end-time must be a number" },
		{ flags: { startTime: 5, endTime: 5 }, error: "must come after" },
	])("refuses $flags", ({ flags, error }) => {
		expect(readTimeRangeFlags(flags).error).toContain(error);
	});
});
