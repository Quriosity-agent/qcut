import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleGenerateExportCommand } from "../native-pipeline/editor/editor-handlers-generate.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

function start({ peakCorrection }: { peakCorrection: string }) {
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({ success: true, data: { jobId: "export-1" } }),
				{ headers: { "Content-Type": "application/json" } }
			)
	);
	vi.stubGlobal("fetch", fetch);
	const client = new EditorApiClient({
		baseUrl: "http://127.0.0.1:19879",
		skipCapabilityCheck: true,
	});
	const options = {
		command: "editor:export:start",
		projectId: "project-1",
		outputDir: "/tmp",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		"peak-correction": peakCorrection,
	} as CLIRunOptions;
	return { fetch, run: handleGenerateExportCommand(client, options, vi.fn()) };
}

describe("editor:export:start --peak-correction", () => {
	it("sends the chosen correction with the export request", async () => {
		const { fetch, run } = start({ peakCorrection: "whole" });
		expect(await run).toMatchObject({ success: true });
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(String(init.body))).toMatchObject({
			peakCorrection: "whole",
		});
	});

	it("refuses an unknown correction before calling the editor", async () => {
		const { fetch, run } = start({ peakCorrection: "loud" });
		expect(await run).toEqual({
			success: false,
			error: "--peak-correction must be one of: local, whole, check",
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
